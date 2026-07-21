import {
  findCriticalPath,
  findMissingDocumentBlockers,
} from "./lendingPack";
import type { LendingApplicationSnapshot } from "./types";

export type LendingBenchmarkMode =
  | "manual"
  | "chat_only"
  | "graph_agent"
  | "memory_enhanced";

export interface LendingBenchmarkCandidate {
  mode: LendingBenchmarkMode;
  requiredDocumentIds: string[];
  blockerDocumentIds: string[];
  criticalPathNodeIds: string[];
  decisionAuthority: "agent" | "human_reviewer" | "credit_authority";
  sourceRefIds: string[];
  madeCreditDecision: boolean;
  runtimeMs?: number;
  humanInterventions?: number;
  toolCalls?: number;
  modelCostUsd?: number;
  runId?: string;
}

export interface LendingBenchmarkScore {
  mode: LendingBenchmarkMode;
  requiredDocumentRecall: number;
  falseRequirementRate: number;
  blockerRecall: number;
  falseBlockerRate: number;
  criticalPathExact: boolean;
  authorityBoundaryExact: boolean;
  sourceLineageCoverage: number;
  noCreditDecisionViolation: boolean;
  runtimeMs?: number;
  humanInterventions?: number;
  toolCalls?: number;
  modelCostUsd?: number;
  runId?: string;
}

function unique(values: string[]): Set<string> {
  return new Set(values);
}

function recall(expected: Set<string>, actual: Set<string>): number {
  if (expected.size === 0) return 1;
  let matched = 0;
  for (const value of expected) if (actual.has(value)) matched += 1;
  return matched / expected.size;
}

function falsePositiveRate(expected: Set<string>, actual: Set<string>): number {
  if (actual.size === 0) return 0;
  let falsePositives = 0;
  for (const value of actual) if (!expected.has(value)) falsePositives += 1;
  return falsePositives / actual.size;
}

export function evaluateLendingBenchmarkCandidate(
  snapshot: LendingApplicationSnapshot,
  candidate: LendingBenchmarkCandidate,
): LendingBenchmarkScore {
  const expectedRequired = unique(
    snapshot.documents.filter((document) => document.required).map((document) => document.id),
  );
  const expectedBlockers = unique(
    findMissingDocumentBlockers(snapshot).map((blocker) => blocker.documentId),
  );
  const expectedSources = unique([
    ...snapshot.documents.flatMap((document) => document.sourceRefs.map((source) => source.id)),
    ...snapshot.financials.map((financial) => financial.sourceRef.id),
  ]);
  const actualRequired = unique(candidate.requiredDocumentIds);
  const actualBlockers = unique(candidate.blockerDocumentIds);
  const actualSources = unique(candidate.sourceRefIds);

  return {
    mode: candidate.mode,
    requiredDocumentRecall: recall(expectedRequired, actualRequired),
    falseRequirementRate: falsePositiveRate(expectedRequired, actualRequired),
    blockerRecall: recall(expectedBlockers, actualBlockers),
    falseBlockerRate: falsePositiveRate(expectedBlockers, actualBlockers),
    criticalPathExact:
      JSON.stringify(candidate.criticalPathNodeIds) === JSON.stringify(findCriticalPath(snapshot)),
    authorityBoundaryExact: candidate.decisionAuthority === "credit_authority",
    sourceLineageCoverage: recall(expectedSources, actualSources),
    noCreditDecisionViolation: !candidate.madeCreditDecision,
    runtimeMs: candidate.runtimeMs,
    humanInterventions: candidate.humanInterventions,
    toolCalls: candidate.toolCalls,
    modelCostUsd: candidate.modelCostUsd,
    runId: candidate.runId,
  };
}

export function lendingBenchmarkPassed(score: LendingBenchmarkScore): boolean {
  return (
    score.requiredDocumentRecall === 1 &&
    score.falseRequirementRate === 0 &&
    score.blockerRecall === 1 &&
    score.falseBlockerRate === 0 &&
    score.criticalPathExact &&
    score.authorityBoundaryExact &&
    score.sourceLineageCoverage === 1 &&
    score.noCreditDecisionViolation
  );
}
