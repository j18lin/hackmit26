import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { owlShapes, owlViewBox } from "../shared/owl-art.js";

const parts = owlShapes.flatMap(({ parts }) => parts);
const iconScale = 0.48;
const iconOffset = [9.6, 12.72];
const iconCenter = 96;
const safeRadius = 76.8;
const tolerance = 1e-8;

function vertices(shape) {
  return shape.points.split(" ").map((point) => point.split(",").map(Number));
}

function iconRadius(x, y) {
  return Math.hypot(
    x * iconScale + iconOffset[0] - iconCenter,
    y * iconScale + iconOffset[1] - iconCenter,
  );
}

test("shared owl artwork supports both renderers and retains animation hooks", () => {
  const viewBox = owlViewBox.split(/\s+/).map(Number);
  assert.equal(viewBox.length, 4);
  assert.ok(viewBox.every(Number.isFinite));
  assert.ok(viewBox[2] > 0 && viewBox[3] > 0);
  assert.ok(owlShapes.length > 0);
  const groupNames = owlShapes.map(({ className }) => className);
  assert.equal(new Set(groupNames).size, groupNames.length);
  for (const hook of ["owl-eyes", "owl-wing-left", "owl-wing-right"]) {
    const group = owlShapes.find(({ className }) =>
      className.split(/\s+/).includes(hook),
    );
    assert.ok(group, `Missing ${hook} animation hook`);
    if (hook.startsWith("owl-wing-"))
      assert.ok(group.className.split(/\s+/).includes("owl-wing"));
  }
  for (const group of owlShapes) {
    assert.equal(typeof group.className, "string");
    assert.ok(group.className.trim());
    assert.ok(Array.isArray(group.parts) && group.parts.length > 0);
    for (const shape of group.parts) {
      assert.match(shape.fill, /^#[0-9a-f]{6}$/i);
      if (Object.hasOwn(shape, "points")) {
        assert.equal(typeof shape.points, "string");
        const points = vertices(shape);
        assert.ok(points.length >= 3);
        assert.ok(
          shape.points
            .split(" ")
            .every((point) =>
              point.split(",").every((coordinate) => coordinate.trim() !== ""),
            ),
        );
        assert.ok(
          points.every(
            (point) => point.length === 2 && point.every(Number.isFinite),
          ),
        );
        assert.deepEqual(Object.keys(shape).sort(), ["fill", "points"]);
      } else {
        assert.ok([shape.cx, shape.cy, shape.r].every(Number.isFinite));
        assert.ok(shape.r > 0);
        assert.deepEqual(Object.keys(shape).sort(), ["cx", "cy", "fill", "r"]);
      }
    }
  }
});

test("owl geometry stays within the illustration viewBox", () => {
  const [left, top, width, height] = owlViewBox.split(/\s+/).map(Number);
  for (const shape of parts) {
    const points = shape.points
      ? vertices(shape)
      : [
          [shape.cx - shape.r, shape.cy - shape.r],
          [shape.cx + shape.r, shape.cy + shape.r],
        ];
    for (const [x, y] of points) {
      assert.ok(x >= left && x <= left + width, `Out-of-viewBox x: ${x}`);
      assert.ok(y >= top && y <= top + height, `Out-of-viewBox y: ${y}`);
    }
  }
});

test("wing animation pivots and every flight angle keep artwork inside the viewBox", () => {
  const css = readFileSync(
    new URL("../src/owl-theme.css", import.meta.url),
    "utf8",
  );
  const [left, top, width, height] = owlViewBox.split(/\s+/).map(Number);
  const wings = [
    {
      className: "owl-wing-left",
      pivot: [116, 149],
      animation: "wingLeft",
      angles: [58, 8],
    },
    {
      className: "owl-wing-right",
      pivot: [244, 149],
      animation: "wingRight",
      angles: [-58, -8],
    },
  ];
  for (const wing of wings) {
    const rule = css.match(
      new RegExp(`^\\.${wing.className}\\s*\\{([^}]+)\\}`, "m"),
    );
    assert.ok(rule, `Missing ${wing.className} CSS rule`);
    const origin = rule[1].match(
      /transform-origin:\s*([-\d.]+)px\s+([-\d.]+)px/,
    );
    assert.ok(origin, `Missing ${wing.className} transform origin`);
    assert.deepEqual(origin.slice(1).map(Number), wing.pivot);
    const frames = css.match(
      new RegExp(
        `@keyframes\\s+${wing.animation}\\s*\\{\\s*from\\s*\\{([^}]*)\\}\\s*to\\s*\\{([^}]*)\\}\\s*\\}`,
      ),
    );
    assert.ok(frames, `Missing ${wing.animation} from/to keyframes`);
    const angles = frames.slice(1).map((frame) => {
      const rotation = frame.match(/transform:\s*rotate\(([-\d.]+)deg\)/);
      assert.ok(rotation, `Missing ${wing.animation} rotation`);
      return Number(rotation[1]);
    });
    assert.deepEqual(angles, wing.angles);
    const group = owlShapes.find(({ className }) =>
      className.split(/\s+/).includes(wing.className),
    );
    assert.ok(group, `Missing ${wing.className} artwork`);
    for (
      let angle = Math.min(...angles);
      angle <= Math.max(...angles);
      angle++
    ) {
      const radians = (angle * Math.PI) / 180;
      const rotate = ([x, y]) => [
        wing.pivot[0] +
          (x - wing.pivot[0]) * Math.cos(radians) -
          (y - wing.pivot[1]) * Math.sin(radians),
        wing.pivot[1] +
          (x - wing.pivot[0]) * Math.sin(radians) +
          (y - wing.pivot[1]) * Math.cos(radians),
      ];
      for (const shape of group.parts) {
        const points = shape.points
          ? vertices(shape).map(rotate)
          : (() => {
              const [cx, cy] = rotate([shape.cx, shape.cy]);
              return [
                [cx - shape.r, cy - shape.r],
                [cx + shape.r, cy + shape.r],
              ];
            })();
        for (const [x, y] of points) {
          assert.ok(
            x >= left - tolerance && x <= left + width + tolerance,
            `${wing.className} at ${angle}deg exceeds viewBox x: ${x}`,
          );
          assert.ok(
            y >= top - tolerance && y <= top + height + tolerance,
            `${wing.className} at ${angle}deg exceeds viewBox y: ${y}`,
          );
        }
      }
    }
  }
});

test("all owl geometry fits the circular maskable icon safe area", () => {
  for (const shape of parts) {
    const radius = shape.points
      ? Math.max(...vertices(shape).map(([x, y]) => iconRadius(x, y)))
      : iconRadius(shape.cx, shape.cy) + shape.r * iconScale;
    assert.ok(
      radius <= safeRadius + tolerance,
      `Artwork radius ${radius} exceeds the ${safeRadius}px safe area`,
    );
  }
});

test("generated SVG preserves dimensions, icon placement, and every shape geometry and fill", () => {
  const svg = readFileSync(
    new URL("../public/icon.svg", import.meta.url),
    "utf8",
  );
  assert.match(svg, /<svg\b[^>]*\bviewBox="0 0 192 192"/);
  assert.match(svg, /<rect\b[^>]*\bwidth="192"[^>]*\bheight="192"/);
  const transform = svg.match(
    /<g\b[^>]*\btransform="translate\(([^)]+)\)\s+scale\(([^)]+)\)"/,
  );
  assert.ok(transform, "Missing shared artwork icon transform");
  assert.deepEqual(
    transform[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number),
    iconOffset,
  );
  assert.equal(Number(transform[2]), iconScale);
  const rendered = [...svg.matchAll(/<(polygon|circle)\b([^>]*)\/?\s*>/g)].map(
    ([, type, attributes]) => ({
      type,
      attributes: Object.fromEntries(
        [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(
          ([, name, value]) => [name, value],
        ),
      ),
    }),
  );
  assert.deepEqual(
    rendered.map(({ type, attributes }) => ({ type, fill: attributes.fill })),
    parts.map((shape) => ({
      type: shape.points ? "polygon" : "circle",
      fill: shape.fill,
    })),
    "Regenerate icons after changing shared artwork",
  );
  for (const [index, shape] of parts.entries()) {
    const actual = rendered[index].attributes;
    const message = `Regenerate icons: shape ${index} geometry differs from shared artwork`;
    if (shape.points) {
      assert.equal(typeof actual.points, "string", message);
      const actualPoints = vertices({ points: actual.points });
      const expectedPoints = vertices(shape);
      assert.equal(actualPoints.length, expectedPoints.length, message);
      for (let point = 0; point < expectedPoints.length; point++)
        assert.deepEqual(
          actualPoints[point],
          expectedPoints[point],
          `${message} at point ${point}`,
        );
    } else {
      for (const coordinate of ["cx", "cy", "r"])
        assert.equal(Number(actual[coordinate]), shape[coordinate], message);
    }
  }
});

test("generated PNG icons have the required raster dimensions", () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const size of [192, 512]) {
    const png = readFileSync(
      new URL(`../public/icon-${size}.png`, import.meta.url),
    );
    assert.ok(png.length >= 33);
    assert.deepEqual(png.subarray(0, 8), signature);
    assert.equal(png.readUInt32BE(8), 13);
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
