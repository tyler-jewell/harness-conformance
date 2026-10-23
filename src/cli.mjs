import fs from "node:fs";
import path from "node:path";
import { UsageError, ROOT, readJson, osName } from "./util.mjs";
import { SCENARIOS } from "./scenarios/index.mjs";
import { expectationFor } from "./expectations.mjs";
import { detectHarnesses, findInventoryBinary } from "./detect.mjs";
import { PROFILES, driverFor, resolveBinary } from "./harnesses/index.mjs";
import { runConformance, GATING } from "./runner.mjs";
import { buildMatrix, mergeMatrices, renderMarkdown } from "./report.mjs";
import { createMockServer } from "./mock/index.mjs";
import { run } from "./proc.mjs";

const VERSION = readJson(path.join(ROOT, "package.json")).version;

const HELP = `harness-conformance ${VERSION}
Run the same behavioral scenarios against every coding-agent harness (Claude Code, OpenCode, Grok Build, ...)
using a local mock model server: no network, no API keys, no login.

USAGE
  harness-conformance <command> [options]

COMMANDS
  list [--json]                         scenarios and per-harness expectations (PASS/XFAIL/SKIP/ADVISORY)
  run  [options]                        run scenarios; exit 1 on FAIL or XPASS
  matrix <matrix.json...> [--format md|json]   merge matrices (e.g. one per OS job) and render
  mock [--port N] [--script FILE] [--dump DIR] start the mock model server standalone
  doctor [--json] [--all]               detected harnesses, installed binaries, versions
  help | --version

RUN OPTIONS
  --harness NAME      repeatable; default: detect (harness-inventory detect --json, else built-in detector)
  --scenario ID       repeatable (S5, T0.2 or a slug such as secrets-safety); default: all
  --tier 0|1          0 = offline listing/validation, 1 = mock-model end to end; default: both
  --json              print the matrix JSON on stdout (progress goes to stderr)
  --out FILE          write the matrix JSON to FILE
  --summary FILE      write the Markdown summary to FILE (use --github-summary for $GITHUB_STEP_SUMMARY)
  --github-summary    append the Markdown summary to $GITHUB_STEP_SUMMARY when set
  --require-installed treat NOT-INSTALLED as a failure (CI)
  --no-siblings       never call installers from sibling repos; use checked-in fixtures only
  --keep              keep the sandbox directories (debugging)

ENVIRONMENT
  HC_BIN_<NAME>=path  use this binary for a harness      HC_SIBLINGS_DIR   where dotfiles/, lsp-doctor/, agents/ live
  HC_HARNESS_INVENTORY=path  harness-inventory binary    HC_TMPDIR         where sandboxes are created
`;

function parseArgs(argv, spec) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      o._.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const def = spec[k];
    if (!def) throw new UsageError(`unknown option --${k}`);
    if (def === "bool") o[k] = true;
    else {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`--${k} needs a value`);
      if (def === "list") (o[k] ||= []).push(v);
      else o[k] = v;
    }
  }
  return o;
}

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s + "\n");

export async function main(argv) {
  const cmd = argv[0];
  try {
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return out(HELP), 0;
    if (cmd === "--version" || cmd === "version") return out(VERSION + "\n"), 0;
    const rest = argv.slice(1);

    if (cmd === "list") {
      const o = parseArgs(rest, { json: "bool", harness: "list" });
      const names = o.harness || Object.keys(PROFILES);
      const os = osName();
      const rows = SCENARIOS.map((s) => ({ id: s.id, slug: s.slug, tier: s.tier, title: s.title, expect: Object.fromEntries(names.map((n) => [n, expectationFor(s.id, n, driverFor(n), os)])) }));
      if (o.json) return out(JSON.stringify({ schema: "harness-conformance/list/v1", os, scenarios: rows }, null, 2) + "\n"), 0;
      out(`ID    TIER  SCENARIO${" ".repeat(46)}${names.map((n) => n.padEnd(10)).join("")}\n`);
      for (const r of rows) out(`${r.id.padEnd(6)}${String(r.tier).padEnd(6)}${r.title.slice(0, 52).padEnd(54)}${names.map((n) => r.expect[n].status.padEnd(10)).join("")}\n`);
      for (const r of rows) for (const n of names) if (r.expect[n].reason && r.expect[n].status !== "PASS") out(`  ${r.id}/${n}: ${r.expect[n].status} - ${r.expect[n].reason}\n`);
      return 0;
    }

    if (cmd === "doctor") {
      const o = parseArgs(rest, { json: "bool", harness: "list", all: "bool" });
      const det = await detectHarnesses({ explicit: o.harness || null });
      const inv = findInventoryBinary();
      const rows = [];
      for (const h of det) {
        const d = driverFor(h.name);
        let version = null;
        if (h.binary && d) {
          const r = await run(h.binary, d.versionArgs, { env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeoutMs: 20_000 });
          version = d.parseVersion?.(r.stdout + r.stderr) ?? null;
        }
        rows.push({ name: h.name, status: h.status, source: h.source, confidence: h.confidence, binary: h.binary, via: h.binaryVia, version, driverStatus: d?.status ?? null, roots: h.roots });
      }
      const missing = Object.keys(PROFILES).filter((n) => !det.some((h) => h.name === n));
      if (o.json) return out(JSON.stringify({ schema: "harness-conformance/doctor/v1", inventory: inv, detection: det[0]?.source ?? "builtin", harnesses: rows, notInstalled: missing }, null, 2) + "\n"), 0;
      out(`node ${process.version}; ${osName()}; harness-inventory: ${inv || "not found (built-in detector)"}\n`);
      const quiet = o.all ? [] : rows.filter((r) => r.status === "detected-no-driver" && !r.binary);
      for (const r of rows.filter((x) => !quiet.includes(x))) out(`${r.name.padEnd(10)} ${r.status.padEnd(18)} ${String(r.version ?? "-").padEnd(10)} ${r.binary ?? "(no binary)"}${r.via ? ` [${r.via}]` : ""}${r.driverStatus === "unverified" ? " (driver unverified)" : ""}\n`);
      if (quiet.length) out(`+ ${quiet.length} more detected by config dir only, no binary and no driver (advisory; --all to list)\n`);
      for (const n of missing) out(`${n.padEnd(10)} not installed (profile available)\n`);
      for (const n of det.notes || []) out(`note: ${n}\n`);
      return 0;
    }

    if (cmd === "mock") {
      const o = parseArgs(rest, { port: "str", script: "str", dump: "str" });
      let script;
      if (o.script) script = o.script.endsWith(".json") ? readJson(o.script) : (await import(path.resolve(o.script))).default;
      const m = createMockServer({ script, dumpDir: o.dump || null, log: (s) => err(`[mock] ${s}`) });
      const { url } = await m.listen(+(o.port || 0));
      out(`mock model server listening on ${url}\n  ANTHROPIC_BASE_URL=${url}   (Anthropic Messages)\n  baseURL ${url}/v1            (OpenAI chat/completions, Responses)\n`);
      await new Promise(() => {});
    }

    if (cmd === "matrix") {
      const o = parseArgs(rest, { format: "str" });
      if (!o._.length) throw new UsageError("matrix needs one or more matrix JSON files");
      const merged = mergeMatrices(o._.map((f) => readJson(f)));
      out(o.format === "json" ? JSON.stringify(merged, null, 2) + "\n" : renderMarkdown(merged));
      return merged.summary.gating.length ? 1 : 0;
    }

    if (cmd === "run") {
      const o = parseArgs(rest, { harness: "list", scenario: "list", tier: "str", json: "bool", out: "str", summary: "str", "github-summary": "bool", "require-installed": "bool", "no-siblings": "bool", keep: "bool" });
      if (o.keep) process.env.HC_KEEP = "1";
      if (o.tier && !["0", "1"].includes(o.tier)) throw new UsageError("--tier must be 0 or 1");
      const tiers = o.tier ? [Number(o.tier)] : [0, 1];
      const r = await runConformance({ harnesses: o.harness || null, scenarios: o.scenario || null, tiers, useSiblings: !o["no-siblings"], onResult: (x) => err(`${x.status.padEnd(14)} ${x.scenario.padEnd(5)} ${x.harness.padEnd(9)} ${x.evidence[0] ? String(x.evidence[0]).slice(0, 110) : ""}`) });
      const m = buildMatrix(r);
      if (o["require-installed"]) {
        for (const x of m.results) if (x.status === "NOT-INSTALLED") m.summary.gating.push(`${x.scenario}/${x.harness}/${x.os}: NOT-INSTALLED`);
      }
      const md = renderMarkdown(m);
      if (o.out) fs.writeFileSync(o.out, JSON.stringify(m, null, 2) + "\n");
      if (o.summary) fs.writeFileSync(o.summary, md);
      if (o["github-summary"] && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
      if (o.json) out(JSON.stringify(m, null, 2) + "\n");
      else out(md);
      return m.summary.gating.length ? 1 : 0;
    }
    throw new UsageError(`unknown command "${cmd}" (try: harness-conformance help)`);
  } catch (e) {
    if (e instanceof UsageError) return err(`harness-conformance: ${e.message}`), 64;
    throw e;
  }
}
