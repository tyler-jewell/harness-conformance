import { detectHarnesses, genericTier0 } from "./detect.mjs";
import { driverFor, resolveBinary } from "./harnesses/index.mjs";
import { createSandbox, resetWork, hostInfo } from "./sandbox.mjs";
import { installSetup } from "./setup.mjs";
import { createMockServer } from "./mock/index.mjs";
import { HarnessRunner } from "./harness-runner.mjs";
import { SCENARIOS, Check } from "./scenarios/index.mjs";
import { expectationFor } from "./expectations.mjs";
import { osName } from "./util.mjs";

export const GATING = new Set(["FAIL", "XPASS"]);

export function classify(expect, actual) {
  if (actual === "not-installed") return "NOT-INSTALLED";
  if (expect.status === "SKIP") return "SKIP";
  if (expect.status === "ADVISORY") return actual === "pass" ? "ADVISORY-PASS" : "ADVISORY-FAIL";
  if (expect.status === "XFAIL") return actual === "pass" ? "XPASS" : "XFAIL";
  return actual === "pass" ? "PASS" : "FAIL";
}

export async function runConformance({ harnesses = null, scenarios = null, tiers = [0, 1], env = process.env, onResult = () => {}, useSiblings = process.env.HC_NO_SIBLINGS !== "1" } = {}) {
  const os = osName();
  const detected = await detectHarnesses({ env, explicit: harnesses });
  const want = SCENARIOS.filter((s) => tiers.includes(s.tier) && (!scenarios || scenarios.some((x) => x.toLowerCase() === s.id.toLowerCase() || x === s.slug)));
  const results = [];
  const meta = [];
  const noBinary = [];
  const push = (r) => {
    results.push(r);
    onResult(r);
  };
  for (const h of detected) {
    const driver = driverFor(h.name);
    const bin = resolveBinary(h.name, driver, env);
    if (!driver && !h.binary && !bin) {
      noBinary.push(h.name); // detected by config dir only (e.g. a skills-only dir): advisory in `doctor`, nothing to run
      continue;
    }
    const m = { name: h.name, source: h.source, driver: driver?.name ?? null, driverStatus: driver?.status ?? null, binary: bin?.path ?? null, binaryVia: bin?.via ?? null, version: null, status: h.status, confidence: h.confidence, roots: h.roots, setup: [] };
    meta.push(m);
    const base = { harness: h.name, os, arch: hostInfo().arch };
    if (!driver) {
      const g = await genericTier0({ ...h, binary: bin?.path || h.binary }, env);
      const exp = expectationFor("T0.1", h.name, null, os);
      push({ ...base, scenario: "T0.1", tier: 0, expected: exp.status, reason: exp.reason, actual: g.skipped ? "not-installed" : g.ok ? "pass" : "fail", status: g.skipped ? "NOT-INSTALLED" : classify(exp, g.ok ? "pass" : "fail"), evidence: [`detected-no-driver: ${g.evidence}`], ms: 0 });
      continue;
    }
    const todo = want.map((s) => ({ s, exp: expectationFor(s.id, h.name, driver, os) }));
    if (!bin) {
      for (const { s, exp } of todo) push({ ...base, scenario: s.id, tier: s.tier, expected: exp.status, reason: exp.reason, actual: "not-installed", status: "NOT-INSTALLED", evidence: [`${driver.binaries.join("/")} not found (HC_BIN_${h.name.toUpperCase()}, .harnesses, PATH, known locations)`], ms: 0 });
      continue;
    }
    if (!todo.some((t) => t.exp.status !== "SKIP")) {
      for (const { s, exp } of todo) push({ ...base, scenario: s.id, tier: s.tier, expected: exp.status, reason: exp.reason, actual: "skip", status: "SKIP", evidence: [exp.reason], ms: 0 });
      continue;
    }
    const sb = createSandbox({ label: h.name, extraPath: [] });
    const mock = createMockServer({ dumpDir: env.HC_DUMP ? `${env.HC_DUMP}/${h.name}` : null });
    const { url } = await mock.listen(0);
    mock.url = url;
    const hr = new HarnessRunner({ driver, binary: bin.path, sb, mock });
    try {
      await installSetup(sb, [driver], mock, { useSiblings });
      m.setup = sb.setupLog;
      const v = await hr.cmd(driver.versionArgs);
      m.version = driver.parseVersion?.(v.stdout + v.stderr) ?? null;
      for (const { s, exp } of todo) {
        if (exp.status === "SKIP") {
          push({ ...base, scenario: s.id, tier: s.tier, expected: "SKIP", reason: exp.reason, actual: "skip", status: "SKIP", evidence: [exp.reason], ms: 0 });
          continue;
        }
        await resetWork(sb);
        const t0 = Date.now();
        let actual = "pass";
        let evidence = [];
        const ctx = { driver, sb, mock, h: hr, needles: sb.spec.needles, get last() { return hr.last; } };
        try {
          evidence = await s.run(ctx);
        } catch (e) {
          actual = "fail";
          evidence = [e instanceof Check ? `FAILED: ${e.message}` : `ERROR: ${e.message}`, hr.describeLast()].filter(Boolean);
        }
        push({ ...base, scenario: s.id, tier: s.tier, expected: exp.status, reason: exp.reason, actual, status: classify(exp, actual), evidence: evidence.filter(Boolean).map(String), ms: Date.now() - t0 });
      }
    } finally {
      try {
        await driver.cleanup?.(sb, (argv) => hr.cmd(argv, { timeoutMs: 20_000 }));
      } catch {}
      await mock.close();
      sb.cleanup();
    }
  }
  const notes = [...(detected.notes || [])];
  if (noBinary.length) notes.push(`${noBinary.length} further harness(es) detected by config dir without a binary or driver (advisory): ${noBinary.join(", ")}`);
  return { results, meta, detectNotes: notes, scenarios: want };
}
