import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  runSpreadsheetBenchNodeAgentBridge,
} from "../src/eval/spreadsheetBenchNodeAgentBridge";
import type { AgentMessage, AgentModel, AgentStep } from "../src/nodeagent/core/types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench canonical NodeAgent bridge", () => {
  it("runs inspect, repaired plan/preflight, managed write, and post-write verification under one trace", async () => {
    const root = tempRoot();
    const task = await stagedTask(root);
    const candidate = join(root, "output", "candidate.xlsx");
    const capture: { systems: string[]; messages: string[]; toolNames: string[][] } = {
      systems: [],
      messages: [],
      toolNames: [],
    };

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: repairingWorkbookModel(capture),
      traceId: "trace_sbench_bridge_test",
      maxSteps: 10,
      now: () => 1_000,
    });

    expect(receipt.outcome).toMatchObject({
      status: "completed",
      mutatingTask: true,
      changedCellCount: 1,
      finalVerificationStatus: "passed",
    });
    expect(receipt.frame.status).toBe("completed");
    expect(receipt.frame.agentResult.stopReason).toBe("done");
    expect(receipt.frame.agentResult.trace.map((event) => event.tool)).toEqual([
      "inspect_workbook",
      "verify_workbook",
      "verify_workbook",
      "write_locked_cells",
      "verify_workbook",
    ]);
    expect(receipt.stages.inspect.status).toBe("completed");
    expect(receipt.stages.plan).toMatchObject({ status: "completed", attempts: 2, operationCount: 1 });
    expect(receipt.stages.preflight).toMatchObject({ status: "completed", attempts: 2 });
    expect(receipt.stages.write).toMatchObject({ status: "completed", attempts: 1, operationCount: 1 });
    expect(receipt.stages.verify).toMatchObject({ status: "completed", attempts: 1, operationCount: 1 });
    expect(receipt.stages.repair).toMatchObject({ status: "completed", attempts: 1 });
    expect(receipt.recalculation).toEqual({
      engine: "nodeagent-formula-engine",
      attemptedFormulaCount: 1,
      refreshedFormulaCount: 1,
      unresolvedFormulaCount: 0,
      unresolved: [],
    });
    expect(Object.values(receipt.stages).every((stage) => stage.traceId === receipt.traceId)).toBe(true);
    expect(receipt.trace.traceId).toBe(receipt.traceId);
    expect(receipt.trace.eval.benchmarkCaseId).toBe("Template/bridge-01");
    expect(receipt.trace.final.status).toBe("completed");
    expect(receipt.trace.evidence.every((evidence) => evidence.traceId === receipt.traceId)).toBe(true);
    expect(receipt.trace.mutations).toEqual([
      expect.objectContaining({
        traceId: receipt.traceId,
        status: "committed",
        targetRefs: [expect.objectContaining({ refId: "Model!B1" })],
      }),
    ]);

    const emitted = new ExcelJS.Workbook();
    await emitted.xlsx.readFile(candidate);
    expect(emitted.getWorksheet("Model")?.getCell("B1").value).toMatchObject({ formula: "A1*2", result: 4 });
    expect(receipt.candidateWorkbookSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.isolation).toMatchObject({
      boundary: "agent_visible_files_only",
      openedAgentFiles: ["task.json", "inputs/input.xlsx", "prompts/task.txt"],
      evaluatorMetadataAccess: "none",
      evaluatorFileReadCount: 0,
      candidateEmittedBeforeEvaluatorAccess: true,
    });

    const modelContext = `${capture.systems.join("\n")}\n${capture.messages.join("\n")}`;
    expect(modelContext).toContain("PRODUCTION PROTOCOL");
    expect(modelContext).toContain("NODEAGENT REASONING FRAME");
    expect(modelContext).toContain("Template/bridge-01");
    expect(modelContext).toContain('"elementId":"C2"');
    expect(modelContext).toContain('"formula":"B2*2"');
    expect(modelContext).not.toContain("EVALUATOR_TRIPWIRE_SECRET");
    expect(JSON.stringify(receipt)).not.toContain("EVALUATOR_TRIPWIRE_SECRET");
    expect(capture.toolNames.every((names) => names.every((name) => [
      "inspect_workbook",
      "execute_verified_workbook_plan",
      "verify_workbook",
      "list_artifacts",
      "read_range",
      "search_sheet_context",
      "write_locked_cell",
      "write_locked_cells",
      "say",
    ].includes(name)))).toBe(true);
  });

  it("adapts an invalid model-supplied inspection artifact to a visible worksheet", async () => {
    const root = tempRoot();
    const instruction = "Inspect the workbook and report what remains.";
    const task = await stagedTask(root, instruction);
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: join(root, "output", "adapted-artifact.xlsx"),
      model: invalidArtifactInspectionModel(),
      traceId: "trace_sbench_adapted_artifact",
      maxSteps: 4,
      now: () => 1_200,
    });

    expect(receipt.frame.runtimeError).toBeUndefined();
    expect(receipt.stages.inspect.status).toBe("completed");
    expect(receipt.frame.agentResult.trace[0]).toMatchObject({
      tool: "inspect_workbook",
      args: { artifactId: "Financial_Model/01_02" },
      result: { ok: true, artifactId: "Model" },
    });
  });

  it("emits the source workbook byte-for-byte when inspection makes no changes", async () => {
    const root = tempRoot();
    const instruction = "Inspect the workbook and report what remains.";
    const task = await stagedTask(root, instruction);
    const input = join(root, "tasks", "bridge-01", "agent", "inputs", "input.xlsx");
    await addUnsupportedWpsDrawing(input);

    const directRead = new ExcelJS.Workbook();
    await expect(directRead.xlsx.readFile(input)).rejects.toThrow(/reading 'anchors'/);

    const candidate = join(root, "output", "wps-drawing.xlsx");
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: invalidArtifactInspectionModel(),
      traceId: "trace_sbench_wps_drawing_fallback",
      maxSteps: 4,
      now: () => 1_000,
    });

    expect(receipt.stages.inspect.status).toBe("completed");
    expect(receipt.frame.agentResult.stopReason).toBe("done");
    expect(existsSync(candidate)).toBe(true);
    expect(readFileSync(candidate)).toEqual(readFileSync(input));
  });

  it("preserves unsupported workbook package parts while emitting changed cells", async () => {
    const root = tempRoot();
    const task = await stagedTask(root);
    const input = join(root, "tasks", "bridge-01", "agent", "inputs", "input.xlsx");
    await addUnsupportedWpsDrawing(input);
    const candidate = join(root, "output", "wps-drawing-repaired.xlsx");
    const capture = { systems: [] as string[], messages: [] as string[], toolNames: [] as string[][] };

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: repairingWorkbookModel(capture),
      traceId: "trace_sbench_wps_drawing_repaired",
      maxSteps: 10,
      now: () => 1_100,
    });

    expect(receipt.outcome).toMatchObject({ status: "completed", changedCellCount: 1 });
    const [sourceZip, candidateZip] = await Promise.all([
      JSZip.loadAsync(readFileSync(input)),
      JSZip.loadAsync(readFileSync(candidate)),
    ]);
    for (const path of [
      "xl/drawings/drawing1.xml",
      "xl/drawings/_rels/drawing1.xml.rels",
      "xl/media/image1.png",
      "xl/worksheets/_rels/sheet1.xml.rels",
    ]) {
      expect(await candidateZip.file(path)?.async("nodebuffer")).toEqual(
        await sourceZip.file(path)?.async("nodebuffer"),
      );
    }
    const worksheetXml = await candidateZip.file("xl/worksheets/sheet1.xml")?.async("string");
    expect(worksheetXml).toContain('<drawing r:id="rId1"/>');
    expect(worksheetXml).toMatch(/<c\b[^>]*r="B1"[^>]*>[\s\S]*?<f>A1\*2<\/f>[\s\S]*?<v>4<\/v>[\s\S]*?<\/c>/);
    expect(await candidateZip.file("[Content_Types].xml")?.async("string")).toContain(
      'PartName="/xl/drawings/drawing1.xml"',
    );
  });

  it("treats invalid Excel dates as inspectable values instead of aborting the trace", async () => {
    const root = tempRoot();
    const task = await stagedTask(root, "Inspect the workbook and report what remains.");
    const inputPath = join(root, "tasks", "bridge-01", "agent", "inputs", "input.xlsx");
    const input = new ExcelJS.Workbook();
    await input.xlsx.readFile(inputPath);
    input.getWorksheet("Model")!.getCell("A1").value = 1e100;
    input.getWorksheet("Model")!.getCell("A1").numFmt = "yyyy-mm-dd";
    await input.xlsx.writeFile(inputPath);
    const candidate = join(root, "output", "invalid-date.xlsx");

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: invalidArtifactInspectionModel(),
      traceId: "trace_sbench_invalid_date",
      maxSteps: 4,
      now: () => 1_150,
    });

    expect(receipt.frame.runtimeError).toBeUndefined();
    expect(receipt.stages.inspect.status).toBe("completed");
    expect(receipt.outcome.changedCellCount).toBe(0);
    expect(readFileSync(candidate)).toEqual(readFileSync(inputPath));
  });

  it("keeps a syntactically verified write open when deterministic recalculation is unsupported", async () => {
    const root = tempRoot();
    const instruction = 'Replace Model!B1 with formula TEXT(A1,"0.00"), then verify the changed cell.';
    const task = await stagedTask(root, instruction);
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: join(root, "output", "unresolved.xlsx"),
      model: unresolvedRecalculationModel(instruction),
      traceId: "trace_sbench_unresolved_recalculation",
      maxSteps: 8,
      now: () => 1_250,
    });

    expect(receipt.stages.verify.status).toBe("completed");
    expect(receipt.recalculation).toMatchObject({
      attemptedFormulaCount: 1,
      refreshedFormulaCount: 0,
      unresolvedFormulaCount: 1,
      unresolved: [expect.objectContaining({ sheet: "Model", address: "B1", error: "#UNSUPPORTED!" })],
    });
    expect(receipt.outcome).toMatchObject({
      status: "needs_repair",
      changedCellCount: 1,
      finalVerificationStatus: "needs_repair",
    });
    expect(receipt.trace.final.status).toBe("needs_review");
    expect(receipt.trace.evidence.find((evidence) => evidence.label === "SpreadsheetBench formula recalculation")?.status).toBe("needs_review");
  });

  it("never completes an unresolved formula write even when task wording is classified as nonmutating", async () => {
    const root = tempRoot();
    const instruction = 'Model!B1 should contain formula TEXT(A1,"0.00").';
    const task = await stagedTask(root, instruction);
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: join(root, "output", "unresolved-nonmutating.xlsx"),
      model: unresolvedRecalculationModel(instruction),
      traceId: "trace_sbench_unresolved_nonmutating",
      maxSteps: 8,
      now: () => 1_275,
    });

    expect(receipt.outcome).toMatchObject({
      status: "needs_repair",
      mutatingTask: false,
      changedCellCount: 1,
      finalVerificationStatus: "needs_repair",
    });
    expect(receipt.recalculation.unresolvedFormulaCount).toBe(1);
  });

  it("requires post-write verification after an observed write even when task wording is classified as nonmutating", async () => {
    const root = tempRoot();
    const instruction = "Model!B1 should contain formula A1*2.";
    const task = await stagedTask(root, instruction);
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: join(root, "output", "missing-post-write-verification.xlsx"),
      model: noPostWriteVerificationModel(instruction),
      traceId: "trace_sbench_missing_post_write_verification",
      maxSteps: 6,
      now: () => 1_300,
    });

    expect(receipt.outcome).toMatchObject({
      status: "needs_repair",
      mutatingTask: false,
      changedCellCount: 1,
      finalVerificationStatus: "missing",
    });
    expect(receipt.stages.write.status).toBe("completed");
    expect(receipt.stages.verify.status).toBe("skipped");
    expect(receipt.trace.final.status).toBe("needs_review");
  });

  it("blocks model-supplied pass/fail writes when a selected lookup key has missing bounds", async () => {
    const root = tempRoot();
    const task = await stagedMissingLookupBoundsTask(root);
    const candidate = join(root, "output", "missing-lookup-bounds.xlsx");
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: missingLookupBoundsModel(task.instruction),
      traceId: "trace_sbench_missing_lookup_bounds",
      maxSteps: 6,
      now: () => 1_350,
    });

    expect(receipt.outcome).toMatchObject({
      status: "needs_repair",
      changedCellCount: 0,
      finalVerificationStatus: "missing",
    });
    expect(receipt.stages.preflight.status).toBe("needs_repair");
    const preflight = receipt.frame.agentResult.trace.find((event) =>
      event.tool === "verify_workbook" && (event.args as Record<string, unknown>).afterWrite === false);
    expect(preflight?.result).toMatchObject({
      status: "needs_repair",
      plan: {
        issues: expect.arrayContaining([expect.objectContaining({ kind: "unsafe_lookup_bounds", address: "J16" })]),
      },
    });
    const write = receipt.frame.agentResult.trace.find((event) => event.tool === "write_locked_cells");
    expect(write?.result).toMatchObject({ ok: false, error: "workbook_stage_guard" });

    const emitted = new ExcelJS.Workbook();
    await emitted.xlsx.readFile(candidate);
    expect(emitted.getWorksheet("Sheet1")?.getCell("J16").value).toBeNull();
  });

  it("executes a large inferred plan through one compact managed action while preserving phase receipts", async () => {
    const root = tempRoot();
    const task = await stagedDebtWaterfallTask(root);
    const candidate = join(root, "output", "candidate.xlsx");

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: compactWorkbookPlanModel(),
      traceId: "trace_sbench_compact_verified_plan",
      maxSteps: 4,
      now: () => 1_500,
    });

    expect(receipt.frame.agentResult.trace.map((event) => event.tool)).toEqual([
      "inspect_workbook",
      "execute_verified_workbook_plan",
    ]);
    expect(receipt.outcome).toMatchObject({
      status: "completed",
      changedCellCount: 46,
      finalVerificationStatus: "passed",
    });
    expect(receipt.stages.plan).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.stages.preflight).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.stages.write).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.stages.verify).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.recalculation).toMatchObject({
      attemptedFormulaCount: 46,
      refreshedFormulaCount: 46,
      unresolvedFormulaCount: 0,
    });
    const compact = receipt.frame.agentResult.trace[1].result as Record<string, unknown>;
    expect(compact).toMatchObject({
      ok: true,
      status: "completed",
      operationCount: 46,
      changedTargetCount: 46,
      workflowComplete: true,
      approvalBoundary: "RoomTools managed lock and compare-and-set",
      phases: {
        plan: { status: "completed", operationCount: 46 },
        preflight: { status: "passed" },
        write: { status: "completed", committedCount: 46 },
        verify: { status: "passed" },
      },
    });

    const emitted = new ExcelJS.Workbook();
    await emitted.xlsx.readFile(candidate);
    const sheet = emitted.getWorksheet("DebtWaterfall")!;
    expect(sheet.getCell("B6").value).toMatchObject({ formula: "B4-B5", result: 800 });
    expect(sheet.getCell("B13").formula).toBe("B12*AVERAGE(B9,B11)");
    expect(sheet.getCell("E25").formula).toBe("E6+E10+E17");
    expect(receipt.trace.mutations).toEqual([
      expect.objectContaining({
        status: "committed",
        targetRefs: expect.arrayContaining([expect.objectContaining({ refId: "DebtWaterfall!B6" })]),
      }),
    ]);
  });

  it("blocks a premature write, then preserves scalar number formatting through verified recovery", async () => {
    const root = tempRoot();
    const task = await stagedTask(root, "Set Model!C1 to 0% and preserve every other cell.");
    const candidate = join(root, "output", "candidate.xlsx");

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: stageGuardRecoveryModel(),
      traceId: "trace_sbench_stage_guard",
      maxSteps: 8,
      now: () => 2_000,
    });

    const writeEvents = receipt.frame.agentResult.trace.filter((event) => event.tool === "write_locked_cell");
    expect(writeEvents).toHaveLength(2);
    expect(writeEvents[0].result).toMatchObject({
      ok: false,
      error: "workbook_stage_guard",
      stageError: "preflight_required",
    });
    expect(writeEvents[1].result).toMatchObject({ ok: true });
    expect(receipt.outcome).toMatchObject({
      status: "completed",
      changedCellCount: 1,
      finalVerificationStatus: "passed",
    });
    expect(receipt.stages.preflight.status).toBe("completed");
    expect(receipt.stages.verify.status).toBe("completed");

    const emitted = new ExcelJS.Workbook();
    await emitted.xlsx.readFile(candidate);
    const cell = emitted.getWorksheet("Model")!.getCell("C1");
    expect(cell.value).toBe(0);
    expect(cell.numFmt).toBe("0.0%");
  });

  it("uses the visible filename to select an audit sheet and carries that artifact through omitted write ids", async () => {
    const root = tempRoot();
    const task = await stagedMultiSheetTask(root);
    const candidate = join(root, "output", "candidate.xlsx");

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: preferredSheetModel(),
      traceId: "trace_sbench_preferred_sheet",
      maxSteps: 8,
      now: () => 3_000,
    });

    expect(receipt.outcome).toMatchObject({ status: "completed", changedCellCount: 1, finalVerificationStatus: "passed" });
    expect(receipt.frame.agentResult.trace.find((event) => event.tool === "inspect_workbook")?.result).toMatchObject({
      artifactId: "Metrics",
    });
    expect(receipt.frame.agentResult.trace.find((event) => event.tool === "read_range")?.result).toEqual([
      expect.objectContaining({ id: "B1" }),
    ]);
    const emitted = new ExcelJS.Workbook();
    await emitted.xlsx.readFile(candidate);
    expect(emitted.getWorksheet("Metrics")?.getCell("B1").formula).toBe("AVERAGE(C1:D1)");
    expect(emitted.getWorksheet("Cover")?.getCell("A1").value).toBe("Cover sheet");
  });

  it("expands bounded quoted sheet ranges without aborting the NodeAgent frame", async () => {
    const root = tempRoot();
    const task = await stagedMultiSheetTask(root);
    const candidate = join(root, "output", "range-read.xlsx");

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: boundedRangeReadModel(),
      traceId: "trace_sbench_bounded_range_read",
      maxSteps: 8,
      snapshotMaxCells: 20,
      now: () => 3_250,
    });

    expect(receipt.frame.runtimeError).toBeUndefined();
    expect(receipt.outcome).toMatchObject({ status: "completed", changedCellCount: 1, finalVerificationStatus: "passed" });
    expect(receipt.frame.agentResult.trace.find((event) => event.tool === "read_range")?.result).toEqual([
      expect.objectContaining({ id: "B1" }),
      expect.objectContaining({ id: "C1" }),
      expect.objectContaining({ id: "D1" }),
      expect.objectContaining({ id: "A1" }),
    ]);
  });

  it("returns recoverable feedback for invalid Excel bounds and discloses truncated range reads", async () => {
    const root = tempRoot();
    const task = await stagedMultiSheetTask(root);
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: join(root, "output", "range-recovery.xlsx"),
      model: recoveringBoundedRangeModel(),
      traceId: "trace_sbench_range_recovery",
      maxSteps: 8,
      snapshotMaxCells: 3,
      now: () => 3_500,
    });

    const reads = receipt.frame.agentResult.trace.filter((event) => event.tool === "read_range");
    expect(receipt.frame.runtimeError).toBeUndefined();
    expect(reads[0]?.result).toMatchObject({
      ok: false,
      error: "invalid_read_reference",
      recovery: { action: "retry_tool_call" },
    });
    expect(reads[1]?.result).toEqual([
      expect.objectContaining({ id: "A1", hint: expect.stringContaining("contains 4 cells") }),
      expect.objectContaining({ id: "B1" }),
      expect.objectContaining({ id: "C1" }),
    ]);
    expect(receipt.outcome).toMatchObject({ status: "completed", changedCellCount: 1, finalVerificationStatus: "passed" });
  });

  it("keeps workbook-wide average repairs open until every worksheet passes post-write verification", async () => {
    const root = tempRoot();
    const task = await stagedWorkbookWideAverageTask(root);
    const candidate = join(root, "output", "candidate.xlsx");

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: workbookWideAverageModel(),
      traceId: "trace_sbench_workbook_wide_average",
      maxSteps: 7,
      now: () => 4_000,
    });

    expect(receipt.outcome).toMatchObject({ status: "needs_repair", changedCellCount: 3, finalVerificationStatus: "needs_repair" });
    expect(receipt.recalculation.unresolvedFormulaCount).toBeGreaterThan(0);
    expect(receipt.frame.agentResult.stopReason).toBe("step_budget");
    const inspection = receipt.frame.agentResult.trace.find((event) => event.tool === "inspect_workbook")?.result as Record<string, unknown>;
    expect(inspection).toMatchObject({
      artifactId: "WACC",
      inspection: {
        findings: [
          expect.objectContaining({ kind: "formula_range_anomaly", sheet: "WACC", address: "D7" }),
          expect.objectContaining({ kind: "formula_range_anomaly", sheet: "WACC", address: "D14" }),
        ],
        formulaRepairSuggestions: [
          expect.objectContaining({ sheet: "WACC", cell: "D7" }),
          expect.objectContaining({ sheet: "WACC", cell: "D14" }),
        ],
      },
      workbookWideRepairContract: {
        requiredRepairs: expect.arrayContaining([
          expect.objectContaining({ sheet: "DCF", cell: "I15", formula: "AVERAGE($G$15:$H$15)" }),
          expect.objectContaining({ sheet: "WACC", cell: "D7", formula: "AVERAGE('Exhibit 6'!E36:J36)" }),
          expect.objectContaining({ sheet: "WACC", cell: "D14", formula: "AVERAGE('Exhibit 9'!M8:M22/100)" }),
        ]),
      },
    });
    const postWrites = receipt.frame.agentResult.trace.filter((event) =>
      event.tool === "verify_workbook" && (event.args as Record<string, unknown>).afterWrite === true);
    expect(postWrites).toHaveLength(2);
    expect(postWrites[0].result).toMatchObject({ status: "needs_repair", issueCount: 1 });
    expect(postWrites[1].result).toMatchObject({ status: "passed" });

    const emitted = new ExcelJS.Workbook();
    await emitted.xlsx.readFile(candidate);
    expect(emitted.getWorksheet("DCF")?.getCell("I15").formula).toBe("AVERAGE($G$15:$H$15)");
    expect(emitted.getWorksheet("WACC")?.getCell("D7").formula).toBe("AVERAGE('Exhibit 6'!E36:J36)");
    expect(emitted.getWorksheet("WACC")?.getCell("D14").formula).toBe("AVERAGE('Exhibit 9'!M8:M22/100)");
  });

  it("keeps concurrently written worksheets open until every pending verification passes", async () => {
    const root = tempRoot();
    const task = await stagedWorkbookWideAverageTask(root);
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: join(root, "output", "candidate.xlsx"),
      model: workbookWideConcurrentVerificationModel(),
      traceId: "trace_sbench_concurrent_pending_verifications",
      maxSteps: 7,
      now: () => 4_250,
    });

    expect(receipt.outcome).toMatchObject({ status: "needs_repair", changedCellCount: 3, finalVerificationStatus: "needs_repair" });
    expect(receipt.recalculation.unresolvedFormulaCount).toBeGreaterThan(0);
    const postWrites = receipt.frame.agentResult.trace.filter((event) =>
      event.tool === "verify_workbook" && (event.args as Record<string, unknown>).afterWrite === true);
    expect(postWrites).toHaveLength(2);
    expect(postWrites[0].result).toMatchObject({
      status: "needs_repair",
      issueCount: 1,
      pendingArtifacts: ["WACC"],
      issues: [expect.objectContaining({ kind: "pending_workbook_verification", sheet: "WACC" })],
      verificationRequired: { tool: "verify_workbook", args: { artifactId: "WACC", afterWrite: true } },
    });
    expect(postWrites[1].result).toMatchObject({ status: "passed", workflowComplete: true });
  });

  it("does not preserve completion when the provider fails and recalculation remains unresolved", async () => {
    const root = tempRoot();
    const task = await stagedWorkbookWideAverageTask(root);
    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: join(root, "output", "candidate.xlsx"),
      model: workbookWideAverageModel(true),
      traceId: "trace_sbench_verified_then_provider_error",
      maxSteps: 9,
      now: () => 4_500,
    });

    expect(receipt.frame.runtimeError).toContain("provider failed after deterministic proof");
    expect(receipt.frame.agentResult.stopReason).toBe("error");
    expect(receipt.outcome).toMatchObject({ status: "failed", changedCellCount: 3, finalVerificationStatus: "needs_repair" });
    expect(receipt.recalculation.unresolvedFormulaCount).toBeGreaterThan(0);
  });

  it("rejects an input path that escapes the staged agent directory before invoking the model", async () => {
    const root = tempRoot();
    const agentDir = join(root, "tasks", "escape", "agent");
    const evaluatorDir = join(root, "tasks", "escape", "evaluator");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(evaluatorDir, { recursive: true });
    const hiddenWorkbook = new ExcelJS.Workbook();
    hiddenWorkbook.addWorksheet("Gold").getCell("A1").value = "EVALUATOR_TRIPWIRE_SECRET";
    await hiddenWorkbook.xlsx.writeFile(join(evaluatorDir, "gold.xlsx"));
    writeJson(join(agentDir, "task.json"), {
      schema: 1,
      taskId: "Template/escape",
      track: "spreadsheetbench-v2",
      instruction: "Update A1.",
      inputFiles: ["../evaluator/gold.xlsx"],
      promptFiles: [],
    });
    let modelCalls = 0;
    const model: AgentModel = {
      name: "must-not-run",
      async next(): Promise<AgentStep> {
        modelCalls += 1;
        return { text: "unexpected", toolCalls: [], done: true };
      },
    };
    const candidate = join(root, "output", "candidate.xlsx");

    await expect(runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: join(agentDir, "task.json"),
      candidateWorkbookPath: candidate,
      model,
    })).rejects.toThrow("path escapes agent workspace");
    expect(modelCalls).toBe(0);
    expect(existsSync(candidate)).toBe(false);
    });
  });

  it("preflights and post-verifies the full compact plan when one target is already satisfied", async () => {
    const root = tempRoot();
    const task = await stagedDebtWaterfallTask(root);
    const inputPath = join(root, "tasks", "debt-waterfall", "agent", "inputs", "01-02_04_input.xlsx");
    const input = new ExcelJS.Workbook();
    await input.xlsx.readFile(inputPath);
    input.getWorksheet("DebtWaterfall")!.getCell("B6").value = { formula: "B4-B5", result: 800 };
    await input.xlsx.writeFile(inputPath);
    const candidate = join(root, "output", "partial-candidate.xlsx");

    const receipt = await runSpreadsheetBenchNodeAgentBridge({
      agentManifestPath: task.agentManifest,
      candidateWorkbookPath: candidate,
      model: compactWorkbookPlanModel(),
      traceId: "trace_sbench_compact_partial_plan",
      maxSteps: 4,
      now: () => 1_600,
    });

    expect(receipt.outcome).toMatchObject({
      status: "completed",
      changedCellCount: 45,
      finalVerificationStatus: "passed",
    });
    expect(receipt.stages.plan).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.stages.preflight).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.stages.write).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.stages.verify).toMatchObject({ status: "completed", operationCount: 46 });
    expect(receipt.frame.agentResult.trace[1]?.result).toMatchObject({
      operationCount: 46,
      changedTargetCount: 45,
      phases: { write: { targetCount: 45, committedCount: 45 } },
    });
  });

function repairingWorkbookModel(capture: {
  systems: string[];
  messages: string[];
  toolNames: string[][];
}): AgentModel {
  let callIndex = 0;
  const operation = { elementId: "B1", formula: "A1*2" };
  return {
    name: "scripted-spreadsheetbench-repair",
    async next(input): Promise<AgentStep> {
      capture.systems.push(input.system);
      capture.messages.push(input.messages.map((message) => message.content).join("\n"));
      capture.toolNames.push(input.tools.map((tool) => tool.name));
      const results = toolResults(input.messages);
      const id = `bridge-call-${++callIndex}`;
      if (!results.some((result) => result.name === "inspect_workbook")) {
        return step(id, "inspect_workbook", {
          instruction: "Update Model!B1 using Model!A1 so B1 contains formula A1*2, then verify the changed cell.",
          artifactId: "Model",
          maxCells: 40,
        });
      }
      const preflights = results.filter((result) => result.name === "verify_workbook" && result.phase === "preflight");
      if (preflights.length === 0) {
        return step(id, "verify_workbook", {
          instruction: "Update Model!B1 using Model!A1 so B1 contains formula A1*2, then verify the changed cell.",
          artifactId: "Model",
          afterWrite: false,
          operations: [{ elementId: "B1", formula: "B1*2", result: 4 }],
        });
      }
      if (preflights.length === 1) {
        return step(id, "verify_workbook", {
          instruction: "Update Model!B1 using Model!A1 so B1 contains formula A1*2, then verify the changed cell.",
          artifactId: "Model",
          afterWrite: false,
          operations: [operation],
        });
      }
      if (!results.some((result) => result.name === "write_locked_cells")) {
        return step(id, "write_locked_cells", {
          artifactId: "Model",
          reason: "verified SpreadsheetBench formula repair",
          ops: [{ elementId: "B1", formula: "A1*2" }],
        });
      }
      if (!results.some((result) => result.name === "verify_workbook" && result.phase === "post_write")) {
        return step(id, "verify_workbook", {
          instruction: "Update Model!B1 using Model!A1 so B1 contains formula A1*2, then verify the changed cell.",
          artifactId: "Model",
          afterWrite: true,
          operations: [operation],
        });
      }
      return {
        text: "Workbook repair completed and every changed target passed post-write verification.",
        toolCalls: [],
        done: true,
        usage: { inputTokens: 5, outputTokens: 3 },
      };
    },
  };
}

function unresolvedRecalculationModel(instruction: string): AgentModel {
  let callIndex = 0;
  const operation = { elementId: "B1", formula: 'TEXT(A1,"0.00")' };
  return {
    name: "scripted-unresolved-recalculation",
    async next(): Promise<AgentStep> {
      const id = `unresolved-recalculation-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction, artifactId: "Model", maxCells: 40 });
      if (callIndex === 2) return step(id, "verify_workbook", { instruction, artifactId: "Model", afterWrite: false, operations: [operation] });
      if (callIndex === 3) return step(id, "write_locked_cells", { artifactId: "Model", reason: "apply verified formula", ops: [operation] });
      if (callIndex === 4) return step(id, "verify_workbook", { instruction, artifactId: "Model", afterWrite: true, operations: [operation] });
      return { text: "The formula write passed structural verification.", toolCalls: [], done: true };
    },
  };
}

function noPostWriteVerificationModel(instruction: string): AgentModel {
  let callIndex = 0;
  const operation = { elementId: "B1", formula: "A1*2" };
  return {
    name: "scripted-no-post-write-verification",
    async next(): Promise<AgentStep> {
      const id = `no-post-write-verification-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction, artifactId: "Model", maxCells: 40 });
      if (callIndex === 2) return step(id, "verify_workbook", { instruction, artifactId: "Model", afterWrite: false, operations: [operation] });
      if (callIndex === 3) return step(id, "write_locked_cells", { artifactId: "Model", reason: "apply verified formula", ops: [operation] });
      return { text: "The requested formula was written.", toolCalls: [], done: true };
    },
  };
}

function missingLookupBoundsModel(instruction: string): AgentModel {
  let callIndex = 0;
  const operations = [
    { elementId: "J15", formula: 'IF(MEDIAN(H15,VLOOKUP(B15,$A$3:$J$4,{9,10},0))=H15,"Pass","Fail")' },
    { elementId: "J16", formula: 'IF(MEDIAN(H16,VLOOKUP(B16,$A$3:$J$4,{9,10},0))=H16,"Pass","Fail")' },
  ];
  return {
    name: "scripted-missing-lookup-bounds",
    async next(): Promise<AgentStep> {
      const id = `missing-lookup-bounds-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction, artifactId: "Sheet1", maxCells: 80 });
      if (callIndex === 2) return step(id, "verify_workbook", { instruction, artifactId: "Sheet1", afterWrite: false, operations });
      if (callIndex === 3) return step(id, "write_locked_cells", { artifactId: "Sheet1", reason: "attempt pass/fail formulas", ops: operations });
      return { text: "The unsafe plan was not applied.", toolCalls: [], done: true };
    },
  };
}

function invalidArtifactInspectionModel(): AgentModel {
  let callIndex = 0;
  return {
    name: "scripted-invalid-artifact-inspection",
    async next(): Promise<AgentStep> {
      callIndex += 1;
      if (callIndex === 1) return step("invalid-artifact-inspection-1", "inspect_workbook", {
        instruction: "Inspect the workbook and report what remains.",
        artifactId: "Financial_Model/01_02",
      });
      return { text: "Inspection complete.", toolCalls: [], done: true };
    },
  };
}

function compactWorkbookPlanModel(): AgentModel {
  let callIndex = 0;
  return {
    name: "scripted-compact-workbook-plan",
    async next(): Promise<AgentStep> {
      const id = `compact-plan-${++callIndex}`;
      if (callIndex === 1) {
        return step(id, "inspect_workbook", {
          instruction: "Use the average balance method for interest expense.",
          artifactId: "DebtWaterfall",
          maxCells: 200,
        });
      }
      if (callIndex === 2) {
        return step(id, "execute_verified_workbook_plan", {
          instruction: "Use the average balance method for interest expense.",
          artifactId: "DebtWaterfall",
          maxCells: 200,
          reason: "complete verified debt waterfall",
        });
      }
      return {
        text: "The complete debt waterfall plan passed preflight, managed write, and post-write verification.",
        toolCalls: [],
        done: true,
      };
    },
  };
}

function stageGuardRecoveryModel(): AgentModel {
  let callIndex = 0;
  const instruction = "Set Model!C1 to 0% and preserve every other cell.";
  const operation = { elementId: "C1", value: 0, numFmt: "0.0%" };
  return {
    name: "scripted-spreadsheetbench-stage-guard",
    async next(): Promise<AgentStep> {
      const id = `stage-guard-${++callIndex}`;
      if (callIndex === 1) {
        return step(id, "inspect_workbook", { instruction, artifactId: "Model", maxCells: 40 });
      }
      if (callIndex === 2) {
        return step(id, "write_locked_cell", { ...operation, reason: "premature write" });
      }
      if (callIndex === 3) {
        return step(id, "verify_workbook", {
          instruction,
          artifactId: "Model",
          afterWrite: false,
          operations: [operation],
        });
      }
      if (callIndex === 4) {
        return step(id, "write_locked_cell", { ...operation, reason: "approved write" });
      }
      if (callIndex === 5) {
        return step(id, "verify_workbook", {
          instruction,
          artifactId: "Model",
          afterWrite: true,
          operations: [operation],
        });
      }
      return {
        text: "The guarded scalar write passed post-write verification.",
        toolCalls: [],
        done: true,
        usage: { inputTokens: 5, outputTokens: 3 },
      };
    },
  };
}

function preferredSheetModel(): AgentModel {
  let callIndex = 0;
  const operation = { elementId: "B1", formula: "AVERAGE(C1:D1)", result: 15 };
  return {
    name: "scripted-preferred-sheet",
    async next(): Promise<AgentStep> {
      const id = `preferred-sheet-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction: "Audit the workbook.", maxCells: 40 });
      if (callIndex === 2) return step(id, "read_range", { artifactId: "01-Incorrect Average_input.xlsx", elementIds: ["Metrics!B1"] });
      if (callIndex === 3) return step(id, "verify_workbook", { instruction: "Audit the workbook.", operations: [operation], afterWrite: false });
      if (callIndex === 4) return step(id, "write_locked_cells", { reason: "repair incorrect average", ops: [operation] });
      if (callIndex === 5) return step(id, "verify_workbook", { instruction: "Audit the workbook.", operations: [operation], afterWrite: true });
      return { text: "Average formula repaired and verified.", toolCalls: [], done: true };
    },
  };
}

function boundedRangeReadModel(): AgentModel {
  let callIndex = 0;
  const operation = { elementId: "B1", formula: "AVERAGE(C1:D1)", result: 15 };
  return {
    name: "scripted-bounded-range-read",
    async next(): Promise<AgentStep> {
      const id = `bounded-range-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction: "Audit the workbook.", maxCells: 40 });
      if (callIndex === 2) {
        return step(id, "read_range", {
          artifactId: "Metrics",
          elementIds: ["'Metrics'!$B$1:$D$1", "Metrics!A1,"],
        });
      }
      if (callIndex === 3) return step(id, "verify_workbook", { instruction: "Audit the workbook.", operations: [operation], afterWrite: false });
      if (callIndex === 4) return step(id, "write_locked_cells", { reason: "repair incorrect average", ops: [operation] });
      if (callIndex === 5) return step(id, "verify_workbook", { instruction: "Audit the workbook.", operations: [operation], afterWrite: true });
      return { text: "Average formula repaired and verified after a bounded range read.", toolCalls: [], done: true };
    },
  };
}

function recoveringBoundedRangeModel(): AgentModel {
  let callIndex = 0;
  const operation = { elementId: "B1", formula: "AVERAGE(C1:D1)", result: 15 };
  return {
    name: "scripted-recovering-bounded-range",
    async next(): Promise<AgentStep> {
      const id = `recovering-range-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction: "Audit the workbook.", maxCells: 40 });
      if (callIndex === 2) return step(id, "read_range", { artifactId: "Metrics", elementIds: ["XFE1"] });
      if (callIndex === 3) return step(id, "read_range", { artifactId: "Metrics", elementIds: ["'Metrics'!A1:D1"] });
      if (callIndex === 4) return step(id, "verify_workbook", { instruction: "Audit the workbook.", operations: [operation], afterWrite: false });
      if (callIndex === 5) return step(id, "write_locked_cells", { reason: "repair incorrect average", ops: [operation] });
      if (callIndex === 6) return step(id, "verify_workbook", { instruction: "Audit the workbook.", operations: [operation], afterWrite: true });
      return { text: "Recovered from an invalid range and completed the verified repair.", toolCalls: [], done: true };
    },
  };
}

function workbookWideAverageModel(failAfterProof = false): AgentModel {
  let callIndex = 0;
  const wacc = [
    { elementId: "WACC!D7", formula: "AVERAGE('Exhibit 6'!E36:J36)", result: 0.15 },
    { elementId: "WACC!D14", formula: "AVERAGE('Exhibit 9'!M8:M22/100)", result: 0.08 },
  ];
  const dcf = [{ elementId: "DCF!I15", formula: "AVERAGE($G$15:$H$15)", result: 0.045 }];
  const waccEchoResults = wacc.map((operation) => ({
    ...operation,
    result: { formula: operation.formula },
  }));
  return {
    name: "scripted-workbook-wide-average",
    async next(): Promise<AgentStep> {
      const id = `workbook-wide-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction: "Audit the workbook.", artifactId: "Cover", maxCells: 80 });
      if (callIndex === 2) return step(id, "verify_workbook", { instruction: "Audit DCF.", artifactId: "DCF", operations: dcf, afterWrite: false });
      if (callIndex === 3) return step(id, "verify_workbook", { instruction: "Audit WACC.", operations: waccEchoResults, afterWrite: false });
      if (callIndex === 4) return step(id, "write_locked_cells", { artifactId: "WACC", reason: "repair WACC averages", ops: wacc });
      if (callIndex === 5) return step(id, "verify_workbook", { instruction: "Audit WACC.", artifactId: "WACC", operations: wacc, afterWrite: true });
      if (callIndex === 6) return step(id, "write_locked_cells", { artifactId: "DCF", reason: "repair DCF average", cells: dcf });
      if (callIndex === 7) return step(id, "verify_workbook", { instruction: "Continue workbook repair.", artifactId: "DCF", operations: dcf, afterWrite: true });
      if (callIndex === 8) return step(id, "verify_workbook", { instruction: "Idempotently recheck DCF.", artifactId: "DCF", operations: dcf, afterWrite: true });
      if (failAfterProof) throw new Error("provider failed after deterministic proof");
      return { text: "All workbook-wide average repairs passed post-write verification.", toolCalls: [], done: true };
    },
  };
}

function workbookWideConcurrentVerificationModel(): AgentModel {
  let callIndex = 0;
  const dcf = [{ elementId: "DCF!I15", formula: "AVERAGE($G$15:$H$15)", numFmt: "0.0%" }];
  const wacc = [
    { elementId: "WACC!D7", formula: "AVERAGE('Exhibit 6'!E36:J36)", numFmt: "0.0%" },
    { elementId: "WACC!D14", formula: "AVERAGE('Exhibit 9'!M8:M22/100)", numFmt: "0.0%" },
  ];
  return {
    name: "scripted-workbook-wide-concurrent-verification",
    async next(): Promise<AgentStep> {
      const id = `workbook-wide-concurrent-${++callIndex}`;
      if (callIndex === 1) return step(id, "inspect_workbook", { instruction: "Audit the workbook.", artifactId: "Cover", maxCells: 80 });
      if (callIndex === 2) return step(id, "verify_workbook", { instruction: "Audit DCF.", artifactId: "DCF", operations: dcf, afterWrite: false });
      if (callIndex === 3) return step(id, "verify_workbook", { instruction: "Audit WACC.", artifactId: "WACC", operations: wacc, afterWrite: false });
      if (callIndex === 4) return step(id, "write_locked_cell", { artifactId: "DCF", elementId: "I15", formula: "AVERAGE($G$15:$H$15)", numFmt: "0.0%" });
      if (callIndex === 5) return step(id, "write_locked_cells", { artifactId: "WACC", reason: "repair WACC averages", ops: wacc });
      if (callIndex === 6) return step(id, "verify_workbook", { instruction: "Audit DCF.", artifactId: "DCF", operations: dcf, afterWrite: true });
      if (callIndex === 7) return step(id, "verify_workbook", { instruction: "Audit WACC.", artifactId: "WACC", operations: wacc, afterWrite: true });
      return { text: "All workbook-wide average repairs passed post-write verification.", toolCalls: [], done: true };
    },
  };
}

function step(id: string, tool: string, args: Record<string, unknown>): AgentStep {
  return {
    text: `Running ${tool}.`,
    toolCalls: [{ id, tool, args }],
    done: false,
    usage: { inputTokens: 5, outputTokens: 3 },
  };
}

function toolResults(messages: AgentMessage[]): Array<{ name: string; phase?: string }> {
  return messages.flatMap((message) => {
    if (message.role !== "tool" || !message.toolName) return [];
    try {
      const result = JSON.parse(message.content) as Record<string, unknown>;
      return [{ name: message.toolName, phase: typeof result.phase === "string" ? result.phase : undefined }];
    } catch {
      return [{ name: message.toolName }];
    }
  });
}

async function stagedTask(
  root: string,
  instruction = "Update Model!B1 using Model!A1 so B1 contains formula A1*2, then verify the changed cell.",
): Promise<{ agentManifest: string }> {
  const taskDir = join(root, "tasks", "bridge-01");
  const agentDir = join(taskDir, "agent");
  const evaluatorDir = join(taskDir, "evaluator");
  mkdirSync(join(agentDir, "inputs"), { recursive: true });
  mkdirSync(join(agentDir, "prompts"), { recursive: true });
  mkdirSync(join(evaluatorDir, "gold"), { recursive: true });

  const input = new ExcelJS.Workbook();
  const sheet = input.addWorksheet("Model");
  sheet.getCell("A1").value = 2;
  sheet.getCell("B1").value = { formula: "A1*1", result: 2 };
  sheet.getCell("A2").value = 3;
  sheet.getCell("B2").value = { formula: "A2*2", result: 6, ref: "B2:C2", shareType: "shared" } as ExcelJS.CellValue;
  sheet.getCell("C2").value = { sharedFormula: "B2", result: 12 } as ExcelJS.CellValue;
  await input.xlsx.writeFile(join(agentDir, "inputs", "input.xlsx"));
  writeFileSync(join(agentDir, "prompts", "task.txt"), "Preserve workbook structure and use a managed write.");
  writeJson(join(agentDir, "task.json"), {
    schema: 1,
    taskId: "Template/bridge-01",
    track: "spreadsheetbench-v2",
    category: "Template",
    instruction,
    inputFiles: ["inputs/input.xlsx"],
    promptFiles: ["prompts/task.txt"],
  });
  writeFileSync(join(evaluatorDir, "evaluator.json"), "EVALUATOR_TRIPWIRE_SECRET: invalid-json-on-purpose");
  writeFileSync(join(evaluatorDir, "gold", "gold.xlsx"), "EVALUATOR_TRIPWIRE_SECRET");
  return { agentManifest: join(agentDir, "task.json") };
}

async function stagedMissingLookupBoundsTask(
  root: string,
): Promise<{ agentManifest: string; instruction: string }> {
  const instruction = "Users select A-B in B15:B16 and enter readings in H15:H16. Fill J15:J16 with Pass or Fail using the corresponding lookup range defined by I3 and J3. The dropdown populates B3:B4.";
  const taskDir = join(root, "tasks", "lookup-bounds");
  const agentDir = join(taskDir, "agent");
  mkdirSync(join(agentDir, "inputs"), { recursive: true });

  const input = new ExcelJS.Workbook();
  const sheet = input.addWorksheet("Sheet1");
  sheet.getCell("A3").value = "A";
  sheet.getCell("A4").value = "B";
  sheet.getCell("I3").value = 0.2;
  sheet.getCell("J3").value = 0.5;
  sheet.getCell("B15").value = "A";
  sheet.getCell("B16").value = "B";
  sheet.getCell("H15").value = 0.3;
  sheet.getCell("H16").value = 999;
  await input.xlsx.writeFile(join(agentDir, "inputs", "input.xlsx"));
  writeJson(join(agentDir, "task.json"), {
    schema: 1,
    taskId: "Template/lookup-bounds",
    track: "spreadsheetbench-v2",
    category: "Template",
    instruction,
    inputFiles: ["inputs/input.xlsx"],
    promptFiles: [],
  });
  return { agentManifest: join(agentDir, "task.json"), instruction };
}

async function stagedDebtWaterfallTask(root: string): Promise<{ agentManifest: string }> {
  const taskDir = join(root, "tasks", "debt-waterfall");
  const agentDir = join(taskDir, "agent");
  mkdirSync(join(agentDir, "inputs"), { recursive: true });
  const input = new ExcelJS.Workbook();
  const sheet = input.addWorksheet("DebtWaterfall");
  const addRow = (row: number, label: string, values: unknown[]) => {
    sheet.getCell(`A${row}`).value = label;
    values.forEach((value, index) => {
      sheet.getCell(row, index + 2).value = value as ExcelJS.CellValue;
    });
  };
  ["Q1", "Q2", "Q3", "Q4"].forEach((value, index) => {
    sheet.getCell(2, index + 2).value = value;
  });
  addRow(4, "Cash Flow Available", [950, 1_050, 825, 980]);
  addRow(5, "Required Operating Cash", [150, 160, 155, 165]);
  addRow(6, "Available for Debt Repayment", [null, null, null, null]);
  addRow(9, "Beginning Balance", [3_800, null, null, null]);
  addRow(10, "Repayment", [-800, null, null, null]);
  addRow(11, "Ending Balance", [null, null, null, null]);
  addRow(12, "Interest Rate", [0.062, 0.062, 0.062, 0.062]);
  addRow(13, "Interest Expense", [null, null, null, null]);
  addRow(16, "Beginning Balance", [1_200, null, null, null]);
  addRow(17, "Repayment", [null, null, null, null]);
  addRow(18, "Ending Balance", [null, null, null, null]);
  addRow(19, "Interest Rate", [0.095, 0.095, 0.095, 0.095]);
  addRow(20, "Interest Expense", [null, null, null, null]);
  addRow(23, "Total Debt Outstanding", [null, null, null, null]);
  addRow(24, "Total Interest Expense", [null, null, null, null]);
  addRow(25, "Cash Remaining", [null, null, null, null]);
  await input.xlsx.writeFile(join(agentDir, "inputs", "01-02_04_input.xlsx"));
  writeJson(join(agentDir, "task.json"), {
    schema: 1,
    taskId: "Template/compact-debt-waterfall",
    track: "spreadsheetbench-v2",
    category: "Template",
    instruction: "Use the average balance method for interest expense.",
    inputFiles: ["inputs/01-02_04_input.xlsx"],
    promptFiles: [],
  });
  return { agentManifest: join(agentDir, "task.json") };
}

async function stagedMultiSheetTask(root: string): Promise<{ agentManifest: string }> {
  const taskDir = join(root, "tasks", "preferred-sheet");
  const agentDir = join(taskDir, "agent");
  mkdirSync(join(agentDir, "inputs"), { recursive: true });
  const input = new ExcelJS.Workbook();
  input.addWorksheet("Cover").getCell("A1").value = "Cover sheet";
  const metrics = input.addWorksheet("Metrics");
  metrics.getCell("A1").value = "Incorrect Average";
  metrics.getCell("B1").value = { formula: "AVERAGE(C1:C1)", result: 10 };
  metrics.getCell("C1").value = 10;
  metrics.getCell("D1").value = 20;
  await input.xlsx.writeFile(join(agentDir, "inputs", "01-Incorrect Average_input.xlsx"));
  writeJson(join(agentDir, "task.json"), {
    schema: 1,
    taskId: "Debugging/preferred-sheet",
    track: "spreadsheetbench-v2",
    category: "Debugging",
    instruction: "Please audit and fix this file thoroughly.",
    inputFiles: ["inputs/01-Incorrect Average_input.xlsx"],
    promptFiles: [],
  });
  return { agentManifest: join(agentDir, "task.json") };
}

async function stagedWorkbookWideAverageTask(root: string): Promise<{ agentManifest: string }> {
  const taskDir = join(root, "tasks", "workbook-wide-average");
  const agentDir = join(taskDir, "agent");
  mkdirSync(join(agentDir, "inputs"), { recursive: true });
  const input = new ExcelJS.Workbook();
  const dcf = input.addWorksheet("DCF");
  dcf.getCell("F15").value = null;
  dcf.getCell("G15").value = { formula: "G14/G9*-1", result: 0.04 };
  dcf.getCell("H15").value = { formula: "H14/H9*-1", result: 0.05 };
  dcf.getCell("I15").value = { formula: "AVERAGE($F$15:$H$15)", result: 0.03 };
  const wacc = input.addWorksheet("WACC");
  wacc.getCell("C6").value = "Anadarko";
  wacc.getCell("D6").value = "Comparables";
  wacc.getCell("D7").value = { formula: "AVERAGE('Exhibit 6'!D36:J36)", result: 0.14 };
  wacc.getCell("D14").value = { formula: "AVERAGE('Exhibit 9'!M8:M26/100)", result: 0.09 };
  const exhibit6 = input.addWorksheet("Exhibit 6");
  exhibit6.getCell("D5").value = "Anadarko";
  for (const [index, column] of ["D", "E", "F", "G", "H", "I", "J"].entries()) {
    exhibit6.getCell(`${column}36`).value = 0.1 + index / 100;
  }
  const exhibit9 = input.addWorksheet("Exhibit 9");
  for (let row = 8; row <= 22; row += 1) exhibit9.getCell(`M${row}`).value = 7 + (row - 8) / 10;
  exhibit9.getCell("M25").value = 7.3;
  exhibit9.getCell("M26").value = 8.7;
  await input.xlsx.writeFile(join(agentDir, "inputs", "01-Incorrect Average_input.xlsx"));
  writeJson(join(agentDir, "task.json"), {
    schema: 1,
    taskId: "Debugging/workbook-wide-average",
    track: "spreadsheetbench-v2",
    category: "Debugging",
    instruction: "Please audit and fix this file thoroughly.",
    inputFiles: ["inputs/01-Incorrect Average_input.xlsx"],
    promptFiles: [],
  });
  return { agentManifest: join(agentDir, "task.json") };
}

async function addUnsupportedWpsDrawing(path: string): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const worksheet = zip.file("xl/worksheets/sheet1.xml");
  const contentTypes = zip.file("[Content_Types].xml");
  if (!worksheet || !contentTypes) throw new Error("fixture workbook package is incomplete");

  zip.file(
    "xl/worksheets/sheet1.xml",
    (await worksheet.async("string")).replace("</worksheet>", '<drawing r:id="rId1"/></worksheet>'),
  );
  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml" Id="rId1"/></Relationships>',
  );
  zip.file(
    "xl/drawings/drawing1.xml",
    '<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><twoCellAnchor editAs="oneCell"><from><col>1</col><colOff>0</colOff><row>1</row><rowOff>0</rowOff></from><to><col>3</col><colOff>0</colOff><row>4</row><rowOff>0</rowOff></to><pic><nvPicPr><cNvPr id="2" name="Picture 1"/><cNvPicPr/></nvPicPr><blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fillRect/></a:stretch></blipFill><spPr><a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="rect"><avLst/></a:prstGeom></spPr></pic><clientData/></twoCellAnchor></wsDr>',
  );
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/xl/media/image1.png" Id="rId1"/></Relationships>',
  );
  zip.file(
    "xl/media/image1.png",
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  );
  zip.file(
    "[Content_Types].xml",
    (await contentTypes.async("string")).replace(
      "</Types>",
      '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
    ),
  );
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
}

function tempRoot(): string {
  const root = join(tmpdir(), `noderoom-spreadsheetbench-nodeagent-${process.pid}-${Date.now()}-${roots.length}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
