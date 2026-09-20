// The water break is a *prompted* check, not continuous monitoring.
//
// When a water reminder goes out to the phone, a grace window opens. If a
// bottle appears on camera before it closes, the break was taken -- the robot
// is pleased and nothing is logged. If the window closes without one, the
// break was missed: that's the violation, and the robot is unhappy about it.
//
// This is why the dashboard counter reads "Missed water breaks". Seeing a
// bottle is the *good* outcome; only the absence of one is recorded.
const WINDOW_MS = 60000;

let openedAt = null;
let deadline = null;
let lastOutcome = null; // "taken" | "missed", for the UI

export function waterWindowOpen(now = Date.now()) {
  return deadline !== null && now < deadline;
}

export function waterStatus(now = Date.now()) {
  return {
    open: waterWindowOpen(now),
    secondsLeft: waterWindowOpen(now) ? Math.ceil((deadline - now) / 1000) : 0,
    lastOutcome,
  };
}

/** Called when a water reminder is pushed to the phone. */
export function openWaterWindow(now = Date.now()) {
  openedAt = now;
  deadline = now + WINDOW_MS;
  lastOutcome = null;
  return waterStatus(now);
}

export function resetWaterCheck() {
  openedAt = null;
  deadline = null;
  lastOutcome = null;
}

/**
 * Feed each frame's reading in.
 * Returns "taken" the moment a bottle shows inside the window, "missed" once
 * the window closes without one, and null on every other frame -- so each
 * outcome fires exactly once per reminder.
 */
export function updateWaterCheck(reading = {}, now = Date.now()) {
  if (deadline === null) return null;

  if (reading.drinkingWater) {
    deadline = null;
    openedAt = null;
    lastOutcome = "taken";
    return "taken";
  }

  if (now >= deadline) {
    deadline = null;
    openedAt = null;
    lastOutcome = "missed";
    return "missed";
  }
  return null;
}
