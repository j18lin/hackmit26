export const categories = [
  "posture",
  "screen",
  "mindfulness",
  "movement",
  "hydration",
  "sleep",
  "smoking",
  "lifting",
  "other",
];

export function validateHabit(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (!name || name.length > 60)
    throw new Error("Give your habit a name of 1–60 characters.");
  if (description.length > 180)
    throw new Error("Keep your gentle reminder under 180 characters.");
  if (!categories.includes(input.category))
    throw new Error("Choose a valid category.");
  if (
    !Number.isInteger(input.dailyLimit) ||
    input.dailyLimit < 1 ||
    input.dailyLimit > 100
  )
    throw new Error("Daily limit must be a whole number between 1 and 100.");
  if (
    !Number.isInteger(input.reminderMinutes) ||
    (input.reminderMinutes !== 0 &&
      (input.reminderMinutes < 15 || input.reminderMinutes > 1440))
  )
    throw new Error("Reminders must be off or between 15 and 1,440 minutes.");
  return {
    name,
    description,
    category: input.category,
    dailyLimit: input.dailyLimit,
    reminderMinutes: input.reminderMinutes,
    active: input.active !== false,
  };
}

export function createChallenge(rand = Math.random) {
  const operation = rand() < 0.5 ? "plus" : "times";
  const first =
    operation === "plus"
      ? 2 + Math.floor(rand() * 19)
      : 2 + Math.floor(rand() * 8);
  const second =
    operation === "plus"
      ? 2 + Math.floor(rand() * 19)
      : 2 + Math.floor(rand() * 8);
  return {
    prompt: `Quick check: what is ${first} ${operation} ${second}?`,
    answer: operation === "plus" ? first + second : first * second,
  };
}

const numberWords = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

export function parseSpokenNumber(text) {
  if (typeof text !== "string") return null;
  const digits = text.match(/-?\d+/);
  if (digits) return Number.parseInt(digits[0], 10);
  const words = text
    .toLowerCase()
    .replaceAll("-", " ")
    .match(/[a-z]+/g);
  if (!words) return null;
  for (let i = 0; i < words.length; i++) {
    const first = numberWords.get(words[i]);
    if (first === undefined) continue;
    if (first >= 20 && first % 10 === 0) {
      const ones = numberWords.get(words[i + 1]);
      if (ones !== undefined && ones < 10) return first + ones;
    }
    return first;
  }
  return null;
}

export function checkChallengeAnswer(expected, given) {
  return parseSpokenNumber(given) === expected;
}

export function dayKey(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

export function quietNow(date, settings) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: settings.timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(date),
  );
  const { quietStart: start, quietEnd: end } = settings;
  if (start === end) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

// The Arduino now decides on-device when a sensed habit has been violated
// (e.g. slouching continuously past its own duration threshold) and only
// reports the fact that it happened, not a continuous stream of booleans —
// so the backend just counts occurrences instead of deriving streaks.
export const violationFields = ["doomscrolling", "slouching", "sleeping", "drinkingWater"];

export function validateViolation(input) {
  if (!violationFields.includes(input.field))
    throw new Error(`field must be one of: ${violationFields.join(", ")}.`);
  return { field: input.field };
}

// Turns raw violation rows (already filtered to the retention window by the
// caller) into a zero-filled per-field summary, so the frontend never has to
// handle a missing key for a field that hasn't fired yet.
export function summarizeViolations(rows) {
  const counts = Object.fromEntries(violationFields.map((f) => [f, 0]));
  const lastAt = Object.fromEntries(violationFields.map((f) => [f, null]));
  for (const row of rows) {
    counts[row.field] = (counts[row.field] || 0) + 1;
    if (!lastAt[row.field] || row.createdAt > lastAt[row.field])
      lastAt[row.field] = row.createdAt;
  }
  return { counts, lastAt };
}

export function validateSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== "string")
    throw new Error("Invalid push subscription.");
  let endpoint;
  try {
    endpoint = new URL(subscription.endpoint);
  } catch {
    throw new Error("Invalid push endpoint.");
  }
  const host = endpoint.hostname;
  const allowed =
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.services.mozilla.com") ||
    host === "web.push.apple.com" ||
    host.endsWith(".notify.windows.com");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    !allowed
  )
    throw new Error("This push provider is not supported.");
  if (
    !/^[\w-]{80,100}$/.test(subscription.keys?.p256dh || "") ||
    !/^[\w-]{20,30}$/.test(subscription.keys?.auth || "")
  )
    throw new Error("Invalid push keys.");
  return { endpoint: endpoint.href, keys: subscription.keys };
}
