import test from "node:test";
import assert from "node:assert/strict";
import {
  validateHabit,
  quietNow,
  dayKey,
  validateSubscription,
  validateViolation,
  summarizeViolations,
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
test("violation validation only accepts known sensor-tracked fields", () => {
  assert.deepEqual(validateViolation({ field: "slouching" }), {
    field: "slouching",
  });
  for (const field of ["napping", "", undefined, 123])
    assert.throws(() => validateViolation({ field }));
});
test("violation summary counts occurrences per field and zero-fills the rest", () => {
  const rows = [
    { field: "slouching", createdAt: "2026-09-19T00:10:00.000Z" },
    { field: "slouching", createdAt: "2026-09-19T00:20:00.000Z" },
    { field: "doomscrolling", createdAt: "2026-09-19T00:05:00.000Z" },
  ];
  const { counts, lastAt } = summarizeViolations(rows);
  assert.equal(counts.slouching, 2);
  assert.equal(counts.doomscrolling, 1);
  assert.equal(counts.sleeping, 0);
  assert.equal(counts.drinkingWater, 0);
  assert.equal(lastAt.slouching, "2026-09-19T00:20:00.000Z");
  assert.equal(lastAt.sleeping, null);
});
test("voice challenges produce solvable prompts", () => {
  const challenge = createChallenge(() => 0);
  assert.match(challenge.prompt, /what is \d+ (plus|times) \d+\?/);
  const [, first, operation, second] = challenge.prompt.match(
    /what is (\d+) (plus|times) (\d+)\?/,
  );
  assert.equal(
    challenge.answer,
    operation === "plus"
      ? Number(first) + Number(second)
      : Number(first) * Number(second),
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
