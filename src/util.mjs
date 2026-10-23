import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const osName = () => (process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : process.platform);
export const archName = () => os.arch();
export class UsageError extends Error {}

export function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

export function which(name, dirs = (process.env.PATH || "").split(path.delimiter)) {
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeFile = (p, data, mode) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, mode ? { mode } : undefined);
};
export const symlink = (target, link) => {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    fs.rmSync(link, { force: true, recursive: true });
  } catch {}
  fs.symlinkSync(target, link);
};
export const copyTree = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: false });

// Parse "---\nkey: value\n---" frontmatter (flat scalars only; enough for SKILL.md / agent definitions).
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (k) out[k[1]] = k[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export const redact = (s) => String(s).replace(/(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{12,})/g, "[redacted]");
export const tmpBase = () => process.env.HC_TMPDIR || os.tmpdir();
