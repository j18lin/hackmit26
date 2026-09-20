// Owlert's barn owl: a rounded crown, heart-shaped facial disk, and folded
// flight feathers. The same filled geometry drives the UI and app icons.
const ink = "#243c31";
const forest = "#355443";
const sage = "#759077";
const copper = "#bd784b";
const amber = "#dfa16a";
const cream = "#fff2d8";
const oat = "#e9d7b5";
const umber = "#855137";

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

function reflect(shape) {
  return {
    ...shape,
    points: shape.points
      .split(" ")
      .map((point) => {
        const [x, y] = point.split(",").map(Number);
        return `${(360 - x).toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" "),
  };
}

const leftWing = [
  curve(
    ink,
    [116, 145],
    [
      [88, 156, 82, 191, 93, 223],
      [99, 244, 115, 266, 135, 274],
      [141, 277, 147, 271, 145, 264],
      [137, 242, 142, 213, 140, 186],
      [139, 166, 130, 151, 116, 145],
    ],
  ),
  curve(
    forest,
    [115, 154],
    [
      [95, 166, 91, 194, 101, 223],
      [108, 243, 120, 258, 136, 267],
      [125, 239, 135, 210, 132, 183],
      [131, 169, 126, 160, 115, 154],
    ],
  ),
  // Three tapered vanes give the folded wing its own visual rhythm.
  curve(
    sage,
    [105, 181],
    [
      [100, 200, 106, 222, 120, 235],
      [113, 216, 109, 199, 105, 181],
    ],
  ),
  curve(
    sage,
    [117, 181],
    [
      [113, 204, 118, 223, 128, 234],
      [123, 214, 123, 197, 117, 181],
    ],
  ),
  curve(
    amber,
    [107, 164],
    [
      [103, 165, 101, 169, 102, 173],
      [107, 172, 110, 169, 107, 164],
    ],
  ),
];

const leftFoot = curve(
  umber,
  [148, 270],
  [
    [144, 279, 143, 283, 135, 286],
    [131, 289, 134, 294, 139, 292],
    [143, 291, 146, 289, 148, 287],
    [147, 294, 155, 296, 156, 289],
    [161, 295, 167, 292, 163, 287],
    [159, 282, 157, 277, 157, 270],
    [154, 269, 151, 269, 148, 270],
  ],
);

export const owlViewBox = "0 0 360 330";
export const owlShapes = [
  {
    className: "owl-tail",
    parts: [{ fill: umber, points: "155,248 164,289 180,282 196,289 205,248" }],
  },
  { className: "owl-feet", parts: [leftFoot, reflect(leftFoot)] },
  {
    className: "owl-body",
    parts: [
      curve(
        ink,
        [180, 133],
        [
          [139, 121, 109, 145, 109, 189],
          [108, 244, 133, 282, 180, 282],
          [227, 282, 252, 244, 251, 189],
          [251, 145, 221, 121, 180, 133],
        ],
      ),
      curve(
        oat,
        [180, 141],
        [
          [145, 130, 117, 150, 117, 191],
          [116, 238, 139, 274, 180, 274],
          [221, 274, 244, 238, 243, 191],
          [243, 150, 215, 130, 180, 141],
        ],
      ),
      curve(
        cream,
        [180, 158],
        [
          [157, 154, 135, 176, 135, 207],
          [135, 239, 151, 263, 180, 274],
          [209, 263, 225, 239, 225, 207],
          [225, 176, 203, 154, 180, 158],
        ],
      ),
      // Sparse breast feathers, not a separate cartoon belly patch.
      { fill: copper, points: "157,205 162,210 168,205 163,216" },
      { fill: copper, points: "192,205 198,210 203,205 197,216" },
      { fill: copper, points: "174,224 180,229 186,224 180,235" },
      { fill: copper, points: "158,243 163,247 168,243 163,253" },
      { fill: copper, points: "192,243 197,247 202,243 197,253" },
    ],
  },
  { className: "owl-wing owl-wing-left", parts: leftWing },
  { className: "owl-wing owl-wing-right", parts: leftWing.map(reflect) },
  {
    className: "owl-face",
    parts: [
      curve(
        ink,
        [180, 42],
        [
          [134, 42, 103, 52, 92, 82],
          [77, 119, 92, 156, 126, 179],
          [141, 189, 160, 196, 180, 202],
          [200, 196, 219, 189, 234, 179],
          [268, 156, 283, 119, 268, 82],
          [257, 52, 226, 42, 180, 42],
        ],
      ),
      curve(
        copper,
        [180, 49],
        [
          [138, 49, 109, 57, 99, 85],
          [86, 118, 100, 151, 131, 173],
          [146, 183, 163, 189, 180, 195],
          [197, 189, 214, 183, 229, 173],
          [260, 151, 274, 118, 261, 85],
          [251, 57, 222, 49, 180, 49],
        ],
      ),
      curve(
        amber,
        [116, 77],
        [
          [134, 52, 164, 54, 180, 59],
          [196, 54, 226, 52, 244, 77],
          [219, 63, 202, 67, 180, 75],
          [158, 67, 141, 63, 116, 77],
        ],
      ),
      curve(
        umber,
        [180, 87],
        [
          [149, 60, 112, 66, 104, 98],
          [94, 139, 130, 170, 180, 191],
          [230, 170, 266, 139, 256, 98],
          [248, 66, 211, 60, 180, 87],
        ],
      ),
      curve(
        cream,
        [180, 95],
        [
          [150, 71, 121, 73, 113, 101],
          [104, 133, 137, 162, 180, 182],
          [223, 162, 256, 133, 247, 101],
          [239, 73, 210, 71, 180, 95],
        ],
      ),
      // Soft cheek arcs follow the facial disk rather than framing each eye.
      curve(
        oat,
        [119, 132],
        [
          [132, 152, 153, 159, 168, 164],
          [148, 163, 128, 151, 119, 132],
        ],
      ),
      curve(
        oat,
        [241, 132],
        [
          [228, 152, 207, 159, 192, 164],
          [212, 163, 232, 151, 241, 132],
        ],
      ),
    ],
  },
  {
    className: "owl-eyes",
    parts: [
      oval(umber, 145, 120, 14, 17),
      oval(umber, 215, 120, 14, 17),
      oval(ink, 146, 120, 10, 14),
      oval(ink, 214, 120, 10, 14),
      { fill: cream, cx: 143, cy: 115, r: 3.5 },
      { fill: cream, cx: 211, cy: 115, r: 3.5 },
      { fill: amber, cx: 150, cy: 128, r: 1.6 },
      { fill: amber, cx: 218, cy: 128, r: 1.6 },
    ],
  },
  {
    className: "owl-beak",
    parts: [
      curve(
        umber,
        [180, 132],
        [
          [175, 135, 170, 140, 172, 148],
          [173, 153, 177, 162, 180, 166],
          [183, 162, 187, 153, 188, 148],
          [190, 140, 185, 135, 180, 132],
        ],
      ),
      { fill: amber, points: "180,137 175,145 180,159 183,145" },
    ],
  },
];
