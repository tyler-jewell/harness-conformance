# Contributing

- **Tests are required**: `node --test tests/*.test.mjs` (no dependencies). Node 22 and 24 try to load a directory argument as a module, so pass the test files. Unit tests use fake harness binaries (`tests/fake/`) and never touch real harnesses or a real home. Real-harness runs are `harness-conformance run`.
- **Conventional Commits** for commits and PR titles (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `ci:`), checked in CI.
- **DCO**: sign off every commit (`git commit -s`), see [DCO.md](DCO.md).
- **Contract**: a new or changed scenario needs a row in `docs/CONTRACT.md` and every harness's cell in `src/expectations.mjs`. A new divergence is fixed or recorded as XFAIL **with a reason**; never silenced.
- **Zero dependencies**, Node >= 22, ESM. Workflows: actions pinned to commit SHAs, no secrets, `actionlint` clean (`bash scripts/install-actionlint.sh`).
- **No personal data** in code, tests, docs or fixtures (names, hostnames, absolute home paths, tokens). `tests/policy.test.mjs` enforces the basics.
- New harness: [docs/ADDING-A-HARNESS.md](docs/ADDING-A-HARNESS.md).
