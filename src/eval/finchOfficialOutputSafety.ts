import { mkdirSync, rmSync } from "node:fs";

type OutputAdapterId = "finch" | "finauditing";

type OfficialOutputManifest = {
  status?: string;
  officialTaskCount?: number;
  outputTaskCount?: number;
  predictionRowCount?: number;
  contentPartsCount?: number;
  contentPartsSha256?: string;
};

type OfficialScoreReceipt = {
  status?: string;
  scoreClaim?: boolean;
  claimBoundary?: { officialScoreClaimable?: boolean };
  acceptedExternalScorerReceipt?: { accepted?: boolean };
};

export function resetFinchModelOutputBaseline(args: {
  outputRoot: string;
  modelOutputDir: string;
  modelOutputManifestPath: string;
}): void {
  mkdirSync(args.outputRoot, { recursive: true });
  rmSync(args.modelOutputDir, { recursive: true, force: true });
  rmSync(args.modelOutputManifestPath, { force: true });
}

export function shouldPreserveOfficialScoreClaim(args: {
  adapterId: OutputAdapterId;
  receipt: OfficialScoreReceipt;
  manifest: OfficialOutputManifest;
  acceptedContentPartsSha256?: string;
}): boolean {
  const expected = args.manifest.officialTaskCount ?? 0;
  const previouslyPromoted = args.receipt.scoreClaim === true ||
    args.receipt.claimBoundary?.officialScoreClaimable === true;
  const accepted = args.receipt.acceptedExternalScorerReceipt?.accepted === true;
  if (args.receipt.status !== "scored" || !previouslyPromoted || !accepted || args.manifest.status !== "complete" || expected <= 0) {
    return false;
  }
  if (args.adapterId === "finch") {
    return (args.manifest.outputTaskCount ?? 0) >= expected &&
      (args.manifest.contentPartsCount ?? 0) >= expected &&
      Boolean(args.manifest.contentPartsSha256) &&
      args.manifest.contentPartsSha256 === args.acceptedContentPartsSha256;
  }
  return (args.manifest.predictionRowCount ?? 0) >= expected;
}
