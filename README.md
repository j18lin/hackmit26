# Owlert 🦉

A habit-awareness companion for HackMIT 2026. Track several habits you want to reduce, notice patterns, and receive gentle nudges on your phone and laptop. This repository includes the website, persistent API, Web Push server, and an authenticated robot ingestion endpoint.

## Run locally

Requires **Node.js 22.13+** (Node 24 recommended) and npm.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. Create the workspace with your name and a passphrase of at least 10 characters. Save that passphrase: it signs into the same workspace on other devices. The first setup creates two editable preset habits: Doomscrolling and Drinking water. No check-in history or device connections are fabricated. This is a single personal/shared workspace, not a multi-user SaaS.

The frontend runs on port 5173 and proxies `/api` to port 3001. For production:

```sh
npm run build
npm start
```

The server then serves the built website and API together on **http://localhost:3001**. Optional environment variables are documented in `.env.example`; copy it to `.env` to customize. Both server scripts load `.env` automatically. Keep `PORT=3001` during Vite development, or update its proxy too.

Set `ELEVENLABS_API_KEY` on the server to enable voice nudges and wake-up
checks. `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, and
`ELEVENLABS_BASE_URL` are optional overrides; the base URL is useful for tests
and proxies. Provider credentials never reach the browser.

## What works

- Light lavender (default) and dark purple owl themes with a clickable, animated fly-away welcome. Switch using the sun/moon button or **Settings → Appearance**. Theme choice saves per browser, syncs between tabs, and is applied before the first paint. The intro appears once per tab session and can be replayed by clicking the dashboard owl or **Say hello to your owl** in the sidebar. Keyboard entry, a skip button, and reduced-motion preferences are supported.
- Responsive dashboard, habit creation/editing/pausing/deletion, occurrence logging and undo.
- Daily limits, seven-day occurrence charts, 31-day check-in history, JSON export.
- SQLite persistence and cross-device refresh every 15 seconds. Day boundaries follow the workspace timezone.
- Server-originated Web Push to all enabled subscribed devices, including when the page is closed (subject to browser/OS delivery settings).
- Per-habit scheduled nudges, daily-limit nudges, quiet hours, global pause, per-device pause, disconnection, and test notifications.
- Server-side ElevenLabs voice nudges and spoken wake-up checks for sleep habits; failed checks log an observation.
- Installable app manifest, PNG icons, and a push service worker. No private API response caching; dashboard use requires a network connection.
- Passphrase hashing with scrypt, expiring HttpOnly sessions, request limits, same-origin mutation checks, and push-provider allowlisting.
- Separately authenticated robot API, key rotation, robot observation history, and raw sensor telemetry (booleans plus TMP117 temperature) with server-computed durations.

## Habit presets

Choose a preset from **Add habit → Start with a preset** or the library on **My habits**. Presets fill in the name, category, reminder message, and an editable daily threshold. Scheduled nudges start off. New workspaces start with both presets; already-added preset names are marked in the picker.

- Doomscrolling
- Drinking water

Logs count unwanted scrolling sessions and **missed water breaks**, not glasses of water consumed. Thresholds are personal reminder settings, not recommended health targets. Existing installations receive a one-time migration that archives the retired starter habits, preserving their rows and history in SQLite while excluding them from tracking, reminders, and dashboard totals. Existing doomscrolling/water IDs and settings are retained; custom habits are left alone. Archived rows can be recovered by clearing their `archived` flag; the migration will not archive them again. Custom habits and optional ElevenLabs voice checks remain supported.

## Phone + laptop notifications

1. Complete initial workspace setup locally before exposing the server.
2. Deploy the production server behind **HTTPS**, or use an HTTPS development tunnel to **port 3001 after building**. Use the same public URL on each device. Do not expose the Vite development server publicly.
3. Set `SECURE_COOKIES=true` for HTTPS and `VAPID_SUBJECT=mailto:you@yourdomain.com` to a real contact address. The reverse proxy must preserve the public `Host` header. Run one server instance with a persistent data volume.
4. Sign in with the same workspace passphrase on each device. In **Devices & robot**, click **Connect this device**, name it, and allow notifications.
5. On iPhone/iPad (iOS/iPadOS 16.4+), open the HTTPS site in Safari, use **Share → Add to Home Screen**, then launch from the icon before connecting.
6. Use **Notifications → Send test nudge**. It sends to every enabled device and bypasses quiet hours and the global automatic-nudge toggle. History reports acceptance by the push service, not proof the device displayed it.

Push credentials (VAPID keys) are generated on first startup and saved in SQLite. No paid notification provider is needed. Real push delivery requires internet access and browser permission. Ordinary `http://192.168...` LAN addresses cannot request push permission. Browsers/OS settings, Focus modes, battery restrictions, and connectivity can delay or block delivery.

Reminders are checked every 30 seconds while the server runs. Quiet hours suppress automatic nudges. Equal start/end hours disable quiet time. After downtime or quiet hours, each overdue habit receives at most one reminder, then resumes its interval. Daily-limit nudges fire when a logged occurrence reaches the limit (not for every subsequent occurrence). Undoing that entry and reaching the limit again can send another nudge. Defaults have scheduled reminders off until you choose an interval.

Reference: [Apple Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Web Push server guide](https://web.dev/articles/codelab-notifications-push-server).

## Hardware sketch

The supplied LCD-eye and three-servo demo is in [hardware/owlert_robot/owlert_robot.ino](hardware/owlert_robot/owlert_robot.ino). See [hardware/README.md](hardware/README.md) for its libraries and configured pins. This standalone sketch is separate from the website's robot API.

## Robot integration

In **Devices & robot**, generate a robot key. Copy it immediately: only its hash is stored, and replacing it invalidates the previous key. The dialog lists habit IDs. The robot should send an event after its detector identifies an occurrence:

```sh
curl https://YOUR_HOST/api/robot/events \
  -H "Authorization: Bearer YOUR_ROBOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"habitId":"YOUR_HABIT_ID"}'
```

Events receive a server timestamp and `source: "robot"`. Paused/nonexistent habits reject events. Debounce observations in firmware: each accepted request represents one occurrence. Store the key securely on the device or a local gateway. There is no model inference in this endpoint.

### Sensor telemetry

The same robot key also authenticates violation reports. Unlike `/api/robot/events`, these aren't tied to a specific habit row — they're one of four sensor-tracked fields, and the Arduino/inference side decides on-device when a violation happened (e.g. slouching continuously past its own duration threshold) rather than streaming raw booleans every poll:

```sh
curl https://YOUR_HOST/api/robot/violations \
  -H "Authorization: Bearer YOUR_ROBOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"field":"slouching"}'
```

`field` must be one of `doomscrolling`, `slouching`, `sleeping`, `drinkingWater`. Each accepted request is one violation — the server does no threshold or duration math, it just counts occurrences and prunes anything older than the retention window (`config/constants.yaml`, `violations.windowHours`, 48h by default). `GET /api/violations/latest` returns the per-field counts and last-seen timestamps over that window. Keeping the threshold decision on-device means firmware only ever reports "this just happened," and the backend stays a thin, stateless counter.

If `ARDUINO_SERIAL_PORT` is set (see `.env.example`), each accepted violation also writes a `NEGATIVE` command over USB serial to a physical Elegoo/Arduino Uno R3 running `hardware/owlert_robot/owlert_robot.ino` (LCD face + servo reaction), via `server/arduino.js`. This is entirely optional and a no-op with no port configured — it never blocks or fails the API response.

### Future work

- **Arduino:** run the detectors on an interval, track how long each one stays continuously true on-device, and call `/api/robot/violations` once a field's own duration threshold is crossed; add confidence thresholds and debouncing before treating a boolean as reliable. Choose hardware/model after deciding which habits and sensors to detect.
- Multi-user accounts, account recovery, a durable notification job queue, per-habit routing, and deployment-specific monitoring are future production work.

## API map

| Endpoint                                             | Purpose                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/session`                                   | First-run / signed-in state                                                         |
| `POST /api/session`                                  | Create first workspace or sign in                                                   |
| `DELETE /api/session`                                | Sign out this session                                                               |
| `GET /api/state`                                     | Habits, 31 days of events, devices, settings, latest 50 notification results        |
| `POST /api/habits`, `PUT/DELETE /api/habits/:id`     | Manage habits                                                                       |
| `POST /api/events`, `DELETE /api/events/:id`         | Log/undo manual observations                                                        |
| `PUT /api/settings`                                  | Timezone, quiet hours and automatic nudges                                          |
| `POST /api/devices`, `PATCH/DELETE /api/devices/:id` | Register, pause or disconnect push devices                                          |
| `POST /api/notifications/test`                       | Send test push to enabled devices                                                   |
| `POST /api/robot/key`                                | Generate/rotate robot bearer key                                                    |
| `POST /api/robot/events`                             | Bearer-authenticated robot observation                                              |
| `POST /api/robot/violations`                         | Bearer-authenticated violation report (`{field}`, one of the sensor-tracked habits) |
| `GET /api/violations/latest`                         | Per-field violation counts and last-seen time over the retention window             |
| `POST /api/voice/speak`                              | Session-authenticated ElevenLabs text-to-speech                                     |
| `POST /api/voice/challenge`                          | Create a spoken wake-up check for an active habit                                   |
| `GET /api/voice/challenge/:id/audio`                 | Speak a wake-up check prompt                                                        |
| `POST /api/voice/challenge/:id/answer`               | Submit typed text or recorded audio for a wake-up check                             |

All endpoints except session setup/status and robot ingestion require a session cookie. Robot keys grant event and violation ingestion only. Subscription endpoints and private keys are never returned in workspace state.

## Persistence, privacy and deployment

Data lives in `data/nudge.sqlite` (including sessions, generated push keys and subscriptions). `data/`, `.env`, and test scratch files are gitignored. Use a persistent volume and protect backups; habit observations can be sensitive. For a consistent SQLite backup, stop the server before copying the data directory, or use SQLite's backup API. Local database files are not encrypted at rest. There is no passphrase recovery flow yet.

Only run one API instance: its in-process reminder scheduler is intentionally simple for a hackathon. A managed job queue is needed before scaling to multiple replicas. Rate limits use the direct connection IP; with a reverse proxy they can apply collectively. Configure deployment-specific trusted proxy handling before broader production use. Bootstrap the workspace before public access, use HTTPS and a strong passphrase, and share the passphrase only with trusted collaborators.

This prototype supports habit awareness; it is not a medical device or diagnostic tool. Phone delivery is implemented but must be verified with your own subscribed devices on the HTTPS deployment. Arduino inference is not yet implemented.

## Checks

```sh
npm test
npm run build
```

Tests cover input validation, timezone boundaries, quiet hours, push endpoint restrictions, authentication/session isolation, CRUD, device registration, and robot ingestion/key rotation. Push fanout tests use a transport stub to check success on both phone and laptop, disabled-device exclusion, expired-subscription removal, and transient-failure retention. API tests create an isolated database under `work/` and start a server on port 3199; they never send real pushes. The simple PWA artwork can be regenerated with `npm run icons`. Use `npm run format` / `npm run format:check` for formatting.
