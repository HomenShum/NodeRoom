/**
 * Citation tokens in workspace documents: [src:<workspace-relative path>#L<a>] or
 * [src:<path>#L<a>-L<b>]. Shared by the check_citations tool and verifiers.
 */
import { readFileSync, statSync } from "node:fs";
import { isRestricted, resolveInside, toRel } from "./workspaceFs.js";

export interface Citation {
  raw: string;
  path: string;
  start: number;
  end: number;
  /** 1-based line of the citing document where the token appears. */
  line: number;
}

export interface CitationFailure {
  citation: string;
  line: number;
  reason: string;
}

export interface CitationReport {
  total: number;
  valid: number;
  invalid: number;
  /** First MAX_FAILURES failures; `invalid` is the exact count. */
  failures: CitationFailure[];
  citedFiles: string[];
}

const TOKEN = /\[src:([^\]#\r\n]+)#L(\d+)(?:-L(\d+))?\]/g;
const MAX_FAILURES = 50;
const MAX_CITED_BYTES = 8 * 1024 * 1024;

export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(TOKEN)) {
      const start = Number(m[2]);
      out.push({ raw: m[0], path: m[1].trim(), start, end: m[3] ? Number(m[3]) : start, line: i + 1 });
    }
  }
  return out;
}

export function countLines(text: string): number {
  if (text === "") return 0;
  const n = text.split(/\r?\n/).length;
  return text.endsWith("\n") ? n - 1 : n;
}

/** Validate every citation in `text` against the workspace: exists, not restricted, line range in bounds. */
export function checkCitations(workspaceDir: string, text: string, restrictedGlobs: string[]): CitationReport {
  const citations = parseCitations(text);
  const lineCounts = new Map<string, number | string>();
  const failures: CitationFailure[] = [];
  let invalid = 0;
  const fail = (c: Citation, reason: string) => {
    invalid++;
    if (failures.length < MAX_FAILURES) failures.push({ citation: c.raw, line: c.line, reason });
  };
  for (const c of citations) {
    const abs = resolveInside(workspaceDir, c.path);
    if (!abs) {
      fail(c, "path is outside the workspace");
      continue;
    }
    const rel = toRel(workspaceDir, abs);
    if (isRestricted(rel, restrictedGlobs)) {
      fail(c, "cites a source restricted by workspace policy");
      continue;
    }
    let count = lineCounts.get(rel);
    if (count === undefined) {
      try {
        const st = statSync(abs);
        if (!st.isFile()) count = "not a file";
        else if (st.size > MAX_CITED_BYTES) count = "cited file too large to verify";
        else count = countLines(readFileSync(abs, "utf8"));
      } catch {
        count = "cited file does not exist";
      }
      lineCounts.set(rel, count);
    }
    if (typeof count === "string") fail(c, count);
    else if (c.start < 1 || c.end < c.start) fail(c, `invalid line range L${c.start}-L${c.end}`);
    else if (c.end > count) fail(c, `line range L${c.start}-L${c.end} exceeds ${rel} (${count} lines)`);
  }
  return {
    total: citations.length,
    valid: citations.length - invalid,
    invalid,
    failures,
    citedFiles: [...lineCounts.keys()].sort(),
  };
}
