// Fresh, disposable HOME/XDG tree per run. Nothing here ever points at the real home directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { run } from "./proc.mjs";
import { tmpBase, writeFile, copyTree, ROOT } from "./util.mjs";

export function createSandbox({ label = "run", keep = process.env.HC_KEEP === "1", extraPath = [] } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpBase()), `hc-${label}-`));
  const home = path.join(root, "home");
  const work = path.join(root, "work");
  const xdg = { config: path.join(home, ".config"), data: path.join(home, ".local/share"), state: path.join(home, ".local/state"), cache: path.join(home, ".cache") };
  for (const d of [home, work, ...Object.values(xdg)]) fs.mkdirSync(d, { recursive: true });
  const pathDirs = [...new Set([...extraPath, path.dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])];
  const sb = {
    root, home, work, xdg, keep,
    canary: `HC-SECRET-${crypto.randomBytes(8).toString("hex")}`,
    hookLog: path.join(home, ".hc-hook.log"),
    mcpLog: path.join(root, "mcp.log"),
    lspLog: path.join(root, "lsp.log"),
    setupLog: [],
    env: {
      HOME: home,
      XDG_CONFIG_HOME: xdg.config, XDG_DATA_HOME: xdg.data, XDG_STATE_HOME: xdg.state, XDG_CACHE_HOME: xdg.cache,
      PATH: pathDirs.join(path.delimiter),
      LANG: "C.UTF-8", TERM: "dumb", NO_COLOR: "1", CI: "1",
      GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Conformance", GIT_AUTHOR_EMAIL: "conformance@example.invalid",
      GIT_COMMITTER_NAME: "Conformance", GIT_COMMITTER_EMAIL: "conformance@example.invalid",
      HC_HOOK_LOG: path.join(home, ".hc-hook.log"),
      HC_MCP_LOG: path.join(root, "mcp.log"),
      HC_LSP_LOG: path.join(root, "lsp.log"),
    },
    cleanup() {
      if (!keep) fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return sb;
}

// Reset the project dir between scenarios: fixture files, a git repo, and a canary-bearing .env.
export async function resetWork(sb) {
  fs.rmSync(sb.work, { recursive: true, force: true });
  fs.mkdirSync(sb.work, { recursive: true });
  copyTree(path.join(ROOT, "fixtures/project"), sb.work);
  writeFile(path.join(sb.work, ".env"), `API_TOKEN=${sb.canary}\n`);
  const git = (...a) => run("git", a, { cwd: sb.work, env: sb.env, timeoutMs: 20_000 });
  await git("init", "-q", "-b", "main");
  await git("add", "hello.txt", "src", "data.json", "run.sh");
  await git("commit", "-q", "-m", "chore: seed", "--no-verify");
  fs.rmSync(sb.hookLog, { force: true });
  fs.rmSync(sb.mcpLog, { force: true });
  return sb.work;
}

export const hostInfo = () => ({ os: process.platform === "darwin" ? "macos" : process.platform, arch: os.arch(), node: process.version });
