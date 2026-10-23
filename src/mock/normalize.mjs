// Normalize the three wire formats into one request shape the script DSL can match on.
// Shape: { api, model, stream, system, messages[{role,text,toolCalls[{id,name,input}],toolResults[{id,name,content}]}],
//          tools[{name,props[]}], userText, lastUserText, lastToolResult, rawText }

function textOf(c) {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : p?.text ?? p?.output ?? (p?.type === "tool_result" ? textOf(p.content) : "")))
      .join("\n");
  }
  return typeof c === "object" ? JSON.stringify(c) : String(c);
}

function finish(n, body) {
  n.rawText = JSON.stringify(body);
  const users = n.messages.filter((m) => m.role === "user" && m.text && !m.toolResults.length);
  n.userText = users.map((m) => m.text).join("\n");
  n.lastUserText = users.length ? users[users.length - 1].text : "";
  const last = n.messages[n.messages.length - 1];
  n.lastToolResult = last && last.toolResults.length ? last.toolResults[last.toolResults.length - 1] : null;
  return n;
}

export function normalizeAnthropic(body) {
  const names = new Map();
  const system = Array.isArray(body.system) ? body.system.map((b) => b.text || "").join("\n") : body.system || "";
  const n = { api: "anthropic", model: body.model, stream: body.stream !== false, system, messages: [], tools: [] };
  for (const t of body.tools || []) n.tools.push({ name: t.name, props: Object.keys(t.input_schema?.properties || {}), required: t.input_schema?.required || [], description: t.description || "" });
  for (const m of body.messages || []) {
    const out = { role: m.role, text: "", toolCalls: [], toolResults: [] };
    const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
    for (const p of parts) {
      if (p.type === "text") out.text += (out.text ? "\n" : "") + p.text;
      else if (p.type === "tool_use") {
        names.set(p.id, p.name);
        out.toolCalls.push({ id: p.id, name: p.name, input: p.input });
      } else if (p.type === "tool_result") out.toolResults.push({ id: p.tool_use_id, name: names.get(p.tool_use_id) || "", content: textOf(p.content) });
    }
    n.messages.push(out);
  }
  return finish(n, body);
}

export function normalizeChat(body) {
  const names = new Map();
  const n = { api: "openai-chat", model: body.model, stream: !!body.stream, system: "", messages: [], tools: [] };
  for (const t of body.tools || []) {
    const f = t.function || t;
    n.tools.push({ name: f.name, props: Object.keys(f.parameters?.properties || {}), required: f.parameters?.required || [], description: f.description || "" });
  }
  for (const m of body.messages || []) {
    if (m.role === "system" || m.role === "developer") {
      n.system += (n.system ? "\n" : "") + textOf(m.content);
      continue;
    }
    const out = { role: m.role === "tool" ? "user" : m.role, text: m.role === "tool" ? "" : textOf(m.content), toolCalls: [], toolResults: [] };
    for (const c of m.tool_calls || []) {
      let input = {};
      try {
        input = JSON.parse(c.function?.arguments || "{}");
      } catch {}
      names.set(c.id, c.function?.name);
      out.toolCalls.push({ id: c.id, name: c.function?.name, input });
    }
    if (m.role === "tool") out.toolResults.push({ id: m.tool_call_id, name: names.get(m.tool_call_id) || "", content: textOf(m.content) });
    n.messages.push(out);
  }
  return finish(n, body);
}

export function normalizeResponses(body) {
  const names = new Map();
  const n = { api: "openai-responses", model: body.model, stream: !!body.stream, system: body.instructions || "", messages: [], tools: [] };
  for (const t of body.tools || []) n.tools.push({ name: t.name || t.type, props: Object.keys(t.parameters?.properties || {}), required: t.parameters?.required || [], description: t.description || "" });
  const input = typeof body.input === "string" ? [{ type: "message", role: "user", content: body.input }] : body.input || [];
  for (const it of input) {
    if (it.type === "function_call") {
      names.set(it.call_id, it.name);
      let inp = {};
      try {
        inp = JSON.parse(it.arguments || "{}");
      } catch {}
      n.messages.push({ role: "assistant", text: "", toolCalls: [{ id: it.call_id, name: it.name, input: inp }], toolResults: [] });
    } else if (it.type === "function_call_output") {
      n.messages.push({ role: "user", text: "", toolCalls: [], toolResults: [{ id: it.call_id, name: names.get(it.call_id) || "", content: textOf(it.output) }] });
    } else if (it.role === "system" || it.role === "developer") n.system += (n.system ? "\n" : "") + textOf(it.content);
    else if (it.role) n.messages.push({ role: it.role, text: textOf(it.content), toolCalls: [], toolResults: [] });
  }
  return finish(n, body);
}
