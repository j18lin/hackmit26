"""
TCP inference server for the Arduino Uno Q (Linux/QRB2210 side).

Accepts a single JPEG frame per connection over a raw length-prefixed TCP
protocol, runs it through MoveNet Lightning (pose), EfficientDet-Lite0
(detect), and the int8 Edge Impulse classifier -- entirely on-device -- and
computes the instantaneous Nudge sensor booleans (forward-head/slouch
heuristic on MoveNet keypoints, object-proximity heuristic on EfficientDet
detections -- see check_slouching and check_proximity_states below).

The backend's /api/robot/violations endpoint does no threshold/duration
math at all -- it just counts whatever it's told (see ../SENSOR_API.md).
So the "has this habit actually been violated" decision -- i.e. has a
field been continuously true for longer than its own duration threshold --
also happens here, on-device, in ViolationTracker. That state lives in
this process (module-level, keyed by field) and persists across
connections, so it correctly measures wall-clock duration regardless of
how often the client happens to poll. The server reports both the raw
instantaneous `reading` and a `violations` list (fields whose duration
threshold was just crossed on this call, i.e. fire-once-per-streak); the
client (see monitor_arduino.py) only POSTs the fields in `violations`.

Each fired violation also directly triggers a physical reaction on this
same board's microcontroller side (LCD eyes + servos, see
../../owlert_robot/owlert_robot.ino) via arduino_expression.py, over the
UNO Q's built-in Linux<->MCU serial bridge -- no round trip through the
Mac or backend needed for the physical reaction itself, only for logging.

Posture is judged against a *calibrated per-person baseline* (see
PostureCalibration), not an absolute constant, because the metric depends on
camera angle, seating distance and build. The baseline is persisted to disk
so it survives the board's frequent reboots.

Wire protocol (client -> server): 1 mode byte (I=infer, C=calibration
sample, R=reset calibration), then a 4-byte big-endian length, then that
many JPEG bytes (length 0 is allowed for R). Server -> client: 4-byte
big-endian length, then that many bytes of UTF-8 JSON.

Usage (run on the device, after scp-ing this folder + the three model
files + coco_labelmap.txt into ./models -- see DEVICE.md):
    python3 tcp_infer_server.py --port 5005
"""

import argparse
import json
from collections import deque
import socket
import struct
import time
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

# Disabled along with the send_expression() call in handle_connection():
# from arduino_expression import send_expression

MODELS_DIR = Path(__file__).resolve().parent / "models"

POSE_MODEL_PATH = MODELS_DIR / "movenet_lightning.tflite"
POSE_INPUT_SIZE = 192

DETECT_MODEL_PATH = MODELS_DIR / "efficientdet_lite0.tflite"
DETECT_INPUT_SIZE = 320
LABELMAP_PATH = MODELS_DIR / "coco_labelmap.txt"

CLASSIFY_MODEL_PATH = MODELS_DIR / "objects_int8.tflite"
CLASSIFY_INPUT_SIZE = 96

# Edge Impulse "project-2" whole-frame classifier, replacing EfficientDet for
# phone/bottle. It has no bounding boxes, so there's no person box and no
# proximity check any more -- it answers "does this frame look like phone /
# bottle use", which is what we actually need. Costs ~4ms against
# EfficientDet's ~257ms.
#
# The .lite file embeds no label metadata, so this order was determined
# empirically: with hands empty index 0 won 169/169 frames, and while a phone
# was held index 2 won 47 frames clustered exactly when it was up (and never
# won at all in the control). Index 1 is bottle by elimination -- it has NOT
# been confirmed against a real bottle yet.
#
# Raw probabilities stay in every response ("class_scores") so this can be
# re-checked at any time.
CLASSIFIER_LABELS = ["none", "bottle", "phone"]

# Index 2 peaked around 0.64 with the phone clearly in frame, so 0.6 is
# close to the floor of what a true positive looks like -- expect misses
# rather than false alarms at this setting.
CLASSIFIER_THRESHOLD = 0.55

# EfficientDet drives phone/bottle again. The Edge Impulse classifier still
# runs (it's only ~4ms) and its scores stay in the response, so the two can
# be compared side by side on the same frames.
USE_OBJECT_DETECTOR = True

# --- posture heuristic: head height above the shoulder line, normalized by
# shoulder width so it doesn't change when you sit nearer/further from the
# camera. Slouching pulls the head down toward the shoulders, shrinking it.
#
# (This replaces an earlier ear-vs-shoulder *x*-offset check, which only
# measures forward-head from a side view -- from a frontal laptop webcam it
# really measures left/right head tilt, which is not what we want.)
#
# The metric is person- and camera-specific, so it's judged as a drop from a
# calibrated baseline rather than against an absolute constant.
NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR = 0, 1, 2, 3, 4
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6
POSE_CONF_THRESHOLD = 0.3

# Shoulders closer together than this (as a fraction of frame width) mean a
# near-side-on or badly-fit pose; the normalization blows up, so refuse to
# judge instead of emitting garbage.
MIN_SHOULDER_WIDTH = 0.05

# How far the head must drop below the calibrated baseline (in shoulder
# widths) to count as slouching. Rough starting guess.
SLOUCH_DROP_THRESHOLD = 0.15

# Calibration runs for a wall-clock window rather than a frame count, since
# frame rate depends on how fast the client polls (~0.8s/frame today). The
# minimum guards against finishing on one or two readable frames if the
# person was mostly out of view.
CALIBRATION_SECONDS = 5.0
CALIBRATION_MIN_SAMPLES = 3
CALIBRATION_PATH = Path(__file__).resolve().parent / "posture_calibration.json"

# Request modes, sent as the first byte of every request (see wire protocol
# in the module docstring).
MODE_INFER = b"I"
MODE_CALIBRATE = b"C"
MODE_RESET_CALIBRATION = b"R"

# --- phone/drink proximity heuristic: nearest watched-object box to a
# person box, normalized by the person bbox diagonal ---
SCORE_THRESHOLD = 0.4
PROXIMITY_THRESHOLD = 0.6

# Everything above this is *reported* (so you can see what COCO label an
# object is actually getting, e.g. whether a water bottle reads as "bottle",
# "cup" or "vase"), while only detections above SCORE_THRESHOLD are allowed
# to drive a verdict.
DETECT_REPORT_THRESHOLD = 0.15
PERSON_LABEL = "person"
LABEL_STATES = {"cell phone": "on phone", "bottle": "drinking"}
WATCHED_LABELS = set(LABEL_STATES)

# The only COCO classes we care about. Everything else EfficientDet reports
# (chair, laptop, tv, ...) is dropped, so the output is just the two
# categories plus the person box the proximity check measures against.
RELEVANT_LABELS = WATCHED_LABELS | {PERSON_LABEL}

# --- violation thresholds ---
#
# Density over a sliding window, not a continuous streak: both detectors are
# noisy (the pose model regularly loses a shoulder, the detector drops a
# phone for a frame or two), so requiring an unbroken run of true frames
# means a single bad frame resets the clock and nothing ever fires. Instead:
# "was this true for most of the last minute?".
#
# Currently 60s everywhere for testing -- real values should differ per habit.
VIOLATION_WINDOW_SEC = {
    "doomscrolling": 60.0,
    "slouching": 60.0,
    "sleeping": 60.0,
    "drinkingWater": 60.0,
}

# Fraction of *valid* frames in the window that must be true. Frames where
# the signal couldn't be judged at all (e.g. posture with a missing shoulder)
# are excluded from the denominator rather than counted as false, so dropouts
# don't quietly suppress real violations.
VIOLATION_DENSITY = 0.6
VIOLATION_MIN_SAMPLES = 10

# Which expression the robot (owlert_robot.ino, over the serial bridge --
# see arduino_expression.py) plays when a given field's violation fires.
# Arbitrary/placeholder mapping, easy to retune.
VIOLATION_EXPRESSIONS = {
    "doomscrolling": "ANGRY",
    "slouching": "ANGRY",
    "sleeping": "SAD",
    "drinkingWater": "POSITIVE",  # drinking water is praised, not scolded
}


class ViolationTracker:
    """Fires when a field was true for most of a sliding time window.

    Density rather than an unbroken streak, because both detectors drop
    frames often enough that a streak-based rule would essentially never
    fire. A field fires when its window is full (spans the configured
    duration), has enough samples, and the true fraction clears
    VIOLATION_DENSITY.

    After firing, that field's window is cleared, so the next violation
    needs a fresh window's worth of evidence instead of re-firing on every
    subsequent frame.
    """

    def __init__(self, windows: dict, density: float, min_samples: int):
        self.windows = windows
        self.density = density
        self.min_samples = min_samples
        self.samples = {field: deque() for field in windows}

    def update(self, reading: dict, now: float, valid: dict = None) -> list[str]:
        fired = []
        for field, window in self.windows.items():
            # A frame that couldn't be judged contributes nothing either way.
            if valid is not None and not valid.get(field, True):
                continue

            samples = self.samples[field]
            samples.append((now, bool(reading.get(field))))
            cutoff = now - window
            while samples and samples[0][0] < cutoff:
                samples.popleft()

            if len(samples) < self.min_samples:
                continue
            # Require a (nearly) full window, so we never fire on a short
            # burst that merely happens to be 100% true.
            if samples[-1][0] - samples[0][0] < window * 0.9:
                continue
            if sum(1 for _, value in samples if value) / len(samples) >= self.density:
                fired.append(field)
                samples.clear()
        return fired

    def progress(self, now: float) -> dict:
        """Per-field view of how close each field is to firing."""
        out = {}
        for field, window in self.windows.items():
            samples = self.samples[field]
            count = len(samples)
            true_count = sum(1 for _, value in samples if value)
            out[field] = {
                "density": round(true_count / count, 2) if count else 0.0,
                "samples": count,
                "window_filled_s": round(samples[-1][0] - samples[0][0], 1) if count else 0.0,
                "window_s": window,
            }
        return out


def load_interpreter(model_path):
    interpreter = Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    return interpreter


def load_labels(path):
    with open(path) as f:
        return [line.strip() for line in f]


def run_pose(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (POSE_INPUT_SIZE, POSE_INPUT_SIZE))
    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    start = time.perf_counter()
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()
    keypoints = interpreter.get_tensor(output_details[0]["index"])[0, 0, :, :]  # (17, 3) y,x,conf
    elapsed_ms = (time.perf_counter() - start) * 1000

    num_confident = int((keypoints[:, 2] > POSE_CONF_THRESHOLD).sum())
    return elapsed_ms, keypoints, f"{num_confident}/17 keypoints above {POSE_CONF_THRESHOLD} conf"


def head_height(keypoints):
    """How far the head sits above the shoulder line, in shoulder widths.

    Returns (value, reason). value is None when the pose isn't good enough
    to judge, and reason then says *why* in plain words so the caller can
    tell the user what to fix. None is "don't know", which callers must not
    treat as "good posture".

    float() casts because these are numpy scalars, which json.dumps can't
    serialize when the value goes back over the wire.
    """
    nose_y, _, nose_conf = keypoints[NOSE]
    l_sh_y, l_sh_x, l_sh_conf = keypoints[LEFT_SHOULDER]
    r_sh_y, r_sh_x, r_sh_conf = keypoints[RIGHT_SHOULDER]

    missing = [
        name
        for name, conf in (
            ("nose", nose_conf),
            ("left shoulder", l_sh_conf),
            ("right shoulder", r_sh_conf),
        )
        if conf < POSE_CONF_THRESHOLD
    ]
    if missing:
        return None, f"can't see {', '.join(missing)}"

    shoulder_width = abs(float(l_sh_x) - float(r_sh_x))
    if shoulder_width < MIN_SHOULDER_WIDTH:
        return None, "shoulders too close together to measure against"

    shoulder_mid_y = (float(l_sh_y) + float(r_sh_y)) / 2
    # y grows downward, so the head being higher means a larger positive gap.
    return round((shoulder_mid_y - float(nose_y)) / shoulder_width, 3), None


class PostureCalibration:
    """Per-person baseline for head_height, captured while they sit normally.

    Persisted to disk because the board reboots often and re-calibrating on
    every restart would make the thing unusable.
    """

    def __init__(self, path: Path):
        self.path = path
        self.baseline = None
        self.samples = []
        self.started_at = None
        self._load()

    def _load(self):
        try:
            self.baseline = json.loads(self.path.read_text())["baseline"]
        except (FileNotFoundError, ValueError, KeyError):
            self.baseline = None

    def _save(self):
        self.path.write_text(json.dumps({"baseline": self.baseline}))

    def reset(self):
        self.baseline = None
        self.samples = []
        self.started_at = None
        self.path.unlink(missing_ok=True)

    def add_sample(self, metric, now):
        """Collects one calibration frame.

        The 5s clock starts on the first *readable* frame, so time spent
        waiting for the person to get into view doesn't eat the window.
        Unreadable frames are skipped rather than counted, and the window
        won't close until it has enough real samples to take a median of.
        """
        if metric is not None:
            if self.started_at is None:
                self.started_at = now
            self.samples.append(metric)

        if (
            self.started_at is not None
            and now - self.started_at >= CALIBRATION_SECONDS
            and len(self.samples) >= CALIBRATION_MIN_SAMPLES
        ):
            self.baseline = round(float(np.median(self.samples)), 3)
            self.samples = []
            self.started_at = None
            self._save()
        return self.status(now)

    def status(self, now=None):
        elapsed = 0.0
        if self.started_at is not None and now is not None:
            elapsed = round(now - self.started_at, 1)
        return {
            "calibrated": self.baseline is not None,
            "baseline": self.baseline,
            "samples_collected": len(self.samples),
            "seconds_elapsed": elapsed,
            "seconds_needed": CALIBRATION_SECONDS,
        }

    def check_slouching(self, metric):
        """(is_slouching, drop_below_baseline). Both None-safe: an unreadable
        pose or a missing baseline means "can't say", not "fine"."""
        if metric is None or self.baseline is None:
            return False, None
        drop = round(self.baseline - metric, 3)
        return bool(drop > SLOUCH_DROP_THRESHOLD), drop


def run_detect(interpreter, frame_rgb):
    img = cv2.resize(frame_rgb, (DETECT_INPUT_SIZE, DETECT_INPUT_SIZE))
    input_data = np.expand_dims(img, axis=0).astype(np.uint8)
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    start = time.perf_counter()
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()
    boxes = interpreter.get_tensor(output_details[0]["index"])[0]
    classes = interpreter.get_tensor(output_details[1]["index"])[0]
    scores = interpreter.get_tensor(output_details[2]["index"])[0]
    count = int(interpreter.get_tensor(output_details[3]["index"])[0])
    elapsed_ms = (time.perf_counter() - start) * 1000

    num_confident = int((scores[:count] > 0.5).sum())
    return elapsed_ms, (boxes[:count], classes[:count], scores[:count]), f"{num_confident}/{count} detections above 0.5 conf"


def box_center(box):
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def box_diagonal(box):
    x1, y1, x2, y2 = box
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5


def decode_detections(boxes, classes, scores, labels, frame_shape, threshold=SCORE_THRESHOLD):
    """Detections above threshold as (label, score, (x1,y1,x2,y2)) in pixels."""
    h, w = frame_shape[:2]
    out = []
    for box, class_id, score in zip(boxes, classes, scores):
        if score < threshold:
            continue
        label = labels[int(class_id) + 1]
        if label not in RELEVANT_LABELS:
            continue
        ymin, xmin, ymax, xmax = box
        out.append((label, float(score), (xmin * w, ymin * h, xmax * w, ymax * h)))
    return out


def check_proximity_states(detections):
    people = [box for label, _, box in detections if label == PERSON_LABEL]
    best_by_label = {}
    for label, _, obj_box in detections:
        if label not in WATCHED_LABELS:
            continue
        oc = box_center(obj_box)
        for person_box in people:
            pc = box_center(person_box)
            diag = max(box_diagonal(person_box), 1e-6)
            norm_dist = ((pc[0] - oc[0]) ** 2 + (pc[1] - oc[1]) ** 2) ** 0.5 / diag
            current = best_by_label.get(label)
            if current is None or norm_dist < current:
                best_by_label[label] = norm_dist

    # float(): these come from numpy box coords, and a numpy scalar in the
    # response kills json.dumps -- which only ever happened once a watched
    # object was actually near the person, i.e. exactly when it mattered.
    return {
        LABEL_STATES[label]: float(dist)
        for label, dist in best_by_label.items()
        if dist < PROXIMITY_THRESHOLD
    }


def run_classify(interpreter, frame_rgb):
    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()[0]

    in_scale, in_zero_point = input_details["quantization"]
    out_scale, out_zero_point = output_details["quantization"]

    img = cv2.resize(frame_rgb, (CLASSIFY_INPUT_SIZE, CLASSIFY_INPUT_SIZE)).astype(np.float32) / 255.0
    quantized = np.round(img / in_scale + in_zero_point).astype(np.int8)
    input_data = np.expand_dims(quantized, axis=0)

    start = time.perf_counter()
    interpreter.set_tensor(input_details["index"], input_data)
    interpreter.invoke()
    raw_output = interpreter.get_tensor(output_details["index"])[0]
    elapsed_ms = (time.perf_counter() - start) * 1000

    scores = (raw_output.astype(np.float32) - out_zero_point) * out_scale
    return elapsed_ms, [round(float(score), 3) for score in scores]


def classify_states(class_scores):
    """Maps the classifier's output to the phone/bottle booleans.

    Returns (states, label, confidence). A frame only counts when the winning
    class clears CLASSIFIER_THRESHOLD, so an uncertain 3-way split doesn't
    register as either object.
    """
    if not class_scores:
        return {}, None, 0.0
    top = int(np.argmax(class_scores))
    confidence = float(class_scores[top])
    label = CLASSIFIER_LABELS[top] if top < len(CLASSIFIER_LABELS) else f"class{top}"
    if confidence < CLASSIFIER_THRESHOLD:
        return {}, label, confidence

    states = {}
    if label == "phone":
        states["on phone"] = confidence
    elif label == "bottle":
        states["drinking"] = confidence
    return states, label, confidence


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed before expected bytes arrived")
        buf.extend(chunk)
    return bytes(buf)


def _json_safe(value):
    """Last-resort coercion for numpy scalars.

    A stray numpy float in the response used to raise inside json.dumps,
    which aborted the handler and closed the socket with no reply -- the
    client just saw "connection lost", giving no hint that it was a
    serialization bug. Degrading to a plain number is far better than
    dropping the whole frame.
    """
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def send_json(conn, payload_obj):
    payload = json.dumps(payload_obj, default=_json_safe).encode("utf-8")
    conn.sendall(struct.pack(">I", len(payload)))
    conn.sendall(payload)
    return payload_obj


def handle_connection(conn, interpreters, labels, tracker, calibration):
    server_recv_start = time.perf_counter()
    mode = recv_exact(conn, 1)
    (length,) = struct.unpack(">I", recv_exact(conn, 4))
    jpeg_bytes = recv_exact(conn, length) if length else b""
    server_recv_ms = (time.perf_counter() - server_recv_start) * 1000

    if mode == MODE_RESET_CALIBRATION:
        calibration.reset()
        return send_json(conn, {"calibration": calibration.status()})

    decode_start = time.perf_counter()
    frame_bgr = cv2.imdecode(np.frombuffer(jpeg_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame_bgr is None:
        raise ValueError("could not decode JPEG payload")
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    decode_ms = (time.perf_counter() - decode_start) * 1000

    pose_ms, keypoints, pose_info = run_pose(interpreters["pose"], frame_rgb)
    metric, posture_blocker = head_height(keypoints)

    # Calibration frames only need the pose model, so skip the detector and
    # classifier -- that's ~270ms/frame saved while the user holds still.
    if mode == MODE_CALIBRATE:
        return send_json(conn, {
            "calibration": calibration.add_sample(metric, time.time()),
            "head_height": metric,
            "posture_blocker": posture_blocker,
            "pose_info": pose_info,
            "pose_ms": round(pose_ms, 2),
        })

    is_slouching, head_drop = calibration.check_slouching(metric)

    classify_ms, class_scores = run_classify(interpreters["classify"], frame_rgb)
    states, class_label, class_confidence = classify_states(class_scores)

    # Only run the box detector if we've deliberately switched back to it;
    # otherwise phone/bottle come from the classifier above.
    detect_ms, detections, detect_info = 0.0, [], "detector disabled"
    if USE_OBJECT_DETECTOR:
        detect_ms, (boxes, classes, scores), detect_info = run_detect(
            interpreters["detect"], frame_rgb
        )
        # Report widely, decide narrowly.
        detections = decode_detections(
            boxes, classes, scores, labels, frame_bgr.shape, DETECT_REPORT_THRESHOLD
        )
        states = check_proximity_states(
            [d for d in detections if d[1] >= SCORE_THRESHOLD]
        )

    reading = {
        "doomscrolling": "on phone" in states,
        "slouching": bool(is_slouching),
        "sleeping": False,  # not detected yet, see MODELS.md
        "drinkingWater": "drinking" in states,
        "tempRaw": 2700,  # placeholder, no real temp sensor wired up yet
    }
    # Posture is only a real "not slouching" when it was actually readable;
    # otherwise the frame is excluded from the window entirely.
    now = time.time()
    violations = tracker.update(reading, now, valid={"slouching": metric is not None})
    # Physical reaction disabled for now while the rest of the system is
    # being checked out end to end. Re-enable to make the robot react:
    # if violations:
    #     # First fired field wins if several cross their threshold on the
    #     # same call -- one expression at a time, arbitrary but deterministic.
    #     send_expression(VIOLATION_EXPRESSIONS[violations[0]])

    result = {
        "reading": reading,
        "violations": violations,
        "violation_progress": tracker.progress(now),
        "calibration": calibration.status(),
        "head_height": metric,
        "head_drop": head_drop,
        "posture_blocker": posture_blocker,
        "bytes_received": length,
        "server_recv_ms": round(server_recv_ms, 2),
        "decode_ms": round(decode_ms, 2),
        "pose_ms": round(pose_ms, 2),
        "pose_info": pose_info,
        "detect_ms": round(detect_ms, 2),
        "detect_info": detect_info,
        # Every object seen, not just the watched ones, so it's visible when
        # e.g. a phone is detected but too far from the person to count.
        # Boxes are normalized 0-1 so a viewer can draw them at any size.
        "detections": [
            [
                label,
                round(score, 2),
                [
                    round(box[0] / frame_bgr.shape[1], 4),
                    round(box[1] / frame_bgr.shape[0], 4),
                    round(box[2] / frame_bgr.shape[1], 4),
                    round(box[3] / frame_bgr.shape[0], 4),
                ],
            ]
            for label, score, box in detections
        ],
        # Normalized object-to-person distances behind the verdicts above.
        "proximity": {state: round(dist, 2) for state, dist in states.items()},
        "classify_ms": round(classify_ms, 2),
        # Raw per-class probabilities, so the label order in
        # CLASSIFIER_LABELS can be verified against reality.
        "class_scores": class_scores,
        "class_label": class_label,
        "class_confidence": round(class_confidence, 3),
        "server_total_ms": round(server_recv_ms + decode_ms + pose_ms + detect_ms + classify_ms, 2),
    }
    return send_json(conn, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5005)
    args = parser.parse_args()

    for p in (POSE_MODEL_PATH, DETECT_MODEL_PATH, CLASSIFY_MODEL_PATH, LABELMAP_PATH):
        if not p.exists():
            raise FileNotFoundError(f"Expected model at {p} -- see DEVICE.md for the scp command.")

    print("Loading interpreters...", flush=True)
    interpreters = {
        "pose": load_interpreter(POSE_MODEL_PATH),
        "detect": load_interpreter(DETECT_MODEL_PATH),
        "classify": load_interpreter(CLASSIFY_MODEL_PATH),
    }
    labels = load_labels(LABELMAP_PATH)
    tracker = ViolationTracker(VIOLATION_WINDOW_SEC, VIOLATION_DENSITY, VIOLATION_MIN_SAMPLES)
    calibration = PostureCalibration(CALIBRATION_PATH)
    print(f"Posture calibration: {calibration.status()}", flush=True)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_sock:
        server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_sock.bind((args.host, args.port))
        server_sock.listen(1)
        print(f"Listening on {args.host}:{args.port} ...", flush=True)

        while True:
            conn, addr = server_sock.accept()
            with conn:
                print(f"Connection from {addr}", flush=True)
                try:
                    result = handle_connection(conn, interpreters, labels, tracker, calibration)
                    print(f"  -> {result}", flush=True)
                except Exception as e:
                    print(f"  error handling connection: {e}", flush=True)


if __name__ == "__main__":
    main()
