/**
 * AgentConversation — the AI Elements replacement for NodeRoom's bespoke chat
 * message stream (the render half of the 2,715-line Chat.tsx). It renders the
 * normalized parts from `adapters.ts` through the maintained AI Elements
 * primitives: Conversation, Message, Reasoning, Tool, MessageResponse.
 *
 * Wrapped in `.ai-scope` so the preflight-free Tailwind base applies locally.
 * Styling resolves to the terracotta tokens via the shadcn variable mapping in
 * ai-elements.css, so it renders on-brand in both themes with zero custom CSS.
 */
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import type { ToolUIPart } from "ai";
import type { AgentUIPart, AiRole } from "./adapters";

export type AgentConversationMessage = {
  id: string;
  role: AiRole;
  parts: AgentUIPart[];
};

function AgentPart({ part }: { part: AgentUIPart }) {
  if (part.kind === "text" || part.kind === "plan") {
    return <MessageResponse>{part.text}</MessageResponse>;
  }
  if (part.kind === "reasoning") {
    return (
      <Reasoning isStreaming={part.streaming} defaultOpen={false}>
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
  }
  // tool
  return (
    <Tool>
      <ToolHeader type={`tool-${part.name}` as ToolUIPart["type"]} state={part.state} />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput output={part.output as ToolUIPart["output"]} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}

export function AgentConversation({
  messages,
  emptyTitle = "No messages yet",
  emptyDescription = "Ask the room agent to get started.",
}: {
  messages: AgentConversationMessage[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <div className="ai-scope flex min-h-0 flex-1 flex-col">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState title={emptyTitle} description={emptyDescription} />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, index) => (
                    <AgentPart key={`${message.id}-${index}`} part={part} />
                  ))}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}
