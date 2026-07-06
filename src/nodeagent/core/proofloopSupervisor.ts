import { DEFAULT_WRITE_TOOLS } from "./freshJudge";
import type { AgentMessage, AgentResult } from "./types";

export const PROOFLOOP_VERIFIER_REPAIR_PREFIX = "PROOFLOOP VERIFIER REPAIR:";
export const PROOFLOOP_NO_WRITE_SPEND_BUDGET = "proofloop_no_write_spend_budget";
export const PROOFLOOP_NO_PROGRESS_AFTER_REPAIR = "proofloop_no_progress_after_repair";

export type ProofloopSupervisorDecision =
  | { kind: "none" }
  | { kind: "repair"; reason: string; prompt: string }
  | { kind: "terminal_failure"; reason: string; error: string };

type ProofloopSupervisorInput = {
  runtimeProfile?: string;
  goal: string;
  attempt: number;
  maxAttempts: number;
  result: Pick<AgentResult, "stopReason" | "trace" | "messages" | "finalText" | "handoff">;
};

const WRITE_TOOLS = new Set<string>(DEFAULT_WRITE_TOOLS);

export function proofloopSupervisorDecision(input: ProofloopSupervisorInput): ProofloopSupervisorDecision {
  if (input.runtimeProfile !== "benchmark_completion") return { kind: "none" };
  if (input.result.stopReason !== "spend_budget") return { kind: "none" };
  if (!goalRequiresMaterialWrite(input.goal)) return { kind: "none" };
  if (hasRoomWriteAttempt(input.result)) return { kind: "none" };

  const reason = "Benchmark completion hit spend_budget without any room-write tool receipt for a required-write goal.";
  const repairAlreadyIssued = hasProofloopRepairPrompt(input.result.messages);
  const noAttemptsRemaining = input.attempt >= input.maxAttempts;
  const crossedRepairLimit = input.attempt >= 2;
  if (repairAlreadyIssued || noAttemptsRemaining || crossedRepairLimit) {
    return {
      kind: "terminal_failure",
      reason: repairAlreadyIssued
        ? `${reason} A verifier repair prompt was already issued, so the job is failing instead of looping.`
        : `${reason} No bounded repair attempt remains, so the job is failing instead of looping.`,
      error: repairAlreadyIssued ? PROOFLOOP_NO_PROGRESS_AFTER_REPAIR : PROOFLOOP_NO_WRITE_SPEND_BUDGET,
    };
  }

  return {
    kind: "repair",
    reason,
    prompt: buildRepairPrompt(input),
  };
}

export function appendProofloopRepairMessage(messages: readonly AgentMessage[], prompt: string): AgentMessage[] {
  if (hasProofloopRepairPrompt(messages)) return [...messages];
  return [...messages, { role: "user", content: prompt }];
}

export function hasProofloopRepairPrompt(messages: readonly AgentMessage[]): boolean {
  return messages.some((message) =>
    message.role === "user" && typeof message.content === "string" && message.content.startsWith(PROOFLOOP_VERIFIER_REPAIR_PREFIX));
}

export function hasRoomWriteAttempt(result: Pick<AgentResult, "trace" | "messages">): boolean {
  return result.trace.some((event) => WRITE_TOOLS.has(event.tool))
    || result.messages.some((message) =>
      (message.role === "tool" && message.toolName !== undefined && WRITE_TOOLS.has(message.toolName))
      || (message.role === "assistant" && message.toolCalls?.some((call) => WRITE_TOOLS.has(call.tool))));
}

function goalRequiresMaterialWrite(goal: string): boolean {
  if (goalForbidsMaterialWrites(goal)) return false;
  return /\b(write|fill|edit|update|set|create|delete|recompute|commit|apply)\b/i.test(goal);
}

function goalForbidsMaterialWrites(goal: string): boolean {
  return /\b(?:do not|don't|dont|never)\s+(?:create|edit|write|update|fill|set|delete|commit|apply)\b/i.test(goal)
    || /\b(?:read[- ]only|report\b.*\bonly|count\b.*\bonly|without\s+(?:creating|editing|writing)|no\s+\w*\s*(?:artifacts?|cells?)\s+(?:created|edited|written))\b/i.test(goal);
}

function buildRepairPrompt(input: ProofloopSupervisorInput): string {
  const latestProgress = (input.result.handoff?.latestAssistantText || input.result.finalText || input.result.handoff?.summary || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200);
  const progressSuffix = latestProgress ? ` Previous progress summary: ${latestProgress}` : "";
  return [
    `${PROOFLOOP_VERIFIER_REPAIR_PREFIX} The previous benchmark slice hit spend_budget with zero room-write receipts for this required-write task.`,
    "This is a bounded repair attempt, not another broad research pass.",
    "Next turn: call list_artifacts; identify the uploaded task/source files and the target Sheet 1 artifact; use compact reads only for missing values; then write the required output table with write_locked_cells or write_locked_cell_results.",
    "If the evidence is incomplete, write best-effort predictions with confidence and brief reasons rather than continuing background reading.",
    "Do not claim completion in chat until the room-write tool receipt exists.",
    progressSuffix,
  ].filter(Boolean).join(" ");
}
