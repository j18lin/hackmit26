"""
On-device inference benchmark for the Arduino Uno Q (Linux/QRB2210 side).

Grabs frames from a USB webcam and runs both TFLite models we use elsewhere
in this project -- MoveNet Lightning (pose) and EfficientDet-Lite0 (object
detection) -- logging per-frame inference time for each, plus a raw summary
of what each model actually detected. Purpose is just to answer "can this
board run these models fast enough," not to do anything with the output.

Usage (run on the device, after scp-ing this folder + the two model files
into ./models -- see DEVICE.md):
    python3 bench_inference.py
    python3 bench_inference.py --frames 50
"""

import argparse
import statistics
import time
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODELS_DIR = Path(__file__).resolve().parent / "models"
LOG_PATH = Path(__file__).resolve().parent / "bench_log.txt"

POSE_MODEL_PATH = MODELS_DIR / "movenet_lightning.tflite"
POSE_INPUT_SIZE = 192

DETECT_MODEL_PATH = MODELS_DIR / "efficientdet_lite0.tflite"
DETECT_INPUT_SIZE = 320


def load_interpreter(model_path):
    interpreter = Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    return interpreter


def run_pose(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (POSE_INPUT_SIZE, POSE_INPUT_SIZE))
    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    start = time.perf_counter()
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()
    keypoints = interpreter.get_tensor(output_details[0]["index"])
    elapsed_ms = (time.perf_counter() - start) * 1000

    num_confident = int((keypoints[0, 0, :, 2] > 0.3).sum())
    return elapsed_ms, f"{num_confident}/17 keypoints above 0.3 conf"


def run_detect(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (DETECT_INPUT_SIZE, DETECT_INPUT_SIZE))
    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    start = time.perf_counter()
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()
    scores = interpreter.get_tensor(output_details[2]["index"])[0]
    count = int(interpreter.get_tensor(output_details[3]["index"])[0])
    elapsed_ms = (time.perf_counter() - start) * 1000

    num_confident = int((scores[:count] > 0.5).sum())
    return elapsed_ms, f"{num_confident}/{count} detections above 0.5 conf"


def summarize(name, times_ms, log_lines):
    line = (
        f"{name}: n={len(times_ms)} "
        f"mean={statistics.mean(times_ms):.1f}ms "
        f"median={statistics.median(times_ms):.1f}ms "
        f"min={min(times_ms):.1f}ms max={max(times_ms):.1f}ms "
        f"-> ~{1000 / statistics.mean(times_ms):.1f} fps"
    )
    print(line)
    log_lines.append(line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=int, default=30, help="number of frames to benchmark")
    parser.add_argument("--camera", type=int, default=0, help="cv2.VideoCapture index")
    args = parser.parse_args()

    if not POSE_MODEL_PATH.exists() or not DETECT_MODEL_PATH.exists():
        raise FileNotFoundError(f"Expected models in {MODELS_DIR} -- see DEVICE.md for the scp command.")

    pose_interpreter = load_interpreter(POSE_MODEL_PATH)
    detect_interpreter = load_interpreter(DETECT_MODEL_PATH)

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open camera index {args.camera}")

    pose_times, detect_times = [], []
    log_lines = [f"=== bench run {time.strftime('%Y-%m-%d %H:%M:%S')} ({args.frames} frames) ==="]

    print(f"Running {args.frames} frames through MoveNet Lightning + EfficientDet-Lite0...")
    for i in range(args.frames):
        ok, frame = cap.read()
        if not ok:
            print(f"frame {i}: camera read failed, stopping early")
            break
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        pose_ms, pose_info = run_pose(pose_interpreter, frame_rgb)
        detect_ms, detect_info = run_detect(detect_interpreter, frame_rgb)
        pose_times.append(pose_ms)
        detect_times.append(detect_ms)

        line = f"frame {i:03d}: pose={pose_ms:.1f}ms ({pose_info})  detect={detect_ms:.1f}ms ({detect_info})"
        print(line)
        log_lines.append(line)

    cap.release()

    print()
    log_lines.append("")
    if pose_times:
        summarize("MoveNet Lightning (pose)", pose_times, log_lines)
    if detect_times:
        summarize("EfficientDet-Lite0 (detect)", detect_times, log_lines)
    if pose_times and detect_times:
        combined = [p + d for p, d in zip(pose_times, detect_times)]
        summarize("Combined (both models, sequential)", combined, log_lines)

    with open(LOG_PATH, "a") as f:
        f.write("\n".join(log_lines) + "\n\n")
    print(f"\nLog appended to {LOG_PATH}")


if __name__ == "__main__":
    main()
