import path from "node:path";
import { writeFile, symlink, jsonLines, linkAgents, DUMMY_KEY } from "./common.mjs";

const tomlStr = (s) => JSON.stringify(s);

export default {
  name: "grok",
  title: "Grok Build",
  roots: [".grok"],
  binaries: ["grok"],
  knownLocations: ["~/.grok/bin/grok"],
  versionArgs: ["--version"],
  parseVersion: (s) => /grok (\d+\.\d+\.\d+)/.exec(s)?.[1] ?? null,
  status: "verified",
  pin: { kind: "script", url: "https://x.ai/cli/install.sh", artifact: "https://x.ai/cli/grok-{version}-{os}-{arch}", note: "x.ai publishes no checksum file; sha256 of each platform binary is pinned in pins/harnesses.json (trust on first download)" },

  configure(sb, mock, spec) {
    const g = path.join(sb.home, ".grok");
    symlink(spec.instruction, path.join(g, "AGENTS.md"));
    linkAgents(sb, spec, ".grok/agents");
    // Skills: grok reads ~/.agents/skills natively.
    const deny = spec.denyRead.flatMap((p) => [`Read(${p})`, `Bash(cat ${p})`]);
    writeFile(
      path.join(g, "config.toml"),
      [
        "[models]",
        'default = "mock"',
        "",
        "[model.mock]",
        'model = "mock-model"',
        'name = "Mock"',
        `base_url = ${tomlStr(mock.url + "/v1")}`,
        'env_key = "MOCK_API_KEY"',
        'api_backend = "chat_completions"',
        "context_window = 100000",
        "",
        "[features]",
        "remote_fetch = false",
        "lsp_tools = true",
        "",
        spec.defaultAgent.grok?.toml || `[agent]\nname = ${tomlStr(spec.mainAgent)}`,
        "",
        "[permission]",
        `deny = [${deny.map(tomlStr).join(", ")}]`,
        "",
        `[mcp_servers.${spec.mcp.name}]`,
        `command = ${tomlStr(spec.mcp.command)}`,
        `args = [${spec.mcp.args.map(tomlStr).join(", ")}]`,
        "",
      ].join("\n"),
    );
    writeFile(
      path.join(g, "hooks/conformance.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `${spec.hook.script} SessionStart` }] }], UserPromptSubmit: [{ hooks: [{ type: "command", command: `${spec.hook.script} UserPromptSubmit` }] }] } }, null, 2),
    );
    const lsp = {};
    for (const s of spec.lsp) lsp[s.id] = { command: s.command, args: s.args, extensionToLanguage: s.extensions, startupTimeout: 30000 };
    writeFile(path.join(g, "lsp.json"), JSON.stringify(lsp, null, 2));
  },

  env: (sb) => ({
    GROK_HOME: path.join(sb.home, ".grok"),
    MOCK_API_KEY: DUMMY_KEY,
    GROK_TELEMETRY_ENABLED: "0",
    GROK_DISABLE_AUTOUPDATER: "1",
    GROK_AUTO_UPDATE: "0",
    GROK_CLAUDE_HOOKS_ENABLED: "0", // validate grok-native hooks, not Claude-compat double execution
  }),

  headless: (sb, { prompt, agent, mode = "bypassPermissions" }) => ["-p", prompt, "--output-format", "streaming-json", "--permission-mode", mode, "--trust", "-m", "mock", ...(agent ? ["--agent", agent] : [])],

  parse(stdout) {
    const ev = [];
    for (const j of jsonLines(stdout)) {
      if (j.type === "available_commands") ev.push({ type: "init", tools: j.tools });
      else if (j.type === "text") ev.push({ type: "text", text: j.data });
      else if (j.type === "tool_call") ev.push({ type: "tool_call", name: j.toolName, input: j.rawInput });
      else if (j.type === "tool_call_update" && (j.status === "completed" || j.status === "failed")) ev.push({ type: "tool_result", output: JSON.stringify(j.content ?? j.rawOutput ?? ""), error: j.status === "failed" });
      else if (j.type === "error") ev.push({ type: "error", text: j.message });
      else if (j.type === "end") ev.push({ type: "end", ok: j.stopReason === "end_turn" });
    }
    return ev;
  },

  async lspCheck(ctx) {
    const r = await ctx.h.cmd(["inspect", "--json"]);
    const names = (JSON.parse(r.stdout).lspServers || []).map((x) => x.name);
    const want = ctx.sb.spec.lsp.map((s) => s.id);
    const missing = want.filter((w) => !names.includes(w));
    return { ok: !missing.length, evidence: `inspect lists ${names.length}/${want.length} servers${missing.length ? `; missing ${missing.join(",")}` : ""}` };
  },

  tier0: () => [
    { id: "version", argv: ["--version"], check: (r) => ({ ok: r.code === 0 && /grok \d/.test(r.stdout), evidence: r.stdout.trim() }) },
    {
      id: "inspect",
      argv: ["inspect", "--json"],
      check: (r) => {
        let j = null;
        try {
          j = JSON.parse(r.stdout);
        } catch {}
        if (r.code !== 0 || !j) return { ok: false, evidence: `exit ${r.code}; output not JSON` };
        const names = (k) => (j[k] || []).map((x) => x.name);
        const want = { skills: "conformance-skill", mcpServers: "fixture", agents: "coordinator" };
        const missing = Object.entries(want).filter(([k, v]) => !names(k).includes(v)).map(([k, v]) => `${k}:${v}`);
        const instr = (j.projectInstructions || []).some((x) => x.scope === "global");
        return { ok: !missing.length && instr, evidence: `skills=${names("skills").length} agents=${names("agents").join("/")} mcp=${names("mcpServers")} lsp=${names("lspServers").length} globalInstructions=${instr}${missing.length ? ` MISSING ${missing.join(",")}` : ""}` };
      },
    },
  ],
};
