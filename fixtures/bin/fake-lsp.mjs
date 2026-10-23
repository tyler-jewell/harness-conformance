#!/usr/bin/env node
// Minimal LSP over stdio (Content-Length framing): answers initialize, publishes one diagnostic on didOpen.
import fs from "node:fs";
const log = (s) => process.env.HC_LSP_LOG && fs.appendFileSync(process.env.HC_LSP_LOG, s + "\n");
let buf = Buffer.alloc(0);
const send = (o) => {
  const b = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...o }));
  process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`);
  process.stdout.write(b);
};
process.stdin.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf("\r\n\r\n");
    if (i < 0) return;
    const len = +/Content-Length: *(\d+)/i.exec(buf.slice(0, i).toString())?.[1];
    if (buf.length < i + 4 + len) return;
    const m = JSON.parse(buf.slice(i + 4, i + 4 + len).toString());
    buf = buf.slice(i + 4 + len);
    log(m.method || "response");
    if (m.method === "initialize") send({ id: m.id, result: { capabilities: { textDocumentSync: 1 }, serverInfo: { name: "fake-lsp" } } });
    else if (m.method === "textDocument/didOpen") send({ method: "textDocument/publishDiagnostics", params: { uri: m.params.textDocument.uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "HC-LSP-DIAG-CANARY-6d20" }] } });
    else if (m.method === "shutdown") send({ id: m.id, result: null });
    else if (m.method === "exit") process.exit(0);
    else if (m.id !== undefined) send({ id: m.id, result: null });
  }
});
