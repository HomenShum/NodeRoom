import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanBankerToolBenchBundle } from "../src/eval/bankerToolBenchAdapter";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench official bundle ingest", () => {
  it("keeps Harbor as an ATIF-capable isolated certification lane", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");

    expect(adapterSource).toContain("SUPPORTS_ATIF = True");
    expect(adapterSource).toContain('"schema_version": "ATIF-v1.6"');
    expect(adapterSource).toContain("/logs/agent/trajectory.json");
    expect(adapterSource).toContain("/home/agent/workspace/banker_workspace/nodeagent_trace.json");
    expect(adapterSource).toContain("boundary_box_receipts.json");
  });

  it("ingests task jsonl, input files, and weighted rubric without exposing evaluator-only metadata to the agent", () => {
    const root = tempRoot();
    const taskId = "0fc7bc3c-a111-4222-8333-444455556666";
    writeTask(root, taskId);
    mkdirSync(join(root, "task-data", taskId, "Inputs"), { recursive: true });
    writeFileSync(join(root, "task-data", taskId, "Inputs", "model.xlsx"), "");
    writeFileSync(join(root, "task-data", taskId, "Inputs", "source.pdf"), "");
    mkdirSync(join(root, "golden-outputs", taskId), { recursive: true });
    writeFileSync(join(root, "golden-outputs", taskId, "answer.xlsx"), "");

    const report = scanBankerToolBenchBundle(root, {
      includeTasks: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.taskCount).toBe(1);
    expect(report.inputFileCount).toBe(2);
    expect(report.evaluatorGoldenFileCount).toBe(1);
    expect(report.rubricCriterionCount).toBe(2);
    expect(report.weightedRubricTotal).toBe(6);
    expect(report.productCounts).toEqual({ "M&A": 1 });
    expect(report.goldIsolation).toEqual({
      agentTaskGoldenPathLeaks: 0,
      agentTasksExposeGoldenOutputs: false,
      agentTaskRubricLeaks: 0,
      agentTasksExposeRubricMetadata: false,
      agentTaskCanaryLeaks: 0,
      agentTasksExposeCanary: false,
    });
    expect(report.tasks?.[0]?.agentTask).toMatchObject({
      id: taskId,
      harborTaskId: "btb-0fc7bc3c",
      instruction: "Build a buyer screen and short memo.",
      inputFiles: [
        `task-data/${taskId}/Inputs/model.xlsx`,
        `task-data/${taskId}/Inputs/source.pdf`,
      ],
      hasPromptContext: true,
      hasFormattingContext: true,
    });
    expect(report.tasks?.[0]?.evaluatorMetadata.rubricItems).toEqual([
      { criterion: "Uses revenue multiple correctly", weight: 5, category: "Excel" },
      { criterion: "Memo includes risks", weight: 1, category: "Memo" },
    ]);
    expect(JSON.stringify(report.sampleAgentTasks).toLowerCase()).not.toContain("golden");
    expect(JSON.stringify(report.sampleAgentTasks)).not.toContain("rubric");
    expect(JSON.stringify(report.sampleAgentTasks)).not.toContain("CANARY");
  });

  it("keeps NodeAgent source extraction from silently dropping ninth-peer comps sources", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");

    expect(adapterSource).toContain("BTB_NODEAGENT_MAX_SOURCE_TICKERS");
    expect(adapterSource).not.toContain("tickers[:8]");
  });

  it("keeps the public-comps workbook as one descriptive Excel artifact", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const genericWorkbook = sourceBetween(adapterSource, "def write_workbook():", "def write_presentation():");
    const publicCompsWorkbook = sourceBetween(
      adapterSource,
      "def write_public_comps_workbook(comps_rows, asof_date):",
      "def write_public_comps_presentation(comps_rows, asof_date):",
    );

    expect(genericWorkbook).toContain('workbook.save(OUT_DIR / "banker_model.xlsx")');
    expect(genericWorkbook).not.toContain("Software_Comps_Analysis.xlsx");
    expect(publicCompsWorkbook).toContain('workbook.save(OUT_DIR / "Software_Comps_Analysis.xlsx")');
    expect(publicCompsWorkbook).not.toContain('workbook.save(OUT_DIR / "banker_model.xlsx")');
  });

  it("routes sources-and-uses through a source-driven general-only writer, not a replay detector", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const generalSourcesUses = sourceBetween(
      adapterSource,
      "def write_general_sources_uses_package():",
      "def is_meta_overview_pack_task(text):",
    );
    const generalOnlyRouting = sourceBetween(
      adapterSource,
      'if materializer_mode == "general-only":',
      'elif materializer_mode == "replay":',
    );

    expect(generalSourcesUses).toContain("sources_uses_task_shape()");
    expect(generalSourcesUses).toContain('source_root / ticker / "vdr"');
    expect(generalSourcesUses).toContain("parse_plan_assumption");
    expect(generalSourcesUses).toContain("ltm_label_period_value");
    expect(generalSourcesUses).not.toContain("salesforce");
    expect(generalSourcesUses).not.toContain("btb-06c284ef");
    expect(generalOnlyRouting).toContain("write_general_sources_uses_package()");
  });

  it("routes take-private teasers through a source-driven general-only writer, not a replay detector", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const generalTakePrivate = sourceBetween(
      adapterSource,
      "def take_private_teaser_task_shape():",
      "def sources_uses_task_shape():",
    );
    const generalOnlyRouting = sourceBetween(
      adapterSource,
      'if materializer_mode == "general-only":',
      'elif materializer_mode == "replay":',
    );

    expect(generalTakePrivate).toContain("take_private_teaser_task_shape()");
    expect(generalTakePrivate).toContain('source_root / ticker / "vdr"');
    expect(generalTakePrivate).toContain("Company Profile");
    expect(generalTakePrivate).toContain("Price History");
    expect(generalTakePrivate).toContain("Shares Outstanding");
    expect(generalTakePrivate).toContain("Income Statement");
    expect(generalTakePrivate).toContain("Cash Flow Statement");
    expect(generalTakePrivate).toContain("Balance Sheet");
    expect(generalTakePrivate).not.toContain("comcast");
    expect(generalTakePrivate).not.toContain("CMCSA");
    expect(generalTakePrivate).not.toContain("btb-067cb834");
    expect(generalOnlyRouting).toContain("write_general_take_private_teaser_package()");
  });

  it("routes buyer-universe slides through a prompt/source-driven general-only writer, not a replay detector", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const generalBuyerUniverse = sourceBetween(
      adapterSource,
      "def buyer_universe_task_shape():",
      "def sources_uses_task_shape():",
    );
    const generalOnlyRouting = sourceBetween(
      adapterSource,
      'if materializer_mode == "general-only":',
      'elif materializer_mode == "replay":',
    );

    expect(generalBuyerUniverse).toContain("buyer_universe_task_shape()");
    expect(generalBuyerUniverse).toContain("candidate_buyer_universe");
    expect(generalBuyerUniverse).toContain("instruction.txt");
    expect(generalBuyerUniverse).toContain('source_root / ticker / "vdr"');
    expect(generalBuyerUniverse).toContain("Company Profile");
    expect(generalBuyerUniverse).toContain("buyer_universe_logo_assets");
    expect(generalBuyerUniverse).not.toContain("thermosafe");
    expect(generalBuyerUniverse).not.toContain("sonoco");
    expect(generalBuyerUniverse).not.toContain("btb-096a6840");
    expect(generalOnlyRouting).toContain("write_general_buyer_universe_package()");
  });

  it("keeps clean capability probes on generic writers only", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const genericOnlyRouting = sourceBetween(
      adapterSource,
      'if materializer_mode == "generic-only":',
      'elif materializer_mode == "general-only":',
    );

    expect(adapterSource).toContain("BTB_NODEAGENT_FORCE_MODEL_PLANNER");
    expect(adapterSource).toContain('"generic-only"');
    expect(genericOnlyRouting).toContain("write_workbook()");
    expect(genericOnlyRouting).toContain("write_presentation()");
    expect(genericOnlyRouting).toContain("write_memo()");
    expect(genericOnlyRouting).toContain("write_pdf()");
    expect(genericOnlyRouting).toContain("write_generic_alias_files()");
    expect(genericOnlyRouting).not.toContain("write_general_");
    expect(adapterSource).toContain('"generalFamilyMaterializersEnabled": materializer_mode == "general-only"');
    expect(adapterSource).toContain('"genericWriterOnly": materializer_mode == "generic-only"');
  });

  it("adds descriptive alias files only in the generic-only clean lane", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const aliasWriter = sourceBetween(
      adapterSource,
      "def write_generic_alias_files():",
      "def write_workbook():",
    );
    const genericOnlyRouting = sourceBetween(
      adapterSource,
      'if materializer_mode == "generic-only":',
      'elif materializer_mode == "general-only":',
    );

    expect(aliasWriter).toContain('copy_if_exists("banker_model.xlsx"');
    expect(aliasWriter).toContain('copy_if_exists("banker_presentation.pptx"');
    expect(aliasWriter).toContain('copy_if_exists("banker_memo.docx"');
    expect(aliasWriter).toContain('copy_if_exists("banker_report.pdf"');
    expect(genericOnlyRouting).toContain("write_generic_alias_files()");
  });

  it("honors exact generic slide counts without breaking one-slide-per prompts", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const genericPresentation = sourceBetween(
      adapterSource,
      "def write_presentation():",
      "def write_memo():",
    );

    expect(genericPresentation).toContain("requested_slide_count");
    expect(genericPresentation).toContain("exact_planned_slide_count");
    expect(genericPresentation).toContain("(?!\\s+per)");
    expect(genericPresentation).not.toContain("single_slide_mode");
  });

  it("counts derived formula citations as supported boundary receipts", () => {
    const adapterSource = readFileSync(join(process.cwd(), "btb_noderoom_agent", "harbor_adapter.py"), "utf8");
    const receiptWriter = sourceBetween(
      adapterSource,
      "def write_receipts():",
      "task_text_for_family =",
    );

    expect(receiptWriter).toContain('"derived"');
    expect(receiptWriter).toContain('"supported": status in supported');
  });
});

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-bankertoolbench-"));
  roots.push(root);
  return root;
}

function writeTask(root: string, taskId: string) {
  const row = {
    task_id: taskId,
    final_prompt: "Build a buyer screen and short memo.",
    prompt_context: "Use only the provided data room files.",
    formatting_context: "Return an Excel workbook and memo.",
    product: "M&A",
    workflow_cat: "Buyer Screen",
    workflow_subcat: "Public comps",
    canary: "CANARY-BTB-123",
    aggregated_rubric_json: JSON.stringify([
      { criterion: "Uses revenue multiple correctly", weight: 5, category: "Excel" },
      { criterion: "Memo includes risks", weight: 1, category: "Memo" },
    ]),
  };
  writeFileSync(join(root, "tasks.jsonl"), `${JSON.stringify(row)}\n`);
}
