# Troubleshooting

**`NOT-INSTALLED` for a harness I have.** Binary lookup order: `HC_BIN_<NAME>`, `./.harnesses` (pinned install), `PATH`, well-known
locations (`~/.local/bin/claude`, `~/.opencode/bin/opencode`, `~/.grok/bin/grok`). `harness-conformance doctor` shows what was found.

**A cell fails; what did the harness send?** `HC_DUMP=/tmp/dump harness-conformance run --harness X --scenario S5` writes every
request the mock received as JSON (system prompt, tools, messages). `HC_KEEP=1` keeps the sandbox (`HOME`, config, hook log).
`harness-conformance mock --dump DIR` runs the server by hand.

**OpenCode: `debug agents` is empty / `Managed service port ... already in use`.** OpenCode 2 loads config lazily in a background
service; the first calls can return `[]` (T0.2 polls for ~12 s). The default port 49374 belongs to your real install: the driver
writes `service.json` with a free port and stops the service in `cleanup`. If a run is killed, `pgrep -fl "opencode serve --service"`
and check `HOME=` of the process before killing anything.

**Grok: project instructions missing.** Folder trust. The driver passes `--trust`; running by hand needs `grok --trust`.

**Grok: "No user is available to approve this command".** Bash deny rules make Grok refuse commands it cannot parse (`$?`, `$(...)`,
`$((...))`). Keep scenario commands free of shell expansion.

**Claude: MCP tool not in the tool list.** MCP tools are deferred behind `ToolSearch`; the driver sets `ENABLE_TOOL_SEARCH=false`.

**Everything passes but I expected a failure.** Run the negative control: `HC_NEGATIVE=1 harness-conformance run --scenario S6` must FAIL
everywhere. A scenario that cannot fail is a bug.

**XPASS.** A tracked divergence (XFAIL) started passing: good news; delete the entry in `src/expectations.mjs` in the same PR.

**Siblings.** `HC_SIBLINGS_DIR` (default: the parent directory of this repo) is searched for `agents/bin/agents-doctor`,
`dotfiles/bootstrap.sh`, `lsp-doctor/bin/lsp-doctor`. `--no-siblings` forces the fixtures. The matrix `harnesses[].setup` lists what ran.

**Linux/CI only failures.** Run `bash scripts/install-harnesses.sh` and `node bin/harness-conformance run --require-installed` in a
Linux container with the same Node major; compare `versions.json` in `.harnesses/`.
