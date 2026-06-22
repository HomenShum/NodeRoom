import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runBankerToolBenchNodeAgentSmoke } from "../src/eval/bankerToolBenchNodeAgentSmoke";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench NodeAgent smoke runner", () => {
  it("runs the real NodeAgent loop and writes BTB smoke artifacts plus trajectory evidence", async () => {
    const root = tempRoot();
    const result = await runBankerToolBenchNodeAgentSmoke({
      instruction: "Write the VDR sector, EDGAR SIC description, and one-sentence company summary.",
      facts: {
        sector: "Energy",
        sicDescription: "Crude Petroleum & Natural Gas",
        companyName: "Viper Energy",
        vdrSourcePath: "/home/agent/workspace/banker_workspace/source/VNOM-US Company Profile.xlsx",
        edgarSourcePath: "/home/agent/workspace/banker_workspace/source/submissions_0002074176.json",
      },
      outDir: join(root, "out"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      nowIso: "2026-06-20T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.stopReason).toBe("done");
    expect(result.usage.modelCalls).toBe(2);
    await expect(readFile(join(result.deliverablesDir, "vdr_answer.txt"), "utf8")).resolves.toBe("Energy\n");
    await expect(readFile(join(result.deliverablesDir, "edgar_answer.txt"), "utf8")).resolves.toBe("Crude Petroleum & Natural Gas\n");
    await expect(readFile(join(result.deliverablesDir, "summary.txt"), "utf8")).resolves.toContain("Viper Energy");

    const receipt = JSON.parse(await readFile(join(result.deliverablesDir, "boundary_box_receipts.json"), "utf8")) as {
      status: string;
      receipts: Array<{ artifact: string; boundaryBoxStatus: string }>;
    };
    expect(receipt.status).toBe("field-level-citation-smoke");
    expect(receipt.receipts.map((entry) => entry.artifact)).toEqual(["vdr_answer.txt", "edgar_answer.txt", "summary.txt"]);
    expect(receipt.receipts[0]?.boundaryBoxStatus).toBe("cell-required-in-full-eval");

    const trace = JSON.parse(await readFile(result.traceOut, "utf8")) as {
      trace: Array<{ tool: string }>;
    };
    expect(trace.trace.map((event) => event.tool)).toEqual(["write_locked_cells"]);

    const trajectory = JSON.parse(await readFile(result.trajectoryOut, "utf8")) as {
      schema_version: string;
      agent: { name: string };
      steps: Array<{ source: string; tool_calls?: Array<{ function_name: string }> }>;
    };
    expect(trajectory.schema_version).toBe("ATIF-v1.6");
    expect(trajectory.agent.name).toBe("noderoom-nodeagent");
    expect(trajectory.steps.some((step) => step.tool_calls?.[0]?.function_name === "write_locked_cells")).toBe(true);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-btb-nodeagent-smoke-"));
  roots.push(root);
  return root;
}
