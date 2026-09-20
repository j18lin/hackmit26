"""
Standalone viewer for the full COCO vocabulary, run locally.

The Uno Q's server only reports person / cell phone / bottle, because those
are the only classes that map to a habit. This runs the same
EfficientDet-Lite0 model on this machine with no filtering, so you can see
every one of its 90 classes ranked by confidence -- useful for finding out
what label an object actually gets (is your bottle a `bottle`, a `cup`, or a
`vase`?) before deciding what to watch for.

Standalone on purpose: it does not touch the Arduino, and changes nothing
about what the board reports.

Needs the venv:
    .venv/bin/pip install ai-edge-litert opencv-python numpy

Usage:
    .venv/bin/python phone_detection/viewer_coco.py
    .venv/bin/python phone_detection/viewer_coco.py --camera "MacBook" --conf 0.1
    .venv/bin/python phone_detection/viewer_coco.py --image /tmp/shot.jpg
Press q or Esc to quit, s to save the annotated frame.
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from monitor_arduino import resolve_camera  # noqa: E402

MODEL = ROOT / "models" / "efficientdet_lite0.tflite"
LABELS = ROOT / "models" / "coco_labelmap.txt"
INPUT_SIZE = 320

# Colour per class index, so the same object keeps its colour frame to frame.
def colour(index):
    rng = (index * 67) % 180
    hsv = np.uint8([[[rng, 200, 255]]])
    b, g, r = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0][0]
    return int(b), int(g), int(r)


def detect(interpreter, labels, frame_bgr, conf):
    """Every class above `conf`, highest first. No label filtering at all."""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    img = cv2.resize(rgb, (INPUT_SIZE, INPUT_SIZE))
    inp = interpreter.get_input_details()
    out = interpreter.get_output_details()
    interpreter.set_tensor(inp[0]["index"], np.expand_dims(img, 0).astype(np.uint8))
    started = time.perf_counter()
    interpreter.invoke()
    elapsed = (time.perf_counter() - started) * 1000

    boxes = interpreter.get_tensor(out[0]["index"])[0]
    classes = interpreter.get_tensor(out[1]["index"])[0]
    scores = interpreter.get_tensor(out[2]["index"])[0]
    count = int(interpreter.get_tensor(out[3]["index"])[0])

    h, w = frame_bgr.shape[:2]
    found = []
    for i in range(count):
        if scores[i] < conf:
            continue
        index = int(classes[i]) + 1
        label = labels[index] if index < len(labels) else f"class{index}"
        ymin, xmin, ymax, xmax = boxes[i]
        found.append((label, float(scores[i]), int(index),
                      (xmin * w, ymin * h, xmax * w, ymax * h)))
    found.sort(key=lambda d: -d[1])
    return found, elapsed


def draw(frame, found):
    for label, score, index, (x1, y1, x2, y2) in reversed(found):
        c = colour(index)
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), c, 2)
        tag = f"{label} {score:.2f}"
        ty = max(int(y1) - 6, 14)
        cv2.putText(frame, tag, (int(x1), ty), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
        cv2.putText(frame, tag, (int(x1), ty), cv2.FONT_HERSHEY_SIMPLEX, 0.55, c, 1)

    # Ranked list, so low-confidence guesses are visible even when their box
    # is off-screen or overlapping.
    for i, (label, score, index, _) in enumerate(found[:8]):
        text = f"{score:.2f}  {label}"
        y = 52 + i * 20
        cv2.putText(frame, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour(index), 1)
    return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=str, default="C920", help="camera name fragment")
    parser.add_argument("--camera-index", type=int, help="raw index instead of name")
    parser.add_argument("--image", type=str, help="run once on a file instead of the camera")
    parser.add_argument("--conf", type=float, default=0.1, help="report anything above this")
    parser.add_argument("--video-size", type=str, default="1280x720")
    args = parser.parse_args()

    if not MODEL.exists():
        raise SystemExit(f"missing {MODEL}")
    interpreter = Interpreter(model_path=str(MODEL))
    interpreter.allocate_tensors()
    labels = [line.strip() for line in open(LABELS)]
    print(f"{len(labels)} COCO labels loaded, reporting everything above {args.conf}")

    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            raise SystemExit(f"could not read {args.image}")
        found, ms = detect(interpreter, labels, frame, args.conf)
        print(f"\n{args.image}  ({ms:.0f}ms)")
        for label, score, index, _ in found:
            print(f"  {score:.2f}  {label}  (class {index})")
        if not found:
            print("  nothing above the threshold")
        return 0

    index = args.camera_index if args.camera_index is not None else resolve_camera(args.camera)
    width, height = (int(v) for v in args.video_size.split("x"))
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened():
        raise SystemExit(f"could not open camera index {index}")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("camera read failed", file=sys.stderr)
                break
            found, ms = detect(interpreter, labels, frame, args.conf)
            frame = draw(frame, found)
            head = f"{ms:.0f}ms   {len(found)} detections above {args.conf}"
            cv2.putText(frame, head, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
            cv2.putText(frame, head, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (240, 240, 240), 1)
            cv2.imshow("all COCO classes (local)", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("s"):
                path = f"/tmp/nudge_frames/coco_{int(time.time())}.jpg"
                cv2.imwrite(path, frame)
                print(f"saved {path}")
    finally:
        cap.release()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
