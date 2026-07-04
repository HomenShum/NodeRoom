import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkAdapterId } from "./proofloopBenchmarkAdapters";

export type ProofloopOfficialOutputManifest = {
  schema?: "proofloop-official-output-manifest-v1";
  adapterId?: BenchmarkAdapterId;
  status?: "complete" | "partial" | "blocked";
  officialTaskCount?: number;
  outputTaskCount?: number;
  predictionRowCount?: number;
  contentPartsCount?: number;
  outputRoot?: string;
  evidence?: string[];
  blockers?: string[];
};

export function officialOutputManifestPath(adapterId: BenchmarkAdapterId): string {
  return `docs/eval/proofloop-official-outputs/${adapterId}.json`;
}

export function readOfficialOutputManifest(
  root: string,
  adapterId: BenchmarkAdapterId,
): ProofloopOfficialOutputManifest | undefined {
  const path = join(root, officialOutputManifestPath(adapterId));
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProofloopOfficialOutputManifest;
  } catch {
    return undefined;
  }
}

export function officialOutputManifestComplete(manifest: ProofloopOfficialOutputManifest | undefined): boolean {
  if (!manifest || manifest.status !== "complete") return false;
  const expected = manifest.officialTaskCount ?? 0;
  if (expected <= 0) return false;
  if (manifest.adapterId === "finch") {
    return (manifest.outputTaskCount ?? 0) >= expected;
  }
  if (manifest.adapterId === "finauditing") {
    return (manifest.predictionRowCount ?? 0) >= expected;
  }
  return Math.max(manifest.outputTaskCount ?? 0, manifest.predictionRowCount ?? 0, manifest.contentPartsCount ?? 0) >= expected;
}

export function officialOutputManifestEvidence(
  adapterId: BenchmarkAdapterId,
  manifest: ProofloopOfficialOutputManifest | undefined,
): string[] {
  if (!manifest) return [];
  return [
    officialOutputManifestPath(adapterId),
    ...(manifest.evidence ?? []),
    ...(manifest.outputRoot ? [manifest.outputRoot] : []),
  ];
}

export function isOfficialOutputExporterBlocker(adapterId: BenchmarkAdapterId, blocker: string): boolean {
  const text = blocker.toLowerCase();
  if (adapterId === "finch") {
    return (
      text.includes("missing output exporter") ||
      text.includes("nodeRoom model-output directory".toLowerCase()) ||
      text.includes("one official-output artifact per finch task id") ||
      text.includes("one output artifact per official finch task id")
    );
  }
  if (adapterId === "finauditing") {
    return (
      text.includes("missing output exporter") ||
      text.includes("prediction jsonl") ||
      text.includes("finsm/finre/finmr") ||
      text.includes("official-format finsm")
    );
  }
  return false;
}
