// Build "our setup" inside a sandbox HOME. Prefers the REAL installers from sibling repos; falls back to
// the checked-in minimal fixtures (fixtures/home) so the tool works on a bare CI runner too.
import fs from "node:fs";
import path from "node:path";
import { run } from "./proc.mjs";
import { ROOT, copyTree, frontmatter, writeFile } from "./util.mjs";

const SIBLINGS = process.env.HC_SIBLINGS_DIR || path.resolve(ROOT, "..");
export const sibling = (name, ...rest) => {
  const p = path.join(SIBLINGS, name, ...rest);
  return fs.existsSync(p) ? p : null;
};

function listAgents(dir) {
  const out = [];
  for (const domain of fs.readdirSync(dir)) {
    const d = path.join(dir, domain);
    if (fs.statSync(d).isFile() && domain.endsWith(".md")) {
      out.push({ domain: null, file: d, name: frontmatter(fs.readFileSync(d, "utf8"))?.name || domain.replace(/\.md$/, "") });
    } else if (fs.statSync(d).isDirectory()) {
      for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md"))) out.push({ domain, file: path.join(d, f), name: frontmatter(fs.readFileSync(path.join(d, f), "utf8"))?.name || f.replace(/\.md$/, "") });
    }
  }
  return out;
}

async function tryDotfiles(sb) {
  const bs = sibling("dotfiles", "bootstrap.sh");
  if (!bs) return false;
  const r = await run("bash", [bs, "--no-bin", "--yes", "--name", "Conformance", "--email", "conformance@example.invalid"], { env: sb.env, cwd: sb.root, timeoutMs: 60_000 });
  sb.setupLog.push(`dotfiles bootstrap.sh --no-bin: exit ${r.code}`);
  return r.code === 0;
}

async function tryLspDoctor(sb) {
  const bin = sibling("lsp-doctor", "bin", "lsp-doctor");
  if (!bin) return null;
  const r = await run(bin, ["emit", "--format", "json"], { env: { ...sb.env, PATH: process.env.PATH }, timeoutMs: 60_000 });
  if (r.code !== 0) return null;
  try {
    const servers = JSON.parse(r.stdout).servers || [];
    sb.setupLog.push(`lsp-doctor emit --format json: ${servers.length} server(s)`);
    return servers.map((s) => ({ id: s.id, command: s.command, args: s.args || [], extensions: s.extensionToLanguage || {} }));
  } catch {
    return null;
  }
}

async function tryAgentsDoctor(sb, drivers) {
  const bin = sibling("agents", "bin", "agents-doctor");
  if (!bin) return null;
  // agents-doctor links into harnesses it DETECTS, so give the sandbox the (empty) config roots first.
  for (const d of drivers) for (const root of d.roots || []) fs.mkdirSync(path.join(sb.home, root), { recursive: true });
  const harnessArgs = drivers.flatMap((d) => ["--harness", d.name]);
  const r = await run(bin, ["install", "--apply", "--home", sb.home, "--no-inventory", ...harnessArgs, "--json"], { env: sb.env, timeoutMs: 120_000 });
  sb.setupLog.push(`agents-doctor install --apply --home <sandbox>: exit ${r.code}`);
  if (r.code !== 0) return null;
  const es = await run(bin, ["emit-settings", "--home", sb.home, "--no-inventory", ...harnessArgs, "--json"], { env: sb.env, timeoutMs: 60_000 });
  let emit = null;
  try {
    emit = JSON.parse(es.stdout);
  } catch {}
  return { emit };
}

// Build the canonical spec and let each selected driver write its native config.
export async function installSetup(sb, drivers, mock, { useSiblings = process.env.HC_NO_SIBLINGS !== "1" } = {}) {
  const shared = path.join(sb.home, ".agents");
  let source = "fixtures";
  const ad = useSiblings ? await tryAgentsDoctor(sb, drivers) : null;
  if (ad) source = "agents-doctor";
  // The shared instruction file and skills belong to other tools (dotfiles / harness-inventory promote): fixtures fill any gap.
  fs.mkdirSync(shared, { recursive: true });
  if (!fs.existsSync(path.join(shared, "AGENTS.md"))) fs.copyFileSync(path.join(ROOT, "fixtures/home/agents/AGENTS.md"), path.join(shared, "AGENTS.md"));
  if (!fs.existsSync(path.join(shared, "skills"))) copyTree(path.join(ROOT, "fixtures/home/agents/skills"), path.join(shared, "skills"));
  if (!ad) copyTree(path.join(ROOT, "fixtures/home/agents/agents"), path.join(shared, "agents"));
  const hc = path.join(sb.home, ".hc");
  copyTree(path.join(ROOT, "fixtures/bin"), path.join(hc, "bin"));
  writeFile(path.join(hc, "hook.sh"), fs.readFileSync(path.join(ROOT, "fixtures/home/hooks/hook.sh")), 0o755);

  let gitHooks = "none";
  if (useSiblings && (await tryDotfiles(sb))) gitHooks = "dotfiles";
  if (gitHooks === "none") {
    // Minimal stand-in for the dotfiles global hook: Conventional Commits header or reject.
    const hooks = path.join(sb.home, ".config/git/hooks");
    writeFile(
      path.join(hooks, "commit-msg"),
      `#!/bin/sh\nh=$(grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | head -n 1)\nprintf '%s\\n' "$h" | grep -Eq '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\\([A-Za-z0-9._/,-]+\\))?!?: [^[:space:]].*$' || { echo "commit-msg: not a Conventional Commit: $h" >&2; exit 1; }\n`,
      0o755,
    );
    writeFile(path.join(sb.home, ".config/git/config"), `[core]\n\thooksPath = ${hooks}\n[user]\n\tname = Conformance\n\temail = conformance@example.invalid\n`);
    gitHooks = "fixture";
  }
  sb.setupLog.push(`git hooks: ${gitHooks}`);

  const lsp = (useSiblings && (await tryLspDoctor(sb))) || null;
  const agents = listAgents(path.join(shared, "agents"));
  const skills = fs.readdirSync(path.join(shared, "skills")).filter((d) => fs.existsSync(path.join(shared, "skills", d, "SKILL.md"))).map((d) => ({ name: d, dir: path.join(shared, "skills", d) }));
  const defaultAgent = {};
  for (const e of ad?.emit?.harnesses || []) if (e.defaultAgent?.supported) defaultAgent[e.harness] = e.defaultAgent;
  const spec = {
    source,
    agentsLinked: !!ad,
    defaultAgent,
    gitHooks,
    mainAgent: "coordinator",
    instruction: path.join(shared, "AGENTS.md"),
    agents,
    skills,
    // HC_NEGATIVE=1 removes the secret-read deny rules: S6 must then FAIL on every harness (proves the check can fail).
    denyRead: process.env.HC_NEGATIVE === "1" ? [] : [".env", "**/.env", "**/.env.*"],
    hook: { script: path.join(hc, "hook.sh") },
    mcp: { name: "fixture", command: process.execPath, args: [path.join(hc, "bin/mcp-fixture.mjs")] },
    lsp: lsp && lsp.length ? lsp : [{ id: "fake-ts", command: process.execPath, args: [path.join(hc, "bin/fake-lsp.mjs")], extensions: { ".ts": "typescript" } }],
    lspSource: lsp && lsp.length ? "lsp-doctor" : "fixtures",
  };
  sb.setupLog.push(`agents: ${source}; lsp: ${spec.lspSource}`);
  spec.needles = needlesFor(spec);
  sb.setupLog.push(`default-agent settings from agents-doctor emit-settings: ${Object.keys(defaultAgent).join(",") || "none (built-in defaults)"}`);
  sb.spec = spec;
  for (const d of drivers) await d.configure(sb, mock, spec);
  return spec;
}

// Strings the scenarios look for. Derived from the INSTALLED agent files so the same scenarios work with the
// fixtures (deterministic canaries) and with the real agents repo (its own coordinator/domain agents).
export function needlesFor(spec) {
  const read = (a) => {
    const t = fs.readFileSync(a.file, "utf8");
    const fm = frontmatter(t) || {};
    const body = t.replace(/^---[\s\S]*?\n---\r?\n?/, "");
    const line = body.split("\n").map((l) => l.trim()).find((l) => l.length >= 20 && !l.startsWith("#")) || body.trim();
    return { name: a.name, domain: a.domain, desc: (fm.description || "").slice(0, 48), prompt: line.slice(0, 60) };
  };
  const all = spec.agents.map(read);
  const coord = all.find((a) => a.name === spec.mainAgent);
  const others = all.filter((a) => a.name !== spec.mainAgent);
  const picked = [];
  for (const a of others) if (!picked.some((p) => p.domain === a.domain)) picked.push(a);
  const delegate = others.find((a) => a.prompt) || others[0];
  return { coordPrompt: coord?.prompt, coordDesc: coord?.desc, domainAgents: picked.slice(0, 2), delegate, allNames: all.map((a) => a.name) };
}
