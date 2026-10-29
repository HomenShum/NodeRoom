/**
 * Persona: a credit-committee reviewer who must trust the independent verifier more than the agent.
 * Goal: the verifier passes a complete, correct diligence workspace (test/golden over the template,
 * with the citation-validation skill activated through Node's real skill lifecycle) and fails each
 * known way an agent can get it wrong, with the precise check id and nothing else.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { VerificationReport } from "../src/api.js";
import type { EngineEventDraft, NodeToolContext, TemplateConfig } from "../src/contract.js";
import { listFiles, parseFrontmatter } from "../src/skills/catalog.js";
import { activateSkill, draftSkill, testSkill, validateSkill, type SkillTestCase } from "../src/skills/lifecycle.js";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const TEMPLATE_DIR = path.join(PKG, "fixtures", "diligence-pack");
const GOLDEN = path.join(PKG, "test", "golden", "diligence-pack");
const VERIFIER = path.join(PKG, "fixtures", "verifiers", "diligence-pack.verify.mjs");
const SKILL = "citation-validation";
const INBOX_COMPANIES = ["Solvane", "Kestrelmoor"];

interface Run {
  code: number | null;
  report: VerificationReport;
  failed: string[];
}

interface Metric {
  value: number;
  citations: string[];
}
interface Row {
  company: string;
  arrUsdM: Metric;
  yoyGrowthPct: Metric;
  monthlyBurnUsdM: Metric;
  cashUsdM: Metric;
  runwayMonths: Metric;
  topRisk: { text: string; citations: string[] };
}

let root: string;
let base: string;

const wsOf = (dir: string) => path.join(dir, "workspace");
const read = (ws: string, rel: string) => readFileSync(path.join(ws, rel), "utf8");
const readTable = (ws: string) => JSON.parse(read(ws, "analysis/comparison.json")) as { rows: Row[] };
const writeTable = (ws: string, t: unknown) => writeFileSync(path.join(ws, "analysis/comparison.json"), `${JSON.stringify(t, null, 2)}\n`);

/** 1-based line of the first line in `rel` containing `needle`. */
function lineOf(ws: string, rel: string, needle: string): number {
  const i = read(ws, rel).split(/\r?\n/).findIndex((l) => l.includes(needle));
  assert.ok(i >= 0, `${rel} has no line containing ${JSON.stringify(needle)}`);
  return i + 1;
}

function editRow(ws: string, company: string, fn: (r: Row) => void): void {
  const t = readTable(ws);
  const r = t.rows.find((x) => x.company.includes(company));
  assert.ok(r, `no row for ${company}`);
  fn(r);
  writeTable(ws, t);
}

function verify(ws: string, ...args: string[]): Run {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [VERIFIER, ws, "--json", ...args], { encoding: "utf8", env, timeout: 180_000 });
  let report: VerificationReport;
  try {
    report = JSON.parse(r.stdout) as VerificationReport;
  } catch {
    throw new Error(`verifier did not print JSON (exit ${r.status}): ${r.stdout}\n${r.stderr}`);
  }
  assert.equal(report.passed + report.failed, report.checks.length);
  assert.ok(!Number.isNaN(Date.parse(report.ranAt)));
  assert.equal(r.status, report.failed === 0 ? 0 : 1, "exit code is 0 only when every check passes");
  return { code: r.status, report, failed: report.checks.filter((c) => !c.ok).map((c) => c.id).sort() };
}

const details = (run: Run) => run.report.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`).join("\n");
const detailOf = (run: Run, id: string) => run.report.checks.find((c) => c.id === id)?.detail ?? "";

function expectFailed(run: Run, ids: string[]): void {
  assert.deepEqual(run.failed, [...ids].sort(), `unexpected failing checks:\n${details(run)}`);
}

/** A copy of the verified base project (workspace + node-state) for one scenario. */
function scenario(name: string, mutate: (ws: string) => void = () => {}): string {
  const dir = path.join(root, name);
  cpSync(base, dir, { recursive: true });
  mutate(wsOf(dir));
  return wsOf(dir);
}

/** Drafts, validates, tests and activates the golden skill draft with Node's real lifecycle. */
async function activateGoldenSkill(ws: string, nodeStateDir: string): Promise<EngineEventDraft[]> {
  const events: EngineEventDraft[] = [];
  const ctx: NodeToolContext = {
    runId: "verifier-test",
    workspaceDir: ws,
    nodeStateDir,
    template: JSON.parse(readFileSync(path.join(TEMPLATE_DIR, "template.json"), "utf8")) as TemplateConfig,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
  };
  const draftDir = path.join(ws, "skill-drafts", SKILL);
  const fm = parseFrontmatter(readFileSync(path.join(draftDir, "SKILL.md"), "utf8"));
  assert.ok(fm?.meta.description, "golden SKILL.md has frontmatter");
  const files = listFiles(draftDir)
    .filter((f) => f !== "SKILL.md" && f !== "skill.test.json")
    .map((f) => ({ path: f, content: readFileSync(path.join(draftDir, f), "utf8") }));
  const tests = (JSON.parse(readFileSync(path.join(draftDir, "skill.test.json"), "utf8")) as { cases: SkillTestCase[] }).cases;
  const steps = [
    draftSkill(ctx, { name: SKILL, description: fm.meta.description, instructions: fm.body, files, tests, allowedTools: fm.meta.allowedTools }),
    validateSkill(ctx, SKILL),
    await testSkill(ctx, SKILL),
    await activateSkill(ctx, SKILL),
  ];
  for (const s of steps) assert.ok(s.ok, s.content);
  return events;
}

before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "diligence-verifier-test-"));
  base = path.join(root, "base");
  const ws = wsOf(base);
  // Materialize like the worker does (everything but template.json), then overlay the golden outputs.
  cpSync(TEMPLATE_DIR, ws, { recursive: true, filter: (src) => path.basename(src) !== "template.json" || path.dirname(src) !== TEMPLATE_DIR });
  cpSync(GOLDEN, ws, { recursive: true });
  const events = await activateGoldenSkill(ws, path.join(base, "node-state"));
  assert.deepEqual(
    events.flatMap((e) => (e.type === "skill.lifecycle" ? [e.stage] : [])),
    ["drafted", "validated", "tested", "activated"],
  );
  // The golden is the inbox-stage solution; the full-diligence stage is the same table without the inbox companies.
  editRowsToFullStage(ws);
});

function editRowsToFullStage(ws: string): void {
  const t = readTable(ws);
  t.rows = t.rows.filter((r) => !INBOX_COMPANIES.some((c) => r.company.includes(c)));
  writeTable(ws, t);
  const md = read(ws, "analysis/comparison.md").split("\n").filter((l) => !INBOX_COMPANIES.some((c) => l.includes(c)));
  writeFileSync(path.join(ws, "analysis/comparison.md"), md.join("\n"));
}

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("diligence-pack verifier: correct solutions pass", () => {
  test("the full-diligence golden solution passes every check, including Node activation provenance", () => {
    const run = verify(scenario("golden-full"));
    expectFailed(run, []);
    assert.match(run.report.verifier, /stage full/);
    const ids = run.report.checks.map((c) => c.id);
    for (const id of ["metrics.restated-arr", "sources.no-restricted", "citations.resolve", "report.tests-pass", "notebook.valid", "skill.ledger", "skill.rejects-corrupted"]) assert.ok(ids.includes(id), `missing check ${id}`);
    assert.match(detailOf(run, "report.tests-pass"), /13 passed, 0 failed/);
  });

  test("the inbox-update golden solution passes with the stage auto-detected from the table", () => {
    const ws = scenario("golden-inbox", (w) => {
      cpSync(path.join(GOLDEN, "analysis"), path.join(w, "analysis"), { recursive: true });
    });
    const run = verify(ws);
    expectFailed(run, []);
    assert.match(run.report.verifier, /stage inbox/);
    assert.match(detailOf(run, "comparison.companies"), /all 10 companies/);
  });
});

describe("diligence-pack verifier: each agent mistake fails with a precise check id", () => {
  test("pre-restatement ARR copied from the financial statement", () => {
    const ws = scenario("pre-restatement", (w) => {
      const fin = "sources/financials/tessaly-financials.md";
      editRow(w, "Tessaly", (r) => {
        r.arrUsdM = { value: 14.2, citations: [`[src:${fin}#L${lineOf(w, fin, "Annualized revenue run-rate")}]`] };
        r.yoyGrowthPct = { value: 71, citations: [`[src:${fin}#L${lineOf(w, fin, "Year-over-year ARR growth")}]`] };
      });
    });
    const run = verify(ws);
    expectFailed(run, ["metrics.restated-arr", "metrics.values"]);
    assert.match(detailOf(run, "metrics.restated-arr"), /pre-restatement ARR 14\.2 \(restated: 11\.6\)/);
  });

  test("a top risk cited into the policy-restricted litigation memo", () => {
    const ws = scenario("restricted", (w) => editRow(w, "Halvorine", (r) => {
      r.topRisk.citations = ["[src:sources/restricted/halvorine-litigation-memo.md#L20]"];
    }));
    const run = verify(ws);
    // The verifier flags it, and the template's own acceptance test also refuses restricted citations.
    expectFailed(run, ["report.tests-pass", "sources.no-restricted"]);
    assert.match(detailOf(run, "sources.no-restricted"), /halvorine-litigation-memo/);
  });

  test("a broken line citation: the cash figure points at the burn line", () => {
    const ws = scenario("broken-line", (w) => {
      const fin = "sources/financials/quillmark-financials.md";
      editRow(w, "Quillmark", (r) => {
        r.cashUsdM.citations = [`[src:${fin}#L${lineOf(w, fin, "Average monthly net burn")}]`];
      });
    });
    const run = verify(ws);
    expectFailed(run, ["citations.resolve"]);
    assert.match(detailOf(run, "citations.resolve"), /Quillmark Lending cashUsdM: .* does not contain 24\.2/);
  });

  test("an out-of-range citation in comparison.md", () => {
    const ws = scenario("md-out-of-range", (w) => {
      const md = read(w, "analysis/comparison.md");
      writeFileSync(path.join(w, "analysis/comparison.md"), md.replace(/(quillmark-financials\.md)#L\d+\]/, "$1#L999]"));
    });
    const run = verify(ws);
    // The agent's own validator catches it too: the acceptance run of the skill fails.
    expectFailed(run, ["citations.resolve", "skill.accepts-table", "skill.rejects-corrupted"]);
    assert.match(detailOf(run, "citations.resolve"), /#L999\]: line range outside/);
  });

  test("the export is still the unimplemented stub, so the report tests fail", () => {
    const ws = scenario("stub-export", (w) => cpSync(path.join(TEMPLATE_DIR, "report/src/export.mjs"), path.join(w, "report/src/export.mjs")));
    const run = verify(ws);
    expectFailed(run, ["report.tests-pass"]);
    // The two table-only tests pass (comparison.json is valid); all 11 that call exportReport fail.
    assert.match(detailOf(run, "report.tests-pass"), /2 passed, 11 failed/);
  });

  test("the citation-validation skill was never activated", () => {
    const ws = scenario("missing-skill", (w) => rmSync(path.join(w, ".claude/skills", SKILL), { recursive: true, force: true }));
    const run = verify(ws);
    expectFailed(run, ["skill.accepts-table", "skill.active", "skill.ledger", "skill.rejects-corrupted"]);
    assert.match(detailOf(run, "skill.active"), /SKILL\.md does not exist/);
  });

  test("figures taken from the superseded v1 statement", () => {
    const ws = scenario("superseded", (w) => {
      const v1 = "sources/financials/marrowfield-financials-v1.md";
      editRow(w, "Marrowfield", (r) => {
        const cash = `[src:${v1}#L${lineOf(w, v1, "Cash and equivalents, June 30, 2026")}]`;
        const burn = `[src:${v1}#L${lineOf(w, v1, "Average monthly net burn")}]`;
        r.cashUsdM = { value: 13.6, citations: [cash] };
        r.monthlyBurnUsdM = { value: 0.95, citations: [burn] };
        r.runwayMonths = { value: 14.3, citations: [cash, burn] };
      });
    });
    const run = verify(ws);
    expectFailed(run, ["metrics.values", "sources.no-superseded"]);
    assert.match(detailOf(run, "sources.no-superseded"), /marrowfield-financials-v1\.md#L\d+/);
  });

  test("a rubber-stamp validator swapped in after activation", () => {
    const ws = scenario("rubber-stamp", (w) => writeFileSync(path.join(w, ".claude/skills", SKILL, "validate-citations.mjs"), "process.exit(0);\n"));
    const run = verify(ws);
    expectFailed(run, ["skill.ledger", "skill.rejects-corrupted"]);
    assert.match(detailOf(run, "skill.rejects-corrupted"), /does not check that cited lines contain the numbers/);
  });

  test("an acceptance test deleted to make the suite pass", () => {
    const ws = scenario("weakened-tests", (w) => rmSync(path.join(w, "report/test/comparison.test.mjs")));
    const run = verify(ws);
    expectFailed(run, ["report.tests-intact"]);
    assert.match(detailOf(run, "report.tests-intact"), /comparison\.test\.mjs was deleted/);
  });

  test("the inbox stage requested before the inbox companies were added", () => {
    const run = verify(scenario("inbox-missing"), "--stage", "inbox");
    expectFailed(run, ["comparison-md.table", "comparison.companies"]);
    assert.match(detailOf(run, "comparison.companies"), /missing Solvane Trade Credit; missing Kestrelmoor Capital/);
  });
});

describe("diligence-pack verifier: degraded inputs", () => {
  test("an untouched template workspace fails honestly; only the intact tests pass", () => {
    const ws = path.join(root, "template-only", "workspace");
    cpSync(TEMPLATE_DIR, ws, { recursive: true, filter: (src) => path.basename(src) !== "template.json" || path.dirname(src) !== TEMPLATE_DIR });
    const run = verify(ws);
    assert.deepEqual(run.report.checks.filter((c) => c.ok).map((c) => c.id), ["report.tests-intact"]);
    assert.match(detailOf(run, "skill.active"), /activation provenance|does not exist/);
  });

  test("usage errors exit 2 without a report", () => {
    const noArgs = spawnSync(process.execPath, [VERIFIER], { encoding: "utf8" });
    assert.equal(noArgs.status, 2);
    assert.match(noArgs.stderr, /usage:/);
    const badStage = spawnSync(process.execPath, [VERIFIER, wsOf(base), "--stage", "later"], { encoding: "utf8" });
    assert.equal(badStage.status, 2);
    const missing = spawnSync(process.execPath, [VERIFIER, path.join(root, "does-not-exist")], { encoding: "utf8" });
    assert.equal(missing.status, 2);
  });
});
