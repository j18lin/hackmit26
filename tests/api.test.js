import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "work"), { recursive: true });

test("workspace API: authentication, persistence, multi-device settings and robot ingestion", async () => {
  const dir = mkdtempSync(path.join(root, "work", "test-"));
  const child = spawn(
    process.execPath,
    ["--import", "./tests/push-stub.js", "server/index.js"],
    {
      cwd: root,
      env: { ...process.env, PORT: "3199", HOST: "127.0.0.1", DATA_DIR: dir },
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
    assert.equal(initial.habits.length, 8);
    assert.equal(initial.events.length, 0);
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
    assert.equal(after.events.length, 1);
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
    assert.equal((await call("/state")).value.habits.length, 9);
    await call("/session", "DELETE");
    assert.equal((await call("/state")).status, 401);
    cookie = firstCookie;
    assert.equal((await call("/state")).status, 200);
    await call("/habits/" + id, "DELETE");
    assert.equal((await call("/state")).value.events.length, 0);
    await call("/devices/" + device.value.id, "DELETE");
    assert.equal((await call("/state")).value.devices.length, 0);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
