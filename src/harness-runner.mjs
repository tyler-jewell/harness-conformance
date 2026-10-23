// Binds a driver + binary + sandbox + mock into the small API scenarios use (ctx.h).
import { run } from "./proc.mjs";
import path from "node:path";
import { redact } from "./util.mjs";

export class HarnessRunner {
  constructor({ driver, binary, sb, mock }) {
    Object.assign(this, { driver, binary, sb, mock });
    this.last = null;
    this.trace = [];
  }
  env() {
    const e = { ...this.sb.env, ...this.driver.env(this.sb, this.mock) };
    e.PATH = [path.dirname(this.binary), e.PATH].join(path.delimiter);
    return e;
  }
  async cmd(argv, { timeoutMs = 60_000 } = {}) {
    const r = await run(this.binary, argv, { env: this.env(), cwd: this.sb.work, timeoutMs });
    this.trace.push({ argv: argv.map((a) => (a.length > 60 ? a.slice(0, 57) + "..." : a)), code: r.code, ms: r.ms, timedOut: r.timedOut });
    return r;
  }
  // One headless turn against the mock with the given script. Capture is reset first.
  async prompt(text, { script, agent, timeoutMs = 150_000 } = {}) {
    this.mock.reset();
    this.mock.setScript(script || { rules: [] });
    const r = await this.cmd(this.driver.headless(this.sb, { prompt: text, agent }), { timeoutMs });
    this.last = { ...r, stdout: r.stdout, stderr: r.stderr, events: this.driver.parse(r.stdout, r.stderr) };
    return this.last;
  }
  describeLast() {
    const l = this.last;
    if (!l) return "";
    return redact(`exit=${l.code}${l.timedOut ? " TIMEOUT" : ""} events=${l.events.length} mockRequests=${this.mock.modelRequests().length} stderr=${l.stderr.trim().slice(0, 200)}`);
  }
}
