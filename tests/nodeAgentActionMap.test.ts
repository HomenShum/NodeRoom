import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

describe("NodeAgent low-friction action map", () => {
  it("documents every P0 workflow with UI, backend, friction, and approval policy", () => {
    const map = readJson<{
      freshRoomReceiptPattern: string;
      workflows: Array<{
        id: string;
        uiTouched: string[];
        backend: string[];
        frictionTarget: string;
        approvalPolicy: string;
      }>;
    }>("docs/nodeagent-action-map.json");

    expect(map.freshRoomReceiptPattern).toBe("docs/eval/fresh-room/<case-id>/latest.json");
    expect(map.workflows.map((workflow) => workflow.id)).toEqual([
      "create_or_join_room",
      "type_messy_note",
      "public_agent_prompt",
      "agent_fills_spreadsheet_cells",
      "human_edits_while_agent_works",
      "capture_source_evidence",
      "focus_mode_follow_along",
      "review_proposal",
      "export_deliverable",
      "coach_review_readiness",
      "downstream_sync",
    ]);

    for (const workflow of map.workflows) {
      expect(workflow.uiTouched.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.backend.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.frictionTarget.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.approvalPolicy.length, workflow.id).toBeGreaterThan(0);
    }
  });

  it("documents FR-010 SpreadsheetBench proof status", () => {
    const receipt = readJson<{
      benchmark: string;
      memoryMode: boolean;
      passed: boolean;
      scorer: { verdict: string };
      gatesProven: string[];
    }>("docs/eval/fresh-room/FR-010/latest.json");

    // FR-010 is a SpreadsheetBench live-browser proof with export/reopen validation
    expect(receipt.benchmark).toBe("spreadsheetbench-v1");
    expect(receipt.memoryMode).toBe(false);
    expect(receipt.passed).toBe(true);
    expect(receipt.scorer.verdict).toBe("pass");
    expect(receipt.gatesProven).toEqual(expect.arrayContaining([
      "fresh_room_join",
      "deliverable_export_download",
      "artifact_reopen_validation",
      "official_scorer_handoff",
    ]));
  });
});
