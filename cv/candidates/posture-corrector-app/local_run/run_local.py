"""
Stripped-down, locally-runnable port of R40835/posture-corrector-app's
posture logic (jetson-nano-src/posture_corrector_api/corrector.py).

Dropped from the original (all Jetson/backend-specific, not the detection logic):
  - ModelTrt / TensorRT / CUDA / pycuda inference backend  -> replaced with plain
    TFLite CPU inference (ai_edge_litert), same as our own posture_check.py.
  - cpp_functions (Cython/C++ euclidean_distance, angle_calculator), precompiled
    only for linux-aarch64 -> reimplemented in pure Python from their .cpp source.
  - Buffers (Cython/C++ circular buffers) -> reimplemented as a plain Python deque.
  - DjangoAppSession (auth, photo upload, DB update over HTTP)   -> removed entirely.
  - NVIDIA CSI GStreamer camera pipeline                          -> plain cv2.VideoCapture(0).
  - Lateral (side-camera) corrector, which needs hips+knees in frame -> dropped;
    we only keep the frontal neck corrector, which only needs nose + shoulders
    and is what applies to a front-facing desk webcam.

This preserves their original heuristic's math exactly (see angle_calculator).
"""

import math
from collections import deque

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODEL_PATH = "models/movenet_lightning.tflite"
INPUT_SIZE = 192
CONF_THRESHOLD = 0.3

NOSE, LEFT_SHOULDER, RIGHT_SHOULDER = 0, 5, 6

# how many consecutive "forward" frames before raising a sustained alert
BUFFER_SIZE = 30


def angle_calculator(p1, p2, p3):
    """Angle at p2 formed by rays p2->p1 and p2->p3, in degrees [0, 360).
    Ported verbatim from optimised_computations/my_functions.cpp."""
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    angle = (math.atan2(y3 - y2, x3 - x2) - math.atan2(y1 - y2, x1 - x2)) * 180.0 / math.pi
    if angle < 0:
        angle += 360
    return angle


class NeckBuffer:
    """Pure-Python stand-in for optimised_buffers/CircularBuffers.cpp's NeckCircularBuffer."""

    def __init__(self, size=BUFFER_SIZE):
        self.buf = deque(maxlen=size)
        self.size = size

    def add(self, posture):  # posture: 'f' (forward) or 'u' (upright)
        self.buf.append(posture)

    def is_incorrect(self):
        return len(self.buf) == self.size and all(p == "f" for p in self.buf)

    def is_moving(self):
        return "u" in self.buf and "f" in self.buf

    def max_incorrect_reached(self):
        if self.is_incorrect():
            self.buf.clear()
            return True
        if self.is_moving():
            self.buf.clear()
        return False


def load_interpreter(model_path):
    interpreter = Interpreter(model_path=model_path)
    interpreter.allocate_tensors()
    return interpreter


def run_movenet(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (INPUT_SIZE, INPUT_SIZE))
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()
    keypoints = interpreter.get_tensor(output_details[0]["index"])
    return keypoints[0, 0, :, :]  # (17, 3) -> (y, x, conf)


def frontal_neck_corrector(keypoints):
    """Ported from corrector.py's _frontal_neck_corrector.
    Returns ('f' or 'u', debug_dict) or (None, debug) if keypoints not visible."""
    n_y, n_x, n_c = keypoints[NOSE]
    ls_y, ls_x, ls_c = keypoints[LEFT_SHOULDER]
    rs_y, rs_x, rs_c = keypoints[RIGHT_SHOULDER]

    if n_c < CONF_THRESHOLD or ls_c < CONF_THRESHOLD or rs_c < CONF_THRESHOLD:
        return None, {}

    n, ls, rs = (n_x, n_y), (ls_x, ls_y), (rs_x, rs_y)

    right_shoulder_angle = angle_calculator(n, rs, ls)
    left_shoulder_angle = angle_calculator(n, ls, rs)

    debug = {
        "right_shoulder_angle": round(right_shoulder_angle, 1),
        "left_shoulder_angle": round(left_shoulder_angle, 1),
    }

    # original thresholds: 50 < right_shoulder_angle and left_shoulder_angle < 310
    if (50 < right_shoulder_angle) and (left_shoulder_angle < 310):
        return "u", debug
    return "f", debug


def main():
    interpreter = load_interpreter(MODEL_PATH)
    neck_buffer = NeckBuffer()
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam")

    print("Press 'q' to quit.")
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        keypoints = run_movenet(interpreter, frame_rgb)
        posture, debug = frontal_neck_corrector(keypoints)

        if posture is not None:
            neck_buffer.add(posture)
        sustained_alert = neck_buffer.max_incorrect_reached()

        label = {"f": "FORWARD-LEANING NECK", "u": "UPRIGHT", None: "keypoints not visible"}[posture]
        color = (0, 0, 255) if posture == "f" else (0, 200, 0)

        cv2.putText(frame, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
        if sustained_alert:
            cv2.putText(frame, "SUSTAINED BAD POSTURE!", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            print("\a")
        debug_str = " ".join(f"{k}={v}" for k, v in debug.items())
        cv2.putText(frame, debug_str, (10, frame.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)

        cv2.imshow("Posture Corrector (ported, frontal neck only)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
