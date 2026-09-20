"""
Bare-minimum MoveNet posture checker.

Reads webcam frames, runs MoveNet Lightning (int8 TFLite) to get 17 keypoints,
and applies a simple heuristic on the upper-body keypoints (nose, ears, shoulders)
to flag "bad posture" (forward head / slouch / tilted shoulders).

This is a first pass heuristic meant to be tuned later — thresholds are guesses.
"""

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODEL_PATH = "models/movenet_lightning.tflite"
INPUT_SIZE = 192  # MoveNet Lightning expects 192x192

# COCO keypoint indices used by MoveNet
NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR = 0, 1, 2, 3, 4
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6

KEYPOINT_EDGES = [
    (0, 1), (0, 2), (1, 3), (2, 4), (0, 5), (0, 6),
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),
    (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
]

CONF_THRESHOLD = 0.3


def load_interpreter(model_path):
    interpreter = Interpreter(model_path=model_path)
    interpreter.allocate_tensors()
    return interpreter


def run_movenet(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (INPUT_SIZE, INPUT_SIZE))
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    # int8 model expects uint8 input
    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()

    keypoints = interpreter.get_tensor(output_details[0]["index"])
    # shape: [1, 1, 17, 3] -> (y, x, confidence) normalized 0-1
    return keypoints[0, 0, :, :]


SMOOTHING_ALPHA = 0.4  # lower = smoother/laggier, higher = snappier/more jitter


class KeypointSmoother:
    """
    Exponential moving average over MoveNet's (y, x, conf) keypoints, to fade
    out frame-to-frame jitter in the raw estimates.

    Only blends in a new reading when its confidence clears CONF_THRESHOLD,
    so a momentarily-occluded keypoint holds its last good position instead
    of snapping to a low-confidence noisy one.
    """

    def __init__(self, alpha=SMOOTHING_ALPHA):
        self.alpha = alpha
        self.state = None  # smoothed (17, 3) array

    def update(self, keypoints):
        if self.state is None:
            self.state = keypoints.copy()
            return self.state

        for i in range(keypoints.shape[0]):
            y, x, conf = keypoints[i]
            if conf >= CONF_THRESHOLD:
                sy, sx, sconf = self.state[i]
                self.state[i, 0] = self.alpha * y + (1 - self.alpha) * sy
                self.state[i, 1] = self.alpha * x + (1 - self.alpha) * sx
                self.state[i, 2] = self.alpha * conf + (1 - self.alpha) * sconf
            else:
                # keep last known position, but let confidence decay toward the new (low) reading
                self.state[i, 2] = self.alpha * conf + (1 - self.alpha) * self.state[i, 2]

        return self.state


FORWARD_HEAD_THRESHOLD = 0.35


def check_posture(keypoints):
    """
    Single heuristic for now: forward head.

    average ear x-position vs. shoulder midpoint x-position, normalized by
    shoulder width -> flags head jutting forward of the shoulders.

    (Shoulder-tilt and head-drop checks were dropped for now so we can tune
    this one signal in isolation before adding more.)

    Returns (is_bad, reasons: list[str], debug: dict)
    """
    reasons = []
    debug = {}

    def kp(i):
        y, x, conf = keypoints[i]
        return (x, y, conf)

    l_sh = kp(LEFT_SHOULDER)
    r_sh = kp(RIGHT_SHOULDER)
    l_ear = kp(LEFT_EAR)
    r_ear = kp(RIGHT_EAR)

    if l_sh[2] < CONF_THRESHOLD or r_sh[2] < CONF_THRESHOLD:
        return False, ["shoulders not visible"], debug

    shoulder_mid_x = (l_sh[0] + r_sh[0]) / 2
    shoulder_width = abs(l_sh[0] - r_sh[0]) + 1e-6

    ear_xs = [e[0] for e in (l_ear, r_ear) if e[2] >= CONF_THRESHOLD]
    if not ear_xs:
        return False, ["ears not visible"], debug

    ear_mid_x = sum(ear_xs) / len(ear_xs)
    forward_offset = (ear_mid_x - shoulder_mid_x) / shoulder_width
    debug["forward_offset"] = round(forward_offset, 3)
    if abs(forward_offset) > FORWARD_HEAD_THRESHOLD:
        reasons.append("forward head / leaning")

    return (len(reasons) > 0), reasons, debug


def draw_overlay(frame, keypoints, is_bad, reasons, debug):
    h, w = frame.shape[:2]
    for y, x, conf in keypoints:
        if conf >= CONF_THRESHOLD:
            cv2.circle(frame, (int(x * w), int(y * h)), 4, (0, 255, 0), -1)
    for i, j in KEYPOINT_EDGES:
        y1, x1, c1 = keypoints[i]
        y2, x2, c2 = keypoints[j]
        if c1 >= CONF_THRESHOLD and c2 >= CONF_THRESHOLD:
            cv2.line(frame, (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h)), (255, 255, 0), 2)

    status = "BAD POSTURE" if is_bad else "OK"
    color = (0, 0, 255) if is_bad else (0, 200, 0)
    cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
    if reasons:
        cv2.putText(frame, ", ".join(reasons), (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    debug_str = " ".join(f"{k}={v}" for k, v in debug.items())
    cv2.putText(frame, debug_str, (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
    return frame


def main():
    interpreter = load_interpreter(MODEL_PATH)
    smoother = KeypointSmoother()
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam")

    print("Press 'q' to quit.")
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        raw_keypoints = run_movenet(interpreter, frame_rgb)
        keypoints = smoother.update(raw_keypoints)
        is_bad, reasons, debug = check_posture(keypoints)
        frame = draw_overlay(frame, keypoints, is_bad, reasons, debug)

        cv2.imshow("Posture Check (MoveNet)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
