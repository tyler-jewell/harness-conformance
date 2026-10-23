#!/usr/bin/env node
// A FAKE `claude` for fast offline tests: speaks just enough Anthropic Messages + stream-json to drive the
// runner end to end (instruction file, Bash/Read tools, deny rules). Not a model of Claude Code's behavior.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const argv = process.argv.slice(2);
if (argv[0] === "--version") (console.log("9.9.9 (Claude Code)"), process.exit(0));
if (argv[0] === "mcp") (console.log("fixture: fake ok"), process.exit(0));
const prompt = argv[argv.indexOf("-p") + 1];
const home = process.env.HOME;
let instr = "";
try { instr = fs.readFileSync(path.join(home, ".claude/CLAUDE.md"), "utf8"); } catch {}
let deny = [];
try { deny = JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8")).permissions?.deny || []; } catch {}
const denied = (p) => deny.some((d) => d.startsWith("Read(") && p.includes(".env"));
const deniedCmd = (c) => deny.some((d) => d.startsWith("Bash(cat ") && /^cat .*\.env/.test(c));
const out = (o) => console.log(JSON.stringify(o));
out({ type: "system", subtype: "init", tools: ["Bash", "Read"], agents: [], skills: [] });
const messages = [{ role: "user", content: [{ type: "text", text: `<system-reminder>${instr}</system-reminder>` }, { type: "text", text: prompt }] }];
const tools = [
  { name: "Bash", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "Read", input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
];
for (let turn = 0; turn < 8; turn++) {
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY }, body: JSON.stringify({ model: "mock-model", stream: false, system: "fake", messages, tools }) });
  const j = await res.json();
  messages.push({ role: "assistant", content: j.content });
  const results = [];
  for (const c of j.content) {
    if (c.type === "text") out({ type: "assistant", message: { content: [c] } });
    if (c.type !== "tool_use") continue;
    out({ type: "assistant", message: { content: [c] } });
    let text;
    try {
      if (c.name === "Bash" && deniedCmd(c.input.command)) text = "Permission denied by deny rule";
      else if (c.name === "Bash") text = execSync(c.input.command, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      else if (denied(c.input.file_path)) text = "Permission denied by deny rule";
      else text = fs.readFileSync(c.input.file_path, "utf8");
    } catch (e) { text = String(e.stdout || e.message); }
    results.push({ type: "tool_result", tool_use_id: c.id, content: text });
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: c.id, content: text }] } });
  }
  if (!results.length) break;
  messages.push({ role: "user", content: results });
}
out({ type: "result", is_error: false, result: "done" });
