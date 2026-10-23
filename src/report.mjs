// Matrix JSON (schema harness-conformance/matrix/v1) and its Markdown rendering for the GitHub job summary.
import { GATING } from "./runner.mjs";
import { hostInfo } from "./sandbox.mjs";

export const SCHEMA = "harness-conformance/matrix/v1";

export function buildMatrix({ results, meta, scenarios, detectNotes = [] }, extra = {}) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    host: hostInfo(),
    scenarios: scenarios.map((s) => ({ id: s.id, slug: s.slug, title: s.title, tier: s.tier })),
    harnesses: meta.map((m) => ({ ...m, os: hostInfo().os, arch: hostInfo().arch })),
    results,
    summary: { counts, gating: results.filter((r) => GATING.has(r.status)).map((r) => `${r.scenario}/${r.harness}/${r.os}: ${r.status}`) },
    notes: detectNotes,
    ...extra,
  };
}

export function mergeMatrices(list) {
  const out = { schema: SCHEMA, generatedAt: new Date().toISOString(), host: list.map((m) => m.host), scenarios: [], harnesses: [], results: [], notes: [], summary: { counts: {}, gating: [] } };
  const seen = new Set();
  for (const m of list) {
    for (const s of m.scenarios) if (!seen.has(s.id)) (seen.add(s.id), out.scenarios.push(s));
    out.harnesses.push(...m.harnesses);
    out.results.push(...m.results);
    out.notes.push(...(m.notes || []));
  }
  for (const r of out.results) {
    out.summary.counts[r.status] = (out.summary.counts[r.status] || 0) + 1;
    if (GATING.has(r.status)) out.summary.gating.push(`${r.scenario}/${r.harness}/${r.os}: ${r.status}`);
  }
  return out;
}

const cell = (r) => (r ? r.status : "-");

export function renderMarkdown(m) {
  const cols = [...new Map(m.results.map((r) => [`${r.harness}@${r.os}${r.arch && r.arch !== "arm64" && r.arch !== "x64" ? "" : ""}`, { harness: r.harness, os: r.os }])).values()];
  const verOf = (h, os) => m.harnesses.find((x) => x.name === h && (x.os === os || !x.os))?.version ?? "";
  const lines = [];
  lines.push("## Harness conformance matrix", "");
  const c = m.summary.counts;
  lines.push(`Result: ${m.summary.gating.length === 0 ? "**lockstep holds**" : `**${m.summary.gating.length} gating divergence(s)**`}  (${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ")})`, "");
  lines.push("| Scenario | " + cols.map((x) => `${x.harness} ${verOf(x.harness, x.os)} (${x.os})`).join(" | ") + " |");
  lines.push("|---|" + cols.map(() => "---").join("|") + "|");
  for (const s of m.scenarios) {
    lines.push(`| **${s.id}** ${s.title} | ` + cols.map((x) => cell(m.results.find((r) => r.scenario === s.id && r.harness === x.harness && r.os === x.os))).join(" | ") + " |");
  }
  lines.push("", "Legend: PASS required and passing; FAIL required and failing (gates CI); XFAIL tracked divergence, still failing; XPASS tracked divergence now passes (gates CI: remove the XFAIL entry); SKIP known gap, not run; ADVISORY-PASS/ADVISORY-FAIL reported, never gating; NOT-INSTALLED harness absent; `-` not applicable.", "");
  if (m.summary.gating.length) lines.push("### Gating divergences", "", ...m.summary.gating.map((g) => `- ${g}`), "");
  const interesting = m.results.filter((r) => ["FAIL", "XPASS", "XFAIL", "SKIP", "ADVISORY-FAIL"].includes(r.status));
  if (interesting.length) {
    lines.push("### Divergence and gap details", "", "| Scenario | Harness | OS | Status | Why |", "|---|---|---|---|---|");
    for (const r of interesting) lines.push(`| ${r.scenario} | ${r.harness} | ${r.os} | ${r.status} | ${[r.reason, ...(r.status === "FAIL" || r.status === "XPASS" ? r.evidence : [])].filter(Boolean).join(" / ").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 300)} |`);
    lines.push("");
  }
  const detected = m.harnesses.filter((h) => h.status === "detected-no-driver");
  if (detected.length) lines.push("### Detected without a driver (advisory)", "", ...detected.map((h) => `- ${h.name}: ${h.confidence ?? "?"} confidence; add src/harnesses/${h.name}.mjs for Tier 1 (see docs/ADDING-A-HARNESS.md)`), "");
  for (const n of m.notes || []) lines.push(`> ${n}`);
  return lines.join("\n") + "\n";
}
