import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setupProofloopAdapter, setupReceiptPath } from "../src/eval/proofloopSetup";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Proof Loop adapter setup", () => {
  it("writes a needs_download receipt instead of silently blocking when BTB fixture is missing", async () => {
    const root = tempRoot();
    const receipt = await setupProofloopAdapter({
      adapterId: "bankertoolbench",
      projectRoot: root,
      fixtureRoot: ".tmp/missing-btb",
      generatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(receipt.status).toBe("needs_download");
    expect(receipt.nextCommands.join(" ")).toContain("setup bankertoolbench --allow-download --limit 1");
    expect(existsSync(setupReceiptPath(root, "bankertoolbench"))).toBe(true);
  });

  it("scans an existing local BTB fixture and writes a manifest lock receipt", async () => {
    const root = tempRoot();
    const fixtureRoot = join(root, ".tmp", "btb-fixture");
    writeBtbFixture(fixtureRoot);

    const receipt = await setupProofloopAdapter({
      adapterId: "bankertoolbench",
      projectRoot: root,
      fixtureRoot: ".tmp/btb-fixture",
      revision: "test-revision",
      generatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(receipt.status).toBe("ready");
    expect(receipt.taskIds).toEqual(["task-1"]);
    expect(receipt.manifestLockfile).toBe(".proofloop/setup/bankertoolbench-manifest-lock.json");
    expect(existsSync(join(root, ".proofloop", "setup", "bankertoolbench-manifest-lock.json"))).toBe(true);
  });

  it("writes typed setup receipts for adapters whose local setup recipe is still missing", async () => {
    const root = tempRoot();
    const receipt = await setupProofloopAdapter({
      adapterId: "finch",
      projectRoot: root,
      generatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(receipt.status).toBe("needs_local_adapter_implementation");
    expect(receipt.requiredFiles?.join(" ")).toContain("proofloop/benchmarks/finch/browser-scenario.spec.ts");
    expect(readFileSync(setupReceiptPath(root, "finch"), "utf8")).toContain("needs_local_adapter_implementation");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-setup-"));
  tempRoots.push(root);
  return root;
}

function writeBtbFixture(root: string): void {
  mkdirSync(join(root, "task-data", "task-1", "Input"), { recursive: true });
  mkdirSync(join(root, "golden-outputs", "task-1"), { recursive: true });
  writeFileSync(join(root, "task-data", "task-1", "Input", "source.txt"), "source", "utf8");
  writeFileSync(join(root, "golden-outputs", "task-1", "answer.txt"), "answer", "utf8");
  writeFileSync(
    join(root, "tasks.jsonl"),
    `${JSON.stringify({
      task_id: "task-1",
      final_prompt: "Build a one-tab operating model.",
      product: "Excel",
      workflow_cat: "modeling",
      workflow_subcat: "operating-model",
      aggregated_rubric_json: JSON.stringify([{ criterion: "Has output", weight: 1 }]),
    })}\n`,
    "utf8",
  );
}
