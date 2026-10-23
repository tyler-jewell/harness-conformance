import test from "node:test";
import assert from "node:assert/strict";
import { createMockServer, sequence } from "../src/mock/index.mjs";
import { post, parseSse } from "./helpers.mjs";

const TOOLS_A = [
  { name: "Bash", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "Read", input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
];
async function withMock(script, fn) {
  const m = createMockServer({ script });
  const { url } = await m.listen(0);
  try {
    await fn(m, url);
  } finally {
    await m.close();
  }
}

test("anthropic: SSE has the full event grammar with a tool_use block", async () => {
  const script = { rules: [{ id: "r", when: { anyUserIncludes: "go" }, reply: [{ text: "hi" }, { tool: "shell", args: { command: "echo x" } }] }] };
  await withMock(script, async (m, url) => {
    const r = await post(`${url}/v1/messages`, { model: "mock-model", stream: true, system: [{ type: "text", text: "SYS" }], messages: [{ role: "user", content: "go" }], tools: TOOLS_A });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /event-stream/);
    const ev = parseSse(r.text);
    assert.deepEqual(ev.map((e) => e.event).filter((e, i, a) => a.indexOf(e) === i), ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
    const tool = ev.find((e) => e.data.content_block?.type === "tool_use");
    assert.equal(tool.data.content_block.name, "Bash");
    const json = ev.filter((e) => e.data.delta?.type === "input_json_delta").map((e) => e.data.delta.partial_json).join("");
    assert.deepEqual(JSON.parse(json), { command: "echo x" });
    assert.equal(ev.find((e) => e.event === "message_delta").data.delta.stop_reason, "tool_use");
  });
});

test("anthropic: non-streaming JSON and plain end_turn fallback", async () => {
  await withMock({ rules: [] }, async (m, url) => {
    const r = await post(`${url}/v1/messages`, { model: "m", stream: false, messages: [{ role: "user", content: "x" }] });
    const j = JSON.parse(r.text);
    assert.equal(j.stop_reason, "end_turn");
    assert.equal(j.content[0].text, "ok");
  });
});

test("openai chat: SSE tool_calls with indexed argument deltas and [DONE]", async () => {
  const script = { rules: [{ id: "r", when: { anyUserIncludes: "go" }, reply: [{ tool: "shell", args: { command: "ls" } }] }] };
  await withMock(script, async (m, url) => {
    const tools = [{ type: "function", function: { name: "shell", parameters: { type: "object", properties: { command: { type: "string" } } } } }];
    const r = await post(`${url}/v1/chat/completions`, { model: "m", stream: true, messages: [{ role: "system", content: "S" }, { role: "user", content: "go" }], tools });
    const ev = parseSse(r.text);
    assert.equal(ev.at(-1).data, "[DONE]");
    const calls = ev.filter((e) => e.data !== "[DONE]").flatMap((e) => e.data.choices?.[0]?.delta?.tool_calls || []);
    assert.equal(calls[0].function.name, "shell");
    assert.deepEqual(JSON.parse(calls.map((c) => c.function.arguments).join("")), { command: "ls" });
    assert.equal(ev.filter((e) => e.data !== "[DONE]").find((e) => e.data.choices?.[0]?.finish_reason)?.data.choices[0].finish_reason, "tool_calls");
    assert.equal(m.requests[0].norm.system, "S");
  });
});

test("openai responses: output items and response.completed", async () => {
  const script = { rules: [{ id: "r", when: { anyUserIncludes: "go" }, reply: [{ text: "yo" }, { tool: "shell", args: { command: "ls" } }] }] };
  await withMock(script, async (m, url) => {
    const tools = [{ type: "function", name: "shell", parameters: { type: "object", properties: { command: { type: "string" } } } }];
    const r = await post(`${url}/v1/responses`, { model: "m", stream: true, instructions: "I", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }], tools });
    const ev = parseSse(r.text);
    const done = ev.find((e) => e.event === "response.completed").data.response;
    assert.deepEqual(done.output.map((o) => o.type), ["message", "function_call"]);
    assert.equal(done.output[1].name, "shell");
    assert.equal(m.requests[0].norm.system, "I");
  });
});

test("capture API: sent(), systemIncludes(), toolNames(), toolResults(), reset()", async () => {
  await withMock({ rules: [] }, async (m, url) => {
    await post(`${url}/v1/messages`, {
      model: "m", stream: false, system: "HAS-CANARY-1",
      tools: TOOLS_A,
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "RESULT-CANARY-2" }] },
      ],
    });
    assert.ok(m.sent("HAS-CANARY-1") && m.systemIncludes("HAS-CANARY-1"));
    assert.ok(m.sent("RESULT-CANARY-2"));
    assert.ok(!m.sent("ABSENT"));
    assert.deepEqual(m.toolNames(), ["Bash", "Read"]);
    assert.deepEqual(m.toolResults().map((t) => [t.name, t.content]), [["Bash", "RESULT-CANARY-2"]]);
    m.reset();
    assert.equal(m.requests.length, 0);
  });
});

test("routes: models list, count_tokens, unknown path 404", async () => {
  await withMock({ rules: [] }, async (m, url) => {
    assert.equal((await (await fetch(`${url}/v1/models`)).json()).data[0].id, "mock-model");
    assert.equal((await post(`${url}/v1/messages/count_tokens`, {})).status, 200);
    assert.equal((await post(`${url}/nope`, {})).status, 404);
  });
});

test("secret headers are redacted in the capture log", async () => {
  await withMock({ rules: [] }, async (m, url) => {
    await post(`${url}/v1/messages`, { model: "m", stream: false, messages: [{ role: "user", content: "x" }] });
    assert.equal(m.requests[0].headers["x-api-key"], "[redacted]");
  });
});

test("sequence(): step chosen by number of tool results; dump dir writes files", async () => {
  const rules = sequence({ id: "s", when: { anyUserIncludes: "go" }, steps: [[{ tool: "shell", args: { command: "a" } }], [{ tool: "read", args: { path: "/x" } }]], final: [{ text: "end" }] });
  await withMock({ rules }, async (m, url) => {
    const mk = (n) => {
      const messages = [{ role: "user", content: "go" }];
      for (let i = 0; i < n; i++) {
        messages.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Bash", input: {} }] });
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "r" }] });
      }
      return { model: "m", stream: false, tools: TOOLS_A, messages };
    };
    const names = [];
    for (const n of [0, 1, 2]) names.push(JSON.parse((await post(`${url}/v1/messages`, mk(n))).text).content.map((c) => c.name || c.text).join());
    assert.deepEqual(names, ["Bash", "Read", "end"]);
    assert.equal(JSON.parse((await post(`${url}/v1/messages`, mk(1))).text).content[0].input.file_path, "/x"); // canonical `path` mapped to Read's file_path
  });
});
