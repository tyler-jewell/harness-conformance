# Changelog

All notable changes are recorded here. Format: Keep a Changelog; versions follow SemVer.

## [Unreleased]

### Added
- Mock model server (Anthropic Messages, OpenAI chat/completions, OpenAI Responses) with a scripting DSL and capture API.
- Harness detection via `harness-inventory detect --json` with a built-in fallback; `detected-no-driver` advisory.
- Drivers: Claude Code, OpenCode 2, Grok Build (verified); Codex CLI, pi (unverified, advisory).
- Lockstep contract scenarios T0.1, T0.2, S1-S13 with PASS/XFAIL/SKIP/ADVISORY expectations.
- Matrix JSON (`harness-conformance/matrix/v1`) and Markdown job summary.
- Workflows: conformance (reusable), nightly drift, pin bump; dependabot; caller template.
