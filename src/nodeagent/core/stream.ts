export type AgentStreamEventKind =
  | "message_start"
  | "step_start"
  | "text_delta"
  | "tool_call_start"
  | "tool_call_result"
  | "artifact_update"
  | "warning"
  | "error"
  | "message_done"
  | "reasoning"
  | "plan";

export type AgentStreamEventStatus = "started" | "streaming" | "completed" | "failed" | "skipped";

export type AgentStreamEventDraft = {
  kind: AgentStreamEventKind;
  step?: number;
  toolCallId?: string;
  toolName?: string;
  status?: AgentStreamEventStatus;
  text?: string;
  title?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
};

export type PersistedAgentStreamEvent = AgentStreamEventDraft & {
  id?: string;
  jobId?: string;
  roomId?: string;
  runId?: string;
  sequence: number;
  createdAt: number;
};

export type AgentTextStreamPart = {
  type: "text";
  text: string;
  state: "streaming" | "done";
};

export type AgentStepStreamPart = {
  type: "step-start";
  step: number;
  state: AgentStreamEventStatus;
  title: string;
  metadata?: Record<string, unknown>;
};

export type AgentToolStreamPart = {
  type: `tool-${string}`;
  toolName: string;
  toolCallId: string;
  state: "call" | "output-available" | "output-denied";
  step?: number;
  input?: unknown;
  output?: unknown;
  status?: AgentStreamEventStatus;
  error?: string;
  ms?: number;
};

export type AgentArtifactStreamPart = {
  type: "data-artifact";
  state: AgentStreamEventStatus;
  title: string;
  metadata?: Record<string, unknown>;
};

export type AgentNoticeStreamPart = {
  type: "data-notice";
  state: AgentStreamEventStatus;
  title: string;
  text?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type AgentReasoningStreamPart = {
  type: "reasoning";
  step: number;
  text: string;
  state: AgentStreamEventStatus;
};

export type AgentPlanStreamPart = {
  type: "plan";
  step: number;
  text: string;
  state: AgentStreamEventStatus;
  goal?: string;
};

export type UnifiedAgentStreamPart =
  | AgentTextStreamPart
  | AgentStepStreamPart
  | AgentToolStreamPart
  | AgentArtifactStreamPart
  | AgentNoticeStreamPart
  | AgentReasoningStreamPart
  | AgentPlanStreamPart;

export function buildUnifiedAgentStreamParts(
  events: PersistedAgentStreamEvent[],
  opts: { finalText?: string; terminal?: boolean } = {},
): UnifiedAgentStreamPart[] {
  const parts: UnifiedAgentStreamPart[] = [];
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
  let textPart: AgentTextStreamPart | undefined;
  let reasoningPart: AgentReasoningStreamPart | undefined;
  let planPart: AgentPlanStreamPart | undefined;
  let sawDone = false;

  const appendReasoning = (text: string, step: number, state: AgentStreamEventStatus = "streaming") => {
    if (!text) return;
    if (reasoningPart && reasoningPart.step === step) {
      reasoningPart.text += text;
      reasoningPart.state = state;
      return;
    }
    reasoningPart = { type: "reasoning", step, text, state };
    parts.push(reasoningPart);
  };

  const appendPlan = (text: string, step: number, state: AgentStreamEventStatus = "streaming", goal?: string) => {
    if (!text) return;
    if (planPart) {
      planPart.text += text;
      planPart.state = state;
      return;
    }
    planPart = { type: "plan", step, text, state, goal };
    parts.push(planPart);
  };

  const appendText = (text: string, state: AgentTextStreamPart["state"] = "streaming") => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.type === "text") {
      last.text += text;
      last.state = state;
      textPart = last;
      return;
    }
    textPart = { type: "text", text, state };
    parts.push(textPart);
  };

  const upsertTool = (event: PersistedAgentStreamEvent, state: AgentToolStreamPart["state"]) => {
    const toolName = event.toolName ?? "tool";
    const toolCallId = event.toolCallId ?? `${toolName}-${event.sequence}`;
    const existing = parts.find((part): part is AgentToolStreamPart =>
      part.type.startsWith("tool-") && "toolCallId" in part && part.toolCallId === toolCallId
    );
    const next: AgentToolStreamPart = {
      type: `tool-${toolName}`,
      toolName,
      toolCallId,
      state,
      step: event.step,
      input: event.input,
      output: event.output,
      status: event.status,
      error: event.error,
      ms: typeof event.metadata?.ms === "number" ? event.metadata.ms : undefined,
    };
    if (existing) Object.assign(existing, next, { input: existing.input ?? next.input });
    else parts.push(next);
  };

  for (const event of sorted) {
    if (event.kind === "message_done") {
      sawDone = true;
      if (!textPart && event.text) appendText(event.text, "done");
      else if (textPart && event.text && event.text !== textPart.text) {
        textPart.text = event.text.startsWith(textPart.text)
          ? event.text
          : `${textPart.text}\n\n${event.text}`;
      }
      if (textPart) textPart.state = "done";
      continue;
    }
    if (event.kind === "text_delta") {
      appendText(event.text ?? "");
      continue;
    }
    if (event.kind === "step_start") {
      parts.push({
        type: "step-start",
        step: event.step ?? 0,
        state: event.status ?? "started",
        title: event.title ?? `Step ${(event.step ?? 0) + 1}`,
        metadata: event.metadata,
      });
      continue;
    }
    if (event.kind === "tool_call_start") {
      upsertTool(event, "call");
      continue;
    }
    if (event.kind === "tool_call_result") {
      upsertTool(event, event.status === "failed" ? "output-denied" : "output-available");
      continue;
    }
    if (event.kind === "artifact_update") {
      parts.push({
        type: "data-artifact",
        state: event.status ?? "completed",
        title: event.title ?? "Artifact updated",
        metadata: event.metadata,
      });
      continue;
    }
    if (event.kind === "reasoning") {
      appendReasoning(event.text ?? "", event.step ?? 0, event.status ?? "streaming");
      continue;
    }
    if (event.kind === "plan") {
      appendPlan(event.text ?? "", event.step ?? 0, event.status ?? "streaming", typeof event.metadata?.goal === "string" ? event.metadata.goal as string : undefined);
      continue;
    }
    if (event.kind === "warning" || event.kind === "error") {
      parts.push({
        type: "data-notice",
        state: event.kind === "error" ? "failed" : event.status ?? "completed",
        title: event.title ?? (event.kind === "error" ? "Agent error" : "Agent notice"),
        text: event.text,
        error: event.error,
        metadata: event.metadata,
      });
    }
  }

  if (opts.finalText && !textPart) appendText(opts.finalText, opts.terminal ? "done" : "streaming");
  if ((sawDone || opts.terminal) && textPart) textPart.state = "done";
  if ((sawDone || opts.terminal) && reasoningPart) reasoningPart.state = "completed";
  if ((sawDone || opts.terminal) && planPart) planPart.state = "completed";
  return parts;
}
