// Turns the live violation densities into a robot mood.
//
// The Uno Q reports, per habit, what fraction of its sliding window was bad
// (the same number the dashboard draws as a progress bar). Rather than only
// reacting at the moment a violation fires, the robot reflects that build-up.
//
// The cycle is unhappy -> happy -> neutral: it scolds while you're drifting,
// visibly approves once you fix it, then settles back to resting neutral
// rather than grinning forever.
//
//   density >= SAD_DENSITY, or violation .... UNHAPPY -> NEGATIVE
//                                             (held UNHAPPY_HOLD_MS)
//   recovered from unhappy, or drank water .. HAPPY   -> POSITIVE
//                                             (held HAPPY_DURATION_MS)
//   otherwise ............................... NEUTRAL -> NORMAL
//
// The sketch only understands NEGATIVE / POSITIVE / NORMAL, and picks the
// angry-or-sad face itself (at random) on NEGATIVE -- the host can't choose
// between them. So the ladder controls *when* the robot is unhappy, not
// which unhappy face it wears.
import { sendExpression } from "./arduino.js";

// Fraction of the way to a violation before the robot starts reacting.
const SAD_DENSITY = 0.3;
const CALM_DENSITY = 0.1;
// Minimum time to stay unhappy after a violation, so it doesn't flicker back
// the instant the density dips.
const UNHAPPY_HOLD_MS = 15000;
// How long the "well done" face lasts before settling to neutral.
const HAPPY_DURATION_MS = 10000;

// The sketch reverts to a neutral face STATE_TIMEOUT_MS (15s) after the last
// NEGATIVE, so a sustained bad stretch has to be refreshed or the robot
// quietly cheers up while you're still slouching.
const NEGATIVE_REFRESH_MS = 10000;

// drinkingWater is tracked like the others but is a good thing, so it never
// feeds the unhappy ladder.
const BAD_FIELDS = ["slouching", "doomscrolling", "sleeping", "handNearFace"];

const COMMANDS = { UNHAPPY: "NEGATIVE", NEUTRAL: "NORMAL", HAPPY: "POSITIVE" };

let mood = "NEUTRAL";
let unhappyUntil = 0;
let happyUntil = 0;
let lastSentAt = 0;

export function currentMood() {
  return mood;
}

export function resetMood() {
  mood = "NEUTRAL";
  unhappyUntil = 0;
  happyUntil = 0;
  lastSentAt = 0;
}

export function updateMood(
  progress = {},
  violations = [],
  reading = {},
  now = Date.now(),
) {
  const density = Math.max(
    0,
    ...BAD_FIELDS.map((field) => progress?.[field]?.progress ?? 0),
  );

  if (violations.some((field) => BAD_FIELDS.includes(field)))
    unhappyUntil = now + UNHAPPY_HOLD_MS;

  // Seeing a bottle is rewarded the moment it appears -- no threshold, no
  // accumulator. Drinking is the one behaviour we want to encourage on
  // sight, so it also outranks being unhappy about posture.
  const drinking = Boolean(reading?.drinkingWater);
  if (drinking) happyUntil = now + HAPPY_DURATION_MS;

  // A missed water break is a violation like any other: the robot should be
  // annoyed, not pleased. (Seeing the bottle is what earns happy, above.)
  if (violations.includes("drinkingWater")) unhappyUntil = now + UNHAPPY_HOLD_MS;

  const staysUnhappy = now < unhappyUntil || density >= SAD_DENSITY;
  // Fixing your posture is what earns the happy face -- it only fires coming
  // out of an unhappy stretch, so it reads as a reaction rather than a mood
  // the robot drifts into on its own.
  if (mood === "UNHAPPY" && !staysUnhappy && density <= CALM_DENSITY)
    happyUntil = now + HAPPY_DURATION_MS;

  let next;
  if (drinking) next = "HAPPY";
  else if (staysUnhappy) next = "UNHAPPY";
  else if (now < happyUntil) next = "HAPPY";
  else next = "NEUTRAL";

  // Send on change, and keep re-sending NEGATIVE while unhappy so the
  // board's own 15s timeout doesn't drop it back to neutral.
  const changed = next !== mood;
  const needsRefresh =
    next === "UNHAPPY" && now - lastSentAt >= NEGATIVE_REFRESH_MS;
  if (changed || needsRefresh) {
    mood = next;
    lastSentAt = now;
    sendExpression(COMMANDS[next]);
  }
  return { mood, density: Number(density.toFixed(2)) };
}
