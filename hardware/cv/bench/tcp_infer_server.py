"""
TCP inference server for the Arduino Uno Q (Linux/QRB2210 side).

Accepts a single JPEG frame per connection over a raw length-prefixed TCP
protocol, runs it through MoveNet Lightning (pose), EfficientDet-Lite0
(detect), and the int8 Edge Impulse classifier -- entirely on-device -- and
sends back a JSON result with the Nudge sensor-reading booleans already
computed (forward-head/slouch heuristic on MoveNet keypoints, object-
proximity heuristic on EfficientDet detections -- see check_slouching and
check_proximity_states below), plus each model's inference time and
server-side receive/decode time. The client
(see monitor_arduino.py) just forwards that reading to the dashboard's
POST /api/robot/sensors -- no CV logic runs off-device.

Wire protocol (client -> server): 4-byte big-endian length, then that many
JPEG bytes. Server -> client: 4-byte big-endian length, then that many
bytes of UTF-8 JSON.

Usage (run on the device, after scp-ing this folder + the three model
files + coco_labelmap.txt into ./models -- see DEVICE.md):
    python3 tcp_infer_server.py --port 5005
"""

import argparse
import json
import socket
import struct
import time
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODELS_DIR = Path(__file__).resolve().parent / "models"

POSE_MODEL_PATH = MODELS_DIR / "movenet_lightning.tflite"
POSE_INPUT_SIZE = 192

DETECT_MODEL_PATH = MODELS_DIR / "efficientdet_lite0.tflite"
DETECT_INPUT_SIZE = 320
LABELMAP_PATH = MODELS_DIR / "coco_labelmap.txt"

CLASSIFY_MODEL_PATH = MODELS_DIR / "classifier_int8.tflite"
CLASSIFY_INPUT_SIZE = 96

# --- posture heuristic: forward-head via ear-vs-shoulder x-offset,
# normalized by shoulder width ---
NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR = 0, 1, 2, 3, 4
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6
POSE_CONF_THRESHOLD = 0.3
FORWARD_HEAD_THRESHOLD = 0.35

# --- phone/drink proximity heuristic: nearest watched-object box to a
# person box, normalized by the person bbox diagonal ---
SCORE_THRESHOLD = 0.4
PROXIMITY_THRESHOLD = 0.6
PERSON_LABEL = "person"
LABEL_STATES = {"cell phone": "on phone", "bottle": "drinking"}
WATCHED_LABELS = set(LABEL_STATES)


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


def check_slouching(keypoints):
    def kp(i):
        y, x, conf = keypoints[i]
        return (x, y, conf)

    l_sh, r_sh = kp(LEFT_SHOULDER), kp(RIGHT_SHOULDER)
    l_ear, r_ear = kp(LEFT_EAR), kp(RIGHT_EAR)

    if l_sh[2] < POSE_CONF_THRESHOLD or r_sh[2] < POSE_CONF_THRESHOLD:
        return False, None  # shoulders not visible

    shoulder_mid_x = (l_sh[0] + r_sh[0]) / 2
    shoulder_width = abs(l_sh[0] - r_sh[0]) + 1e-6

    ear_xs = [e[0] for e in (l_ear, r_ear) if e[2] >= POSE_CONF_THRESHOLD]
    if not ear_xs:
        return False, None  # ears not visible

    ear_mid_x = sum(ear_xs) / len(ear_xs)
    forward_offset = (ear_mid_x - shoulder_mid_x) / shoulder_width
    return abs(forward_offset) > FORWARD_HEAD_THRESHOLD, round(forward_offset, 3)


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


def check_proximity_states(boxes, classes, scores, labels, frame_shape):
    h, w = frame_shape[:2]
    detections = []
    for box, class_id, score in zip(boxes, classes, scores):
        label = labels[int(class_id) + 1]
        if score < SCORE_THRESHOLD:
            continue
        ymin, xmin, ymax, xmax = box
        detections.append((label, (xmin * w, ymin * h, xmax * w, ymax * h)))

    people = [box for label, box in detections if label == PERSON_LABEL]
    best_by_label = {}
    for label, obj_box in detections:
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

    return {LABEL_STATES[label]: dist for label, dist in best_by_label.items() if dist < PROXIMITY_THRESHOLD}


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
    top_class = int(np.argmax(scores))
    return elapsed_ms, f"class={top_class} scores={np.round(scores, 3).tolist()}"


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed before expected bytes arrived")
        buf.extend(chunk)
    return bytes(buf)


def handle_connection(conn, interpreters, labels):
    server_recv_start = time.perf_counter()
    (length,) = struct.unpack(">I", recv_exact(conn, 4))
    jpeg_bytes = recv_exact(conn, length)
    server_recv_ms = (time.perf_counter() - server_recv_start) * 1000

    decode_start = time.perf_counter()
    frame_bgr = cv2.imdecode(np.frombuffer(jpeg_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame_bgr is None:
        raise ValueError("could not decode JPEG payload")
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    decode_ms = (time.perf_counter() - decode_start) * 1000

    pose_ms, keypoints, pose_info = run_pose(interpreters["pose"], frame_rgb)
    is_slouching, forward_offset = check_slouching(keypoints)

    detect_ms, (boxes, classes, scores), detect_info = run_detect(interpreters["detect"], frame_rgb)
    states = check_proximity_states(boxes, classes, scores, labels, frame_bgr.shape)

    classify_ms, classify_info = run_classify(interpreters["classify"], frame_rgb)

    reading = {
        "doomscrolling": "on phone" in states,
        "slouching": bool(is_slouching),
        "sleeping": False,  # not detected yet, see MODELS.md
        "drinkingWater": "drinking" in states,
        "tempRaw": 2700,  # placeholder, no real temp sensor wired up yet
    }

    result = {
        "reading": reading,
        "bytes_received": length,
        "server_recv_ms": round(server_recv_ms, 2),
        "decode_ms": round(decode_ms, 2),
        "pose_ms": round(pose_ms, 2),
        "pose_info": pose_info,
        "forward_offset": forward_offset,
        "detect_ms": round(detect_ms, 2),
        "detect_info": detect_info,
        "classify_ms": round(classify_ms, 2),
        "classify_info": classify_info,
        "server_total_ms": round(server_recv_ms + decode_ms + pose_ms + detect_ms + classify_ms, 2),
    }

    payload = json.dumps(result).encode("utf-8")
    conn.sendall(struct.pack(">I", len(payload)))
    conn.sendall(payload)
    return result


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
                    result = handle_connection(conn, interpreters, labels)
                    print(f"  -> {result}", flush=True)
                except Exception as e:
                    print(f"  error handling connection: {e}", flush=True)


if __name__ == "__main__":
    main()
