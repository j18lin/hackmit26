# Nudge sensor ingestion API

Reference for pushing CV-detected violations into the Nudge dashboard backend
(`hackmit26` repo). Written for an agent/script that only needs to send
data — it does not need to read the dashboard frontend or database schema.

## Where the server runs

- Local dev: `http://localhost:3001` (started via `npm run dev` or `npm start`
  in `hackmit26/`; must already be running and have a workspace set up).
- Base URL is configurable — check `API_BASE` in `hardware/cv/.env` if unsure.

## Auth

All robot endpoints use a bearer key, not the browser session cookie.

```
Authorization: Bearer <ROBOT_KEY>
```

- The key is generated once from the dashboard (**Devices & robot → Generate
  robot key**) and shown only at creation time; only its hash is stored
  server-side.
- Regenerating the key invalidates the previous one.
- The current key for this project is stored in `hardware/cv/.env` as
  `ROBOT_KEY=...` (gitignored — ask the user if you need to see it, don't
  print it in shared output/logs).
- No CSRF/origin checks apply to robot endpoints (those only apply to
  cookie-authenticated browser requests), but the bearer key itself must be
  correct or the request is rejected with `401`.

## Endpoint: report a violation

```
POST /api/robot/violations
Content-Type: application/json
Authorization: Bearer <ROBOT_KEY>
```

The Arduino/inference side decides on-device when a sensed habit has been
violated (e.g. slouching continuously past its own duration threshold,
tracked in whatever code is doing the repeated polling) and calls this once
per crossing. The server does no threshold math at all — this is literally
"state += 1" for that field. Do not call it once per poll/frame; only call
it when your own logic has decided a violation just happened.

Each accepted call also sends a `NEGATIVE` command over USB serial to a
second, separate Arduino (an Elegoo/Arduino Uno R3 running
`hardware/owlert_robot/owlert_robot.ino`, LCD face + servos), if
`ARDUINO_SERIAL_PORT` is set on whichever machine runs this backend — see
`server/arduino.js`. This is independent of the Uno Q inference board this
doc is otherwise about; it's a physical reaction on the backend host, not
the CV device. No env var set means no-op, so this never blocks a violation
POST from succeeding.

### Request body

```json
{ "field": "slouching" }
```

| field | type | constraints |
|---|---|---|
| `field` | string | required, one of: `doomscrolling`, `slouching`, `sleeping`, `drinkingWater` |

Any missing/unknown `field` returns `400` with a descriptive `{"error": "..."}`
message (see `hackmit26/server/domain.js`, `validateViolation`).

### Response

- `201 { "id": "<uuid>" }` on success.
- `401 { "error": "Invalid robot API key." }` if the bearer key is wrong/missing.
- `400 { "error": "..." }` on validation failure.
- `429` if you exceed 180 requests/min to `/api/*` (shared rate limit).

### Example

```sh
curl -s -X POST http://localhost:3001/api/robot/violations \
  -H "Authorization: Bearer $ROBOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"field":"slouching"}'
```

### Reference implementation

`phone_detection/monitor_arduino.py` calls this endpoint — reads
`ROBOT_KEY`/`API_BASE` from `.env`, sends a frame to the Arduino's
`bench/tcp_infer_server.py`, and posts a violation for whichever field(s)
come back in that server's `violations` list:

```sh
python3 phone_detection/monitor_arduino.py --arduino-host 10.31.181.91 --image mac_webcam.jpg
python3 phone_detection/monitor_arduino.py --arduino-host 10.31.181.91 --image mac_webcam.jpg --dry-run
```

The duration-threshold decision ("how long is too long") lives entirely
on-device, in `tcp_infer_server.py`'s `ViolationTracker` — it tracks, per
field, how long it's been continuously true (wall-clock, in server-process
memory, across connections) and only reports a field once its streak
crosses that field's own threshold. This script itself is single-shot (one
image in, one inference call out) and has no threshold logic of its own —
running it repeatedly (loop/cron) against the same long-lived server still
measures duration correctly, since the state lives on the Arduino, not in
this script.

## Endpoint: discrete habit occurrence (alternative)

```
POST /api/robot/events
Authorization: Bearer <ROBOT_KEY>
Content-Type: application/json

{"habitId": "<uuid>"}
```

Use this instead of `/api/robot/violations` if you want to log an
occurrence tied to a specific habit row directly (affects that habit's
daily-limit count on the dashboard), rather than a generic sensor-tracked
field. `habitId` must match an existing, active habit — see the `habits`
table in `hackmit26/data/nudge.sqlite`, or `GET /api/state` (session auth
required) for the current list and their categories:

- Doom scrolling, Slouching, Sitting too long, Falling asleep at desk,
  Skipping water breaks, Staying up late, Smoking, Poor lifting habits.

Rejects with `400` if the habit is paused or doesn't exist.

## Verifying data landed (no session auth needed)

Query the SQLite DB directly:

```sh
sqlite3 /Users/fumiokutsu/Documents/hackmit26/data/nudge.sqlite \
  "SELECT * FROM violations ORDER BY createdAt DESC LIMIT 10;" -header -column
```

## What to expect

- The dashboard's **Devices & robot** page shows a "Sensor-detected
  violations" panel with a per-field count and last-seen time over the
  configured window (`config/constants.yaml`, `violations.windowHours`,
  48h by default). Pushing a violation also updates the "Last seen" pill.
- `GET /api/violations/latest` (needs a session cookie) returns the same
  summary the dashboard uses: `{ windowHours, counts: {field: n}, lastAt: {field: iso|null} }`.
