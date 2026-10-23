// The lockstep matrix as DATA. Each cell is one of:
//   PASS      required: a failure fails CI
//   XFAIL     tracked divergence: must fail; if it starts passing CI fails (XPASS) so the entry gets removed
//   SKIP      the harness lacks the feature; documented known gap, not run
//   ADVISORY  run and reported, never gating (unverified drivers, harnesses without a driver)
// A cell may be a string or {status, reason, linux, macos} for per-OS overrides. Anything not listed defaults to
// PASS for verified drivers and ADVISORY otherwise. Change this file in the same PR that changes behavior.
export const EXPECT = {
  "T0.1": {},
  "T0.2": {},
  S1: {},
  S2: {},
  S3: {},
  S4: {},
  S5: {},
  S6: {},
  S7: {
    claude: { status: "SKIP", reason: "Claude Code takes LSP servers only from plugins (.lsp.json); there is no user-level LSP config for `lsp-doctor emit` to target (emit --format claude is marked UNVERIFIED upstream)" },
  },
  S8: {},
  S9: {
    opencode: { status: "SKIP", reason: "OpenCode 2 has no declarative command-hook config (SessionStart/UserPromptSubmit); hooks are JS plugins (agents-doctor ships an unverified opencode plugin)" },
  },
  S13: {
    opencode: { status: "SKIP", reason: "no command hooks (see S9)" },
    grok: { status: "XFAIL", reason: "grok discards hook stdout for allowing hooks (verified 1.0.67: hook runs, output never reaches the model); agents-doctor documents the same gap" },
  },
  S10: {},
  S11: {},
  S12: {},
};

export function expectationFor(scenarioId, harness, driver, os) {
  const cell = EXPECT[scenarioId]?.[harness];
  const norm = (c) => (typeof c === "string" ? { status: c } : c);
  if (cell) {
    const c = norm(cell);
    const perOs = c[os] ? norm(c[os]) : null;
    return { reason: "", ...c, ...(perOs || {}) };
  }
  if (!driver) return { status: "ADVISORY", reason: "harness detected but has no driver" };
  if (driver.status !== "verified") return { status: "ADVISORY", reason: "driver unverified: written from docs, never run against the real binary yet" };
  return { status: "PASS", reason: "" };
}
