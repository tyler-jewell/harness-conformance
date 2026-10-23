// Spawn helper: process-group kill on timeout, captured output, never inherits stdio.
import { spawn } from "node:child_process";

export function run(cmd, args = [], { env = {}, cwd, timeoutMs = 60_000, input = null } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { env, cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ code: 127, signal: null, stdout, stderr: String(e.message), timedOut, ms: 0, spawnError: e.code || "EXEC" });
    }
    const kill = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {}
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, signal: null, stdout, stderr: stderr + String(e.message), timedOut, ms: Date.now() - t0, spawnError: e.code || "EXEC" });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      kill("SIGKILL"); // reap stragglers in the group (hooks, LSP, MCP children)
      resolve({ code, signal, stdout, stderr, timedOut, ms: Date.now() - t0 });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
