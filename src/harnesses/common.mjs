// Shared driver helpers. A driver is a plain object (see ADDING-A-HARNESS.md):
//   name, title, binaries[], knownLocations[], versionArgs, pin{kind,...}, status ("verified"|"unverified"),
//   configure(sb, mock, spec)  write the harness's NATIVE config from the canonical setup spec
//   env(sb, mock)              extra environment for every invocation (isolation + mock endpoint + telemetry off)
//   headless(sb, {prompt, agent, mode}) -> argv for one non-interactive turn
//   parse(stdout, stderr)      -> normalized events [{type:"text"|"tool_call"|"tool_result"|"error"|"end", ...}]
//   tier0(sb)                  -> [{id, argv, check(result)->{ok, evidence}}] offline listing/validation commands
//   cleanup(sb)                optional (e.g. stop a background service)
import path from "node:path";
import { writeFile, symlink } from "../util.mjs";

export const jsonLines = (s) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

// Link the shared (~/.agents) layer into a harness's native locations, the way the real installers do.
export function linkAgents(sb, spec, dir, { suffix = ".md" } = {}) {
  if (spec.agentsLinked) return; // agents-doctor already linked them
  for (const a of spec.agents) symlink(a.file, path.join(sb.home, dir, a.name + suffix));
}
export function linkSkills(sb, spec, dir) {
  for (const s of spec.skills) symlink(s.dir, path.join(sb.home, dir, s.name));
}
export { writeFile, symlink };

export const DUMMY_KEY = "conformance-dummy-key-not-a-secret";
