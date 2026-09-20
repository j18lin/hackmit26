# Arduino Uno Q — device access

SSH into the board's Linux side (Qualcomm QRB2210) for deploying/testing CV
models locally on-device.

```
Host: 10.29.157.213
User: arduino
Pass: hackmit26
```

```sh
ssh arduino@10.29.157.213
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
scp -r bench arduino@10.29.157.213:~/bench
scp models/movenet_lightning.tflite models/efficientdet_lite0.tflite arduino@10.29.157.213:~/bench/models/
ssh arduino@10.29.157.213
cd ~/bench && python3 bench_inference.py
```
