// Dependency-free rasterization of our simple, code-designed app mark.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { owlShapes } from "../shared/owl-art.js";

const background = "#e6deed";
const rgb = (hex) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const shapes = owlShapes
  .flatMap(({ parts }) => parts)
  .map((shape) => {
    const vertices = shape.points
      ?.split(" ")
      .map((point) => point.split(",").map(Number));
    return {
      ...shape,
      color: rgb(shape.fill),
      vertices,
      bounds: vertices
        ? [
            Math.min(...vertices.map(([x]) => x)),
            Math.min(...vertices.map(([, y]) => y)),
            Math.max(...vertices.map(([x]) => x)),
            Math.max(...vertices.map(([, y]) => y)),
          ]
        : [
            shape.cx - shape.r,
            shape.cy - shape.r,
            shape.cx + shape.r,
            shape.cy + shape.r,
          ],
    };
  });

function contains(shape, x, y) {
  const [left, top, right, bottom] = shape.bounds;
  if (x < left || x > right || y < top || y > bottom) return false;
  if (!shape.vertices)
    return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2;
  let inside = false;
  const points = shape.vertices;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// The mark stays inside the central maskable safe area. No rounded background.
writeFileSync(
  new URL("../public/icon.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="${background}"/><g transform="translate(9.6 12.72) scale(.48)">${shapes.map((shape) => (shape.points ? `<polygon points="${shape.points}" fill="${shape.fill}"/>` : `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.fill}"/>`)).join("")}</g></svg>\n`,
);
const crc = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, sum]);
}
for (const size of [192, 512]) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const color = [0, 0, 0];
      // Four samples per pixel keep curves smooth at both icon sizes.
      for (const dy of [0.25, 0.75])
        for (const dx of [0.25, 0.75]) {
          const px = (((x + dx) / size) * 192 - 9.6) / 0.48;
          const py = (((y + dy) / size) * 192 - 12.72) / 0.48;
          let sample = rgb(background);
          for (const shape of shapes)
            if (contains(shape, px, py)) sample = shape.color;
          for (let channel = 0; channel < 3; channel++)
            color[channel] += sample[channel] / 4;
        }
      const offset = y * (1 + size * 4) + 1 + x * 4;
      raw.set([...color.map(Math.round), 255], offset);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    new URL(`../public/icon-${size}.png`, import.meta.url),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
console.log(
  "Generated SVG, 192px, and 512px owl icons from the shared artwork.",
);
