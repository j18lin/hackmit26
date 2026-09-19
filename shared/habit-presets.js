// A log always represents an unwanted occurrence. Hydration and sleep presets
// therefore track missed intentions rather than treating drinking/rest as bad.
export const habitPresets = [
  {
    key: "doom-scrolling",
    name: "Doom scrolling",
    category: "screen",
    dailyLimit: 3,
    description:
      "Pause the feed. Is this how you want to spend your time right now?",
    hint: "Log a scrolling session that went beyond what you intended.",
  },
  {
    key: "slouching",
    name: "Slouching",
    category: "posture",
    dailyLimit: 5,
    description: "Notice your posture. Take a moment to reset your position.",
    hint: "Log when you notice yourself slouching or losing your intended posture.",
  },
  {
    key: "sitting-too-long",
    name: "Sitting too long",
    category: "movement",
    dailyLimit: 4,
    description:
      "Been sitting longer than you planned? Take a moment for a movement break.",
    hint: "Log when you miss a movement break you planned to take.",
  },
  {
    key: "desk-sleep",
    name: "Falling asleep at desk",
    category: "sleep",
    dailyLimit: 1,
    description:
      "Feeling sleepy at your desk? Pause your task and check whether you need rest.",
    hint: "Log when you notice yourself nodding off at your desk.",
    future:
      "Planned: an optional spoken math or word challenge through ElevenLabs. Voice challenges are not connected yet and are not a substitute for rest.",
  },
  {
    key: "water-breaks",
    name: "Skipping water breaks",
    category: "hydration",
    dailyLimit: 3,
    description:
      "Time for a water check-in. Did you miss the break you planned?",
    hint: "Drinking means water here. Log a missed water break, not a glass of water you drink.",
  },
  {
    key: "bedtime",
    name: "Staying up late",
    category: "sleep",
    dailyLimit: 1,
    description:
      "Past your intended bedtime? Check in with your plan to wind down.",
    hint: "Log when you stay up past your intended bedtime. This counts occurrences; it does not measure sleep duration or set a bedtime alarm.",
  },
  {
    key: "smoking",
    name: "Smoking",
    category: "smoking",
    dailyLimit: 1,
    description:
      "Take a moment to notice the trigger and check in with your intention.",
    hint: "Log each smoking occurrence. The reminder threshold is a personal setting, not a safe allowance.",
  },
  {
    key: "lifting",
    name: "Poor lifting habits",
    category: "lifting",
    dailyLimit: 1,
    description:
      "Pause the lift and check your setup and technique before continuing.",
    hint: "Log a lift where you notice your technique needs attention. Automatic form detection is a future robot feature.",
  },
];

export function habitFromPreset(preset) {
  return {
    name: preset.name,
    description: preset.description,
    category: preset.category,
    dailyLimit: preset.dailyLimit,
    reminderMinutes: 0,
    active: true,
    presetKey: preset.key,
  };
}
