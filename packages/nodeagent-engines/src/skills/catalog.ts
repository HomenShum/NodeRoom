/**
 * Skill discovery over a workspace. Active skills: <ws>/.claude/skills/<name>/SKILL.md
 * (Agent Skills format). Drafts: <ws>/skill-drafts/<name>/. Read-only.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SkillEntry } from "../api.js";
import { resolveInside, toRel } from "../tools/workspaceFs.js";

export const ACTIVE_DIR = ".claude/skills";
export const DRAFTS_DIR = "skill-drafts";
export const LEDGER_FILE = "skills-ledger.json";
const MAX_FILES = 1000;
const MAX_SKILLS = 200;
const MAX_SKILL_MD = 256 * 1024;

export interface SkillMeta {
  name?: string;
  description?: string;
  allowedTools?: string[];
  fields: Record<string, string>;
}

function unquote(v: string): string {
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, v.endsWith('"') ? -1 : undefined);
    }
  }
  if (v.startsWith("'")) return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  return v;
}

/** Tools like `Read, Grep`, `[Read, Grep]`, `Read Bash(node:*)`. */
function toolList(v: string): string[] {
  return v.match(/[^\s,()[\]]+(?:\([^)]*\))?/g) ?? [];
}

/** Minimal YAML frontmatter: scalars, quoted scalars, `>`/`|` blocks, `- item` lists. No deps. */
export function parseFrontmatter(text: string): { meta: SkillMeta; body: string } | null {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fields: Record<string, string> = {};
  let allowedTools: string[] | undefined;
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):(?:\s+(.*))?$/);
    if (!kv) continue;
    const key = kv[1];
    const val = (kv[2] ?? "").trim();
    if (val === "") {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^\s*-\s+/, "").trim()));
      fields[key] = items.join(", ");
      if (key === "allowed-tools") allowedTools = items;
      continue;
    }
    if (/^[>|][+-]?$/.test(val)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      fields[key] = (val.startsWith(">") ? block.join(" ").replace(/\s+/g, " ") : block.join("\n")).trim();
      continue;
    }
    fields[key] = unquote(val);
    if (key === "allowed-tools") allowedTools = toolList(fields[key]);
  }
  const body = text.replace(/^﻿/, "").slice(m[0].length);
  return { meta: { name: fields.name, description: fields.description, allowedTools, fields }, body };
}

/** Sorted forward-slash relative paths of regular files under `dir` (symlinks skipped, bounded). */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      if (out.length >= MAX_FILES) return;
      const a = path.join(abs, n);
      const r = rel ? `${rel}/${n}` : n;
      const st = lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

/** Canonical content hash: sorted relative paths, each with its bytes. */
export function hashDir(dir: string): string {
  const h = createHash("sha256");
  for (const rel of listFiles(dir)) {
    const buf = readFileSync(path.join(dir, rel));
    h.update(`${rel}\0${buf.length}\0`);
    h.update(buf);
    h.update("\0");
  }
  return h.digest("hex");
}

export const SKILL_NAME_LOOSE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function activatedByNode(nodeStateDir?: string): Set<string> {
  if (!nodeStateDir) return new Set();
  try {
    const ledger = JSON.parse(readFileSync(path.join(nodeStateDir, LEDGER_FILE), "utf8")) as { skills?: Record<string, { activations?: unknown[] }> };
    return new Set(Object.entries(ledger.skills ?? {}).filter(([, v]) => (v.activations?.length ?? 0) > 0).map(([k]) => k));
  } catch {
    return new Set();
  }
}

function readEntries(workspaceDir: string, sub: string, status: SkillEntry["status"], created: Set<string>): SkillEntry[] {
  const root = resolveInside(workspaceDir, sub);
  if (!root || !existsSync(root)) return [];
  const out: SkillEntry[] = [];
  for (const dirName of readdirSync(root).sort()) {
    if (out.length >= MAX_SKILLS) break;
    const dir = path.join(root, dirName);
    const md = path.join(dir, "SKILL.md");
    if (!lstatSync(dir).isDirectory() || !existsSync(md) || lstatSync(md).size > MAX_SKILL_MD) continue;
    const fm = parseFrontmatter(readFileSync(md, "utf8"));
    out.push({
      name: fm?.meta.name ?? dirName,
      description: fm?.meta.description ?? "",
      path: toRel(workspaceDir, md),
      sha256: hashDir(dir),
      status,
      origin: status === "draft" || created.has(dirName) ? "created" : "template",
    });
  }
  return out;
}

/**
 * Active skills then drafts. Origin is "created" for drafts and for active skills
 * the ledger shows Node activated; otherwise "template".
 */
export function listSkills(workspaceDir: string, nodeStateDir?: string): SkillEntry[] {
  const created = activatedByNode(nodeStateDir);
  return [...readEntries(workspaceDir, ACTIVE_DIR, "active", created), ...readEntries(workspaceDir, DRAFTS_DIR, "draft", created)];
}

/** Rank active skills by query-term hits (name weighs double). Empty query lists all. */
export function searchSkills(workspaceDir: string, query: string, nodeStateDir?: string, limit = 10): SkillEntry[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const active = listSkills(workspaceDir, nodeStateDir).filter((s) => s.status === "active");
  if (terms.length === 0) return active.slice(0, limit);
  return active
    .map((s) => {
      const name = s.name.toLowerCase();
      const desc = s.description.toLowerCase();
      return { s, score: terms.reduce((n, t) => n + (name.includes(t) ? 2 : 0) + (desc.includes(t) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s);
}

export interface LoadedSkill {
  name: string;
  description: string;
  allowedTools?: string[];
  body: string;
  /** Resource files beside SKILL.md, skill-relative. */
  files: string[];
  sha256: string;
  path: string;
}

/** An active skill's SKILL.md body and resource list, or null when not active. */
export function readSkill(workspaceDir: string, name: string): LoadedSkill | null {
  if (!SKILL_NAME_LOOSE.test(name)) return null;
  const dir = resolveInside(workspaceDir, `${ACTIVE_DIR}/${name}`);
  if (!dir) return null;
  const md = path.join(dir, "SKILL.md");
  if (!existsSync(md) || lstatSync(md).size > MAX_SKILL_MD) return null;
  const text = readFileSync(md, "utf8");
  const fm = parseFrontmatter(text);
  return {
    name: fm?.meta.name ?? name,
    description: fm?.meta.description ?? "",
    allowedTools: fm?.meta.allowedTools,
    body: fm ? fm.body : text,
    files: listFiles(dir).filter((f) => f !== "SKILL.md"),
    sha256: hashDir(dir),
    path: toRel(workspaceDir, md),
  };
}
