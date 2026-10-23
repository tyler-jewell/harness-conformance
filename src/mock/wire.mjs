// Encode a scripted reply ([{text}|{tool:{id,name,input}}]) as Anthropic SSE/JSON, OpenAI chat SSE/JSON, or Responses SSE.
let seq = 0;
const id = (p) => `${p}_${String(++seq).padStart(6, "0")}`;
const sse = (event, data) => (event ? `event: ${event}\n` : "") + `data: ${JSON.stringify(data)}\n\n`;
const hasTool = (parts) => parts.some((p) => p.tool);
const chunks = (s, n = 24) => (s.length ? s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) : []);

export function anthropicStream(parts, model) {
  const msgId = id("msg");
  let out = sse("message_start", { type: "message_start", message: { id: msgId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  parts.forEach((p, index) => {
    if (p.tool) {
      out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: p.tool.id, name: p.tool.name, input: {} } });
      for (const c of chunks(JSON.stringify(p.tool.input), 40)) out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: c } });
    } else {
      out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const c of chunks(p.text)) out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: c } });
    }
    out += sse("content_block_stop", { type: "content_block_stop", index });
  });
  out += sse("message_delta", { type: "message_delta", delta: { stop_reason: hasTool(parts) ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
  out += sse("message_stop", { type: "message_stop" });
  return out;
}

export function anthropicJson(parts, model) {
  return {
    id: id("msg"), type: "message", role: "assistant", model, stop_reason: hasTool(parts) ? "tool_use" : "end_turn", stop_sequence: null,
    content: parts.map((p) => (p.tool ? { type: "tool_use", id: p.tool.id, name: p.tool.name, input: p.tool.input } : { type: "text", text: p.text })),
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

export function chatStream(parts, model) {
  const cid = id("chatcmpl");
  const base = { id: cid, object: "chat.completion.chunk", created: 1700000000, model };
  const frame = (delta, finish = null) => `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  let out = frame({ role: "assistant", content: "" });
  let ti = 0;
  for (const p of parts) {
    if (p.tool) {
      out += frame({ tool_calls: [{ index: ti, id: p.tool.id, type: "function", function: { name: p.tool.name, arguments: "" } }] });
      for (const c of chunks(JSON.stringify(p.tool.input), 40)) out += frame({ tool_calls: [{ index: ti, function: { arguments: c } }] });
      ti++;
    } else for (const c of chunks(p.text)) out += frame({ content: c });
  }
  out += frame({}, hasTool(parts) ? "tool_calls" : "stop");
  out += `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`;
  return out + "data: [DONE]\n\n";
}

export function chatJson(parts, model) {
  const text = parts.filter((p) => p.text).map((p) => p.text).join("");
  const calls = parts.filter((p) => p.tool).map((p) => ({ id: p.tool.id, type: "function", function: { name: p.tool.name, arguments: JSON.stringify(p.tool.input) } }));
  return {
    id: id("chatcmpl"), object: "chat.completion", created: 1700000000, model,
    choices: [{ index: 0, message: { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

export function responsesStream(parts, model) {
  const rid = id("resp");
  const resp = (status, output = []) => ({ id: rid, object: "response", created_at: 1700000000, status, model, output, usage: status === "completed" ? { input_tokens: 10, output_tokens: 5, total_tokens: 15 } : null });
  let out = sse("response.created", { type: "response.created", response: resp("in_progress") });
  const output = [];
  parts.forEach((p, i) => {
    if (p.tool) {
      const item = { type: "function_call", id: id("fc"), call_id: p.tool.id, name: p.tool.name, arguments: JSON.stringify(p.tool.input), status: "completed" };
      out += sse("response.output_item.added", { type: "response.output_item.added", output_index: i, item: { ...item, arguments: "", status: "in_progress" } });
      out += sse("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", output_index: i, item_id: item.id, delta: item.arguments });
      out += sse("response.function_call_arguments.done", { type: "response.function_call_arguments.done", output_index: i, item_id: item.id, arguments: item.arguments });
      out += sse("response.output_item.done", { type: "response.output_item.done", output_index: i, item });
      output.push(item);
    } else {
      const item = { type: "message", id: id("msg"), role: "assistant", status: "completed", content: [{ type: "output_text", text: p.text, annotations: [] }] };
      out += sse("response.output_item.added", { type: "response.output_item.added", output_index: i, item: { ...item, content: [], status: "in_progress" } });
      out += sse("response.content_part.added", { type: "response.content_part.added", output_index: i, item_id: item.id, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      for (const c of chunks(p.text)) out += sse("response.output_text.delta", { type: "response.output_text.delta", output_index: i, item_id: item.id, content_index: 0, delta: c });
      out += sse("response.output_text.done", { type: "response.output_text.done", output_index: i, item_id: item.id, content_index: 0, text: p.text });
      out += sse("response.output_item.done", { type: "response.output_item.done", output_index: i, item });
      output.push(item);
    }
  });
  return out + sse("response.completed", { type: "response.completed", response: resp("completed", output) });
}
