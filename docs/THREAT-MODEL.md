# Threat model

## What we run

Third-party agent binaries, with shell tools enabled, driven by a scripted server, on CI runners and on a developer machine.
The scripts include deliberately hostile steps (read a `.env`, `cat` it, commit with a bad message).

## Assets and rules

| Asset | Rule |
|---|---|
| Model provider credentials | **None exist.** No secret is stored in GitHub; workflows reference no `secrets.*` except the job's own `GITHUB_TOKEN`. Harnesses get dummy strings that are not shaped like real keys. A test (`tests/policy.test.mjs`) fails the build if a workflow references any other secret. |
| The developer's real config and sessions | Every run uses a fresh `HOME`/`XDG_*`; harness env is built from scratch. OpenCode's managed service port is overridden so it cannot attach to a real service. Unit tests use fake binaries. |
| The CI runner / self-hosted Studio | Fork PRs: `pull_request` only (never `pull_request_target`), `contents: read`, hosted runners only; the Studio legs require `selfhosted == 'true'` from the picker **and** a non-fork head repo. Dedicated unprivileged runner user per shared-config `docs/RUNNERS.md`. |
| Network | Harness traffic goes to `127.0.0.1`. Telemetry and auto-update are disabled per harness (variables listed in `docs/DESIGN.md`). CI downloads only: npm registry, `x.ai/cli`, GitHub (actions, sibling repos, actionlint). The harness *could* reach out anyway (web fetch tools exist); scripts never call those tools. |
| Supply chain | Actions pinned to commit SHAs. npm harnesses installed with `npm ci` against committed lockfiles (sha512 per platform package), install scripts disabled, then only the pinned packages' postinstall is run via `npm rebuild <pkg>`. Grok binary verified against a pinned sha256 (x.ai publishes none; the value is trust-on-first-use from a manual download, re-recorded by `bump-pins.yml`). actionlint is downloaded from its release with a pinned sha256. Sibling repos are checked out at refs in `pins/harnesses.json` (pin commit SHAs once published). |
| The `agents-doctor` / `dotfiles` installers | Executed from sibling checkouts with `HOME` set to the sandbox and no sudo. A compromised sibling could run code on the runner: same trust level as running that repo's own CI. |
| Caches | Only the npm cache (`setup-node`) is cached by default; harness binaries are reinstalled and re-verified each run. |
| Secrets safety scenario | The canary is random per run and lives only in the sandbox `.env`. The scenario asserts it never appears in any request the mock received or in harness output. Denial is by the setup's deny rules (Claude `permissions.deny`, OpenCode `permission`, Grok `[permission] deny`); pattern-based Bash denial is bypassable by a determined model (`base64 .env`, `python -c`), which this contract does not claim to cover. |

## Issue/PR automation

`nightly.yml` and `bump-pins.yml` use `GITHUB_TOKEN` with the minimum scopes (`issues: write`; `contents`+`pull-requests: write`) in the job that needs them. Untrusted event fields are never interpolated into `run:` blocks (policy test).

## Reporting

See [SECURITY.md](../SECURITY.md).
