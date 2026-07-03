import type { AgentResult, AgentTraceEvent } from "./types";
import type { FrameDelta, ReasoningFrame } from "./reasoningFrames";

const WRITE_TOOL_NAMES = new Set([
  "edit_cell",
  "write_cell_result",
  "write_locked_cell",
  "write_locked_cells",
  "write_locked_cell_result",
  "write_locked_cell_results",
  "update_wiki",
  "append_notebook_outline",
  "create_draft",
]);

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function collectStringField(value: unknown, field: string): string[] {
  const record = asRecord(value);
  if (!record) return [];
  const direct = record[field];
  if (typeof direct === "string") return [direct];
  if (Array.isArray(direct)) return direct.filter((item): item is string => typeof item === "string");
  return [];
}

function collectTraceStrings(trace: AgentTraceEvent[], fieldNames: string[]): string[] {
  const out: string[] = [];
  for (const event of trace) {
    for (const field of fieldNames) {
      out.push(...collectStringField(event.args, field));
      out.push(...collectStringField(event.result, field));
    }
  }
  return unique(out);
}

function changedArtifacts(trace: AgentTraceEvent[]): string[] {
  const out: string[] = [];
  for (const event of trace) {
    if (!WRITE_TOOL_NAMES.has(event.tool)) continue;
    const artifactIds = collectStringField(event.args, "artifactId");
    out.push(...(artifactIds.length ? artifactIds : ["primary_artifact"]));
  }
  return unique(out);
}

function nextActions(frame: ReasoningFrame, result: AgentResult): string[] {
  if (result.stopReason !== "done") {
    return [`Resume frame from ${result.stopReason} handoff.`];
  }
  switch (frame.phase) {
    case "intake":
      return ["Plan cache-first child work."];
    case "plan":
      return ["Execute stale or missing child frames."];
    case "execute":
      return ["Run verification frame."];
    case "verify":
      return ["Synthesize verified outcome."];
    case "synthesize":
      return [];
  }
}

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 1_000 ? `${compact.slice(0, 997)}...` : compact;
}

export function reduceFrameResult(frame: ReasoningFrame, result: AgentResult): FrameDelta {
  const cacheKeys = unique([
    ...frame.contextPack.relevantCacheKeys,
    ...collectTraceStrings(result.trace, ["cacheKey", "cacheKeys"]),
  ]);
  const okfConceptIds = unique([
    ...frame.contextPack.relevantOkfConceptIds,
    ...collectTraceStrings(result.trace, ["conceptId", "conceptIds", "okfConceptId", "okfConceptIds"]),
  ]);
  return {
    summary: summarize(result.finalText || result.handoff?.summary || `${frame.phase} frame produced no text.`),
    changedArtifacts: changedArtifacts(result.trace),
    cacheKeysTouched: cacheKeys,
    okfConceptIdsTouched: okfConceptIds,
    openQuestions: result.stopReason === "done" ? [] : frame.contextPack.openQuestions,
    nextActions: nextActions(frame, result),
  };
}
