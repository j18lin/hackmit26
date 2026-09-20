"""
Arduino-offloaded sensor loop for the Nudge dashboard.

Grabs/loads a frame, ships it over TCP to bench/tcp_infer_server.py running
on the Arduino Uno Q (MoveNet Lightning + EfficientDet-Lite0 + the int8 Edge
Impulse classifier, all running on-device). That server also decides
on-device whether a habit has actually been *violated* -- i.e. a field has
been continuously true for longer than its own duration threshold, tracked
in its ViolationTracker -- and returns a `violations` list of fields that
just crossed their threshold on this call. This script only POSTs those to
the backend's /api/robot/violations; it has no duration/threshold logic of
its own. No CV dependency (opencv, tflite, etc.) needed on the Mac side at
all -- just `requests`.

For now this runs a single shot against a static image (e.g. a photo taken
from the Mac's own webcam) rather than a continuous camera loop. The
server's duration tracking is wall-clock based, though, so running this
repeatedly (e.g. in a loop or cron) against the same long-lived server
still correctly measures continuous duration across calls.

Usage:
    python3 monitor_arduino.py --arduino-host 10.31.181.91 --image ../mac_webcam.jpg
    python3 monitor_arduino.py --arduino-host 10.31.181.91 --image ../mac_webcam.jpg --dry-run
"""

import argparse
import json
import os
import socket
import struct
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed before expected bytes arrived")
        buf.extend(chunk)
    return bytes(buf)


def run_inference_on_arduino(host: str, port: int, jpeg_bytes: bytes) -> dict:
    t0 = time.perf_counter()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.connect((host, port))
        t_connected = time.perf_counter()

        sock.sendall(struct.pack(">I", len(jpeg_bytes)))
        sock.sendall(jpeg_bytes)
        t_sent = time.perf_counter()

        (length,) = struct.unpack(">I", recv_exact(sock, 4))
        payload = recv_exact(sock, length)
        t_done = time.perf_counter()

    result = json.loads(payload.decode("utf-8"))
    result["_client_timing"] = {
        "connect_ms": round((t_connected - t0) * 1000, 2),
        "upload_ms": round((t_sent - t_connected) * 1000, 2),
        "wait_for_response_ms": round((t_done - t_sent) * 1000, 2),
        "round_trip_ms": round((t_done - t0) * 1000, 2),
    }
    return result


def push_violations(api_base: str, robot_key: str, violations: list[str]) -> list[dict]:
    """Posts one violation per field the Arduino's ViolationTracker just
    fired for on this call (see tcp_infer_server.py) -- the duration
    decision already happened on-device; this just relays it.
    """
    responses = []
    for field in violations:
        resp = requests.post(
            f"{api_base}/api/robot/violations",
            headers={"Authorization": f"Bearer {robot_key}"},
            json={"field": field},
            timeout=10,
        )
        resp.raise_for_status()
        responses.append({"field": field, **resp.json()})
    return responses


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arduino-host", type=str, required=True, help="Arduino Uno Q IP (see ../DEVICE.md)")
    parser.add_argument("--arduino-port", type=int, default=5005)
    parser.add_argument("--image", type=str, required=True, help="path to a JPEG to send")
    parser.add_argument("--dry-run", action="store_true", help="print the reading instead of POSTing it")
    args = parser.parse_args()

    load_env(ROOT / ".env")
    api_base = os.environ.get("API_BASE", "http://localhost:3001")
    robot_key = os.environ.get("ROBOT_KEY")
    if not args.dry_run and not robot_key:
        print("ROBOT_KEY is not set (see ../.env). Run with --dry-run to test without pushing.", file=sys.stderr)
        return 1

    image_path = Path(args.image)
    if not image_path.exists():
        print(f"Image not found: {image_path}", file=sys.stderr)
        return 1
    jpeg_bytes = image_path.read_bytes()

    print(f"Sending {image_path} ({len(jpeg_bytes)} bytes) to {args.arduino_host}:{args.arduino_port} for inference...")
    result = run_inference_on_arduino(args.arduino_host, args.arduino_port, jpeg_bytes)

    timing = result["_client_timing"]
    print(
        f"Round trip: {timing['round_trip_ms']}ms "
        f"(connect={timing['connect_ms']}ms upload={timing['upload_ms']}ms wait={timing['wait_for_response_ms']}ms)"
    )
    print(
        f"On-device: recv={result['server_recv_ms']}ms decode={result['decode_ms']}ms "
        f"pose={result['pose_ms']}ms detect={result['detect_ms']}ms classify={result['classify_ms']}ms "
        f"(server_total={result['server_total_ms']}ms)"
    )
    print(f"pose: {result['pose_info']} (forward_offset={result['forward_offset']})")
    print(f"detect: {result['detect_info']}")
    print(f"classify: {result['classify_info']}")

    reading = result["reading"]
    violations = result["violations"]
    print(f"reading: {reading}")
    print(f"violations (duration threshold crossed on-device): {violations}")

    if args.dry_run:
        print("(dry-run) not pushed to backend")
        return 0

    try:
        responses = push_violations(api_base, robot_key, violations)
        if responses:
            print(f"[{time.strftime('%H:%M:%S')}] pushed to {api_base}/api/robot/violations -> {responses}")
        else:
            print("no field crossed its violation duration threshold on this call; nothing to push")
    except requests.RequestException as error:
        print(f"push failed: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
