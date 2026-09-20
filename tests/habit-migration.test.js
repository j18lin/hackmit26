import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateFocusedHabits } from "../server/habit-migration.js";
import { habitPresets, habitFromPreset } from "../shared/habit-presets.js";
import { validateHabit } from "../server/domain.js";

function fixture(t, account = true) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE habits (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, dailyLimit INTEGER NOT NULL, reminderMinutes INTEGER NOT NULL, active INTEGER NOT NULL, nextDue INTEGER NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE events (id TEXT PRIMARY KEY, habitId TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE, source TEXT NOT NULL, createdAt TEXT NOT NULL);
  `);
  if (account) db.prepare("INSERT INTO config VALUES ('account','{}')").run();
  return db;
}

function addHabit(db, id, name, category) {
  db.prepare("INSERT INTO habits VALUES (?,?,?,?,?,0,1,0,?)").run(
    id,
    name,
    "Keep my reminder",
    category,
    4,
    "2026-09-20T00:00:00Z",
  );
}

test("the camera-detected habits are offered as valid starter habits", () => {
  assert.deepEqual(
    habitPresets.map((p) => p.name),
    ["Doomscrolling", "Drinking water", "Slouching", "Hands off your face"],
  );
  for (const preset of habitPresets)
    assert.doesNotThrow(() => validateHabit(habitFromPreset(preset)));
  assert.match(habitPresets[1].hint, /missed water breaks/);
});

test("focus migration archives retired starters without deleting history or replacing kept IDs", (t) => {
  const db = fixture(t);
  addHabit(db, "posture", "Slouching", "posture");
  addHabit(db, "screen", "Screen overload", "screen");
  addHabit(db, "nails", "Nail biting", "mindfulness");
  addHabit(db, "sitting", "Sitting too long", "movement");
  addHabit(db, "doom", "Doom scrolling", "screen");
  db.prepare("INSERT INTO events VALUES ('event','nails','manual',?)").run(
    "2026-09-20T00:00:00Z",
  );

  migrateFocusedHabits(db);
  assert.deepEqual(
    db
      .prepare("SELECT name FROM habits WHERE archived=0 ORDER BY name")
      .all()
      .map((h) => h.name),
    ["Doomscrolling", "Drinking water", "Hands off your face", "Slouching"],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM habits WHERE archived=1").get()
      .count,
    3,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM events WHERE habitId='nails'")
      .get().count,
    1,
  );
  const doom = db.prepare("SELECT * FROM habits WHERE id='doom'").get();
  assert.equal(doom.name, "Doomscrolling");
  assert.equal(doom.dailyLimit, 4);
  assert.equal(doom.description, "Keep my reminder");

  const before = db.prepare("SELECT * FROM habits ORDER BY id").all();
  migrateFocusedHabits(db);
  assert.deepEqual(
    db.prepare("SELECT * FROM habits ORDER BY id").all(),
    before,
  );
  // A later intentional removal is not undone on the next server start.
  db.prepare("DELETE FROM habits WHERE id='doom'").run();
  migrateFocusedHabits(db);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM habits WHERE category='screen' AND archived=0",
      )
      .get().count,
    0,
  );
});

test("existing hydration history and custom habits survive the focus migration", (t) => {
  const db = fixture(t);
  addHabit(db, "water", "Skipping water breaks", "hydration");
  addHabit(db, "custom", "My own routine", "other");
  db.prepare(
    "INSERT INTO events VALUES ('water-event','water','manual',?)",
  ).run("2026-09-20T00:00:00Z");
  migrateFocusedHabits(db);
  assert.equal(
    db.prepare("SELECT name FROM habits WHERE id='water'").get().name,
    "Drinking water",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM habits WHERE category='hydration'",
      )
      .get().count,
    1,
  );
  assert.equal(
    db.prepare("SELECT archived FROM habits WHERE id='custom'").get().archived,
    0,
  );
  assert.equal(
    db.prepare("SELECT habitId FROM events WHERE id='water-event'").get()
      .habitId,
    "water",
  );
});

test("an unconfigured workspace gains the archive column but no fabricated habits", (t) => {
  const db = fixture(t, false);
  migrateFocusedHabits(db);
  assert.ok(
    db
      .prepare("PRAGMA table_info(habits)")
      .all()
      .some((c) => c.name === "archived"),
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM habits").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM config").get().count,
    0,
  );
});
