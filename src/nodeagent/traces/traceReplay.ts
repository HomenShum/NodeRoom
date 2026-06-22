import type { NodeAgentTrace, TraceStepPhase } from "./traceTypes";

export const TRACE_EXCELLENCE_LEVELS = [
  "L0 console logs",
  "L1 structured steps",
  "L2 tool receipts",
  "L3 evidence links",
  "L4 mutation receipts",
  "L5 UI proof",
  "L6 eval binding",
  "L7 rework ledger",
  "L8 teaching artifact",
] as const;

export function traceExcellenceLevel(trace: NodeAgentTrace): number {
  let level = trace.steps.length > 0 ? 1 : 0;
  if (trace.steps.some((step) => step.tool)) level = 2;
  if (trace.evidence.length > 0 || trace.steps.some((step) => step.inputRefs.length || step.outputRefs.length)) level = 3;
  if (trace.mutations.length > 0) level = 4;
  if (trace.steps.some((step) => step.visual?.screenshotRef || step.visual?.videoRef)) level = 5;
  if (trace.eval.benchmarkCaseId || trace.eval.proofArtifacts.length > 0) level = 6;
  if ((trace.reworkLedger?.length ?? 0) > 0) level = 7;
  return level;
}

export function tracePhaseCounts(trace: NodeAgentTrace): Record<TraceStepPhase, number> {
  const counts = {} as Record<TraceStepPhase, number>;
  for (const step of trace.steps) counts[step.phase] = (counts[step.phase] ?? 0) + 1;
  return counts;
}

export function summarizeTrace(trace: NodeAgentTrace): string {
  const level = traceExcellenceLevel(trace);
  const phases = Object.entries(tracePhaseCounts(trace))
    .map(([phase, count]) => `${phase}:${count}`)
    .join(", ");
  return [
    `${trace.traceId} ${trace.final.status}`,
    `${trace.steps.length} steps`,
    TRACE_EXCELLENCE_LEVELS[level],
    phases || "no phases",
  ].join(" | ");
}
