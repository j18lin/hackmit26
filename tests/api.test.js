import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "work"), { recursive: true });
const numberWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
function spokenNumber(number) {
  if (number < 20) return numberWords[number];
  const tens = [
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ][Math.floor(number / 10) - 2];
  return number % 10 ? `${tens} ${numberWords[number % 10]}` : tens;
}

test("workspace API: authentication, persistence, multi-device settings and robot ingestion", async () => {
  const dir = mkdtempSync(path.join(root, "work", "test-"));
  let stubTranscript = "";
  const elevenLabsStub = createServer((req, res) => {
    if (req.url.startsWith("/v1/text-to-speech/")) {
      assert.equal(req.headers["xi-api-key"], "test-key");
      req.resume();
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      return res.end(Buffer.from("ID3fake"));
    }
    if (req.url === "/v1/speech-to-text") {
      req.resume();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ text: stubTranscript }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) =>
    elevenLabsStub.listen(3198, "127.0.0.1", resolve),
  );
  const child = spawn(
    process.execPath,
    ["--import", "./tests/push-stub.js", "server/index.js"],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: "3199",
        HOST: "127.0.0.1",
        DATA_DIR: dir,
        ELEVENLABS_API_KEY: "test-key",
        ELEVENLABS_BASE_URL: "http://127.0.0.1:3198",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stderr.on("data", (d) => {
    output += d;
  });
  let cookie = "";
  const call = async (route, method = "GET", body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:3199/api${route}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return {
      status: response.status,
      value,
      setCookie: response.headers.get("set-cookie"),
    };
  };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        const response = await call("/session");
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, `Server did not start: ${output}`);
    assert.equal((await call("/state")).status, 401);
    const unauthenticatedVoice = await fetch(
      "http://127.0.0.1:3199/api/voice/speak",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello" }),
      },
    );
    assert.equal(unauthenticatedVoice.status, 401);
    assert.equal(
      (await call("/session", "POST", { name: "Test", password: "short" }))
        .status,
      400,
    );
    const signedIn = await call(
      "/session",
      "POST",
      {
        name: "Test",
        password: "test-only-passphrase",
        timezone: "America/New_York",
      },
      { "X-Forwarded-Proto": "https" },
    );
    assert.equal(signedIn.status, 200);
    assert.match(signedIn.setCookie, /; Secure/i);
    const initial = (await call("/state")).value;
    assert.equal(initial.habits.length, 4);
    assert.deepEqual(initial.habits.map((h) => h.name).sort(), [
      "Doomscrolling",
      "Drinking water",
      "Hands off your face",
      "Slouching",
    ]);
    assert.equal(initial.events.length, 0);
    assert.equal(initial.voice.configured, true);
    const stored = new DatabaseSync(path.join(dir, "nudge.sqlite"));
    try {
      assert.equal(
        stored
          .prepare("SELECT value FROM config WHERE key='focusedHabitsV1'")
          .get().value,
        "true",
        "fresh setup must not re-add intentionally removed presets on restart",
      );
      stored
        .prepare(
          "INSERT INTO habits (id,name,description,category,dailyLimit,reminderMinutes,active,nextDue,createdAt,archived) VALUES ('retired','Nail biting','','mindfulness',3,0,1,0,?,1)",
        )
        .run(new Date().toISOString());
      stored
        .prepare(
          "INSERT INTO events VALUES ('retired-event','retired','manual',?)",
        )
        .run(new Date().toISOString());
      const focused = (await call("/state")).value;
      assert.equal(focused.habits.length, 4);
      assert.equal(focused.events.length, 0);
      assert.equal(
        (await call("/events", "POST", { habitId: "retired" })).status,
        400,
      );
      assert.equal(
        (await call("/voice/challenge", "POST", { habitId: "retired" })).status,
        400,
      );
      assert.equal(
        stored
          .prepare(
            "SELECT COUNT(*) AS count FROM events WHERE habitId='retired'",
          )
          .get().count,
        1,
      );
    } finally {
      stored.close();
    }
    const spoken = await fetch("http://127.0.0.1:3199/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ text: "Take a break." }),
    });
    assert.equal(spoken.status, 200);
    assert.equal(spoken.headers.get("content-type"), "audio/mpeg");
    assert.equal(Buffer.from(await spoken.arrayBuffer()).toString(), "ID3fake");
    assert.equal(
      (
        await call("/voice/speak", "POST", {
          text: "   ",
        })
      ).status,
      400,
    );
    // Voice checks remain supported for custom habits, not a default sleep card.
    const deskSleep = (
      await call("/habits", "POST", {
        name: "Voice check test",
        category: "sleep",
        description: "Take a break",
        dailyLimit: 1,
        reminderMinutes: 0,
        active: true,
      })
    ).value;
    const challenge = await call("/voice/challenge", "POST", {
      habitId: deskSleep.id,
    });
    assert.equal(challenge.status, 201);
    assert.match(challenge.value.prompt, /what is \d+ (plus|times) \d+\?/);
    const challengeAudio = await fetch(
      `http://127.0.0.1:3199/api/voice/challenge/${challenge.value.id}/audio`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(challengeAudio.status, 200);
    assert.equal(challengeAudio.headers.get("content-type"), "audio/mpeg");
    assert.equal(
      Buffer.from(await challengeAudio.arrayBuffer()).toString(),
      "ID3fake",
    );
    const [, first, operation, second] = challenge.value.prompt.match(
      /what is (\d+) (plus|times) (\d+)\?/,
    );
    const expected =
      operation === "plus"
        ? Number(first) + Number(second)
        : Number(first) * Number(second);
    const eventsBeforeVoice = (await call("/state")).value.events.length;
    const correctChallenge = await call(
      `/voice/challenge/${challenge.value.id}/answer`,
      "POST",
      { answer: String(expected) },
    );
    assert.deepEqual(correctChallenge.value.correct, true);
    assert.equal((await call("/state")).value.events.length, eventsBeforeVoice);
    const wrongChallenge = await call("/voice/challenge", "POST", {
      habitId: deskSleep.id,
    });
    const wrongAnswer = await call(
      `/voice/challenge/${wrongChallenge.value.id}/answer`,
      "POST",
      { answer: "banana" },
    );
    assert.equal(wrongAnswer.value.correct, false);
    assert.ok(wrongAnswer.value.eventId);
    const afterVoice = (await call("/state")).value;
    assert.ok(afterVoice.events.some((event) => event.source === "voice"));
    assert.equal(
      (
        await call(
          `/voice/challenge/${wrongChallenge.value.id}/answer`,
          "POST",
          { answer: "12" },
        )
      ).status,
      404,
    );
    const spokenChallenge = await call("/voice/challenge", "POST", {
      habitId: deskSleep.id,
    });
    const [, spokenFirst, spokenOperation, spokenSecond] =
      spokenChallenge.value.prompt.match(/what is (\d+) (plus|times) (\d+)\?/);
    const spokenExpected =
      spokenOperation === "plus"
        ? Number(spokenFirst) + Number(spokenSecond)
        : Number(spokenFirst) * Number(spokenSecond);
    stubTranscript = spokenNumber(spokenExpected);
    const transcriptAnswer = await fetch(
      `http://127.0.0.1:3199/api/voice/challenge/${spokenChallenge.value.id}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "audio/webm", Cookie: cookie },
        body: Buffer.from("fake recording"),
      },
    );
    assert.equal(transcriptAnswer.status, 200);
    assert.equal((await transcriptAnswer.json()).correct, true);
    const settings = {
      timezone: "America/New_York",
      quietStart: 0,
      quietEnd: 0,
      notifications: true,
    };
    assert.equal(
      (
        await call("/settings", "PUT", settings, {
          Origin: "https://attacker.example",
        })
      ).status,
      403,
    );
    assert.equal((await call("/settings", "PUT", settings)).status, 200);
    const habit = {
      name: "Test habit",
      description: "Take a break",
      category: "sleep",
      dailyLimit: 1,
      reminderMinutes: 15,
      active: true,
    };
    const created = await call("/habits", "POST", habit);
    assert.equal(created.status, 201);
    const id = created.value.id;
    assert.equal(
      (await call("/habits", "POST", { ...habit, dailyLimit: -1 })).status,
      400,
    );
    const event = await call("/events", "POST", { habitId: id });
    assert.equal(event.status, 201);
    const after = (await call("/state")).value;
    assert.equal(after.events.length, 2);
    assert.equal(after.notifications[0].reason, "limit");
    assert.equal(after.notifications[0].sent, 0);
    assert.equal(
      (await call("/events/" + event.value.id, "DELETE")).status,
      200,
    );
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/nudge-test-only",
      keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) },
    };
    assert.equal(
      (
        await call("/devices", "POST", {
          name: "Test laptop",
          kind: "laptop",
          subscription: {
            ...subscription,
            endpoint: "http://localhost/private",
          },
        })
      ).status,
      400,
    );
    const device = await call("/devices", "POST", {
      name: "Test laptop",
      kind: "laptop",
      subscription,
    });
    assert.equal(device.status, 201);
    await call("/devices", "POST", {
      name: "Renamed laptop",
      kind: "laptop",
      subscription,
    });
    assert.equal((await call("/state")).value.devices.length, 1);
    await call("/devices/" + device.value.id, "PATCH", { enabled: false });
    const nudge = await call("/notifications/test", "POST");
    assert.equal(nudge.value.devices, 0);
    const testDevices = [];
    for (const suffix of ["laptop-ok", "phone-ok", "gone", "failure"]) {
      testDevices.push(
        (
          await call("/devices", "POST", {
            name: suffix,
            kind: suffix === "phone-ok" ? "phone" : "laptop",
            subscription: {
              ...subscription,
              endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
            },
          })
        ).value.id,
      );
    }
    const fanout = (await call("/notifications/test", "POST")).value;
    assert.deepEqual(fanout, { sent: 2, failed: 2, devices: 4 });
    const afterFanout = (await call("/state")).value;
    assert.equal(
      afterFanout.devices.some((d) => d.name === "gone"),
      false,
      "expired subscriptions are removed",
    );
    assert.equal(
      afterFanout.devices.some((d) => d.name === "failure"),
      true,
      "transient failures keep their subscription",
    );
    for (const deviceId of testDevices)
      await call("/devices/" + deviceId, "DELETE");
    const key = (await call("/robot/key", "POST")).value.key;
    assert.equal(
      (await call("/robot/events", "POST", { habitId: id })).status,
      401,
    );
    assert.equal(
      (
        await call(
          "/robot/events",
          "POST",
          { habitId: id },
          { Authorization: `Bearer ${key}` },
        )
      ).status,
      201,
    );
    assert.equal((await call("/state")).value.events[0].source, "robot");
    assert.equal(
      (await call("/robot/violations", "POST", { field: "doomscrolling" }))
        .status,
      401,
    );
    assert.equal(
      (
        await call(
          "/robot/violations",
          "POST",
          { field: "doomscrolling" },
          { Authorization: `Bearer ${key}` },
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await call(
          "/robot/violations",
          "POST",
          { field: "napping" },
          { Authorization: `Bearer ${key}` },
        )
      ).status,
      400,
    );
    const violations = (await call("/violations/latest")).value;
    assert.equal(violations.counts.doomscrolling, 1);
    assert.equal(violations.counts.sleeping, 0);
    assert.ok(violations.lastAt.doomscrolling);
    await call("/robot/key", "POST");
    assert.equal(
      (
        await call(
          "/robot/events",
          "POST",
          { habitId: id },
          { Authorization: `Bearer ${key}` },
        )
      ).status,
      401,
    );
    await call("/habits/" + id, "PUT", { ...habit, active: false });
    assert.equal((await call("/events", "POST", { habitId: id })).status, 400);
    const firstCookie = cookie;
    cookie = "";
    assert.equal(
      (await call("/session", "POST", { password: "wrong-passphrase" })).status,
      401,
    );
    assert.equal(
      (await call("/session", "POST", { password: "test-only-passphrase" }))
        .status,
      200,
    );
    assert.notEqual(cookie, firstCookie);
    assert.equal((await call("/state")).value.habits.length, 6);
    await call("/session", "DELETE");
    assert.equal((await call("/state")).status, 401);
    cookie = firstCookie;
    assert.equal((await call("/state")).status, 200);
    await call("/habits/" + id, "DELETE");
    await call("/habits/" + deskSleep.id, "DELETE");
    // The doomscrolling violation above also logs an occurrence against the
    // Doomscrolling preset, so one robot-sourced event outlives the two
    // custom habits deleted here.
    const remaining = (await call("/state")).value.events;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].source, "robot");
    await call("/devices/" + device.value.id, "DELETE");
    assert.equal((await call("/state")).value.devices.length, 0);
  } finally {
    child.kill();
    await once(child, "exit");
    await new Promise((resolve) => elevenLabsStub.close(resolve));
  }
});
