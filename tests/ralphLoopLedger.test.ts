import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SOLO_MILESTONE_CONTRACTS,
  SOLO_PROOF_GATES,
  evaluateSoloMilestoneStart,
  initSoloLoop,
  readSoloLoopState,
  recordSoloReceipt,
  soloPath,
  startSoloMilestone,
  validateSoloMemoryRecord,
  verifySoloMilestone,
  type SoloProofVerdict,
} from "../src/solo/ralphLoopLedger";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-ralph-"));
  roots.push(root);
  return root;
}

function writeRequiredEntryReceipts(projectRoot: string, milestone: "L" | "P"): void {
  for (const receipt of SOLO_MILESTONE_CONTRACTS[milestone].entryReceipts) {
    writeFileSync(soloPath(projectRoot, receipt), JSON.stringify({ schema: 1, receipt }, null, 2));
  }
}

describe("RALPH loop ledger", () => {
  it("initializes a durable local-first loop state and event log", () => {
    const projectRoot = tempProject();
    const state = initSoloLoop({ projectRoot, goal: "Build an agent honestly.", loopId: "loop_test", now: "2026-06-24T00:00:00.000Z" });

    expect(state.loopId).toBe("loop_test");
    expect(state.currentMilestone).toBe("R");
    expect(state.milestones.R.status).toBe("running");
    expect(readSoloLoopState(projectRoot)?.goal).toBe("Build an agent honestly.");
    expect(soloPath(projectRoot, "loop-state.json")).toMatch(/\.solo/);
  });

  it("blocks start-anywhere when prior milestone receipts are missing", () => {
    const projectRoot = tempProject();
    initSoloLoop({ projectRoot, goal: "Start from live build.", loopId: "loop_blocked" });

    const evaluation = startSoloMilestone(projectRoot, "L", "2026-06-24T00:00:00.000Z");
    const state = readSoloLoopState(projectRoot)!;

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.missing).toEqual(expect.arrayContaining([
      "receipts/R-reality/capability-spec.json",
      "receipts/A-acceptance-bar/benchmark-choice.json",
      "receipts/A-acceptance-bar/held-out-split.json",
    ]));
    expect(evaluation.resumeCommand).toBe("npm run sfn -- loop start --from R");
    expect(state.status).toBe("blocked");
    expect(state.milestones.L.blockedOn?.kind).toBe("missing_receipt");
  });

  it("allows Live Build only after R and A entry receipts exist", () => {
    const projectRoot = tempProject();
    initSoloLoop({ projectRoot, goal: "Start from live build.", loopId: "loop_allowed" });
    writeRequiredEntryReceipts(projectRoot, "L");

    const evaluation = evaluateSoloMilestoneStart(projectRoot, "L");
    expect(evaluation.allowed).toBe(true);

    const started = startSoloMilestone(projectRoot, "L", "2026-06-24T00:00:00.000Z");
    expect(started.allowed).toBe(true);
    expect(readSoloLoopState(projectRoot)?.milestones.L.status).toBe("running");
  });

  it("enforces no receipt, no proof-run claim", () => {
    const projectRoot = tempProject();
    initSoloLoop({ projectRoot, goal: "Verify proof.", loopId: "loop_proof" });
    writeRequiredEntryReceipts(projectRoot, "P");

    const missing = verifySoloMilestone(projectRoot, "P", "2026-06-24T00:00:00.000Z");
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(" ")).toContain("proof-verdict.json");

    recordSoloReceipt(projectRoot, "P", "live-ui-proof.json", { schema: 1, freshRoom: true });
    recordSoloReceipt(projectRoot, "P", "scorer-receipt.json", { schema: 1, verdict: "pass" });
    const proof: SoloProofVerdict = {
      schema: 1,
      loopId: "loop_proof",
      generatedAt: "2026-06-24T00:00:00.000Z",
      verdict: "pass",
      claim: "Fresh room proof passed.",
      receipts: SOLO_PROOF_GATES.map((gate) => ({ gate, path: `receipts/P-proof-run/${gate}.json`, verdict: "pass" })),
    };
    writeFileSync(soloPath(projectRoot, "proof-verdict.json"), JSON.stringify(proof, null, 2));

    const verified = verifySoloMilestone(projectRoot, "P", "2026-06-24T00:01:00.000Z");
    expect(verified.ok).toBe(true);
    expect(readSoloLoopState(projectRoot)?.milestones.P.status).toBe("completed");
  });

  it("quarantines held-out task contents but allows split hashes and aggregate scorecards", () => {
    expect(validateSoloMemoryRecord({
      kind: "held_out_split_hash",
      benchmark: "bankertoolbench",
      splitHash: "sha256:abc",
      taskCount: 50,
    }).ok).toBe(true);

    expect(validateSoloMemoryRecord({
      kind: "scorecard",
      benchmark: "bankertoolbench",
      passRate: 0.42,
      costUsd: 12.34,
    }).ok).toBe(true);

    const rejected = validateSoloMemoryRecord({
      kind: "held_out_task_content",
      taskContents: [{ prompt: "secret held-out prompt", answer: 42 }],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.join(" ")).toContain("forbidden");
  });
});
