import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];
const root = resolve(".");
const tsx = resolve("node_modules", "tsx", "dist", "cli.mjs");
const promotionScript = resolve("scripts", "proofloop-promote-official-score.ts");

type FinchFixture = {
  contentRecordSha256: string[];
  contentPartsPath: string;
  outputManifestPath: string;
  promptSourcePath: string;
  repoRoot: string;
};

afterEach(() => {
  for (const path of tempRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("official score promotion", () => {
  it("promotes only exact full-coverage Finch canonical judge receipts", () => {
    const temp = mkdtempSync(join(tmpdir(), "finch-promotion-"));
    tempRoots.push(temp);
    const fixture = writeFinchFixture(temp);
    const writeReceipt = (path: string, completedTasks: number, overrides: Record<string, unknown> = {}) =>
      writeJudgeReceipt(path, completedTasks, fixture, overrides);
    const promote = (receipt: string, output: string, enableFixtureOverrides = true) =>
      runPromotion(receipt, output, fixture, enableFixtureOverrides);
    const acceptedPath = join(temp, "accepted.json");
    const acceptedOut = join(temp, "score.json");
    writeReceipt(acceptedPath, 172);

    const unguarded = promote(acceptedPath, acceptedOut, false);
    expect(unguarded.status).not.toBe(0);
    expect(`${unguarded.stdout}\n${unguarded.stderr}`).toContain("Test fixture path overrides require");
    expect(existsSync(acceptedOut)).toBe(false);

    const accepted = promote(acceptedPath, acceptedOut);
    expect(accepted.status).toBe(0);
    expect(accepted.stderr).toBe("");
    expect(existsSync(acceptedOut)).toBe(true);
    expect(JSON.parse(readFileSync(acceptedOut, "utf8"))).toMatchObject({
      adapterId: "finch",
      status: "scored",
      scoreClaim: true,
      acceptedExternalScorerReceipt: {
        kind: "finch_azure_judge",
        accepted: true,
        taskCount: 172,
        contentPartsCount: 172,
      },
    });

    const equivalentPath = join(temp, "direct-equivalent.json");
    const equivalentOut = join(temp, "direct-equivalent-score.json");
    writeReceipt(equivalentPath, 172, directEquivalentOverrides(fixture.promptSourcePath));
    const equivalent = promote(equivalentPath, equivalentOut);
    expect(equivalent.status, `${equivalent.stdout}\n${equivalent.stderr}`).toBe(0);
    expect(JSON.parse(readFileSync(equivalentOut, "utf8"))).toMatchObject({
      adapterId: "finch",
      status: "scored",
      scoreClaim: true,
      acceptedExternalScorerReceipt: {
        kind: "finch_canonical_judge",
        source: "upstream_equivalent",
        provider: "openai",
        judgeModel: "gpt-5-mini",
        equivalenceContract: {
          accepted: true,
          contractId: "finch-gpt5mini-canonical-v1",
          canonicalModelVersion: "2025-08-07",
          transportOnly: true,
        },
      },
    });

    const missingContractPath = join(temp, "direct-missing-contract.json");
    const missingContractOut = join(temp, "direct-missing-contract-score.json");
    writeReceipt(missingContractPath, 172, {
      ...directEquivalentOverrides(fixture.promptSourcePath),
      equivalenceContract: undefined,
    });
    const missingContract = promote(missingContractPath, missingContractOut);
    expect(missingContract.status).not.toBe(0);
    expect(`${missingContract.stdout}\n${missingContract.stderr}`).toContain("missing the accepted canonical transport-equivalence contract");
    expect(existsSync(missingContractOut)).toBe(false);

    const shadowPath = join(temp, "free-router-shadow.json");
    const shadowOut = join(temp, "free-router-shadow-score.json");
    writeReceipt(shadowPath, 172, {
      schema: "finch-shadow-judge-receipt-v1",
      status: "complete",
      official: false,
      source: "shadow_free_router",
      kind: "finch_free_router_shadow",
      provider: "openrouter",
      judgeModel: "openrouter/free",
    });
    const shadow = promote(shadowPath, shadowOut);
    expect(shadow.status).not.toBe(0);
    expect(`${shadow.stdout}\n${shadow.stderr}`).toContain("not an accepted upstream official receipt");
    expect(existsSync(shadowOut)).toBe(false);

    const partialPath = join(temp, "partial.json");
    const partialOut = join(temp, "partial-score.json");
    writeReceipt(partialPath, 171);
    const partial = promote(partialPath, partialOut);
    expect(partial.status).not.toBe(0);
    expect(`${partial.stdout}\n${partial.stderr}`).toContain("must cover 172/172 tasks");
    expect(existsSync(partialOut)).toBe(false);

    const unacceptedPath = join(temp, "unaccepted.json");
    const unacceptedOut = join(temp, "unaccepted-score.json");
    writeReceipt(unacceptedPath, 172, { status: "partial", accepted: false });
    const unaccepted = promote(unacceptedPath, unacceptedOut);
    expect(unaccepted.status).not.toBe(0);
    expect(`${unaccepted.stdout}\n${unaccepted.stderr}`).toContain("not an accepted upstream official receipt");
    expect(existsSync(unacceptedOut)).toBe(false);

    const overCapPath = join(temp, "over-cap.json");
    const overCapOut = join(temp, "over-cap-score.json");
    writeReceipt(overCapPath, 172, {
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        accountedProviderCostUsd: 2,
        maxProviderCostUsd: 1,
      },
    });
    const overCap = promote(overCapPath, overCapOut);
    expect(overCap.status).not.toBe(0);
    expect(`${overCap.stdout}\n${overCap.stderr}`).toContain("exceeds cap");
    expect(existsSync(overCapOut)).toBe(false);

    const mismatchedContentPath = join(temp, "mismatched-content.json");
    const mismatchedContentOut = join(temp, "mismatched-content-score.json");
    writeReceipt(mismatchedContentPath, 172, {
      contentParts: {
        path: fixture.contentPartsPath,
        sha256: "0".repeat(64),
      },
    });
    const mismatchedContent = promote(mismatchedContentPath, mismatchedContentOut);
    expect(mismatchedContent.status).not.toBe(0);
    expect(`${mismatchedContent.stdout}\n${mismatchedContent.stderr}`).toContain("content_parts SHA-256 mismatch");
    expect(existsSync(mismatchedContentOut)).toBe(false);

    const unboundOutputPath = join(temp, "unbound-judge-output.jsonl");
    writeJudgeOutput(unboundOutputPath, "openai", "gpt-5-mini", fixture.contentRecordSha256, 0);
    const unboundReceiptPath = join(temp, "unbound-result.json");
    const unboundScorePath = join(temp, "unbound-result-score.json");
    writeReceipt(unboundReceiptPath, 172, {
      ...directEquivalentOverrides(fixture.promptSourcePath),
      judgeOutput: {
        path: unboundOutputPath,
        sha256: createHash("sha256").update(readFileSync(unboundOutputPath)).digest("hex"),
      },
    });
    const unbound = promote(unboundReceiptPath, unboundScorePath);
    expect(unbound.status).not.toBe(0);
    expect(`${unbound.stdout}\n${unbound.stderr}`).toContain("missing its canonical content-record SHA-256");
    expect(existsSync(unboundScorePath)).toBe(false);

    for (const invalid of [
      { name: "wrong-provider", overrides: { provider: "openai" }, message: "Unexpected Finch judge contract" },
      { name: "parse-error", overrides: { parseErrorCount: 1 }, message: "contains 1 parse error" },
      { name: "under-call", overrides: { providerCalls: 171 }, message: "requires at least 172 provider calls" },
    ]) {
      const receiptPath = join(temp, `${invalid.name}.json`);
      const scorePath = join(temp, `${invalid.name}-score.json`);
      writeReceipt(receiptPath, 172, invalid.overrides);
      const rejected = promote(receiptPath, scorePath);
      expect(rejected.status).not.toBe(0);
      expect(`${rejected.stdout}\n${rejected.stderr}`).toContain(invalid.message);
      expect(existsSync(scorePath)).toBe(false);
    }
  }, 15_000);
});

function runPromotion(
  receipt: string,
  output: string,
  fixture: FinchFixture,
  enableFixtureOverrides: boolean,
) {
  const env = { ...process.env };
  if (enableFixtureOverrides) {
    env.NODE_ENV = "test";
    env.PROOFLOOP_PROMOTION_TEST_FIXTURES = "1";
  } else {
    delete env.PROOFLOOP_PROMOTION_TEST_FIXTURES;
  }
  return spawnSync(process.execPath, [
    tsx,
    promotionScript,
    "--id",
    "finch",
    "--judge-receipt",
    receipt,
    "--json-out",
    output,
    "--test-output-manifest",
    fixture.outputManifestPath,
    "--test-finch-repo-root",
    fixture.repoRoot,
  ], { cwd: root, encoding: "utf8", env });
}

function directEquivalentOverrides(promptSourcePath: string): Record<string, unknown> {
  return {
    schema: "finch-canonical-judge-receipt-v1",
    source: "upstream_equivalent",
    kind: "finch_canonical_judge",
    provider: "openai",
    judgeModel: "gpt-5-mini",
    resolvedJudgeModels: ["gpt-5-mini-2025-08-07"],
    equivalenceContract: {
      schema: "finch-judge-transport-equivalence-v1",
      status: "accepted",
      accepted: true,
      contractId: "finch-gpt5mini-canonical-v1",
      canonicalModel: "gpt-5-mini",
      canonicalModelVersion: "2025-08-07",
      transportOnly: true,
      releasedTransport: "openai.AzureOpenAI",
      equivalentTransport: "openai.OpenAI",
      requestPath: "chat.completions.create",
      requestFields: ["model", "messages", "max_completion_tokens", "temperature"],
      promptUpgradeMethod: "GPTJudgeCaller._upgrade_prompt",
      parserMethod: "GPTJudgeCaller._parse_response",
      requestedModel: "gpt-5-mini",
      promptSourceSha256: createHash("sha256")
        .update(readFileSync(promptSourcePath))
        .digest("hex"),
    },
  };
}

function writeJudgeReceipt(
  path: string,
  completedTasks: number,
  fixture: FinchFixture,
  overrides: Record<string, unknown> = {},
): void {
  const contentPartsSha256 = createHash("sha256").update(readFileSync(fixture.contentPartsPath)).digest("hex");
  const base = {
    schema: "finch-official-judge-receipt-v1",
    status: "accepted",
    accepted: true,
    official: true,
    source: "upstream_official",
    kind: "finch_azure_judge",
    provider: "azure_openai",
    judgeModel: "gpt-5-mini",
    expectedTasks: 172,
    selectedTasks: 172,
    completedTasks,
    contentPartsCount: 172,
    contentParts: {
      path: fixture.contentPartsPath,
      sha256: contentPartsSha256,
    },
    providerCalls: 172,
    meanScore: 0,
    parseErrorCount: 0,
    providerCostUsd: 0.5,
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      accountedProviderCostUsd: 0.5,
      maxProviderCostUsd: 1,
    },
    upstream: {
      repository: "https://github.com/FinWorkBench/Finch",
      commit: "95a8b8d135a528b325be003e54c55f886a22602d",
      entrypoint: "src/call_gpt_judge.py",
    },
  };
  const receipt = { ...base, ...overrides } as Record<string, unknown>;
  if (!receipt.judgeOutput) {
    const judgeOutputPath = `${path}.judge-output.jsonl`;
    writeJudgeOutput(
      judgeOutputPath,
      String(receipt.provider),
      String(receipt.judgeModel),
      fixture.contentRecordSha256,
    );
    receipt.judgeOutput = {
      path: judgeOutputPath,
      sha256: createHash("sha256").update(readFileSync(judgeOutputPath)).digest("hex"),
    };
  }
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function writeJudgeOutput(
  path: string,
  provider: string,
  judgeModel: string,
  contentRecordSha256: string[],
  unboundIndex = -1,
): void {
  const rows = Array.from({ length: 172 }, (_, index) => ({
    task_id: String(index),
    score: 0,
    judge_provider: provider,
    provider,
    judge_model: judgeModel,
    resolved_judge_model: provider === "openai" ? "gpt-5-mini-2025-08-07" : judgeModel,
    judge_contract: "finch-gpt5mini-canonical-v1",
    content_record_sha256: index === unboundIndex
      ? undefined
      : contentRecordSha256[index],
    provider_call: true,
    error: null,
  }));
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function writeFinchFixture(temp: string): FinchFixture {
  const contentPartsPath = join(temp, "content_parts.jsonl");
  const contentRows = Array.from({ length: 172 }, (_, index) => ({
    content_parts: [{ text: `fixture task ${index}`, type: "text" }],
    task_id: String(index),
  }));
  const contentText = `${contentRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  writeFileSync(contentPartsPath, contentText, "utf8");

  const repoRoot = join(temp, "finch-repo");
  const promptDir = join(repoRoot, "src", "build_prompt", "content_builder");
  mkdirSync(promptDir, { recursive: true });
  const promptSourcePath = join(promptDir, "prompts.py");
  writeFileSync(promptSourcePath, "SYSTEM_PROMPT = 'hermetic Finch fixture'\n", "utf8");

  const outputManifestPath = join(temp, "finch-output-manifest.json");
  const contentPartsSha256 = createHash("sha256").update(contentText).digest("hex");
  writeFileSync(outputManifestPath, `${JSON.stringify({
    schema: "proofloop-official-output-manifest-v1",
    adapterId: "finch",
    status: "complete",
    officialTaskCount: 172,
    outputTaskCount: 172,
    contentPartsCount: 172,
    contentPartsSha256,
  }, null, 2)}\n`, "utf8");

  return {
    contentRecordSha256: contentRows.map((row) => createHash("sha256").update(JSON.stringify(row)).digest("hex")),
    contentPartsPath,
    outputManifestPath,
    promptSourcePath,
    repoRoot,
  };
}
