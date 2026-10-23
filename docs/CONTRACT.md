# The lockstep contract

Every scenario below must behave identically on every harness with the same setup. The expectation per
scenario x harness lives in [`src/expectations.mjs`](../src/expectations.mjs) (data, reviewed like code);
`harness-conformance list` prints it.

| Status | Meaning | CI |
|---|---|---|
| PASS | required and passing | a failure is **FAIL** and gates |
| XFAIL | tracked divergence: must keep failing | if it starts passing it is **XPASS** and gates (delete the entry) |
| SKIP | the harness lacks the feature; documented known gap; not run | never gates |
| ADVISORY | run and reported only (unverified drivers: Codex, pi; harnesses with no driver) | never gates |
| NOT-INSTALLED | harness absent | gates only with `--require-installed` (CI) |

Scenarios assert on **what the harness sent to the mock model** (system prompt, tool list, tool results) and on
real side effects (files, git history, hook log, MCP server log). Canary strings make a match unambiguous.

| ID | Tier | Scenario | Asserts |
|---|---|---|---|
| T0.1 | 0 | binary runs | `--version` exits 0 |
| T0.2 | 0 | offline listing | claude `mcp list` shows the fixture server; opencode `debug config` has the provider and `debug agents` lists `coordinator`; grok `inspect --json` lists the skill, MCP server, `coordinator` and the global instruction file |
| S1 | 1 | instruction file | the shared `AGENTS.md` content is in the request the model received |
| S2 | 1 | skill discovery | the skill description from `~/.agents/skills` is listed; loading it (skill tool, or reading `SKILL.md` where there is no skill tool) delivers the body |
| S3 | 1 | agent discovery | the domain agents (different domains) are listed to the model |
| S4 | 1 | default main agent | with no flags the coordinator's prompt is the main agent's prompt |
| S5 | 1 | tool execution | scripted `read` returns file content; scripted shell command really runs (computed output) |
| S6 | 1 | secrets safety | the model tries to `read` and `cat` a `.env`; the canary never appears in any request or in harness output, and the attempt was answered (denial is visible) |
| S7 | 0 | LSP | servers from `lsp-doctor emit` are accepted and listed (config acceptance; the handshake itself is lsp-doctor's own test) |
| S8 | 1 | MCP | a stdio MCP server's tool is called through the harness and its result reaches the model |
| S9 | 1 | hooks run | `SessionStart` and `UserPromptSubmit` hooks execute |
| S10 | 1 | subagent | delegating to a domain agent runs it with its own prompt and its result returns to the main agent |
| S11 | 1 | git hooks | the agent's `git commit -m 'bad message'` is rejected by the global hook, `feat: good message` (signed off) succeeds |
| S12 | 1 | policy instructions | the no-wrangler and `agent-browser` policy lines are delivered as instructions |
| S13 | 1 | hook context | `SessionStart` hook stdout is injected as model context |

## Current expectations and what we measured (macOS arm64, 2026-10-23)

| Scenario | claude 2.1.309 | opencode 2.1.3 | grok 1.0.67 |
|---|---|---|---|
| S7 | SKIP | PASS | PASS |
| S9 | PASS | SKIP | PASS |
| S13 | PASS | SKIP | XFAIL |
| all others | PASS | PASS | PASS |

Reasons (also printed by `list`):

- **S7 / claude**: Claude Code takes LSP servers only from plugins (`.lsp.json`); there is no user-level LSP config for
  `lsp-doctor emit --format claude` to target (upstream marks that format UNVERIFIED). Not proven by experiment, only by absence of a config key.
- **S9, S13 / opencode**: OpenCode 2 has no declarative command-hook config; hooks are JS plugins. `agents-doctor` ships an
  opencode plugin, marked unverified end to end upstream. A plugin-based S9 variant is future work.
- **S13 / grok**: Grok runs the hook but discards its stdout (verified on 1.0.67; `agents-doctor` documents the same), so a
  hook cannot inject context or a warning. The config default (`[agent] name = "coordinator"`) is the mechanism there.

## Harness quirks the drivers and scripts absorb (not divergences in the contract)

- **Claude Code**: subagents run asynchronously (`Agent` returns "launched", the result arrives as a notice); MCP tools sit
  behind `ToolSearch` unless `ENABLE_TOOL_SEARCH=false`; skills load by injecting the body as a message, not as a tool result;
  `claude agents --json` lists background sessions, not definitions.
- **OpenCode 2**: a managed background service owns config loading (fixed port 49374 by default; the sandbox sets its own
  port) so `debug agents` is empty for a few seconds after start; MCP tools are reachable only through the `execute` Code
  Mode tool and appear in its catalog after async connect; extra `system-update` user messages appear mid-conversation.
- **Grok Build**: project `AGENTS.md` needs folder trust (`--trust`); no skill tool (skills are read as files); MCP via
  `search_tool`/`use_tool`; tool arguments are validated (`run_terminal_command` requires `description`); Bash deny rules make
  it refuse commands it cannot parse (`$?`, `$((...))`), so scenario commands avoid shell expansion; it also reads
  `~/.claude` (agents, skills, hooks, instructions): the driver sets `GROK_CLAUDE_HOOKS_ENABLED=0` to test grok-native hooks.
- **Shared**: tool-name vocabularies differ (`Bash`/`shell`/`run_terminal_command`, `Agent`/`subagent`/`spawn_subagent`); the
  mock script uses logical names and canonical argument names and maps them per request ([MOCK-MODEL.md](MOCK-MODEL.md)).

## Negative control

`HC_NEGATIVE=1 harness-conformance run --scenario S6` removes the secret-read deny rules; S6 must then FAIL on every
harness. It does (claude, opencode, grok), which proves the check can fail.

## Changing the contract

Add a scenario in `src/scenarios/index.mjs`, give it a row here, and set every harness's cell in
`src/expectations.mjs` in the same PR. A new divergence is either fixed in the setup or recorded as XFAIL with a reason.
