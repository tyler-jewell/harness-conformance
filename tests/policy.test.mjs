// Repo policy as tests: pins are consistent, workflows are hardened, no personal data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJson } from "../src/util.mjs";

const wfDir = path.join(ROOT, ".github/workflows");
const ymls = [...fs.readdirSync(wfDir).map((f) => path.join(wfDir, f)), path.join(ROOT, ".github/actions/run/action.yml"), path.join(ROOT, ".github/actions/siblings/action.yml"), path.join(ROOT, "templates/conformance-caller.yml")];

test("pins/harnesses.json agrees with the npm manifests and covers every grok platform", () => {
  const pins = readJson(path.join(ROOT, "pins/harnesses.json"));
  for (const [name, p] of Object.entries(pins.npm)) {
    const dep = readJson(path.join(ROOT, p.lock, "package.json")).dependencies[p.package];
    assert.equal(dep, p.version, `${name}: ${p.package} manifest says ${dep}, harnesses.json says ${p.version}`);
    const lock = readJson(path.join(ROOT, p.lock, "package-lock.json"));
    assert.equal(lock.packages[`node_modules/${p.package}`].version, p.version, `${name}: lockfile out of date`);
    assert.match(lock.packages[`node_modules/${p.package}`].integrity, /^sha512-/);
  }
  for (const plat of ["macos-aarch64", "macos-x86_64", "linux-x86_64", "linux-aarch64"]) assert.match(pins.grok.sha256[plat], /^[0-9a-f]{64}$/, plat);
});

test("every driver's documented pin matches harnesses.json", async () => {
  const pins = readJson(path.join(ROOT, "pins/harnesses.json"));
  const { PROFILES } = await import("../src/harnesses/index.mjs");
  for (const [name, d] of Object.entries(PROFILES)) {
    if (d.pin.kind === "npm") assert.equal(d.pin.pkg, pins.npm[name].package, name);
    else assert.ok(pins[name], `pins/harnesses.json has no ${name} section`);
  }
});

test("workflows: SHA-pinned actions, no pull_request_target, no secrets, no untrusted interpolation in run blocks", () => {
  for (const f of ymls) {
    const text = fs.readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      const ref = m[1];
      if (ref.startsWith("./")) continue;
      if (rel.startsWith("templates/") && ref.endsWith("conformance.yml@main")) continue; // documented placeholder
      if (/^tyler-jewell\/shared-config\/\.github\/workflows\/[a-z-]+\.yml@v1$/.test(ref)) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${rel}: ${ref} must be pinned to a commit SHA`);
    }
    assert.ok(!/pull_request_target/.test(text), `${rel}: pull_request_target exposes secrets to forks`);
    for (const m of text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) assert.equal(m[1], "GITHUB_TOKEN", `${rel}: only GITHUB_TOKEN may be referenced (found secrets.${m[1]})`);
    assert.ok(!/\$\{\{\s*github\.event\.(pull_request\.(title|body|head\.ref)|issue\.(title|body)|comment\.body)/.test(text), `${rel}: untrusted event field interpolated`);
    if (rel.includes("workflows/")) assert.match(text, /^permissions:/m, `${rel}: top-level permissions required`);
  }
});

test("conformance workflow keeps fork PRs off self-hosted runners", () => {
  const text = fs.readFileSync(path.join(wfDir, "conformance.yml"), "utf8");
  assert.match(text, /studio:[\s\S]*?if: needs\.pick\.outputs\.selfhosted == 'true' && github\.event\.pull_request\.head\.repo\.fork != true/);
  assert.ok(!/self-hosted/.test(text.replace(/#.*$/gm, "")), "self-hosted labels come only from the picker output");
});

test("no personal data in tracked files", () => {
  const bad = [/\/Users\/[a-z]/i, /@gmail\.com/i, /(^|[\s"'=:])\/home\/[a-z]+\//m, /\bmbp\b/];
  const skip = new Set([".git", "node_modules", ".harnesses", ".actionlint"]);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (skip.has(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(ROOT)) {
    if (/package-lock\.json$|\.png$/.test(f) || f.endsWith("policy.test.mjs")) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const re of bad) assert.ok(!re.test(text), `${path.relative(ROOT, f)} matches ${re}`);
  }
});
