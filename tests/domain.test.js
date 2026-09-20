import test from "node:test";
import assert from "node:assert/strict";
import { owlify } from "../server/voice.js";
import {
  validateHabit,
  quietNow,
  dayKey,
  validateSubscription,
  validateSensorReading,
  tmp117ToCelsius,
  streakDurationMs,
  createChallenge,
  parseSpokenNumber,
  checkChallengeAnswer,
} from "../server/domain.js";
const habit = {
  name: " Slouching ",
  category: "posture",
  description: " Reset ",
  dailyLimit: 4,
  reminderMinutes: 30,
};
test("habit validation enforces usable limits and reminder intervals", () => {
  assert.equal(validateHabit(habit).name, "Slouching");
  assert.equal(validateHabit(habit).active, true);
  for (const update of [
    { dailyLimit: 0 },
    { dailyLimit: 1.5 },
    { reminderMinutes: 1 },
    { category: "bad" },
    { name: "" },
  ])
    assert.throws(() => validateHabit({ ...habit, ...update }));
  assert.equal(
    validateHabit({ ...habit, reminderMinutes: 0 }).reminderMinutes,
    0,
  );
});
test("workspace day boundaries use its timezone, not UTC", () => {
  assert.equal(
    dayKey("2026-09-19T02:00:00Z", "America/New_York"),
    "2026-09-18",
  );
  assert.equal(
    dayKey("2026-09-19T05:00:00Z", "America/New_York"),
    "2026-09-19",
  );
});
test("overnight quiet hours honor inclusive start and exclusive end", () => {
  const settings = {
    quietStart: 22,
    quietEnd: 8,
    timezone: "America/New_York",
  };
  assert.equal(quietNow(new Date("2026-09-20T02:00:00Z"), settings), true);
  assert.equal(quietNow(new Date("2026-09-20T11:59:00Z"), settings), true);
  assert.equal(quietNow(new Date("2026-09-20T12:00:00Z"), settings), false);
  assert.equal(
    quietNow(new Date("2026-09-20T02:00:00Z"), {
      ...settings,
      quietStart: 8,
      quietEnd: 8,
    }),
    false,
  );
  assert.equal(
    quietNow(new Date("2026-09-20T17:00:00Z"), {
      ...settings,
      quietStart: 12,
      quietEnd: 14,
    }),
    true,
  );
});
test("push registration blocks private-network and untrusted endpoints", () => {
  const keys = { p256dh: "a".repeat(87), auth: "a".repeat(22) };
  for (const endpoint of [
    "http://127.0.0.1:3001",
    "https://internal.example.com/push",
    "https://fcm.googleapis.com.evil.com/push",
    "https://fcm.googleapis.com:444/push",
    "https://user:pass@fcm.googleapis.com/push",
  ])
    assert.throws(() => validateSubscription({ endpoint, keys }));
  assert.equal(
    validateSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys,
    }).keys.auth,
    keys.auth,
  );
});
const reading = {
  doomscrolling: true,
  slouching: false,
  sleeping: false,
  drinkingWater: false,
  tempRaw: 2560,
};
test("sensor reading validation requires booleans and a 16-bit signed tempRaw", () => {
  assert.deepEqual(validateSensorReading(reading), reading);
  for (const update of [
    { doomscrolling: "yes" },
    { tempRaw: 1.5 },
    { tempRaw: 32768 },
    { tempRaw: -32769 },
  ])
    assert.throws(() => validateSensorReading({ ...reading, ...update }));
});
test("TMP117 raw register converts at 0.0078125 °C per LSB", () => {
  assert.equal(tmp117ToCelsius(2560), 20);
  assert.equal(tmp117ToCelsius(-2560), -20);
  assert.equal(tmp117ToCelsius(0), 0);
});
test("streak duration sums only the unbroken run of true readings up to now", () => {
  const base = Date.parse("2026-09-19T00:00:00Z");
  const readings = [
    { createdAt: new Date(base).toISOString(), sleeping: false },
    { createdAt: new Date(base + 60000).toISOString(), sleeping: true },
    { createdAt: new Date(base + 120000).toISOString(), sleeping: true },
    { createdAt: new Date(base + 180000).toISOString(), sleeping: true },
  ];
  assert.equal(
    streakDurationMs(readings, "sleeping", base + 300000),
    300000 - 60000,
  );
  assert.equal(streakDurationMs(readings, "doomscrolling", base + 300000), 0);
  assert.equal(streakDurationMs([], "sleeping"), 0);
});
test("voice challenges produce solvable prompts", () => {
  const challenge = createChallenge(() => 0);
  assert.match(challenge.prompt, /What is \d+ (plus|times) \d+\?/);
  const [, first, operation, second] = challenge.prompt.match(
    /What is (\d+) (plus|times) (\d+)\?/,
  );
  assert.equal(
    challenge.answer,
    operation === "plus"
      ? Number(first) + Number(second)
      : Number(first) * Number(second),
  );
});
test("owlify wraps text in owl hoots", () => {
  assert.equal(
    owlify("Drink water.", () => 0),
    "Hoo-hoo! Drink water. Wise up and rest well.",
  );
});
test("spoken numbers parse digits and English number words", () => {
  assert.equal(parseSpokenNumber("12"), 12);
  assert.equal(parseSpokenNumber("twelve"), 12);
  assert.equal(parseSpokenNumber("twenty one"), 21);
  assert.equal(parseSpokenNumber("forty-two"), 42);
  assert.equal(parseSpokenNumber("The answer is 8."), 8);
  assert.equal(parseSpokenNumber("banana"), null);
});
test("challenge answers compare parsed spoken numbers", () => {
  assert.equal(checkChallengeAnswer(12, "twelve"), true);
  assert.equal(checkChallengeAnswer(12, "13"), false);
  assert.equal(checkChallengeAnswer(42, "forty two"), true);
});
