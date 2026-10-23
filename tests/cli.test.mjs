import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { run } from "../src/proc.mjs";
import { ROOT } from "../src/util.mjs";
import { FAKE_CLAUDE, tmp, post } from "./helpers.mjs";

const BIN = path.join(ROOT, "bin/harness-conformance");
const env = { ...process.env, HC_BIN_CLAUDE: FAKE_CLAUDE, HC_NO_INVENTORY: "1", HC_HERMETIC: "1" };
const cli = (args, e = env) => run(process.execPath, [BIN, ...args], { env: e, timeoutMs: 120_000 });

test("help, version, usage errors", async () => {
  assert.match((await cli(["help"])).stdout, /USAGE/);
  assert.match((await cli(["--version"])).stdout, /^\d+\.\d+\.\d+/);
  const bad = await cli(["nope"]);
  assert.equal(bad.code, 64);
  assert.equal((await cli(["run", "--tier", "9"])).code, 64);
  assert.equal((await cli(["run", "--bogus"])).code, 64);
});

test("list --json exposes the lockstep table", async () => {
  const j = JSON.parse((await cli(["list", "--json"])).stdout);
  assert.equal(j.schema, "harness-conformance/list/v1");
  assert.deepEqual(j.scenarios.map((s) => s.id).slice(0, 3), ["T0.1", "T0.2", "S1"]);
  assert.equal(j.scenarios.find((s) => s.id === "S13").expect.grok.status, "XFAIL");
});

test("doctor --json lists the explicit harness and its driver status", async () => {
  const j = JSON.parse((await cli(["doctor", "--json", "--harness", "claude", "--harness", "zzagent"])).stdout);
  assert.deepEqual(j.harnesses.map((h) => [h.name, h.status]), [["claude", "driver"], ["zzagent", "detected-no-driver"]]);
  assert.equal(j.harnesses[0].version, "9.9.9");
});

test("run --out/--summary writes matrix JSON and Markdown; exit 0 when lockstep holds", async () => {
  const d = tmp();
  const r = await cli(["run", "--harness", "claude", "--scenario", "T0.1", "--scenario", "S1", "--no-siblings", "--out", `${d}/m.json`, "--summary", `${d}/m.md`, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(`${d}/m.json`, "utf8")).results.length, 2);
  assert.match(fs.readFileSync(`${d}/m.md`, "utf8"), /lockstep holds/);
  assert.equal(JSON.parse(r.stdout).schema, "harness-conformance/matrix/v1");
  // matrix command re-renders and merges
  const md = await cli(["matrix", `${d}/m.json`, `${d}/m.json`]);
  assert.equal(md.code, 0);
  assert.match(md.stdout, /Harness conformance matrix/);
});

test("run exits 1 on a gating failure and appends to GITHUB_STEP_SUMMARY", async () => {
  const d = tmp();
  const summary = path.join(d, "summary.md");
  const r = await cli(["run", "--harness", "claude", "--scenario", "S6", "--no-siblings", "--github-summary"], { ...env, HC_NEGATIVE: "1", GITHUB_STEP_SUMMARY: summary });
  assert.equal(r.code, 1);
  assert.match(fs.readFileSync(summary, "utf8"), /Gating divergences/);
});

test("--require-installed turns NOT-INSTALLED into a gating failure", async () => {
  const r = await cli(["run", "--harness", "opencode", "--scenario", "T0.1", "--require-installed", "--no-siblings"], { ...env, PATH: "/usr/bin:/bin" });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /NOT-INSTALLED/);
});

test("mock subcommand serves the Anthropic API and stays up until killed", async () => {
  const child = spawn(BIN, ["mock", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const url = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("mock did not start")), 10_000);
    child.stdout.on("data", () => {
      const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) (clearTimeout(t), res(m[1]));
    });
  });
  try {
    const r = await post(`${url}/v1/messages`, { model: "m", stream: false, messages: [{ role: "user", content: "x" }] });
    assert.equal(JSON.parse(r.text).content[0].text, "ok");
  } finally {
    child.kill();
  }
});
