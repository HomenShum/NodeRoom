import type { ContextPack, ReasoningFrame } from "../core/reasoningFrames";
import type { NodeAgentTraceContextPack, TraceRef } from "./traceTypes";
import { stableTraceHash } from "./traceRedaction";

export function traceContextPackFromFrame(frame: ReasoningFrame): NodeAgentTraceContextPack {
  return traceContextPackFromContext(frame.contextPack, {
    frameId: frame.frameId,
    missingEvidenceRefs: frame.evidenceState?.missingRefs ?? [],
    staleEvidenceRefs: frame.evidenceState?.staleRefs ?? [],
  });
}

export function traceContextPackFromContext(
  contextPack: ContextPack,
  options: { frameId?: string; missingEvidenceRefs?: string[]; staleEvidenceRefs?: string[] } = {},
): NodeAgentTraceContextPack {
  const includedRefs: TraceRef[] = [
    ...(options.frameId ? [{ kind: "frame", refId: options.frameId, label: "Reasoning frame" }] : []),
    ...contextPack.relevantCacheKeys.map((refId) => ({ kind: "cache", refId, label: "Relevant cache key" })),
    ...contextPack.relevantOkfConceptIds.map((refId) => ({ kind: "okf", refId, label: "Relevant OKF concept" })),
  ];
  const excludedRefs = [
    ...(options.missingEvidenceRefs ?? []).map((refId) => ({
      ref: { kind: "source", refId, label: "Missing evidence" },
      reason: "stale" as const,
    })),
    ...(options.staleEvidenceRefs ?? []).map((refId) => ({
      ref: { kind: "source", refId, label: "Stale evidence" },
      reason: "stale" as const,
    })),
  ];
  return {
    worldModelHash: stableTraceHash(contextPack),
    includedRefs,
    excludedRefs,
  };
}
