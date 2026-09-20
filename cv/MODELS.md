# Models used in this project

Summary of every CV model evaluated/used so far, why, and where the code
lives. Written as a handoff reference — see linked files for actual
implementation detail.

## Currently in use

### Posture: MoveNet Lightning (int8 TFLite)
- **File:** `models/movenet_lightning.tflite` (single-pose, 192x192 input, ~2.9MB)
- **Used in:** `posture_check.py` (standalone dev/tuning script)
- **What it does:** 17 COCO keypoints. Heuristic checks a normalized ear-vs-shoulder
  x-offset ("forward head") — thresholds are still rough guesses, not tuned.
- **Why this model:** cheap, single-pose, designed for low-latency edge inference.
- **Status:** heuristic is finicky / needs more tuning. See "Posture: MediaPipe Pose"
  below for the approach that's currently preferred instead.

### Posture: MediaPipe Pose (`mp.solutions.pose`)
- **Used in:** `phone_detection/monitor.py` (`SlouchDetector` class), ported from
  `candidates/slouch-detector/slouch_detector.py`
- **What it does:** calibrates a baseline nose-to-shoulder-midpoint vertical
  distance over the first few frames, then flags slouching when that distance
  grows past `slouch_threshold` (currently `0.04`, lowered from the original
  repo's `0.08` for more sensitivity).
- **Why this model over MoveNet:** subjectively judged "pretty good" after
  side-by-side testing of cloned candidate repos (see below).
- **IMPORTANT version pin:** `mediapipe==0.10.14` in `requirements.txt`.
  mediapipe 1.0+ removed the legacy `mp.solutions` API entirely (replaced by
  `mp.tasks`) — installing latest will break this with
  `AttributeError: module 'mediapipe' has no attribute 'solutions'`.
- **Status:** keeps a live debug window (skeleton + slouch status) since this
  heuristic is still being tuned. Calibration takes `calibration_frames` polls
  (5 by default in `monitor.py`, at 1Hz that's ~5s).

### Phone / drink proximity: EfficientDet-Lite0 (int8 TFLite)
- **File:** `models/efficientdet_lite0.tflite` (320x320 input, ~4.5MB, from
  Kaggle Models / TF Hub's `tensorflow/efficientdet/tfLite/lite0-detection-metadata`)
- **Used in:** `phone_detection/phone_proximity.py` (main/active file) and also
  inlined separately in `phone_detection/monitor.py` (see "known divergence" below)
- **What it does:** COCO object detection -> proximity heuristic. If a "cell
  phone" or "bottle" box center is close enough to a "person" box (normalized
  by person bbox diagonal), flags "on phone" / "drinking" respectively.
  Temporal smoothing (`StateSmoother`, majority vote over last 5 frames) added
  in `phone_proximity.py` to avoid one flickered frame flipping a state.
- **Why swapped from the original model:** started with quantized SSD MobileNet
  v1 (`models/coco_ssd_mobilenet_v1.tflite`, ~21 mAP on COCO) but it was
  **genuinely misclassifying objects** (e.g. confidently calling a water bottle
  a phone) — a real accuracy problem, not a thresholding one. EfficientDet-Lite0
  (~25.7 mAP) uses the same TF Object Detection API export format (boxes/
  classes/scores/count, same labelmap convention), so it was a drop-in swap
  other than input size (300->320) and max detections (10->25).
- **Status:** working, believed fixed; SCORE_THRESHOLD kept at 0.6 (raised from
  0.4 as a safety margin, originally to compensate for the old model).

### Sensor API integration
- `phone_detection/monitor.py` merges posture (MediaPipe) + phone/drink
  (EfficientDet) into one 1Hz polling loop and POSTs
  `{doomscrolling, slouching, sleeping, drinkingWater, tempRaw}` to the Nudge
  dashboard backend. See `SENSOR_API.md` for the API contract and
  `push_sensor_data.py` for the original random-data reference implementation
  this was based on.
- `sleeping` is not implemented (always `False`). `tempRaw` is a fixed
  placeholder (`2700`, no real temp sensor wired up).

## Known divergence to watch

`phone_detection/phone_proximity.py` is the file being actively edited/fixed
(e.g. the EfficientDet swap only happened there). `phone_detection/monitor.py`
has its own separate inlined copy of the same phone/drink detection logic and
was NOT updated when `phone_proximity.py` was fixed — it likely still
references the old SSD MobileNet v1 model. Reconcile before relying on
`monitor.py`'s phone-detection output.

## Candidates evaluated but not used directly

Cloned into `candidates/` for comparison (all still present as reference):

- **`candidates/slouch-detector`** (aaronhubhachen, MIT) — the MediaPipe Pose
  approach that won out; ported into `phone_detection/monitor.py`.
- **`candidates/posture-corrector-app`** (R40835, MIT) — Jetson Nano app,
  MoveNet + a small CNN classifier on keypoints instead of hand thresholds.
  Original code needs TensorRT/CUDA, a live Django backend for auth/photo
  upload, an NVIDIA CSI camera, and precompiled linux-aarch64-only C++/Cython
  extensions — none of that runs outside Jetson. Ported just the core
  angle-based neck-posture math (from reading the C++ source) into
  `candidates/posture-corrector-app/local_run/run_local.py`, pure Python,
  running on our own MoveNet pipeline. Not adopted as the main posture
  approach (MediaPipe won out instead) but kept as a working reference for a
  different heuristic (shoulder-angle-based instead of offset-based).
- **`candidates/webcam-pose-estimation`** (kleincode, Apache-2.0) — C++ MoveNet
  demo. Not built: requires Conan + Premake + Visual Studio 2022 (Windows-only
  toolchain), and its logic is functionally identical to what we already have
  in Python. Skipped rather than porting the build system.
- **`reference/posture-corrector`** (alwaysai, Apache-2.0) — not usable as-is:
  built entirely on `edgeiq`, alwaysAI's proprietary SDK requiring an account
  + their own CLI tooling, not just `pip install`. Its pure-Python posture
  math (`posture.py`) was read for ideas (per-condition messages, a single
  `scale` sensitivity knob) but not directly reused.

## Target hardware

Arduino Uno Q (Qualcomm QRB2210, aarch64 Debian 13 Linux side). See
`DEVICE.md` for SSH access and the inference benchmark script
(`bench/bench_inference.py`, tests MoveNet + EfficientDet-Lite0 inference
timing on-device). **Currently blocked**: USB camera not enumerating on the
device — under active debugging, looks like a `usb_vbus` regulator power-rail
issue (possibly hardware-defect-adjacent), not yet resolved as of this
writing. See git/conversation history for the full debugging trail if needed.
