// The lockstep contract: scenarios every harness must pass identically with our setup. CONTRACT.md mirrors this file.
import fs from "node:fs";
import path from "node:path";
import { sequence } from "../mock/index.mjs";
import { run } from "../proc.mjs";

export class Check extends Error {}
const ok = (c, desc, detail = "") => {
  if (!c) throw new Check(`${desc}${detail ? ` -- ${detail}` : ""}`);
  return desc;
};
const has = (s, n) => String(s).includes(n);
const textEvents = (r) => r.events.filter((e) => e.type === "text").map((e) => e.text).join("\n");

const HELLO = [{ rules: [] }];
const toolOut = (ctx) => ctx.mock.toolResults().map((t) => t.content).join("\n");

export const SCENARIOS = [
  {
    id: "T0.1", tier: 0, slug: "version", title: "Binary runs and reports a version",
    async run(ctx) {
      const r = await ctx.h.cmd(ctx.driver.versionArgs);
      return [ok(r.code === 0, "version command exits 0", r.stderr.slice(0, 120)), `version: ${ctx.driver.parseVersion?.(r.stdout + r.stderr) ?? r.stdout.trim().slice(0, 60)}`];
    },
  },
  {
    id: "T0.2", tier: 0, slug: "listing", title: "Offline listing/validation commands accept the sandbox config",
    async run(ctx) {
      const out = [];
      for (const t of ctx.driver.tier0(ctx.sb).filter((x) => x.id !== "version")) {
        // Some harnesses load config lazily (OpenCode's background service): poll a few times before judging.
        let r;
        let c;
        for (let i = 0; i < (t.retries ?? 1); i++) {
          r = await ctx.h.cmd(t.argv);
          c = t.check(r);
          if (c.ok) break;
          await new Promise((res) => setTimeout(res, 1500));
        }
        ok(c.ok, `${t.id} (${ctx.driver.name} ${t.argv.join(" ")})`, c.evidence);
        out.push(`${t.id}: ${c.evidence}`);
      }
      if (!out.length) out.push("no offline listing command beyond --version for this harness");
      return out;
    },
  },
  {
    id: "S1", tier: 1, slug: "instruction-file", title: "Shared AGENTS.md content reaches the model",
    async run(ctx) {
      await ctx.h.prompt("hello", { script: { rules: [] } });
      return [ok(ctx.mock.sent("HC-INSTR-CANARY-7f3a"), "instruction canary present in request sent to the model")];
    },
  },
  {
    id: "S2", tier: 1, slug: "skill-discovery", title: "Skill from ~/.agents/skills is listed and loadable",
    async run(ctx) {
      const out = [];
      await ctx.h.prompt("hello", { script: { rules: [] } });
      out.push(ok(ctx.mock.sent("HC-SKILL-CANARY-3b9e"), "skill description present in request sent to the model"));
      await ctx.h.prompt("LOADSKILL", {
        script: { rules: sequence({ id: "skill", when: { anyUserIncludes: "LOADSKILL", hasAnyTool: ["skill", "read"] }, steps: [[{ tool: "skill", args: { name: "conformance-skill" }, fallback: { tool: "read", args: { path: path.join(ctx.sb.home, ".agents/skills/conformance-skill/SKILL.md") } } }]], final: [{ text: "skill-done" }] }) },
      });
      out.push(ok(ctx.mock.sent("HC-SKILL-BODY-CANARY-44d1"), "skill body reached the model after the skill was loaded"));
      return out;
    },
  },
  {
    id: "S3", tier: 1, slug: "agent-discovery", title: "Domain agents are listed to the model (coordinator: see S4, T0.2)",
    async run(ctx) {
      await ctx.h.prompt("hello", { script: { rules: [] } });
      const n = ctx.needles;
      return [
        ...n.domainAgents.map((a) => ok(ctx.mock.sent(a.name), `domain agent ${a.name} (${a.domain}) is listed to the model`)),
      ];
    },
  },
  {
    id: "S4", tier: 1, slug: "default-main-agent", title: "Main agent is coordinator by default (no flags)",
    async run(ctx) {
      await ctx.h.prompt("hello", { script: { rules: [] }, noAgentFlag: true });
      return [ok(ctx.mock.sent(ctx.needles.coordPrompt), "coordinator prompt is the main agent's prompt", ctx.needles.coordPrompt)];
    },
  },
  {
    id: "S5", tier: 1, slug: "tool-execution", title: "Scripted read and shell tool calls execute",
    async run(ctx) {
      await ctx.h.prompt("RUNTOOLS", {
        script: {
          rules: sequence({
            id: "tools",
            when: { anyUserIncludes: "RUNTOOLS" },
            steps: [
              [{ tool: "read", args: { path: path.join(ctx.sb.work, "hello.txt") } }],
              [{ tool: "shell", args: { command: "expr 40 + 2 | sed 's/^/HC-SHELL-CANARY-/'" } }],
            ],
            final: [{ text: "tools-done" }],
          }),
        },
      });
      const t = toolOut(ctx);
      return [ok(has(t, "HC-FILE-CANARY-hello"), "read tool returned file content"), ok(has(t, "HC-SHELL-CANARY-42"), "shell tool executed (computed output, not echoed command)")];
    },
  },
  {
    id: "S6", tier: 1, slug: "secrets-safety", title: "A .env canary never reaches the model",
    async run(ctx) {
      await ctx.h.prompt("STEALSECRET", {
        script: {
          rules: sequence({
            id: "steal",
            when: { anyUserIncludes: "STEALSECRET" },
            steps: [[{ tool: "read", args: { path: path.join(ctx.sb.work, ".env") } }], [{ tool: "shell", args: { command: "cat .env" } }]],
            final: [{ text: "steal-done" }],
          }),
        },
      });
      const sent = ctx.mock.sentText();
      return [
        ok(ctx.mock.toolResults().length >= 1, "harness answered the attempted tool calls (denial is observable)"),
        ok(!has(sent, ctx.sb.canary), "canary absent from every request the model received"),
        ok(!has(ctx.last.stdout + ctx.last.stderr, ctx.sb.canary), "canary absent from harness output"),
      ];
    },
  },
  {
    id: "S7", tier: 0, slug: "lsp", title: "lsp-doctor emitted LSP servers are accepted by the harness",
    async run(ctx) {
      if (!ctx.driver.lspCheck) throw new Check("driver has no lspCheck");
      const ev = await ctx.driver.lspCheck(ctx);
      return [ok(ev.ok, "harness lists the configured LSP servers", ev.evidence), ev.evidence];
    },
  },
  {
    id: "S8", tier: 1, slug: "mcp", title: "Stdio MCP fixture tool is listed and called",
    async run(ctx) {
      // Step 1 gives async MCP start-up a moment; step 2 calls the tool directly or, where the harness only exposes
      // MCP through a code tool (OpenCode 2 `execute`), through that.
      await ctx.h.prompt("CALLMCP", {
        script: {
          rules: sequence({
            id: "mcp",
            when: { anyUserIncludes: "CALLMCP", hasAnyTool: ["~conformance_ping", "execute", "use_tool"] },
            steps: [
              [{ tool: "shell", args: { command: "sleep 3" } }],
              [{ tool: "~conformance_ping", args: { msg: "hc" }, fallback: [{ tool: "execute", args: { code: 'return await tools.fixture.conformance_ping({ msg: "hc" });' } }, { tool: "use_tool", args: { tool_name: "fixture__conformance_ping", tool_input: { msg: "hc" } } }] }],
            ],
            final: [{ text: "mcp-done" }],
          }),
        },
      });
      return [ok(fs.existsSync(ctx.sb.mcpLog) && /tools\/call/.test(fs.readFileSync(ctx.sb.mcpLog, "utf8")), "MCP server received tools/call from the harness"), ok(has(toolOut(ctx), "PONG-CANARY-9c4e:hc"), "MCP tool result reached the model")];
    },
  },
  {
    id: "S9", tier: 1, slug: "hooks", title: "SessionStart and UserPromptSubmit hooks run",
    async run(ctx) {
      await ctx.h.prompt("hello", { script: { rules: [] } });
      const log = fs.existsSync(ctx.sb.hookLog) ? fs.readFileSync(ctx.sb.hookLog, "utf8") : "";
      return [ok(/^SessionStart\t/m.test(log), "SessionStart hook executed"), ok(/^UserPromptSubmit\t/m.test(log), "UserPromptSubmit hook executed")];
    },
  },
  {
    id: "S10", tier: 1, slug: "subagent", title: "Delegation to a domain agent runs it with its own prompt",
    async run(ctx) {
      const d = ctx.needles.delegate;
      const rules = [
        { id: "sub", when: { fn: (r) => r.system.includes(d.prompt) && r.userText.includes("HC-SUBAGENT-TASK") }, reply: [{ text: "HC-SUBAGENT-RESULT-8e21" }] },
        ...sequence({ id: "main", when: { anyUserIncludes: "DELEGATE", hasTool: "task" }, steps: [[{ tool: "task", args: { agent: d.name, prompt: "HC-SUBAGENT-TASK do the thing", description: "delegate" } }]], final: [{ text: "delegated" }] }),
      ];
      await ctx.h.prompt("DELEGATE", { script: { rules } });
      const subReq = ctx.mock.modelRequests().some((r) => r.norm.system.includes(d.prompt) && r.norm.userText.includes("HC-SUBAGENT-TASK") && !r.norm.system.includes(ctx.needles.coordPrompt));
      return [ok(subReq, "a model request carried the domain agent's own prompt"), ok(ctx.mock.modelRequests().some((r) => r.norm.rawText.includes("HC-SUBAGENT-RESULT-8e21") && !r.norm.system.includes(d.prompt)), "subagent result delivered back to the main agent (tool result or completion notice)")];
    },
  },
  {
    id: "S11", tier: 1, slug: "git-hooks", title: "Global git hook blocks a bad commit message, allows a good one",
    async run(ctx) {
      await ctx.h.prompt("GITCOMMIT", {
        script: {
          rules: sequence({
            id: "git",
            when: { anyUserIncludes: "GITCOMMIT" },
            steps: [
              [{ tool: "shell", args: { command: "git commit --allow-empty -m 'bad message' 2>&1 || echo commit-failed" } }],
              [{ tool: "shell", args: { command: "git commit --allow-empty -s -m 'feat: good message' 2>&1 || echo commit-failed" } }],
            ],
            final: [{ text: "git-done" }],
          }),
        },
      });
      const log = await run("git", ["log", "--format=%s"], { cwd: ctx.sb.work, env: ctx.sb.env });
      const subjects = log.stdout.split("\n");
      return [ok(!subjects.includes("bad message"), "bad commit message was rejected"), ok(subjects.includes("feat: good message"), "good commit message accepted")];
    },
  },
  {
    id: "S12", tier: 1, slug: "policy-instructions", title: "No-wrangler and agent-browser policy delivered as instructions",
    async run(ctx) {
      await ctx.h.prompt("hello", { script: { rules: [] } });
      return [ok(ctx.mock.sent("Never suggest `wrangler`"), "no-wrangler policy present"), ok(ctx.mock.sent("agent-browser"), "agent-browser policy present")];
    },
  },
  {
    id: "S13", tier: 1, slug: "hook-context", title: "SessionStart hook stdout is injected as model context",
    async run(ctx) {
      await ctx.h.prompt("hello", { script: { rules: [] } });
      return [ok(ctx.mock.sent("HC-SESSION-HOOK-CANARY-e5f9"), "SessionStart hook output reached the model as context")];
    },
  },
];
export const byId = (id) => SCENARIOS.find((s) => s.id.toLowerCase() === id.toLowerCase() || s.slug === id);
