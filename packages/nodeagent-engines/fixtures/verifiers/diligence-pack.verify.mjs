#!/usr/bin/env node
/**
 * Independent verifier for the diligence-pack template. Dependency-free; ground truth lives only here.
 *
 *   node diligence-pack.verify.mjs <workspaceDir> [--json] [--stage full|inbox|deep] [--node-state <dir>]
 *
 * Runs outside the agent's context and never writes into the workspace (temp files go to os.tmpdir()).
 * --stage defaults to "deep" when any deep deliverable exists (analysis/memos/, analysis/risk-matrix.md,
 * analysis/sensitivity.json or the memo-lint skill), else to "inbox" when comparison.json has more
 * than 8 rows or names an inbox company, else "full". "deep" checks all ten companies plus the memos,
 * risk matrix, burn stress test, html export and the memo-lint skill.
 * --node-state defaults to <workspaceDir>/../node-state (the worker's project layout); when no skill
 * ledger is found there, the activation-provenance check is skipped and the skill check says so.
 * Output: a VerificationReport ({ ranAt, verifier, passed, failed, checks }) with --json, else text.
 * Exit code: 0 only when every check passes; 1 when any fails; 2 on usage errors.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
/** Where the restatement and the concentration are recorded, and the concentration figure (% of ARR). */
const RESTATED_CALL = "sources/diligence-calls/tessaly-call-notes.md";
const CONCENTRATION = { call: "sources/diligence-calls/ynderra-call-notes.md", sharePct: 46 };

// Deep stage
const MEMO_SECTIONS = ["Overview", "Financials", "Risks", "Exceptions", "Sources"];
const MIN_MEMO_CITATIONS = 6;
const RISK_COLUMNS = [["credit", /credit/], ["concentration", /concentration/], ["regulatory", /regulat/], ["liquidity", /liquidity/], ["dataQuality", /data[\s-]*quality/]];
const RATINGS = new Set(["low", "medium", "high"]);
const STRESS = [["base", 1], ["burnUp20", 1.2], ["burnDown20", 0.8]];
const LIQUIDITY_PROCEED_MONTHS = 12;
const LIQUIDITY_DECLINE_MONTHS = 9;
/** Figures every memo must state with a citation (fields of FULL/INBOX). */
const MEMO_CORE = [["ARR", "arr"], ["monthly burn", "burn"], ["cash", "cash"]];
/** Deep-stage citations may span at most this many lines: a figure sits on one line; a short range is a convenience. */
const MAX_CITED_LINES = 3;
/** Any of these in a workspace selects the deep stage when --stage is not given. */
const DEEP_ARTIFACTS = ["analysis/memos", "analysis/risk-matrix.md", "analysis/sensitivity.json", ".claude/skills/memo-lint"];
const MEMO_LINT = "memo-lint";
const HTML_PROBE_MARK = "@@diligence-verify-html@@";

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
  console.error(`${msg}\nusage: node diligence-pack.verify.mjs <workspaceDir> [--json] [--stage full|inbox|deep] [--node-state <dir>]`);
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
if (stageArg !== undefined && !["full", "inbox", "deep"].includes(stageArg)) usage(`--stage must be full, inbox or deep (got ${stageArg})`);
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

const BOUNDARY = /[.!?;:]\s+(?=\S)/g;
/**
 * Citations of a prose document, each with the figure written right before it: the last number back to
 * the previous citation, `|` cell border or sentence start (undefined when that stretch has no number).
 */
function citedFigures(text) {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    let from = 0;
    for (const m of line.matchAll(TOKEN)) {
      let seg = line.slice(from, m.index);
      from = m.index + m[0].length;
      seg = seg.slice(seg.lastIndexOf("|") + 1);
      let cut = 0;
      for (const b of seg.matchAll(BOUNDARY)) cut = b.index + b[0].length;
      out.push({ ...tokensIn(m[0])[0], line: i + 1, figure: numbersIn(seg.slice(cut)).at(-1) });
    }
  });
  return out;
}

/** Every digit outside the citation tokens on lines that carry a citation, shifted by one. */
const corruptCitedNumbers = (text) =>
  text
    .split("\n")
    .map((line) => (line.includes("[src:") ? line.split(/(\[src:[^\]]*\])/).map((part, i) => (i % 2 ? part : part.replace(/\d/g, (d) => String((Number(d) + 1) % 10)))).join("") : line))
    .join("\n");

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
const MEMOS_DIR = path.join(WS, "analysis", "memos");
const stage = stageArg ?? (DEEP_ARTIFACTS.some((p) => existsSync(path.join(WS, p))) ? "deep" : rows && (rows.length > 8 || rows.some((r) => keyOf(r.company) in INBOX)) ? "inbox" : "full");
const EXPECTED = stage === "full" ? FULL : ALL;
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
// Skills (activated through Node into .claude/skills/<name>)
// ---------------------------------------------------------------------------
const ledgerFile = path.join(nodeStateArg ? path.resolve(nodeStateArg) : path.join(WS, "..", "node-state"), "skills-ledger.json");
const haveLedger = existsSync(ledgerFile);

/** The active skill's script (named by its skill.test.json pass case, else its only top-level script), or why there is none. */
function activeSkill(name, role) {
  const dir = path.join(WS, ".claude", "skills", name);
  let script = null;
  let why = null;
  const skillMd = path.join(dir, "SKILL.md");
  if (!existsSync(skillMd)) why = `.claude/skills/${name}/SKILL.md does not exist (the skill is not active)`;
  else {
    const fm = readFileSync(skillMd, "utf8").replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const field = (k) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "");
    if (!fm) why = "SKILL.md has no YAML frontmatter";
    else if (field("name") !== name) why = `SKILL.md frontmatter name is ${JSON.stringify(field("name"))}, expected ${name}`;
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
        else why = top.length ? `cannot tell which of ${top.join(", ")} is the ${role} (no skill.test.json pass case)` : "the skill has no .mjs/.js script";
      }
    }
  }
  return { dir, script, why };
}

function recordActive(id, skill) {
  record(id, skill.script !== null, skill.script ? `active with script ${path.relative(WS, skill.script).replace(/\\/g, "/")}${haveLedger ? "" : "; activation provenance unchecked (no skill ledger found)"}` : skill.why);
}

/** Proves the active files are byte-identical to the last activation Node recorded (only when a ledger exists). */
function recordLedger(id, name, dir) {
  if (!haveLedger) return;
  let ok = false;
  let detail;
  try {
    const entry = JSON.parse(readFileSync(ledgerFile, "utf8")).skills?.[name];
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
  record(id, ok, detail);
}

/** Runs an agent skill script under Node's permission model: read-only, workspace (+ one temp dir), cwd = workspace. */
const runSkill = (script, target, extraRead) => {
  const reads = [WS, ...(extraRead ? [extraRead] : [])].map((p) => `--allow-fs-read=${p}`);
  return run(["--permission", ...reads, script, target], WS, SCRIPT_TIMEOUT_MS);
};

// citation-validation
{
  const skill = activeSkill(SKILL, "validator");
  const { script } = skill;
  recordActive("skill.active", skill);
  recordLedger("skill.ledger", SKILL, skill.dir);

  const mdPath = path.join(WS, "analysis", "comparison.md");
  if (!script) {
    record("skill.accepts-table", false, "skipped: no active citation-validation script");
    record("skill.rejects-corrupted", false, "skipped: no active citation-validation script");
  } else if (md === null) {
    record("skill.accepts-table", false, "skipped: analysis/comparison.md does not exist");
    record("skill.rejects-corrupted", false, "skipped: analysis/comparison.md does not exist");
  } else {
    const a = runSkill(script, mdPath);
    record("skill.accepts-table", a.code === 0, a.code === 0 ? "exit 0 on analysis/comparison.md" : `exit ${a.code}${a.timedOut ? " (timed out)" : ""} on analysis/comparison.md: ${tail(a.out)}`);

    const corrupted = corruptCitedNumbers(md);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "diligence-verify-"));
    try {
      copyFileSync(mdPath, path.join(tmp, "control.md"));
      writeFileSync(path.join(tmp, "corrupted.md"), corrupted);
      const control = runSkill(script, path.join(tmp, "control.md"), tmp);
      const bad = runSkill(script, path.join(tmp, "corrupted.md"), tmp);
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
// Deep stage: memos, risk matrix, burn stress test, html export, memo-lint
// ---------------------------------------------------------------------------
if (stage === "deep") {
  // Deep-stage evidence rule. Paths are normalized first so "sources/x/../restricted/..." cannot pass as a source.
  const srcRel = (p) => path.posix.normalize(relOf(p)).toLowerCase();
  const restrictedDeep = (p) => srcRel(p).startsWith("sources/restricted/");
  /** null when the citation names a non-superseded document under sources/, spans at most MAX_CITED_LINES lines and resolves (with `value` on the cited lines). */
  const evidenceProblem = (tok, value) => {
    const rel = srcRel(tok.path);
    if (!rel.startsWith("sources/")) return `${tok.raw}: ${tok.path} is not a source document under sources/`;
    if (rel.endsWith(SUPERSEDED.file)) return `${tok.raw}: cites the superseded statement`;
    if (tok.end - tok.start + 1 > MAX_CITED_LINES) return `${tok.raw}: spans ${tok.end - tok.start + 1} lines (at most ${MAX_CITED_LINES}); cite the line that holds the figure`;
    return citationProblem(tok, value);
  };
  /** Problems with a prose document's citations: not a source, unresolved, out of range, or the figure before it not on the cited line. */
  const proseProblems = (name, text, { skipRestricted }) => {
    const problems = [];
    for (const c of citedFigures(text)) {
      if (skipRestricted && restrictedDeep(c.path)) continue;
      const why = evidenceProblem(c, c.figure);
      if (why) problems.push(`${name} line ${c.line}: ${why}`);
    }
    return problems;
  };
  /** True when `text` writes `value` right before a valid citation (into `file`, when given). */
  const citesFigure = (text, value, file) => citedFigures(text).some((c) => (!file || srcRel(c.path) === file) && near(c.figure, value, 1e-9) && !evidenceProblem(c, c.figure));
  const r1 = (x) => Math.round(x * 10) / 10;
  const UP = Object.fromEntries(STRESS).burnUp20;

  // ---- memos
  /** key -> { file, text } */
  const memos = new Map();
  const memoIds = ["memos.present", "memos.sections", "memos.citations", "memos.no-restricted", "memos.restatement", "memos.concentration"];
  if (!existsSync(MEMOS_DIR) || !statSync(MEMOS_DIR).isDirectory()) {
    record("memos.present", false, "analysis/memos/ does not exist");
    for (const id of memoIds.slice(1)) record(id, false, "skipped: analysis/memos/ does not exist");
  } else {
    const problems = [];
    for (const f of readdirSync(MEMOS_DIR).filter((n) => /\.md$/i.test(n)).sort()) {
      const k = keyOf(f);
      if (!k) continue; // not a company memo (an index or notes file)
      if (memos.has(k)) problems.push(`two memos for ${ALL[k].name} (${memos.get(k).file}, analysis/memos/${f})`);
      else {
        const text = readText(`analysis/memos/${f}`);
        if (text !== null) memos.set(k, { file: `analysis/memos/${f}`, text });
      }
    }
    for (const [k, t] of Object.entries(EXPECTED)) if (!memos.has(k)) problems.push(`missing memo for ${t.name}`);
    record("memos.present", problems.length === 0, problems.length ? list(problems) : `${memos.size} company memos in analysis/memos/`);

    const sections = [];
    for (const [k, { file, text }] of memos) {
      const headings = [...text.matchAll(/^#{1,6}[ \t]+(.+)$/gm)].map((m) => m[1].toLowerCase());
      const missing = MEMO_SECTIONS.filter((s) => !headings.some((h) => h.includes(s.toLowerCase())));
      if (missing.length) sections.push(`${file} has no ${missing.join(", ")} section`);
      if (!text.includes(ALL[k].name)) sections.push(`${file} does not name ${ALL[k].name}`);
    }
    record("memos.sections", sections.length === 0, sections.length ? list(sections) : `every memo names its company and has ${MEMO_SECTIONS.join(", ")} sections`);

    const cites = [];
    let n = 0;
    for (const { file, text } of memos.values()) {
      const count = tokensIn(text).length;
      n += count;
      if (count < MIN_MEMO_CITATIONS) cites.push(`${file}: ${count} citations, need at least ${MIN_MEMO_CITATIONS}`);
      cites.push(...proseProblems(file, text, { skipRestricted: true }));
    }
    for (const [k, { file, text }] of memos) {
      const missing = MEMO_CORE.filter(([, f]) => !citesFigure(text, ALL[k][f])).map(([label, f]) => `${label} ${ALL[k][f]}`);
      if (missing.length) cites.push(`${file} does not state its ${missing.join(", ")} with a citation to a source line holding it`);
    }
    record("memos.citations", cites.length === 0, cites.length ? list(cites) : `${n} memo citations resolve to source lines; every cited figure is on its cited line; every memo cites its ARR, burn and cash`);

    const hits = [];
    for (const { file, text } of memos.values()) for (const tok of tokensIn(text)) if (restrictedDeep(tok.path)) hits.push(`${file}: ${tok.raw}`);
    record("memos.no-restricted", hits.length === 0, hits.length ? `cites restricted documents: ${list(hits)}` : "no memo cites sources/restricted/");

    const rm = memos.get(RESTATED.key);
    const rt = FULL[RESTATED.key];
    const restIssues = [];
    if (!rm) restIssues.push(`no memo for ${rt.name}`);
    else {
      if (!/restat/i.test(rm.text)) restIssues.push("does not say the ARR was restated");
      if (!/pilot|one-time|non-recurring/i.test(rm.text)) restIssues.push("does not explain why (one-time pilot revenue)");
      if (!citesFigure(rm.text, rt.arr, RESTATED_CALL)) restIssues.push(`does not cite the restated ARR ${rt.arr} to ${RESTATED_CALL}`);
      if (!citesFigure(rm.text, RESTATED.reported.arr)) restIssues.push(`does not state the reported ARR ${RESTATED.reported.arr} with a citation`);
    }
    record("memos.restatement", restIssues.length === 0, restIssues.length ? `${rm?.file ?? rt.name}: ${restIssues.join("; ")}` : `${rm.file} explains the restatement to ${rt.arr} citing the call notes`);

    const cm = memos.get(CONCENTRATION_KEY);
    const ct = FULL[CONCENTRATION_KEY];
    const concIssues = [];
    if (!cm) concIssues.push(`no memo for ${ct.name}`);
    else {
      if (!/concentrat/i.test(cm.text)) concIssues.push("does not name the customer concentration");
      if (!citesFigure(cm.text, CONCENTRATION.sharePct, CONCENTRATION.call)) concIssues.push(`does not state the ${CONCENTRATION.sharePct}% share cited to ${CONCENTRATION.call}`);
    }
    record("memos.concentration", concIssues.length === 0, concIssues.length ? `${cm?.file ?? ct.name}: ${concIssues.join("; ")}` : `${cm.file} states the ${CONCENTRATION.sharePct}% concentration citing the call notes`);
  }

  // ---- risk matrix
  {
    const text = readText("analysis/risk-matrix.md");
    const ids = ["risk-matrix.table", "risk-matrix.citations", "risk-matrix.ratings"];
    if (text === null) {
      record(ids[0], false, "analysis/risk-matrix.md does not exist");
      for (const id of ids.slice(1)) record(id, false, "skipped: analysis/risk-matrix.md does not exist");
    } else {
      const lines = text.split(/\r?\n/);
      const cellsOf = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const h = lines.findIndex((l) => l.trim().startsWith("|") && /company/i.test(l) && /liquidity/i.test(l));
      const problems = [];
      /** key -> { ratings, rationale } */
      const matrix = new Map();
      if (h < 0) problems.push("no markdown table with Company and risk columns");
      else {
        const head = cellsOf(lines[h]).map((c) => c.toLowerCase());
        const col = { company: head.findIndex((c) => c.includes("company")), rationale: head.findIndex((c) => c.includes("rationale")) };
        for (const [k, re] of RISK_COLUMNS) col[k] = head.findIndex((c) => re.test(c));
        const missingCols = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
        if (missingCols.length) problems.push(`missing column(s) ${missingCols.join(", ")}`);
        else {
          for (const l of lines.slice(h + 2)) {
            if (!l.trim().startsWith("|")) break;
            const cells = cellsOf(l);
            const k = keyOf(cells[col.company] ?? "");
            if (!k || !(k in EXPECTED)) problems.push(`unexpected row "${cells[col.company]}"`);
            else if (matrix.has(k)) problems.push(`duplicate row for ${EXPECTED[k].name}`);
            else {
              const ratings = Object.fromEntries(RISK_COLUMNS.map(([r]) => [r, String(cells[col[r]] ?? "").replace(/[*_`]/g, "").trim().toLowerCase()]));
              for (const [r, v] of Object.entries(ratings)) if (!RATINGS.has(v)) problems.push(`${EXPECTED[k].name} ${r} rating ${JSON.stringify(v)} is not low/medium/high`);
              const rationale = cells[col.rationale] ?? "";
              if (!tokensIn(rationale).length) problems.push(`${EXPECTED[k].name} rationale has no citation`);
              matrix.set(k, { ratings, rationale });
            }
          }
          for (const [k, t] of Object.entries(EXPECTED)) if (!matrix.has(k)) problems.push(`missing ${t.name}`);
        }
      }
      record(ids[0], problems.length === 0, problems.length ? list(problems) : `${matrix.size} companies rated on ${RISK_COLUMNS.length} risks, every rationale cited`);

      const cp = proseProblems("risk-matrix.md", text, { skipRestricted: true });
      for (const tok of tokensIn(text)) if (restrictedDeep(tok.path)) cp.unshift(`cites a restricted document: ${tok.raw}`);
      record(ids[1], cp.length === 0, cp.length ? list(cp) : `${tokensIn(text).length} citations resolve to source lines; every cited figure is on its cited line`);

      const rules = [[CONCENTRATION_KEY, "concentration", ["high"], `largest customer ${CONCENTRATION.sharePct}% of ARR, above the 25% guideline`]];
      for (const [k, t] of Object.entries(EXPECTED)) if (t.cash / t.burn < LIQUIDITY_DECLINE_MONTHS) rules.push([k, "liquidity", ["high"], `runway ${(t.cash / t.burn).toFixed(1)} months, below the ${LIQUIDITY_DECLINE_MONTHS}-month decline threshold`]);
      // The other direction, so a matrix rated "high" everywhere cannot pass: runway that clears the proceed threshold even at +20% burn.
      for (const [k, t] of Object.entries(EXPECTED)) if (r1(t.cash / (t.burn * UP)) >= LIQUIDITY_PROCEED_MONTHS) rules.push([k, "liquidity", ["low", "medium"], `runway ${r1(t.cash / (t.burn * UP)).toFixed(1)} months at +20% burn, above the ${LIQUIDITY_PROCEED_MONTHS}-month proceed threshold`]);
      rules.push([RESTATED.key, "dataQuality", ["medium", "high"], "ARR restated on the diligence call"], [SUPERSEDED.key, "dataQuality", ["medium", "high"], "preliminary statement superseded"]);
      const wrong = [];
      if (matrix.size === 0) wrong.push("skipped: no usable risk-matrix rows");
      for (const [k, risk, allowed, why] of rules) {
        const got = matrix.get(k)?.ratings[risk];
        if (matrix.size && got !== undefined && !allowed.includes(got)) wrong.push(`${ALL[k].name} ${risk} is ${got}, expected ${allowed.join(" or ")} (${why})`);
      }
      record(ids[2], wrong.length === 0, wrong.length ? list(wrong) : `${rules.length} committee-threshold ratings consistent with the evidence`);
    }
  }

  // ---- burn stress test
  {
    const text = readText("analysis/sensitivity.json");
    /** key -> row */
    const sens = new Map();
    let detail;
    if (text === null) detail = "analysis/sensitivity.json does not exist";
    else {
      try {
        const doc = JSON.parse(text);
        if (!doc || !Array.isArray(doc.rows)) detail = 'analysis/sensitivity.json has no "rows" array';
        else {
          const problems = [];
          for (const r of doc.rows) {
            const k = typeof r?.company === "string" ? keyOf(r.company) : undefined;
            if (!k || !(k in EXPECTED)) problems.push(`unexpected row ${JSON.stringify(r?.company)}`);
            else if (sens.has(k)) problems.push(`duplicate row for ${EXPECTED[k].name}`);
            else sens.set(k, r);
          }
          for (const [k, t] of Object.entries(EXPECTED)) if (!sens.has(k)) problems.push(`missing ${t.name}`);
          if (problems.length) detail = list(problems);
        }
      } catch (e) {
        detail = `analysis/sensitivity.json is not valid JSON (${e.message})`;
      }
    }
    record("sensitivity.json", !detail, detail ?? `${sens.size} companies`);

    const values = [];
    const cites = [];
    if (!sens.size) values.push("skipped: analysis/sensitivity.json is unusable");
    for (const [k, r] of sens) {
      const t = ALL[k];
      for (const [field, factor] of STRESS) {
        const want = t.cash / (t.burn * factor);
        const got = r.runwayMonths?.[field];
        if (!near(got, want, RUNWAY_TOL)) values.push(`${t.name} runwayMonths.${field} = ${JSON.stringify(got)}, expected ${want.toFixed(1)}`);
      }
      const toks = (Array.isArray(r.citations) ? r.citations : []).map((c) => [c, tokensIn(c)[0]]);
      const bad = toks.filter(([c, tok]) => !tok || tok.raw !== String(c).trim() || restrictedDeep(tok.path) || evidenceProblem(tok));
      if (bad.length) cites.push(`${t.name}: ${bad.map(([c]) => JSON.stringify(c)).join(", ")} invalid, unresolved, restricted or not a source line`);
      for (const [label, v] of [["cash", t.cash], ["burn", t.burn]]) if (!toks.some(([, tok]) => tok && !evidenceProblem(tok, v))) cites.push(`${t.name}: no citation to a source line containing its ${label} ${v}`);
    }
    if (!sens.size) cites.push("skipped: analysis/sensitivity.json is unusable");
    record("sensitivity.values", values.length === 0, values.length ? list(values) : "base, +20% and -20% burn runway match cash / (burn x factor) for every company");
    record("sensitivity.citations", cites.length === 0, cites.length ? list(cites) : "every row cites its cash and burn lines");

    let nbIssue = null;
    try {
      const cells = JSON.parse(notebookText ?? "null")?.cells ?? [];
      const src = (c) => (Array.isArray(c?.source) ? c.source.join("") : String(c?.source ?? ""));
      const stressMd = cells.filter((c) => c?.cell_type === "markdown" && /sensitiv|stress/i.test(src(c))).map(src).join("\n");
      // Companies whose runway clearly crosses a committee threshold when burn rises 20% (one-decimal runway, as displayed).
      // A base runway exactly on a threshold (Solvane: 12.0, 11.999... in floating point) is not forced either way.
      const crossers = Object.entries(EXPECTED).filter(([, t]) => [LIQUIDITY_PROCEED_MONTHS, LIQUIDITY_DECLINE_MONTHS].some((th) => r1(t.cash / t.burn) > th && r1(t.cash / (t.burn * UP)) < th));
      const unnamed = crossers.filter(([k]) => !norm(stressMd).includes(k)).map(([, t]) => t.name);
      if (!stressMd) nbIssue = "no markdown cell explains the burn sensitivity";
      else if (!cells.some((c) => c?.cell_type === "code" && (/sensitiv/i.test(src(c)) || (/1\.2/.test(src(c)) && /0\.8/.test(src(c)))))) nbIssue = "no code cell computes the +20% / -20% burn cases";
      else if (unnamed.length) nbIssue = `the sensitivity markdown does not name ${list(unnamed)}, whose runway crosses a committee threshold at +20% burn`;
    } catch {
      nbIssue = "analysis/diligence.ipynb is missing or not valid JSON";
    }
    if (notebookText === null) nbIssue = "analysis/diligence.ipynb does not exist";
    record("notebook.sensitivity", !nbIssue, nbIssue ?? "markdown and code cells cover the burn stress test and name the companies crossing a threshold at +20% burn");
  }

  // ---- html export (independent import of the agent's module in a child process)
  {
    const reportDir = path.join(WS, "report");
    const exportFile = path.join(reportDir, "src", "export.mjs");
    const cite = (n) => `[src:sources/example/metrics.md#L${n}]`;
    const probe = `
      const { pathToFileURL } = await import("node:url");
      const out = {};
      try {
        const { exportReport } = await import(pathToFileURL(process.argv[1]).href);
        const cite = (n) => "[src:sources/example/metrics.md#L" + n + "]";
        const m = (value, ...l) => ({ value, citations: l.map(cite) });
        const row = (company, runway, risk) => ({ company, arrUsdM: m(10.5, 11), yoyGrowthPct: m(42, 13), grossMarginPct: m(51, 24), monthlyBurnUsdM: m(1.25, 36), cashUsdM: m(runway * 1.25, 37), runwayMonths: m(runway, 37, 36), topRisk: { text: risk, citations: [cite(41)] } });
        out.html = exportReport([row("Probe <b>R&D</b> Lending", 9, "Note <script>alert('x')</script> & \\"more\\""), row("Second & Co", 20, "Plain risk")], { format: "html" });
        const bad = row("Uncited Probe Co", 10, "x");
        bad.cashUsdM.citations = [];
        try { exportReport([bad], { format: "html" }); out.refusesUncited = false; } catch (e) { out.refusesUncited = /citation/i.test(String(e && e.message)); }
      } catch (e) { out.error = String((e && e.message) || e).slice(0, 400); }
      process.stdout.write("\\n${HTML_PROBE_MARK}" + JSON.stringify(out) + "\\n");`;
    const problems = [];
    if (!existsSync(exportFile)) problems.push("report/src/export.mjs does not exist");
    else {
      const r = run(["--permission", `--allow-fs-read=${reportDir}`, "--input-type=module", "-e", probe, exportFile], reportDir, SCRIPT_TIMEOUT_MS);
      const at = r.out.lastIndexOf(HTML_PROBE_MARK);
      let out = null;
      try {
        out = at < 0 ? null : JSON.parse(r.out.slice(at + HTML_PROBE_MARK.length).split(/\r?\n/)[0]);
      } catch {
        /* reported below */
      }
      if (!out) problems.push(`importing report/src/export.mjs failed${r.timedOut ? " (timed out)" : ""}: ${tail(r.out)}`);
      else if (out.error) problems.push(`exportReport(rows, { format: "html" }) threw: ${tail(out.error, 200)}`);
      else if (typeof out.html !== "string") problems.push('exportReport(rows, { format: "html" }) did not return a string');
      else {
        const html = out.html;
        if (!/<table[\s>]/i.test(html) || !/<\/table>/i.test(html)) problems.push("no <table> element");
        if (!/<th[^>]*>\s*Sources\s*<\/th>/i.test(html)) problems.push("no Sources header cell");
        // Column labels come from the template's report/src/table.mjs (the copy outside the workspace).
        const labels = [...readFileSync(path.join(TEMPLATE_DIR, "report", "src", "table.mjs"), "utf8").matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
        const noTh = labels.filter((l) => !new RegExp(`<th[^>]*>\\s*${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</th>`, "i").test(html));
        if (!labels.length || noTh.length) problems.push(`no <th> header cell for ${noTh.join(", ") || "the template's column labels"}`);
        if (html.includes("<script>alert(") || html.includes("<b>R&")) problems.push("raw markup from cell data (<script>, <b>) reaches the output");
        if (!html.includes("&lt;script&gt;alert(") || !html.includes("&lt;b&gt;R&amp;D&lt;/b&gt;")) problems.push("cell text containing < > & is not HTML-escaped");
        if (/&(?![a-z][a-z0-9]*;|#\d+;|#x[0-9a-f]+;)/i.test(html)) problems.push("an unescaped & reaches the output");
        if (html.includes("alert('x')") || html.includes('"more"')) problems.push("quotes from cell data reach the output unescaped");
        else if (!/alert\((&#0*39;|&#x0*27;|&apos;)x\1\)/i.test(html) || !/(&quot;|&#0*34;|&#x0*22;)more\1/i.test(html)) problems.push(`cell text containing " and ' is not HTML-escaped`);
        const a = html.indexOf("Second ");
        const b = html.indexOf("Probe ");
        if (a < 0 || b < 0 || a > b) problems.push("rows are not in runway order (longest first)");
        if (!html.includes([11, 13, 24, 36, 37, 41].map(cite).join(" "))) problems.push("the Sources cell does not list the row's de-duplicated citations");
      }
      if (out && !out.error && out.refusesUncited !== true) problems.push('a row with an uncited field is not refused with a "citation" error');
    }
    record("report.html-escape", problems.length === 0, problems.length ? list(problems) : "html export: <table> with the column labels and Sources in <th>, <script>, &, \" and ' escaped, runway order, uncited rows refused");

    // The agent's own html tests: test files in report/ that are not the template's and mention html.
    const templateTests = new Set(existsSync(path.join(TEMPLATE_DIR, "report", "test")) ? readdirSync(path.join(TEMPLATE_DIR, "report", "test")).map((f) => `test/${f}`) : []);
    const isTestFile = (rel) => /\.[cm]?js$/i.test(rel) && (/(^|\/)test\//.test(rel) || /[.\-_]test\.[cm]?js$/i.test(rel) || /(^|\/)test(-[^/]*)?\.[cm]?js$/i.test(rel));
    const mine = [];
    const walk = (abs, rel) => {
      for (const n of existsSync(abs) ? readdirSync(abs).sort() : []) {
        if (n === "node_modules" || n.startsWith(".")) continue;
        const a = path.join(abs, n);
        const r = rel ? `${rel}/${n}` : n;
        const st = lstatSync(a);
        if (st.isDirectory()) walk(a, r);
        else if (st.isFile() && isTestFile(r) && !templateTests.has(r) && st.size <= MAX_READ_BYTES && /html/i.test(readFileSync(a, "utf8"))) mine.push(r);
      }
    };
    walk(reportDir, "");
    if (!mine.length) record("report.html-tests", false, "no test file of your own in report/ exercises the html format");
    else {
      const r = run(["--test", "--test-reporter=tap", ...mine], reportDir, REPORT_TIMEOUT_MS);
      const pass = Number(r.out.match(/^# pass (\d+)/m)?.[1] ?? NaN);
      const fail = Number(r.out.match(/^# fail (\d+)/m)?.[1] ?? NaN);
      const ok = r.code === 0 && pass > 0 && fail === 0;
      record("report.html-tests", ok, r.timedOut ? `node --test timed out after ${REPORT_TIMEOUT_MS} ms` : `${list(mine, 3)}: node --test exit ${r.code}, ${pass} passed, ${fail} failed${ok || !Number.isNaN(pass) ? "" : `: ${tail(r.out)}`}`);
    }
  }

  // ---- memo-lint skill
  {
    const skill = activeSkill(MEMO_LINT, "linter");
    const { script } = skill;
    recordActive("memo-lint.active", skill);
    recordLedger("memo-lint.ledger", MEMO_LINT, skill.dir);
    const skip = !script ? "skipped: no active memo-lint script" : !memos.size ? "skipped: no company memos in analysis/memos/" : null;
    if (skip) {
      record("memo-lint.accepts-memos", false, skip);
      record("memo-lint.rejects-corrupted", false, skip);
    } else {
      const a = runSkill(script, MEMOS_DIR);
      record("memo-lint.accepts-memos", a.code === 0, a.code === 0 ? "exit 0 on analysis/memos/" : `exit ${a.code}${a.timedOut ? " (timed out)" : ""} on analysis/memos/: ${tail(a.out)}`);

      const sample = memos.get(RESTATED.key) ?? [...memos.values()][0];
      const name = path.basename(sample.file);
      // The control is the memo plus one plain line, so a script that compares against the workspace memo's bytes cannot pass.
      const base = `${sample.text.replace(/\s*$/, "")}\n\nPrepared for the credit committee pack.\n`;
      const variants = [
        ["altered cited figures", corruptCitedNumbers(base)],
        ["Risks section removed", base.replace(/^#{1,6}[ \t]+.*risk.*$/gim, "## Commentary")],
        ["restricted citation added", `${base}- Counsel's view: see [src:sources/restricted/halvorine-litigation-memo.md#L1]\n`],
      ];
      const tmp = mkdtempSync(path.join(os.tmpdir(), "diligence-verify-memos-"));
      try {
        const dirOf = (label, text) => {
          const d = path.join(tmp, label.replace(/[^a-z0-9]+/gi, "-"));
          mkdirSync(d);
          writeFileSync(path.join(d, name), text);
          return d;
        };
        const control = runSkill(script, dirOf("control", base), tmp);
        let ok = false;
        let detail;
        const unchanged = variants.filter(([, t]) => t === base).map(([l]) => l);
        if (unchanged.length) detail = `${sample.file} cannot be corrupted (${unchanged.join(", ")}: nothing to change)`;
        else if (control.code !== 0) detail = `exit ${control.code} on a valid copy of ${sample.file} outside the workspace (the memo plus one plain line): citations must resolve against the working directory and the memo must be linted, not compared (${tail(control.out, 200)})`;
        else {
          const accepted = variants.filter(([label, t]) => runSkill(script, dirOf(label, t), tmp).code === 0).map(([l]) => l);
          ok = accepted.length === 0;
          detail = ok ? `exit non-zero on all ${variants.length} corrupted copies of ${sample.file} (${variants.map(([l]) => l).join(", ")}), exit 0 on a valid copy` : `exit 0 on corrupted copies of ${sample.file}: ${accepted.join(", ")}`;
        }
        record("memo-lint.rejects-corrupted", ok, detail);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
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
