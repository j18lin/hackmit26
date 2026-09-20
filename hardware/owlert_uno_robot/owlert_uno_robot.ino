// Owlert robot: Arduino/Elegoo UNO R3 (ATmega328P), NOT UNO Q.
// USB serial, 115200 baud, newline-terminated commands:
//   NEGATIVE -> randomly choose ANGRY/SAD (50/50) and move to that pose.
//   POSITIVE -> happy face for drinking water; hold the current motor positions.
//   NORMAL (or NEUTRAL) -> neutral blinking face; no new motor movement.
//   PING -> PONG (does not refresh the inference state).
// The laptop handles inference, the 3-minute threshold, and dashboard updates.

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>
#include <avr/pgmspace.h>
#include <string.h>

#if !defined(ARDUINO_AVR_UNO)
#error "Select Arduino AVR Boards > Arduino Uno, not Arduino UNO Q."
#endif

// Keep D0/D1 free: the Uno uses them for USB serial and uploading.
const uint8_t LEFT_PIN = 3;
const uint8_t RIGHT_PIN = 5;
const uint8_t NECK_PIN = 6;

// Shifted limits inward (downward) for top chassis clearance
const int LEFT_OUT = 80;
const int LEFT_REST = 99;
const int LEFT_IN = 110;

const int RIGHT_OUT = 96;
const int RIGHT_REST = 77;
const int RIGHT_IN = 65;

const bool NECK_ENABLED = true;

const int NECK_CENTER = 92;
const int NECK_SWING = 7;  // Preserve the latest calibrated movement.
const int NECK_MIN = NECK_CENTER - NECK_SWING;  // 85 degrees
const int NECK_MAX = NECK_CENTER + NECK_SWING;  // 99 degrees
const int NECK_ANGRY = NECK_MAX;
const int NECK_SAD = NECK_MIN;

const unsigned long SERVO_STEP_MS = 25;  // 25ms per degree for crisp, visible motion
const unsigned long STATE_TIMEOUT_MS = 15000;

// Blinking timing for neutral face
const unsigned long BLINK_INTERVAL_MS = 3500;
const unsigned long BLINK_DURATION_MS = 150;

static_assert(LEFT_OUT >= 0 && LEFT_OUT <= LEFT_REST && LEFT_REST <= LEFT_IN && LEFT_IN <= 180, "Invalid left arm limits");
static_assert(RIGHT_IN >= 0 && RIGHT_IN <= RIGHT_REST && RIGHT_REST <= RIGHT_OUT && RIGHT_OUT <= 180, "Invalid right arm limits");
static_assert(NECK_MIN >= 0 && NECK_MIN <= NECK_CENTER && NECK_CENTER <= NECK_MAX && NECK_MAX <= 180, "Invalid neck limits");
static_assert(NECK_ANGRY >= NECK_MIN && NECK_ANGRY <= NECK_MAX && NECK_SAD >= NECK_MIN && NECK_SAD <= NECK_MAX, "Neck poses exceed limits");
static_assert((NECK_CENTER - NECK_SWING >= NECK_MIN), "Neck swing exceeds min limit");
static_assert((NECK_CENTER + NECK_SWING <= NECK_MAX), "Neck swing exceeds max limit");

LiquidCrystal_I2C lcd27(0x27, 16, 2);
LiquidCrystal_I2C lcd3f(0x3F, 16, 2);
LiquidCrystal_I2C *display = nullptr;

Servo leftArm;
Servo rightArm;
Servo neck;
int leftPosition = LEFT_REST;
int rightPosition = RIGHT_REST;
int neckPosition = NECK_CENTER;
int leftTarget = LEFT_REST;
int rightTarget = RIGHT_REST;
int neckTarget = NECK_CENTER;

const uint8_t NORMAL_FACE = 0;
const uint8_t ANGRY_FACE = 1;
const uint8_t SAD_FACE = 2;
const uint8_t HAPPY_FACE = 3;
uint8_t currentFace = NORMAL_FACE;
bool negativeActive = false;
unsigned long lastServoMs = 0;
unsigned long lastStateMs = 0;

bool isBlinking = false;
unsigned long lastBlinkMs = 0;

const uint8_t eyeTops[3][6][8] PROGMEM = {
  { // Neutral / Normal
    {7, 15, 31, 31, 31, 31, 31, 31},
    {31, 31, 31, 31, 31, 31, 31, 31},
    {28, 30, 31, 31, 31, 31, 31, 31},
    {7, 15, 31, 31, 31, 31, 31, 31},
    {31, 31, 31, 31, 31, 31, 31, 31},
    {28, 30, 31, 31, 31, 31, 31, 31}
  },
  { // Angry
    {0, 24, 30, 31, 31, 31, 31, 31},
    {0, 0, 0, 16, 24, 31, 31, 31},
    {0, 0, 0, 0, 0, 0, 24, 31},
    {0, 0, 0, 0, 0, 0, 3, 31},
    {0, 0, 0, 1, 3, 31, 31, 31},
    {0, 3, 15, 31, 31, 31, 31, 31}
  },
  { // Sad
    {0, 0, 0, 0, 0, 1, 7, 31},
    {0, 0, 0, 3, 15, 31, 31, 31},
    {0, 7, 31, 31, 31, 31, 31, 31},
    {0, 28, 31, 31, 31, 31, 31, 31},
    {0, 0, 0, 24, 30, 31, 31, 31},
    {0, 0, 0, 0, 0, 16, 28, 31}
  }
};

void reportFace() {
  Serial.print(F("STATE "));
  if (currentFace == ANGRY_FACE) Serial.println(F("ANGRY"));
  else if (currentFace == SAD_FACE) Serial.println(F("SAD"));
  else if (currentFace == HAPPY_FACE) Serial.println(F("HAPPY"));
  else Serial.println(F("NORMAL"));
}

bool addressResponds(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void initDisplay() {
  Wire.begin();
  Wire.setWireTimeout(25000, true);
  if (addressResponds(0x27)) {
    display = &lcd27;
    Serial.println(F("LCD 0x27"));
  } else if (addressResponds(0x3F)) {
    display = &lcd3f;
    Serial.println(F("LCD 0x3F"));
  } else {
    Serial.println(F("WARN LCD_NOT_FOUND: check 5V/GND/A4/A5"));
    return;
  }
  display->init();
  display->backlight();
  display->clear();
}

void drawEyesClosed() {
  if (display == nullptr) return;
  for (uint8_t eye = 0; eye < 2; ++eye) {
    uint8_t column = (eye == 0) ? 1 : 12;
    display->setCursor(column, 0);
    display->print(F("   "));
    display->setCursor(column, 1);
    display->print(F("---"));
  }
}

void checkDisplayTimeout() {
  if (Wire.getWireTimeoutFlag()) {
    Wire.clearWireTimeoutFlag();
    display = nullptr;
    Serial.println(F("WARN LCD_TIMEOUT: display disabled until restart"));
  }
}

void drawHappyFace() {
  if (display == nullptr) return;
  // Three tiles make each raised, smiling eye; two tiles make the mouth.
  // Only five custom characters, within the display's eight-character limit.
  uint8_t eyeLeft[8] = {0, 0, 0, 1, 3, 6, 12, 24};
  uint8_t eyeMiddle[8] = {0, 14, 31, 17, 0, 0, 0, 0};
  uint8_t eyeRight[8] = {0, 0, 0, 16, 24, 12, 6, 3};
  uint8_t smileLeft[8] = {0, 16, 16, 8, 4, 3, 0, 0};
  uint8_t smileRight[8] = {0, 1, 1, 2, 4, 24, 0, 0};
  display->clear();
  display->createChar(0, eyeLeft);
  display->createChar(1, eyeMiddle);
  display->createChar(2, eyeRight);
  display->createChar(3, smileLeft);
  display->createChar(4, smileRight);
  for (uint8_t eye = 0; eye < 2; ++eye) {
    display->setCursor(eye == 0 ? 1 : 12, 0);
    for (uint8_t tile = 0; tile < 3; ++tile) display->write(tile);
  }
  display->setCursor(7, 1);
  display->write(static_cast<uint8_t>(3));
  display->write(static_cast<uint8_t>(4));
  checkDisplayTimeout();
}

void drawFace(uint8_t face) {
  if (display == nullptr) return;
  if (face == HAPPY_FACE) {
    drawHappyFace();
    return;  // HAPPY_FACE must not index the three-entry eyeTops array.
  }
  // Remove the happy mouth when restoring another expression.
  display->setCursor(7, 1);
  display->print(F("  "));
  uint8_t tile[8];
  for (uint8_t slot = 0; slot < 6; ++slot) {
    for (uint8_t row = 0; row < 8; ++row) {
      tile[row] = pgm_read_byte(&eyeTops[face][slot][row]);
    }
    display->createChar(slot, tile);
  }
  uint8_t bottomLeft[8] = {31, 31, 31, 31, 31, 31, 15, 7};
  uint8_t bottomRight[8] = {31, 31, 31, 31, 31, 31, 30, 28};
  display->createChar(6, bottomLeft);
  display->createChar(7, bottomRight);

  for (uint8_t eye = 0; eye < 2; ++eye) {
    uint8_t column = (eye == 0) ? 1 : 12;
    display->setCursor(column, 0);
    for (uint8_t part = 0; part < 3; ++part) {
      display->write(static_cast<uint8_t>(eye * 3 + part));
    }
    display->setCursor(column, 1);
    display->write(static_cast<uint8_t>(6));
    display->write(static_cast<uint8_t>(255));
    display->write(static_cast<uint8_t>(7));
  }
  checkDisplayTimeout();
}

void setFace(uint8_t face) {
  currentFace = face;
  isBlinking = false;
  lastBlinkMs = millis();

  if (face == ANGRY_FACE) {
    leftTarget = LEFT_OUT;
    rightTarget = RIGHT_OUT;
    neckTarget = NECK_ANGRY;
  } else if (face == SAD_FACE) {
    leftTarget = LEFT_IN;
    rightTarget = RIGHT_IN;
    neckTarget = NECK_SAD;
  } else {
    // Cancel any in-flight move without recentering or starting a new gesture.
    // These are last commanded positions, not measured physical feedback.
    leftTarget = leftPosition;
    rightTarget = rightPosition;
    neckTarget = neckPosition;
  }
  drawFace(face);
  reportFace();
}

void updateBlink(unsigned long now) {
  if (currentFace != NORMAL_FACE || display == nullptr) return;

  if (!isBlinking && (now - lastBlinkMs >= BLINK_INTERVAL_MS)) {
    isBlinking = true;
    lastBlinkMs = now;
    drawEyesClosed();
  } else if (isBlinking && (now - lastBlinkMs >= BLINK_DURATION_MS)) {
    isBlinking = false;
    lastBlinkMs = now;
    drawFace(NORMAL_FACE);
  }
}

void enableServosForNegative() {
  // Do not emit servo pulses at boot. Attach only on an explicit NEGATIVE.
  // The first negative can move from an unknown physical starting position.
  if (!leftArm.attached()) {
    leftArm.write(leftPosition);
    leftArm.attach(LEFT_PIN);
  }
  if (!rightArm.attached()) {
    rightArm.write(rightPosition);
    rightArm.attach(RIGHT_PIN);
  }
  if (NECK_ENABLED && !neck.attached()) {
    neck.write(neckPosition);
    neck.attach(NECK_PIN);
  }
}

void stepServo(Servo &motor, int &position, int target, int minimum, int maximum) {
  target = constrain(target, minimum, maximum);
  if (position == target) return;
  position += position < target ? 1 : -1;
  position = constrain(position, minimum, maximum);
  motor.write(position);
}

void updateServos(unsigned long now) {
  if (!negativeActive || (currentFace != ANGRY_FACE && currentFace != SAD_FACE)) return;
  if (now - lastServoMs < SERVO_STEP_MS) return;
  lastServoMs = now;
  stepServo(leftArm, leftPosition, leftTarget, LEFT_OUT, LEFT_IN);
  stepServo(rightArm, rightPosition, rightTarget, RIGHT_IN, RIGHT_OUT);
  if (NECK_ENABLED) stepServo(neck, neckPosition, neckTarget, NECK_MIN, NECK_MAX);
}

void handleCommand(char *command) {
  while (*command == ' ' || *command == '\t') ++command;
  size_t length = strlen(command);
  while (length && (command[length - 1] == ' ' || command[length - 1] == '\t')) {
    command[--length] = '\0';
  }
  for (size_t i = 0; i < length; ++i) {
    if (command[i] >= 'a' && command[i] <= 'z') command[i] -= 'a' - 'A';
  }
  if (length == 0) return;

  unsigned long now = millis();
  if (strcmp(command, "POSITIVE") == 0) {
    lastStateMs = now;
    negativeActive = false;
    if (currentFace != HAPPY_FACE) setFace(HAPPY_FACE);
    Serial.println(F("ACK POSITIVE"));
  } else if (strcmp(command, "NEGATIVE") == 0) {
    lastStateMs = now;
    // Seed once from the timing of the first incoming negative command.
    // No unconnected analog pin or extra sensor is required.
    static bool seeded = false;
    if (!seeded) {
      randomSeed(micros() | 1UL);
      seeded = true;
    }
    negativeActive = true;
    enableServosForNegative();
    setFace(random(2) == 0 ? ANGRY_FACE : SAD_FACE);
    Serial.println(F("ACK NEGATIVE"));
  } else if (strcmp(command, "NORMAL") == 0 || strcmp(command, "NEUTRAL") == 0) {
    lastStateMs = now;
    negativeActive = false;
    if (currentFace != NORMAL_FACE) setFace(NORMAL_FACE);
    Serial.println(F("ACK NORMAL"));
  } else if (strcmp(command, "PING") == 0) {
    Serial.println(F("PONG"));
  } else {
    Serial.println(F("ERR COMMAND: use NORMAL, NEGATIVE, POSITIVE, or PING"));
  }
}

char serialLine[24];
uint8_t serialLength = 0;
bool invalidLine = false;

void readCommands() {
  for (uint8_t count = 0; count < 32 && Serial.available() > 0; ++count) {
    char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (invalidLine) Serial.println(F("ERR INVALID_LINE"));
      else {
        serialLine[serialLength] = '\0';
        handleCommand(serialLine);
      }
      serialLength = 0;
      invalidLine = false;
    } else if (!invalidLine) {
      if ((c < 32 && c != '\t') || c > 126 || serialLength >= sizeof(serialLine) - 1) {
        invalidLine = true;
      } else {
        serialLine[serialLength++] = c;
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  // No servo attach/write calls here: neutral startup only draws the LCD.
  initDisplay();
  setFace(NORMAL_FACE);
  lastServoMs = millis();
  lastBlinkMs = millis();
  Serial.println(F("READY OWLERT_UNO 115200"));
  Serial.println(F("MODE NEUTRAL_STILL: servos start only on NEGATIVE"));
}

void loop() {
  readCommands();
  unsigned long now = millis();

  if (negativeActive && now - lastStateMs >= STATE_TIMEOUT_MS) {
    negativeActive = false;
    setFace(NORMAL_FACE);
    Serial.println(F("WARN STATE_TIMEOUT: neutral face, holding motor angles"));
  }

  // setFace() can reset the blink timer above; use a fresh timestamp.
  now = millis();
  updateBlink(now);
  updateServos(now);
}
