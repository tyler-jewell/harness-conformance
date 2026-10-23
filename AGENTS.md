# AGENTS.md: contract for agents and scripts

`harness-conformance` is designed to be driven by other programs.

## Invocation

`bin/harness-conformance <command> [flags]` (Node >= 22, zero dependencies). Commands: `list`, `run`, `matrix`, `mock`, `doctor`, `help`.

## Rules

- **Never prompts**, never needs a TTY, never needs credentials. No telemetry. Network: only localhost during runs.
- **`--json`** prints exactly one JSON document on stdout; progress goes to stderr. Schemas: `docs/SCHEMA.md` (`harness-conformance/*/v1`, additive changes only).
- **Never touches the real home**: every run builds a fresh sandbox. Do not point it at your real config.
- Read-only: `list`, `doctor`, `matrix`. `run` writes only to temp dirs and the `--out/--summary` files. `mock` serves until killed.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | lockstep holds |
| 1 | gating divergence (FAIL, XPASS, or NOT-INSTALLED with `--require-installed`) |
| 64 | usage error |
| 70 | internal error |

## Recipes

```sh
harness-conformance run --json | jq '.summary.gating'
harness-conformance run --harness claude --scenario S6 --json | jq '.results[0].evidence'
harness-conformance list --json | jq '.scenarios[] | select(.expect.grok.status!="PASS") | {id, grok: .expect.grok}'
harness-conformance matrix linux.json macos.json > merged.md
```

## Working on this repo

`node --test tests/` must pass (fake harness binaries, offline). Changing a scenario, expectation, flag or schema means updating
`docs/CONTRACT.md` / `docs/SCHEMA.md` and this file. Conventional Commits; sign off (`git commit -s`). No personal data, no real keys.
