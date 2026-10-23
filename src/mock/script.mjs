// Scripting DSL. A script is { name, rules: [rule] }. Each rule:
//   { id, when: {...matchers}, reply: [ {text} | {tool:'shell'|'read'|'write'|'task'|<exact name>, args:{}} ], once? }
// Matchers (all optional, all must hold): userIncludes, systemIncludes, toolResultIncludes, afterTool (name or logical),
//   hasTool (logical|exact name present in tool list), noTools (request has no tools), fn(req)
// First matching rule not yet consumed (once rules) wins. Fallback: a plain "ok" text reply.
// Logical tool names are resolved against the harness-provided tool list so one script works for every harness.
const ALIASES = {
  shell: ["bash", "shell", "run_terminal_cmd", "run_terminal_command", "run_command", "execute_command", "exec_command", "local_shell"],
  read: ["read", "read_file", "view", "readfile"],
  write: ["write", "write_file", "create_file", "writefile"],
  task: ["task", "agent", "subagent", "spawn_agent", "spawn_subagent", "delegate"],
  skill: ["skill", "load_skill", "use_skill"],
};
// Scripts use canonical argument names; each is mapped onto whatever the harness's tool schema calls it.
const CANON = {
  shell: { command: ["command", "cmd", "script"] },
  read: { path: ["file_path", "filePath", "target_file", "path", "filename", "file"] },
  write: { path: ["file_path", "filePath", "path"], content: ["content", "text"] },
  task: { agent: ["subagent_type", "agent", "subagent", "agent_type", "persona", "role", "name"], prompt: ["prompt", "task", "message"], description: ["description"] },
  skill: { name: ["skill", "id", "name", "skill_name"] },
};

export function resolveTool(logical, tools) {
  const want = ALIASES[logical] || [logical.toLowerCase()];
  if (logical.startsWith("~")) want.length = 0;
  for (const w of want) {
    const t = tools.find((x) => x.name.toLowerCase() === w);
    if (t) return t;
  }
  const exact = tools.find((x) => x.name.toLowerCase() === logical.toLowerCase());
  if (exact) return exact;
  // `~foo` resolves any tool whose name contains "foo" (MCP tools carry harness-specific prefixes).
  if (logical.startsWith("~")) return tools.find((x) => x.name.toLowerCase().includes(logical.slice(1).toLowerCase())) || null;
  return null;
}

function adaptArgs(logical, args, tool) {
  const out = {};
  const canon = CANON[logical] || {};
  for (const [k, v] of Object.entries(args || {})) {
    const cands = canon[k];
    out[cands ? cands.find((c) => tool.props.includes(c)) || k : k] = v;
  }
  // Fill required-but-unscripted properties (e.g. grok's shell `description`) so schema validation passes.
  for (const r of tool.required || []) if (!(r in out)) out[r] = "conformance";
  return out;
}

export function matches(rule, req, tools = req.tools) {
  const w = rule.when || {};
  if (w.userIncludes && !req.lastUserText.includes(w.userIncludes)) return false;
  if (w.anyUserIncludes && !req.userText.includes(w.anyUserIncludes)) return false;
  if (w.systemIncludes && !req.system.includes(w.systemIncludes)) return false;
  if (w.toolResultIncludes && !(req.lastToolResult && req.lastToolResult.content.includes(w.toolResultIncludes))) return false;
  if (w.afterTool) {
    const r = req.lastToolResult;
    const t = resolveTool(w.afterTool, tools);
    if (!r || !(r.name.toLowerCase() === w.afterTool.toLowerCase() || (t && r.name === t.name))) return false;
  }
  if (w.hasTool && !resolveTool(w.hasTool, tools)) return false;
  if (w.hasAnyTool && !w.hasAnyTool.some((n) => resolveTool(n, tools))) return false;
  if (w.noTools && tools.length) return false;
  if (w.fn && !w.fn(req)) return false;
  return true;
}

export function buildReply(rule, req, nextId) {
  const parts = [];
  for (const p of rule.reply) {
    if (p.text != null) {
      parts.push({ text: typeof p.text === "function" ? p.text(req) : p.text });
    } else if (p.tool) {
      let spec = p;
      let tool = resolveTool(p.tool, req.tools);
      // `fallback`: a different tool call used when the harness does not expose this tool directly
      // (e.g. OpenCode 2 only reaches MCP tools through its `execute` code tool).
      for (const fb of [].concat(p.fallback || [])) {
        if (tool) break;
        spec = fb;
        tool = resolveTool(fb.tool, req.tools);
      }
      if (!tool) {
        parts.push({ text: `MOCK: tool "${p.tool}" is not available to this harness` });
        continue;
      }
      const args = typeof spec.args === "function" ? spec.args(req) : spec.args;
      parts.push({ tool: { id: nextId(), name: tool.name, input: adaptArgs(spec.tool, args, tool) } });
    }
  }
  return parts.length ? parts : [{ text: "ok" }];
}

export class Script {
  constructor(def = { name: "default", rules: [] }) {
    this.def = def;
    this.used = new Set();
  }
  pick(req) {
    for (const rule of this.def.rules) {
      if (rule.once && this.used.has(rule.id)) continue;
      if (matches(rule, req)) {
        if (rule.once) this.used.add(rule.id);
        return rule;
      }
    }
    return null;
  }
}

// ---- helpers for writing scripts ----
export const toolResultCount = (req) => req.messages.reduce((n, m) => n + m.toolResults.length, 0);

// sequence({ id, when, steps: [reply0, reply1, ...], final }) -> rules. The step is chosen by how many tool
// results the conversation already contains, so a multi-step tool dance is deterministic per conversation.
export function sequence({ id, when = {}, steps, final }) {
  const rules = steps.map((reply, i) => ({
    id: `${id}#${i}`,
    when: { ...when, fn: (req) => toolResultCount(req) === i && (!when.fn || when.fn(req)) },
    reply,
  }));
  if (final) rules.push({ id: `${id}#final`, when: { ...when, fn: (req) => toolResultCount(req) >= steps.length && (!when.fn || when.fn(req)) }, reply: final });
  return rules;
}
