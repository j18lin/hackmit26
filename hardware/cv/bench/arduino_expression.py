"""
Sends expression commands from the Arduino UNO Q's Linux side (where
tcp_infer_server.py runs) to its own microcontroller side (where
hardware/owlert_robot/owlert_robot.ino runs, controlling the LCD eyes +
servos), over the board's built-in Linux<->MCU serial bridge.

This is Arduino's own inter-processor link, not a separate USB cable. The
arduino-router service owns the physical UART to the microcontroller
(/dev/ttyHS1 @ 115200) and exposes it as a monitor socket on
127.0.0.1:7500 -- so we talk to that, NOT to the serial device directly
(the router already holds it open) and NOT to /dev/ttyGS0 (that's just a
socat proxy of the same monitor out to a USB host, for a computer plugged
into the board).

One command per line, case-insensitive: NEUTRAL, ANGRY, SAD -- see the
sketch's handleCommand() for what each does.

Connecting is best-effort and never raises: if the sketch hasn't been
uploaded yet, or the router isn't up, this just logs and no-ops, so it
can't take down tcp_infer_server.py's inference loop.
"""

import socket
import sys
import threading

ROUTER_HOST = "127.0.0.1"
ROUTER_PORT = 7500

VALID_COMMANDS = {"NEUTRAL", "ANGRY", "SAD"}

_lock = threading.Lock()
_conn = None
_warned = False


def _get_connection():
    global _conn, _warned
    if _conn is not None:
        return _conn
    try:
        _conn = socket.create_connection((ROUTER_HOST, ROUTER_PORT), timeout=2.0)
        return _conn
    except OSError as e:
        if not _warned:
            print(
                f"arduino_expression: could not reach arduino-router at "
                f"{ROUTER_HOST}:{ROUTER_PORT} ({e}), expressions disabled",
                file=sys.stderr,
            )
            _warned = True
        return None


def send_expression(command: str) -> bool:
    """Sends one command (NEUTRAL/ANGRY/SAD) to the sketch. Returns whether
    it was actually sent -- False (not an exception) on any failure, so
    callers in the inference hot path don't need a try/except."""
    command = command.strip().upper()
    if command not in VALID_COMMANDS:
        raise ValueError(f"command must be one of {VALID_COMMANDS}, got {command!r}")

    global _conn
    with _lock:
        conn = _get_connection()
        if conn is None:
            return False
        try:
            conn.sendall(f"{command}\n".encode("ascii"))
            return True
        except OSError as e:
            print(f"arduino_expression: send failed ({e}), will reconnect next time", file=sys.stderr)
            try:
                conn.close()
            except OSError:
                pass
            _conn = None
            return False


if __name__ == "__main__":
    # Manual smoke test: python3 arduino_expression.py ANGRY
    cmd = sys.argv[1] if len(sys.argv) > 1 else "NEUTRAL"
    ok = send_expression(cmd)
    print(f"sent {cmd!r}: {ok}")
