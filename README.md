# harness-conformance

Do Claude Code, OpenCode, Grok Build (and Codex CLI, pi) behave the same with *your* agent setup?
This tool runs the real harness binaries against a deterministic local **mock model server**, so the answer is a
test result instead of a hunch. No API keys, no login, no network: the harnesses think they are talking to a model.

```text
real harness binary --HTTP--> mock model (localhost) --scripted tool_use--> harness executes the tool for real
                                   |
                                   +-- records everything the harness SENT (system prompt, tool list, tool results)
                                       -> scenarios assert on that: "AGENTS.md reached the model", "the .env canary did not"
```

Every scenario runs identically on every harness. A harness that lacks a feature is a documented **SKIP**, a known
bug is a tracked **XFAIL**, and any *new* divergence fails CI (**FAIL**, or **XPASS** when a tracked gap is fixed).

## 60-second quickstart

Requires Node >= 22 and at least one harness on your machine. Nothing is installed globally; every run builds a
throw-away `HOME`/`XDG_*` tree and never touches your real `~/.claude`, `~/.config/opencode` or `~/.grok`.

```sh
git clone https://github.com/tyler-jewell/harness-conformance && cd harness-conformance
node bin/harness-conformance doctor          # which harnesses were detected, versions, driver status
node bin/harness-conformance list            # the lockstep contract: scenarios x harnesses (PASS/XFAIL/SKIP)
node bin/harness-conformance run             # tier 0 + tier 1 on every detected harness (about a minute)
node bin/harness-conformance run --harness grok --scenario S6 --json   # one cell, machine-readable
node --test tests/*.test.mjs                # unit tests with FAKE harness binaries (offline, ~10 s)
```

CI-style install of pinned harness versions into `./.harnesses` (never global, checksum-verified):
`bash scripts/install-harnesses.sh`.

## Sample matrix

Real output from macOS arm64 (claude 2.1.309, grok 1.0.67, opencode 2.1.3), setup built by the sibling `agents-doctor`,
`dotfiles` bootstrap and `lsp-doctor emit`:

| Scenario | claude 2.1.309 (macos) | grok 1.0.67 (macos) | opencode 2.1.3 (macos) |
|---|---|---|---|
| **T0.1** Binary runs and reports a version | PASS | PASS | PASS |
| **T0.2** Offline listing/validation commands accept the sandbox config | PASS | PASS | PASS |
| **S1** Shared AGENTS.md content reaches the model | PASS | PASS | PASS |
| **S2** Skill from ~/.agents/skills is listed and loadable | PASS | PASS | PASS |
| **S3** Domain agents are listed to the model (coordinator: see S4, T0.2) | PASS | PASS | PASS |
| **S4** Main agent is coordinator by default (no flags) | PASS | PASS | PASS |
| **S5** Scripted read and shell tool calls execute | PASS | PASS | PASS |
| **S6** A .env canary never reaches the model | PASS | PASS | PASS |
| **S7** lsp-doctor emitted LSP servers are accepted by the harness | SKIP | PASS | PASS |
| **S8** Stdio MCP fixture tool is listed and called | PASS | PASS | PASS |
| **S9** SessionStart and UserPromptSubmit hooks run | PASS | PASS | SKIP |
| **S13** SessionStart hook stdout is injected as model context | PASS | XFAIL | SKIP |
| **S10** Delegation to a domain agent runs it with its own prompt | PASS | PASS | PASS |
| **S11** Global git hook blocks a bad commit message, allows a good one | PASS | PASS | PASS |
| **S12** No-wrangler and agent-browser policy delivered as instructions | PASS | PASS | PASS |

`SKIP` and `XFAIL` cells carry a reason (`harness-conformance list`, [docs/CONTRACT.md](docs/CONTRACT.md)).

## What "our setup" means

The sandbox is built by the **real installers** when the sibling repos are checked out next to this one
(`HC_SIBLINGS_DIR`): `agents-doctor install --apply` (agents + default-agent settings), `dotfiles` `bootstrap.sh`
(global git hooks), `lsp-doctor emit` (LSP servers). Missing pieces fall back to checked-in minimal fixtures in
`fixtures/`, so the tool also runs on a bare CI runner. The matrix records which source was used.

## Harnesses are detected, not hard-coded

`list`, `doctor` and `run` ask `harness-inventory detect --json` (schema `harness-inventory/detect/v1`) which
harnesses exist, falling back to a built-in detector with the same signature idea. `src/harnesses/*.mjs` are
**enrichment profiles** keyed by the detected name. A detected harness without a driver is reported as
`detected-no-driver` (advisory) and gets a generic Tier-0 check; Tier 1 needs a driver
([docs/ADDING-A-HARNESS.md](docs/ADDING-A-HARNESS.md)). In CI the list is explicit and pinned.

## Tiers

| Tier | What runs | Needs |
|---|---|---|
| 0 | Offline listing/validation: `--version`, `claude mcp list`, `opencode debug config/agents`, `grok inspect --json`, LSP config acceptance (S7) | the binary |
| 1 | End to end through the mock model: instructions, skills, agents, tools, secrets safety, MCP, hooks, subagents, git hooks | the binary + localhost |

## Documentation

[DESIGN](docs/DESIGN.md) | [CONTRACT](docs/CONTRACT.md) (the scenarios) | [MOCK-MODEL](docs/MOCK-MODEL.md) |
[ADDING-A-HARNESS](docs/ADDING-A-HARNESS.md) | [SCHEMA](docs/SCHEMA.md) | [THREAT-MODEL](docs/THREAT-MODEL.md) |
[TROUBLESHOOTING](docs/TROUBLESHOOTING.md) | [AGENTS.md](AGENTS.md) | [CONTRIBUTING](CONTRIBUTING.md)

## Adding this to another repo's CI

Copy [templates/conformance-caller.yml](templates/conformance-caller.yml). It calls this repo's reusable workflow,
uses the shared-config runner picker (`RUNNER_MODE`), needs no secrets and runs fork PRs on hosted runners only.

License: Apache-2.0. Contributions need a DCO sign-off (`git commit -s`).
