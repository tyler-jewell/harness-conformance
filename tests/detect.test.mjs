import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinDetect, detectHarnesses, genericTier0, signature } from "../src/detect.mjs";
import { runConformance } from "../src/runner.mjs";
import { tmp, fakeBin } from "./helpers.mjs";

// An invented harness, "zzagent", that no part of this repo knows about.
function zzWorld({ binary = true } = {}) {
  const root = tmp("hc-zz-");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const d = path.join(home, ".zzagent");
  fs.mkdirSync(path.join(d, "agents"), { recursive: true });
  fs.mkdirSync(path.join(d, "skills/demo"), { recursive: true });
  fs.writeFileSync(path.join(d, "agents/helper.md"), "---\nname: helper\ndescription: x\n---\nbody\n");
  fs.writeFileSync(path.join(d, "skills/demo/SKILL.md"), "---\nname: demo\ndescription: y\n---\n");
  fs.writeFileSync(path.join(d, "AGENTS.md"), "hi\n");
  // A weak dot-dir (only a commands/ folder) must NOT be reported as a harness.
  fs.mkdirSync(path.join(home, ".config/weak/commands"), { recursive: true });
  if (binary) fakeBin(bin, "zzagent", `#!/bin/sh\ncase "$1" in --version) echo "zzagent 0.3.1";; --help) printf 'Usage: zzagent [options]\\n  -p, --print  headless\\n  run  do a thing\\n';; esac\n`);
  return { root, home, bin, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } };
}

test("signature(): scores agents, skills, instruction files", () => {
  const w = zzWorld();
  const ev = signature(path.join(w.home, ".zzagent"));
  assert.ok(ev.includes("agents/*.md with frontmatter") && ev.includes("skills/*/SKILL.md") && ev.includes("instruction file AGENTS.md"));
});

test("builtinDetect: names the harness after its dot-dir, ignores weak candidates", () => {
  const w = zzWorld();
  const found = builtinDetect({ home: w.home, pathDirs: w.env.PATH.split(":") });
  assert.deepEqual(found.map((h) => h.name), ["zzagent"]);
  assert.equal(found[0].confidence, "high");
  assert.equal(found[0].binary, path.join(w.bin, "zzagent"));
  assert.ok(found[0].evidence.some((e) => e.includes("binary")));
});

test("detectHarnesses: unknown harness is detected-no-driver, no hard-coded list", async () => {
  const w = zzWorld();
  const list = await detectHarnesses({ env: w.env, home: w.home, useInventory: false });
  const zz = list.find((h) => h.name === "zzagent");
  assert.equal(zz.status, "detected-no-driver");
  assert.equal(zz.driver, null);
  assert.equal(zz.source, "builtin");
});

test("explicit list (CI pins) skips detection and still reports no-driver names", async () => {
  const list = await detectHarnesses({ env: { PATH: "/usr/bin:/bin" }, explicit: ["claude", "zzagent"] });
  assert.deepEqual(list.map((h) => [h.name, h.status, h.source]), [["claude", "driver", "explicit"], ["zzagent", "detected-no-driver", "explicit"]]);
});

test("genericTier0: --version/--help work and headless flags are discovered", async () => {
  const w = zzWorld();
  const g = await genericTier0({ binary: path.join(w.bin, "zzagent") }, w.env);
  assert.ok(g.ok);
  assert.deepEqual(g.headless, ["-p", "run"]);
  assert.match(g.evidence, /zzagent 0\.3\.1/);
});

test("harness-inventory detect --json (schema v1) is preferred when available", async () => {
  const w = zzWorld();
  const inv = fakeBin(w.bin, "harness-inventory", `#!/bin/sh\ncat <<'EOF'\n{"schema":"harness-inventory/detect/v1","harnesses":[{"name":"zzagent","roots":[{"path":"~/.zzagent","kind":"dot"}],"confidence":0.9,"class":"confirmed","evidence":[{"signal":"skills-dir","path":"~/.zzagent/skills"}],"binary":{"path":"${w.bin}/zzagent","version":"0.3.1"},"knownProfile":null}]}\nEOF\n`);
  const list = await detectHarnesses({ env: { ...w.env, HC_HARNESS_INVENTORY: inv }, home: w.home });
  const zz = list.find((h) => h.name === "zzagent");
  assert.equal(zz.source, "harness-inventory");
  assert.equal(zz.confidence, "confirmed");
  assert.ok(zz.roots[0].endsWith(".zzagent") && !zz.roots[0].startsWith("~"));
});

test("a broken harness-inventory falls back to the built-in detector with a note", async () => {
  const w = zzWorld();
  const inv = fakeBin(w.bin, "harness-inventory", "#!/bin/sh\necho not-json\n");
  const list = await detectHarnesses({ env: { ...w.env, HC_HARNESS_INVENTORY: inv }, home: w.home });
  assert.equal(list.find((h) => h.name === "zzagent").source, "builtin");
  assert.match(list.notes[0], /not JSON/);
});

test("run: detected-no-driver gets a generic Tier-0 result that is advisory, never gating", async () => {
  const w = zzWorld();
  const r = await runConformance({ env: { ...w.env, HC_NO_INVENTORY: "1", HC_HERMETIC: "1" }, harnesses: ["zzagent"], tiers: [0, 1] });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].scenario, "T0.1");
  assert.equal(r.results[0].status, "ADVISORY-PASS");
  assert.match(r.results[0].evidence[0], /^detected-no-driver:/);
  assert.equal(r.meta[0].status, "detected-no-driver");
});

test("run: a detected dir with no binary and no driver produces no result rows, only a note", async () => {
  const w = zzWorld({ binary: false });
  const r = await runConformance({ env: { ...w.env, HC_NO_INVENTORY: "1", HC_HERMETIC: "1" }, tiers: [0] });
  assert.ok(!r.results.some((x) => x.harness === "zzagent"));
  assert.match(r.detectNotes.join("\n"), /zzagent/);
});
