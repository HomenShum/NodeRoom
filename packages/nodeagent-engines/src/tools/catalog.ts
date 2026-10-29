/**
 * The Node tool catalog every engine reaches through the gateway. Workspace
 * file tools exist only for engines without native Read/Write. Every path goes
 * through resolveInside + the template's restrictedGlobs; policy refusals come
 * back as ok:false with a reason, never as thrown errors.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { NodeToolContext, NodeToolDefinition, NodeToolResult } from "../contract.js";
import { recordCheck, runCheck, summarizeCheck } from "../checks.js";
import { readSkill, searchSkills } from "../skills/catalog.js";
import { activateSkill, draftSkill, testSkill, validateSkill } from "../skills/lifecycle.js";
import { checkCitations, countLines } from "./citations.js";
import { addNotebookCell } from "./notebook.js";
import { isNodeOwned, isRestricted, resolveInside, toRel } from "./workspaceFs.js";

const MAX_READ_OUTPUT = 256 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LIST = 500;
const MAX_VISIT = 20_000;
const SOURCES = "sources";
const SKIP_DIRS = new Set([".git", "node_modules"]);
export const DENIED = "permission denied by workspace policy";
export const RESTRICTED_LISTING = "unavailable: restricted by workspace policy";

const ok = (content: string, data?: Record<string, unknown>): NodeToolResult => ({ ok: true, content, data });
const fail = (content: string, data?: Record<string, unknown>): NodeToolResult => ({ ok: false, content, data });

function tool<S extends z.ZodObject>(d: NodeToolDefinition<S>): NodeToolDefinition {
  return d as unknown as NodeToolDefinition;
}

type Resolved = { abs: string; rel: string };
const refused = (r: Resolved | NodeToolResult): r is NodeToolResult => "ok" in r;

function gate(ctx: NodeToolContext, p: string, mode: "read" | "write"): Resolved | NodeToolResult {
  const abs = resolveInside(ctx.workspaceDir, p);
  if (!abs) return fail(`${p} is outside the workspace`);
  const rel = toRel(ctx.workspaceDir, abs);
  if (isRestricted(rel, ctx.template.restrictedGlobs)) return fail(`${rel || "."}: ${DENIED}`);
  if (mode === "write" && isNodeOwned(rel)) return fail(`${rel}: only Node writes under .claude/; create skills with draft_skill, validate_skill, test_skill, activate_skill`);
  return { abs, rel };
}

function readText(abs: string, rel: string): string | NodeToolResult {
  let size: number;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return fail(`${rel} is not a file`);
    size = st.size;
  } catch {
    return fail(`${rel} does not exist`);
  }
  if (size > MAX_FILE_BYTES) return fail(`${rel} is ${size} bytes, over the ${MAX_FILE_BYTES}-byte read limit; use search_text`);
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return fail(`${rel} looks binary (${size} bytes); not shown`);
  return buf.toString("utf8");
}

/** `cat -n` style slice [from, to], output capped at 256KB. */
function numbered(text: string, rel: string, from: number, to: number | undefined): NodeToolResult {
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) lines.pop();
  const total = text === "" ? 0 : lines.length;
  if (total === 0) return ok(`${rel} is empty (0 lines)`, { path: rel, totalLines: 0 });
  if (from > total) return fail(`${rel} has ${total} lines; line ${from} is past the end`);
  const end = Math.min(total, to ?? total);
  if (end < from) return fail(`invalid line range ${from}-${end}`);
  let out = "";
  let shown = from - 1;
  for (let i = from; i <= end; i++) {
    const line = `${String(i).padStart(6)}\t${lines[i - 1]}\n`;
    if (out.length + line.length > MAX_READ_OUTPUT) break;
    out += line;
    shown = i;
  }
  const more = shown < total ? ` (more: continue from line ${shown + 1})` : "";
  return ok(`${rel} lines ${from}-${shown} of ${total}${more}\n${out}`, { path: rel, from, to: shown, totalLines: total });
}

interface WalkEntry {
  rel: string;
  abs: string;
  size: number;
}

/** Regular files below `rootAbs`, sorted, symlinks/junctions skipped, bounded. */
function walk(workspaceDir: string, rootAbs: string, max = MAX_LIST): { files: WalkEntry[]; truncated: boolean } {
  const files: WalkEntry[] = [];
  let visited = 0;
  let truncated = false;
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= max || ++visited > MAX_VISIT) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) visit(abs);
      else if (e.isFile()) {
        let size = 0;
        try {
          size = statSync(abs).size;
        } catch {
          continue;
        }
        files.push({ rel: toRel(workspaceDir, abs), abs, size });
      }
    }
  };
  visit(rootAbs);
  return { files, truncated };
}

/** Word-overlap ranking over name (x3), family (x2), searchHint (x2), description (x1). Empty query lists all. */
export function searchCatalog(tools: NodeToolDefinition[], query: string, limit = 10): NodeToolDefinition[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const cap = Math.max(1, Math.min(50, limit));
  if (words.length === 0) return tools.slice(0, cap);
  return tools
    .map((t) => {
      const name = t.name.toLowerCase();
      const hint = (t.searchHint ?? "").toLowerCase();
      const desc = t.description.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (name.includes(w)) score += 3;
        if (t.family === w) score += 2;
        if (hint.includes(w)) score += 2;
        if (desc.includes(w)) score += 1;
      }
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name))
    .slice(0, cap)
    .map((x) => x.t);
}

function workspaceTools(): NodeToolDefinition[] {
  return [
    tool({
      name: "list_files",
      // Core file access is the basic tool set for every non-Claude engine; deferring it behind
      // search left small models unable to write at all. Specialty tools stay deferred.
      alwaysLoad: true,
      family: "workspace",
      risk: "read",
      description: "List files under a workspace folder (recursive, bounded). Restricted files are marked, never read.",
      searchHint: "list directory tree files",
      schema: z.object({ path: z.string().optional().describe("Workspace-relative folder, default the workspace root") }),
      async execute({ path: p }, ctx) {
        const g = gate(ctx, p ?? ".", "read");
        if (refused(g)) return g;
        const { files, truncated } = walk(ctx.workspaceDir, g.abs);
        const rows = files.map((f) => (isRestricted(f.rel, ctx.template.restrictedGlobs) ? `${f.rel}\t(${RESTRICTED_LISTING})` : `${f.rel}\t${f.size} bytes`));
        return ok(`${files.length} files under ${g.rel || "."}${truncated ? ` (truncated at ${MAX_LIST})` : ""}\n${rows.join("\n")}`, { count: files.length, truncated });
      },
    }),
    tool({
      name: "read_file",
      // Core file access is the basic tool set for every non-Claude engine; deferring it behind
      // search left small models unable to write at all. Specialty tools stay deferred.
      alwaysLoad: true,
      family: "workspace",
      risk: "read",
      description: "Read a workspace text file with line numbers. offset is the 1-based first line, limit the line count (default 2000). Output capped at 256KB.",
      searchHint: "read open view file contents",
      schema: z.object({
        path: z.string().min(1),
        offset: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(20_000).optional(),
      }),
      async execute({ path: p, offset, limit }, ctx) {
        const g = gate(ctx, p, "read");
        if (refused(g)) return g;
        const text = readText(g.abs, g.rel);
        if (typeof text !== "string") return text;
        const from = offset ?? 1;
        return numbered(text, g.rel, from, from + (limit ?? 2000) - 1);
      },
    }),
    tool({
      name: "write_file",
      // Core file access is the basic tool set for every non-Claude engine; deferring it behind
      // search left small models unable to write at all. Specialty tools stay deferred.
      alwaysLoad: true,
      family: "workspace",
      risk: "write",
      description: "Create or overwrite a workspace text file. Refused under .claude/ and restricted paths.",
      searchHint: "write create save file",
      schema: z.object({ path: z.string().min(1), content: z.string() }),
      async execute({ path: p, content }, ctx) {
        const g = gate(ctx, p, "write");
        if (refused(g)) return g;
        const bytes = Buffer.byteLength(content);
        if (bytes > MAX_WRITE_BYTES) return fail(`content is ${bytes} bytes, over the ${MAX_WRITE_BYTES}-byte write limit`);
        try {
          if (statSync(g.abs).isDirectory()) return fail(`${g.rel} is a directory`);
        } catch {
          /* new file */
        }
        mkdirSync(path.dirname(g.abs), { recursive: true });
        writeFileSync(g.abs, content);
        return ok(`Wrote ${g.rel} (${bytes} bytes, ${countLines(content)} lines)`, { path: g.rel, bytes });
      },
    }),
    tool({
      name: "edit_file",
      // Core file access is the basic tool set for every non-Claude engine; deferring it behind
      // search left small models unable to write at all. Specialty tools stay deferred.
      alwaysLoad: true,
      family: "workspace",
      risk: "write",
      description: "Replace one exact, unique occurrence of old_string with new_string in a workspace file.",
      searchHint: "edit replace modify file",
      schema: z.object({ path: z.string().min(1), old_string: z.string().min(1), new_string: z.string() }),
      async execute({ path: p, old_string, new_string }, ctx) {
        const g = gate(ctx, p, "write");
        if (refused(g)) return g;
        const text = readText(g.abs, g.rel);
        if (typeof text !== "string") return text;
        const at = text.indexOf(old_string);
        if (at < 0) return fail(`old_string not found in ${g.rel}`);
        if (text.indexOf(old_string, at + 1) >= 0) return fail(`old_string occurs more than once in ${g.rel}; include more context so it is unique`);
        const next = text.slice(0, at) + new_string + text.slice(at + old_string.length);
        if (Buffer.byteLength(next) > MAX_WRITE_BYTES) return fail(`result would exceed the ${MAX_WRITE_BYTES}-byte write limit`);
        writeFileSync(g.abs, next);
        return ok(`Edited ${g.rel} at line ${countLines(text.slice(0, at)) + 1}`, { path: g.rel });
      },
    }),
    tool({
      name: "search_text",
      family: "workspace",
      risk: "read",
      description: "Regex search across workspace text files. Returns path:line: text for up to maxMatches hits. Restricted files are skipped.",
      searchHint: "grep regex find text in files",
      schema: z.object({
        pattern: z.string().min(1).max(500),
        path: z.string().optional().describe("Folder or file, default the workspace root"),
        glob: z.string().optional().describe("Only files matching this glob, e.g. **/*.md"),
        ignoreCase: z.boolean().optional(),
        maxMatches: z.number().int().min(1).max(200).optional(),
      }),
      async execute({ pattern, path: p, glob, ignoreCase, maxMatches }, ctx) {
        let re: RegExp;
        try {
          re = new RegExp(pattern, ignoreCase ? "i" : "");
        } catch (e) {
          return fail(`invalid regex: ${e instanceof Error ? e.message : String(e)}`);
        }
        const g = gate(ctx, p ?? ".", "read");
        if (refused(g)) return g;
        const isFile = statSync(g.abs, { throwIfNoEntry: false })?.isFile() ?? false;
        const candidates = isFile ? [{ rel: g.rel, abs: g.abs, size: statSync(g.abs).size }] : walk(ctx.workspaceDir, g.abs, MAX_VISIT).files;
        const cap = maxMatches ?? 50;
        const hits: string[] = [];
        let skipped = 0;
        let filesSearched = 0;
        // ponytail: agent-supplied regex runs on the worker thread; bounded by file size caps, move to a worker if ReDoS shows up.
        for (const f of candidates) {
          if (hits.length >= cap || ctx.signal.aborted) break;
          if (glob && !isRestricted(f.rel, [glob])) continue;
          if (isRestricted(f.rel, ctx.template.restrictedGlobs)) {
            skipped++;
            continue;
          }
          if (f.size > MAX_SEARCH_FILE_BYTES) continue;
          const buf = readFileSync(f.abs);
          if (buf.subarray(0, 8192).includes(0)) continue;
          filesSearched++;
          const lines = buf.toString("utf8").split(/\r?\n/);
          for (let i = 0; i < lines.length && hits.length < cap; i++) {
            if (re.test(lines[i])) hits.push(`${f.rel}:${i + 1}: ${lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i]}`);
          }
        }
        const note = `${hits.length} matches in ${filesSearched} files${hits.length >= cap ? ` (stopped at ${cap})` : ""}${skipped ? `; ${skipped} restricted files skipped` : ""}`;
        return ok(`${note}\n${hits.join("\n")}`, { matches: hits.length, filesSearched, restrictedSkipped: skipped });
      },
    }),
  ];
}

function sourceTools(): NodeToolDefinition[] {
  return [
    tool({
      name: "list_sources",
      family: "sources",
      risk: "read",
      alwaysLoad: true,
      description: "List source documents under sources/: docId (workspace-relative path), first heading, line count. Restricted documents are listed as unavailable.",
      schema: z.object({ folder: z.string().optional().describe("Subfolder of sources/, e.g. filings") }),
      async execute({ folder }, ctx) {
        const sub = (folder ?? "").replace(/\\/g, "/").replace(/^\.?\/?(sources\/?)?/i, "");
        const base = sub ? `${SOURCES}/${sub}` : SOURCES;
        const abs = resolveInside(ctx.workspaceDir, base);
        const rel = abs ? toRel(ctx.workspaceDir, abs) : "";
        if (!abs || !(rel.toLowerCase() === SOURCES || rel.toLowerCase().startsWith(`${SOURCES}/`))) return fail(`${base} is not inside ${SOURCES}/`);
        if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return fail(`${rel} does not exist in this workspace`);
        const { files, truncated } = walk(ctx.workspaceDir, abs);
        const sources = files.map((f) => {
          if (isRestricted(f.rel, ctx.template.restrictedGlobs)) return { docId: f.rel, status: RESTRICTED_LISTING };
          const text = readText(f.abs, f.rel);
          if (typeof text !== "string") return { docId: f.rel, status: text.content };
          const heading = text.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1] ?? null;
          return { docId: f.rel, heading, lines: countLines(text) };
        });
        const rows = sources.map((s) => ("status" in s ? `${s.docId} | ${s.status}` : `${s.docId} | ${s.lines} lines | ${s.heading ?? "(no heading)"}`));
        return ok(`${sources.length} sources under ${rel}${truncated ? ` (truncated at ${MAX_LIST})` : ""}\n${rows.join("\n")}`, { sources, truncated });
      },
    }),
    tool({
      name: "read_source",
      // Core file access is the basic tool set for every non-Claude engine; deferring it behind
      // search left small models unable to write at all. Specialty tools stay deferred.
      alwaysLoad: true,
      family: "sources",
      risk: "read",
      description: "Read a source document (docId from list_sources) with line numbers, optionally a line range. Cite lines as [src:<docId>#L<a>-L<b>].",
      searchHint: "read source document lines cite",
      // list_sources returns "docId"; models pass it back under that name, so accept both.
      schema: z.object({
        docId: z.string().min(1).optional().describe("docId from list_sources, e.g. sources/companies/acme-profile.md"),
        path: z.string().min(1).optional().describe("Alias of docId"),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      }),
      async execute({ docId, path: alias, startLine, endLine }, ctx) {
        const p = docId ?? alias;
        if (!p) return fail("read_source needs docId (the value list_sources returns), e.g. sources/companies/acme-profile.md");
        const norm = p.replace(/\\/g, "/");
        const docPath = /^(\.\/)?sources\//i.test(norm) ? norm : `${SOURCES}/${norm}`;
        const abs = resolveInside(ctx.workspaceDir, docPath);
        const rel = abs ? toRel(ctx.workspaceDir, abs) : "";
        if (!abs || !rel.toLowerCase().startsWith(`${SOURCES}/`)) return fail(`${p} is not a source under ${SOURCES}/`);
        if (isRestricted(rel, ctx.template.restrictedGlobs)) return fail(`${rel}: ${DENIED}`, { path: rel, denied: true });
        const text = readText(abs, rel);
        if (typeof text !== "string") return text;
        return numbered(text, rel, startLine ?? 1, endLine);
      },
    }),
  ];
}

export function buildNodeToolCatalog(opts: { nativeFileTools: boolean }): NodeToolDefinition[] {
  const tools: NodeToolDefinition[] = [
    ...(opts.nativeFileTools ? [] : workspaceTools()),
    ...sourceTools(),
    tool({
      name: "check_citations",
      family: "citations",
      risk: "read",
      description: "Verify every [src:<path>#L<a>-L<b>] citation in a workspace document: source exists, is not restricted, and the line range is in bounds.",
      searchHint: "verify citations sources line ranges",
      schema: z.object({ path: z.string().min(1).describe("Workspace document to check, e.g. report.md") }),
      async execute({ path: p }, ctx) {
        const g = gate(ctx, p, "read");
        if (refused(g)) return g;
        const text = readText(g.abs, g.rel);
        if (typeof text !== "string") return text;
        const r = checkCitations(ctx.workspaceDir, text, ctx.template.restrictedGlobs);
        const head = `${g.rel}: ${r.total} citations, ${r.valid} valid, ${r.invalid} invalid`;
        const rows = r.failures.map((f) => `line ${f.line}: ${f.citation} — ${f.reason}`);
        const more = r.invalid > r.failures.length ? `\n… ${r.invalid - r.failures.length} more failures` : "";
        return { ok: r.invalid === 0, content: `${head}${rows.length ? `\n${rows.join("\n")}` : ""}${more}`, data: { ...r, path: g.rel } };
      },
    }),
    tool({
      name: "run_checks",
      family: "checks",
      risk: "exec",
      alwaysLoad: true,
      description: "Run one of the template's allowlisted check suites inside the workspace and report pass/fail counts. Omit suite when the template defines only one.",
      schema: z.object({ suite: z.string().min(1).max(64).optional().describe("Check suite name from the template (not a source folder); optional when there is exactly one") }),
      async execute({ suite: requested }, ctx) {
        const suites = Object.keys(ctx.template.checks);
        const suite = requested ?? (suites.length === 1 ? suites[0] : "");
        if (!suite) return fail(`run_checks needs a suite. Available: ${suites.join(", ") || "none (this template defines no checks)"}`);
        if (!Object.hasOwn(ctx.template.checks, suite)) return fail(`unknown check suite "${suite}". Available: ${suites.join(", ") || "none (this template defines no checks)"}`);
        const run = await runCheck({ suite, spec: ctx.template.checks[suite], workspaceDir: ctx.workspaceDir, signal: ctx.signal });
        recordCheck(ctx.nodeStateDir, run, { runId: ctx.runId, agentId: ctx.agentId, independent: false });
        if (run.started) {
          ctx.emit({
            type: "check.result",
            checkId: run.checkId,
            command: run.command,
            ok: run.ok,
            passed: run.passed,
            failed: run.failed,
            durationMs: run.durationMs,
            outputTail: run.outputTail,
            independent: false,
          });
        }
        const tail = run.outputTail ? `\n--- output tail ---\n${run.outputTail.slice(-2000)}` : "";
        return { ok: run.ok, content: `${summarizeCheck(run)}${tail}`, data: { checkId: run.checkId, passed: run.passed, failed: run.failed, countsReported: run.countsReported, exitCode: run.exitCode } };
      },
    }),
    tool({
      name: "notebook_add_cell",
      family: "notebook",
      risk: "write",
      description: "Append a markdown or code cell to a Jupyter notebook (.ipynb, nbformat 4.5), creating it when missing.",
      searchHint: "jupyter notebook ipynb cell",
      schema: z.object({ path: z.string().min(1), cell_type: z.enum(["markdown", "code"]), source: z.string().max(256 * 1024) }),
      async execute({ path: p, cell_type, source }, ctx) {
        if (!/\.ipynb$/i.test(p)) return fail("path must end in .ipynb");
        const g = gate(ctx, p, "write");
        if (refused(g)) return g;
        try {
          const r = addNotebookCell(g.abs, cell_type, source);
          return ok(`${r.created ? "Created" : "Updated"} ${g.rel}: added ${cell_type} cell ${r.cellId} (${r.cells} cells)`, { path: g.rel, cellId: r.cellId, cells: r.cells, created: r.created });
        } catch (e) {
          return fail(`${g.rel}: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    }),
    tool({
      name: "search_skills",
      family: "skills",
      risk: "read",
      description: "Search active workspace skills (.claude/skills) by keywords in name and description.",
      searchHint: "find skill procedure playbook",
      schema: z.object({ query: z.string().max(200) }),
      async execute({ query }, ctx) {
        const found = searchSkills(ctx.workspaceDir, query, ctx.nodeStateDir);
        ctx.emit({ type: "skill.search", query, results: found.map((s) => s.name), via: "node", agentId: ctx.agentId });
        if (found.length === 0) return ok(`No active skills match "${query}".`, { results: [] });
        return ok(found.map((s) => `${s.name} — ${s.description} (${s.path})`).join("\n"), { results: found.map((s) => s.name) });
      },
    }),
    tool({
      name: "load_skill",
      family: "skills",
      risk: "read",
      description: "Load an active skill's SKILL.md instructions and its resource file list.",
      searchHint: "load use skill instructions",
      schema: z.object({ name: z.string().min(1).max(64) }),
      async execute({ name }, ctx) {
        const s = readSkill(ctx.workspaceDir, name);
        if (!s) return fail(`No active skill "${name}". Use search_skills to find one.`);
        if (isRestricted(s.path, ctx.template.restrictedGlobs)) return fail(`${s.path}: ${DENIED}`);
        ctx.emit({ type: "skill.loaded", name: s.name, sha256: s.sha256, via: "node", agentId: ctx.agentId });
        const dir = path.posix.dirname(s.path);
        const files = s.files.length ? `Resource files (relative to ${dir}): ${s.files.join(", ")}` : "No resource files.";
        return ok(`# Skill: ${s.name}\n${s.description}\nDirectory: ${dir}\n${files}\n\n${s.body}`, { name: s.name, sha256: s.sha256, files: s.files });
      },
    }),
    tool({
      name: "draft_skill",
      family: "skills",
      risk: "write",
      description: "Write a skill draft to skill-drafts/<name>/ (SKILL.md, resource files, skill.test.json). Drafts must then pass validate_skill and test_skill before activate_skill.",
      searchHint: "create new skill draft",
      schema: z.object({
        name: z.string().min(1).max(64).describe("lowercase-hyphenated, 3..64 chars"),
        description: z.string().max(1024).describe("When to use this skill, 20..1024 chars"),
        instructions: z.string().max(128 * 1024).describe("SKILL.md body (markdown)"),
        files: z.array(z.object({ path: z.string().min(1), content: z.string() })).max(50).optional(),
        tests: z
          .array(z.object({ label: z.string().min(1).max(200), args: z.array(z.string()).min(1).max(20).describe("Script path inside the draft first, then arguments"), expect: z.enum(["pass", "fail"]) }))
          .max(20)
          .optional()
          .describe("Needs at least one expect:pass case and one expect:fail counterexample"),
        allowedTools: z.array(z.string()).max(20).optional().describe("Only Read, Grep, Glob, Bash(node:*) or mcp__node__<tool>; anything else is refused"),
      }),
      async execute(args, ctx) {
        return draftSkill(ctx, args);
      },
    }),
    tool({
      name: "validate_skill",
      family: "skills",
      risk: "read",
      description: "Statically validate a skill draft: frontmatter, file types, size, secret scan, script safety rules.",
      searchHint: "validate skill draft",
      schema: z.object({ name: z.string().min(1).max(64) }),
      async execute({ name }, ctx) {
        return validateSkill(ctx, name);
      },
    }),
    tool({
      name: "test_skill",
      family: "skills",
      risk: "exec",
      description: "Run a validated skill draft's skill.test.json cases; every case's exit status must match its expectation.",
      searchHint: "test skill draft cases",
      schema: z.object({ name: z.string().min(1).max(64) }),
      async execute({ name }, ctx) {
        return testSkill(ctx, name);
      },
    }),
    tool({
      name: "activate_skill",
      family: "skills",
      risk: "write",
      description: "Activate a validated and tested skill draft into .claude/skills/<name>/ (prior version archived).",
      searchHint: "activate publish skill",
      schema: z.object({ name: z.string().min(1).max(64) }),
      async execute({ name }, ctx) {
        return activateSkill(ctx, name);
      },
    }),
    tool({
      name: "update_goals",
      family: "goals",
      risk: "propose",
      alwaysLoad: true,
      description: "Replace the run's goal list (id, title, status, dependsOn). Statuses are your claims; Node verifies separately.",
      schema: z.object({
        goals: z
          .array(
            z.object({
              id: z.string().min(1).max(64),
              title: z.string().min(1).max(200),
              status: z.enum(["pending", "active", "done", "blocked"]),
              dependsOn: z.array(z.string().max(64)).max(20).optional(),
            }),
          )
          .max(50),
      }),
      async execute({ goals }, ctx) {
        const ids = new Set<string>();
        for (const g of goals) {
          if (ids.has(g.id)) return fail(`duplicate goal id "${g.id}"`);
          ids.add(g.id);
        }
        for (const g of goals) {
          const bad = (g.dependsOn ?? []).filter((d) => d === g.id || !ids.has(d));
          if (bad.length) return fail(`goal "${g.id}" depends on unknown or self ids: ${bad.join(", ")}`);
        }
        const items = goals.map((g) => ({ id: g.id, title: g.title, status: g.status, claimedBy: "engine" as const, ...(g.dependsOn?.length ? { dependsOn: g.dependsOn } : {}) }));
        ctx.emit({ type: "goals.updated", goals: items, source: "node-goals", agentId: ctx.agentId });
        const counts = ["pending", "active", "done", "blocked"].map((s) => `${items.filter((g) => g.status === s).length} ${s}`).join(", ");
        return ok(`Goals updated (${items.length}: ${counts}). Status is recorded as your claim.`, { goals: items.length });
      },
    }),
  ];

  tools.push(
    tool({
      name: "search_tools",
      family: "tool-meta",
      risk: "read",
      alwaysLoad: true,
      description: "Search the Node tool catalog by keywords. Returns names, families and descriptions; call load_tool for schemas.",
      schema: z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(50).optional() }),
      async execute({ query, limit }, ctx) {
        const found = searchCatalog(tools, query, limit);
        ctx.emit({ type: "tool.search", query, results: found.map((t) => t.name), via: "node", agentId: ctx.agentId });
        if (found.length === 0) return ok(`No Node tools match "${query}".`, { results: [] });
        const rows = found.map((t) => `${t.name} [${t.family}]${t.alwaysLoad ? "" : " (deferred)"} — ${t.description}`);
        return ok(rows.join("\n"), { results: found.map((t) => t.name) });
      },
    }),
    tool({
      name: "load_tool",
      family: "tool-meta",
      risk: "read",
      alwaysLoad: true,
      description: "Load JSON input schemas for Node tools by name (from search_tools).",
      schema: z.object({ names: z.array(z.string().min(1).max(64)).min(1).max(20) }),
      async execute({ names }, ctx) {
        const found = [...new Set(names)].map((n) => tools.find((t) => t.name === n)).filter((t): t is NodeToolDefinition => t !== undefined);
        const unknown = names.filter((n) => !found.some((t) => t.name === n));
        if (found.length === 0) return fail(`No Node tools named ${unknown.join(", ")}. Use search_tools.`, { unknown });
        ctx.emit({ type: "tool.loaded", names: found.map((t) => t.name), via: "node-load-tool", agentId: ctx.agentId });
        const payload = { tools: found.map((t) => ({ name: t.name, family: t.family, description: t.description, inputSchema: z.toJSONSchema(t.schema) })), unknown };
        return ok(JSON.stringify(payload, null, 1), { loaded: found.map((t) => t.name), unknown });
      },
    }),
  );
  return tools;
}
