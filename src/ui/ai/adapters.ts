/**
 * Bridge from NodeRoom's native message/stream model to the shape the AI Elements
 * components consume. NodeRoom streams via Convex (not AI SDK's useChat), but its
 * `UnifiedAgentStreamPart` union already mirrors AI SDK `UIMessage` parts, so this
 * is a thin, lossless normalization — the seam that lets us delete bespoke render
 * code in favor of the maintained primitives.
 */
import type { UIMessage } from "ai";
import type { Actor, Message } from "@/engine/types";
import type { UnifiedAgentStreamPart } from "@/nodeagent/core/stream";

export type AiRole = "user" | "assistant" | "system";

/** AI SDK ToolUIPart lifecycle state, which the AI Elements <Tool> renders. */
export type ToolUiState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

/** Normalized part the AI Elements surfaces map over. Faithful to NodeRoom parts. */
export type AgentUIPart =
  | { kind: "text"; text: string; streaming: boolean }
  | { kind: "reasoning"; text: string; step: number; streaming: boolean }
  | { kind: "plan"; text: string; step: number; goal?: string; streaming: boolean }
  | {
      kind: "tool";
      name: string;
      toolCallId: string;
      state: ToolUiState;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };

function isAgentActor(author: Actor | undefined): boolean {
  return author?.kind === "agent";
}

/** Map a NodeRoom message to an AI Elements message role. */
export function aiRole(message: Pick<Message, "kind" | "author">): AiRole {
  if (message.kind === "system") return "system";
  if (message.kind === "agent") return "assistant";
  return isAgentActor(message.author) ? "assistant" : "user";
}

function toolUiState(part: Extract<UnifiedAgentStreamPart, { type: `tool-${string}` }>): ToolUiState {
  switch (part.state) {
    case "call":
      return part.input === undefined ? "input-streaming" : "input-available";
    case "output-available":
      return "output-available";
    case "output-denied":
      return "output-error";
    default:
      return "input-available";
  }
}

const isStreaming = (state: string | undefined): boolean =>
  state === "streaming" || state === "started" || state === "call";

/** Normalize a NodeRoom agent stream into AI-Elements-friendly parts. */
export function toAgentUIParts(parts: readonly UnifiedAgentStreamPart[]): AgentUIPart[] {
  const out: AgentUIPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      out.push({ kind: "text", text: part.text, streaming: isStreaming(part.state) });
    } else if (part.type === "reasoning") {
      out.push({ kind: "reasoning", text: part.text, step: part.step, streaming: isStreaming(part.state) });
    } else if (part.type === "plan") {
      out.push({ kind: "plan", text: part.text, step: part.step, goal: part.goal, streaming: isStreaming(part.state) });
    } else if (typeof part.type === "string" && part.type.startsWith("tool-")) {
      const tool = part as Extract<UnifiedAgentStreamPart, { type: `tool-${string}` }>;
      out.push({
        kind: "tool",
        name: tool.type.slice("tool-".length),
        toolCallId: tool.toolCallId,
        state: toolUiState(tool),
        input: tool.input,
        output: tool.output,
        errorText: tool.state === "output-denied" ? "Denied" : undefined,
      });
    }
    // step-start / data-artifact / data-notice are structural — omitted from the
    // conversation stream; they surface in Task/Artifact/Context surfaces instead.
  }
  return out;
}

/**
 * Produce an idiomatic AI SDK `UIMessage` for surfaces that want the native shape
 * (e.g. binding directly to AI Elements' UIMessage-driven helpers). The part list
 * is normalized from NodeRoom's stream; casting is scoped to the union boundary.
 */
export function toUIMessage(
  message: Message,
  streamParts?: readonly UnifiedAgentStreamPart[],
): UIMessage {
  const parts: UIMessage["parts"] = [];
  const normalized = streamParts?.length ? toAgentUIParts(streamParts) : [];
  if (normalized.length === 0 && message.text) {
    parts.push({ type: "text", text: message.text } as UIMessage["parts"][number]);
  }
  for (const part of normalized) {
    if (part.kind === "text" || part.kind === "plan") {
      parts.push({ type: "text", text: part.text } as UIMessage["parts"][number]);
    } else if (part.kind === "reasoning") {
      parts.push({ type: "reasoning", text: part.text } as UIMessage["parts"][number]);
    } else if (part.kind === "tool") {
      parts.push({
        type: `tool-${part.name}`,
        toolCallId: part.toolCallId,
        state: part.state,
        input: part.input,
        output: part.output,
        errorText: part.errorText,
      } as unknown as UIMessage["parts"][number]);
    }
  }
  return { id: message.id, role: aiRole(message), parts };
}
