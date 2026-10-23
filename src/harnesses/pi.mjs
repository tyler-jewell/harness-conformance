// pi (pi-coding-agent) driver. UNVERIFIED on the author's machine; written against its docs
// (~/.pi/agent/models.json custom providers, `pi -p`). Scenarios are ADVISORY until a CI run verifies them.
import path from "node:path";
import { writeFile, symlink, DUMMY_KEY } from "./common.mjs";

export default {
  name: "pi",
  title: "pi",
  roots: [".pi"],
  binaries: ["pi"],
  knownLocations: [],
  versionArgs: ["--version"],
  parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1] ?? null,
  status: "unverified",
  pin: { kind: "npm", pkg: "@earendil-works/pi-coding-agent", lockDir: "pins/stretch", bin: "pi" },

  configure(sb, mock, spec) {
    const a = path.join(sb.home, ".pi/agent");
    symlink(spec.instruction, path.join(a, "AGENTS.md"));
    writeFile(
      path.join(a, "models.json"),
      JSON.stringify({ providers: { mock: { baseUrl: `${mock.url}/v1`, api: "openai-completions", apiKey: DUMMY_KEY, models: [{ id: "mock-model" }] } } }, null, 2),
    );
  },
  env: (sb) => ({ PI_CODING_AGENT_DIR: path.join(sb.home, ".pi/agent"), PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" }),
  headless: (sb, { prompt }) => ["--provider", "mock", "--model", "mock-model", "-p", prompt],
  parse: (stdout) => (stdout.trim() ? [{ type: "text", text: stdout.trim() }, { type: "end", ok: true }] : []),
  tier0: () => [{ id: "version", argv: ["--version"], check: (r) => ({ ok: r.code === 0 && /\d+\.\d+\.\d+/.test(r.stdout + r.stderr), evidence: (r.stdout + r.stderr).trim().split("\n")[0] }) }],
};
