import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOfficialScoreImportReadiness,
  buildLocalOfficialScoreScaffoldReceipt,
} from "../src/eval/proofloopOfficialScoreReceipts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Proof Loop official score import readiness", () => {
  it("accepts the promoted Finch, FinAuditing, and WorkstreamBench canonical judge receipts", () => {
    const finch = buildOfficialScoreImportReadiness({ adapterId: "finch" });
    const finAuditing = buildOfficialScoreImportReadiness({ adapterId: "finauditing" });
    const workstreamBench = buildOfficialScoreImportReadiness({ adapterId: "workstreambench" });

    expect(finch.boundary.productPath.status).toBe("complete");
    expect(finch.boundary.proxy.status).toBe("proxy_only");
    expect(finch.boundary.officialScorer.status).toBe("accepted");
    expect(finch.officialScoreClaimable).toBe(true);
    expect(finch.acceptedExternalScorerReceipt).toBe(true);
    expect(finch.acceptedExternalScorerKind).toBe("finch_canonical_judge");
    expect(finch.pendingExternalScorerReceipt).toBe(false);
    expect(finch.metrics.contentPartsCount).toBe(172);
    expect(finch.blockers).toEqual([]);

    expect(finAuditing.boundary.productPath.status).toBe("complete");
    expect(finAuditing.boundary.proxy.status).toBe("proxy_only");
    expect(finAuditing.boundary.officialScorer.status).toBe("accepted");
    expect(finAuditing.officialScoreClaimable).toBe(true);
    expect(finAuditing.acceptedExternalScorerReceipt).toBe(true);
    expect(finAuditing.acceptedExternalScorerKind).toBe("finauditing_finmr_judge");
    expect(finAuditing.pendingExternalScorerReceipt).toBe(false);
    expect(finAuditing.blockers).toEqual([]);

    expect(workstreamBench.boundary.productPath.status).toBe("complete");
    expect(workstreamBench.boundary.proxy.status).toBe("proxy_only");
    expect(workstreamBench.boundary.officialScorer.status).toBe("accepted");
    expect(workstreamBench.officialScoreClaimable).toBe(true);
    expect(workstreamBench.acceptedExternalScorerReceipt).toBe(true);
    expect(workstreamBench.acceptedExternalScorerKind).toBe("workstreambench_mbabench_judge");
    expect(workstreamBench.metrics.outputTaskCount).toBe(38);
    expect(workstreamBench.blockers).toEqual([]);
  });

  it("scaffolds an honest Finch official-score receipt without promoting local output coverage", () => {
    const root = tempRoot();
    writeOfficialOutput(root, "finch", {
      officialTaskCount: 2,
      outputTaskCount: 2,
      contentPartsCount: 0,
    });

    const receipt = buildLocalOfficialScoreScaffoldReceipt({
      root,
      adapterId: "finch",
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    writeOfficialScore(root, "finch", receipt);
    const readiness = buildOfficialScoreImportReadiness({ root, adapterId: "finch" });

    expect(receipt.status).toBe("blocked_external");
    expect(receipt.scoreClaim).toBe(false);
    expect(receipt.claimBoundary.officialJudgeReceiptStatus).toBe("pending");
    expect(receipt.pendingExternalScorerReceipt).toMatchObject({
      kind: "finch_canonical_judge",
      status: "pending",
      accepted: false,
      paidProviderCalls: false,
      providerCallsAttempted: false,
    });
    expect(receipt.localProductOutputReceipt.status).toBe("complete");
    expect(readiness.boundary.productPath.status).toBe("complete");
    expect(readiness.pendingExternalScorerReceipt).toBe(true);
    expect(readiness.officialScoreClaimable).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("accepted canonical Finch GPT-5-mini judge receipt is missing");
  });

  it("scaffolds an honest FinAuditing official-score receipt with FinMR judge pending", () => {
    const root = tempRoot();
    writeOfficialOutput(root, "finauditing", {
      officialTaskCount: 3,
      predictionRowCount: 3,
    });

    const receipt = buildLocalOfficialScoreScaffoldReceipt({
      root,
      adapterId: "finauditing",
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    writeOfficialScore(root, "finauditing", receipt);
    const readiness = buildOfficialScoreImportReadiness({ root, adapterId: "finauditing" });

    expect(receipt.status).toBe("blocked_external");
    expect(receipt.scoreClaim).toBe(false);
    expect(receipt.claimBoundary.officialJudgeReceiptStatus).toBe("pending");
    expect(receipt.pendingExternalScorerReceipt).toMatchObject({
      kind: "finauditing_finmr_judge",
      status: "pending",
      accepted: false,
      paidProviderCalls: false,
      providerCallsAttempted: false,
    });
    expect(receipt.localProductOutputReceipt.status).toBe("complete");
    expect(readiness.boundary.productPath.status).toBe("complete");
    expect(readiness.pendingExternalScorerReceipt).toBe(true);
    expect(readiness.officialScoreClaimable).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("accepted FinMR judge/scorer receipt is missing");
  });

  it("accepts a scored Finch receipt with full content_parts and the released Azure judge receipt", () => {
    const root = tempRoot();
    writeOfficialOutput(root, "finch", {
      officialTaskCount: 2,
      outputTaskCount: 2,
      contentPartsCount: 2,
    });
    writeOfficialScore(root, "finch", {
      status: "scored",
      scoreClaim: true,
      officialOutputManifest: {
        officialTaskCount: 2,
        outputTaskCount: 2,
        contentPartsCount: 2,
      },
      acceptedExternalScorerReceipt: {
        kind: "finch_azure_judge",
        status: "accepted",
        accepted: true,
        official: true,
        source: "upstream_official",
        provider: "azure_openai",
        contentPartsCount: 2,
        taskCount: 2,
        receiptPath: "official/finch-azure-judge-receipt.json",
      },
    });

    const readiness = buildOfficialScoreImportReadiness({ root, adapterId: "finch" });

    expect(readiness.status).toBe("accepted");
    expect(readiness.officialScoreClaimable).toBe(true);
    expect(readiness.boundary.officialScorer.status).toBe("accepted");
    expect(readiness.blockers).toEqual([]);
  });

  it("accepts a scored Finch receipt through the canonical direct-OpenAI equivalence contract", () => {
    const root = tempRoot();
    writeOfficialOutput(root, "finch", {
      officialTaskCount: 2,
      outputTaskCount: 2,
      contentPartsCount: 2,
    });
    writeOfficialScore(root, "finch", {
      status: "scored",
      scoreClaim: true,
      officialOutputManifest: {
        officialTaskCount: 2,
        outputTaskCount: 2,
        contentPartsCount: 2,
      },
      acceptedExternalScorerReceipt: {
        kind: "finch_canonical_judge",
        status: "accepted",
        accepted: true,
        official: true,
        source: "upstream_equivalent",
        provider: "openai",
        contentPartsCount: 2,
        taskCount: 2,
        receiptPath: "official/finch-canonical-judge-receipt.json",
        equivalenceContract: {
          schema: "finch-judge-transport-equivalence-v1",
          status: "accepted",
          accepted: true,
          contractId: "finch-gpt5mini-canonical-v1",
          canonicalModel: "gpt-5-mini",
          canonicalModelVersion: "2025-08-07",
          transportOnly: true,
        },
      },
    });

    const readiness = buildOfficialScoreImportReadiness({ root, adapterId: "finch" });

    expect(readiness.status).toBe("accepted");
    expect(readiness.officialScoreClaimable).toBe(true);
    expect(readiness.acceptedExternalScorerKind).toBe("finch_canonical_judge");
    expect(readiness.blockers).toEqual([]);
  });

  it("rejects a shallow Finch scored receipt without an accepted external judge", () => {
    const root = tempRoot();
    writeOfficialOutput(root, "finch", {
      officialTaskCount: 2,
      outputTaskCount: 2,
      contentPartsCount: 2,
    });
    writeOfficialScore(root, "finch", {
      status: "scored",
      scoreClaim: true,
      officialOutputManifest: {
        officialTaskCount: 2,
        outputTaskCount: 2,
        contentPartsCount: 2,
      },
    });

    const readiness = buildOfficialScoreImportReadiness({ root, adapterId: "finch" });

    expect(readiness.status).toBe("invalid");
    expect(readiness.officialScoreClaimable).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("refusing official score claim without an accepted external scorer receipt");
  });

  it("does not claim a scored Finch receipt when scoreClaim stays false", () => {
    const root = tempRoot();
    writeOfficialOutput(root, "finch", {
      officialTaskCount: 2,
      outputTaskCount: 2,
      contentPartsCount: 2,
    });
    writeOfficialScore(root, "finch", {
      status: "scored",
      scoreClaim: false,
      officialOutputManifest: {
        officialTaskCount: 2,
        outputTaskCount: 2,
        contentPartsCount: 2,
      },
      acceptedExternalScorerReceipt: {
        kind: "finch_azure_judge",
        status: "accepted",
        accepted: true,
        official: true,
        source: "upstream_official",
        provider: "azure_openai",
        contentPartsCount: 2,
      },
    });

    const readiness = buildOfficialScoreImportReadiness({ root, adapterId: "finch" });

    expect(readiness.officialScoreClaimable).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("scoreClaim is not true");
  });

  it("accepts a FinAuditing scored receipt only when the FinMR judge receipt is accepted", () => {
    const root = tempRoot();
    writeOfficialOutput(root, "finauditing", {
      officialTaskCount: 3,
      predictionRowCount: 3,
    });
    writeOfficialScore(root, "finauditing", {
      status: "scored",
      scoreClaim: true,
      officialOutputManifest: {
        officialTaskCount: 3,
        predictionRowCount: 3,
      },
      acceptedExternalScorerReceipt: {
        kind: "finauditing_finmr_judge",
        status: "accepted",
        accepted: true,
        official: true,
        source: "upstream_official",
        datasets: ["FinSM", "FinRE", "FinMR"],
        finMr: {
          status: "accepted",
          accepted: true,
          receiptPath: "official/finauditing-finmr-judge.json",
        },
        receiptPath: "official/finauditing-scorer-receipt.json",
      },
    });

    const readiness = buildOfficialScoreImportReadiness({ root, adapterId: "finauditing" });

    expect(readiness.status).toBe("accepted");
    expect(readiness.officialScoreClaimable).toBe(true);
    expect(readiness.boundary.officialScorer.status).toBe("accepted");
    expect(readiness.blockers).toEqual([]);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-score-"));
  tempRoots.push(root);
  return root;
}

function writeOfficialOutput(
  root: string,
  adapterId: "finch" | "finauditing",
  counts: { officialTaskCount: number; outputTaskCount?: number; predictionRowCount?: number; contentPartsCount?: number },
): void {
  writeJson(join(root, "docs", "eval", "proofloop-official-outputs", `${adapterId}.json`), {
    schema: "proofloop-official-output-manifest-v1",
    adapterId,
    status: "complete",
    evidence: [],
    ...counts,
  });
}

function writeOfficialScore(
  root: string,
  adapterId: "finch" | "finauditing",
  receipt: Record<string, unknown>,
): void {
  writeJson(join(root, "docs", "eval", "proofloop-official-scores", `${adapterId}.json`), {
    schema: "proofloop-official-score-receipt-v1",
    adapterId,
    ...receipt,
  });
}

function writeJson(path: string, value: unknown): void {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
