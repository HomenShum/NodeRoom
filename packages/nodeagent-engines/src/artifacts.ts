/**
 * Workspace snapshots and diffs. Node, not the engine, decides what was
 * written: artifact.written events come from hashing the workspace.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ArtifactKind, EngineEventDraft } from "./contract.js";

export const MAX_SNAPSHOT_FILES = 2000;
export const MAX_HASH_BYTES = 5 * 1024 * 1024;
const MAX_TABLE_SNIFF = 1024 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

export interface FileState {
  bytes: number;
  mtimeMs: number;
  /** "" when the file is larger than MAX_HASH_BYTES (change detection falls back to size + mtime). */
  sha256: string;
}

export interface Snapshot {
  files: Map<string, FileState>;
  /** true when the walk stopped at MAX_SNAPSHOT_FILES. */
  truncated: boolean;
}

/** Walks the workspace; reuses `prev` hashes when size and mtime are unchanged. */
export function snapshot(workspaceDir: string, prev?: Snapshot): Snapshot {
  const root = path.resolve(workspaceDir);
  const files = new Map<string, FileState>();
  let truncated = false;
  const stack: string[] = [""];
  while (stack.length) {
    const rel = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(childRel);
        continue;
      }
      if (!e.isFile()) continue; // symlinks/junctions are not followed
      if (files.size >= MAX_SNAPSHOT_FILES) {
        truncated = true;
        break;
      }
      const abs = path.join(root, childRel);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      const old = prev?.files.get(childRel);
      let sha256 = "";
      if (old && old.bytes === st.size && old.mtimeMs === st.mtimeMs) sha256 = old.sha256;
      else if (st.size <= MAX_HASH_BYTES) {
        try {
          sha256 = createHash("sha256").update(readFileSync(abs)).digest("hex");
        } catch {
          continue;
        }
      }
      files.set(childRel, { bytes: st.size, mtimeMs: st.mtimeMs, sha256 });
    }
    if (truncated) break;
  }
  return { files, truncated };
}

function sniff(workspaceDir: string, rel: string): string {
  try {
    const abs = path.join(workspaceDir, rel);
    if (lstatSync(abs).size > MAX_TABLE_SNIFF) return "";
    return readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function looksTabular(workspaceDir: string, rel: string, ext: string): boolean {
  const text = sniff(workspaceDir, rel);
  if (ext === ".md") return /^[ \t]*\|.+\|[ \t]*\r?\n[ \t]*\|?[ \t]*:?-{3,}/m.test(text);
  try {
    const v = JSON.parse(text) as unknown;
    if (Array.isArray(v)) return v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r));
    return !!v && typeof v === "object" && Array.isArray((v as { rows?: unknown }).rows);
  } catch {
    return false;
  }
}

export function classify(rel: string, workspaceDir?: string): ArtifactKind {
  const p = rel.replace(/\\/g, "/");
  const lower = p.toLowerCase();
  const ext = path.posix.extname(lower);
  const base = path.posix.basename(lower);
  if (ext === ".ipynb") return "notebook";
  if (lower.startsWith(".claude/skills/") || lower.startsWith("skill-drafts/")) return "skill";
  if (/(^|\/)tests?\//.test(lower) || /\.test\.[a-z]+$/.test(base)) return "test";
  if (lower.startsWith("analysis/")) {
    if (ext === ".csv") return "table";
    if ((ext === ".md" || ext === ".json") && workspaceDir && looksTabular(workspaceDir, p, ext)) return "table";
  }
  if ([".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".py"].includes(ext)) return "code";
  if (ext === ".md") return "doc";
  if (ext === ".json" || ext === ".csv") return "data";
  return "other";
}

type ArtifactDraft = Extract<EngineEventDraft, { type: "artifact.written" }>;

/** Created, modified and deleted files between two snapshots, in path order. */
export function diff(prev: Snapshot, next: Snapshot, workspaceDir?: string): ArtifactDraft[] {
  const out: ArtifactDraft[] = [];
  for (const [p, f] of next.files) {
    const old = prev.files.get(p);
    const changed = !old || old.bytes !== f.bytes || (f.sha256 ? old.sha256 !== f.sha256 : old.mtimeMs !== f.mtimeMs);
    if (changed)
      out.push({ type: "artifact.written", path: p, kind: classify(p, workspaceDir), bytes: f.bytes, sha256: f.sha256, change: old ? "modified" : "created" });
  }
  // A truncated walk cannot tell "deleted" from "not reached".
  if (!next.truncated)
    for (const [p, f] of prev.files)
      if (!next.files.has(p)) out.push({ type: "artifact.written", path: p, kind: classify(p), bytes: 0, sha256: f.sha256, change: "deleted" });
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
