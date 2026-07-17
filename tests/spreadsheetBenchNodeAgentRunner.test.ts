import ExcelJS from "exceljs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runStagedSpreadsheetBench } from "../src/eval/spreadsheetBenchRunner";
import { stageSpreadsheetBenchBundle } from "../src/eval/spreadsheetBenchStage";
import type { AgentMessage, AgentModel, AgentStep } from "../src/nodeagent/core/types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench canonical NodeAgent runner mode", () => {
  it("scores a traced inspect-preflight-write-verify candidate emitted before evaluator access", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const output = tempRoot("output");
    const taskDir = join(source, "spreadsheet", "nodeagent-01");
    mkdirSync(taskDir, { recursive: true });
    writeJson(join(source, "dataset.json"), [{
      id: "nodeagent-01",
      instruction: "Set Sheet1!B2 to 2, preserving all other cells, and verify the changed cell.",
      spreadsheet_path: "spreadsheet/nodeagent-01",
      answer_position: "Sheet1!B2:B2",
      answer_sheet: "Sheet1",
    }]);
    await writeWorkbook(join(taskDir, "1_nodeagent-01_init.xlsx"), 1);
    await writeWorkbook(join(taskDir, "1_nodeagent-01_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-07-14T00:00:00.000Z",
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: output,
      mode: "nodeagent-workbook",
      model: workbookModel(),
      modelName: "scripted-nodeagent-workbook",
      clean: true,
      generatedAt: "2026-07-14T00:00:00.000Z",
    });

    expect(report.results[0].error).toBeUndefined();
    expect(report).toMatchObject({
      mode: "nodeagent-workbook",
      taskCount: 1,
      passCount: 1,
      averageOverall: 1,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 5 },
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((entry) => entry.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "run_nodeagent_workbook",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.sidecarEvidence?.verificationStatus).toBe("passed");
    expect(result.sidecarEvidence?.appliedOperationCount).toBe(1);
    expect(result.sidecarEvidence?.nodeAgentReceipt?.path).toBe("nodeagent-01/nodeagent-workbook-receipt.json");
    expect(result.sidecarEvidence?.nodeAgentTrace?.path).toBe("nodeagent-01/nodeagent-workbook-trace.json");
    expect(existsSync(join(output, result.sidecarEvidence!.nodeAgentReceipt!.path))).toBe(true);
    const receipt = JSON.parse(readFileSync(join(output, result.sidecarEvidence!.nodeAgentReceipt!.path), "utf8"));
    expect(receipt.outcome).toMatchObject({ status: "completed", changedCellCount: 1, finalVerificationStatus: "passed" });
    expect(receipt.frame.agentResult.trace.map((event: { tool: string }) => event.tool)).toEqual([
      "inspect_workbook",
      "verify_workbook",
      "write_locked_cells",
      "verify_workbook",
    ]);
    expect(JSON.stringify(receipt).toLowerCase()).not.toContain("golden");
    expect(JSON.stringify(receipt).toLowerCase()).not.toContain("evaluator.json");
  });
});

function workbookModel(): AgentModel {
  let call = 0;
  const operation = { elementId: "B2", value: 2 };
  return {
    name: "scripted-nodeagent-workbook",
    async next({ messages }): Promise<AgentStep> {
      const results = toolResults(messages);
      const id = `runner-nodeagent-${++call}`;
      if (!results.some((result) => result.name === "inspect_workbook")) {
        return toolStep(id, "inspect_workbook", {
          instruction: "Set Sheet1!B2 to 2, preserving all other cells, and verify the changed cell.",
          artifactId: "Sheet1",
        });
      }
      if (!results.some((result) => result.name === "verify_workbook" && result.phase === "preflight")) {
        return toolStep(id, "verify_workbook", {
          instruction: "Set Sheet1!B2 to 2, preserving all other cells, and verify the changed cell.",
          artifactId: "Sheet1",
          afterWrite: false,
          operations: [operation],
        });
      }
      if (!results.some((result) => result.name === "write_locked_cells")) {
        return toolStep(id, "write_locked_cells", {
          artifactId: "Sheet1",
          reason: "verified benchmark update",
          ops: [operation],
        });
      }
      if (!results.some((result) => result.name === "verify_workbook" && result.phase === "post_write")) {
        return toolStep(id, "verify_workbook", {
          instruction: "Set Sheet1!B2 to 2, preserving all other cells, and verify the changed cell.",
          artifactId: "Sheet1",
          afterWrite: true,
          operations: [operation],
        });
      }
      return {
        text: "The requested workbook change passed post-write verification.",
        toolCalls: [],
        done: true,
        usage: { inputTokens: 4, outputTokens: 2 },
      };
    },
  };
}

function toolStep(id: string, tool: string, args: Record<string, unknown>): AgentStep {
  return { text: `Running ${tool}.`, toolCalls: [{ id, tool, args }], done: false, usage: { inputTokens: 4, outputTokens: 2 } };
}

function toolResults(messages: AgentMessage[]): Array<{ name: string; phase?: string }> {
  return messages.flatMap((message) => {
    if (message.role !== "tool" || !message.toolName) return [];
    try {
      const result = JSON.parse(message.content) as { phase?: string };
      return [{ name: message.toolName, phase: result.phase }];
    } catch {
      return [{ name: message.toolName }];
    }
  });
}

async function writeWorkbook(path: string, value: number): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "target";
  sheet.getCell("B2").value = value;
  await workbook.xlsx.writeFile(path);
}

function tempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-sbench-${label}-`));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
