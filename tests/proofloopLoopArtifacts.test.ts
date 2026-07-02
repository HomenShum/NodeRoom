import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listBenchmarkAdapters, validateBenchmarkAdapter } from "../src/eval/proofloopBenchmarkAdapters";
import { writeLoopArtifactsForMeta, type ProofloopMetaForLoop } from "../src/eval/proofloopLoopArtifacts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-loop-"));
  roots.push(root);
  return root;
}

function fakeMeta(overrides: Partial<ProofloopMetaForLoop> = {}): ProofloopMetaForLoop {
  return {
    runId: "bankertoolbench-2026-07-01",
    suite: "bankertoolbench",
    cmd: "npm run proofloop:live:btb --prod --cockpit --user-emulation strict",
    startedAt: "2026-07-01T00:00:00.000Z",
    finishedAt: "2026-07-01T00:01:00.000Z",
    durationMs: 60_000,
    exitCode: 0,
    passed: true,
    score: 100,
    minScore: 100,
    failedGates: [],
    receiptPaths: ["docs/eval/proofloop-live-room-proof.json"],
    ...overrides,
  };
}

describe("proofloop loop artifacts", () => {
  it("writes strict live-user artifacts, memory, media plans, and router suggestion", () => {
    const root = tempRoot();
    const runDir = join(root, "run");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    writeFileSync(join(runDir, "scorecard.md"), "## Verdict: PASS\nScore: 100/100\n", "utf-8");
    writeFileSync(join(runDir, "trace.jsonl"), "{}\n", "utf-8");
    writeFileSync(join(runDir, "screenshots", "proof.png"), "fake screenshot", "utf-8");
    writeFileSync(join(runDir, "cost-ledger.json"), JSON.stringify({ costUsd: "0.00" }), "utf-8");

    const paths = writeLoopArtifactsForMeta({
      meta: fakeMeta(),
      runDir,
      memoryPath: join(root, "memory.jsonl"),
      baseUrl: "https://noderoom.live",
      strictLiveUser: true,
    });

    for (const path of [
      paths.runResultPath,
      paths.officialScorerReceiptPath,
      paths.liveUserContractPath,
      paths.nodeTracePath,
      paths.nodeEvalPath,
      paths.repairPromptPath,
      paths.storybookPath,
      paths.storyboardJsonPath,
      paths.storyboardMdPath,
      paths.laggingJsonPath,
      paths.laggingMdPath,
      paths.routerSuggestionPath,
      join(runDir, "clips", "clip-manifest.json"),
      join(runDir, "social", "x-thread.md"),
    ]) {
      expect(readFileSync(path, "utf-8").length).toBeGreaterThan(0);
    }

    const contract = JSON.parse(readFileSync(paths.liveUserContractPath, "utf-8"));
    expect(contract.valid).toBe(true);
    expect(contract.productPathCompletion).toBe(true);
    expect(contract.officialScorerReceiptWritten).toBe(true);
    expect(contract.officialSemanticScore).toBeNull();
    expect(contract.scoreType).toBe("completion_not_official_semantic");
    expect(contract.gates.every((gate: { passed: boolean }) => gate.passed)).toBe(true);

    const officialReceipt = JSON.parse(readFileSync(paths.officialScorerReceiptPath, "utf-8"));
    expect(officialReceipt.status).toBe("blocked_external");
    expect(officialReceipt.officialScoreClaimable).toBe(false);
    expect(officialReceipt.blocker).toContain("product-path evidence only");

    const storybook = readFileSync(paths.storybookPath, "utf-8");
    for (const atom of [
      "RoomHeaderAtom",
      "ChatMessageAtom",
      "ArtifactTabAtom",
      "SpreadsheetCellAtom",
      "EvidenceCardAtom",
      "SourceCaptureAtom",
      "FocusBoxAtom",
      "AgentToolAtom",
      "CostBadgeAtom",
      "VerdictBadgeAtom",
    ]) {
      expect(storybook).toContain(atom);
    }

    const memory = readFileSync(paths.memoryPath ?? "", "utf-8");
    expect(memory).toContain("success_pattern");
    expect(memory).toContain("bankertoolbench");
  });
});

describe("proofloop benchmark adapters", () => {
  it("validates all strict live-user benchmark adapter contracts", () => {
    const adapters = listBenchmarkAdapters();
    expect(adapters.map((adapter) => adapter.id).sort()).toEqual(["bankertoolbench", "finauditing", "finch", "workstreambench"]);
    for (const adapter of adapters) {
      expect(validateBenchmarkAdapter(adapter)).toEqual([]);
    }
  });
});
