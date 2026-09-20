# Owlert robot — Arduino / Elegoo Uno R3

This sketch controls the **separate ATmega328P Uno R3 robot**, not the UNO Q.
It needs no RouterBridge, Zephyr, Wi-Fi, or inference model.

The intended flow is laptop camera → UNO Q inference → results back to laptop.
The laptop evaluates sustained habits, updates the dashboard, and sends the
current robot state over a separate USB connection to the Uno R3. This sketch
implements only that last robot endpoint; it does not wire up the inference
client or dashboard automatically. The old `cv/bench/arduino_expression.py`
targets the Q's internal bridge and is **not** the sender for this new sketch.

## Wiring and power

Power off before changing wiring. Leave D0 and D1 unconnected: the Uno uses
those pins for its USB serial link and uploading.

| Connection | Uno R3 / supply |
| --- | --- |
| Left arm servo signal | D3 |
| Right arm servo signal | D5 |
| Neck servo signal | D6 |
| LCD SDA | A4 (or the Uno's SDA header) |
| LCD SCL | A5 (or the Uno's SCL header) |
| LCD VCC / GND | Uno 5V / GND |
| All servo power wires | External regulated supply at your servos' rated voltage |
| All servo grounds | External supply GND **and** Uno GND |
| Laptop connection | Uno USB-B port, using a data cable |

Do not power three servos from the Uno's 5V pin, GPIO pins, a rectangular 9V
battery, or an unverified breadboard power module. For 5V-rated servos, use a
regulated 5V supply sized for the **combined stall current** of all three.
Keep the external servo positive rail separate from the USB-powered Uno's 5V
rail; connect grounds together. See [Arduino's servo power guidance](https://docs.arduino.cc/learn/electronics/servo-motors/).

## Angles

| Pose | Left arm | Right arm | Neck |
| --- | --- | --- | --- |
| Neutral | Hold current position; no startup signal | Hold current position; no startup signal | Hold current position; no startup signal |
| Happy / drinking water | Hold current position | Hold current position | Hold current position |
| Angry / arms out | 80° | 96° | 99° |
| Sad / arms in | 110° | 65° | 85° |

Every subsequent move is limited to one degree per 25 ms, with arm commands
clamped to your supplied limits. Servo outputs remain unattached at startup
until the first `NEGATIVE` command; neutral boot never commands a center pose.
**The first NEGATIVE can move from an unknown physical position** when the
outputs attach (initial commanded reference: left 99°, right 77°, neck 92°).
Servo write angles are commands,
not measurements or force limits.

The neck preserves the latest pasted sketch's 92° center. `NECK_SWING = 7` sets
both the movement and software limits to **85–99°**, 7° either side.
There is no neutral idle motion, neck sweep, or return-to-center movement.
Only negative reactions command movement. Physical left/right depends on mounting.
Software limits do not establish mechanical clearance.
Disconnect the neck linkage for the first test; verify the actual center and
safe travel before reconnecting. Adjust `NECK_CENTER` and `NECK_SWING` after
calibration; the limits and alert poses are derived from them. Set `NECK_ENABLED = false`
to disable the neck signal (this does not disconnect its power).

## Install and upload

Compile-checked for `arduino:avr:uno` with Arduino AVR Boards 1.8.8,
Servo 1.3.0, and LiquidCrystal I2C 1.1.2. Not uploaded or physically tested.
The all-warnings build
reports unused-parameter warnings in the existing LCD library and AVR core,
not in this sketch.

1. Open `owlert_uno_robot.ino` in Arduino IDE.
2. Select **Tools → Board → Arduino AVR Boards → Arduino Uno**, **not UNO Q**.
3. Install **Servo by Arduino** and **LiquidCrystal I2C by Frank de Brabander**
   (tested API: version 1.1.2). `Wire` comes with the AVR board package.
4. Select the port that appears when plugging in this Uno R3, then Upload.
   Do not choose the laptop's Intel AMT port merely because it says COM3.
5. Open Serial Monitor at **115200 baud** with **Newline** selected.

The LCD code matches the previous **16×2 HD44780 I2C display**. It tries `0x27`
then `0x3F`, prints the responding address, and starts with neutral eyes that
blink: open for 3.5 seconds, closed for 150 ms, then open again. This is the
default even before any laptop command arrives. Blinking uses timers rather
than animation delays, so serial handling and servo updates continue.
An I2C response cannot identify the device model; the connected display must
be this compatible type. If neither address responds, it logs
`WARN LCD_NOT_FOUND` and still runs the servos/serial. An I2C timeout disables
the display until restart. If the backlight is on but the face is invisible,
adjust the backpack's contrast potentiometer. Only eight custom glyphs are
used at once, within this LCD's hardware limit.

## Commands and behavior

Send ASCII commands terminated by a newline (`\n`). Case-insensitive;
CRLF is also accepted. Keep one USB serial connection open for the session.

| Command | Result |
| --- | --- |
| `NORMAL` or `NEUTRAL` | Neutral blinking face; stop new movement and hold the current angles |
| `NEGATIVE` | A fresh 50/50 random choice of angry or sad, with the matching arm/neck pose |
| `POSITIVE` | Happy squinting eyes and a smile; stop new movement and hold current motor positions |
| `PING` | Reply `PONG`; no movement or state change |

Resend `NEGATIVE` at least every 15 seconds while the negative condition is
active (once per second is fine). **Every received `NEGATIVE` makes a new
50/50 choice**, including repeated updates. It is not strict alternation:
two or more commands can choose the same face in a row. The motors ease to
the chosen pose and hold there; choosing the same pose again does not force
an extra movement. There is no automatic angry/sad face cycle.
Repeated `NORMAL` messages do not restart or suppress the blink timer.
An incoming `NEGATIVE` cancels an in-progress blink immediately; blinking is
only active in the neutral state.

`POSITIVE` stops a negative reaction; `NEGATIVE` interrupts the happy face.
`NORMAL` restores neutral blinking without recentering or moving. Repeated `POSITIVE`
messages do not redraw the face or move the servos. A single `POSITIVE`
holds the happy face and stops issuing new servo angles until another state
command arrives or the board resets. There is no positive-state timeout that
would unexpectedly change the face. After the first negative reaction, servos remain powered and
hold their last commanded angles; this is not a motor power-off or an instant
physical brake. An already-moving servo may finish settling to that angle.
The laptop must decide the desired state when habits overlap; the last valid
state command wins. Send positive for a drinking event, not simply because
a bottle is visible. This firmware does not infer drinking itself.

After 15 seconds without a valid state update while negative, the
robot shows neutral, freezes its motor targets, and prints `WARN STATE_TIMEOUT`.
It does not move back to a center/rest pose. This is a mechanical
fallback, **not evidence that the habit has stopped**. `PING`, unknown
commands, partial lines, and malformed/oversized lines do not renew the
state timeout. A full robot restart begins neutral and blinking, as does
returning to rest after a timeout.

The sketch replies `ACK NORMAL`, `ACK NEGATIVE`, or `ACK POSITIVE`, reports expression changes
with `STATE NORMAL`, `STATE ANGRY`, `STATE SAD`, or `STATE HAPPY`, and prints
`READY OWLERT_UNO 115200` after startup. Test by sending `NEGATIVE` in Serial
Monitor: observe either angry or sad with its corresponding pose, then timeout
at 15 seconds unless you resend. `NORMAL` ends the reaction without issuing
further angle changes. There are no blocking animation delays in `loop()`.

To test drinking water without inference: send `POSITIVE` in Serial Monitor
at 115200 baud with Newline enabled. The happy face appears immediately and
motor targets freeze at their current commanded positions. Wait more than
15 seconds and verify it remains happy and still. Send `NORMAL` to resume
neutral blinking only. Test `POSITIVE` → `NEGATIVE` → `NORMAL` to check that the smile
is cleared and the existing expressions/blinking are restored.

After uploading this version, Serial Monitor should report
`MODE NEUTRAL_STILL: servos start only on NEGATIVE` after the READY line.
Leave it running without laptop commands: only the eyes should blink.
If it still performs repeated gestures, check that this exact sketch was
uploaded and the laptop is not sending `NEGATIVE` commands. An unpowered or
unattached servo can move under gravity; this code is not a physical brake.

## Laptop integration example (Python)

Install `pyserial` in the laptop project's environment (`python -m pip install
pyserial`). Close Arduino Serial Monitor before opening the port from Python.
Opening a Uno serial port commonly resets it; wait for `READY` before sending.
Replace `COM7` below with the **actual Uno R3 port**.

```python
import time
import serial

robot = serial.Serial("COM7", 115200, timeout=0.2, write_timeout=1)
deadline = time.monotonic() + 10
while time.monotonic() < deadline:
    if robot.readline().strip() == b"READY OWLERT_UNO 115200":
        break
else:
    robot.close()
    raise RuntimeError("Robot did not become ready; check port/baud/wiring")

def send_robot_state(state: str):
    if state not in {"NORMAL", "NEGATIVE", "POSITIVE"}:
        raise ValueError("Unknown robot state")
    robot.write((state + "\n").encode("ascii"))
    # Drain ACK / STATE / WARN lines regularly in the application's serial reader.
    while robot.in_waiting:
        print(robot.readline().decode("ascii", errors="replace").strip())

# In your laptop's inference-results loop (at least once per second):
# negative = phone_visible_duration_seconds > 180 or another_habit_is_negative
# send_robot_state("NEGATIVE" if negative else "NORMAL")
# For a confirmed drinking event, choose "POSITIVE" instead for your desired
# celebration duration. Send only one chosen state each update, not POSITIVE
# immediately followed by NORMAL (which would cancel the happy face).
# Send the corresponding event to the dashboard separately, once per incident.
# Reset phone duration when the phone is absent; do not count stale/error frames
# as fresh detections. On camera/inference failure, stop refreshing negative
# state and surface an offline/error status in the dashboard.

# Close robot only when the application exits, not after each message.
```

This is an integration example, not a complete webcam/inference client.
The robot does **not** count phone frames, measure three minutes, or publish
dashboard events; those decisions belong to the laptop.
