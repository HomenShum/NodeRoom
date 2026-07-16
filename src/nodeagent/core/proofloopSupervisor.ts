import { DEFAULT_WRITE_TOOLS } from "./freshJudge";
import type { AgentMessage, AgentResult } from "./types";

export const PROOFLOOP_VERIFIER_REPAIR_PREFIX = "PROOFLOOP VERIFIER REPAIR:";
export const PROOFLOOP_NO_WRITE_SPEND_BUDGET = "proofloop_no_write_spend_budget";
export const PROOFLOOP_NO_PROGRESS_AFTER_REPAIR = "proofloop_no_progress_after_repair";
export const PROOFLOOP_REPEATED_WORKFLOW_BLOCK = "proofloop_repeated_workflow_block";

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
const VERIFIED_WORKFLOW_BLOCK_LIMIT = 4;

export function proofloopSupervisorDecision(input: ProofloopSupervisorInput): ProofloopSupervisorDecision {
  if (input.runtimeProfile !== "benchmark_completion") return { kind: "none" };
  if (!goalRequiresMaterialWrite(input.goal)) return { kind: "none" };
  if (hasSuccessfulRoomWriteReceipt(input.result)) return { kind: "none" };

  const workflowBlocks = verifiedWorkbookWorkflowBlockCount(input.result);
  if (workflowBlocks >= VERIFIED_WORKFLOW_BLOCK_LIMIT) {
    const reason = `Benchmark completion accumulated ${workflowBlocks} verified-workbook workflow blocks without a successful room-write receipt.`;
    return boundedRepairDecision(input, {
      reason,
      terminalError: PROOFLOOP_REPEATED_WORKFLOW_BLOCK,
      prompt: [
        `${PROOFLOOP_VERIFIER_REPAIR_PREFIX} The prior slice repeatedly failed the verified workbook commit boundary.`,
        "Do not retranscribe the complete approved plan.",
        "If preflight already passed, call write_locked_cells once with the approved artifact id and one unchanged approved operation; the runtime will bind that explicit commit attempt to the complete preflight-approved plan.",
        "Do not change targets, formulas, values, cached results, or number formats. If no plan passed preflight, inspect and preflight one corrected complete plan first.",
      ].join(" "),
    });
  }

  if (input.result.stopReason !== "spend_budget") return { kind: "none" };

  const reason = "Benchmark completion hit spend_budget without any room-write tool receipt for a required-write goal.";
  return boundedRepairDecision(input, {
    reason,
    terminalError: PROOFLOOP_NO_WRITE_SPEND_BUDGET,
    prompt: buildRepairPrompt(input),
  });
}

function boundedRepairDecision(
  input: ProofloopSupervisorInput,
  args: { reason: string; terminalError: string; prompt: string },
): ProofloopSupervisorDecision {
  const repairAlreadyIssued = hasProofloopRepairPrompt(input.result.messages);
  const noAttemptsRemaining = input.attempt >= input.maxAttempts;
  const crossedRepairLimit = input.attempt >= 2;
  if (repairAlreadyIssued || noAttemptsRemaining || crossedRepairLimit) {
    return {
      kind: "terminal_failure",
      reason: repairAlreadyIssued
        ? `${args.reason} A verifier repair prompt was already issued, so the job is failing instead of looping.`
        : `${args.reason} No bounded repair attempt remains, so the job is failing instead of looping.`,
      error: repairAlreadyIssued ? PROOFLOOP_NO_PROGRESS_AFTER_REPAIR : args.terminalError,
    };
  }

  return {
    kind: "repair",
    reason: args.reason,
    prompt: args.prompt,
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

export function hasSuccessfulRoomWriteReceipt(result: Pick<AgentResult, "trace" | "messages">): boolean {
  if (result.trace.some((event) => WRITE_TOOLS.has(event.tool) && successfulWriteResult(event.result))) return true;
  return result.messages.some((message) => {
    if (message.role !== "tool" || !message.toolName || !WRITE_TOOLS.has(message.toolName)) return false;
    return successfulWriteResult(parseToolResult(message.content));
  });
}

export function verifiedWorkbookWorkflowBlockCount(result: Pick<AgentResult, "trace" | "messages">): number {
  const traceCount = result.trace.filter((event) =>
    WRITE_TOOLS.has(event.tool) && verifiedWorkbookBlockResult(event.result)).length;
  const messageCount = result.messages.filter((message) =>
    message.role === "tool"
    && !!message.toolName
    && WRITE_TOOLS.has(message.toolName)
    && verifiedWorkbookBlockResult(parseToolResult(message.content))).length;
  return Math.max(traceCount, messageCount);
}

function successfulWriteResult(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.ok !== false && typeof result.error !== "string";
}

function verifiedWorkbookBlockResult(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.error === "tool_blocked"
    && typeof result.reason === "string"
    && result.reason.includes("verified_workbook_workflow:");
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
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
