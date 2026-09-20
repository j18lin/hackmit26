"""
Arduino-offloaded sensor loop for the Nudge dashboard.

Grabs a frame (from the Mac webcam, or a file with --image), ships it over
TCP to bench/tcp_infer_server.py running on the Arduino Uno Q (MoveNet
Lightning + EfficientDet-Lite0 + the int8 Edge Impulse classifier, all
running on-device). That server also decides on-device whether a habit has
actually been *violated* -- i.e. a field has been continuously true for
longer than its own duration threshold, tracked in its ViolationTracker --
and returns a `violations` list of fields that just crossed their threshold
on this call. This script only POSTs those to the backend's
/api/robot/violations; it has no duration/threshold logic of its own. No CV
dependency (opencv, tflite, etc.) needed on the Mac side -- just `requests`
and ffmpeg for the webcam grab.

Output is one terse label line per frame, e.g.
    posture up
    posture down · phone in frame
    posture down · waterbottle in frame   ** violation: slouching **
Use --verbose for the full timing/inference breakdown instead.

Posture needs a one-time calibration first (--calibrate): slouch is judged
as a drop below *your* upright baseline, since the raw metric depends on
your camera angle, seating distance and build. The baseline lives on the
Arduino and survives reboots, so this is a once-per-setup thing.

Webcam capture uses ffmpeg's avfoundation input, so it's macOS-only; pass
--image to run against a file anywhere.

Usage:
    python3 monitor_arduino.py --arduino-host 10.31.181.91 --loop
    python3 monitor_arduino.py --arduino-host 10.31.181.91
    python3 monitor_arduino.py --arduino-host 10.31.181.91 --image ../mac_webcam.jpg --dry-run
"""

import argparse
import json
from collections import deque
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import warnings
from pathlib import Path

# Noisy on stock macOS python (LibreSSL), and it fires on every invocation.
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

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


MODE_INFER = b"I"
MODE_CALIBRATE = b"C"
MODE_RESET_CALIBRATION = b"R"

# Consecutive unreadable frames before --calibrate gives up with advice,
# rather than spinning forever at a camera pointed somewhere useless.
MAX_UNREADABLE_CALIBRATION_FRAMES = 25


def run_inference_on_arduino(host: str, port: int, jpeg_bytes: bytes, mode: bytes = MODE_INFER) -> dict:
    t0 = time.perf_counter()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.connect((host, port))
        t_connected = time.perf_counter()

        sock.sendall(mode)
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


def list_cameras() -> list[tuple[int, str]]:
    """avfoundation video devices as (index, name), in ffmpeg's own order."""
    proc = subprocess.run(
        ["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
        capture_output=True, text=True,
    )
    # ffmpeg prints the device list to stderr and then "exits with error"
    # because there's no real input -- that's expected, not a failure.
    video_section = proc.stderr.split("AVFoundation video devices:")[-1]
    video_section = video_section.split("AVFoundation audio devices:")[0]
    return [(int(i), name.strip()) for i, name in re.findall(r"\[(\d+)\] (.+)", video_section)]


def resolve_camera(name: str) -> int:
    """Maps a name fragment like 'C920' to its current avfoundation index.

    Indices shift whenever a camera is plugged in or removed (plugging in
    the C920 pushed the built-in camera from 0 to 1), so selecting by name
    is the stable way to keep pointing at the same physical camera.
    """
    cameras = list_cameras()
    matches = [(i, n) for i, n in cameras if name.lower() in n.lower()]
    if not matches:
        available = "\n".join(f"  [{i}] {n}" for i, n in cameras) or "  (none found)"
        raise SystemExit(f"No camera matching {name!r}. Available:\n{available}")
    if len(matches) > 1:
        options = ", ".join(f"[{i}] {n}" for i, n in matches)
        raise SystemExit(f"{name!r} is ambiguous, matches: {options}")
    return matches[0][0]


class WebcamStream:
    """Keeps one ffmpeg process open and streams MJPEG from the webcam.

    Spawning ffmpeg per frame costs 0.7-1.75s (process startup + camera
    open), which dwarfs the ~600ms of actual inference -- so the camera
    stays open and a reader thread keeps only the most recent complete
    frame. Reading the latest rather than queueing also means we never
    fall behind and start sending stale frames.
    """

    def __init__(self, camera_index: int, video_size: str = "640x480", fps: int = 30):
        self.proc = subprocess.Popen(
            [
                "ffmpeg", "-loglevel", "error",
                "-f", "avfoundation",
                "-framerate", str(fps),
                "-video_size", video_size,
                "-i", str(camera_index),
                "-f", "mjpeg",
                "pipe:1",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._latest = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        # Keep ffmpeg's own diagnostics: without them a failed open just
        # looks like "camera busy", when it's usually an unsupported
        # framerate/size combination and ffmpeg said so explicitly.
        self._errors = deque(maxlen=12)
        self._thread = threading.Thread(target=self._reader, daemon=True)
        self._thread.start()
        self._err_thread = threading.Thread(target=self._drain_errors, daemon=True)
        self._err_thread.start()

    def _drain_errors(self):
        for line in self.proc.stderr:
            text = line.decode("utf-8", "replace").rstrip()
            if text:
                self._errors.append(text)

    def _reader(self):
        buf = b""
        while not self._stop.is_set():
            chunk = self.proc.stdout.read(4096)
            if not chunk:
                break
            buf += chunk
            # JPEG frames are delimited by SOI (ffd8) .. EOI (ffd9).
            while True:
                start = buf.find(b"\xff\xd8")
                end = buf.find(b"\xff\xd9", start + 2)
                if start < 0 or end < 0:
                    break
                with self._lock:
                    self._latest = buf[start:end + 2]
                buf = buf[end + 2:]

    def read(self, timeout: float = 10.0) -> bytes:
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if self._latest is not None:
                    return self._latest
            if self.proc.poll() is not None:
                # Give the stderr drain a moment to catch up before reporting.
                time.sleep(0.2)
                detail = "\n  ".join(self._errors) or "no output from ffmpeg"
                raise RuntimeError(
                    "ffmpeg exited -- the camera may be in use, permission denied, "
                    f"or the requested format unsupported. ffmpeg said:\n  {detail}"
                )
            time.sleep(0.02)
        raise RuntimeError(f"no webcam frame within {timeout}s")

    def close(self):
        self._stop.set()
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def format_labels(result: dict) -> str:
    """One terse line: what the frame actually shows, plus any violation
    that just fired."""
    reading = result["reading"]

    # head_height is None when the nose/shoulders MoveNet needs weren't
    # confidently visible -- that's "don't know", not "sitting up straight".
    if not result["calibration"]["calibrated"]:
        labels = ["posture ? (not calibrated)"]
    elif result.get("head_height") is None and not result.get("posture_held"):
        labels = ["posture ?"]
    else:
        # "held" = this frame wasn't readable, so the last known posture is
        # being carried forward.
        suffix = " (held)" if result.get("posture_held") else ""
        labels = [("posture down" if reading["slouching"] else "posture up") + suffix]

    phone = "yes" if reading["doomscrolling"] else "no"
    bottle = "yes" if reading["drinkingWater"] else "no"
    line = f"{' · '.join(labels):<16} | phone: {phone:<4} | bottle: {bottle:<4}"

    # Hand-near-face. None means the wrists weren't visible at all, which is
    # the norm unless the camera is framed wide enough to include your arms.
    hand_up = result.get("hand_near_face")
    distance = result.get("hand_distance")
    if hand_up is None:
        hand = "?"
    else:
        hand = f"{'NEAR' if hand_up else 'away'} {distance:.2f}"
    line += f" | hand: {hand:<9}"

    # Every COCO label the detector returned, down to a low threshold -- this
    # is how you find out what a given object actually reads as.
    seen = ", ".join(
        f"{label} {score:.2f}" for label, score, *_ in result.get("detections", [])
    )
    line += f" | sees: {seen or 'nothing'}"

    # How close each field is to firing: fraction of the window that was
    # true, and how much of the window has filled up so far.
    progress = result.get("violation_progress", {})
    parts = []
    for field, short in (("slouching", "slouch"), ("doomscrolling", "phone")):
        p = progress.get(field)
        if p and p["seconds"]:
            parts.append(f"{short} {p['progress']:.0%} ({p['seconds']:.0f}/{p['trigger_s']:.0f}s)")
    if parts:
        line += f" | {' '.join(parts)}"

    if result["violations"]:
        line += f"   ** VIOLATION: {', '.join(result['violations'])} **"
    return line


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


def print_verbose(result: dict) -> None:
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
    print(f"pose: {result['pose_info']}")
    print(f"head_height: {result['head_height']} (blocked by: {result['posture_blocker']})"
          f"  drop: {result['head_drop']}  calibration: {result['calibration']}")
    print(f"hand_near_face: {result.get('hand_near_face')} "
          f"(distance: {result.get('hand_distance')}, blocked by: {result.get('hand_blocker')})")
    print(f"detect: {result['detect_info']}")
    print(f"detections: {result['detections']}")
    print(f"proximity: {result['proximity']}")
    print(f"classify: {result['classify_info']}")
    print(f"reading: {result['reading']}")
    print(f"violations: {result['violations']}")


def run_calibration(args, stream) -> int:
    """Collects baseline frames while the user sits in their normal good
    posture. Only frames with a readable pose count toward the window, so
    walking out of frame stalls it instead of poisoning the baseline."""
    # Clear any stored baseline first, or the loop below would see the old
    # one, declare itself already calibrated and record nothing.
    run_inference_on_arduino(args.arduino_host, args.arduino_port, b"", MODE_RESET_CALIBRATION)

    print("Calibrating posture baseline (5 seconds).")
    print("Sit the way you WANT to sit (upright, looking at the screen) and hold still.")
    for i in range(3, 0, -1):
        print(f"  starting in {i}...", flush=True)
        time.sleep(1)

    unreadable = 0
    while True:
        jpeg_bytes = stream.read()
        result = run_inference_on_arduino(
            args.arduino_host, args.arduino_port, jpeg_bytes, MODE_CALIBRATE
        )
        status = result["calibration"]

        if status["calibrated"]:
            print(f"\nCalibrated. baseline head height = {status['baseline']} shoulder widths")
            print("Slouch is now judged as a drop below that, not an absolute number.")
            return 0

        elapsed, need = status["seconds_elapsed"], status["seconds_needed"]
        if result["head_height"] is None:
            unreadable += 1
            print(f"  {elapsed:.1f}s/{need:.0f}s  ({result['posture_blocker']})", flush=True)
            # Don't spin forever pointed at a ceiling.
            if unreadable >= MAX_UNREADABLE_CALIBRATION_FRAMES:
                print(
                    "\nGiving up: couldn't get a clear view of your head and both shoulders.\n"
                    "Check the webcam is actually pointed at you (tilt the screen down),\n"
                    "you're far enough back that your shoulders are in frame, and the\n"
                    "lighting isn't blowing out the image. Then run --calibrate again.",
                    file=sys.stderr,
                )
                return 1
        else:
            unreadable = 0
            print(
                f"  {elapsed:.1f}s/{need:.0f}s  head height = {result['head_height']} "
                f"({status['samples_collected']} samples)",
                flush=True,
            )
        time.sleep(args.interval)


def run_once(args, api_base, robot_key, stream) -> None:
    if args.image:
        jpeg_bytes = Path(args.image).read_bytes()
    else:
        jpeg_bytes = stream.read()

    result = run_inference_on_arduino(args.arduino_host, args.arduino_port, jpeg_bytes)

    if args.verbose:
        print_verbose(result)
    else:
        print(format_labels(result), flush=True)

    violations = result["violations"]
    if not violations or args.dry_run:
        return
    try:
        push_violations(api_base, robot_key, violations)
    except requests.RequestException as error:
        print(f"  push failed: {error}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arduino-host", type=str, required=True, help="Arduino Uno Q IP (see ../DEVICE.md)")
    parser.add_argument("--arduino-port", type=int, default=5005)
    parser.add_argument("--image", type=str, help="send this JPEG instead of grabbing one from the webcam")
    parser.add_argument("--camera", type=str, default="C920",
                        help="camera to use, by name fragment (default: the Logitech C920). "
                             "Use --list-cameras to see what's connected.")
    parser.add_argument("--camera-index", type=int,
                        help="select by raw avfoundation index instead of name (indices shift when "
                             "cameras are plugged/unplugged)")
    parser.add_argument("--list-cameras", action="store_true", help="list connected cameras, then exit")
    parser.add_argument("--loop", action="store_true", help="keep going until Ctrl-C")
    parser.add_argument("--interval", type=float, default=0.0,
                        help="seconds to wait between frames when looping (default 0 = as fast as inference allows)")
    parser.add_argument("--dry-run", action="store_true", help="don't POST violations to the backend")
    parser.add_argument("--verbose", action="store_true", help="full timing/inference breakdown instead of labels")
    parser.add_argument("--calibrate", action="store_true", help="force re-recording the posture baseline, then exit")
    parser.add_argument("--no-calibrate", action="store_true",
                        help="skip the automatic 5s calibration when no baseline exists yet")
    parser.add_argument("--reset-calibration", action="store_true", help="throw away the stored baseline, then exit")
    parser.add_argument("--fps", type=int, default=30, help="webcam capture frame rate")
    parser.add_argument("--video-size", type=str, default="640x480", help="webcam capture resolution")
    args = parser.parse_args()

    if args.list_cameras:
        for index, name in list_cameras():
            print(f"  [{index}] {name}")
        return 0

    if args.reset_calibration:
        result = run_inference_on_arduino(
            args.arduino_host, args.arduino_port, b"", MODE_RESET_CALIBRATION
        )
        print(f"calibration cleared: {result['calibration']}")
        return 0

    load_env(ROOT / ".env")
    api_base = os.environ.get("API_BASE", "http://localhost:3001")
    robot_key = os.environ.get("ROBOT_KEY")
    if not args.dry_run and not args.calibrate and not robot_key:
        print("ROBOT_KEY is not set (see ../.env). Run with --dry-run to test without pushing.", file=sys.stderr)
        return 1

    if args.image and not Path(args.image).exists():
        print(f"Image not found: {args.image}", file=sys.stderr)
        return 1

    stream = None
    if not args.image:
        if args.camera_index is not None:
            camera_index = args.camera_index
            camera_name = dict(list_cameras()).get(camera_index, "?")
        else:
            camera_index = resolve_camera(args.camera)
            camera_name = dict(list_cameras())[camera_index]
        print(f"camera: [{camera_index}] {camera_name}")
        stream = WebcamStream(camera_index, args.video_size, args.fps)

    try:
        # Every run starts by re-recording the baseline: it depends on where
        # you're sitting and how the screen is tilted right now, so a stale
        # one from a previous session would measure against the wrong thing.
        if args.calibrate or (not args.no_calibrate and not args.image):
            try:
                rc = run_calibration(args, stream)
            except KeyboardInterrupt:
                print("\ncalibration cancelled (baseline unchanged)")
                return 1
            if args.calibrate:
                return rc
            if rc != 0:
                # Object detection doesn't depend on the posture baseline, so
                # a failed calibration shouldn't kill the run -- carry on with
                # posture reported as "?" instead.
                print("continuing without posture (phone/bottle still work); "
                      "press Ctrl-C and re-run to retry calibration\n", file=sys.stderr)
            else:
                print()

        frames = 0
        started = time.time()
        try:
            while True:
                try:
                    run_once(args, api_base, robot_key, stream)
                    frames += 1
                except OSError as error:
                    # The board reboots fairly often mid-session; a dropped
                    # frame shouldn't end a monitoring run.
                    if not args.loop:
                        print(f"inference call failed: {error}", file=sys.stderr)
                        return 1
                    print(f"  (lost connection: {error})", file=sys.stderr)
                if not args.loop:
                    break
                if args.interval:
                    time.sleep(args.interval)
        except KeyboardInterrupt:
            elapsed = time.time() - started
            if frames and elapsed > 0:
                print(f"\n{frames} frames in {elapsed:.1f}s = {frames / elapsed:.2f} fps")
            else:
                print()
    finally:
        if stream is not None:
            stream.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
