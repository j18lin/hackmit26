# Nudge sensor ingestion API

Reference for pushing CV-detected labels into the Nudge dashboard backend
(`hackmit26` repo). Written for an agent/script that only needs to send
data — it does not need to read the dashboard frontend or database schema.

## Where the server runs

- Local dev: `http://localhost:3001` (started via `npm run dev` or `npm start`
  in `hackmit26/`; must already be running and have a workspace set up).
- Base URL is configurable — check `API_BASE` in `cv-hackmit/.env` if unsure.

## Auth

All robot endpoints use a bearer key, not the browser session cookie.

```
Authorization: Bearer <ROBOT_KEY>
```

- The key is generated once from the dashboard (**Devices & robot → Generate
  robot key**) and shown only at creation time; only its hash is stored
  server-side.
- Regenerating the key invalidates the previous one.
- The current key for this project is stored in `cv-hackmit/.env` as
  `ROBOT_KEY=...` (gitignored — ask the user if you need to see it, don't
  print it in shared output/logs).
- No CSRF/origin checks apply to robot endpoints (those only apply to
  cookie-authenticated browser requests), but the bearer key itself must be
  correct or the request is rejected with `401`.

## Endpoint: continuous sensor snapshot

```
POST /api/robot/sensors
Content-Type: application/json
Authorization: Bearer <ROBOT_KEY>
```

This is the one to use for "binary label + timestep" data — one row per
detector poll. The server assigns the timestamp itself; do not send one.

### Request body

```json
{
  "doomscrolling": true,
  "slouching": false,
  "sleeping": false,
  "drinkingWater": false,
  "tempRaw": 2734
}
```

| field | type | constraints |
|---|---|---|
| `doomscrolling` | boolean | required, strict `true`/`false` (no `1`/`0`/`"true"`) |
| `slouching` | boolean | required, same as above |
| `sleeping` | boolean | required, same as above |
| `drinkingWater` | boolean | required, same as above |
| `tempRaw` | integer | required, TMP117 raw 16-bit signed register value, range `-32768`–`32767`. If you don't have a real temp sensor, send any plausible placeholder in range (e.g. `2700`, which converts to ~21°C) |

Any missing/wrong-typed field returns `400` with a descriptive `{"error": "..."}`
message (see `hackmit26/server/domain.js`, `validateSensorReading`).

Temperature conversion (if you need °C yourself): `tempC = tempRaw * 0.0078125`.

### Response

- `201 { "id": "<uuid>" }` on success.
- `401 { "error": "Invalid robot API key." }` if the bearer key is wrong/missing.
- `400 { "error": "..." }` on validation failure.
- `429` if you exceed 180 requests/min to `/api/*` (shared rate limit).

### Example

```sh
curl -s -X POST http://localhost:3001/api/robot/sensors \
  -H "Authorization: Bearer $ROBOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"doomscrolling":true,"slouching":false,"sleeping":false,"drinkingWater":false,"tempRaw":2734}'
```

### Reference implementation

`cv-hackmit/push_sensor_data.py` already does this — reads `ROBOT_KEY`/`API_BASE`
from `.env`, and can push either random or forced-scenario labels on an
interval:

```sh
.venv/bin/python push_sensor_data.py --scenario slouching --count 1
.venv/bin/python push_sensor_data.py --interval 2   # continuous, random labels
```

Use it as a template for wiring in real CV detector output — replace
`random_reading()` with your model's per-frame/per-poll booleans.

## Endpoint: discrete habit occurrence (alternative, not used by push_sensor_data.py)

```
POST /api/robot/events
Authorization: Bearer <ROBOT_KEY>
Content-Type: application/json

{"habitId": "<uuid>"}
```

Use this instead of `/api/robot/sensors` if you want to log a single
one-off occurrence tied to a specific habit (not a continuous boolean
state). `habitId` must match an existing, active habit — see the `habits`
table in `hackmit26/data/nudge.sqlite`, or `GET /api/state` (session auth
required) for the current list and their categories:

- Doom scrolling, Slouching, Sitting too long, Falling asleep at desk,
  Skipping water breaks, Staying up late, Smoking, Poor lifting habits.

Rejects with `400` if the habit is paused or doesn't exist.

## Verifying data landed (no session auth needed)

Query the SQLite DB directly:

```sh
sqlite3 /Users/fumiokutsu/Documents/hackmit26/data/nudge.sqlite \
  "SELECT * FROM sensor_readings ORDER BY createdAt DESC LIMIT 10;" -header -column
```

## What NOT to expect

- The dashboard frontend does **not** currently render `sensor_readings`
  data (no chart/panel exists for it yet). Pushing data only visibly
  updates the "Last seen" pill on the **Devices & robot** page. Don't treat
  an unchanged dashboard as a failed push — check the DB or hit
  `GET /api/sensors/latest` (needs a session cookie) to confirm ingestion.
