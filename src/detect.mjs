// Harness DETECTION. The set of harnesses is never hard-coded:
//   1. `harness-inventory detect --json` (schema harness-inventory/detect/v1) when that binary is available;
//   2. otherwise a small built-in detector using the same signature idea (dot-dirs holding agents/*.md with
//      frontmatter, skills/*/SKILL.md, commands/, instruction files, hooks/MCP config, session stores,
//      plus a same-named binary on PATH).
// Detected names are then ENRICHED by profiles (src/harnesses). A detected harness without a driver is
// reported as `detected-no-driver` (advisory) and gets a best-effort generic Tier-0 check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./proc.mjs";
import { which, ROOT, frontmatter } from "./util.mjs";
import { PROFILES, driverFor, resolveBinary } from "./harnesses/index.mjs";

const NOT_HARNESS = new Set([
  "git", "cache", "config", "local", "ssh", "npm", "npmrc", "cargo", "rustup", "docker", "aws", "gnupg", "vscode", "zsh_sessions", "oh-my-zsh", "nvm", "bun", "deno",
  "volta", "terraform.d", "gh", "op", "trash", "cups", "dotfiles", "agents", "kube", "azure", "gcloud", "pyenv", "rbenv", "yarn", "pnpm", "fontconfig", "gitconfig", "lima",
]);

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const ls = (p) => {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
};

export function signature(dir) {
  const ev = [];
  const agents = ls(path.join(dir, "agents")).filter((f) => f.endsWith(".md"));
  if (agents.some((f) => { try { return frontmatter(fs.readFileSync(path.join(dir, "agents", f), "utf8")); } catch { return null; } })) ev.push("agents/*.md with frontmatter");
  if (ls(path.join(dir, "skills")).some((d) => fs.existsSync(path.join(dir, "skills", d, "SKILL.md")))) ev.push("skills/*/SKILL.md");
  if (isDir(path.join(dir, "commands"))) ev.push("commands/");
  for (const f of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "instructions.md", "rules.md"]) if (fs.existsSync(path.join(dir, f))) ev.push(`instruction file ${f}`);
  if (isDir(path.join(dir, "hooks")) || ls(dir).some((f) => /^(settings|hooks)\.json$/.test(f))) ev.push("hooks/settings config");
  if (ls(dir).some((f) => /^(mcp\.json|config\.toml|config\.json|opencode\.json)$/.test(f))) ev.push("config/mcp file");
  if (["projects", "sessions", "history.jsonl", "session-env"].some((f) => fs.existsSync(path.join(dir, f)))) ev.push("session store");
  return ev;
}

export function builtinDetect({ home = os.homedir(), pathDirs = (process.env.PATH || "").split(path.delimiter) } = {}) {
  const out = [];
  const seen = new Map();
  const consider = (name, root) => {
    if (!name || NOT_HARNESS.has(name.toLowerCase())) return;
    const ev = signature(root);
    if (!ev.length) return;
    const e = seen.get(name) || { name, roots: [], evidence: [], score: 0 };
    e.roots.push(root);
    e.evidence.push(...ev.map((x) => `${root}: ${x}`));
    e.score += ev.length;
    seen.set(name, e);
  };
  for (const f of ls(home)) if (f.startsWith(".") && f.length > 1 && isDir(path.join(home, f))) consider(f.slice(1), path.join(home, f));
  const cfg = path.join(home, ".config");
  for (const f of ls(cfg)) if (isDir(path.join(cfg, f))) consider(f, path.join(cfg, f));
  for (const e of seen.values()) {
    const bin = which(e.name, pathDirs);
    if (bin) {
      e.score += 2;
      e.evidence.push(`binary ${bin}`);
    }
    // The generic "dot-dir with only an instruction file" is too weak to call a harness.
    if (e.score < 2) continue;
    out.push({ name: e.name, roots: e.roots, confidence: e.score >= 5 ? "high" : e.score >= 3 ? "medium" : "low", evidence: e.evidence, binary: bin, layout: null, knownProfile: driverFor(e.name) ? e.name : null });
  }
  return out;
}

export function findInventoryBinary(env = process.env) {
  if (env.HC_NO_INVENTORY === "1") return null;
  const cands = [env.HC_HARNESS_INVENTORY, which("harness-inventory", (env.PATH || "").split(path.delimiter)), path.resolve(ROOT, "../harness-inventory/bin/harness-inventory")];
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

async function inventoryDetect(bin, env) {
  const r = await run(bin, ["detect", "--json"], { env: { PATH: env.PATH, HOME: env.HOME }, timeoutMs: 30_000 });
  if (r.code !== 0) return { error: `harness-inventory detect exited ${r.code}: ${r.stderr.trim().slice(0, 200)}` };
  let j;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    return { error: "harness-inventory detect: output is not JSON" };
  }
  if (!/^harness-inventory\/detect\/v\d+$/.test(j.schema || "")) return { error: `harness-inventory detect: unexpected schema ${j.schema}` };
  const unhome = (p) => (typeof p === "string" ? p.replace(/^~(?=$|\/)/, os.homedir()) : null);
  const list = (j.harnesses || []).map((h) => ({
    name: h.name,
    roots: (h.roots || []).map((r) => unhome(typeof r === "string" ? r : r.path)).filter(Boolean),
    confidence: h.class ?? (typeof h.confidence === "number" ? h.confidence : h.confidence ?? null),
    score: typeof h.confidence === "number" ? h.confidence : null,
    evidence: (h.evidence || []).map((e) => (typeof e === "string" ? e : `${e.signal}: ${e.path}`)),
    binary: unhome(typeof h.binary === "string" ? h.binary : h.binary?.path || null),
    layout: h.layout ?? null,
    knownProfile: h.knownProfile ?? null,
  }));
  return { list, schema: j.schema };
}

// Returns [{name, source, roots, confidence, evidence, binary, version?, driver, status}]
export async function detectHarnesses({ env = process.env, home = env.HOME || os.homedir(), explicit = null, useInventory = true } = {}) {
  let source = "builtin";
  let list = [];
  const notes = [];
  if (explicit) {
    source = "explicit";
    list = explicit.map((name) => ({ name, roots: [], confidence: "explicit", evidence: ["named on the command line / CI pin list"], binary: null, layout: null, knownProfile: null }));
  } else {
    const inv = useInventory ? findInventoryBinary(env) : null;
    if (inv) {
      const r = await inventoryDetect(inv, env);
      if (r.list) (list = r.list), (source = "harness-inventory");
      else notes.push(`${r.error}; using built-in detector`);
    }
    if (source === "builtin") list = builtinDetect({ home, pathDirs: (env.PATH || "").split(path.delimiter) });
    // A profile whose binary is installed counts even if its dot-dir is still empty (fresh machine / CI).
    for (const name of Object.keys(PROFILES)) {
      if (!list.some((h) => h.name === name) && resolveBinary(name, PROFILES[name], env)) list.push({ name, roots: [], confidence: "binary-only", evidence: ["profile binary found, no config dir yet"], binary: null, layout: null, knownProfile: name });
    }
  }
  const out = list.map((h) => {
    const driver = driverFor(h.name);
    const bin = resolveBinary(h.name, driver, env);
    return { ...h, source, binary: bin?.path || (typeof h.binary === "string" ? h.binary : null), binaryVia: bin?.via || null, driver: driver ? driver.name : null, status: driver ? "driver" : "detected-no-driver" };
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  out.notes = notes;
  return out;
}

// Best-effort generic Tier-0 for harnesses without a driver: --version and --help work, and headless flags are discoverable.
export async function genericTier0(h, env) {
  if (!h.binary) return { ok: false, skipped: true, evidence: "no binary on PATH; nothing to run" };
  const e = { PATH: env.PATH, HOME: env.HOME };
  const v = await run(h.binary, ["--version"], { env: e, timeoutMs: 20_000 });
  const help = await run(h.binary, ["--help"], { env: e, timeoutMs: 20_000 });
  const text = help.stdout + help.stderr;
  const headless = [/(^|\s)-p[,\s]/m.test(text) && "-p", /\n\s+run\b/.test(text) && "run", /\n\s+exec\b/.test(text) && "exec"].filter(Boolean);
  return { ok: v.code === 0 && help.code === 0, evidence: `--version exit ${v.code}: ${v.stdout.trim().split("\n")[0] || v.stderr.trim().split("\n")[0] || ""}; --help exit ${help.code}; headless flags: ${headless.join(",") || "none discovered"}`, headless };
}
