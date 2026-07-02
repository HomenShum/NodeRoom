import { describe, expect, it } from "vitest";
import {
  createNodeRoomProofLoopAdapter,
  type ProofLoopAppAdapter,
} from "../src/eval/proofloopAppAdapter";

describe("Proof Loop app adapter contract", () => {
  it("defines the app-agnostic adapter shape used by NodeRoom as reference adapter", async () => {
    const adapter: ProofLoopAppAdapter = createNodeRoomProofLoopAdapter();

    expect(adapter.id).toBe("noderoom");
    await expect(adapter.detect()).resolves.toBe(true);

    const setup = await adapter.setup();
    expect(setup.status).toBe("ready");
    expect(setup.evidence).toContain("proofloop/adapters/noderoom/selectors.ts");

    const start = await adapter.start();
    expect(start.command).toBe("npm run dev");
    await expect(adapter.getBaseUrl()).resolves.toBe("http://127.0.0.1:5173");

    const workflows = adapter.workflows();
    expect(workflows.map((workflow) => workflow.id)).toEqual(["accounting-live", "notion-live"]);
    expect(workflows.every((workflow) => workflow.expectedEvidence.includes("official-scorer-receipt.json"))).toBe(true);
  });
});
