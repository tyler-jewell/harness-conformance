# Schemas

All JSON documents carry a `schema` string. Changes within a version are additive only.

## `harness-conformance/matrix/v1` (`run --json`, `--out`, `matrix --format json`)

```jsonc
{
  "schema": "harness-conformance/matrix/v1",
  "generatedAt": "2026-10-23T20:00:00.000Z",
  "host": { "os": "macos", "arch": "arm64", "node": "v22.0.0" },       // array in merged matrices
  "scenarios": [ { "id": "S1", "slug": "instruction-file", "title": "...", "tier": 1 } ],
  "harnesses": [ {
    "name": "grok", "source": "harness-inventory|builtin|explicit", "driver": "grok", "driverStatus": "verified",
    "status": "driver|detected-no-driver", "binary": "/abs/path", "binaryVia": "env|pinned|PATH|known-location",
    "version": "1.0.67", "confidence": "confirmed", "roots": [], "setup": ["agents-doctor install --apply ...: exit 0"],
    "os": "macos", "arch": "arm64"
  } ],
  "results": [ {
    "scenario": "S6", "harness": "grok", "os": "macos", "arch": "arm64", "tier": 1,
    "expected": "PASS|XFAIL|SKIP|ADVISORY", "reason": "", "actual": "pass|fail|skip|not-installed",
    "status": "PASS|FAIL|XFAIL|XPASS|SKIP|ADVISORY-PASS|ADVISORY-FAIL|NOT-INSTALLED",
    "evidence": ["human-readable assertion lines"], "ms": 1234
  } ],
  "summary": { "counts": { "PASS": 41 }, "gating": [ "S6/grok/macos: FAIL" ] },   // gating = FAIL, XPASS (+ NOT-INSTALLED with --require-installed)
  "notes": []
}
```

## `harness-conformance/list/v1` (`list --json`)

`{ schema, os, scenarios: [ { id, slug, tier, title, expect: { <harness>: { status, reason } } } ] }`.

## `harness-conformance/doctor/v1` (`doctor --json`)

`{ schema, inventory, detection, harnesses: [ { name, status, source, confidence, binary, via, version, driverStatus, roots } ], notInstalled: [] }`.

## `harness-conformance/pins/v1` (`pins/harnesses.json`)

npm harnesses (`package`, `version`, `lock`), `grok` (`version`, `artifact` URL template, `sha256` per `os-arch`), `siblings`
(repo + ref of dotfiles, agents, lsp-doctor, harness-inventory).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | lockstep holds (no FAIL / XPASS; NOT-INSTALLED allowed unless `--require-installed`) |
| 1 | gating divergence |
| 64 | usage error |
| 70 | internal error |

## Environment

`HC_BIN_<NAME>` binary override; `HC_SIBLINGS_DIR` sibling repos; `HC_HARNESS_INVENTORY` detect binary; `HC_NO_INVENTORY=1`;
`HC_HERMETIC=1` (only PATH/pinned binaries; used by tests); `HC_TMPDIR`; `HC_KEEP=1` keep sandboxes; `HC_DUMP=dir` dump mock
requests; `HC_NEGATIVE=1` negative control; `HC_NO_SIBLINGS=1`.
