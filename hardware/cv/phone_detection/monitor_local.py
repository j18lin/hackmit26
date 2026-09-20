"""
Same inference pipeline as the Arduino, but running locally on the Mac with
a live pose overlay -- for debugging *why* posture reads as "?".

Deliberately imports the heuristics from bench/tcp_infer_server.py rather
than reimplementing them (head_height, PostureCalibration, ViolationTracker,
check_proximity_states, run_pose/run_detect/run_classify), so this can't
drift from what the board actually does. Only the transport differs: no TCP,
models run in this process.

The overlay shows what the text labels can't:
  - the skeleton, with each keypoint colored by confidence
  - nose / left shoulder / right shoulder confidences, which are exactly
    what decides readable-vs-"?" (see head_height())
  - live head_height vs the calibrated baseline and the slouch threshold
  - why a frame was unreadable, when it was

Needs the venv (ai-edge-litert has no working wheel for the system python):
    python3.12 -m venv .venv && .venv/bin/pip install ai-edge-litert opencv-python numpy requests

Usage:
    .venv/bin/python phone_detection/monitor_local.py
    .venv/bin/python phone_detection/monitor_local.py --camera "MacBook"
    .venv/bin/python phone_detection/monitor_local.py --no-calibrate --dry-run
Press q or Esc in the window to quit, c to re-calibrate.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bench"))

# Single source of truth for the heuristics -- same module the board runs.
import tcp_infer_server as infer  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from monitor_arduino import load_env, push_violations  # noqa: E402

MODELS_DIR = ROOT / "models"
CALIBRATION_PATH = ROOT / "posture_calibration_local.json"

# COCO keypoint pairs, for drawing the skeleton.
EDGES = [
    (0, 1), (0, 2), (1, 3), (2, 4), (0, 5), (0, 6),
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),
    (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
]
KEYPOINT_NAMES = [
    "nose", "left eye", "right eye", "left ear", "right ear",
    "left shoulder", "right shoulder", "left elbow", "right elbow",
    "left wrist", "right wrist", "left hip", "right hip",
    "left knee", "right knee", "left ankle", "right ankle",
]


DETECTION_COLORS = {
    "person": (255, 160, 0),
    "cell phone": (255, 0, 255),
    "bottle": (255, 255, 0),
}


def decode_detections(boxes, classes, scores, labels, frame_shape):
    """Detections above threshold as (label, score, (x1,y1,x2,y2)) in pixels.

    Display-only: the doomscrolling/drinkingWater decision still comes from
    infer.check_proximity_states(), so what's drawn can't disagree with what
    the pipeline actually decided.
    """
    h, w = frame_shape[:2]
    out = []
    for box, class_id, score in zip(boxes, classes, scores):
        if score < infer.SCORE_THRESHOLD:
            continue
        label = labels[int(class_id) + 1]
        ymin, xmin, ymax, xmax = box
        out.append((label, float(score), (xmin * w, ymin * h, xmax * w, ymax * h)))
    return out


def draw_detections(frame, detections):
    for label, score, (x1, y1, x2, y2) in detections:
        color = DETECTION_COLORS.get(label, (160, 160, 160))
        thickness = 2 if label in DETECTION_COLORS else 1
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, thickness)
        tag = f"{label} {score:.2f}"
        cv2.putText(frame, tag, (int(x1), max(int(y1) - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, tag, (int(x1), max(int(y1) - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
    return frame


def format_console_line(metric, blocker, reading, states, detections, violations, calibrating):
    """One compact line per frame: posture, the proximity verdicts, and every
    object actually detected (not just the watched ones, so it's obvious when
    e.g. a phone is seen but too far from the person to count)."""
    if calibrating:
        posture = "calibrating"
    elif metric is None:
        posture = f"posture ?      [{blocker}]"
    elif reading["slouching"]:
        posture = f"posture down   h={metric:.3f}"
    else:
        posture = f"posture up     h={metric:.3f}"

    # "on phone"/"drinking" mean near enough to the person to count; the
    # value is that normalized distance.
    verdicts = []
    if reading.get("doomscrolling"):
        verdicts.append(f"PHONE(d={states['on phone']:.2f})")
    if reading.get("drinkingWater"):
        verdicts.append(f"BOTTLE(d={states['drinking']:.2f})")

    seen = ", ".join(f"{label} {score:.2f}" for label, score, _ in detections) or "nothing"
    line = f"{posture:<34} | {' '.join(verdicts) if verdicts else '-':<28} | sees: {seen}"
    if violations:
        line += f"   ** violation: {', '.join(violations)} **"
    return line


def open_camera(name: str, index, width: int, height: int):
    if index is None:
        # cv2 indices follow avfoundation ordering, so reuse that listing.
        from monitor_arduino import resolve_camera
        index = resolve_camera(name)
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened():
        raise SystemExit(f"could not open camera index {index}")
    return cap, index


def draw_overlay(frame, keypoints, metric, blocker, calibration, reading, violations, fps):
    h, w = frame.shape[:2]
    conf_of = lambda i: float(keypoints[i][2])

    for i, j in EDGES:
        if conf_of(i) >= infer.POSE_CONF_THRESHOLD and conf_of(j) >= infer.POSE_CONF_THRESHOLD:
            y1, x1, _ = keypoints[i]
            y2, x2, _ = keypoints[j]
            cv2.line(frame, (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h)), (255, 200, 0), 2)

    for i, (y, x, conf) in enumerate(keypoints):
        # green = usable, red = below the confidence threshold that makes a
        # frame unreadable
        color = (0, 220, 0) if conf >= infer.POSE_CONF_THRESHOLD else (0, 0, 220)
        cv2.circle(frame, (int(x * w), int(y * h)), 4, color, -1)

    # The three keypoints posture actually depends on.
    lines = []
    for idx in (infer.NOSE, infer.LEFT_SHOULDER, infer.RIGHT_SHOULDER):
        conf = conf_of(idx)
        mark = "OK " if conf >= infer.POSE_CONF_THRESHOLD else "LOW"
        lines.append(f"{mark} {KEYPOINT_NAMES[idx]:<15} {conf:.2f}")

    baseline = calibration.get("baseline")
    if metric is None:
        lines.append(f"head_height  -- ({blocker})")
    else:
        lines.append(f"head_height  {metric:.3f}")
    if baseline is None:
        lines.append("baseline     not calibrated (press c)")
    else:
        lines.append(f"baseline     {baseline:.3f}  (slouch if drop > {infer.SLOUCH_DROP_THRESHOLD})")
        if metric is not None:
            lines.append(f"drop         {baseline - metric:+.3f}")

    y0 = 22
    for i, text in enumerate(lines):
        cv2.putText(frame, text, (10, y0 + i * 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, text, (10, y0 + i * 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1)

    if metric is None:
        status, color = "posture ?", (0, 165, 255)
    elif reading["slouching"]:
        status, color = "POSTURE DOWN", (0, 0, 255)
    else:
        status, color = "posture up", (0, 200, 0)
    extra = []
    if reading["doomscrolling"]:
        extra.append("phone in frame")
    if reading["drinkingWater"]:
        extra.append("waterbottle in frame")
    if extra:
        status += " | " + " | ".join(extra)
    cv2.putText(frame, status, (10, h - 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
    cv2.putText(frame, status, (10, h - 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

    footer = f"{fps:.1f} fps   q/Esc quit   c recalibrate"
    if violations:
        footer = f"VIOLATION: {', '.join(violations)}   " + footer
    cv2.putText(frame, footer, (10, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
    cv2.putText(frame, footer, (10, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=str, default="C920", help="camera name fragment")
    parser.add_argument("--camera-index", type=int, help="raw camera index instead of name")
    parser.add_argument("--video-size", type=str, default="1280x720")
    parser.add_argument("--dry-run", action="store_true", help="don't POST violations to the backend")
    parser.add_argument("--no-calibrate", action="store_true", help="reuse the stored baseline")
    args = parser.parse_args()

    load_env(ROOT / ".env")
    api_base = os.environ.get("API_BASE", "http://localhost:3001")
    robot_key = os.environ.get("ROBOT_KEY")

    width, height = (int(v) for v in args.video_size.split("x"))
    cap, index = open_camera(args.camera, args.camera_index, width, height)
    print(f"camera index {index}")

    print("loading models...")
    interpreters = {
        "pose": infer.load_interpreter(MODELS_DIR / "movenet_lightning.tflite"),
        "detect": infer.load_interpreter(MODELS_DIR / "efficientdet_lite0.tflite"),
        "classify": infer.load_interpreter(MODELS_DIR / "classifier_int8.tflite"),
    }
    labels = infer.load_labels(MODELS_DIR / "coco_labelmap.txt")
    tracker = infer.ViolationTracker(infer.VIOLATION_DURATION_SEC)
    calibration = infer.PostureCalibration(CALIBRATION_PATH)
    if not args.no_calibrate:
        calibration.reset()

    calibrating = not args.no_calibrate
    if calibrating:
        print(f"calibrating for {infer.CALIBRATION_SECONDS:.0f}s -- sit how you want to sit")

    fps, last = 0.0, time.time()
    try:
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                print("camera read failed", file=sys.stderr)
                break
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

            _, keypoints, _ = infer.run_pose(interpreters["pose"], frame_rgb)
            metric, blocker = infer.head_height(keypoints)

            # Object detection runs every frame, including during
            # calibration -- phone/bottle don't depend on the posture
            # baseline, and seeing them while calibrating is useful.
            _, (boxes, classes, scores), _ = infer.run_detect(interpreters["detect"], frame_rgb)
            detections = infer.decode_detections(boxes, classes, scores, labels, frame_bgr.shape)
            states = infer.check_proximity_states(detections)

            violations = []
            if calibrating:
                status = calibration.add_sample(metric, time.time())
                if status["calibrated"]:
                    calibrating = False
                    print(f"calibrated: baseline = {status['baseline']}")
                reading = {k: False for k in infer.VIOLATION_DURATION_SEC}
            else:
                is_slouching, _ = calibration.check_slouching(metric)
                reading = {
                    "doomscrolling": "on phone" in states,
                    "slouching": bool(is_slouching),
                    "sleeping": False,
                    "drinkingWater": "drinking" in states,
                }
                violations = tracker.update(reading, time.time())
                if violations and not args.dry_run and robot_key:
                    try:
                        push_violations(api_base, robot_key, violations)
                    except Exception as error:  # noqa: BLE001 - never kill the view
                        print(f"push failed: {error}", file=sys.stderr)

            print(format_console_line(metric, blocker, reading, states, detections, violations, calibrating),
                  flush=True)

            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - last, 1e-6))
            last = now

            frame_bgr = draw_detections(frame_bgr, detections)
            frame_bgr = draw_overlay(
                frame_bgr, keypoints, metric, blocker, calibration.status(time.time()),
                reading, violations, fps,
            )
            if calibrating:
                s = calibration.status(time.time())
                msg = f"CALIBRATING {s['seconds_elapsed']:.1f}/{s['seconds_needed']:.0f}s  ({s['samples_collected']} samples)"
                cv2.putText(frame_bgr, msg, (10, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
                cv2.putText(frame_bgr, msg, (10, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

            cv2.imshow("owlert local pipeline", frame_bgr)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("c"):
                calibration.reset()
                calibrating = True
                print("recalibrating...")
    finally:
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
