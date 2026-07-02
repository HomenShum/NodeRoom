import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_LOCAL_REGRESSIONS_RELATIVE_PATH,
  PROMOTED_REGRESSIONS_RELATIVE_PATH,
  promoteProofloopRegression,
  promotedRegressionsPath,
  readPromotedRegressions,
  type ProofLoopRegressionEntry,
} from "../src/eval/proofloopRegressions";

describe("Proof Loop promoted regression ledger", () => {
  it("writes promoted failures to a tracked proofloop ledger path", () => {
    const root = tempRoot();
    const result = promoteProofloopRegression(root, {
      suite: "accounting-live",
      runId: "accounting-live-1",
      failedGates: ["memo-draft"],
      score: 60,
      minScore: 75,
      durationMs: 1234,
    }, { now: "2026-07-02T00:00:00.000Z" });

    expect(result.relativePath).toBe(PROMOTED_REGRESSIONS_RELATIVE_PATH);
    expect(existsSync(promotedRegressionsPath(root))).toBe(true);
    expect(result.alreadyPromoted).toBe(false);

    const entries = readPromotedRegressions(root);
    expect(entries).toEqual([{
      suite: "accounting-live",
      runId: "accounting-live-1",
      failedGates: ["memo-draft"],
      promotedAt: "2026-07-02T00:00:00.000Z",
      promotedBy: "human",
      source: "real_user_run",
      score: 60,
      minScore: 75,
      durationMs: 1234,
    }]);
  });

  it("migrates legacy local regressions without continuing to rely on ignored state", () => {
    const root = tempRoot();
    const legacyPath = join(root, ...LEGACY_LOCAL_REGRESSIONS_RELATIVE_PATH.split("/"));
    const legacy: ProofLoopRegressionEntry[] = [{
      suite: "bankertoolbench",
      runId: "btb-old",
      failedGates: ["official-scorer-receipt"],
      promotedAt: "2026-07-01T00:00:00.000Z",
      promotedBy: "human",
      source: "official_benchmark",
    }];
    writeJson(legacyPath, legacy);

    const result = promoteProofloopRegression(root, {
      suite: "finch",
      runId: "finch-1",
      failedGates: ["azure-openai-judge-credentials"],
    }, { now: "2026-07-02T00:00:00.000Z" });

    expect(result.migratedLegacyCount).toBe(1);
    expect(readPromotedRegressions(root).map((entry) => entry.suite)).toEqual(["bankertoolbench", "finch"]);
    expect(readFileSync(legacyPath, "utf8")).toContain("btb-old");
  });

  it("dedupes by suite and failed gates instead of rewriting every run attempt", () => {
    const root = tempRoot();
    promoteProofloopRegression(root, {
      suite: "workstreambench",
      runId: "workstreambench-1",
      failedGates: ["missing-official-scorer"],
    }, { now: "2026-07-02T00:00:00.000Z" });

    const second = promoteProofloopRegression(root, {
      suite: "workstreambench",
      runId: "workstreambench-2",
      failedGates: ["missing-official-scorer"],
    }, { now: "2026-07-02T00:01:00.000Z" });

    expect(second.alreadyPromoted).toBe(true);
    expect(readPromotedRegressions(root)).toHaveLength(1);
  });
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "proofloop-regressions-"));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
