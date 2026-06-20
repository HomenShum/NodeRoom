#!/usr/bin/env node
// build-skill-index.mjs — ingest Agent Skills into a retrievable catalog index.
//
// Walks local skill dirs (and optionally a cloned external catalog + a seed file),
// parses each SKILL.md frontmatter, and emits skill-index.json — the records that
// `skill_search` retrieves over (and that `indexSkillFromCatalog` turns into OKF
// concepts of type "Agent Skill"). Node ESM, zero dependencies.
//
//   node build-skill-index.mjs [--skills .claude/skills] [--catalog <dir> --trust community]
//                              [--seed seed.json] [--out <path>]
//
// See format.md for the record schema.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const a = { skills: ".claude/skills", catalog: null, trust: "community", seed: null,
              out: "src/nodeagent/okf/skillCatalog/skill-index.json" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--skills") a.skills = argv[++i];
    else if (k === "--catalog") a.catalog = argv[++i];
    else if (k === "--trust") a.trust = argv[++i];
    else if (k === "--seed") a.seed = argv[++i];
    else if (k === "--out") a.out = argv[++i];
  }
  return a;
}

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineList(v) {
  const t = v.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    return t.slice(1, -1).split(",").map((x) => stripQuotes(x)).filter(Boolean);
  }
  return [];
}

// Minimal YAML frontmatter reader: top-level `key: value` + inline `[a, b]` lists.
function readFrontmatter(text) {
  const src = text.replace(/^﻿/, "");
  if (!/^---\s*\r?\n/.test(src)) return {};
  const rest = src.slice(src.indexOf("\n") + 1);
  const end = rest.search(/\r?\n---\s*(\r?\n|$)/);
  if (end === -1) return {};
  const block = rest.slice(0, end);
  const fm = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (val.trim().startsWith("[")) fm[key] = parseInlineList(val);
    else fm[key] = stripQuotes(val);
  }
  return fm;
}

function sha256(s) {
  return "sha256:" + crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

function rel(p) {
  return path.relative(process.cwd(), p).split(path.sep).join("/");
}

function recordFromSkillDir(dir, { trust, kind }) {
  const skillMd = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillMd)) return null;
  const text = fs.readFileSync(skillMd, "utf8");
  const fm = readFrontmatter(text);
  const slug = path.basename(dir);
  const categories = Array.isArray(fm.categories) ? fm.categories
    : Array.isArray(fm.tags) ? fm.tags : [];
  return {
    slug,
    name: fm.name || slug,
    description: fm.description || "",
    categories,
    trust,
    source: { kind, path: rel(skillMd), url: null },
    install: rel(dir),
    contentHash: sha256(text),
    license: fm.license || null,
    indexedAt: null, // stamped by caller (no Date in deterministic contexts)
  };
}

function walkSkillDirs(root, opts) {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith("_") || ent.name.startsWith(".")) continue;
    const rec = recordFromSkillDir(path.join(root, ent.name), opts);
    if (rec) out.push(rec);
  }
  return out;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const records = [];

  // 1. Local skills (highest trust)
  records.push(...walkSkillDirs(a.skills, { trust: "local", kind: "local" }));

  // 2. Optional cloned external catalog
  if (a.catalog) {
    records.push(...walkSkillDirs(a.catalog, { trust: a.trust, kind: "catalog" }));
  }

  // 3. Optional seed of remote skills (records with at least name + description)
  if (a.seed && fs.existsSync(a.seed)) {
    const seed = JSON.parse(fs.readFileSync(a.seed, "utf8"));
    for (const s of Array.isArray(seed) ? seed : []) {
      if (!s.name || !s.description) continue;
      records.push({
        slug: s.slug || s.name,
        name: s.name,
        description: s.description,
        categories: s.categories || [],
        trust: s.trust || "untrusted",
        source: s.source || { kind: "url", path: null, url: s.url || null },
        install: s.install || s.url || null,
        contentHash: s.contentHash || sha256(s.name + s.description),
        license: s.license || null,
        indexedAt: null,
      });
    }
  }

  // Dedup by slug, first writer wins (local > catalog > seed by push order)
  const seen = new Set();
  const deduped = records.filter((r) => (seen.has(r.slug) ? false : seen.add(r.slug)));

  const outDir = path.dirname(a.out);
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(a.out, JSON.stringify(deduped, null, 2) + "\n", "utf8");

  const byTrust = deduped.reduce((m, r) => ((m[r.trust] = (m[r.trust] || 0) + 1), m), {});
  const missingDesc = deduped.filter((r) => !r.description).map((r) => r.slug);
  console.log(`Wrote ${a.out} — ${deduped.length} skills (${JSON.stringify(byTrust)}).`);
  if (missingDesc.length) {
    console.log(`⚠ ${missingDesc.length} skill(s) have an EMPTY description (undiscoverable): ${missingDesc.join(", ")}`);
  }
}

main();
