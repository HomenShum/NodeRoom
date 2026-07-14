import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("WorkstreamBench / MBABench official readiness", () => {
  it("keeps the source lock non-claiming while accepting a separately promoted full judge receipt", () => {
    const bundle = readJson("docs/eval/proofloop-official-task-bundles/workstreambench.json");
    const score = readJson("docs/eval/proofloop-official-scores/workstreambench.json");
    const outputs = readJson("docs/eval/proofloop-official-outputs/workstreambench.json");

    expect(bundle).toMatchObject({
      schema: "proofloop-official-task-bundle-lock-v1",
      adapterId: "workstreambench",
      status: "locked",
      benchmark: {
        name: "MBABench",
        legacyName: "WorkstreamBench",
        arxivVersion: "v4",
      },
      officialSources: {
        repository: {
          commit: "c56319bea67fa5bfea8ed8010e93a88e1b8877e5",
          scorerEntrypoint: "judge/main_scripts/judge.py",
          rubric: "judge/prompts/rubrics/rubric_8.json",
        },
        dataset: {
          commit: "867fb5395b8e3fc28606dc681ba5ea284340ddd2",
          taskCount: 38,
          gated: false,
          private: false,
        },
      },
      artifactStatus: {
        officialScorer: "found",
        officialRubric: "found",
        noProviderSmoke: "available",
        officialScore: "blocked_external",
      },
    });

    expect(bundle.claimGate.scoreClaim).toBe(false);
    expect(bundle.localCaseScaffold).toMatchObject({
      status: "complete",
      outputManifestPath: "docs/eval/proofloop-official-outputs/workstreambench.json",
      caseFolderCount: 38,
      aiAttemptWorkbookCount: 38,
      solutionWorkbookCount: 38,
    });
    expect(bundle.officialTaskIds).toHaveLength(38);
    expect(bundle.localVerification.noProviderScorerSmokeCommand).toContain("--nocall");
    expect(outputs.status).toBe("complete");
    expect(outputs.officialTaskCount).toBe(38);
    expect(outputs.outputTaskCount).toBe(38);
    expect(outputs.caseFolderCount).toBe(38);
    expect(outputs.aiAttemptWorkbookCount).toBe(38);
    expect(outputs.solutionWorkbookCount).toBe(38);
    expect(outputs.blockers).toEqual([]);
    expect(outputs.upstreamPipeline.noProviderSmokeCommand).toContain("--nocall");
    expect(score.status).toBe("scored");
    expect(score.officialScorer.publicCodeOrDatasetFound).toBe(true);
    expect(score.claimGate).toMatchObject({
      officialScoreClaimable: true,
      acceptedProxyJudge: false,
      providerSpendUsd: 6.67212,
      acceptedOfficialJudgeReceipt: true,
    });
    expect(score.officialOutputManifest).toMatchObject({
      status: "complete",
      officialTaskCount: 38,
      outputTaskCount: 38,
    });
    expect(score.blockers).toEqual([]);
    expect(score.acceptedExternalScorerReceipt).toMatchObject({
      kind: "workstreambench_mbabench_judge",
      status: "accepted",
      official: true,
      provider: "google",
      judgeModel: "google/gemini-3-flash-preview",
      expectedCases: 38,
      completedCases: 38,
    });
    expect(score.officialMetrics).toMatchObject({
      meanScore: 11.51315789,
      providerCostUsd: 6.67212,
    });
    expect(score.scoreClaim).toBe(true);
  });
});

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}
