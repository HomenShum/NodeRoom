import { describe, expect, it } from "vitest";
import type { CellPayload } from "../src/engine/types";
import type { RoomTools } from "../src/nodeagent/core/types";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { OkfConceptStore } from "../src/nodeagent/retrieval/okf/okfConceptStore";

describe("OKF evidence write gate", () => {
  it("downgrades unsupported source-backed complete writes to needs_review", async () => {
    let written: unknown;
    const rt = {
      okf: new OkfConceptStore([]),
      proposeLock: async () => ({ ok: true as const, lockId: "lock-1" }),
      releaseLock: async () => ({ ok: true, merged: [] }),
      editCell: async (_elementId: string, value: unknown) => {
        written = value;
        return { ok: true as const, version: 2 };
      },
    } as unknown as RoomTools;
    const tool = PRODUCTION_ROOM_TOOLS.find((item) => item.name === "write_locked_cell_result");
    expect(tool).toBeTruthy();

    const result = await tool!.execute({
      elementId: "r_cardionova__runway",
      value: "11 months",
      baseVersion: 1,
      status: "complete",
      confidence: 0.91,
      evidence: [{
        kind: "source",
        label: "Founder deck",
        source: "founder-deck.pdf",
        snippet: "cash and burn mentioned without exact page tie-out",
      }],
    }, rt);

    expect(result).toMatchObject({ ok: true });
    expect(written).toMatchObject({
      value: "11 months",
      status: "needs_review",
      review: {
        source: "okf_evidence_memo",
      },
    } satisfies Partial<CellPayload>);
  });
});
