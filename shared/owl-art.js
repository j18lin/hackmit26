// Flat cartoon artwork shared by the animated owl and installed-app icons.
// Cubic curves are sampled once so both renderers use exactly the same outline.
const purple = "#9568d2";
const wing = "#7950b1";
const cream = "#fff8ea";
const ink = "#30253e";
const gold = "#efb44f";

function curve(fill, start, segments) {
  let [x, y] = start;
  const points = [start];
  for (const [ax, ay, bx, by, endX, endY] of segments) {
    for (let step = 1; step <= 16; step++) {
      const t = step / 16;
      const u = 1 - t;
      points.push([
        u ** 3 * x + 3 * u ** 2 * t * ax + 3 * u * t ** 2 * bx + t ** 3 * endX,
        u ** 3 * y + 3 * u ** 2 * t * ay + 3 * u * t ** 2 * by + t ** 3 * endY,
      ]);
    }
    [x, y] = [endX, endY];
  }
  return {
    fill,
    points: points
      .map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`)
      .join(" "),
  };
}

function oval(fill, cx, cy, rx, ry) {
  return {
    fill,
    points: Array.from({ length: 64 }, (_, i) => {
      const angle = (i / 64) * Math.PI * 2;
      return `${(cx + Math.cos(angle) * rx).toFixed(2)},${(cy + Math.sin(angle) * ry).toFixed(2)}`;
    }).join(" "),
  };
}

export const owlViewBox = "0 0 360 330";
export const owlShapes = [
  {
    className: "owl-feet",
    parts: [oval(gold, 139, 282, 24, 10), oval(gold, 221, 282, 24, 10)],
  },
  {
    className: "owl-wing owl-wing-left",
    parts: [
      curve(
        wing,
        [106, 145],
        [
          [79, 136, 51, 165, 49, 194],
          [45, 214, 64, 214, 87, 195],
          [106, 183, 119, 158, 106, 145],
        ],
      ),
    ],
  },
  {
    className: "owl-wing owl-wing-right",
    parts: [
      curve(
        wing,
        [254, 146],
        [
          [272, 128, 299, 114, 309, 125],
          [324, 142, 300, 166, 273, 184],
          [257, 191, 243, 161, 254, 146],
        ],
      ),
    ],
  },
  {
    className: "owl-body",
    parts: [
      curve(
        purple,
        [94, 105],
        [
          [84, 88, 81, 62, 93, 57],
          [105, 52, 119, 70, 137, 75],
          [163, 64, 197, 64, 223, 75],
          [241, 70, 255, 52, 267, 57],
          [279, 62, 276, 88, 266, 105],
          [281, 127, 282, 160, 281, 191],
          [281, 244, 247, 278, 180, 278],
          [113, 278, 79, 244, 79, 191],
          [78, 160, 79, 127, 94, 105],
        ],
      ),
    ],
  },
  {
    className: "owl-belly",
    parts: [
      oval("#b894e7", 180, 226, 52, 36),
      curve(
        "#d9c1f5",
        [151, 223],
        [
          [152, 214, 160, 214, 161, 223],
          [162, 233, 151, 235, 151, 223],
        ],
      ),
      curve(
        "#d9c1f5",
        [175, 232],
        [
          [176, 223, 184, 223, 185, 232],
          [186, 242, 175, 244, 175, 232],
        ],
      ),
      curve(
        "#d9c1f5",
        [199, 223],
        [
          [200, 214, 208, 214, 209, 223],
          [210, 233, 199, 235, 199, 223],
        ],
      ),
    ],
  },
  {
    className: "owl-face",
    parts: [oval(cream, 140, 140, 41, 48), oval(cream, 220, 140, 41, 48)],
  },
  {
    className: "owl-eyes",
    parts: [
      oval(ink, 147, 144, 15, 21),
      oval(ink, 217, 144, 15, 21),
      { cx: 152, cy: 137, r: 5, fill: "#ffffff" },
      { cx: 222, cy: 137, r: 5, fill: "#ffffff" },
    ],
  },
  {
    className: "owl-beak",
    parts: [
      curve(
        gold,
        [167, 174],
        [
          [170, 166, 176, 162, 180, 162],
          [184, 162, 190, 166, 193, 174],
          [193, 180, 185, 188, 180, 188],
          [175, 188, 167, 180, 167, 174],
        ],
      ),
    ],
  },
];
