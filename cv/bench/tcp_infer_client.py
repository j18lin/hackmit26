"""
TCP inference client (run on the Mac). Sends a JPEG to tcp_infer_server.py
running on the Arduino Uno Q, and measures full round-trip time: connect +
send image bytes + wait for the server to run all three models + receive
the JSON result back. Reports the round-trip breakdown against the
server's self-reported timings so you can see how much of the round trip
is network/transfer vs. actual inference.

Usage:
    python3 tcp_infer_client.py --host 10.31.181.91 --port 5005 --image mac_webcam.jpg
    python3 tcp_infer_client.py --host 10.31.181.91 --image mac_webcam.jpg --runs 5
"""

import argparse
import json
import socket
import struct
import statistics
import time


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed before expected bytes arrived")
        buf.extend(chunk)
    return bytes(buf)


def send_and_time(host, port, jpeg_bytes):
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
    return {
        "connect_ms": round((t_connected - t0) * 1000, 2),
        "upload_ms": round((t_sent - t_connected) * 1000, 2),
        "wait_for_response_ms": round((t_done - t_sent) * 1000, 2),
        "round_trip_ms": round((t_done - t0) * 1000, 2),
        "server": result,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", type=str, required=True)
    parser.add_argument("--port", type=int, default=5005)
    parser.add_argument("--image", type=str, required=True)
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()

    with open(args.image, "rb") as f:
        jpeg_bytes = f.read()
    print(f"Sending {args.image} ({len(jpeg_bytes)} bytes) to {args.host}:{args.port}, {args.runs} run(s)...")

    round_trips = []
    for i in range(args.runs):
        r = send_and_time(args.host, args.port, jpeg_bytes)
        round_trips.append(r["round_trip_ms"])
        s = r["server"]
        print(
            f"run {i}: round_trip={r['round_trip_ms']}ms "
            f"(connect={r['connect_ms']}ms upload={r['upload_ms']}ms wait={r['wait_for_response_ms']}ms) | "
            f"server: recv={s['server_recv_ms']}ms decode={s['decode_ms']}ms "
            f"pose={s['pose_ms']}ms detect={s['detect_ms']}ms classify={s['classify_ms']}ms "
            f"server_total={s['server_total_ms']}ms"
        )
        print(f"    pose: {s['pose_info']} (forward_offset={s['forward_offset']})  detect: {s['detect_info']}  classify: {s['classify_info']}")
        print(f"    reading: {s['reading']}")

    print()
    print(
        f"Round trip (image -> Arduino -> 3-model inference -> back to Mac): "
        f"n={len(round_trips)} mean={statistics.mean(round_trips):.1f}ms "
        f"median={statistics.median(round_trips):.1f}ms "
        f"min={min(round_trips):.1f}ms max={max(round_trips):.1f}ms"
    )


if __name__ == "__main__":
    main()
