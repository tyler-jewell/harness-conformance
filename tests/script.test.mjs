import test from "node:test";
import assert from "node:assert/strict";
import { Script, resolveTool } from "../src/mock/script.mjs";
import { buildReply, matches } from "../src/mock/script.mjs";

const tool = (name, props = [], required = []) => ({ name, props, required });

test("resolveTool: aliases across harness vocabularies", () => {
  const claude = [tool("Bash"), tool("Agent"), tool("Read")];
  const grok = [tool("run_terminal_command"), tool("spawn_subagent"), tool("read_file")];
  const opencode = [tool("shell"), tool("subagent"), tool("read")];
  for (const [set, shell, task, read] of [[claude, "Bash", "Agent", "Read"], [grok, "run_terminal_command", "spawn_subagent", "read_file"], [opencode, "shell", "subagent", "read"]]) {
    assert.equal(resolveTool("shell", set).name, shell);
    assert.equal(resolveTool("task", set).name, task);
    assert.equal(resolveTool("read", set).name, read);
  }
  assert.equal(resolveTool("skill", claude), null);
  assert.equal(resolveTool("~ping", [tool("mcp__fixture__conformance_ping")]).name, "mcp__fixture__conformance_ping");
});

test("buildReply: canonical args map onto each harness's property names and required props are filled", () => {
  const req = { tools: [tool("run_terminal_command", ["command", "description"], ["command", "description"]), tool("read_file", ["target_file"], ["target_file"])] };
  const r = buildReply({ reply: [{ tool: "shell", args: { command: "ls" } }, { tool: "read", args: { path: "/a" } }] }, req, () => "id1");
  assert.deepEqual(r[0].tool.input, { command: "ls", description: "conformance" });
  assert.deepEqual(r[1].tool.input, { target_file: "/a" });
});

test("buildReply: fallback chain and missing tool becomes visible text", () => {
  const req = { tools: [tool("use_tool", ["tool_name", "tool_input"])] };
  const r = buildReply({ reply: [{ tool: "~ping", fallback: [{ tool: "execute", args: {} }, { tool: "use_tool", args: { tool_name: "x__ping", tool_input: { a: 1 } } }] }, { tool: "skill", args: { name: "s" } }] }, req, () => "id");
  assert.equal(r[0].tool.name, "use_tool");
  assert.match(r[1].text, /not available/);
});

test("matchers", () => {
  const req = { lastUserText: "hello RUN", userText: "A\nhello RUN", system: "SYS X", lastToolResult: { name: "Bash", content: "out-1" }, tools: [tool("Bash")], messages: [] };
  assert.ok(matches({ when: { userIncludes: "RUN", systemIncludes: "X", afterTool: "shell", toolResultIncludes: "out", hasTool: "shell" } }, req));
  assert.ok(!matches({ when: { afterTool: "read" } }, req));
  assert.ok(!matches({ when: { noTools: true } }, req));
  assert.ok(matches({ when: { hasAnyTool: ["nope", "shell"] } }, req));
});

test("Script.pick honors once", () => {
  const s = new Script({ rules: [{ id: "a", once: true, when: {}, reply: [{ text: "1" }] }, { id: "b", when: {}, reply: [{ text: "2" }] }] });
  const req = { lastUserText: "", userText: "", system: "", tools: [], messages: [], lastToolResult: null };
  assert.equal(s.pick(req).id, "a");
  assert.equal(s.pick(req).id, "b");
});
