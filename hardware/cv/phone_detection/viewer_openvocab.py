"""
Open-vocabulary detection viewer, running entirely on this machine.

Unlike viewer_arduino.py (which shows what the Uno Q's fixed 90-class
EfficientDet sees), this uses YOLO-World locally: you give it arbitrary text
prompts -- "water bottle", "airpods case", "coffee mug" -- and it finds them
without retraining. Useful for figuring out what wording actually detects an
object before committing to it, since COCO's fixed labels can't describe
most things.

Nothing here touches the Arduino. ~41ms/frame warm on Apple Silicon (Metal),
against ~257ms for EfficientDet on the board.

Needs the venv:
    .venv/bin/pip install ultralytics opencv-python

Usage:
    .venv/bin/python phone_detection/viewer_openvocab.py
    .venv/bin/python phone_detection/viewer_openvocab.py --prompts "water bottle,phone,laptop"
    .venv/bin/python phone_detection/viewer_openvocab.py --camera "MacBook" --conf 0.05
Press q or Esc to quit, s to save the annotated frame.
"""

import argparse
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from monitor_arduino import resolve_camera  # noqa: E402

# Deliberately plain descriptions: YOLO-World matches on CLIP text
# embeddings, so everyday wording beats jargon.
DEFAULT_PROMPTS = "water bottle,cell phone,person,coffee mug,laptop"

PALETTE = [
    (0, 255, 255), (255, 0, 255), (255, 170, 0),
    (0, 220, 120), (200, 120, 255), (120, 200, 255),
]


def draw(frame, boxes, names, conf_floor):
    for b in sorted(boxes, key=lambda b: float(b.conf)):
        score = float(b.conf)
        label = names[int(b.cls)]
        x1, y1, x2, y2 = (int(v) for v in b.xyxy[0])
        strong = score >= conf_floor
        color = PALETTE[int(b.cls) % len(PALETTE)]
        if not strong:
            color = tuple(int(c * 0.45) for c in color)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2 if strong else 1)
        tag = f"{label} {score:.2f}"
        ty = max(y1 - 6, 14)
        cv2.putText(frame, tag, (x1, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
        cv2.putText(frame, tag, (x1, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1)
    return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompts", type=str, default=DEFAULT_PROMPTS,
                        help="comma-separated things to look for")
    parser.add_argument("--camera", type=str, default="C920", help="camera name fragment")
    parser.add_argument("--camera-index", type=int, help="raw index instead of name")
    parser.add_argument("--model", type=str, default="yolov8s-worldv2.pt")
    parser.add_argument("--conf", type=float, default=0.05,
                        help="report anything above this")
    parser.add_argument("--decide", type=float, default=0.25,
                        help="drawn solid at or above this; dimmed below it")
    parser.add_argument("--video-size", type=str, default="1280x720")
    args = parser.parse_args()

    from ultralytics import YOLO  # imported late: pulls in torch

    prompts = [p.strip() for p in args.prompts.split(",") if p.strip()]
    print(f"looking for: {', '.join(prompts)}")
    model = YOLO(args.model)
    model.set_classes(prompts)

    index = args.camera_index if args.camera_index is not None else resolve_camera(args.camera)
    width, height = (int(v) for v in args.video_size.split("x"))
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened():
        raise SystemExit(f"could not open camera index {index}")

    fps, last = 0.0, time.time()
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("camera read failed", file=sys.stderr)
                break

            result = model.predict(frame, verbose=False, conf=args.conf)[0]
            frame = draw(frame, result.boxes, result.names, args.decide)

            now = time.time()
            fps = 0.8 * fps + 0.2 * (1.0 / max(now - last, 1e-6))
            last = now

            seen = ", ".join(
                f"{result.names[int(b.cls)]} {float(b.conf):.2f}" for b in result.boxes
            ) or "nothing"
            header = f"{fps:4.1f} fps   {seen}"
            cv2.putText(frame, header, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
            cv2.putText(frame, header, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (240, 240, 240), 1)
            cv2.putText(frame, "open vocab: " + ", ".join(prompts),
                        (10, frame.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(frame, "open vocab: " + ", ".join(prompts),
                        (10, frame.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (190, 190, 190), 1)

            cv2.imshow("open-vocabulary detector (local)", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("s"):
                path = f"/tmp/nudge_frames/openvocab_{int(time.time())}.jpg"
                cv2.imwrite(path, frame)
                print(f"saved {path}")
    finally:
        cap.release()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
