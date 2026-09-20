"""
On-device inference benchmark for the Edge Impulse transfer-learning
classifier (int8 TFLite), on the Arduino Uno Q (Linux/QRB2210 side).

The model (see ../MODELS.md and ../new-models/) is fully int8: both the
input and output tensors are INT8 with their own quantization params, so
this script quantizes the input image itself and dequantizes the output
logits rather than letting the interpreter do float conversion. 96x96x3
input, 3-class softmax output. Class names aren't embedded in the .lite
file or known yet -- output is reported as class indices until labels are
confirmed against the Edge Impulse project.

Camera capture on this board is currently blocked (see MODELS.md ->
"Target hardware"), so this defaults to running against a static test
image rather than a live webcam, unlike bench_inference.py.

Usage (after scp-ing this folder + the model into ./models -- see
DEVICE.md):
    python3 bench_classify.py --image test_frame.jpg
    python3 bench_classify.py --camera 0 --frames 30
"""

import argparse
import statistics
import time
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODELS_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODELS_DIR / "classifier_int8.tflite"
INPUT_SIZE = 96


def load_interpreter(model_path):
    interpreter = Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    return interpreter


def run_classify(interpreter, frame_rgb):
    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()[0]

    in_scale, in_zero_point = input_details["quantization"]
    out_scale, out_zero_point = output_details["quantization"]

    img = cv2.resize(frame_rgb, (INPUT_SIZE, INPUT_SIZE)).astype(np.float32) / 255.0
    quantized = np.round(img / in_scale + in_zero_point).astype(np.int8)
    input_data = np.expand_dims(quantized, axis=0)

    start = time.perf_counter()
    interpreter.set_tensor(input_details["index"], input_data)
    interpreter.invoke()
    raw_output = interpreter.get_tensor(output_details["index"])[0]
    elapsed_ms = (time.perf_counter() - start) * 1000

    scores = (raw_output.astype(np.float32) - out_zero_point) * out_scale
    top_class = int(np.argmax(scores))
    return elapsed_ms, top_class, scores


def summarize(name, times_ms):
    print(
        f"{name}: n={len(times_ms)} "
        f"mean={statistics.mean(times_ms):.1f}ms "
        f"median={statistics.median(times_ms):.1f}ms "
        f"min={min(times_ms):.1f}ms max={max(times_ms):.1f}ms "
        f"-> ~{1000 / statistics.mean(times_ms):.1f} fps"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=str, default=None, help="path to a static test image")
    parser.add_argument("--camera", type=int, default=None, help="cv2.VideoCapture index (overrides --image)")
    parser.add_argument("--frames", type=int, default=30, help="number of frames when using --camera")
    args = parser.parse_args()

    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Expected model at {MODEL_PATH} -- see DEVICE.md for the scp command.")

    interpreter = load_interpreter(MODEL_PATH)
    times_ms = []

    if args.camera is not None:
        cap = cv2.VideoCapture(args.camera)
        if not cap.isOpened():
            raise RuntimeError(f"Could not open camera index {args.camera}")
        for i in range(args.frames):
            ok, frame = cap.read()
            if not ok:
                print(f"frame {i}: camera read failed, stopping early")
                break
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            ms, top_class, scores = run_classify(interpreter, frame_rgb)
            times_ms.append(ms)
            print(f"frame {i:03d}: {ms:.1f}ms  class={top_class}  scores={np.round(scores, 3)}")
        cap.release()
    else:
        image_path = args.image or str(Path(__file__).resolve().parent.parent / "test_frame.jpg")
        frame_bgr = cv2.imread(image_path)
        if frame_bgr is None:
            raise FileNotFoundError(f"Could not read image at {image_path}")
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        # Run a few times to get a stable timing read on a single static image.
        for i in range(10):
            ms, top_class, scores = run_classify(interpreter, frame_rgb)
            times_ms.append(ms)
        print(f"image={image_path}  class={top_class}  scores={np.round(scores, 3)}")

    print()
    if times_ms:
        summarize("Classifier (int8)", times_ms)


if __name__ == "__main__":
    main()
