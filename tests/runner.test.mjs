import test from "node:test";
import assert from "node:assert/strict";
import { runConformance, classify } from "../src/runner.mjs";
import { expectationFor } from "../src/expectations.mjs";
import { driverFor } from "../src/harnesses/index.mjs";
import { buildMatrix, mergeMatrices, renderMarkdown } from "../src/report.mjs";
import { FAKE_CLAUDE } from "./helpers.mjs";

const env = { ...process.env, HC_BIN_CLAUDE: FAKE_CLAUDE, HC_NO_INVENTORY: "1", HC_HERMETIC: "1" };

test("classify(): the lockstep status table", () => {
  const c = (status, actual) => classify({ status }, actual);
  assert.equal(c("PASS", "pass"), "PASS");
  assert.equal(c("PASS", "fail"), "FAIL");
  assert.equal(c("XFAIL", "fail"), "XFAIL");
  assert.equal(c("XFAIL", "pass"), "XPASS");
  assert.equal(c("SKIP", "pass"), "SKIP");
  assert.equal(c("ADVISORY", "fail"), "ADVISORY-FAIL");
  assert.equal(c("ADVISORY", "pass"), "ADVISORY-PASS");
  assert.equal(c("PASS", "not-installed"), "NOT-INSTALLED");
});

test("expectations: verified drivers default to PASS, unverified/unknown to ADVISORY", () => {
  assert.equal(expectationFor("S1", "claude", driverFor("claude"), "macos").status, "PASS");
  assert.equal(expectationFor("S1", "codex", driverFor("codex"), "macos").status, "ADVISORY");
  assert.equal(expectationFor("S1", "zz", null, "linux").status, "ADVISORY");
  assert.equal(expectationFor("S13", "grok", driverFor("grok"), "linux").status, "XFAIL");
});

test("end to end against a FAKE claude: instruction file, tools and secrets deny rules", async () => {
  const r = await runConformance({ env, harnesses: ["claude"], scenarios: ["T0.1", "T0.2", "S1", "S5", "S6"], useSiblings: false });
  const by = Object.fromEntries(r.results.map((x) => [x.scenario, x]));
  for (const id of ["T0.1", "T0.2", "S1", "S5", "S6"]) assert.equal(by[id].status, "PASS", `${id}: ${by[id].evidence.join(" | ")}`);
  assert.equal(r.meta[0].version, "9.9.9");
  assert.ok(r.meta[0].setup.some((l) => l.includes("fixtures")));
});

test("negative control: without deny rules the secrets scenario FAILS (the check can fail)", async () => {
  process.env.HC_NEGATIVE = "1";
  try {
    const r = await runConformance({ env, harnesses: ["claude"], scenarios: ["S6"], useSiblings: false });
    assert.equal(r.results[0].status, "FAIL");
    assert.match(r.results[0].evidence[0], /canary absent/);
  } finally {
    delete process.env.HC_NEGATIVE;
  }
});

test("a missing binary is NOT-INSTALLED, and --require-installed semantics live in the matrix gating", async () => {
  const r = await runConformance({ env: { ...env, HC_BIN_OPENCODE: "", PATH: "/usr/bin:/bin" }, harnesses: ["opencode"], scenarios: ["S1"], useSiblings: false });
  assert.equal(r.results[0].status, "NOT-INSTALLED");
});

test("XFAIL entries that start passing become XPASS (gating); SKIP never runs", async () => {
  const mod = await import("../src/expectations.mjs");
  mod.EXPECT.S5.claude = "XFAIL";
  mod.EXPECT.S1.claude = { status: "SKIP", reason: "test" };
  try {
    const r = await runConformance({ env, harnesses: ["claude"], scenarios: ["S1", "S5"], useSiblings: false });
    const by = Object.fromEntries(r.results.map((x) => [x.scenario, x.status]));
    assert.deepEqual(by, { S1: "SKIP", S5: "XPASS" });
    assert.deepEqual(buildMatrix(r).summary.gating, ["S5/claude/" + r.results[1].os + ": XPASS"]);
  } finally {
    delete mod.EXPECT.S5.claude;
    delete mod.EXPECT.S1.claude;
  }
});

test("matrix: JSON schema, merge across OS jobs, Markdown summary", async () => {
  const r = await runConformance({ env, harnesses: ["claude"], scenarios: ["T0.1", "S1"], useSiblings: false });
  const a = buildMatrix(r);
  assert.equal(a.schema, "harness-conformance/matrix/v1");
  // Pin both sides. On a Linux runner `a` is already linux, and the merge
  // would collapse to one column.
  for (const x of a.results) x.os = "darwin";
  for (const x of a.harnesses) x.os = "darwin";
  const b = JSON.parse(JSON.stringify(a));
  for (const x of b.results) x.os = "linux";
  for (const x of b.harnesses) x.os = "linux";
  const merged = mergeMatrices([a, b]);
  assert.equal(merged.results.length, 4);
  const md = renderMarkdown(merged);
  assert.match(md, /\| Scenario \| claude 9\.9\.9 \(darwin\) \| claude 9\.9\.9 \(linux\) \|/);
  assert.match(md, /lockstep holds/);
});
