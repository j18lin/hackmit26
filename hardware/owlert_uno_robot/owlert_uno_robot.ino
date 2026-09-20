// Owlert robot: Arduino/Elegoo UNO R3 (ATmega328P)
// Startup demo: ANGRY -> NEUTRAL -> SAD -> NEUTRAL -> HAPPY -> NEUTRAL.
// SG90 positional neck servo: both expressions travel 79 <-> 101 degrees.
// Accepts laptop serial commands (NEGATIVE/POSITIVE/NORMAL/PING) and drives
// the same face+pose sequences the startup demo below uses.

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>
#include <avr/pgmspace.h>
#include <string.h>

#if !defined(ARDUINO_AVR_UNO)
#error "Select Arduino AVR Boards > Arduino Uno."
#endif

const uint8_t LEFT_PIN = 3;
const uint8_t RIGHT_PIN = 5;
const uint8_t NECK_PIN = 6;

// Arm limits
const int LEFT_OUT = 90;
const int LEFT_REST = 99;
const int LEFT_IN = 105;

const int RIGHT_OUT = 86;
const int RIGHT_REST = 77;
const int RIGHT_IN = 71;

const bool NECK_ENABLED = true;
const int NECK_CENTER = 90;
// Preserve the supplied range: 90 - 11 = 79, 90 + 11 = 101 degrees.
const int NECK_SHAKE_DELTA = 11;
const int NECK_SHAKE_DELTA2 = 6;
const int NECK_MIN = 75;
const int NECK_MAX = 105;

// Dropped to 12ms per degree for crisper, more apparent acceleration
const unsigned long SERVO_STEP_MS = 12;
const unsigned long ANGRY_NECK_STEP_MS = 12;
const unsigned long SAD_NECK_STEP_MS = 25;
const unsigned long NECK_SETTLE_MS = 200;
const unsigned long MOVE_TIMEOUT_MS = 3000;
const unsigned long BLINK_INTERVAL_MS = 3500;
const unsigned long BLINK_DURATION_MS = 150;

static_assert(LEFT_OUT >= 0 && LEFT_OUT <= LEFT_REST && LEFT_REST <= LEFT_IN && LEFT_IN <= 180, "Invalid left arm limits");
static_assert(RIGHT_IN >= 0 && RIGHT_IN <= RIGHT_REST && RIGHT_REST <= RIGHT_OUT && RIGHT_OUT <= 180, "Invalid right arm limits");
static_assert(NECK_MIN >= 0 && NECK_MIN <= (NECK_CENTER - NECK_SHAKE_DELTA), "Neck min limit exceeded");
static_assert(NECK_MAX >= (NECK_CENTER + NECK_SHAKE_DELTA) && NECK_MAX <= 180, "Neck max limit exceeded");

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

unsigned long lastServoMs = 0;
unsigned long lastNeckMs = 0;
unsigned long neckStepMs = ANGRY_NECK_STEP_MS;
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

bool addressResponds(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void initDisplay() {
  Wire.begin();
  Wire.setWireTimeout(25000, true);
  if (addressResponds(0x27)) display = &lcd27;
  else if (addressResponds(0x3F)) display = &lcd3f;
  else return;

  display->init();
  display->backlight();
  display->clear();
}

void drawEyesClosed() {
  if (!display) return;
  for (uint8_t eye = 0; eye < 2; ++eye) {
    uint8_t col = (eye == 0) ? 1 : 12;
    display->setCursor(col, 0);
    display->print(F("   "));
    display->setCursor(col, 1);
    display->print(F("---"));
  }
}

void drawHappyFace() {
  if (!display) return;
  // Raised smiling eye arches (clean look, no mouth)
  uint8_t eyeLeft[8]   = {0, 0, 0, 1, 3, 6, 12, 24};
  uint8_t eyeMiddle[8] = {0, 14, 31, 17, 0, 0, 0, 0};
  uint8_t eyeRight[8]  = {0, 0, 0, 16, 24, 12, 6, 3};

  display->clear();
  display->createChar(0, eyeLeft);
  display->createChar(1, eyeMiddle);
  display->createChar(2, eyeRight);

  for (uint8_t eye = 0; eye < 2; ++eye) {
    display->setCursor(eye == 0 ? 1 : 12, 0);
    for (uint8_t tile = 0; tile < 3; ++tile) display->write(tile);
  }
}

void drawFace(uint8_t face) {
  if (!display) return;
  if (face == HAPPY_FACE) {
    drawHappyFace();
    return;
  }

  display->clear();
  uint8_t tile[8];
  for (uint8_t slot = 0; slot < 6; ++slot) {
    for (uint8_t row = 0; row < 8; ++row) {
      tile[row] = pgm_read_byte(&eyeTops[face][slot][row]);
    }
    display->createChar(slot, tile);
  }
  uint8_t bottomLeft[8]  = {31, 31, 31, 31, 31, 31, 15, 7};
  uint8_t bottomRight[8] = {31, 31, 31, 31, 31, 31, 30, 28};
  display->createChar(6, bottomLeft);
  display->createChar(7, bottomRight);

  for (uint8_t eye = 0; eye < 2; ++eye) {
    uint8_t col = (eye == 0) ? 1 : 12;
    display->setCursor(col, 0);
    for (uint8_t part = 0; part < 3; ++part) {
      display->write(static_cast<uint8_t>(eye * 3 + part));
    }
    display->setCursor(col, 1);
    display->write(static_cast<uint8_t>(6));
    display->write(static_cast<uint8_t>(255));
    display->write(static_cast<uint8_t>(7));
  }
}

void initServos() {
  leftArm.write(LEFT_REST);
  rightArm.write(RIGHT_REST);
  leftArm.attach(LEFT_PIN);
  rightArm.attach(RIGHT_PIN);

  if (NECK_ENABLED) {
    neck.write(NECK_CENTER);
    neck.attach(NECK_PIN);
  }
}

void stepServo(Servo &motor, int &position, int target, int minimum, int maximum) {
  target = constrain(target, minimum, maximum);
  if (position == target) return;
  position += (position < target) ? 1 : -1;
  position = constrain(position, minimum, maximum);
  motor.write(position);
}

void updateServosSmooth() {
  // Neutral and happy never command movement, including recentering.
  if (currentFace != ANGRY_FACE && currentFace != SAD_FACE) return;
  unsigned long now = millis();
  if (now - lastServoMs >= SERVO_STEP_MS) {
    lastServoMs = now;
    stepServo(leftArm, leftPosition, leftTarget, LEFT_OUT, LEFT_IN);
    stepServo(rightArm, rightPosition, rightTarget, RIGHT_IN, RIGHT_OUT);
  }
  if (NECK_ENABLED && now - lastNeckMs >= neckStepMs) {
    lastNeckMs = now;
    stepServo(neck, neckPosition, neckTarget, NECK_MIN, NECK_MAX);
  }
}

void holdPose(unsigned long durationMs) {
  unsigned long start = millis();
  while (millis() - start < durationMs) {
    updateServosSmooth();
    updateBlink(millis());
  }
}

bool moveNeckTo(int target) {
  neckTarget = constrain(target, NECK_MIN, NECK_MAX);
  Serial.print(F("NECK target="));
  Serial.println(neckTarget);
  unsigned long startedMs = millis();
  // Wait for the software ramp to finish before reversing. This tracks
  // commanded angles only: an SG90 provides no physical position feedback.
  while (NECK_ENABLED && neckPosition != neckTarget) {
    if (millis() - startedMs >= MOVE_TIMEOUT_MS) {
      neckTarget = neckPosition;
      Serial.println(F("WARN neck command ramp timed out"));
      return false;
    }
    updateServosSmooth();
  }
  holdPose(NECK_SETTLE_MS);
  return true;
}

// Snappy, energetic head shake for ANGRY
void shakeAngry(uint8_t shakes) {
  shakeSad(shakes);
}

// Same endpoints, but slower, deliberate head shake for SAD.
void shakeSad(uint8_t shakes) {
  neckStepMs = SAD_NECK_STEP_MS;
  leftTarget = LEFT_IN;
  rightTarget = RIGHT_IN;

  for (uint8_t i = 0; i < shakes; ++i) {
    leftTarget = LEFT_OUT;
    rightTarget = RIGHT_OUT;
    if (!moveNeckTo(NECK_CENTER - NECK_SHAKE_DELTA)) return;

    leftTarget = LEFT_IN;
    rightTarget = RIGHT_IN;
    if (!moveNeckTo(NECK_CENTER + NECK_SHAKE_DELTA + 10)) return;
  }
  moveNeckTo(NECK_CENTER); // Finish recentering while still sad.
}

void setFaceAndPose(uint8_t face) {
  currentFace = face;
  isBlinking = false;
  lastBlinkMs = millis();
  drawFace(face);

  if (face == ANGRY_FACE || face == SAD_FACE) {
    if (!leftArm.attached()) {
      initServos();
      holdPose(400); // Let the first center command settle before shaking.
    }
  }
  if (face == ANGRY_FACE) {
    Serial.println(F("STATE ANGRY"));
    shakeAngry(10);
  } else if (face == SAD_FACE) {
    Serial.println(F("STATE SAD"));
    shakeSad(10);
  } else { // NORMAL_FACE or HAPPY_FACE: freeze, do not recenter.
    leftTarget = leftPosition;
    rightTarget = rightPosition;
    neckTarget = neckPosition;
    Serial.println(face == HAPPY_FACE ? F("STATE HAPPY") : F("STATE NORMAL"));
  }
}

void updateBlink(unsigned long now) {
  if (currentFace != NORMAL_FACE || !display) return;

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

// --- laptop serial control ---------------------------------------------
// The host (server/mood.js via server/arduino.js) decides the mood from the
// live habit densities and sends one line at a time, 115200 baud:
//   NEGATIVE  -> alternates ANGRY/SAD so repeats don't look identical
//   POSITIVE  -> happy
//   NORMAL / NEUTRAL -> resting face
//   PING      -> PONG
// Each command runs the same setFaceAndPose() the startup demo uses, so the
// arm/neck sequences are exactly the ones tuned here.
char serialLine[24];
uint8_t serialLength = 0;
bool overflowed = false;
bool lastNegativeWasAngry = false;

void handleCommand(char *command) {
  for (char *c = command; *c; ++c)
    if (*c >= 'a' && *c <= 'z') *c -= 'a' - 'A';

  if (strcmp(command, "NEGATIVE") == 0) {
    // Alternate rather than random: a repeated scolding still varies, but
    // stays reproducible when demoing.
    lastNegativeWasAngry = !lastNegativeWasAngry;
    setFaceAndPose(lastNegativeWasAngry ? ANGRY_FACE : SAD_FACE);
    Serial.println(F("ACK NEGATIVE"));
  } else if (strcmp(command, "POSITIVE") == 0) {
    setFaceAndPose(HAPPY_FACE);
    Serial.println(F("ACK POSITIVE"));
  } else if (strcmp(command, "NORMAL") == 0 || strcmp(command, "NEUTRAL") == 0) {
    setFaceAndPose(NORMAL_FACE);
    Serial.println(F("ACK NORMAL"));
  } else if (strcmp(command, "PING") == 0) {
    Serial.println(F("PONG"));
  } else {
    Serial.println(F("ERR COMMAND: use NORMAL, NEGATIVE, POSITIVE, or PING"));
  }
}

void readCommands() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLength > 0 && !overflowed) {
        serialLine[serialLength] = '\0';
        handleCommand(serialLine);
      }
      serialLength = 0;
      overflowed = false;
      continue;
    }
    // Drop anything over-long rather than wrapping it into a stray command.
    if (serialLength >= sizeof(serialLine) - 1) {
      overflowed = true;
      continue;
    }
    serialLine[serialLength++] = c;
  }
}

void setup() {
  Serial.begin(115200);
  initDisplay();
  Serial.println(F("MODE SERIAL_CONTROLLED"));
  Serial.println(F("READY OWLERT_UNO 115200"));

  // // 1. ANGRY (snappy head shake, arms out)
  // setFaceAndPose(ANGRY_FACE);
  // holdPose(4500);

  // // 2. NEUTRAL (steady hold, eyes blink)
  // setFaceAndPose(NORMAL_FACE);
  // holdPose(2500);

  // // 3. SAD (slow deliberate head shake, arms in)
  // setFaceAndPose(SAD_FACE);
  // holdPose(4500);

  // // 4. NEUTRAL (steady hold, eyes blink)
  // setFaceAndPose(NORMAL_FACE);
  // holdPose(2500);

  // // 5. HAPPY (smiling arched eyes)
  // setFaceAndPose(HAPPY_FACE);
  // holdPose(3000);

  // Settle back to NEUTRAL permanently
  setFaceAndPose(NORMAL_FACE);
  lastBlinkMs = millis();
}

void loop() {
  unsigned long now = millis();
  readCommands();
  updateServosSmooth();
  updateBlink(now);
}
