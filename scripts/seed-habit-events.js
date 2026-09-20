// Backfills 28 days of synthetic habit `events` so the dashboard's daily
// counts, on-track/over-limit pills, 7-day chart, and Insights stats all
// move for real (they're derived entirely from state.events + state.habits
// in src/main.jsx, bucketed by calendar day in the account's timezone via
// dayKey — see server/domain.js). Safe to re-run against an empty events
// table; it does not touch habits or sensor_readings.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const db = new DatabaseSync(path.join(dataDir, "nudge.sqlite"));

const settingsRow = db.prepare("SELECT value FROM config WHERE key='settings'").get();
const timezone = settingsRow ? JSON.parse(settingsRow.value).timezone : "America/New_York";

// One habit row per preset name, if duplicates exist keep the earliest
// (the dashboard shows every habit row; seeding events onto every duplicate
// would just be redundant, not more "real").
const habitRows = db
  .prepare("SELECT id,name,dailyLimit,createdAt FROM habits ORDER BY createdAt ASC")
  .all();
const habitByName = new Map();
for (const h of habitRows) if (!habitByName.has(h.name)) habitByName.set(h.name, h);

const CONFIGS = [
  { name: "Doom scrolling", source: "robot", trend: "worsening", meanStart: 2, meanEnd: 4.5 },
  { name: "Slouching", source: "robot", trend: "worsening", meanStart: 1.5, meanEnd: 5 },
  { name: "Sitting too long", source: "manual", trend: "flat", meanStart: 2, meanEnd: 2.5 },
  { name: "Falling asleep at desk", source: "manual", trend: "flat", meanStart: 0.4, meanEnd: 0.3 },
  { name: "Skipping water breaks", source: "manual", trend: "improving", meanStart: 2.5, meanEnd: 0.4 },
  { name: "Staying up late", source: "manual", trend: "improving", meanStart: 0.8, meanEnd: 0.2 },
  { name: "Smoking", source: "manual", trend: "improving", meanStart: 0.6, meanEnd: 0.05 },
  { name: "Poor lifting habits", source: "manual", trend: "flat", meanStart: 0.3, meanEnd: 0.2 },
];

const DAYS = 28;

function tzOffsetMinutes(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+0";
  const match = raw.match(/GMT([+-]\d+)(?::?(\d+))?/);
  if (!match) return 0;
  const sign = match[1].startsWith("-") ? -1 : 1;
  const hours = Math.abs(parseInt(match[1], 10));
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  return sign * (hours * 60 + mins);
}

// Build a UTC ISO timestamp for a given local wall-clock time on `daysAgo`,
// in the account's timezone.
function localTimestamp(daysAgo, hour, minute) {
  const approxNow = new Date(Date.now() - daysAgo * 86400000);
  const offsetMin = tzOffsetMinutes(approxNow, timezone); // local = UTC + offsetMin
  const y = approxNow.getUTCFullYear();
  const m = approxNow.getUTCMonth();
  const d = approxNow.getUTCDate();
  // Treat (y,m,d,hour,minute) as the *local* wall clock; convert to UTC.
  const utcMs = Date.UTC(y, m, d, hour, minute) - offsetMin * 60000;
  return new Date(utcMs).toISOString();
}

const insert = db.prepare("INSERT INTO events VALUES (?,?,?,?)");
const summary = [];

db.exec("BEGIN");
for (const cfg of CONFIGS) {
  const habit = habitByName.get(cfg.name);
  if (!habit) continue;
  let totalEvents = 0;
  let daysOverLimit = 0;
  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
    const progress = 1 - daysAgo / (DAYS - 1); // 0 (oldest) -> 1 (today)
    const mean = cfg.meanStart + (cfg.meanEnd - cfg.meanStart) * progress;
    let count = Math.max(0, Math.round(mean + (Math.random() - 0.5) * 1.6));
    // Make the last two days unambiguous so the demo is legible at a glance.
    if (daysAgo <= 1) {
      if (cfg.trend === "worsening") count = habit.dailyLimit + 1 + Math.floor(Math.random() * 3);
      else if (cfg.trend === "improving") count = Math.floor(Math.random() * Math.max(1, Math.ceil(habit.dailyLimit / 2)));
    }
    if (count >= habit.dailyLimit) daysOverLimit++;
    for (let i = 0; i < count; i++) {
      const hour = 8 + Math.floor(Math.random() * 15); // 8am - 10pm local
      const minute = Math.floor(Math.random() * 60);
      insert.run(randomUUID(), habit.id, cfg.source, localTimestamp(daysAgo, hour, minute));
      totalEvents++;
    }
  }
  summary.push({ habit: cfg.name, dailyLimit: habit.dailyLimit, totalEvents, daysOverLimit });
}
db.exec("COMMIT");

console.log(`Seeded events for ${summary.length} habits over the last ${DAYS} days (timezone: ${timezone}):`);
for (const s of summary)
  console.log(
    `  ${s.habit.padEnd(24)} limit=${s.dailyLimit}  events=${s.totalEvents}  days-over-limit=${s.daysOverLimit}/${DAYS}`,
  );
