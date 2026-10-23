import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../src/util.mjs";

export const FAKE_CLAUDE = path.join(ROOT, "tests/fake/fake-claude.mjs");
const made = [];
process.on("exit", () => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
export const tmp = (p = "hc-test-") => {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), p));
  made.push(d);
  return d;
};
// A tiny wrapper script so the "binary" is directly executable with a stable absolute path.
export function fakeBin(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, { mode: 0o755 });
  return p;
}
export function parseSse(text) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((b) => {
      const ev = /^event: (.*)$/m.exec(b)?.[1];
      const data = /^data: (.*)$/m.exec(b)?.[1];
      return { event: ev, data: data === "[DONE]" ? "[DONE]" : JSON.parse(data) };
    });
}
export async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
