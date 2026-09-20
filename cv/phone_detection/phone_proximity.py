"""
Device + person proximity checker.

Runs a quantized EfficientDet-Lite0 (COCO, 90 classes) on webcam frames to get
"person" boxes plus boxes for a set of watched objects (phone, remote,
bottle, ...). Each watched object maps to its own named state (e.g. "cell
phone" -> "on phone", "bottle" -> "drinking") and is evaluated as its own
branch: a state goes active when that object's box center sits close enough
to a person's box (within a fraction of the person's bounding-box diagonal).
States are independent, so more than one can be active at once (e.g.
drinking while on the phone).

This is a bounding-box heuristic, not pose-aware — it doesn't check whether
the object is near a hand/face specifically, just near the person overall.

Model note: originally SSD MobileNet v1, swapped for EfficientDet-Lite0
because MobileNet v1 was genuinely misclassifying objects (e.g. confidently
calling a water bottle a phone) -- a real accuracy problem, not just a
thresholding one (~25.7 mAP vs ~21 mAP on COCO). Same 4-tensor
boxes/classes/scores/count post-processing output and labelmap convention,
from the same TF Object Detection API export pipeline, so this was a
drop-in swap other than input size and max detection count.
"""

from collections import deque

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODEL_PATH = "models/efficientdet_lite0.tflite"
LABELMAP_PATH = "models/coco_labelmap.txt"
INPUT_SIZE = 320  # EfficientDet-Lite0 expects 320x320

# Raised from 0.4 back when SSD MobileNet v1 frequently confused phone/bottle
# at low confidence. Kept as a safety margin with the more accurate model.
SCORE_THRESHOLD = 0.6
PROXIMITY_THRESHOLD = 0.6  # object-to-person center distance / person bbox diagonal

# Temporal smoothing: a state only counts as "confirmed" once it's been the
# majority vote over the last SMOOTHING_WINDOW frames, so one flickered
# misclassification can't flip doomscrolling/drinkingWater on its own.
SMOOTHING_WINDOW = 5
SMOOTHING_MIN_VOTES = 3

PERSON_LABEL = "person"

# COCO class -> the state that class implies when close to a person.
LABEL_STATES = {
    "cell phone": "on phone",
    "remote": "using remote",
    "bottle": "drinking",
}
WATCHED_LABELS = set(LABEL_STATES)


def load_labels(path):
    with open(path) as f:
        # model's class indices are offset by -1 from this file's line numbers
        # (line 0 is a "???" placeholder the model never actually predicts)
        return [line.strip() for line in f]


def load_interpreter(model_path):
    interpreter = Interpreter(model_path=model_path)
    interpreter.allocate_tensors()
    return interpreter


def run_detector(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (INPUT_SIZE, INPUT_SIZE))
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()

    boxes = interpreter.get_tensor(output_details[0]["index"])[0]  # (25, 4) ymin,xmin,ymax,xmax
    classes = interpreter.get_tensor(output_details[1]["index"])[0]  # (25,)
    scores = interpreter.get_tensor(output_details[2]["index"])[0]  # (25,)
    count = int(interpreter.get_tensor(output_details[3]["index"])[0])

    return boxes[:count], classes[:count], scores[:count]


def detections_by_label(boxes, classes, scores, labels, frame_shape):
    """Yield (label, (x1, y1, x2, y2)) in pixel coords for detections above threshold."""
    h, w = frame_shape[:2]
    for box, class_id, score in zip(boxes, classes, scores):
        if score < SCORE_THRESHOLD:
            continue
        label = labels[int(class_id) + 1]
        ymin, xmin, ymax, xmax = box
        x1, y1, x2, y2 = xmin * w, ymin * h, xmax * w, ymax * h
        yield label, (x1, y1, x2, y2), score


def box_center(box):
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def box_diagonal(box):
    x1, y1, x2, y2 = box
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5


def closest_pair_per_label(detections):
    """detections: list of (label, box, score). For each watched label
    present, returns the closest person/object pair as
    {label: (normalized_distance, person_box, object_box)}."""
    people = [box for label, box, _ in detections if label == PERSON_LABEL]

    best_by_label = {}
    for label, obj_box, _score in detections:
        if label not in WATCHED_LABELS:
            continue
        oc = box_center(obj_box)
        for person_box in people:
            pc = box_center(person_box)
            diag = max(box_diagonal(person_box), 1e-6)
            dist = ((pc[0] - oc[0]) ** 2 + (pc[1] - oc[1]) ** 2) ** 0.5
            norm_dist = dist / diag
            current = best_by_label.get(label)
            if current is None or norm_dist < current[0]:
                best_by_label[label] = (norm_dist, person_box, obj_box)
    return best_by_label


def active_states(best_by_label):
    """Returns {state_name: normalized_distance} for labels within PROXIMITY_THRESHOLD."""
    states = {}
    for label, (norm_dist, _person_box, _obj_box) in best_by_label.items():
        if norm_dist < PROXIMITY_THRESHOLD:
            states[LABEL_STATES[label]] = norm_dist
    return states


class StateSmoother:
    """Confirms a state only once it wins a majority of the last N frames."""

    def __init__(self, window=SMOOTHING_WINDOW, min_votes=SMOOTHING_MIN_VOTES):
        self.window = window
        self.min_votes = min_votes
        self.history = deque(maxlen=window)

    def update(self, active_state_names):
        self.history.append(set(active_state_names))
        counts = {}
        for frame_states in self.history:
            for name in frame_states:
                counts[name] = counts.get(name, 0) + 1
        return {name for name, count in counts.items() if count >= self.min_votes}


def draw_detections(frame, detections):
    for label, box, score in detections:
        x1, y1, x2, y2 = (int(v) for v in box)
        if label == PERSON_LABEL:
            color = (0, 255, 0)
        elif label in WATCHED_LABELS:
            color = (0, 165, 255)
        else:
            color = (255, 255, 0)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            frame, f"{label} {score:.2f}", (x1, max(y1 - 8, 0)),
            cv2.FONT_HERSHEY_SIMPLEX, 1.0, color, 3,
        )


def main():
    interpreter = load_interpreter(MODEL_PATH)
    labels = load_labels(LABELMAP_PATH)
    cap = cv2.VideoCapture(0)
    smoother = StateSmoother()

    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        boxes, classes, scores = run_detector(interpreter, frame_rgb)
        detections = list(detections_by_label(boxes, classes, scores, labels, frame.shape))

        draw_detections(frame, detections)

        best_by_label = closest_pair_per_label(detections)
        raw_states = active_states(best_by_label)
        confirmed = smoother.update(raw_states.keys())
        for i, state_name in enumerate(confirmed):
            y = 30 + i * 30
            norm_dist = raw_states.get(state_name)
            label = state_name.upper() if norm_dist is None else f"{state_name.upper()} ({norm_dist:.2f})"
            cv2.putText(
                frame, label, (10, y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2,
            )

        cv2.imshow("Phone Detection", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
