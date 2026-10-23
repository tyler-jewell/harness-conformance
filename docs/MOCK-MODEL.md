# Mock model server

`src/mock/` is a zero-dependency Node HTTP server that stands in for the model. Start it standalone:
`harness-conformance mock --port 8787 --dump ./dump` and point a harness at it.

## Endpoints

| Route | Used by | Notes |
|---|---|---|
| `POST /v1/messages` | Claude Code (`ANTHROPIC_BASE_URL`) | SSE: `message_start`, `content_block_start/delta/stop` (`text_delta`, `input_json_delta`), `message_delta` (`stop_reason` `tool_use`/`end_turn`), `message_stop`; `stream:false` returns JSON |
| `POST /v1/chat/completions` | OpenCode (`@ai-sdk/openai-compatible`), Grok (`api_backend = "chat_completions"`) | SSE chunks with indexed `tool_calls` deltas, usage chunk, `[DONE]` |
| `POST /v1/responses` | Codex (`wire_api = "responses"`), Grok (`api_backend = "responses"`) | `response.created`, `output_item.added/done`, `output_text.delta`, `function_call_arguments.*`, `response.completed` |
| `GET /v1/models`, `POST /v1/messages/count_tokens` | startup probes | static answers |

Anything else is a 404 and is recorded.

## Scripts

A script is `{ rules: [ { id, when, reply, once? } ] }`. The first matching rule wins; no match replies `ok`.

```js
{ id: "read-then-run",
  when: { anyUserIncludes: "RUNTOOLS", hasTool: "shell" },
  reply: [ { text: "running" }, { tool: "shell", args: { command: "echo hi" } } ] }
```

Matchers: `userIncludes` (last user text), `anyUserIncludes`, `systemIncludes`, `toolResultIncludes`, `afterTool`, `hasTool`,
`hasAnyTool`, `noTools`, `fn(req)`. `sequence({ id, when, steps, final })` builds one rule per step, selecting by the number of
tool results already in the conversation.

**Logical tools.** `shell`, `read`, `write`, `task`, `skill` resolve against the tool list the harness actually sent
(`Bash`/`shell`/`run_terminal_command`, `Read`/`read`/`read_file`, `Agent`/`subagent`/`spawn_subagent`, ...). `~substring` matches
any tool whose name contains it (MCP tools carry harness-specific prefixes). **Canonical arguments** (`command`, `path`, `agent`,
`prompt`, `name`) are mapped onto the schema's property names (`file_path`, `target_file`, `subagent_type`, ...), and required
properties you did not script are filled with `"conformance"`. `fallback: [...]` lists alternative tool calls for harnesses that
only expose a capability another way (OpenCode MCP via `execute`, Grok MCP via `use_tool`, Grok skills via `read`). A tool that
cannot be resolved becomes visible text, so a scenario fails loudly instead of hanging.

## Capture API

`createMockServer()` returns `requests` (every request with redacted headers and the normalized body) and helpers:
`sent(needle)` (anywhere in any request body), `systemIncludes(needle)`, `toolNames()`, `toolResults()`, `modelRequests()`,
`sentText()`, `reset()`. Normalized request: `{ api, model, stream, system, messages[{role,text,toolCalls,toolResults}], tools[{name,props,required,description}], userText, lastUserText, lastToolResult, rawText }`.
`dumpDir` (or `HC_DUMP=dir` for `run`) writes each request as JSON for debugging.

## Determinism and safety

No clocks, no randomness in replies; ids are sequential. The server binds `127.0.0.1` only, redacts `authorization`/`x-api-key`
in its log, and the keys the drivers pass are obvious dummies (not shaped like any real key).
