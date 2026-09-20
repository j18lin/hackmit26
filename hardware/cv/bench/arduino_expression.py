"""
Sends expression commands from the Arduino UNO Q's Linux side (where
tcp_infer_server.py runs) to its own microcontroller side (where
hardware/owlert_robot/owlert_robot.ino runs, controlling the LCD eyes +
servos), over the board's built-in Linux<->MCU serial bridge.

This is Arduino's own inter-processor link, not a separate USB cable: the
sketch's `Serial` object is bridged to /dev/ttyGS0 on the Linux side by the
arduino-router-serial service (already running by default on UNO Q). One
command per line, case-insensitive: NEUTRAL, ANGRY, SAD -- see the sketch's
handleCommand() for what each does.

Opening the port is best-effort and never raises: if the sketch hasn't
been uploaded yet, or the bridge isn't up, this just logs and no-ops,
so it can't take down tcp_infer_server.py's inference loop.
"""

import sys
import threading

try:
    import serial
except ImportError:
    serial = None

PORT = "/dev/ttyGS0"
BAUD = 9600

VALID_COMMANDS = {"NEUTRAL", "ANGRY", "SAD"}

_lock = threading.Lock()
_conn = None
_warned = False


def _get_connection():
    global _conn, _warned
    if serial is None:
        if not _warned:
            print("arduino_expression: pyserial not installed, expressions disabled", file=sys.stderr)
            _warned = True
        return None
    if _conn is not None and _conn.is_open:
        return _conn
    try:
        _conn = serial.Serial(PORT, BAUD, timeout=0.5)
        return _conn
    except (serial.SerialException, FileNotFoundError) as e:
        if not _warned:
            print(f"arduino_expression: could not open {PORT} ({e}), expressions disabled", file=sys.stderr)
            _warned = True
        return None


def send_expression(command: str) -> bool:
    """Sends one command (NEUTRAL/ANGRY/SAD) to the sketch. Returns whether
    it was actually sent -- False (not an exception) on any failure, so
    callers in the inference hot path don't need a try/except."""
    command = command.strip().upper()
    if command not in VALID_COMMANDS:
        raise ValueError(f"command must be one of {VALID_COMMANDS}, got {command!r}")

    with _lock:
        conn = _get_connection()
        if conn is None:
            return False
        try:
            conn.write(f"{command}\n".encode("ascii"))
            conn.flush()
            return True
        except serial.SerialException as e:
            print(f"arduino_expression: write failed ({e}), will retry connection next time", file=sys.stderr)
            global _conn
            _conn = None
            return False


if __name__ == "__main__":
    # Manual smoke test: python3 arduino_expression.py ANGRY
    cmd = sys.argv[1] if len(sys.argv) > 1 else "NEUTRAL"
    ok = send_expression(cmd)
    print(f"sent {cmd!r}: {ok}")
