import type { AgentMessage } from "./types";
import type { ContextPack, EvidenceState, ReasoningFrame } from "./reasoningFrames";
import { fenceUntrusted } from "./worldModel";

export interface FrameContextMessageOptions {
  roomMessages?: AgentMessage[];
  additionalInstructions?: string[];
}

function lines(label: string, values: readonly string[]): string[] {
  return values.length ? [`${label}:`, ...values.map((value) => `- ${value}`)] : [`${label}: (none)`];
}

function optionalLine(label: string, value: string | undefined): string[] {
  return value ? [`${label}: ${value}`] : [];
}

function evidenceLines(evidence: EvidenceState | undefined): string[] {
  if (!evidence) return ["EVIDENCE STATE: (none)"];
  return [
    "EVIDENCE STATE:",
    ...lines("Required evidence", evidence.required),
    ...lines("Available refs", evidence.availableRefs),
    ...lines("Missing refs", evidence.missingRefs),
    ...lines("Stale refs", evidence.staleRefs),
    ...(evidence.confidence === undefined ? [] : [`Confidence: ${evidence.confidence}`]),
  ];
}

export function summarizeContextPack(pack: ContextPack): string {
  return [
    `Global goal: ${pack.globalGoal}`,
    ...optionalLine("Parent summary", pack.parentSummary),
    `Current artifact digest: ${pack.currentArtifactDigest}`,
    ...lines("Relevant cache keys", pack.relevantCacheKeys),
    ...lines("Relevant OKF concept IDs", pack.relevantOkfConceptIds),
    ...lines("Open questions", pack.openQuestions),
    ...lines("Constraints", pack.constraints),
    ...optionalLine("Expected output schema", pack.expectedOutputSchema),
  ].join("\n");
}

export function frameRuntimeGoal(frame: ReasoningFrame): string {
  return `[${frame.phase} frame ${frame.frameId}] ${frame.goal}`;
}

export function buildFrameContextMessages(frame: ReasoningFrame, options: FrameContextMessageOptions = {}): AgentMessage[] {
  const frameEnvelope = [
    "NODEAGENT REASONING FRAME",
    `Frame ID: ${frame.frameId}`,
    ...optionalLine("Parent frame ID", frame.parentFrameId),
    ...optionalLine("Job ID", frame.jobId),
    `Phase: ${frame.phase}`,
    `Status entering run: ${frame.status}`,
    `Frame goal: ${frame.goal}`,
    "",
    "FRAME CONTEXT PACK:",
    summarizeContextPack(frame.contextPack),
    "",
    ...evidenceLines(frame.evidenceState),
    "",
    ...lines("Allowed tools for this frame", frame.toolAllowlist),
    "",
    "Frame rules:",
    "- Use this frame envelope as the active task boundary.",
    "- Do not inherit unrelated room transcript or meta-harness memory.",
    "- Prefer cache, OKF, and explicit evidence before provider or network work.",
    "- Use lock/CAS/draft tools for room mutations.",
    "- If evidence is missing, say what is missing instead of guessing.",
    ...(options.additionalInstructions?.length ? ["", ...lines("Additional frame instructions", options.additionalInstructions)] : []),
  ].join("\n");

  return [
    { role: "user", content: frameEnvelope },
    ...(options.roomMessages ?? []).map((message) => message.role === "user"
      ? { ...message, content: `LIVE ROOM CONTEXT FOR THIS FRAME:\n${fenceUntrusted(message.content)}` }
      : message),
  ];
}
