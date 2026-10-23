import path from "node:path";
import { writeFile, symlink, jsonLines, linkAgents, DUMMY_KEY } from "./common.mjs";
import { freePort } from "../util.mjs";

export default {
  name: "opencode",
  title: "OpenCode",
  roots: [".config/opencode"],
  binaries: ["opencode"],
  knownLocations: ["~/.opencode/bin/opencode"],
  versionArgs: ["--version"],
  parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1] ?? null,
  status: "verified",
  pin: { kind: "npm", pkg: "@opencode/cli", lockDir: "pins", bin: "opencode", note: "OpenCode 2 ships as @opencode/cli (opencode-ai on npm is OpenCode 1)" },

  async configure(sb, mock, spec) {
    const cfg = path.join(sb.xdg.config, "opencode");
    symlink(spec.instruction, path.join(cfg, "AGENTS.md"));
    linkAgents(sb, spec, path.relative(sb.home, path.join(cfg, "agents")));
    // Skills: opencode reads ~/.agents/skills natively, nothing to link.
    const perm = {};
    for (const g of spec.denyRead) perm[g] = "deny";
    const lsp = {};
    for (const s of spec.lsp) lsp[s.id] = { command: [s.command, ...s.args], extensions: Object.keys(s.extensions) };
    writeFile(
      path.join(cfg, "opencode.json"),
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          autoupdate: false,
          share: "disabled",
          model: "mock/mock-model",
          ...(spec.defaultAgent.opencode?.snippet || { default_agent: spec.mainAgent }),
          provider: {
            mock: {
              npm: "@ai-sdk/openai-compatible",
              name: "Mock",
              options: { baseURL: `${mock.url}/v1`, apiKey: DUMMY_KEY },
              models: { "mock-model": { name: "Mock Model", tool_call: true, limit: { context: 100000, output: 8000 } } },
            },
          },
          permission: { "*": "allow", read: { "*": "allow", ...perm }, bash: { "*": "allow", ...Object.fromEntries(spec.denyRead.map((g) => [`cat ${g}`, "deny"])) } },
          mcp: { [spec.mcp.name]: { type: "local", command: [spec.mcp.command, ...spec.mcp.args] } },
          lsp,
        },
        null,
        2,
      ),
    );
    // OpenCode 2 talks to a managed background service on a fixed port; give the sandbox its own.
    sb.opencodePort = await freePort();
    writeFile(path.join(cfg, "service.json"), JSON.stringify({ port: sb.opencodePort }));
  },

  env: (sb) => ({ OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_SHARE: "1" }),

  headless: (sb, { prompt, agent }) => ["run", "--standalone", "--format", "json", "--auto", ...(agent ? ["--agent", agent] : []), prompt],

  parse(stdout) {
    const ev = [];
    for (const j of jsonLines(stdout)) {
      const p = j.part || {};
      if (j.type === "text") ev.push({ type: "text", text: p.text });
      else if (j.type === "tool_use") {
        ev.push({ type: "tool_call", name: p.tool, input: p.state?.input });
        if (p.state?.status === "completed") ev.push({ type: "tool_result", output: String(p.state.output ?? "") });
        else if (p.state?.status === "error") ev.push({ type: "tool_result", output: String(p.state.error ?? ""), error: true });
      } else if (j.type === "error") ev.push({ type: "error", text: JSON.stringify(j.error ?? j) });
    }
    if (ev.length) ev.push({ type: "end", ok: !ev.some((e) => e.type === "error") });
    return ev;
  },

  async cleanup(sb, run) {
    // `--standalone` runs never start the service, but `debug *` commands do: stop it so nothing outlives the run.
    await run(["service", "stop"]).catch(() => {});
  },

  async lspCheck(ctx) {
    let names = [];
    for (let i = 0; i < 6 && !names.length; i++) {
      const r = await ctx.h.cmd(["debug", "config"]);
      try {
        names = Object.keys(JSON.parse(r.stdout).flatMap((d) => (d.info && d.info.lsp ? [d.info.lsp] : [])).reduce((a, b) => ({ ...a, ...b }), {}));
      } catch {}
      if (!names.length) await new Promise((res) => setTimeout(res, 1500));
    }
    const want = ctx.sb.spec.lsp.map((s) => s.id);
    const missing = want.filter((w) => !names.includes(w));
    return { ok: !missing.length, evidence: `debug config lists ${names.length}/${want.length} lsp entries${missing.length ? `; missing ${missing.join(",")}` : ""} (config acceptance only; no handshake)` };
  },

  tier0: () => [
    { id: "version", argv: ["--version"], check: (r) => ({ ok: r.code === 0 && /\d+\.\d+\.\d+/.test(r.stdout), evidence: r.stdout.trim() }) },
    { id: "debug-config", retries: 8, argv: ["debug", "config"], check: (r) => ({ ok: r.code === 0 && r.stdout.includes("openai-compatible"), evidence: `exit ${r.code}; provider block ${r.stdout.includes("openai-compatible") ? "present" : "missing"}` }) },
    { id: "debug-agents", retries: 8, argv: ["debug", "agents"], check: (r) => ({ ok: r.code === 0 && /"id": "coordinator"/.test(r.stdout), evidence: (r.stdout.match(/"id": "[a-z-]+"/g) || []).map((x) => x.slice(7, -1)).join(",") }) },
  ],
};
