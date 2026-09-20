# Owlert hardware

## Current robot: separate Uno R3

Use [`owlert_uno_robot/owlert_uno_robot.ino`](owlert_uno_robot/owlert_uno_robot.ino)
for the **Arduino/Elegoo Uno R3 robot**, not the UNO Q. It receives laptop USB
serial commands, controls the 16×2 I2C LCD and three servos, and alternates
angry/sad while a negative habit state is active. See the
[wiring, limits, and serial protocol](owlert_uno_robot/README.md).

The UNO Q can run inference independently; the laptop forwards its results
to the dashboard and this separate robot. That forwarding is not implemented
by the robot sketch.

## Legacy expression sketch (not for this setup)

`owlert_robot/owlert_robot.ino` is retained for reference. Use the new
`owlert_uno_robot` sketch above for the separate Uno R3 robot.

The legacy sketch receives `NEUTRAL`, `ANGRY`, and `SAD` at 9600 baud. It uses:

- `Wire`, `LiquidCrystal_I2C`, and `Servo` libraries.
- A 16×2 I²C LCD at address `0x27`.
- Disabled servo attach/write calls. Its old D0/D1/D2 assignments must not be
  reused for this USB-serial Uno R3 setup.

The LCD initialization is `lcd.begin(16, 2)`. Use a compatible `LiquidCrystal_I2C` library; variants can have different initialization methods.

The legacy code does not send events to the website or include temperature
sensing. Its older UNO Q bridge comments are not instructions for the new
Uno R3 USB connection.
