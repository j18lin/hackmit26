// Loads config/constants.yaml, the source of truth also read by
// cv/constants.py, and converts minute-denominated values into the
// millisecond units the rest of the server works in.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(path.join(root, "config", "constants.yaml"), "utf8");
const constants = parse(raw);

export const sensorWindowHours = constants.sensors.windowHours;

export const sensorThresholdsMs = Object.fromEntries(
  Object.entries(constants.sensors.thresholdMinutes).map(([field, minutes]) => [
    field,
    minutes * 60000,
  ]),
);
