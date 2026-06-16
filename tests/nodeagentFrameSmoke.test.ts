import { describe, expect, it } from "vitest";
import { runMinimalNodeAgentFrameSmoke } from "../examples/nodeagent-frame-runner/minimal";

describe("minimal NodeAgent frame adoption smoke", () => {
  it("runs a frame through read, lock, CAS edit, release, delta, and verifier receipt", async () => {
    const report = await runMinimalNodeAgentFrameSmoke();

    expect(report.ok).toBe(true);
    expect(report.status).toBe("completed");
    expect(report.stopReason).toBe("done");
    expect(report.traceTools).toEqual(["read_range", "propose_lock", "edit_cell", "release_lock"]);
    expect(report.allowedToolNames).toEqual(["read_range", "propose_lock", "edit_cell", "release_lock", "say"]);
    expect(report.missingToolNames).toEqual([]);
    expect(report.finalCellValue).toBe("Frame smoke proof: managed by NodeAgent.");
    expect(report.verificationReason).toBe("Frame completed.");
  });
});
