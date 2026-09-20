// Backfills 48h of synthetic sensor_readings so the dashboard's slouching
// summary (server/index.js sensorSummary()) has something real to compute
// from, without waiting for a live robot to send data in real time (the
// robot API always stamps createdAt=now, so historical data has to be
// inserted directly). Safe to re-run; it only ever inserts new rows.
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
  CREATE TABLE IF NOT EXISTS sensor_readings (id TEXT PRIMARY KEY, doomscrolling INTEGER NOT NULL, slouching INTEGER NOT NULL, sleeping INTEGER NOT NULL, drinkingWater INTEGER NOT NULL, tempRaw INTEGER NOT NULL, createdAt TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS sensor_readings_date ON sensor_readings(createdAt);
`);

const HOURS = 48;
const STEP_MIN = 5;
const STEPS = (HOURS * 60) / STEP_MIN;
const FORCED_TAIL_MIN = 35; // last N minutes: guaranteed slouching, for a clean demo

// Markov persistence: each boolean tends to stay in its current state for a
// while (real streaks) rather than flickering every tick.
function makeStream(pOn, stickiness) {
  let on = Math.random() < pOn;
  return () => {
    const stay = Math.random() < stickiness;
    if (!stay) on = Math.random() < pOn;
    return on;
  };
}

const now = Date.now();
const start = now - HOURS * 3600000;
const slouchStream = makeStream(0.3, 0.92);
const doomStream = makeStream(0.2, 0.9);

const insert = db.prepare(
  "INSERT INTO sensor_readings VALUES (?,?,?,?,?,?,?)",
);

let inserted = 0;
db.exec("BEGIN");
for (let i = 0; i < STEPS; i++) {
  const t = start + i * STEP_MIN * 60000;
  const minutesFromNow = (now - t) / 60000;
  const forcedSlouch = minutesFromNow <= FORCED_TAIL_MIN;
  const hourOfDay = new Date(t).getUTCHours();
  // The forced demo tail always represents "awake and slouching right now",
  // even if it happens to fall inside the simulated overnight sleep window.
  const sleeping = !forcedSlouch && hourOfDay >= 0 && hourOfDay < 7;

  const slouching = forcedSlouch || (!sleeping && slouchStream());
  const doomscrolling = sleeping || forcedSlouch ? false : doomStream();
  const drinkingWater = !sleeping && Math.random() < 0.03;
  const tempRaw = Math.round(
    (21.5 + Math.sin(i / 30) * 1.2 + (Math.random() - 0.5) * 0.4) / 0.0078125,
  );

  insert.run(
    randomUUID(),
    Number(doomscrolling),
    Number(slouching),
    Number(sleeping),
    Number(drinkingWater),
    tempRaw,
    new Date(t).toISOString(),
  );
  inserted++;
}
db.exec("COMMIT");

console.log(
  `Inserted ${inserted} synthetic sensor readings spanning the last ${HOURS}h ` +
    `(5-min resolution). Last ${FORCED_TAIL_MIN} minutes are forced to slouching=true ` +
    `so the dashboard shows a live streak.`,
);
