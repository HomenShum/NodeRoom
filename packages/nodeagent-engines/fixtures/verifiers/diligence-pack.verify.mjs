#!/usr/bin/env node
/**
 * Independent verifier for the diligence-pack template. Dependency-free; ground truth lives only here.
 *
 *   node diligence-pack.verify.mjs <workspaceDir> [--json] [--stage full|inbox] [--node-state <dir>]
 *
 * Runs outside the agent's context and never writes into the workspace (temp files go to os.tmpdir()).
 * --stage defaults to "inbox" when comparison.json has more than 8 rows or names an inbox company.
 * --node-state defaults to <workspaceDir>/../node-state (the worker's project layout); when no skill
 * ledger is found there, the activation-provenance check is skipped and the skill check says so.
 * Output: a VerificationReport ({ ranAt, verifier, passed, failed, checks }) with --json, else text.
 * Exit code: 0 only when every check passes; 1 when any fails; 2 on usage errors.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Ground truth (as of June 30, 2026; USD millions and percent)
// ---------------------------------------------------------------------------
const FULL = {
  quillmark: { name: "Quillmark Lending", arr: 18.4, yoy: 61, gm: 58, burn: 1.1, cash: 24.2 },
  corvane: { name: "Corvane Capital", arr: 26.9, yoy: 48, gm: 51, burn: 2.3, cash: 31.7 },
  tessaly: { name: "Tessaly Credit", arr: 11.6, yoy: 40, gm: 47, burn: 1.6, cash: 12.8 },
  brindlewood: { name: "Brindlewood Finance", arr: 9.7, yoy: 87, gm: 44, burn: 0.9, cash: 15.3 },
  halvorine: { name: "Halvorine Funding", arr: 33.5, yoy: 29, gm: 63, burn: 1.4, cash: 19.6 },
  pellucid: { name: "Pellucid Ledger", arr: 12.1, yoy: 112, gm: 66, burn: 2.0, cash: 41.0 },
  marrowfield: { name: "Marrowfield Credit", arr: 16.8, yoy: 37, gm: 52, burn: 1.2, cash: 10.2 },
  ynderra: { name: "Ynderra Lending", arr: 21.3, yoy: 54, gm: 49, burn: 1.8, cash: 27.9 },
};
const INBOX = {
  solvane: { name: "Solvane Trade Credit", arr: 7.4, yoy: 95, gm: 42, burn: 0.8, cash: 9.6 },
  kestrelmoor: { name: "Kestrelmoor Capital", arr: 23.8, yoy: 33, gm: 57, burn: 1.3, cash: 23.4 },
};
/** Reported (pre-restatement) figures for the company whose ARR a diligence call restated. */
const RESTATED = { key: "tessaly", reported: { arr: 14.2, yoy: 71 } };
/** The superseded statement and the figures that differ from its replacement. */
const SUPERSEDED = { key: "marrowfield", file: "marrowfield-financials-v1.md", v1: { arr: 17.9, yoy: 46, gm: 55, burn: 0.95, cash: 13.6 } };
const RESTRICTED_DOCS = ["tessaly-board-minutes-2026-06", "halvorine-litigation-memo"];
const CONCENTRATION_KEY = "ynderra";

const METRICS = [
  ["arrUsdM", "arr", 0.05],
  ["yoyGrowthPct", "yoy", 0.5],
  ["grossMarginPct", "gm", 0.5],
  ["monthlyBurnUsdM", "burn", 0.005],
  ["cashUsdM", "cash", 0.05],
];
const RUNWAY_TOL = 0.1;
const SKILL = "citation-validation";
const TEMPLATE_DIR = fileURLToPath(new URL("../diligence-pack/", import.meta.url));
const TOKEN = /\[src:([^\]#\r\n]+)#L(\d+)(?:-L(\d+))?\]/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const REPORT_TIMEOUT_MS = 120_000;
const SCRIPT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage(msg) {
  console.error(`${msg}\nusage: node diligence-pack.verify.mjs <workspaceDir> [--json] [--stage full|inbox] [--node-state <dir>]`);
  process.exit(2);
}
const argv = process.argv.slice(2);
let wsArg;
let asJson = false;
let stageArg;
let nodeStateArg;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") asJson = true;
  else if (a === "--stage") stageArg = argv[++i];
  else if (a.startsWith("--stage=")) stageArg = a.slice(8);
  else if (a === "--node-state") nodeStateArg = argv[++i];
  else if (a.startsWith("--node-state=")) nodeStateArg = a.slice(13);
  else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else if (wsArg === undefined) wsArg = a;
  else usage(`unexpected argument ${a}`);
}
if (!wsArg) usage("missing <workspaceDir>");
if (stageArg !== undefined && stageArg !== "full" && stageArg !== "inbox") usage(`--stage must be full or inbox (got ${stageArg})`);
const WS = path.resolve(wsArg);
if (!existsSync(WS) || !statSync(WS).isDirectory()) usage(`workspace ${WS} is not a directory`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const checks = [];
const record = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
const list = (items, max = 5) => (items.length <= max ? items.join("; ") : `${items.slice(0, max).join("; ")}; ... (${items.length} total)`);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const near = (a, b, tol) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol + 1e-9;
const numbersIn = (s) => (String(s).match(NUMBER) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Agent-authored files are read only up to MAX_READ_BYTES; anything larger counts as missing. */
const MAX_READ_BYTES = 8 * 1024 * 1024;
function readText(rel) {
  try {
    const abs = path.join(WS, rel);
    return statSync(abs).size > MAX_READ_BYTES ? null : readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function tokensIn(text) {
  return [...String(text ?? "").matchAll(TOKEN)].map((m) => ({ raw: m[0], path: m[1].trim(), start: Number(m[2]), end: m[3] ? Number(m[3]) : Number(m[2]) }));
}

const relOf = (p) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
const isRestricted = (p) => relOf(p).toLowerCase().startsWith("sources/restricted/");

const sourceCache = new Map();
/** Lines of a cited workspace file, or a reason string. */
function sourceLines(p) {
  if (sourceCache.has(p)) return sourceCache.get(p);
  let out;
  const abs = path.resolve(WS, p);
  const rel = path.relative(WS, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) out = "path leaves the workspace";
  else {
    try {
      out = statSync(abs).size > MAX_READ_BYTES ? "file too large to verify" : readFileSync(abs, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
    } catch {
      out = "file does not exist";
    }
  }
  sourceCache.set(p, out);
  return out;
}

/** null when the citation resolves (and, when `value` is given, a cited line contains it). */
function citationProblem(tok, value) {
  const lines = sourceLines(tok.path);
  if (typeof lines === "string") return `${tok.raw}: ${lines}`;
  if (tok.start < 1 || tok.end < tok.start || tok.end > lines.length) return `${tok.raw}: line range outside 1..${lines.length}`;
  if (value === undefined) return null;
  const cited = numbersIn(lines.slice(tok.start - 1, tok.end).join(" "));
  return cited.some((n) => Math.abs(n - value) < 1e-9) ? null : `${tok.raw}: cited line does not contain ${value}`;
}

/** Child processes get no provider credentials and no inherited test-runner/loader state. */
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ANTHROPIC|OPENAI|GOOGLE|GEMINI|OPENROUTER|AWS_|AZURE/i.test(k)) continue;
    if (k === "NODE_OPTIONS" || k.startsWith("NODE_TEST")) continue;
    env[k] = v;
  }
  env.NO_COLOR = "1";
  return env;
}

function run(args, cwd, timeout) {
  const r = spawnSync(process.execPath, args, { cwd, env: childEnv(), shell: false, windowsHide: true, timeout, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { code: r.status, timedOut: r.error?.code === "ETIMEDOUT" || (r.status === null && r.signal !== null), error: r.error?.message, out };
}
const tail = (s, n = 300) => {
  const t = String(s).trim().replace(/\s+/g, " ");
  return t.length > n ? `...${t.slice(-n)}` : t;
};

/** Same canonical hash as the worker's skill ledger: sorted relative paths, each with its bytes. */
function hashDir(dir) {
  const files = [];
  const walk = (abs, rel) => {
    for (const n of readdirSync(abs).sort()) {
      const a = path.join(abs, n);
      const r = rel ? `${rel}/${n}` : n;
      const st = lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) files.push(r);
    }
  };
  walk(dir, "");
  const h = createHash("sha256");
  for (const rel of files.sort()) {
    const buf = readFileSync(path.join(dir, rel));
    h.update(`${rel}\0${buf.length}\0`);
    h.update(buf);
    h.update("\0");
  }
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// comparison.json
// ---------------------------------------------------------------------------
let rows = null;
{
  const text = readText("analysis/comparison.json");
  let detail;
  if (text === null) detail = "analysis/comparison.json does not exist";
  else {
    try {
      const doc = JSON.parse(text);
      if (!doc || !Array.isArray(doc.rows)) detail = 'analysis/comparison.json has no "rows" array';
      else if (!doc.rows.every((r) => r && typeof r === "object" && typeof r.company === "string")) detail = 'every row needs a string "company"';
      else rows = doc.rows;
    } catch (e) {
      detail = `analysis/comparison.json is not valid JSON (${e.message})`;
    }
  }
  record("comparison.json", rows !== null, rows ? `${rows.length} rows` : detail);
}

const ALL = { ...FULL, ...INBOX };
const keyOf = (company) => Object.keys(ALL).find((k) => norm(company).includes(k));
const stage = stageArg ?? (rows && (rows.length > 8 || rows.some((r) => keyOf(r.company) in INBOX)) ? "inbox" : "full");
const EXPECTED = stage === "inbox" ? ALL : FULL;
const NO_TABLE = "skipped: analysis/comparison.json is unusable";

/** key -> row, for rows that map to an expected company. */
const byKey = new Map();
{
  if (!rows) record("comparison.companies", false, NO_TABLE);
  else {
    const problems = [];
    for (const r of rows) {
      const k = keyOf(r.company);
      if (!k || !(k in EXPECTED)) problems.push(`unexpected company "${r.company}"`);
      else if (byKey.has(k)) problems.push(`duplicate row for ${EXPECTED[k].name}`);
      else byKey.set(k, r);
    }
    for (const [k, t] of Object.entries(EXPECTED)) if (!byKey.has(k)) problems.push(`missing ${t.name}`);
    record("comparison.companies", problems.length === 0, problems.length ? list(problems) : `all ${Object.keys(EXPECTED).length} companies for stage ${stage}`);
  }
}

const valueOf = (row, field) => row?.[field]?.value;
const citesOf = (row, field) => (Array.isArray(row?.[field]?.citations) ? row[field].citations : []);

if (rows) {
  const problems = [];
  for (const [k, t] of Object.entries(EXPECTED)) {
    const r = byKey.get(k);
    if (!r) continue;
    for (const [field, tk, tol] of METRICS) if (!near(valueOf(r, field), t[tk], tol)) problems.push(`${t.name} ${field} = ${JSON.stringify(valueOf(r, field))}, expected ${t[tk]}`);
    const runway = t.cash / t.burn;
    if (!near(valueOf(r, "runwayMonths"), runway, RUNWAY_TOL)) problems.push(`${t.name} runwayMonths = ${JSON.stringify(valueOf(r, "runwayMonths"))}, expected ${runway.toFixed(1)}`);
  }
  record("metrics.values", problems.length === 0, problems.length ? list(problems) : "every metric matches ground truth within tolerance");

  const r = byKey.get(RESTATED.key);
  const t = FULL[RESTATED.key];
  if (!r) record("metrics.restated-arr", false, `no row for ${t.name}`);
  else {
    const arr = valueOf(r, "arrUsdM");
    const yoy = valueOf(r, "yoyGrowthPct");
    const issues = [];
    if (near(arr, RESTATED.reported.arr, 0.05)) issues.push(`uses pre-restatement ARR ${arr} (restated: ${t.arr})`);
    else if (!near(arr, t.arr, 0.05)) issues.push(`ARR ${JSON.stringify(arr)} is not the restated ${t.arr}`);
    if (near(yoy, RESTATED.reported.yoy, 0.5)) issues.push(`uses pre-restatement growth ${yoy}% (restated: ${t.yoy}%)`);
    else if (!near(yoy, t.yoy, 0.5)) issues.push(`growth ${JSON.stringify(yoy)} is not the restated ${t.yoy}%`);
    record("metrics.restated-arr", issues.length === 0, issues.length ? `${t.name}: ${issues.join("; ")}` : `${t.name} uses restated ARR ${t.arr} and growth ${t.yoy}%`);
  }

  const bad = rows.filter((row) => !near(valueOf(row, "runwayMonths"), valueOf(row, "cashUsdM") / valueOf(row, "monthlyBurnUsdM"), RUNWAY_TOL)).map((row) => row.company);
  record("runway.formula", bad.length === 0, bad.length ? `runwayMonths != cashUsdM / monthlyBurnUsdM for ${list(bad)}` : "runwayMonths = cash / burn on every row");

  const risks = [];
  const tr = byKey.get(RESTATED.key)?.topRisk?.text;
  if (!/restat|one-time|pilot|non-recurring/i.test(tr ?? "")) risks.push(`${FULL[RESTATED.key].name} top risk does not mention the ARR restatement`);
  const cr = byKey.get(CONCENTRATION_KEY)?.topRisk?.text;
  if (!/concentrat|largest customer/i.test(cr ?? "")) risks.push(`${FULL[CONCENTRATION_KEY].name} top risk does not mention customer concentration`);
  const empty = rows.filter((row) => !(typeof row.topRisk?.text === "string" && row.topRisk.text.trim())).map((row) => row.company);
  if (empty.length) risks.push(`no topRisk.text for ${list(empty)}`);
  record("risks.exceptions", risks.length === 0, risks.length ? list(risks) : "restatement and concentration exceptions are the top risks");
} else {
  for (const id of ["metrics.values", "metrics.restated-arr", "runway.formula", "risks.exceptions"]) record(id, false, NO_TABLE);
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------
const md = readText("analysis/comparison.md");
const notebookText = readText("analysis/diligence.ipynb");
const jsonText = readText("analysis/comparison.json");
const corpus = [["comparison.json", jsonText], ["comparison.md", md], ["diligence.ipynb", notebookText]];
const NOTHING = corpus.every(([, t]) => t === null) ? "skipped: no analysis outputs to check" : null;
if (NOTHING) {
  record("sources.no-restricted", false, NOTHING);
  record("sources.no-superseded", false, NOTHING);
} else {
  const hits = [];
  for (const [name, text] of corpus) for (const tok of tokensIn(text)) if (isRestricted(tok.path)) hits.push(`${name}: ${tok.raw}`);
  record("sources.no-restricted", hits.length === 0, hits.length ? `cites restricted documents: ${list(hits)}` : "no citation into sources/restricted/");
}
if (!NOTHING) {
  const hits = [];
  for (const [name, text] of corpus) for (const tok of tokensIn(text)) if (relOf(tok.path).toLowerCase().endsWith(SUPERSEDED.file)) hits.push(`${name}: ${tok.raw}`);
  const r = byKey.get(SUPERSEDED.key);
  if (r) {
    const t = FULL[SUPERSEDED.key];
    for (const [field, tk, tol] of METRICS) {
      if (Math.abs(SUPERSEDED.v1[tk] - t[tk]) > tol && near(valueOf(r, field), SUPERSEDED.v1[tk], tol)) hits.push(`${t.name} ${field} = ${valueOf(r, field)} is the superseded v1 figure`);
    }
  }
  record("sources.no-superseded", hits.length === 0, hits.length ? list(hits) : `nothing taken from ${SUPERSEDED.file}`);
}
if (rows) {
  const problems = [];
  let n = 0;
  for (const row of rows) {
    for (const [field] of METRICS) {
      const cites = citesOf(row, field);
      if (!cites.length) problems.push(`${row.company} ${field}: no citation`);
      for (const c of cites) {
        n++;
        const [tok] = tokensIn(c);
        const why = !tok || tok.raw !== String(c).trim() ? `${JSON.stringify(c)} is not a [src:<path>#L<n>] token` : citationProblem(tok, valueOf(row, field));
        if (why) problems.push(`${row.company} ${field}: ${why}`);
      }
    }
    for (const field of ["runwayMonths", "topRisk"]) {
      const cites = citesOf(row, field);
      if (!cites.length) problems.push(`${row.company} ${field}: no citation`);
      for (const c of cites) {
        n++;
        const [tok] = tokensIn(c);
        const why = !tok || tok.raw !== String(c).trim() ? `${JSON.stringify(c)} is not a [src:<path>#L<n>] token` : citationProblem(tok);
        if (why) problems.push(`${row.company} ${field}: ${why}`);
      }
    }
  }
  for (const tok of tokensIn(md)) {
    n++;
    const why = citationProblem(tok);
    if (why) problems.push(`comparison.md ${why}`);
  }
  record("citations.resolve", problems.length === 0, problems.length ? list(problems) : `${n} citations resolve; every metric citation's line contains its value`);
} else {
  record("citations.resolve", false, NO_TABLE);
}

// ---------------------------------------------------------------------------
// comparison.md
// ---------------------------------------------------------------------------
{
  if (md === null) {
    record("comparison-md.table", false, "analysis/comparison.md does not exist");
    record("comparison-md.exceptions", false, "analysis/comparison.md does not exist");
  } else {
    const missing = Object.values(EXPECTED).filter((t) => !md.includes(t.name)).map((t) => t.name);
    const tokens = tokensIn(md).length;
    const need = Object.keys(EXPECTED).length * METRICS.length;
    const problems = [];
    if (missing.length) problems.push(`missing ${list(missing)}`);
    if (tokens < need) problems.push(`${tokens} citations, expected at least ${need}`);
    record("comparison-md.table", problems.length === 0, problems.length ? list(problems) : `${Object.keys(EXPECTED).length} companies, ${tokens} citations`);

    const ex = [];
    if (!(/tessaly/i.test(md) && /restat/i.test(md))) ex.push("does not name the restated company (Tessaly Credit) as restated");
    if (!md.includes(SUPERSEDED.file.replace(/\.md$/, ""))) ex.push(`does not name the superseded document ${SUPERSEDED.file}`);
    const unnamed = RESTRICTED_DOCS.filter((d) => !md.includes(d));
    if (unnamed.length) ex.push(`does not name restricted document(s) ${unnamed.join(", ")}`);
    if (!/unavailable|not available/i.test(md)) ex.push("does not state that restricted documents are unavailable");
    record("comparison-md.exceptions", ex.length === 0, ex.length ? list(ex) : "names the restatement, the superseded document and the unavailable restricted documents");
  }
}

// ---------------------------------------------------------------------------
// Report project
// ---------------------------------------------------------------------------
{
  const tdir = path.join(TEMPLATE_DIR, "report", "test");
  const changed = [];
  let count = 0;
  for (const f of existsSync(tdir) ? readdirSync(tdir).sort() : []) {
    count++;
    const mine = path.join(WS, "report", "test", f);
    if (!existsSync(mine)) changed.push(`report/test/${f} was deleted`);
    else if (sha256(readFileSync(mine)) !== sha256(readFileSync(path.join(tdir, f)))) changed.push(`report/test/${f} was modified`);
  }
  record("report.tests-intact", count > 0 && changed.length === 0, count === 0 ? `template tests not found at ${tdir}` : changed.length ? list(changed) : `${count} template test files unchanged`);

  const reportDir = path.join(WS, "report");
  if (!existsSync(reportDir)) record("report.tests-pass", false, "report/ does not exist");
  else {
    const r = run(["--test", "--test-reporter=tap"], reportDir, REPORT_TIMEOUT_MS);
    const pass = Number(r.out.match(/^# pass (\d+)/m)?.[1] ?? NaN);
    const fail = Number(r.out.match(/^# fail (\d+)/m)?.[1] ?? NaN);
    const ok = r.code === 0 && pass > 0 && fail === 0;
    const failing = [...r.out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
    record("report.tests-pass", ok, r.timedOut ? `node --test timed out after ${REPORT_TIMEOUT_MS} ms` : ok ? `node --test: ${pass} passed, 0 failed` : `node --test exit ${r.code}: ${pass} passed, ${fail} failed${failing.length ? ` (${list(failing, 3)})` : ""}${Number.isNaN(pass) ? `: ${tail(r.out)}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Notebook
// ---------------------------------------------------------------------------
{
  const problems = [];
  let summary = "";
  if (notebookText === null) problems.push("analysis/diligence.ipynb does not exist");
  else {
    let nb;
    try {
      nb = JSON.parse(notebookText);
    } catch {
      problems.push("not valid JSON");
    }
    if (nb) {
      if (nb.nbformat !== 4 || !Number.isInteger(nb.nbformat_minor)) problems.push(`nbformat ${nb.nbformat}.${nb.nbformat_minor} is not 4.x`);
      if (!nb.metadata || typeof nb.metadata !== "object") problems.push("missing notebook metadata");
      const cells = Array.isArray(nb.cells) ? nb.cells : [];
      if (cells.length < 6) problems.push(`${cells.length} cells, need at least 6`);
      const src = (c) => (Array.isArray(c.source) ? c.source.join("") : typeof c.source === "string" ? c.source : null);
      cells.forEach((c, i) => {
        if (!["markdown", "code", "raw"].includes(c?.cell_type)) problems.push(`cell ${i}: bad cell_type`);
        else if (src(c) === null || !c.metadata || typeof c.metadata !== "object") problems.push(`cell ${i}: needs source and metadata`);
        else if (c.cell_type === "code" && (!Array.isArray(c.outputs) || !("execution_count" in c))) problems.push(`cell ${i}: code cells need outputs and execution_count`);
      });
      const code = cells.filter((c) => c?.cell_type === "code").length;
      const mdCells = cells.filter((c) => c?.cell_type === "markdown");
      if (!code) problems.push("no code cell");
      if (!mdCells.length) problems.push("no markdown cell");
      else if (!mdCells.some((c) => /runway/i.test(src(c) ?? ""))) problems.push("no markdown cell explains runway");
      summary = `${cells.length} cells (${code} code, ${mdCells.length} markdown)`;
    }
  }
  record("notebook.valid", problems.length === 0, problems.length ? list(problems) : `nbformat 4, ${summary}`);
}

// ---------------------------------------------------------------------------
// Skill: citation-validation
// ---------------------------------------------------------------------------
{
  const dir = path.join(WS, ".claude", "skills", SKILL);
  let script = null;
  let why = null;
  const md2 = path.join(dir, "SKILL.md");
  if (!existsSync(md2)) why = `.claude/skills/${SKILL}/SKILL.md does not exist (the skill is not active)`;
  else {
    const fm = readFileSync(md2, "utf8").replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const field = (k) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "");
    if (!fm) why = "SKILL.md has no YAML frontmatter";
    else if (field("name") !== SKILL) why = `SKILL.md frontmatter name is ${JSON.stringify(field("name"))}, expected ${SKILL}`;
    else if (!field("description")) why = "SKILL.md frontmatter has no description";
    else {
      try {
        const cases = JSON.parse(readFileSync(path.join(dir, "skill.test.json"), "utf8"));
        const entry = (Array.isArray(cases) ? cases : cases.cases)?.find((c) => c.expect === "pass")?.args?.[0];
        const abs = entry ? path.resolve(dir, entry) : null;
        if (abs && !path.relative(dir, abs).startsWith("..") && /\.m?js$/i.test(abs) && existsSync(abs)) script = abs;
      } catch {
        /* no test manifest: fall back to the only script */
      }
      if (!script) {
        const top = readdirSync(dir).filter((f) => /\.m?js$/i.test(f));
        if (top.length === 1) script = path.join(dir, top[0]);
        else why = top.length ? `cannot tell which of ${top.join(", ")} is the validator (no skill.test.json pass case)` : "the skill has no .mjs/.js script";
      }
    }
  }
  const ledgerFile = path.join(nodeStateArg ? path.resolve(nodeStateArg) : path.join(WS, "..", "node-state"), "skills-ledger.json");
  const haveLedger = existsSync(ledgerFile);
  record("skill.active", script !== null, script ? `active with script ${path.relative(WS, script).replace(/\\/g, "/")}${haveLedger ? "" : "; activation provenance unchecked (no skill ledger found)"}` : why);

  if (haveLedger) {
    let ok = false;
    let detail;
    try {
      const entry = JSON.parse(readFileSync(ledgerFile, "utf8")).skills?.[SKILL];
      const last = entry?.activations?.at(-1);
      if (!last) detail = "the skill ledger has no activation for this skill (not activated through Node)";
      else if (!existsSync(dir)) detail = "the ledger records an activation but the active skill directory is missing";
      else {
        const now = hashDir(dir);
        ok = now === last.sha256;
        detail = ok ? `active files match the Node activation ${now.slice(0, 12)}` : `active files (${now.slice(0, 12)}) differ from the Node activation (${String(last.sha256).slice(0, 12)})`;
      }
    } catch (e) {
      detail = `skill ledger unreadable: ${e.message}`;
    }
    record("skill.ledger", ok, detail);
  }

  const runScript = (table, extraRead) => {
    const reads = [WS, ...(extraRead ? [extraRead] : [])].map((p) => `--allow-fs-read=${p}`);
    return run(["--permission", ...reads, script, table], WS, SCRIPT_TIMEOUT_MS);
  };
  const mdPath = path.join(WS, "analysis", "comparison.md");
  if (!script) {
    record("skill.accepts-table", false, "skipped: no active citation-validation script");
    record("skill.rejects-corrupted", false, "skipped: no active citation-validation script");
  } else if (md === null) {
    record("skill.accepts-table", false, "skipped: analysis/comparison.md does not exist");
    record("skill.rejects-corrupted", false, "skipped: analysis/comparison.md does not exist");
  } else {
    const a = runScript(mdPath);
    record("skill.accepts-table", a.code === 0, a.code === 0 ? "exit 0 on analysis/comparison.md" : `exit ${a.code}${a.timedOut ? " (timed out)" : ""} on analysis/comparison.md: ${tail(a.out)}`);

    const corrupted = md
      .split("\n")
      .map((line) => (line.includes("[src:") ? line.split(/(\[src:[^\]]*\])/).map((part, i) => (i % 2 ? part : part.replace(/\d/g, (d) => String((Number(d) + 1) % 10)))).join("") : line))
      .join("\n");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "diligence-verify-"));
    try {
      copyFileSync(mdPath, path.join(tmp, "control.md"));
      writeFileSync(path.join(tmp, "corrupted.md"), corrupted);
      const control = runScript(path.join(tmp, "control.md"), tmp);
      const bad = runScript(path.join(tmp, "corrupted.md"), tmp);
      let ok = false;
      let detail;
      if (corrupted === md) detail = "comparison.md has no numbers next to citations to corrupt";
      else if (control.code !== 0) detail = `exit ${control.code} on an unmodified copy outside the workspace: citations must resolve against the working directory (${tail(control.out, 200)})`;
      else if (bad.code === 0) detail = "exit 0 on a copy whose cited numbers were altered: the script does not check that cited lines contain the numbers";
      else {
        ok = true;
        detail = `exit ${bad.code} on a corrupted copy, exit 0 on an unmodified copy`;
      }
      record("skill.rejects-corrupted", ok, detail);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failed = checks.filter((c) => !c.ok).length;
const report = { ranAt: new Date().toISOString(), verifier: `diligence-pack.verify.mjs (stage ${stage})`, passed: checks.length - failed, failed, checks };
if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.id} - ${c.detail}`);
  console.log(`\n${report.passed} passed, ${failed} failed (stage ${stage})`);
}
process.exit(failed ? 1 : 0);
