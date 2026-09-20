// Required for Serial to reach the Linux side of the UNO Q. Without it,
// `Serial` is the USB-CDC port (or a no-op stub) and nothing the sketch
// prints or reads ever touches arduino-router -- the board overlay says as
// much: `arduino,router-serial = <&lpuart1>; /* 'Serial' is provided by the
// Monitor */`. With it, `Serial` IS the bridge monitor.
#include <Arduino_RouterBridge.h>

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

// Common HD44780 I2C backpacks are 0x27 or 0x3F. scanI2C() reports what's
// actually on the bus, so this is checkable rather than assumed.
#define LCD_ADDR 0x27
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

// Set once the I2C scan actually finds the display. Everything that draws
// checks this first: if no display ACKs, we must not call into
// LiquidCrystal_I2C at all, because those Wire calls can block forever and
// wedge the MCU (which also makes the board hard to re-flash).
bool lcdPresent = false;

Servo servo1;
Servo servo2;
Servo servo3;

// --- Base Rounded Corners ---
byte fillTL[8] = { B00111, B01111, B11111, B11111, B11111, B11111, B11111, B11111 };
byte fillTR[8] = { B11100, B11110, B11111, B11111, B11111, B11111, B11111, B11111 };
byte fillBL[8] = { B11111, B11111, B11111, B11111, B11111, B11111, B01111, B00111 };
byte fillBR[8] = { B11111, B11111, B11111, B11111, B11111, B11111, B11110, B11100 };
byte lidBar[8] = { B11111, B11111, B00000, B00000, B00000, B00000, B00000, B00000 };

// --- Emotional upper eyelids ---
byte angryOuterL[8] = { B00000, B11000, B11110, B11111, B11111, B11111, B11111, B11111 };
byte angryMidL[8]   = { B00000, B00000, B00000, B10000, B11000, B11111, B11111, B11111 };
byte angryInnerL[8] = { B00000, B00000, B00000, B00000, B00000, B00000, B11000, B11111 };
byte angryInnerR[8] = { B00000, B00000, B00000, B00000, B00000, B00000, B00011, B11111 };
byte angryMidR[8]   = { B00000, B00000, B00000, B00001, B00111, B11111, B11111, B11111 };
byte angryOuterR[8] = { B00000, B00011, B01111, B11111, B11111, B11111, B11111, B11111 };

byte sadOuterL[8]   = { B00000, B00000, B00000, B00000, B00000, B00001, B00111, B11111 };
byte sadMidL[8]     = { B00000, B00000, B00000, B00011, B01111, B11111, B11111, B11111 };
byte sadInnerL[8]   = { B00000, B00111, B11111, B11111, B11111, B11111, B11111, B11111 };
byte sadInnerR[8]   = { B00000, B11100, B11111, B11111, B11111, B11111, B11111, B11111 };
byte sadMidR[8]     = { B00000, B00000, B00000, B11000, B11110, B11111, B11111, B11111 };
byte sadOuterR[8]   = { B00000, B00000, B00000, B00000, B00000, B10000, B11100, B11111 };

void setNeutralExpression() {
  lcd.createChar(0, fillTL);
  lcd.createChar(1, fillTR);
  lcd.createChar(2, fillBL);
  lcd.createChar(3, fillBR);

  // Left Eye (Columns 1, 2, 3)
  lcd.setCursor(1, 0); lcd.write(0);
  lcd.setCursor(2, 0); lcd.write(255);
  lcd.setCursor(3, 0); lcd.write(1);
  lcd.setCursor(1, 1); lcd.write(2);
  lcd.setCursor(2, 1); lcd.write(255);
  lcd.setCursor(3, 1); lcd.write(3);

  // Right Eye (Columns 12, 13, 14)
  lcd.setCursor(12, 0); lcd.write(0);
  lcd.setCursor(13, 0); lcd.write(255);
  lcd.setCursor(14, 0); lcd.write(1);
  lcd.setCursor(12, 1); lcd.write(2);
  lcd.setCursor(13, 1); lcd.write(255);
  lcd.setCursor(14, 1); lcd.write(3);

  // servo movement disabled for now -- see setup()
  // servo1.write(90);
  // servo2.write(90);
  // servo3.write(90);
}

void setAngryExpression() {
  lcd.createChar(0, angryOuterL);
  lcd.createChar(1, angryMidL);
  lcd.createChar(2, angryInnerL);
  lcd.createChar(3, angryInnerR);
  lcd.createChar(4, angryMidR);
  lcd.createChar(5, angryOuterR);
  lcd.createChar(6, fillBL);
  lcd.createChar(7, fillBR);

  // Left Eye
  lcd.setCursor(1, 0); lcd.write(0);
  lcd.setCursor(2, 0); lcd.write(1);
  lcd.setCursor(3, 0); lcd.write(2);
  lcd.setCursor(1, 1); lcd.write(6);
  lcd.setCursor(2, 1); lcd.write(255);
  lcd.setCursor(3, 1); lcd.write(7);

  // Right Eye
  lcd.setCursor(12, 0); lcd.write(3);
  lcd.setCursor(13, 0); lcd.write(4);
  lcd.setCursor(14, 0); lcd.write(5);
  lcd.setCursor(12, 1); lcd.write(6);
  lcd.setCursor(13, 1); lcd.write(255);
  lcd.setCursor(14, 1); lcd.write(7);

  // servo movement disabled for now -- see setup()
  // servo1.write(20);
  // servo2.write(160);
  // servo3.write(90);
}

void setSadExpression() {
  lcd.createChar(0, sadOuterL);
  lcd.createChar(1, sadMidL);
  lcd.createChar(2, sadInnerL);
  lcd.createChar(3, sadInnerR);
  lcd.createChar(4, sadMidR);
  lcd.createChar(5, sadOuterR);
  lcd.createChar(6, fillBL);
  lcd.createChar(7, fillBR);

  // Left Eye
  lcd.setCursor(1, 0); lcd.write(0);
  lcd.setCursor(2, 0); lcd.write(1);
  lcd.setCursor(3, 0); lcd.write(2);
  lcd.setCursor(1, 1); lcd.write(6);
  lcd.setCursor(2, 1); lcd.write(255);
  lcd.setCursor(3, 1); lcd.write(7);

  // Right Eye
  lcd.setCursor(12, 0); lcd.write(3);
  lcd.setCursor(13, 0); lcd.write(4);
  lcd.setCursor(14, 0); lcd.write(5);
  lcd.setCursor(12, 1); lcd.write(6);
  lcd.setCursor(13, 1); lcd.write(255);
  lcd.setCursor(14, 1); lcd.write(7);

  // servo movement disabled for now -- see setup()
  // servo1.write(150);
  // servo2.write(30);
  // servo3.write(45);
}

void blinkEyes() {
  lcd.createChar(6, lidBar);

  lcd.setCursor(1, 0);  lcd.print("   ");
  lcd.setCursor(12, 0); lcd.print("   ");

  lcd.setCursor(1, 1);  lcd.write(6);
  lcd.setCursor(2, 1);  lcd.write(6);
  lcd.setCursor(3, 1);  lcd.write(6);

  lcd.setCursor(12, 1); lcd.write(6);
  lcd.setCursor(13, 1); lcd.write(6);
  lcd.setCursor(14, 1); lcd.write(6);

  delay(200);
}

// Driven by the Linux side over the Arduino UNO Q's built-in Linux<->MCU
// serial bridge (/dev/ttyGS0 on the Linux side -- see
// hardware/cv/bench/arduino_expression.py), instead of the old fixed
// neutral/angry/sad demo loop. One command per line, case-insensitive:
//   NEUTRAL | ANGRY | SAD
// Unknown/partial lines are ignored. Starts neutral so the robot isn't
// stuck blank before the first command arrives.
String serialLine;

// Until the first serial command arrives, cycle the expressions on a timer.
// That way the LCD proves itself on its own: if the face never changes after
// a flash, the problem is the display/I2C/wiring, not the serial bridge.
bool commandReceived = false;
unsigned long lastDemoTick = 0;
int demoIndex = 0;
const unsigned long DEMO_INTERVAL_MS = 2000;

void showExpression(int index) {
  if (!lcdPresent) return;
  switch (index % 3) {
    case 0: setNeutralExpression(); break;
    case 1: setAngryExpression();   break;
    case 2: setSadExpression();     break;
  }
}

void handleCommand(const String &command) {
  if (command == "ANGRY") {
    if (lcdPresent) setAngryExpression();
  } else if (command == "SAD") {
    if (lcdPresent) setSadExpression();
  } else if (command == "NEUTRAL") {
    if (lcdPresent) setNeutralExpression();
  } else {
    // unrecognized commands are ignored rather than erroring, so a stray
    // partial line from the bridge can't wedge the expression state
    Serial.print("owlert: ignored '");
    Serial.print(command);
    Serial.println("'");
    return;
  }
  commandReceived = true;  // stop the boot demo, serial is driving now
  Serial.print("owlert: ");
  Serial.println(command);
}

// Scan the bus and report every address that answers, so the display's real
// address is a fact rather than the hardcoded 0x27 guess.
void scanI2C() {
  Serial.println("owlert: scanning i2c...");
  int found = 0;
  for (uint8_t addr = 0x08; addr < 0x78; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      found++;
      Serial.print("owlert: i2c device at 0x");
      Serial.println(addr, HEX);
      if (addr == LCD_ADDR) lcdPresent = true;
    }
  }
  Serial.print("owlert: i2c devices found = ");
  Serial.println(found);
  Serial.print("owlert: lcd at 0x");
  Serial.print(LCD_ADDR, HEX);
  Serial.println(lcdPresent ? " PRESENT" : " NOT FOUND");
}

void setup() {
  // Bridge/Serial first, before any I2C, so we still get diagnostics out
  // even if the bus is dead.
  Bridge.begin();
  Serial.begin(115200);
  Serial.println("owlert: ready");

  Wire.begin();
  scanI2C();

  if (!lcdPresent) {
    Serial.println("owlert: no LCD -- skipping display init");
    return;
  }

  // Servo movement disabled for now -- attach calls commented out along
  // with the .write() calls in the expression functions above, so the
  // servos stay untouched/unpowered-by-this-sketch.
  // servo1.attach(0);
  // servo2.attach(1);
  // servo3.attach(2);

  lcd.begin(16, 2);
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("owlert ready");
  delay(1000);
  lcd.clear();
  setNeutralExpression();
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      serialLine.trim();
      serialLine.toUpperCase();
      if (serialLine.length() > 0) handleCommand(serialLine);
      serialLine = "";
    } else if (c != '\r') {
      serialLine += c;
    }
  }

  if (!commandReceived && millis() - lastDemoTick >= DEMO_INTERVAL_MS) {
    lastDemoTick = millis();
    showExpression(demoIndex++);
    // Heartbeat on the same link, so the Linux side can confirm the MCU is
    // alive and talking even before any command works.
    Serial.println("owlert: demo tick");
  }
}
