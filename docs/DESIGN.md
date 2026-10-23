# Design

## Goal

"All harnesses should act the same with our setup." The setup is a set of independent tools (global git hooks and config,
cross-harness agent definitions, skills, LSP configs, MCP servers, hooks, a shared `AGENTS.md`). This repo proves that the
*real harness binaries* load that setup the same way and behave the same way, without any model access.

## Why a mock model is the right seam

A harness is a loop: build a request (system prompt from instruction files, tool list from built-ins + MCP + agents + skills),
call a model, execute the tool calls it gets back, repeat. Everything the setup influences is either **in the request** or
**in what happens when a tool call comes back**. A scripted fake model therefore (1) lets us assert on the request contents
deterministically and (2) forces the harness to really execute tools, hooks, subagents and MCP calls. No quality of model
output is involved, so the tests cannot flake on model behavior.

## How each harness is pointed at the mock (no credentials)

| Harness | Mechanism (verified on the version in `pins/`) |
|---|---|
| Claude Code | `ANTHROPIC_BASE_URL=<mock>` + a dummy `ANTHROPIC_API_KEY` (init reports `apiKeySource: ANTHROPIC_API_KEY`); `hasCompletedOnboarding` in `~/.claude.json`; `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`; headless `-p --output-format stream-json --verbose --permission-mode bypassPermissions --model mock-model` |
| OpenCode 2 | `opencode.json` custom provider `npm: @ai-sdk/openai-compatible`, `options.baseURL`, `models`; `autoupdate:false`, `share:"disabled"`; headless `run --standalone --format json --auto`; own `XDG_*` tree; **the managed background service defaults to a fixed port (49374) shared with the real install, so the sandbox writes `service.json` with its own port** |
| Grok Build | `~/.grok/config.toml`: `[model.mock]` with `base_url`, `env_key`, `api_backend = "chat_completions"` (also `"responses"`, `"messages"`), `[models] default`, `[features] remote_fetch = false`; `GROK_HOME`, `GROK_TELEMETRY_ENABLED=0`; headless `-p --output-format streaming-json --permission-mode bypassPermissions --trust -m mock`. No login needed when the model has its own `env_key` |
| Codex CLI (unverified) | `CODEX_HOME`, `config.toml` `model_provider` + `[model_providers.mock] base_url, env_key, wire_api = "responses"`; `codex exec --json` |
| pi (unverified) | `~/.pi/agent/models.json` custom provider; `pi -p` |

## Layers

```
bin/harness-conformance        CLI (list, run, matrix, mock, doctor)
src/detect.mjs                 harness detection (harness-inventory, else built-in); detected-no-driver
src/harnesses/<name>.mjs       enrichment profile + driver: native config writer, env, headless argv, output parser, tier-0 commands
src/sandbox.mjs, setup.mjs     fresh HOME/XDG per run; real installers (agents-doctor, dotfiles, lsp-doctor) else fixtures; needles from installed files
src/mock/                      mock model: wire formats, script DSL, capture API
src/scenarios/index.mjs        the contract (S1..S13, T0.x)
src/expectations.mjs           PASS/XFAIL/SKIP/ADVISORY per scenario x harness
src/runner.mjs, report.mjs     execution, classification, matrix JSON + Markdown
```

A **canonical setup spec** (main agent, instruction file, agents, skills, deny rules, hook, MCP server, LSP servers) is built once
and each driver translates it into that harness's *native* files. The scenarios never mention a harness.

## Determinism and isolation

- Every run: `mkdtemp` sandbox with `HOME`, `XDG_*`, project dir, `GIT_CONFIG_NOSYSTEM=1`; harness env is built from scratch (`env -i` semantics), never inherits the caller's environment.
- One mock per harness run on an ephemeral port; scripts swapped per scenario; capture reset per prompt.
- Canary strings are fixed (fixtures) or derived from the installed agent files (real `agents` repo); the secret canary is random per run.
- Background processes (OpenCode service) are stopped in `cleanup`; process groups are killed on timeout.

## What is deliberately not tested

Model quality, prompt-following, real provider auth, streaming edge cases of real models, Windows, interactive TUIs, and the
LSP handshake itself (lsp-doctor owns that; here only "the harness accepts and lists the config").

## Reproducibility and drift

CI installs **pinned** versions (`pins/`: npm lockfiles with sha512 integrity; Grok sha256 per platform) and passes the harness
list explicitly. A nightly workflow installs the **latest** versions and opens one issue when the matrix diverges. Dependabot bumps
the npm pins and actions; `bump-pins.yml` bumps Grok.
