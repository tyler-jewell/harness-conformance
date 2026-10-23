# Adding a harness

## 1. Detection comes first (nothing is hard-coded)

`list`, `doctor` and `run` get the harness set from `harness-inventory detect --json` (`HC_HARNESS_INVENTORY=path` or on `PATH`,
or the sibling checkout), validating the `harness-inventory/detect/v1` schema. If that binary is missing or misbehaves a built-in
detector scores `~/.<name>` and `~/.config/<name>` directories: `agents/*.md` with frontmatter, `skills/*/SKILL.md`, `commands/`,
instruction files, hooks/MCP config, session stores, plus a same-named binary on `PATH` (score >= 2 to count). The harness name
is the dot-directory name, so a future `~/.zzagent` is detected as `zzagent` with no code change.

A detected harness **without a driver** is reported as `detected-no-driver` (advisory, never a failure). If its binary exists it
gets a generic Tier-0 check: `--version` and `--help` work, and headless flags (`-p`, `run`, `exec`) discoverable from `--help`
are listed as evidence. Config-dir-only detections (no binary) are summarized in a note. Tier 1 needs a driver.

In CI the harness list is explicit (`--harness`), so results are reproducible; `doctor` and the nightly drift report show
anything newly detected.

## 2. Write the driver (only when it needs special env/config for the mock endpoint)

Create `src/harnesses/<name>.mjs` (name = detected name) and register it in `src/harnesses/index.mjs`:

```js
export default {
  name: "zzagent", title: "ZZ Agent", roots: [".zzagent"], binaries: ["zzagent"], knownLocations: ["~/.zzagent/bin/zzagent"],
  versionArgs: ["--version"], parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1],
  status: "unverified",                       // flip to "verified" after a real run; unverified scenarios are ADVISORY
  pin: { kind: "npm", pkg: "zz-agent", lockDir: "pins/stretch", bin: "zzagent" },
  configure(sb, mock, spec) {},               // write NATIVE config from the canonical spec (see claude.mjs)
  env: (sb, mock) => ({}),                    // isolation + mock endpoint + telemetry off + dummy credentials
  headless: (sb, { prompt, agent }) => [],    // argv for one non-interactive turn
  parse: (stdout) => [],                      // -> [{type:"text"|"tool_call"|"tool_result"|"error"|"end", ...}]
  tier0: () => [{ id: "version", argv: ["--version"], check: (r) => ({ ok: r.code === 0, evidence: r.stdout.trim() }) }],
};
```

Rules: never read the real home; never use a real key (dummy strings only, not shaped like keys); disable telemetry and
auto-update; use only documented or observed-in-this-repo mechanisms and say which.

## 3. Find out what it can do, then fill the matrix

1. `harness-conformance run --harness zzagent` and read the failures. Most are tool-name/argument differences: extend the aliases and
   `CANON` tables in `src/mock/script.mjs`, or add a `fallback` in the scenario.
2. For every scenario set the cell in `src/expectations.mjs`: leave it PASS, or SKIP (feature absent) / XFAIL (a bug in the
   setup) **with a reason**.
3. Add the harness to `pins/harnesses.json` and an install step in `scripts/install-harnesses.sh` (official channel, pinned
   version, checksum), then to the `harnesses` input in `.github/actions/run/action.yml`.
4. Add parse/configure unit tests in `tests/drivers.test.mjs` (fake binaries, offline).

## 4. Prove it

Run all three: the new harness alone, the full matrix, and `HC_NEGATIVE=1 ... --scenario S6` (S6 must FAIL).
