#!/usr/bin/env node
// Tiny stdio MCP server (newline-delimited JSON-RPC) exposing one tool: conformance_ping.
import fs from "node:fs";
import readline from "node:readline";
const log = (o) => process.env.HC_MCP_LOG && fs.appendFileSync(process.env.HC_MCP_LOG, JSON.stringify(o) + "\n");
const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  log({ method: m.method, params: m.method === "tools/call" ? m.params : undefined });
  if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "conformance-fixture", version: "0.0.0" } } });
  else if (m.method === "tools/list") send({ id: m.id, result: { tools: [{ name: "conformance_ping", description: "Echo a message with a PONG marker (conformance fixture)", inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: [] } }] } });
  else if (m.method === "tools/call") send({ id: m.id, result: { content: [{ type: "text", text: `PONG-CANARY-9c4e:${m.params?.arguments?.msg ?? ""}` }] } });
  else if (m.id !== undefined) send({ id: m.id, result: {} });
});
