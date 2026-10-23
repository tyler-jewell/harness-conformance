#!/usr/bin/env node
// Check x.ai's stable channel; when newer than pins/harnesses.json, download every platform artifact (the files the
// official installer fetches), record sha256 values in pins/harnesses.json, and print `changed=true` / `version=X`
// in GITHUB_OUTPUT format. No dependencies.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../pins/harnesses.json");
const pins = JSON.parse(fs.readFileSync(file, "utf8"));
const get = async (url) => {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
};
const stable = (await (await get("https://x.ai/cli/stable")).text()).split("\n")[0].trim();
if (!/^\d+\.\d+\.\d+(-[A-Za-z0-9._]+)?$/.test(stable)) throw new Error(`unexpected stable channel value: ${stable}`);
if (stable === pins.grok.version) {
  console.log("changed=false");
  process.exit(0);
}
const sha256 = {};
for (const plat of Object.keys(pins.grok.sha256)) {
  const hash = crypto.createHash("sha256");
  const r = await get(pins.grok.artifact.replace("{version}", stable).replace("{os}-{arch}", plat));
  for await (const chunk of r.body) hash.update(chunk);
  sha256[plat] = hash.digest("hex");
}
pins.grok = { ...pins.grok, version: stable, sha256 };
fs.writeFileSync(file, JSON.stringify(pins, null, 2) + "\n");
console.log("changed=true");
console.log(`version=${stable}`);
