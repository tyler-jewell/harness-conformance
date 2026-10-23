import path from "node:path";
import { writeFile, symlink, jsonLines, linkAgents, linkSkills, DUMMY_KEY } from "./common.mjs";

const hookCmd = (spec, ev) => `${spec.hook.script} ${ev}`;

export default {
  name: "claude",
  title: "Claude Code",
  roots: [".claude"],
  binaries: ["claude"],
  knownLocations: ["~/.local/bin/claude"],
  versionArgs: ["--version"],
  parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1] ?? null,
  status: "verified",
  pin: { kind: "npm", pkg: "@anthropic-ai/claude-code", lockDir: "pins", bin: "claude", note: "npm ci + npm rebuild (the postinstall fetches the platform binary; integrity is in the lockfile)" },

  configure(sb, mock, spec) {
    symlink(spec.instruction, path.join(sb.home, ".claude/CLAUDE.md"));
    linkSkills(sb, spec, ".claude/skills");
    linkAgents(sb, spec, ".claude/agents");
    const deny = spec.denyRead.flatMap((g) => [`Read(${g})`, `Bash(cat ${g})`, `Bash(cat ./${g})`]);
    writeFile(
      path.join(sb.home, ".claude/settings.json"),
      JSON.stringify(
        {
          ...(spec.defaultAgent.claude?.snippet || { agent: spec.mainAgent }),
          permissions: { deny },
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: hookCmd(spec, "SessionStart") }] }],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: hookCmd(spec, "UserPromptSubmit") }] }],
          },
        },
        null,
        2,
      ),
    );
    writeFile(path.join(sb.home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, mcpServers: { [spec.mcp.name]: { type: "stdio", command: spec.mcp.command, args: spec.mcp.args } } }, null, 2));
  },

  env: (sb, mock) => ({
    ANTHROPIC_BASE_URL: mock.url,
    ANTHROPIC_API_KEY: DUMMY_KEY,
    ENABLE_TOOL_SEARCH: "false", // keep MCP tools in the initial tool list (otherwise they sit behind ToolSearch)
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  }),

  headless: (sb, { prompt, agent, mode = "bypassPermissions" }) => [
    "-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", mode, "--model", "mock-model",
    ...(agent ? ["--agent", agent] : []),
  ],

  parse(stdout) {
    const ev = [];
    for (const j of jsonLines(stdout)) {
      if (j.type === "system" && j.subtype === "init") ev.push({ type: "init", tools: j.tools, agents: j.agents, skills: j.skills, mcp: j.mcp_servers, raw: { agent: j.agent } });
      else if (j.type === "assistant") for (const c of j.message?.content || []) c.type === "text" ? ev.push({ type: "text", text: c.text }) : c.type === "tool_use" && ev.push({ type: "tool_call", name: c.name, input: c.input });
      else if (j.type === "user") for (const c of j.message?.content || []) c.type === "tool_result" && ev.push({ type: "tool_result", output: typeof c.content === "string" ? c.content : JSON.stringify(c.content), error: !!c.is_error });
      else if (j.type === "result") ev.push({ type: "end", ok: !j.is_error, text: j.result });
    }
    return ev;
  },

  tier0: () => [
    { id: "version", argv: ["--version"], check: (r) => ({ ok: r.code === 0 && /Claude Code/.test(r.stdout), evidence: r.stdout.trim() }) },
    { id: "mcp-list", argv: ["mcp", "list"], check: (r) => ({ ok: r.code === 0 && /conformance|fixture/i.test(r.stdout + r.stderr), evidence: (r.stdout + r.stderr).trim().split("\n").slice(0, 4).join(" | ") }) },
  ],
};
