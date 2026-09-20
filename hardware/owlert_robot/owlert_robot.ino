#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

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

  servo1.write(90);
  servo2.write(90);
  servo3.write(90);
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

  servo1.write(20);
  servo2.write(160);
  servo3.write(90);
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

  servo1.write(150);
  servo2.write(30);
  servo3.write(45);
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

void setup() {
  Wire.begin();
  lcd.begin(16, 2);
  lcd.backlight();
  lcd.clear();

  // Servos assigned to pins 0, 1, and 2
  servo1.attach(0);
  servo2.attach(1);
  servo3.attach(2);
}

void loop() {
  // 1. Neutral
  setNeutralExpression();
  delay(3000);
  blinkEyes();

  // 2. Angry
  setAngryExpression();
  delay(3000);
  blinkEyes();

  // 3. Sad
  setSadExpression();
  delay(3000);
  blinkEyes();
}
