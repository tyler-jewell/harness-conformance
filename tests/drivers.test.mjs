import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSandbox } from "../src/sandbox.mjs";
import { installSetup } from "../src/setup.mjs";
import { PROFILES, driverFor, resolveBinary } from "../src/harnesses/index.mjs";

const MOCK = { url: "http://127.0.0.1:9" };
async function sandboxFor(name) {
  const sb = createSandbox({ label: `t-${name}` });
  await installSetup(sb, [PROFILES[name]], MOCK, { useSiblings: false });
  return sb;
}
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

test("every profile has the driver contract", () => {
  for (const [name, d] of Object.entries(PROFILES)) {
    assert.equal(d.name, name);
    for (const f of ["configure", "env", "headless", "parse", "tier0", "parseVersion"]) assert.equal(typeof d[f], "function", `${name}.${f}`);
    assert.ok(Array.isArray(d.binaries) && d.binaries.length, `${name}.binaries`);
    assert.ok(["verified", "unverified"].includes(d.status));
    assert.ok(d.pin?.kind, `${name}.pin`);
  }
});

test("claude: native config from the canonical spec", async () => {
  const sb = await sandboxFor("claude");
  try {
    const s = JSON.parse(read(sb.home, ".claude/settings.json"));
    assert.equal(s.agent, "coordinator");
    assert.ok(s.permissions.deny.includes("Read(**/.env)"));
    assert.match(s.hooks.SessionStart[0].hooks[0].command, /hook\.sh SessionStart$/);
    assert.equal(JSON.parse(read(sb.home, ".claude.json")).mcpServers.fixture.type, "stdio");
    assert.ok(fs.lstatSync(path.join(sb.home, ".claude/CLAUDE.md")).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(sb.home, ".claude/agents/coordinator.md")));
    const env = PROFILES.claude.env(sb, MOCK);
    assert.equal(env.ANTHROPIC_BASE_URL, MOCK.url);
    assert.equal(env.DISABLE_TELEMETRY, "1");
    assert.ok(!/sk-ant/.test(env.ANTHROPIC_API_KEY), "dummy key must not look like a real key");
    assert.deepEqual(PROFILES.claude.headless(sb, { prompt: "p" }).slice(0, 2), ["-p", "p"]);
  } finally {
    sb.cleanup();
  }
});

test("opencode: provider baseURL, default agent, own service port, deny rules", async () => {
  const sb = await sandboxFor("opencode");
  try {
    const c = JSON.parse(read(sb.xdg.config, "opencode/opencode.json"));
    assert.equal(c.provider.mock.options.baseURL, `${MOCK.url}/v1`);
    assert.equal(c.provider.mock.npm, "@ai-sdk/openai-compatible");
    assert.equal(c.default_agent, "coordinator");
    assert.equal(c.autoupdate, false);
    assert.equal(c.permission.read["**/.env"], "deny");
    const svc = JSON.parse(read(sb.xdg.config, "opencode/service.json"));
    assert.ok(svc.port > 1024 && svc.port !== 49374, "must not use the default managed-service port");
    assert.ok(PROFILES.opencode.headless(sb, { prompt: "p" }).includes("--standalone"));
  } finally {
    sb.cleanup();
  }
});

test("grok: custom model endpoint, default agent, permission deny, MCP, LSP", async () => {
  const sb = await sandboxFor("grok");
  try {
    const t = read(sb.home, ".grok/config.toml");
    assert.match(t, /base_url = "http:\/\/127\.0\.0\.1:9\/v1"/);
    assert.match(t, /\[agent\]\nname = "coordinator"/);
    assert.match(t, /remote_fetch = false/);
    assert.match(t, /\[permission\]\ndeny = \[.*Read\(\*\*\/\.env\)/);
    assert.match(t, /\[mcp_servers\.fixture\]/);
    assert.ok(Object.keys(JSON.parse(read(sb.home, ".grok/lsp.json"))).length >= 1);
    const env = PROFILES.grok.env(sb, MOCK);
    assert.equal(env.GROK_HOME, path.join(sb.home, ".grok"));
    assert.equal(env.GROK_TELEMETRY_ENABLED, "0");
  } finally {
    sb.cleanup();
  }
});

test("codex and pi are unverified drivers and say so", async () => {
  assert.equal(PROFILES.codex.status, "unverified");
  assert.equal(PROFILES.pi.status, "unverified");
  const sb = await sandboxFor("codex");
  try {
    assert.match(read(sb.home, ".codex/config.toml"), /wire_api = "responses"/);
  } finally {
    sb.cleanup();
  }
});

test("parsers normalize each harness's headless output", () => {
  const claude = [
    { type: "system", subtype: "init", tools: ["Bash"], agents: ["coordinator"], skills: [], mcp_servers: [] },
    { type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "out", is_error: false }] } },
    { type: "result", is_error: false, result: "done" },
  ].map((o) => JSON.stringify(o)).join("\n");
  assert.deepEqual(PROFILES.claude.parse(claude).map((e) => e.type), ["init", "text", "tool_call", "tool_result", "end"]);

  const oc = [
    { type: "text", part: { text: "hi" } },
    { type: "tool_use", part: { tool: "shell", state: { status: "completed", input: { command: "ls" }, output: "o" } } },
  ].map((o) => JSON.stringify(o)).join("\n");
  const ev = PROFILES.opencode.parse(oc);
  assert.deepEqual(ev.map((e) => e.type), ["text", "tool_call", "tool_result", "end"]);

  const grok = [
    { type: "text", data: "hi" },
    { type: "tool_call", toolName: "run_terminal_command", rawInput: { command: "ls" } },
    { type: "tool_call_update", status: "failed", content: [{ type: "text" }] },
    { type: "end", stopReason: "end_turn" },
  ].map((o) => JSON.stringify(o)).join("\n");
  const g = PROFILES.grok.parse(grok);
  assert.deepEqual(g.map((e) => e.type), ["text", "tool_call", "tool_result", "end"]);
  assert.equal(g[2].error, true);
  assert.deepEqual(PROFILES.claude.parse("not json\n"), []);
});

test("resolveBinary: HC_BIN_<NAME> override wins; unknown names resolve via PATH only", () => {
  const p = path.resolve("tests/fake/fake-claude.mjs");
  assert.equal(resolveBinary("claude", driverFor("claude"), { HC_BIN_CLAUDE: p, PATH: "" }).path, p);
  assert.equal(resolveBinary("definitely-not-installed-xyz", null, { PATH: "" }), null);
});
