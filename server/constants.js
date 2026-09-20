// Loads config/constants.yaml, the shared source of truth for tunable
// numbers, so they don't get hardcoded again in server/index.js.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(path.join(root, "config", "constants.yaml"), "utf8");
const constants = parse(raw);

export const violationWindowHours = constants.violations.windowHours;
