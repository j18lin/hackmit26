// Logs count unwanted occurrences: long scrolling sessions or missed water
// breaks. Drinking water itself is never counted as a bad habit.
export const habitPresets = [
  {
    key: "doom-scrolling",
    name: "Doomscrolling",
    category: "screen",
    dailyLimit: 3,
    description:
      "Pause the feed. Is this how you want to spend your time right now?",
    hint: "Log a scrolling session that went beyond what you intended.",
  },
  {
    key: "water-breaks",
    name: "Drinking water",
    category: "hydration",
    dailyLimit: 3,
    description:
      "Make time for a water break. Log a missed break when you need a reminder.",
    hint: "Track missed water breaks, not the glasses of water you drink.",
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
