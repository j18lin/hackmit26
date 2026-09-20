// Drives the Elegoo/Arduino Uno R3 face-and-servo robot (see
// hardware/owlert_robot/owlert_robot.ino) over USB serial from whichever
// machine runs this backend. Newline-terminated ASCII commands, 115200 baud:
// NEGATIVE (alternates ANGRY/SAD, auto-reverts to NORMAL after 15s without a
// fresh NEGATIVE), POSITIVE (happy), NORMAL/NEUTRAL, PING -> PONG. Entirely
// optional: with no ARDUINO_SERIAL_PORT set, every function below is a no-op.
import { SerialPort } from "serialport";

const path = process.env.ARDUINO_SERIAL_PORT;
const baudRate = Number(process.env.ARDUINO_BAUD_RATE) || 115200;

let port = null;
if (path) {
  port = new SerialPort({ path, baudRate, autoOpen: true }, (error) => {
    if (error)
      console.error(`Arduino serial port ${path} failed to open:`, error.message);
  });
  // A SerialPort with no "error" listener throws on the next error event and
  // crashes the process (e.g. the cable gets unplugged mid-session).
  port.on("error", (error) => console.error("Arduino serial error:", error.message));
}

export function arduinoConfigured() {
  return Boolean(port);
}

function send(command) {
  if (!port || !port.isOpen) return false;
  port.write(`${command}\n`);
  return true;
}

// Drinking water is the one tracked field that's a good thing — it's stored
// alongside the others for counting, but the robot should be pleased about
// it rather than scolding.
const POSITIVE_FIELDS = new Set(["drinkingWater"]);

export function reactToViolation(field) {
  return send(POSITIVE_FIELDS.has(field) ? "POSITIVE" : "NEGATIVE");
}

export function reactPositive() {
  return send("POSITIVE");
}

// The sketch's entire vocabulary. There is deliberately no ANGRY/SAD here:
// the board picks between those two faces itself on NEGATIVE.
const EXPRESSIONS = new Set(["NEGATIVE", "NORMAL", "NEUTRAL", "POSITIVE"]);

export function sendExpression(expression) {
  if (!EXPRESSIONS.has(expression))
    throw new Error(`unknown expression: ${expression}`);
  return send(expression);
}

export function resetExpression() {
  return send("NORMAL");
}
