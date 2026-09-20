# Arduino Uno Q — device access

SSH into the board's Linux side (Qualcomm QRB2210) for deploying/running the
CV inference server.

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

## TCP inference server (systemd service)

`bench/tcp_infer_server.py` runs all three models (see `MODELS.md`) plus
the posture/proximity heuristics entirely on-device, and returns the
computed Nudge sensor reading as JSON over a small length-prefixed TCP
protocol. It runs as a systemd service so it survives reboots/crashes.

One-time install:
```sh
scp -r bench models arduino@10.31.181.91:~/bench_tmp/ && \
  ssh arduino@10.31.181.91 "mkdir -p ~/bench/models && \
    cp ~/bench_tmp/bench/*.py ~/bench/ && \
    cp ~/bench_tmp/models/* ~/bench/models/ && \
    rm -rf ~/bench_tmp"
scp bench/tcp-infer.service arduino@10.31.181.91:/tmp/tcp-infer.service
ssh arduino@10.31.181.91
sudo cp /tmp/tcp-infer.service /etc/systemd/system/tcp-infer.service
sudo systemctl daemon-reload
sudo systemctl enable --now tcp-infer.service
```

Deps on the device (Debian 13 / externally-managed Python, hence
`--break-system-packages`):
```sh
sudo apt-get install -y python3-pip python3-opencv python3-numpy
python3 -m pip install --break-system-packages ai_edge_litert
```

Check status / logs:
```sh
systemctl status tcp-infer.service
sudo journalctl -u tcp-infer.service -f
```

It listens on `0.0.0.0:5005`, accepts one JPEG per TCP connection (see the
wire protocol docstring in `tcp_infer_server.py`), and returns a JSON
result including the computed sensor reading and per-model timing.

## Running the pipeline from the Mac

`phone_detection/monitor_arduino.py` sends a photo to the Arduino, gets the
inference result back, and POSTs the reading to the dashboard backend:

```sh
python3 phone_detection/monitor_arduino.py \
  --arduino-host 10.31.181.91 \
  --image mac_webcam.jpg
```

Add `--dry-run` to skip the POST and just print the reading + timing.
`bench/tcp_infer_client.py` is a lighter debug-only client that just prints
round-trip timing without touching the dashboard.
