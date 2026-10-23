// Codex CLI driver. UNVERIFIED on the author's machine (Codex is not installed there): written against the
// published docs (CODEX_HOME, config.toml model_providers with wire_api = "responses", `codex exec --json`).
// The first CI run is the verification; until then its scenarios are ADVISORY (reported, never gating).
import path from "node:path";
import { writeFile, symlink, jsonLines, DUMMY_KEY } from "./common.mjs";

const q = (s) => JSON.stringify(s);

export default {
  name: "codex",
  title: "Codex CLI",
  roots: [".codex"],
  binaries: ["codex"],
  knownLocations: [],
  versionArgs: ["--version"],
  parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1] ?? null,
  status: "unverified",
  pin: { kind: "npm", pkg: "@openai/codex", lockDir: "pins/stretch", bin: "codex" },

  configure(sb, mock, spec) {
    const h = path.join(sb.home, ".codex");
    symlink(spec.instruction, path.join(h, "AGENTS.md"));
    writeFile(
      path.join(h, "config.toml"),
      [
        'model = "mock-model"',
        'model_provider = "mock"',
        'approval_policy = "never"',
        'sandbox_mode = "workspace-write"',
        "",
        "[model_providers.mock]",
        'name = "Mock"',
        `base_url = ${q(mock.url + "/v1")}`,
        'env_key = "MOCK_API_KEY"',
        'wire_api = "responses"',
        "",
        `[mcp_servers.${spec.mcp.name}]`,
        `command = ${q(spec.mcp.command)}`,
        `args = [${spec.mcp.args.map(q).join(", ")}]`,
        "",
      ].join("\n"),
    );
  },
  env: (sb) => ({ CODEX_HOME: path.join(sb.home, ".codex"), MOCK_API_KEY: DUMMY_KEY, CODEX_DISABLE_TELEMETRY: "1" }),
  headless: (sb, { prompt }) => ["exec", "--skip-git-repo-check", "--json", prompt],
  parse(stdout) {
    const ev = [];
    for (const j of jsonLines(stdout)) {
      const it = j.item || j.msg || {};
      const t = it.type || j.type;
      if (/agent_message|assistant/.test(t || "")) ev.push({ type: "text", text: it.text || it.message });
      else if (/command_execution|function_call|exec_command/.test(t || "")) ev.push({ type: "tool_call", name: it.command ? "shell" : it.name, input: it });
      else if (/error/.test(t || "")) ev.push({ type: "error", text: JSON.stringify(j) });
    }
    return ev;
  },
  tier0: () => [{ id: "version", argv: ["--version"], check: (r) => ({ ok: r.code === 0 && /codex/i.test(r.stdout), evidence: r.stdout.trim() }) }],
};
