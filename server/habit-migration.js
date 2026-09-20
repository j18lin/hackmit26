import { randomUUID } from "node:crypto";
import { habitPresets } from "../shared/habit-presets.js";

// Slouching and bad posture are no longer retired: the camera detects both,
// so they're supported starter habits again (see habitPresets).
const retired = [
  ["screen overload", "screen"],
  ["nail biting", "mindfulness"],
  ["sitting too long", "movement"],
  ["falling asleep at desk", "sleep"],
  ["staying up late", "sleep"],
  ["smoking", "smoking"],
  ["poor lifting habits", "lifting"],
];

// Old names that should be adopted by a preset rather than left behind as a
// duplicate. Keyed by preset, so adding a preset doesn't silently inherit
// another one's aliases.
const presetAliases = {
  "doom-scrolling": ["doomscrolling", "doom scrolling"],
  "water-breaks": ["drinking water", "skipping water breaks"],
  slouching: ["slouching", "bad posture"],
  "hand-near-face": ["hands off your face", "nail biting"],
};

// One-time, non-destructive retirement of the old starter set. Existing IDs,
// reminder settings, and history stay in SQLite; archived rows are not tracked.
// Deliberately do not rerun after a user edits or removes a focused habit.
export function migrateFocusedHabits(db) {
  if (
    !db
      .prepare("PRAGMA table_info(habits)")
      .all()
      .some((c) => c.name === "archived")
  ) {
    db.exec(
      "ALTER TABLE habits ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (db.prepare("SELECT 1 FROM config WHERE key='focusedHabitsV1'").get())
    return;
  if (!db.prepare("SELECT 1 FROM config WHERE key='account'").get()) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    const archive = db.prepare(
      "UPDATE habits SET archived=1 WHERE lower(trim(name))=? AND category=?",
    );
    for (const [name, category] of retired) archive.run(name, category);
    for (const preset of habitPresets) {
      const aliases = presetAliases[preset.key] ?? [preset.name.toLowerCase()];
      const existing = db
        .prepare(
          `SELECT id FROM habits WHERE archived=0 AND category=?
             AND lower(trim(name)) IN (${aliases.map(() => "?").join(",")})
           ORDER BY createdAt LIMIT 1`,
        )
        .get(preset.category, ...aliases);
      if (existing) {
        db.prepare("UPDATE habits SET name=? WHERE id=?").run(
          preset.name,
          existing.id,
        );
      } else {
        db.prepare(
          "INSERT INTO habits (id,name,description,category,dailyLimit,reminderMinutes,active,nextDue,createdAt) VALUES (?,?,?,?,?,0,1,?,?)",
        ).run(
          randomUUID(),
          preset.name,
          preset.description,
          preset.category,
          preset.dailyLimit,
          Date.now(),
          new Date().toISOString(),
        );
      }
    }
    db.prepare(
      "INSERT INTO config (key,value) VALUES ('focusedHabitsV1','true')",
    ).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
