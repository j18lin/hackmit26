// Backfills 48h of synthetic violation events so the dashboard's
// sensor-detected-violations panel (server/index.js violationSummary()) has
// something real to show, without waiting for a live robot. The robot API
// always stamps createdAt=now, so historical data has to be inserted
// directly. Safe to re-run; it only ever inserts new rows.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "nudge.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS violations (id TEXT PRIMARY KEY, field TEXT NOT NULL, createdAt TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS violations_date ON violations(createdAt);
`);

const HOURS = 48;
// How many violation events to scatter through the window, per field —
// each represents the robot having already decided a duration threshold
// was crossed, so counts here are naturally much smaller than raw sensor
// polls would be.
const VIOLATION_COUNTS = {
  slouching: 6,
  doomscrolling: 4,
  sleeping: 1,
  drinkingWater: 3,
};
const RECENT_MIN = 20; // guarantee one violation very recently, for a clean demo

const now = Date.now();
const insert = db.prepare("INSERT INTO violations VALUES (?,?,?)");

let inserted = 0;
db.exec("BEGIN");
for (const [field, count] of Object.entries(VIOLATION_COUNTS)) {
  for (let i = 0; i < count; i++) {
    const minutesAgo =
      i === 0 ? Math.random() * RECENT_MIN : Math.random() * HOURS * 60;
    const createdAt = new Date(now - minutesAgo * 60000).toISOString();
    insert.run(randomUUID(), field, createdAt);
    inserted++;
  }
}
db.exec("COMMIT");

console.log(
  `Inserted ${inserted} synthetic violation events spanning the last ${HOURS}h: ` +
    Object.entries(VIOLATION_COUNTS)
      .map(([field, count]) => `${field}=${count}`)
      .join(", "),
);
