"""
Live viewer for what the Arduino's detector actually sees.

Sends webcam frames to the Uno Q (same TCP protocol and same server as
monitor_arduino.py -- no inference happens here) and draws the boxes it
sends back, labelled with their COCO class and confidence. Built to answer
"what does this object get classified as", e.g. whether a water bottle reads
as `bottle`, `cup`, `vase` or nothing at all.

Everything at or above the server's report threshold (0.15) is drawn, not
just the classes that can trigger a verdict, so weak guesses are visible
too. Boxes that are strong enough to count are drawn solid; weak ones that
are reported-but-ignored are drawn dashed-thin and dimmed.

Needs the venv for OpenCV:
    python3.12 -m venv .venv && .venv/bin/pip install opencv-python numpy requests

Usage:
    .venv/bin/python phone_detection/viewer_arduino.py --arduino-host 10.31.181.91
    .venv/bin/python phone_detection/viewer_arduino.py --arduino-host 10.31.181.91 --camera "MacBook"
Press q or Esc to quit, s to save the current frame.
"""

import argparse
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from monitor_arduino import (  # noqa: E402
    MODE_INFER,
    resolve_camera,
    run_inference_on_arduino,
)

# Only detections at/above this count toward a verdict server-side; below it
# they're reported for visibility only. Keep in sync with SCORE_THRESHOLD in
# bench/tcp_infer_server.py.
DECISION_THRESHOLD = 0.4

COLORS = {
    "person": (255, 170, 0),
    "cell phone": (255, 0, 255),
    "bottle": (0, 255, 255),
    "cup": (0, 200, 255),
}
DEFAULT_COLOR = (170, 170, 170)


def draw_detections(frame, detections):
    h, w = frame.shape[:2]
    # Weakest first, so the strong boxes end up drawn on top.
    for label, score, box in sorted(detections, key=lambda d: d[1]):
        x1, y1, x2, y2 = (
            int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h),
        )
        counts = score >= DECISION_THRESHOLD
        color = COLORS.get(label, DEFAULT_COLOR)
        if not counts:
            color = tuple(int(c * 0.45) for c in color)

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2 if counts else 1)
        tag = f"{label} {score:.2f}" + ("" if counts else " (ignored)")
        ty = max(y1 - 6, 14)
        cv2.putText(frame, tag, (x1, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, tag, (x1, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
    return frame


def draw_status(frame, result, fps):
    h = frame.shape[0]
    reading = result.get("reading", {})
    lines = [
        f"phone:  {'YES' if reading.get('doomscrolling') else 'no'}",
        f"bottle: {'YES' if reading.get('drinkingWater') else 'no'}",
    ]
    if result.get("head_height") is None:
        lines.append(f"posture: ? ({result.get('posture_blocker')})")
    else:
        lines.append(f"posture: {'DOWN' if reading.get('slouching') else 'up'}")

    # The classifier still runs alongside; showing it makes the two directly
    # comparable on the same frame.
    scores = result.get("class_scores")
    if scores:
        lines.append(f"classifier: {result.get('class_label')} {result.get('class_confidence', 0):.2f}")

    for i, text in enumerate(lines):
        y = 26 + i * 22
        cv2.putText(frame, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
        cv2.putText(frame, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (240, 240, 240), 1)

    footer = f"{fps:.1f} fps   q quit   s save frame"
    cv2.putText(frame, footer, (10, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
    cv2.putText(frame, footer, (10, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arduino-host", type=str, required=True)
    parser.add_argument("--arduino-port", type=int, default=5005)
    parser.add_argument("--camera", type=str, default="C920", help="camera name fragment")
    parser.add_argument("--camera-index", type=int, help="raw index instead of name")
    parser.add_argument("--video-size", type=str, default="1280x720")
    args = parser.parse_args()

    index = args.camera_index if args.camera_index is not None else resolve_camera(args.camera)
    width, height = (int(v) for v in args.video_size.split("x"))
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened():
        raise SystemExit(f"could not open camera index {index}")
    print(f"camera index {index} -> {args.arduino_host}:{args.arduino_port}")

    fps, last, result = 0.0, time.time(), {}
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("camera read failed", file=sys.stderr)
                break

            ok_jpeg, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ok_jpeg:
                try:
                    result = run_inference_on_arduino(
                        args.arduino_host, args.arduino_port, buffer.tobytes(), MODE_INFER
                    )
                    now = time.time()
                    fps = 0.8 * fps + 0.2 * (1.0 / max(now - last, 1e-6))
                    last = now
                except OSError as error:
                    # The board reboots often; keep the window responsive.
                    print(f"(lost connection: {error})", file=sys.stderr)
                    time.sleep(0.5)

            frame = draw_detections(frame, result.get("detections", []))
            frame = draw_status(frame, result, fps)
            cv2.imshow("arduino detector view", frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("s"):
                path = f"/tmp/nudge_frames/view_{int(time.time())}.jpg"
                cv2.imwrite(path, frame)
                print(f"saved {path}")
    finally:
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
