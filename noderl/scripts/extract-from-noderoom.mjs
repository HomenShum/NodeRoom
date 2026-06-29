#!/usr/bin/env node
// Generate the public NodeRL package sources from the canonical NodeRoom repo.
//
// The packages are NOT a hand-maintained fork: their src/*.ts is generated from the live source
// listed in MANIFEST.json, so it never drifts. Re-run after the source changes.
//
// Usage:
//   node noderl/scripts/extract-from-noderoom.mjs --src <noderoom-repo-root> [--dry-run]
//
// --dry-run lists what WOULD be copied and flags any missing source files (verification only).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const noderlRoot = resolve(here, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const srcRoot = resolve(optionValue("--src") ?? resolve(noderlRoot, ".."));

const manifest = JSON.parse(readFileSync(join(noderlRoot, "MANIFEST.json"), "utf8"));
let copied = 0;
let missing = 0;

for (const [pkg, spec] of Object.entries(manifest.packages)) {
  for (const rel of spec.files) {
    const from = join(srcRoot, spec.from, rel);
    const to = join(noderlRoot, spec.to, rel);
    if (!existsSync(from)) {
      console.error(`MISSING  ${pkg}: ${spec.from}/${rel}`);
      missing++;
      continue;
    }
    console.log(`${dryRun ? "would copy" : "copy     "} ${pkg}: ${spec.from}/${rel} -> ${spec.to}/${rel}`);
    if (!dryRun) {
      let body = readFileSync(from, "utf8");
      body = applyStrips(`${spec.to}/${rel}`, body);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, body, "utf8");
    }
    copied++;
  }
}

console.log(`\n${dryRun ? "[dry-run] " : ""}${copied} file(s) ${dryRun ? "resolved" : "generated"}, ${missing} missing.`);
if (missing > 0) {
  console.error("Manifest references files that no longer exist in the source — update MANIFEST.json.");
  process.exit(1);
}

function applyStrips(destRel, body) {
  for (const s of manifest.strip ?? []) {
    if (s.file === destRel && body.includes(s.find)) {
      body = body.split(s.find).join(s.replace);
      console.log(`  strip    ${destRel}: "${s.find}" -> "${s.replace}"`);
    }
  }
  return body;
}

function optionValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}
