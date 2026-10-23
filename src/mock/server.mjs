// Deterministic mock model server: Anthropic Messages, OpenAI chat/completions, OpenAI Responses. Zero deps.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { normalizeAnthropic, normalizeChat, normalizeResponses } from "./normalize.mjs";
import { Script, buildReply } from "./script.mjs";
import * as wire from "./wire.mjs";

const SECRET_HEADERS = new Set(["authorization", "x-api-key", "cookie", "proxy-authorization"]);

export function createMockServer({ script = new Script(), log = null, dumpDir = null } = {}) {
  let current = script instanceof Script ? script : new Script(script);
  const requests = [];
  let idn = 0;
  const nextId = () => `toolu_mock${String(++idn).padStart(4, "0")}`;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body = {};
      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {}
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = SECRET_HEADERS.has(k) ? "[redacted]" : v;
      const p = url.pathname.replace(/\/+$/, "");
      const json = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const record = (norm) => requests.push({ at: requests.length, method: req.method, path: p, headers, norm });
      if (req.method === "GET" && /\/models$/.test(p)) {
        record(null);
        return json(200, { object: "list", data: [{ id: "mock-model", object: "model", type: "model", display_name: "Mock", created: 1700000000 }], has_more: false });
      }
      if (req.method === "POST" && /\/messages\/count_tokens$/.test(p)) {
        record(null);
        return json(200, { input_tokens: 10 });
      }
      let norm = null;
      let kind = null;
      if (req.method === "POST" && /\/messages$/.test(p)) (norm = normalizeAnthropic(body)), (kind = "anthropic");
      else if (req.method === "POST" && /\/chat\/completions$/.test(p)) (norm = normalizeChat(body)), (kind = "chat");
      else if (req.method === "POST" && /\/responses$/.test(p)) (norm = normalizeResponses(body)), (kind = "responses");
      if (!norm) {
        record(null);
        if (log) log(`unhandled ${req.method} ${p}`);
        return json(404, { error: { type: "not_found_error", message: `mock: no route ${req.method} ${p}` } });
      }
      record(norm);
      if (dumpDir) {
        fs.mkdirSync(dumpDir, { recursive: true });
        fs.writeFileSync(path.join(dumpDir, `${String(requests.length).padStart(3, "0")}-${kind}.json`), JSON.stringify({ path: p, headers, ...norm }, null, 2));
      }
      const rule = current.pick(norm);
      const parts = rule ? buildReply(rule, norm, nextId) : [{ text: "ok" }];
      requests[requests.length - 1].rule = rule ? rule.id : null;
      if (log) log(`${kind} ${norm.model} tools=${norm.tools.length} rule=${rule?.id ?? "-"} parts=${parts.map((x) => (x.tool ? "tool:" + x.tool.name : "text")).join(",")}`);
      const model = norm.model || "mock-model";
      if (!norm.stream) {
        const fn = kind === "anthropic" ? wire.anthropicJson : wire.chatJson;
        return json(200, fn(parts, model));
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const fn = kind === "anthropic" ? wire.anthropicStream : kind === "chat" ? wire.chatStream : wire.responsesStream;
      res.end(fn(parts, model));
    });
  });

  return {
    server,
    requests,
    get script() {
      return current;
    },
    setScript(s) {
      current = s instanceof Script ? s : new Script(s);
    },
    reset() {
      requests.length = 0;
    },
    async listen(port = 0, host = "127.0.0.1") {
      await new Promise((r) => server.listen(port, host, r));
      const { port: p } = server.address();
      return { port: p, url: `http://${host}:${p}` };
    },
    close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(r))),
    // ---- capture API: assertions on what the harness SENT ----
    modelRequests: () => requests.filter((r) => r.norm),
    sentText: () => requests.filter((r) => r.norm).map((r) => r.norm.rawText).join("\n"),
    sent: (needle) => requests.some((r) => r.norm && r.norm.rawText.includes(needle)),
    systemIncludes: (needle) => requests.some((r) => r.norm && r.norm.system.includes(needle)),
    toolNames: () => [...new Set(requests.filter((r) => r.norm).flatMap((r) => r.norm.tools.map((t) => t.name)))],
    toolResults: () => requests.filter((r) => r.norm).flatMap((r) => r.norm.messages.flatMap((m) => m.toolResults)),
  };
}
