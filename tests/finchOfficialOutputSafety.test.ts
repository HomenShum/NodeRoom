import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetFinchModelOutputBaseline,
  shouldPreserveOfficialScoreClaim,
} from "../src/eval/finchOfficialOutputSafety";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Finch official output regeneration safety", () => {
  it("clears regenerable model outputs without deleting rendered content parts", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "finch-output-"));
    roots.push(outputRoot);
    const modelOutputDir = join(outputRoot, "model-output", "baseline");
    const manifestPath = join(outputRoot, "model-output-manifest.json");
    const contentPartsPath = join(outputRoot, "eval_set", "baseline", "content_parts.jsonl");
    mkdirSync(modelOutputDir, { recursive: true });
    mkdirSync(join(outputRoot, "eval_set", "baseline"), { recursive: true });
    writeFileSync(join(modelOutputDir, "task.xlsx"), "candidate");
    writeFileSync(manifestPath, "{}");
    writeFileSync(contentPartsPath, '{"task_id":"task"}\n');

    resetFinchModelOutputBaseline({
      outputRoot,
      modelOutputDir,
      modelOutputManifestPath: manifestPath,
    });

    expect(existsSync(modelOutputDir)).toBe(false);
    expect(existsSync(manifestPath)).toBe(false);
    expect(existsSync(contentPartsPath)).toBe(true);
  });

  it("preserves only previously promoted claims whose scorer inputs remain complete", () => {
    const promoted = {
      status: "scored",
      scoreClaim: false,
      claimBoundary: { officialScoreClaimable: true },
      acceptedExternalScorerReceipt: { accepted: true },
    };
    expect(shouldPreserveOfficialScoreClaim({
      adapterId: "finch",
      receipt: promoted,
      manifest: { status: "complete", officialTaskCount: 172, outputTaskCount: 172, contentPartsCount: 172, contentPartsSha256: "same" },
      acceptedContentPartsSha256: "same",
    })).toBe(true);
    expect(shouldPreserveOfficialScoreClaim({
      adapterId: "finch",
      receipt: promoted,
      manifest: { status: "complete", officialTaskCount: 172, outputTaskCount: 172, contentPartsCount: 0, contentPartsSha256: "same" },
      acceptedContentPartsSha256: "same",
    })).toBe(false);
    expect(shouldPreserveOfficialScoreClaim({
      adapterId: "finauditing",
      receipt: promoted,
      manifest: { status: "complete", officialTaskCount: 1102, predictionRowCount: 1102 },
    })).toBe(true);
    expect(shouldPreserveOfficialScoreClaim({
      adapterId: "finch",
      receipt: { ...promoted, claimBoundary: { officialScoreClaimable: false } },
      manifest: { status: "complete", officialTaskCount: 172, outputTaskCount: 172, contentPartsCount: 172, contentPartsSha256: "same" },
      acceptedContentPartsSha256: "same",
    })).toBe(false);
    expect(shouldPreserveOfficialScoreClaim({
      adapterId: "finch",
      receipt: promoted,
      manifest: { status: "complete", officialTaskCount: 172, outputTaskCount: 172, contentPartsCount: 172, contentPartsSha256: "changed" },
      acceptedContentPartsSha256: "judged",
    })).toBe(false);
  });
});
