/**
 * Skill lifecycle: draft -> validate -> test -> activate. Node is the only writer
 * of <ws>/.claude/skills; every stage is pinned to the sha256 of the draft dir,
 * so editing a draft after testing invalidates activation.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NodeToolContext, NodeToolResult } from "../contract.js";
import { cleanChildEnv } from "../env.js";
import { isRestricted, resolveInside, toRel } from "../tools/workspaceFs.js";
import { ACTIVE_DIR, DRAFTS_DIR, LEDGER_FILE, hashDir, listFiles, parseFrontmatter } from "./catalog.js";

export const SKILL_NAME = /^[a-z0-9-]{3,64}$/;
const ALLOWED_EXT = new Set([".md", ".mjs", ".js", ".json", ".txt"]);
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_CASES = 20;
const CASE_TIMEOUT_MS = 30_000;
const TEST_FILE = "skill.test.json";

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["API key (sk-...)", /sk-[A-Za-z0-9_-]{20,}/],
  ["Google API key (AIza...)", /AIza[0-9A-Za-z_-]{35}/],
  ["PEM key block", /-----BEGIN/],
  ["Slack token", /xox[bp]-/],
  ["GitHub token", /ghp_[A-Za-z0-9]{20,}/],
];

const NET = "(?:node:)?(?:https?|http2|net|tls|child_process|dgram)";
const SCRIPT_RULES: Array<[string, RegExp]> = [
  ["network fetch()", /\bfetch\s*\(/],
  ["require of a network/process module", new RegExp(`\\brequire\\s*\\(\\s*["'\`]${NET}["'\`]`)],
  ["import of a network/process module", new RegExp(`\\b(?:import|from)\\s*\\(?\\s*["'\`]${NET}["'\`]`)],
  ["eval()", /\beval\s*\(/],
  ["new Function()", /\bnew\s+Function\s*\(/],
];

const ALLOWED_TOOLS = new Set(["Read", "Grep", "Glob", "Bash(node:*)"]);
const NODE_MCP_TOOL = /^mcp__node__[a-z0-9_]+$/;
const badTool = (t: string) => !ALLOWED_TOOLS.has(t) && !NODE_MCP_TOOL.test(t);
const toolProblem = (t: string) => `allowed-tools entry ${JSON.stringify(t)} is outside [${[...ALLOWED_TOOLS].join(", ")}, mcp__node__*]`;
/**
 * Every frontmatter line must be a one-line name/description/allowed-tools value, a "- item" or a comment.
 * Engines parse full YAML, so any other line (an injected key, a block scalar, a continuation) is something validation never checked.
 */
const FRONT_LINE = /^(?:(?:name|description|allowed-tools):(?:[ \t].*)?|[ \t]+-[ \t]+\S.*|[ \t]*(?:#.*)?)$/;

export interface SkillTestCase {
  label: string;
  args: string[];
  expect: "pass" | "fail";
}

export interface CaseResult {
  label: string;
  expect: "pass" | "fail";
  exitCode: number | null;
  timedOut: boolean;
  sandboxDenied: boolean;
  matched: boolean;
  ms: number;
  outputTail: string;
}

interface Stamp {
  sha256: string;
  at: string;
}

interface LedgerEntry {
  drafted?: Stamp;
  validated?: Stamp;
  tested?: Stamp & { cases: CaseResult[] };
  activations: Array<Stamp & { archivedPrior?: string }>;
  rejections: Array<{ stage: string; reason: string; sha256?: string; at: string }>;
}

export interface SkillLedger {
  schema: "nodeagent.skills-ledger/v1";
  skills: Record<string, LedgerEntry>;
}

export function readLedger(nodeStateDir: string): SkillLedger {
  try {
    const l = JSON.parse(readFileSync(path.join(nodeStateDir, LEDGER_FILE), "utf8")) as SkillLedger;
    if (l && typeof l.skills === "object") return l;
  } catch {
    /* missing or unreadable: start empty */
  }
  return { schema: "nodeagent.skills-ledger/v1", skills: {} };
}

/** Synchronous read-modify-write: no await between read and write, so in-process calls cannot interleave. */
function updateLedger(nodeStateDir: string, name: string, fn: (e: LedgerEntry) => void): void {
  const ledger = readLedger(nodeStateDir);
  const entry = (ledger.skills[name] ??= { activations: [], rejections: [] });
  fn(entry);
  entry.activations = entry.activations.slice(-50);
  entry.rejections = entry.rejections.slice(-20);
  mkdirSync(nodeStateDir, { recursive: true });
  const file = path.join(nodeStateDir, LEDGER_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(tmp, file);
}

const now = () => new Date().toISOString();
const short = (sha?: string) => (sha ? sha.slice(0, 12) : "none");

function emitStage(ctx: NodeToolContext, name: string, stage: "drafted" | "validated" | "tested" | "activated" | "rejected", detail: string, sha256?: string): void {
  ctx.emit({ type: "skill.lifecycle", name, stage, detail, path: `${stage === "activated" ? ACTIVE_DIR : DRAFTS_DIR}/${name}`, sha256 });
}

function reject(ctx: NodeToolContext, name: string, attempted: string, reason: string, sha256?: string, data?: Record<string, unknown>): NodeToolResult {
  if (SKILL_NAME.test(name)) updateLedger(ctx.nodeStateDir, name, (e) => e.rejections.push({ stage: attempted, reason, sha256, at: now() }));
  emitStage(ctx, name, "rejected", `${attempted}: ${reason}`, sha256);
  return { ok: false, content: `Skill ${name} rejected at ${attempted}: ${reason}`, data: { stage: "rejected", attempted, reason, sha256, ...data } };
}

function draftDirOf(ctx: NodeToolContext, name: string): string | null {
  return SKILL_NAME.test(name) ? resolveInside(ctx.workspaceDir, `${DRAFTS_DIR}/${name}`) : null;
}

function copyRegularFiles(from: string, to: string): void {
  for (const rel of listFiles(from)) {
    const dst = path.join(to, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(path.join(from, rel), dst);
  }
}

export interface DraftInput {
  name: string;
  description: string;
  instructions: string;
  files?: Array<{ path: string; content: string }>;
  tests?: SkillTestCase[];
  allowedTools?: string[];
}

export function draftSkill(ctx: NodeToolContext, input: DraftInput): NodeToolResult {
  const { name } = input;
  const dir = draftDirOf(ctx, name);
  if (!dir) return reject(ctx, name, "draft", `name must match ${SKILL_NAME} and stay inside ${DRAFTS_DIR}/`);
  // allowedTools is written into SKILL.md frontmatter verbatim, so it is checked before anything is written.
  const bad = input.allowedTools?.find(badTool);
  if (bad !== undefined) return reject(ctx, name, "draft", toolProblem(bad));
  if (/[\r\n]/.test(input.description)) return reject(ctx, name, "draft", "description must be one line");
  const files = input.files ?? [];
  const seen = new Set<string>();
  const targets: Array<{ abs: string; content: string }> = [];
  for (const f of files) {
    // The draft dir may not exist yet, so resolve against the workspace and then require it to sit below the draft dir.
    const abs = path.isAbsolute(f.path) ? null : resolveInside(ctx.workspaceDir, `${DRAFTS_DIR}/${name}/${f.path}`);
    const rel = abs ? toRel(dir, abs) : "";
    if (!abs || rel === "" || rel === ".." || rel.startsWith("../")) return reject(ctx, name, "draft", `file path ${JSON.stringify(f.path)} escapes the draft directory`);
    if (rel === "SKILL.md" || rel === TEST_FILE) return reject(ctx, name, "draft", `${rel} is generated from the draft fields; do not pass it in files`);
    if (seen.has(rel.toLowerCase())) return reject(ctx, name, "draft", `duplicate file path ${rel}`);
    seen.add(rel.toLowerCase());
    targets.push({ abs, content: f.content });
  }
  const front = [`name: ${name}`, `description: ${JSON.stringify(input.description)}`];
  if (input.allowedTools?.length) front.push(`allowed-tools: ${input.allowedTools.join(", ")}`);
  // Re-drafting replaces the whole draft so stale files never ride along.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\n${front.join("\n")}\n---\n\n${input.instructions.trim()}\n`);
  for (const t of targets) {
    mkdirSync(path.dirname(t.abs), { recursive: true });
    writeFileSync(t.abs, t.content);
  }
  if (input.tests?.length) writeFileSync(path.join(dir, TEST_FILE), `${JSON.stringify({ cases: input.tests }, null, 2)}\n`);
  const sha256 = hashDir(dir);
  updateLedger(ctx.nodeStateDir, name, (e) => {
    e.drafted = { sha256, at: now() };
  });
  const detail = `${files.length + 1 + (input.tests?.length ? 1 : 0)} files, ${input.tests?.length ?? 0} test cases`;
  emitStage(ctx, name, "drafted", detail, sha256);
  return {
    ok: true,
    content: `Drafted ${DRAFTS_DIR}/${name} (sha ${short(sha256)}; ${detail}). Next: validate_skill, then test_skill, then activate_skill.`,
    data: { stage: "drafted", sha256, path: `${DRAFTS_DIR}/${name}` },
  };
}

/** Static checks only. Returns the problems found (empty = valid). */
export function validateDraftDir(dir: string, dirName: string): string[] {
  const problems: string[] = [];
  const mdPath = path.join(dir, "SKILL.md");
  if (!existsSync(mdPath)) return ["SKILL.md is missing"];
  const md = readFileSync(mdPath, "utf8");
  const fm = parseFrontmatter(md);
  if (!fm) return ["SKILL.md has no YAML frontmatter"];
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md.replace(/^\uFEFF/, ""))?.[1] ?? "";
  for (const line of block.split(/\r?\n/)) {
    if (!FRONT_LINE.test(line)) problems.push(`frontmatter line ${JSON.stringify(line.slice(0, 80))} is not a one-line name, description or allowed-tools value`);
  }
  const { name, description, allowedTools } = fm.meta;
  if (!name || !SKILL_NAME.test(name)) problems.push(`frontmatter name must match ${SKILL_NAME}`);
  else if (name !== dirName) problems.push(`frontmatter name "${name}" does not match directory "${dirName}"`);
  const dl = description?.length ?? 0;
  if (dl < 20 || dl > 1024) problems.push(`description must be 20..1024 chars (got ${dl})`);
  for (const t of allowedTools ?? []) if (badTool(t)) problems.push(toolProblem(t));
  const files = listFiles(dir);
  let total = 0;
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) problems.push(`${rel}: file type ${ext || "(none)"} not allowed`);
    total += statSync(path.join(dir, rel)).size;
  }
  if (total > MAX_TOTAL_BYTES) {
    problems.push(`total size ${total} bytes exceeds ${MAX_TOTAL_BYTES}`);
    return problems;
  }
  for (const rel of files) {
    const text = readFileSync(path.join(dir, rel), "utf8");
    // Never echo the matched value.
    for (const [label, re] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${rel}: contains what looks like a secret (${label})`);
    if (/\.(m?js)$/i.test(rel)) for (const [label, re] of SCRIPT_RULES) if (re.test(text)) problems.push(`${rel}: script uses ${label}`);
  }
  return problems;
}

export function validateSkill(ctx: NodeToolContext, name: string): NodeToolResult {
  const dir = draftDirOf(ctx, name);
  if (!dir || !existsSync(dir)) return reject(ctx, name, "validate", `no draft at ${DRAFTS_DIR}/${name}`);
  const sha256 = hashDir(dir);
  const problems = validateDraftDir(dir, name);
  if (problems.length) return reject(ctx, name, "validate", problems.join("; "), sha256, { problems });
  updateLedger(ctx.nodeStateDir, name, (e) => {
    e.validated = { sha256, at: now() };
  });
  emitStage(ctx, name, "validated", "frontmatter, file types, size, secret scan and script rules passed", sha256);
  return { ok: true, content: `Validated ${name} (sha ${short(sha256)}). Next: test_skill.`, data: { stage: "validated", sha256 } };
}

function readCases(dir: string): SkillTestCase[] | string {
  const file = path.join(dir, TEST_FILE);
  if (!existsSync(file)) return `${TEST_FILE} is missing`;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return `${TEST_FILE} is not valid JSON`;
  }
  const list = Array.isArray(raw) ? raw : (raw as { cases?: unknown })?.cases;
  if (!Array.isArray(list) || list.length === 0) return `${TEST_FILE} has no cases`;
  if (list.length > MAX_CASES) return `${TEST_FILE} has more than ${MAX_CASES} cases`;
  for (const c of list as SkillTestCase[]) {
    const okShape = c && typeof c.label === "string" && Array.isArray(c.args) && c.args.length > 0 && c.args.every((a) => typeof a === "string") && (c.expect === "pass" || c.expect === "fail");
    if (!okShape) return `${TEST_FILE}: each case needs label, non-empty string args (script first) and expect "pass"|"fail"`;
  }
  const cases = list as SkillTestCase[];
  if (!cases.some((c) => c.expect === "pass") || !cases.some((c) => c.expect === "fail")) return `${TEST_FILE} needs at least one "pass" and one "fail" case (a counterexample)`;
  return cases;
}

function runCase(scriptAbs: string, args: string[], workspaceDir: string, readPaths: string[], signal: AbortSignal): Promise<{ exitCode: number | null; timedOut: boolean; out: string; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    // Node permission model: reads limited to the draft + the case's data files; no writes, child processes or workers.
    // ponytail: on Windows the model mis-handles paths >= MAX_PATH (observed); such cases fail closed (ERR_ACCESS_DENIED).
    const allow = readPaths.map((p) => `--allow-fs-read=${p}`);
    const child = spawn(process.execPath, ["--permission", ...allow, scriptAbs, ...args], {
      cwd: workspaceDir,
      env: cleanChildEnv({ NO_COLOR: "1" }),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let timedOut = false;
    const onData = (b: Buffer) => {
      out = (out + b.toString("utf8")).slice(-2048);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, CASE_TIMEOUT_MS);
    signal.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => {
      out += `\nspawn error: ${e.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      resolve({ exitCode: typeof code === "number" ? code : null, timedOut, out: out.slice(-512), ms: Date.now() - t0 });
    });
  });
}

export async function testSkill(ctx: NodeToolContext, name: string): Promise<NodeToolResult> {
  const dir = draftDirOf(ctx, name);
  if (!dir || !existsSync(dir)) return reject(ctx, name, "test", `no draft at ${DRAFTS_DIR}/${name}`);
  const sha256 = hashDir(dir);
  const ledger = readLedger(ctx.nodeStateDir).skills[name];
  if (ledger?.validated?.sha256 !== sha256) return reject(ctx, name, "test", "the current draft is not validated (run validate_skill after every edit)", sha256);
  const cases = readCases(dir);
  if (typeof cases === "string") return reject(ctx, name, "test", cases, sha256);
  const results: CaseResult[] = [];
  for (const c of cases) {
    if (ctx.signal.aborted) return reject(ctx, name, "test", "aborted", sha256);
    const script = resolveInside(dir, c.args[0]);
    if (!script || !/\.(m?js)$/i.test(script) || !existsSync(script)) {
      return reject(ctx, name, "test", `case "${c.label}": first arg must be a .mjs/.js script inside the draft (got ${JSON.stringify(c.args[0])})`, sha256);
    }
    const readPaths = [dir];
    for (const a of c.args.slice(1)) {
      const abs = resolveInside(ctx.workspaceDir, a);
      if (!abs || !existsSync(abs)) continue; // not a workspace path: a plain argument
      if (isRestricted(toRel(ctx.workspaceDir, abs), ctx.template.restrictedGlobs)) return reject(ctx, name, "test", `case "${c.label}" passes a path restricted by workspace policy`, sha256);
      if (!statSync(abs).isFile()) return reject(ctx, name, "test", `case "${c.label}": pass data files, not directories (${a})`, sha256);
      readPaths.push(abs);
    }
    const r = await runCase(script, c.args.slice(1), ctx.workspaceDir, readPaths, ctx.signal);
    // A sandbox denial is the script reaching outside its grant, never an expected failure.
    const sandboxDenied = r.out.includes("ERR_ACCESS_DENIED");
    const matched = !r.timedOut && !sandboxDenied && r.exitCode !== null && (c.expect === "pass" ? r.exitCode === 0 : r.exitCode !== 0);
    results.push({ label: c.label, expect: c.expect, exitCode: r.exitCode, timedOut: r.timedOut, sandboxDenied, matched, ms: r.ms, outputTail: r.out });
  }
  if (ctx.signal.aborted) return reject(ctx, name, "test", "aborted", sha256);
  const mismatched = results.filter((r) => !r.matched);
  const summary = `${results.length - mismatched.length}/${results.length} cases matched`;
  if (mismatched.length) {
    updateLedger(ctx.nodeStateDir, name, (e) => {
      e.tested = undefined;
    });
    const why = mismatched.map((r) => `"${r.label}" expected ${r.expect} but ${r.timedOut ? "timed out" : r.sandboxDenied ? "was denied by the sandbox" : `exited ${r.exitCode}`}`).join("; ");
    return reject(ctx, name, "test", `${summary}: ${why}`, sha256, { cases: results });
  }
  updateLedger(ctx.nodeStateDir, name, (e) => {
    e.tested = { sha256, at: now(), cases: results };
  });
  emitStage(ctx, name, "tested", summary, sha256);
  return { ok: true, content: `Tested ${name}: ${summary} (sha ${short(sha256)}). Next: activate_skill.`, data: { stage: "tested", sha256, cases: results } };
}

export async function activateSkill(ctx: NodeToolContext, name: string): Promise<NodeToolResult> {
  const dir = draftDirOf(ctx, name);
  if (!dir || !existsSync(dir)) return reject(ctx, name, "activate", `no draft at ${DRAFTS_DIR}/${name}`);
  const sha256 = hashDir(dir);
  const entry = readLedger(ctx.nodeStateDir).skills[name];
  if (entry?.validated?.sha256 !== sha256) return reject(ctx, name, "activate", entry?.validated ? `draft changed since validation (validated ${short(entry.validated.sha256)}, now ${short(sha256)})` : "draft was never validated", sha256);
  if (entry?.tested?.sha256 !== sha256) return reject(ctx, name, "activate", entry?.tested ? `draft changed since testing (tested ${short(entry.tested.sha256)}, now ${short(sha256)})` : "draft has not passed test_skill", sha256);
  const dest = resolveInside(ctx.workspaceDir, `${ACTIVE_DIR}/${name}`);
  if (!dest) return reject(ctx, name, "activate", `${ACTIVE_DIR}/${name} resolves outside the workspace`, sha256);
  let archivedPrior: string | undefined;
  if (existsSync(dest)) {
    const priorSha = hashDir(dest);
    const archive = path.join(ctx.nodeStateDir, "skill-versions", name, priorSha);
    if (!existsSync(archive)) copyRegularFiles(dest, archive);
    archivedPrior = priorSha;
    rmSync(dest, { recursive: true, force: true });
  }
  // Regular files only: a symlink planted in a draft is never carried into .claude/.
  copyRegularFiles(dir, dest);
  const copied = hashDir(dest);
  if (copied !== sha256) return reject(ctx, name, "activate", `copy verification failed (expected ${short(sha256)}, got ${short(copied)})`, sha256);
  updateLedger(ctx.nodeStateDir, name, (e) => e.activations.push({ sha256, at: now(), archivedPrior }));
  emitStage(ctx, name, "activated", archivedPrior ? `replaced prior version ${short(archivedPrior)} (archived)` : "first activation", sha256);
  let refresh: string;
  if (!ctx.refreshSkills) refresh = "this engine has no native skill refresh; the skill is available via load_skill";
  else {
    try {
      await ctx.refreshSkills();
      refresh = "native skill discovery refreshed";
    } catch (e) {
      refresh = `native skill refresh failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return {
    ok: true,
    content: `Activated ${name} at ${ACTIVE_DIR}/${name}/SKILL.md (sha ${short(sha256)}). ${refresh}.`,
    data: { stage: "activated", sha256, archivedPrior, refresh },
  };
}
