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

  it("keeps the reserved FR-010 receipt explicitly non-passing until live proof fills it", () => {
    const receipt = readJson<{
      status: string;
      runtimeProfile: string;
      pass: boolean;
      scorer: { official: boolean; passed: boolean };
      proofSignals: Record<string, boolean>;
    }>("docs/eval/fresh-room/FR-010/latest.json");

    expect(receipt.status).toBe("template_pending_live_run");
    expect(receipt.runtimeProfile).toBe("benchmark_completion");
    expect(receipt.pass).toBe(false);
    expect(receipt.scorer.official).toBe(false);
    expect(receipt.scorer.passed).toBe(false);
    expect(Object.values(receipt.proofSignals).every((value) => value === false)).toBe(true);
  });
});
