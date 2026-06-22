import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { scanBenchmarkContamination } from "../src/eval/benchmarkContamination";
import { runStagedBankerToolBench } from "../src/eval/bankerToolBenchRunner";
import { stageBankerToolBenchBundle } from "../src/eval/bankerToolBenchStage";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench staged runner", () => {
  it("emits candidate deliverables before opening evaluator rubric and gold", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const taskId = "1b253d04-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Input"), { recursive: true });
    writeFileSync(join(source, "task-data", taskId, "Input", "vdr-export.xlsx"), "source workbook");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(source, "golden-outputs", taskId, "answer.pptx"), "finished deck");
    stageBankerToolBenchBundle(source, {
      outputRoot: stage,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const report = await runStagedBankerToolBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "copy-input-baseline",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      schema: 1,
      mode: "copy-input-baseline",
      taskCount: 1,
      passCount: 0,
      passRate: 0,
      harness: {
        toolPolicy: "agent_workspace_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        verifier: "local_exact_or_workbook_semantic_smoke",
        packagePolicy: "exact_expected_deliverables",
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "emit_candidate_deliverables",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score?.totals).toMatchObject({
      rubricCriteria: 1,
      weightedTotal: 10,
      awardedWeight: 0,
      exactMatchingGoldenFiles: 0,
      missingGoldenFiles: 1,
      expectedDeliverables: 1,
      candidateDeliverables: 1,
      missingExpectedDeliverables: 1,
      extraCandidateDeliverables: 1,
    });
    const candidateManifest = readFileSync(join(out, "btb-1b253d04", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest.toLowerCase()).not.toContain("rubric");
    expect(candidateManifest).not.toContain("CANARY");
    expect(existsSync(join(out, "btb-1b253d04", "agent-workspace", "agent-workspace-manifest.json"))).toBe(true);
  });

  it("scores deterministic agent output with evaluator-only weighted rubric", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const taskId = "0fc7bc3c-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Inputs"), { recursive: true });
    writeFileSync(join(source, "task-data", taskId, "Inputs", "model.xlsx"), "source model");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(source, "golden-outputs", taskId, "answer.pptx"), "finished deck");
    stageBankerToolBenchBundle(source, {
      outputRoot: stage,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "btb-0fc7bc3c", "agent", "output-manifest.json"), {
      schema: 1,
      deliverables: [
        { path: "answer.pptx", text: "finished deck" },
      ],
    });

    const report = await runStagedBankerToolBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-output",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.averageWeightedScore).toBe(1);
    expect(report.results[0].score).toMatchObject({
      pass: true,
      weightedScore: 1,
      totals: {
        rubricCriteria: 1,
        weightedTotal: 10,
        awardedWeight: 10,
        exactMatchingGoldenFiles: 1,
        expectedDeliverables: 1,
        candidateDeliverables: 1,
        matchedExpectedDeliverables: 1,
        missingExpectedDeliverables: 0,
        extraCandidateDeliverables: 0,
        unsupportedCandidateDeliverables: 0,
      },
    });
    expect(report.results[0].score?.rubricResults[0]).toMatchObject({
      criterion: "Deck has correct valuation range",
      weight: 10,
      passed: true,
    });
    const contamination = scanBenchmarkContamination(out, { generatedAt: "2026-06-13T00:00:00.000Z" });
    expect(contamination).toMatchObject({
      checkedFiles: 4,
      leakCount: 0,
    });
  });

  it("scores a complete Excel, PowerPoint, Word, and PDF deliverable package", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const taskId = "4cc7bc3c-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Input"), { recursive: true });
    await writeSemanticWorkbook(join(source, "task-data", taskId, "Input", "answer.xlsx"), "candidate");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    await writeSemanticWorkbook(join(source, "golden-outputs", taskId, "answer.xlsx"), "gold");
    writeFileSync(join(source, "golden-outputs", taskId, "pitch.pptx"), "finished deck");
    writeFileSync(join(source, "golden-outputs", taskId, "memo.docx"), "finished memo");
    writeFileSync(join(source, "golden-outputs", taskId, "report.pdf"), "finished report");
    stageBankerToolBenchBundle(source, {
      outputRoot: stage,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "btb-4cc7bc3c", "agent", "output-manifest.json"), {
      schema: 1,
      deliverables: [
        { path: "answer.xlsx", sourceInput: "inputs/01-answer.xlsx" },
        { path: "pitch.pptx", text: "finished deck" },
        { path: "memo.docx", text: "finished memo" },
        { path: "report.pdf", text: "finished report" },
      ],
    });

    const report = await runStagedBankerToolBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-output",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score).toMatchObject({
      pass: true,
      weightedScore: 1,
      totals: {
        expectedDeliverables: 4,
        candidateDeliverables: 4,
        matchedExpectedDeliverables: 4,
        missingExpectedDeliverables: 0,
        extraCandidateDeliverables: 0,
        unsupportedCandidateDeliverables: 0,
        acceptedGoldenFiles: 4,
        workbookComparedGoldenFiles: 1,
        workbookSemanticMatches: 1,
      },
    });
    expect(report.results[0].score?.expectedDeliverables.map((item) => item.extension).sort()).toEqual([
      ".docx",
      ".pdf",
      ".pptx",
      ".xlsx",
    ]);
    expect(report.results[0].score?.deliverables.map((item) => item.extension).sort()).toEqual([
      ".docx",
      ".pdf",
      ".pptx",
      ".xlsx",
    ]);
  });

  it("accepts semantically matching workbook deliverables even when package hashes differ", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const taskId = "3bb7bc3c-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Input"), { recursive: true });
    await writeSemanticWorkbook(join(source, "task-data", taskId, "Input", "answer.xlsx"), "candidate");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    await writeSemanticWorkbook(join(source, "golden-outputs", taskId, "answer.xlsx"), "gold");
    stageBankerToolBenchBundle(source, {
      outputRoot: stage,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "btb-3bb7bc3c", "agent", "output-manifest.json"), {
      schema: 1,
      deliverables: [
        { path: "answer.xlsx", sourceInput: "inputs/01-answer.xlsx" },
      ],
    });

    const report = await runStagedBankerToolBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-output",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score).toMatchObject({
      pass: true,
      weightedScore: 1,
      totals: {
        exactMatchingGoldenFiles: 0,
        acceptedGoldenFiles: 1,
        workbookComparedGoldenFiles: 1,
        workbookSemanticMatches: 1,
        workbookSemanticMismatches: 0,
        mismatchedGoldenFiles: 1,
      },
    });
    expect(report.results[0].score?.goldenFiles[0]).toMatchObject({
      path: "golden-outputs/01-answer.xlsx",
      expectedDeliverable: "answer.xlsx",
      matchedCandidate: "answer.xlsx",
      exactMatch: false,
      accepted: true,
      semanticMatch: true,
      workbookScore: {
        pass: true,
        scores: { overall: 1 },
      },
    });
    expect(report.results[0].score?.warnings).toContain(
      "one or more workbook deliverables were accepted by semantic workbook scoring despite package hash drift",
    );
  });

  it("records package-level failures for missing, extra, duplicate, and unsupported deliverables", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const taskId = "2aa7bc3c-a111-4222-8333-444455556666";
    writeTask(source, taskId);
    mkdirSync(join(source, "task-data", taskId, "Input"), { recursive: true });
    writeFileSync(join(source, "task-data", taskId, "Input", "company.xlsx"), "source workbook");
    mkdirSync(join(source, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(source, "golden-outputs", taskId, "answer.pptx"), "finished deck");
    writeFileSync(join(source, "golden-outputs", taskId, "memo.docx"), "finished memo");
    stageBankerToolBenchBundle(source, {
      outputRoot: stage,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "btb-2aa7bc3c", "agent", "output-manifest.json"), {
      schema: 1,
      deliverables: [
        { path: "answer.pptx", text: "finished deck" },
        { path: "nested/answer.pptx", text: "duplicate deck" },
        { path: "notes.txt", text: "unsupported extra notes" },
      ],
    });

    const report = await runStagedBankerToolBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-output",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(0);
    expect(report.averageWeightedScore).toBe(0);
    expect(report.results[0].score).toMatchObject({
      pass: false,
      weightedScore: 0,
      totals: {
        expectedDeliverables: 2,
        candidateDeliverables: 3,
        matchedExpectedDeliverables: 1,
        missingExpectedDeliverables: 1,
        extraCandidateDeliverables: 1,
        duplicateCandidateDeliverables: 1,
        unsupportedCandidateDeliverables: 1,
        exactMatchingGoldenFiles: 1,
        missingGoldenFiles: 1,
      },
    });
    expect(report.results[0].score?.expectedDeliverables).toEqual([
      { name: "answer.pptx", extension: ".pptx", matchedCandidate: "answer.pptx" },
      { name: "memo.docx", extension: ".docx", matchedCandidate: undefined },
    ]);
    expect(report.results[0].score?.warnings).toEqual(expect.arrayContaining([
      "candidate package includes unsupported deliverable extensions",
      "candidate package includes extra deliverables not present in evaluator expected outputs",
      "candidate package includes duplicate deliverable names",
    ]));
    const candidateManifest = readFileSync(join(out, "btb-2aa7bc3c", "candidate-manifest.json"), "utf8");
    expect(candidateManifest.toLowerCase()).not.toContain("golden");
    expect(candidateManifest.toLowerCase()).not.toContain("expected");
    expect(candidateManifest.toLowerCase()).not.toContain("rubric");
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-bankertoolbench-runner-${prefix}-`));
  roots.push(root);
  return root;
}

function writeTask(root: string, taskId: string) {
  const row = {
    task_id: taskId,
    final_prompt: "Prepare an IPO valuation summary.",
    prompt_context: "Context should be evaluator-only for official-paper parity.",
    formatting_context: "Formatting should be evaluator-only for default official mode.",
    product: "ECM",
    workflow_cat: "Valuation",
    workflow_subcat: "IPO",
    canary: "CANARY-BTB-456",
    aggregated_rubric_json: JSON.stringify([
      { criterion: "Deck has correct valuation range", weight: 10, category: "PowerPoint" },
    ]),
  };
  writeFileSync(join(root, "tasks.jsonl"), `${JSON.stringify(row)}\n`);
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSemanticWorkbook(path: string, creator: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = creator;
  workbook.created = creator === "gold" ? new Date("2026-01-01T00:00:00.000Z") : new Date("2026-02-01T00:00:00.000Z");
  const sheet = workbook.addWorksheet("Model");
  sheet.getColumn("B").width = 18;
  sheet.getRow(2).height = 24;
  sheet.getCell("B2").value = 42;
  sheet.getCell("B2").numFmt = "$#,##0";
  sheet.getCell("B2").font = { bold: true };
  sheet.getCell("C2").value = { formula: "B2*2", result: 84 };
  sheet.getCell("C2").numFmt = "$#,##0";
  sheet.getCell("C2").font = { bold: true };
  await workbook.xlsx.writeFile(path);
}
