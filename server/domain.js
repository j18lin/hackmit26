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
