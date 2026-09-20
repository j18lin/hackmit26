# Models used in this project

Three TFLite models, all running on-device on the Arduino Uno Q via
`bench/tcp_infer_server.py`. No CV inference runs off-device anymore.

## MoveNet Lightning (int8 TFLite) — posture

- **File:** `models/movenet_lightning.tflite` (single-pose, 192x192 input, ~2.9MB)
- **Output:** 17 COCO keypoints, `[1, 1, 17, 3]` (y, x, confidence).
- **Heuristic:** forward-head / slouch check — normalized ear-vs-shoulder
  x-offset (`check_slouching` in `tcp_infer_server.py`). Threshold
  (`FORWARD_HEAD_THRESHOLD = 0.35`) is still a rough guess, not tuned.
- **On-device latency:** ~85ms/frame.

## EfficientDet-Lite0 (int8 TFLite) — phone / drink proximity

- **File:** `models/efficientdet_lite0.tflite` (320x320 input, ~4.5MB, from
  Kaggle Models / TF Hub's `tensorflow/efficientdet/tfLite/lite0-detection-metadata`)
- **What it does:** COCO object detection -> proximity heuristic
  (`check_proximity_states` in `tcp_infer_server.py`). If a "cell phone" or
  "bottle" box center is close enough to a "person" box (normalized by
  person bbox diagonal), flags `doomscrolling` / `drinkingWater`.
- **On-device latency:** ~267ms/frame (the slow one).

## Edge Impulse transfer-learning classifier (int8 TFLite)

- **File:** `models/classifier_int8.tflite` (631KB), export of an Edge
  Impulse "project-1" transfer-learning model, version 35.
- **Architecture (from parsing the flatbuffer, no labels/metadata embedded):**
  MobileNet-style classifier — 176 tensors, 66 ops, all `CONV_2D` /
  `DEPTHWISE_CONV_2D` / `FULLY_CONNECTED` / `ADD` / `RESHAPE` / `SOFTMAX`.
  Input `[1, 96, 96, 3]`, output `[1, 3]` (3-class softmax).
- **Quantization:** fully int8 — both input and output tensors are `INT8`
  with their own scale/zero-point (input: scale `0.00392`, zero point
  `-128`; output: scale `0.00391`, zero point `-128`). All ops used support
  int8 kernels, so this is true full-integer inference.
- **Status:** classes aren't labeled anywhere in the file — output is
  reported (`classify_ms`, `classify_info` in the server's JSON response)
  but not yet wired into the sensor reading. Need the label list from the
  Edge Impulse project before it's meaningful beyond a class index.
- **On-device latency:** ~5ms/frame (tiny, by far the fastest of the three).

## Sensor API integration

`phone_detection/monitor_arduino.py` (Mac side) sends a JPEG to the
Arduino's `tcp_infer_server.py`, which runs all three models and computes
`{doomscrolling, slouching, sleeping, drinkingWater, tempRaw}` on-device,
then the Mac script posts one `/api/robot/violations` call per field that
came back `true` — see `SENSOR_API.md` for the API contract.

`sleeping` is not implemented (always `False`). `tempRaw` is currently
unused by the violations API (kept in the on-device reading for now, no
real temp sensor wired up either).

## Target hardware

Arduino Uno Q (Qualcomm QRB2210, aarch64 Debian 13 Linux side). See
`DEVICE.md` for SSH access and running `tcp_infer_server.py` as a systemd
service.
