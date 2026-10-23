// Harness profiles keyed by DETECTED name. Nothing else in the tool hard-codes the harness set:
// detect.mjs finds harnesses; profiles here only ENRICH them (isolation + mock-endpoint wiring + parsing).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import claude from "./claude.mjs";
import opencode from "./opencode.mjs";
import grok from "./grok.mjs";
import codex from "./codex.mjs";
import pi from "./pi.mjs";
import { which, ROOT } from "../util.mjs";

export const PROFILES = { claude, opencode, grok, codex, pi };
export const driverFor = (name) => PROFILES[name] || null;

const expand = (p) => p.replace(/^~(?=$|\/)/, os.homedir());

// Resolution order: HC_BIN_<NAME>, pinned install (.harnesses/node_modules/.bin), PATH, well-known locations.
export function resolveBinary(name, driver = driverFor(name), env = process.env) {
  const override = env[`HC_BIN_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
  if (override && fs.existsSync(override)) return { path: override, via: "env" };
  const bins = driver?.binaries || [name];
  const pinned = [path.join(ROOT, ".harnesses/node_modules/.bin"), path.join(ROOT, ".harnesses/stretch/node_modules/.bin"), path.join(ROOT, ".harnesses/bin")];
  for (const b of bins) {
    const p = which(b, pinned);
    if (p) return { path: p, via: "pinned" };
  }
  for (const b of bins) {
    const p = which(b, (env.PATH || "").split(path.delimiter));
    if (p) return { path: p, via: "PATH" };
  }
  if (env.HC_HERMETIC === "1") return null; // tests: never reach for binaries outside PATH / pinned dirs
  for (const k of driver?.knownLocations || []) {
    const p = expand(k);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return { path: p, via: "known-location" };
    } catch {}
  }
  return null;
}
