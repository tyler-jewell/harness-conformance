#!/bin/bash
# Test runner wrapper for harness-conformance.
# Matches the convention used by 5 other Node.js CLI repos.
set -euo pipefail
exec node --test tests/*.test.mjs "$@"