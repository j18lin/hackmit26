// Bridges the browser to the Arduino Uno Q inference server.
//
// The board speaks a raw length-prefixed TCP protocol on port 5005 (see
// hardware/cv/bench/tcp_infer_server.py), which a browser cannot open
// directly -- so the frontend POSTs JPEG frames here and this forwards them
// over TCP. All the CV work (MoveNet + EfficientDet + the int8 classifier,
// posture calibration, and the sliding-window violation tracker) still runs
// on the board; this is transport only, no inference logic.
//
// Request:  1 mode byte (I=infer, C=calibration sample, R=reset calibration)
//           + 4-byte big-endian length + that many JPEG bytes.
// Response: 4-byte big-endian length + that many bytes of UTF-8 JSON.
import net from "node:net";

const host = process.env.VISION_HOST || "10.31.181.91";
const port = Number(process.env.VISION_PORT) || 5005;
const timeoutMs = Number(process.env.VISION_TIMEOUT_MS) || 8000;

export const MODE_INFER = "I";
export const MODE_CALIBRATE = "C";
export const MODE_RESET = "R";

export function visionTarget() {
  return { host, port };
}

export function sendFrame(jpeg, mode = MODE_INFER) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks = [];
    let expected = null;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };

    socket.setTimeout(timeoutMs, () =>
      finish(new Error(`vision server ${host}:${port} timed out`)),
    );
    socket.on("error", (error) =>
      finish(new Error(`vision server ${host}:${port}: ${error.message}`)),
    );
    // The board closes the connection without replying when its handler
    // throws, so surface that as an error rather than hanging.
    socket.on("close", () =>
      finish(new Error("vision server closed the connection without replying")),
    );

    socket.on("connect", () => {
      const header = Buffer.alloc(5);
      header.write(mode, 0, 1, "ascii");
      header.writeUInt32BE(jpeg.length, 1);
      socket.write(header);
      if (jpeg.length) socket.write(jpeg);
    });

    socket.on("data", (chunk) => {
      chunks.push(chunk);
      let buffer = Buffer.concat(chunks);
      if (expected === null) {
        if (buffer.length < 4) return;
        expected = buffer.readUInt32BE(0);
      }
      buffer = Buffer.concat(chunks);
      if (buffer.length < 4 + expected) return;
      try {
        finish(null, JSON.parse(buffer.subarray(4, 4 + expected).toString("utf8")));
      } catch (error) {
        finish(new Error(`bad JSON from vision server: ${error.message}`));
      }
    });
  });
}
