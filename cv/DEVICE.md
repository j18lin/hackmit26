# Arduino Uno Q — device access

SSH into the board's Linux side (Qualcomm QRB2210) for deploying/testing CV
models locally on-device.

```
Host: 10.31.181.91
User: arduino
Pass: hackmit26
```

```sh
ssh arduino@10.31.181.91
```

Note: this is a plaintext password checked into the repo — fine for a
hackathon device on a local/venue network, but don't reuse this password
elsewhere and reconsider before pushing this repo somewhere public.

## Inference benchmark

`bench/bench_inference.py` runs the two TFLite models we use
(`movenet_lightning.tflite` for pose, `efficientdet_lite0.tflite` for object
detection) against USB webcam frames and logs per-model inference time, to
sanity-check whether the board's CPU/GPU can keep up in real time.

Deploy + run:
```sh
scp -r bench arduino@10.31.181.91:~/bench
scp models/movenet_lightning.tflite models/efficientdet_lite0.tflite arduino@10.31.181.91:~/bench/models/
ssh arduino@10.31.181.91
cd ~/bench && python3 bench_inference.py
```

## TCP inference server (systemd service)

`bench/tcp_infer_server.py` runs as a systemd service on the device so it
survives reboots/crashes without needing to be manually re-ssh'd and
restarted (the board reboots somewhat often during dev). Unit file:
`bench/tcp-infer.service`.

Install (one-time, after models + labelmap are already in `~/bench/models`
— see the classifier section below and DEVICE.md's earlier scp commands):
```sh
scp bench/tcp_infer_server.py bench/tcp_infer_client.py arduino@10.31.181.91:~/bench/
scp bench/tcp-infer.service arduino@10.31.181.91:/tmp/tcp-infer.service
ssh arduino@10.31.181.91
sudo cp /tmp/tcp-infer.service /etc/systemd/system/tcp-infer.service
sudo systemctl daemon-reload
sudo systemctl enable --now tcp-infer.service
```

Check status / logs:
```sh
systemctl status tcp-infer.service
sudo journalctl -u tcp-infer.service -f
```

It listens on `0.0.0.0:5005`, accepts one JPEG per TCP connection (see the
wire protocol docstring in `tcp_infer_server.py`), runs MoveNet Lightning +
EfficientDet-Lite0 + the int8 classifier, computes the Nudge sensor-reading
booleans on-device, and returns them as JSON. `phone_detection/monitor_arduino.py`
(run from the Mac) is the client that sends a frame and POSTs the result to
the dashboard's `/api/robot/sensors`.

## Edge Impulse transfer-learning classifier (int8)

`bench/bench_classify.py` runs the int8-quantized transfer-learning
classifier from `new-models/` (see `MODELS.md`) against a static test image
(camera is currently blocked — see "Target hardware" in `MODELS.md`), doing
manual int8 quantize-in/dequantize-out since the model's input and output
tensors are both `INT8`.

Deploy + run:
```sh
scp -r bench arduino@10.31.181.91:~/bench
scp new-models/ei-daniellonedgeimpulse-project-1-transfer-learning-tensorflow-lite-int8-quantized-model.35.lite \
    arduino@10.31.181.91:~/bench/models/classifier_int8.tflite
scp test_frame.jpg arduino@10.31.181.91:~/bench/
ssh arduino@10.31.181.91
cd ~/bench && python3 bench_classify.py --image test_frame.jpg
```
