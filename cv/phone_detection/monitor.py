"""
Merged 1Hz sensor loop for the Nudge dashboard.

Combines two previously-separate scripts into one:
  - candidates/slouch-detector/slouch_detector.py  (MediaPipe Pose, calibrated
    slouch heuristic) -> feeds the `slouching` field.
  - phone_detection/phone_proximity.py             (SSD MobileNet, object-near-
    person proximity)  -> feeds `doomscrolling` (phone) and `drinkingWater`
    (bottle) fields.

Every ~1s: grab one webcam frame -> run both models on it -> push one
{doomscrolling, slouching, sleeping, drinkingWater, tempRaw} reading to
POST /api/robot/sensors (see SENSOR_API.md).

`sleeping` isn't detected yet -> always False for now.
`tempRaw` isn't read from real hardware yet -> fixed placeholder (see SENSOR_API.md).

Posture is still the finicky part we're tuning, so it keeps a visual debug
window (skeleton + calibration/slouch status). Phone/drink detection is
already validated, so it runs headless -- no window, just the booleans.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import requests
from ai_edge_litert.interpreter import Interpreter

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models"

POLL_INTERVAL = 1.0  # seconds -> 1 Hz

# ---------------------------------------------------------------------------
# Posture: MediaPipe Pose slouch heuristic
# (ported from candidates/slouch-detector/slouch_detector.py; dropped its
# standalone main()/big popup UI, kept calibration + detection + a light
# debug overlay since this heuristic still needs tuning)
# ---------------------------------------------------------------------------

class SlouchDetector:
    def __init__(self, slouch_threshold: float = 0.04, calibration_frames: int = 5):
        self.mp_pose = mp.solutions.pose
        self.mp_drawing = mp.solutions.drawing_utils
        self.pose = self.mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)

        self.slouch_threshold = slouch_threshold
        self.calibration_frames = calibration_frames

        self.is_calibrated = False
        self.calibration_data = []
        self.baseline_neck_to_shoulder_distance = None
        self.current_neck_distance = None

    def get_neck_distance(self, landmarks):
        nose = landmarks[self.mp_pose.PoseLandmark.NOSE.value]
        left_shoulder = landmarks[self.mp_pose.PoseLandmark.LEFT_SHOULDER.value]
        right_shoulder = landmarks[self.mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
        shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2
        return nose.y - shoulder_mid_y

    def calibrate(self, landmarks) -> bool:
        neck_distance = self.get_neck_distance(landmarks)
        self.calibration_data.append(neck_distance)
        if len(self.calibration_data) >= self.calibration_frames:
            self.baseline_neck_to_shoulder_distance = np.median(self.calibration_data)
            self.is_calibrated = True
            print(f"[posture] calibrated, baseline={self.baseline_neck_to_shoulder_distance:.4f}")
            return True
        return False

    def detect_slouch(self, landmarks) -> bool:
        if not self.is_calibrated:
            return False
        neck_distance = self.get_neck_distance(landmarks)
        self.current_neck_distance = neck_distance
        slouch_amount = neck_distance - self.baseline_neck_to_shoulder_distance
        return slouch_amount > self.slouch_threshold

    def draw_debug(self, frame, pose_landmarks, is_slouching: bool):
        self.mp_drawing.draw_landmarks(frame, pose_landmarks, self.mp_pose.POSE_CONNECTIONS)
        if not self.is_calibrated:
            text = f"CALIBRATING: {len(self.calibration_data)}/{self.calibration_frames}"
            color = (0, 255, 255)
        elif is_slouching:
            text = "SLOUCHING"
            color = (0, 0, 255)
        else:
            text = "OK"
            color = (0, 200, 0)
        cv2.putText(frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
        if self.is_calibrated and self.current_neck_distance is not None:
            slouch_amount = self.current_neck_distance - self.baseline_neck_to_shoulder_distance
            debug = f"slouch_amount={slouch_amount:.3f} threshold={self.slouch_threshold:.3f}"
            cv2.putText(frame, debug, (10, frame.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
        return frame

    def process_frame(self, frame_rgb):
        """Returns (annotated_frame_or_None, is_slouching)."""
        results = self.pose.process(frame_rgb)
        if not results.pose_landmarks:
            return None, False

        landmarks = results.pose_landmarks.landmark
        if not self.is_calibrated:
            self.calibrate(landmarks)
            is_slouching = False
        else:
            is_slouching = self.detect_slouch(landmarks)
        return results.pose_landmarks, is_slouching

    def close(self):
        self.pose.close()


# ---------------------------------------------------------------------------
# Phone / drink proximity: EfficientDet-Lite0 (COCO)
# (originally SSD MobileNet v1, from phone_detection/phone_proximity.py --
# swapped for EfficientDet-Lite0 because MobileNet v1 was genuinely
# misclassifying objects, e.g. confidently calling a water bottle a phone.
# Same 4-tensor post-processing output format and labelmap convention, from
# the same TF Object Detection API export pipeline, so this is a drop-in
# swap other than input size/detection count. ~25.7 mAP vs ~21 mAP on COCO.
# This detector runs headless -- no window, just the booleans.)
# ---------------------------------------------------------------------------

PHONE_MODEL_PATH = MODELS_DIR / "efficientdet_lite0.tflite"
LABELMAP_PATH = MODELS_DIR / "coco_labelmap.txt"
PHONE_INPUT_SIZE = 320

SCORE_THRESHOLD = 0.4
# kept as a safety net; the old per-label bump for "cell phone" is no longer
# needed now that the misclassification was actually a model-accuracy issue.
LABEL_SCORE_THRESHOLDS = {}
PROXIMITY_THRESHOLD = 0.6  # object-to-person center distance / person bbox diagonal

PERSON_LABEL = "person"
LABEL_STATES = {
    "cell phone": "on phone",
    "bottle": "drinking",
}
WATCHED_LABELS = set(LABEL_STATES)


def load_labels(path):
    with open(path) as f:
        return [line.strip() for line in f]


def run_ssd(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (PHONE_INPUT_SIZE, PHONE_INPUT_SIZE))
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()

    boxes = interpreter.get_tensor(output_details[0]["index"])[0]
    classes = interpreter.get_tensor(output_details[1]["index"])[0]
    scores = interpreter.get_tensor(output_details[2]["index"])[0]
    count = int(interpreter.get_tensor(output_details[3]["index"])[0])
    return boxes[:count], classes[:count], scores[:count]


def detections_by_label(boxes, classes, scores, labels, frame_shape):
    h, w = frame_shape[:2]
    for box, class_id, score in zip(boxes, classes, scores):
        label = labels[int(class_id) + 1]
        if score < LABEL_SCORE_THRESHOLDS.get(label, SCORE_THRESHOLD):
            continue
        ymin, xmin, ymax, xmax = box
        yield label, (xmin * w, ymin * h, xmax * w, ymax * h)


def box_center(box):
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def box_diagonal(box):
    x1, y1, x2, y2 = box
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5


def active_proximity_states(detections):
    people = [box for label, box in detections if label == PERSON_LABEL]
    best_by_label = {}
    for label, obj_box in detections:
        if label not in WATCHED_LABELS:
            continue
        oc = box_center(obj_box)
        for person_box in people:
            pc = box_center(person_box)
            diag = max(box_diagonal(person_box), 1e-6)
            norm_dist = ((pc[0] - oc[0]) ** 2 + (pc[1] - oc[1]) ** 2) ** 0.5 / diag
            current = best_by_label.get(label)
            if current is None or norm_dist < current:
                best_by_label[label] = norm_dist

    return {LABEL_STATES[label]: dist for label, dist in best_by_label.items() if dist < PROXIMITY_THRESHOLD}


# ---------------------------------------------------------------------------
# Sensor API push (ported from push_sensor_data.py)
# ---------------------------------------------------------------------------

def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def push_reading(api_base: str, robot_key: str, reading: dict) -> None:
    resp = requests.post(
        f"{api_base}/api/robot/sensors",
        headers={"Authorization": f"Bearer {robot_key}"},
        json=reading,
        timeout=10,
    )
    resp.raise_for_status()
    print(f"[{time.strftime('%H:%M:%S')}] pushed {reading} -> {resp.json()}")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print readings instead of POSTing them")
    parser.add_argument("--interval", type=float, default=POLL_INTERVAL, help="seconds between polls")
    args = parser.parse_args()

    load_env(ROOT / ".env")
    api_base = os.environ.get("API_BASE", "http://localhost:3001")
    robot_key = os.environ.get("ROBOT_KEY")
    if not args.dry_run and not robot_key:
        print("ROBOT_KEY is not set (see .env). Run with --dry-run to test without pushing.", file=sys.stderr)
        return 1

    slouch_detector = SlouchDetector()
    phone_interpreter = Interpreter(model_path=str(PHONE_MODEL_PATH))
    phone_interpreter.allocate_tensors()
    labels = load_labels(LABELMAP_PATH)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam")

    print(f"Polling at {1 / args.interval:.1f} Hz. Press 'q' (in the posture window) to quit.")
    try:
        while True:
            tick_start = time.time()
            ok, frame = cap.read()
            if not ok:
                break
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # posture (visual debug kept -- heuristic still being tuned)
            pose_landmarks, is_slouching = slouch_detector.process_frame(frame_rgb)
            debug_frame = frame.copy()
            if pose_landmarks is not None:
                debug_frame = slouch_detector.draw_debug(debug_frame, pose_landmarks, is_slouching)
            else:
                cv2.putText(debug_frame, "NO POSE DETECTED", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
            cv2.imshow("Posture (tuning)", debug_frame)

            # phone / drink proximity (headless)
            boxes, classes, scores = run_ssd(phone_interpreter, frame_rgb)
            detections = list(detections_by_label(boxes, classes, scores, labels, frame.shape))
            states = active_proximity_states(detections)

            reading = {
                "doomscrolling": "on phone" in states,
                "slouching": bool(is_slouching),
                "sleeping": False,  # not detected yet
                "drinkingWater": "drinking" in states,
                "tempRaw": 2700,  # placeholder, no real temp sensor wired up yet
            }

            if args.dry_run:
                print(f"[{time.strftime('%H:%M:%S')}] (dry-run) {reading}")
            else:
                try:
                    push_reading(api_base, robot_key, reading)
                except requests.RequestException as error:
                    print(f"push failed: {error}", file=sys.stderr)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

            elapsed = time.time() - tick_start
            time.sleep(max(0.0, args.interval - elapsed))
    finally:
        cap.release()
        cv2.destroyAllWindows()
        slouch_detector.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
