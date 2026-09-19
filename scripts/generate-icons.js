// Dependency-free rasterization of our simple, code-designed app mark.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
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
      const px = (x / size) * 192;
      const py = (y / size) * 192;
      let color = [33, 22, 47];
      const ellipse = (cx, cy, rx, ry) =>
        ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 < 1;
      const ear = (x) =>
        py >= 40 && py < 86 && x >= 45 && x < 77 && py > 40 + (x - 45) * 0.65;
      if (ellipse(96, 111, 58, 57) || ear(px) || ear(192 - px))
        color = [167, 128, 217];
      if (ellipse(71, 106, 29, 30) || ellipse(121, 106, 29, 30))
        color = [225, 202, 248];
      for (const center of [72, 120]) {
        if (Math.hypot(px - center, py - 106) < 17) color = [234, 193, 142];
        if (Math.hypot(px - center, py - 106) < 13) color = [32, 20, 46];
        if (Math.hypot(px - center - 4, py - 102) < 4) color = [255, 244, 237];
      }
      if (
        py >= 119 &&
        py <= 133 &&
        Math.abs(px - 96) < (py < 124 ? py - 118 : (134 - py) * 0.65)
      )
        color = [239, 188, 128];
      for (const center of [87, 105]) {
        if (
          py >= 145 &&
          py <= 152 &&
          Math.abs(py - (151 - Math.abs(px - center))) < 1.6 &&
          Math.abs(px - center) <= 5
        )
          color = [224, 199, 245];
      }
      const offset = y * (1 + size * 4) + 1 + x * 4;
      raw.set([...color, 255], offset);
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
console.log("Generated 192px and 512px PWA icons.");
