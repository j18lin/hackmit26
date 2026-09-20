# Owlert hardware

## LCD eyes and servo expression demo

Open `owlert_robot/owlert_robot.ino` in Arduino IDE. The sketch is saved as supplied; the folder and sketch names match so Arduino IDE can open it directly.

The demo cycles through neutral, angry, and sad expressions, blinking between them. It uses:

- `Wire`, `LiquidCrystal_I2C`, and `Servo` libraries.
- A 16×2 I²C LCD at address `0x27`.
- Three servo signal pins: **D0**, **D1**, and **D2**, as specified in the supplied sketch.

The LCD initialization is `lcd.begin(16, 2)`. Use a compatible `LiquidCrystal_I2C` library; variants can have different initialization methods.

This is a standalone expression demo. It does not send events to the website or include temperature sensing. Compilation and physical operation have not been verified on a connected board.
