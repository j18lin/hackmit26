import express from "express";
import rateLimit from "express-rate-limit";
import webpush from "web-push";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { habitPresets } from "../shared/habit-presets.js";
import { migrateFocusedHabits } from "./habit-migration.js";
import {
  validateHabit,
  dayKey,
  quietNow,
  validateSubscription,
  validateViolation,
  summarizeViolations,
  createChallenge,
  checkChallengeAnswer,
} from "./domain.js";
import { violationWindowHours } from "./constants.js";
import { voiceConfigured, synthesize, transcribe } from "./voice.js";
import { arduinoConfigured, reactToViolation } from "./arduino.js";
import {
  sendFrame,
  visionTarget,
  MODE_INFER,
  MODE_CALIBRATE,
  MODE_RESET,
} from "./vision.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "nudge.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS habits (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, dailyLimit INTEGER NOT NULL, reminderMinutes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, nextDue INTEGER NOT NULL, createdAt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, habitId TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE, source TEXT NOT NULL, createdAt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, subscription TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, sent INTEGER NOT NULL, failed INTEGER NOT NULL, reason TEXT NOT NULL, createdAt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS violations (id TEXT PRIMARY KEY, field TEXT NOT NULL, createdAt TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS events_date ON events(createdAt);
  CREATE INDEX IF NOT EXISTS violations_date ON violations(createdAt);
`);
migrateFocusedHabits(db);
const get = (key) => {
  const row = db.prepare("SELECT value FROM config WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
};
const set = (key, value) =>
  db
    .prepare("INSERT OR REPLACE INTO config VALUES (?,?)")
    .run(key, JSON.stringify(value));
const hash = (value) => createHash("sha256").update(value).digest("hex");
if (!get("vapid")) set("vapid", webpush.generateVAPIDKeys());
const vapid = get("vapid");
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:hello@example.com",
  vapid.publicKey,
  vapid.privateKey,
);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  // Browser mutations must originate from this site; robot clients use bearer authentication.
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  )
    return res.status(403).json({ error: "Cross-origin request rejected." });
  next();
});
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});
function session(req) {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("nudge_session="))
    ?.slice(14);
  return (
    token &&
    db
      .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now())
  );
}
function createSession(req, res) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES (?,?)").run(
    hash(token),
    Date.now() + 30 * 86400000,
  );
  res.cookie("nudge_session", token, {
    httpOnly: true,
    sameSite: "strict",
    // TLS terminates at the tunnel. This header can only strengthen cookie
    // protection; SECURE_COOKIES=true always forces secure cookies.
    secure:
      process.env.SECURE_COOKIES === "true" ||
      req.headers["x-forwarded-proto"]?.split(",")[0].trim() === "https",
    maxAge: 30 * 86400000,
    path: "/",
  });
}
app.get("/api/session", (req, res) =>
  res.json({
    setup: Boolean(get("account")),
    authenticated: Boolean(session(req)),
  }),
);
app.post("/api/session", authLimit, (req, res) => {
  const { password, name, timezone } = req.body;
  if (
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 128
  )
    return res
      .status(400)
      .json({ error: "Use a passphrase of 10–128 characters." });
  let account = get("account");
  if (!account) {
    if (typeof name !== "string" || !name.trim() || name.length > 40)
      return res
        .status(400)
        .json({ error: "Enter your name (up to 40 characters)." });
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      return res.status(400).json({ error: "Invalid timezone." });
    }
    const salt = randomBytes(16).toString("hex");
    account = {
      name: name.trim(),
      salt,
      password: scryptSync(password, salt, 64).toString("hex"),
    };
    set("account", account);
    set("settings", {
      timezone: timezone || "America/New_York",
      quietStart: 22,
      quietEnd: 8,
      notifications: true,
    });
    for (const preset of habitPresets)
      db.prepare(
        "INSERT INTO habits (id,name,description,category,dailyLimit,reminderMinutes,active,nextDue,createdAt) VALUES (?,?,?,?,?,?,1,?,?)",
      ).run(
        randomUUID(),
        preset.name,
        preset.description,
        preset.category,
        preset.dailyLimit,
        0,
        Date.now(),
        new Date().toISOString(),
      );
    set("focusedHabitsV1", true);
  } else {
    const candidate = scryptSync(password, account.salt, 64);
    if (!timingSafeEqual(candidate, Buffer.from(account.password, "hex")))
      return res
        .status(401)
        .json({ error: "That passphrase does not match your workspace." });
  }
  createSession(req, res);
  res.json({ ok: true });
});
app.delete("/api/session", (req, res) => {
  const current = session(req);
  if (current)
    db.prepare("DELETE FROM sessions WHERE token=?").run(current.token);
  res.clearCookie("nudge_session", { path: "/" });
  res.json({ ok: true });
});
function requireRobotKey(req, res, next) {
  const keyHash = get("robotKeyHash");
  const key = req.headers.authorization?.replace(/^Bearer /, "");
  if (
    !keyHash ||
    !key ||
    !timingSafeEqual(Buffer.from(hash(key)), Buffer.from(keyHash))
  )
    return res.status(401).json({ error: "Invalid robot API key." });
  next();
}
app.post("/api/robot/events", requireRobotKey, (req, res, next) =>
  recordEvent(req, res, next, "robot"),
);
// The Arduino decides on-device when a sensed habit crosses its own
// duration threshold and posts one violation per crossing — this endpoint
// is intentionally just "state += 1", no snapshot payload to validate
// beyond which field fired.
// Shared by the robot-key endpoint and the browser vision bridge, so a
// violation is recorded identically no matter which one reports it.
function recordViolation(field) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    "DELETE FROM violations WHERE createdAt<?",
  ).run(new Date(Date.now() - violationWindowHours * 3600000).toISOString());
  db.prepare("INSERT INTO violations VALUES (?,?,?)").run(id, field, createdAt);
  set("robotLastSeen", createdAt);
  // Field decides the expression: drinking water is praised, everything else
  // is scolded.
  reactToViolation(field);
  return id;
}

app.post("/api/robot/violations", requireRobotKey, (req, res, next) => {
  try {
    const { field } = validateViolation(req.body);
    res.status(201).json({ id: recordViolation(field) });
  } catch (error) {
    next(error);
  }
});
app.use("/api", (req, res, next) =>
  session(req)
    ? next()
    : res.status(401).json({ error: "Sign in to your workspace." }),
);

// --- Browser vision bridge (session-authed; everything below this point
// requires a signed-in workspace) ---
//
// The browser can't reach the Uno Q's TCP inference server directly, so it
// POSTs JPEG frames here and we forward them. Violations decided on the
// board are recorded on its behalf, which also means the browser never
// needs the robot key.
app.post(
  "/api/vision/frame",
  express.raw({ type: "image/jpeg", limit: "4mb" }),
  async (req, res) => {
    const modes = { infer: MODE_INFER, calibrate: MODE_CALIBRATE, reset: MODE_RESET };
    const mode = modes[req.query.mode || "infer"];
    if (!mode)
      return res.status(400).json({ error: "mode must be infer, calibrate or reset." });
    if (mode !== MODE_RESET && !req.body?.length)
      return res.status(400).json({ error: "Expected a JPEG body." });

    try {
      const result = await sendFrame(
        Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        mode,
      );
      const recorded = (result.violations || []).map((field) => ({
        field,
        id: recordViolation(field),
      }));
      res.json({ ...result, recorded });
    } catch (error) {
      // The board reboots often and gets unplugged; report it as upstream
      // trouble rather than a server fault so the UI can just keep polling.
      res.status(502).json({ error: error.message });
    }
  },
);

app.get("/api/vision/status", (req, res) => res.json(visionTarget()));

function violationSummary() {
  const cutoff = new Date(
    Date.now() - violationWindowHours * 3600000,
  ).toISOString();
  const rows = db
    .prepare("SELECT field, createdAt FROM violations WHERE createdAt>=?")
    .all(cutoff);
  return { windowHours: violationWindowHours, ...summarizeViolations(rows) };
}
function requireVoice(req, res, next) {
  if (!voiceConfigured())
    return res.status(503).json({
      error:
        "Voice is not configured. Add ELEVENLABS_API_KEY to the server environment.",
    });
  next();
}
const voiceRateLimit = rateLimit({
  windowMs: 60000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Slow down a little before more voice requests." },
});
const challenges = new Map();
function currentChallenge(id) {
  const challenge = challenges.get(id);
  if (!challenge || challenge.expires <= Date.now()) {
    challenges.delete(id);
    return null;
  }
  return challenge;
}
const voiceRouter = express.Router();
voiceRouter.use(requireVoice, voiceRateLimit);
voiceRouter.post("/speak", async (req, res, next) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 400)
    return res
      .status(400)
      .json({ error: "Enter text between 1 and 400 characters." });
  try {
    const audio = await synthesize(text);
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "no-store");
    res.send(audio);
  } catch (error) {
    next(error);
  }
});
voiceRouter.post("/challenge", async (req, res, next) => {
  const habit = db
    .prepare("SELECT id,active FROM habits WHERE id=? AND archived=0")
    .get(String(req.body?.habitId || ""));
  if (!habit || !habit.active)
    return res.status(400).json({ error: "Choose an active habit." });
  for (const [id, challenge] of challenges)
    if (challenge.expires <= Date.now()) challenges.delete(id);
  const { prompt, answer } = createChallenge();
  const id = randomUUID();
  const expires = Date.now() + 2 * 60000;
  challenges.set(id, { habitId: habit.id, answer, prompt, expires });
  res.status(201).json({
    id,
    prompt,
    expiresAt: new Date(expires).toISOString(),
  });
});
voiceRouter.get("/challenge/:id/audio", async (req, res, next) => {
  const challenge = currentChallenge(req.params.id);
  if (!challenge)
    return res.status(404).json({ error: "Challenge not found." });
  try {
    const audio = await synthesize(challenge.prompt);
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "no-store");
    res.send(audio);
  } catch (error) {
    next(error);
  }
});
voiceRouter.post(
  "/challenge/:id/answer",
  express.raw({ type: "audio/*", limit: "4mb" }),
  async (req, res, next) => {
    const challenge = currentChallenge(req.params.id);
    if (!challenge)
      return res.status(404).json({ error: "Challenge not found." });
    try {
      const heard = Buffer.isBuffer(req.body)
        ? await transcribe(
            req.body,
            req.headers["content-type"] || "application/octet-stream",
          )
        : typeof req.body?.answer === "string"
          ? req.body.answer.trim()
          : "";
      const correct = checkChallengeAnswer(challenge.answer, heard);
      challenges.delete(req.params.id);
      if (correct)
        return res.json({
          correct: true,
          heard,
          message: "Nice, you're awake. Keep going.",
        });
      let eventId;
      try {
        eventId = (await logOccurrence(challenge.habitId, "voice")).id;
      } catch {}
      res.json({
        correct: false,
        heard,
        expected: challenge.answer,
        ...(eventId ? { eventId } : {}),
        message: "Let's log that and take a real break.",
      });
    } catch (error) {
      next(error);
    }
  },
);
app.use("/api/voice", voiceRouter);
app.get("/api/state", (req, res) => {
  res.json({
    name: get("account").name,
    settings: get("settings"),
    habits: db
      .prepare("SELECT * FROM habits WHERE archived=0 ORDER BY createdAt")
      .all()
      .map((h) => ({ ...h, active: Boolean(h.active) })),
    events: db
      .prepare(
        "SELECT events.* FROM events JOIN habits ON habits.id=events.habitId WHERE habits.archived=0 AND events.createdAt>=? ORDER BY events.createdAt DESC",
      )
      .all(new Date(Date.now() - 31 * 86400000).toISOString()),
    devices: db
      .prepare(
        "SELECT id,name,kind,enabled,createdAt FROM devices ORDER BY createdAt",
      )
      .all(),
    notifications: db
      .prepare("SELECT * FROM notifications ORDER BY createdAt DESC LIMIT 50")
      .all(),
    robot: {
      configured: Boolean(get("robotKeyHash")),
      lastSeen: get("robotLastSeen"),
    },
    violations: violationSummary(),
    voice: { configured: voiceConfigured() },
    arduino: { configured: arduinoConfigured() },
    publicKey: vapid.publicKey,
  });
});
app.get("/api/violations/latest", (req, res) => {
  res.json(violationSummary());
});
app.post("/api/habits", (req, res) => {
  const h = validateHabit(req.body);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO habits (id,name,description,category,dailyLimit,reminderMinutes,active,nextDue,createdAt) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    h.name,
    h.description,
    h.category,
    h.dailyLimit,
    h.reminderMinutes,
    Number(h.active),
    Date.now() + h.reminderMinutes * 60000,
    new Date().toISOString(),
  );
  res.status(201).json({ id });
});
app.put("/api/habits/:id", (req, res) => {
  const h = validateHabit(req.body);
  const result = db
    .prepare(
      "UPDATE habits SET name=?,description=?,category=?,dailyLimit=?,reminderMinutes=?,active=?,nextDue=? WHERE id=? AND archived=0",
    )
    .run(
      h.name,
      h.description,
      h.category,
      h.dailyLimit,
      h.reminderMinutes,
      Number(h.active),
      Date.now() + h.reminderMinutes * 60000,
      req.params.id,
    );
  if (!result.changes)
    return res.status(404).json({ error: "Habit not found." });
  res.json({ ok: true });
});
app.delete("/api/habits/:id", (req, res) => {
  db.prepare("DELETE FROM habits WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
async function logOccurrence(habitId, source = "manual") {
  const habit = db
    .prepare("SELECT * FROM habits WHERE id=? AND archived=0")
    .get(String(habitId || ""));
  if (!habit || !habit.active)
    throw Object.assign(new Error("Choose an active habit."), { status: 400 });
  const now = new Date();
  const settings = get("settings");
  const count = db
    .prepare("SELECT createdAt FROM events WHERE habitId=? AND createdAt>?")
    .all(habit.id, new Date(Date.now() - 48 * 3600000).toISOString())
    .filter(
      (e) =>
        dayKey(e.createdAt, settings.timezone) ===
        dayKey(now, settings.timezone),
    ).length;
  const id = randomUUID();
  db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(
    id,
    habit.id,
    source,
    now.toISOString(),
  );
  if (source === "robot") set("robotLastSeen", now.toISOString());
  if (count + 1 === habit.dailyLimit)
    await sendNudge(
      "A little reset?",
      habit.description ||
        `Check in with your ${habit.name.toLowerCase()} habit.`,
      "limit",
      habit.id,
    );
  return { id };
}
async function recordEvent(req, res, next, source = "manual") {
  try {
    const { id } = await logOccurrence(req.body?.habitId, source);
    res.status(201).json({ id });
  } catch (error) {
    next(error);
  }
}
app.post("/api/events", recordEvent);
app.delete("/api/events/:id", (req, res) => {
  db.prepare("DELETE FROM events WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
app.put("/api/settings", (req, res) => {
  const s = req.body;
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timezone }).format();
  } catch {
    return res.status(400).json({ error: "Choose a valid IANA timezone." });
  }
  if (
    typeof s.timezone !== "string" ||
    typeof s.notifications !== "boolean" ||
    ![s.quietStart, s.quietEnd].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 23,
    )
  )
    return res
      .status(400)
      .json({ error: "Check your notification preferences." });
  set("settings", {
    timezone: s.timezone,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
    notifications: s.notifications,
  });
  res.json({ ok: true });
});
app.post("/api/devices", (req, res) => {
  const subscription = validateSubscription(req.body.subscription);
  const name = String(req.body.name || "").trim();
  if (!name || name.length > 60 || !["phone", "laptop"].includes(req.body.kind))
    return res.status(400).json({ error: "Choose a device name and type." });
  const existing = db
    .prepare("SELECT id FROM devices WHERE endpoint=?")
    .get(subscription.endpoint);
  const id = existing?.id || randomUUID();
  db.prepare(
    "INSERT INTO devices VALUES (?,?,?,?,?,1,?) ON CONFLICT(endpoint) DO UPDATE SET name=excluded.name,kind=excluded.kind,subscription=excluded.subscription,enabled=1",
  ).run(
    id,
    name,
    req.body.kind,
    JSON.stringify(subscription),
    subscription.endpoint,
    new Date().toISOString(),
  );
  res.status(201).json({ id });
});
app.patch("/api/devices/:id", (req, res) => {
  if (typeof req.body.enabled !== "boolean")
    return res.status(400).json({ error: "Invalid device state." });
  db.prepare("UPDATE devices SET enabled=? WHERE id=?").run(
    Number(req.body.enabled),
    req.params.id,
  );
  res.json({ ok: true });
});
app.delete("/api/devices/:id", (req, res) => {
  db.prepare("DELETE FROM devices WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
async function sendNudge(title, body, reason, tag = "nudge", force = false) {
  const settings = get("settings");
  if (!force && (!settings.notifications || quietNow(new Date(), settings)))
    return { sent: 0, failed: 0, suppressed: true };
  const devices = db.prepare("SELECT * FROM devices WHERE enabled=1").all();
  let sent = 0;
  let failed = 0;
  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          JSON.parse(device.subscription),
          JSON.stringify({ title, body, tag }),
          { TTL: 3600, timeout: 10000 },
        );
        sent++;
      } catch (error) {
        failed++;
        if ([404, 410].includes(error.statusCode))
          db.prepare("DELETE FROM devices WHERE id=?").run(device.id);
      }
    }),
  );
  db.prepare("INSERT INTO notifications VALUES (?,?,?,?,?,?,?)").run(
    randomUUID(),
    title,
    body,
    sent,
    failed,
    reason,
    new Date().toISOString(),
  );
  return { sent, failed, devices: devices.length };
}
app.post(
  "/api/notifications/test",
  rateLimit({
    windowMs: 60000,
    limit: 5,
    message: { error: "Wait a minute before sending another test." },
  }),
  async (req, res) => {
    res.json(
      await sendNudge(
        "Hello from Owlert 🦉",
        "Your companion is connected. Small steps start here.",
        "test",
        `test-${Date.now()}`,
        true,
      ),
    );
  },
);
app.post("/api/robot/key", (req, res) => {
  const key = randomBytes(32).toString("hex");
  set("robotKeyHash", hash(key));
  res.json({ key });
});
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
if (existsSync(path.join(root, "dist"))) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
}
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ error: "Invalid JSON." });
  if (error.code?.startsWith("ERR_SQLITE")) {
    console.error(error.message);
    return res.status(500).json({ error: "Could not save your changes." });
  }
  res
    .status(error.status || 400)
    .json({ error: error.message || "Something went wrong." });
});
let ticking = false;
const timer = setInterval(async () => {
  if (ticking || !get("account")) return;
  ticking = true;
  try {
    const settings = get("settings");
    if (!settings.notifications || quietNow(new Date(), settings)) return;
    const due = db
      .prepare(
        "SELECT * FROM habits WHERE archived=0 AND active=1 AND reminderMinutes>0 AND nextDue<=?",
      )
      .all(Date.now());
    for (const habit of due) {
      db.prepare("UPDATE habits SET nextDue=? WHERE id=?").run(
        Date.now() + habit.reminderMinutes * 60000,
        habit.id,
      );
      await sendNudge(
        `A moment for ${habit.name.toLowerCase()}`,
        habit.description || "Pause and check in with yourself.",
        "reminder",
        habit.id,
      );
    }
  } catch (error) {
    console.error("Reminder failed:", error.message);
  } finally {
    ticking = false;
  }
}, 30000);
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "0.0.0.0",
  () =>
    console.log(
      `Owlert API ready at http://localhost:${process.env.PORT || 3001}`,
    ),
);
function stop() {
  clearInterval(timer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
