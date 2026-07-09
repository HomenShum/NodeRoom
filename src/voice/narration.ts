import type { Actor, Channel } from "../engine/types";
import type { VoiceNarrationUtterance } from "./types";

export type VoiceNarrationEvent =
  | { kind: "message"; id: string; channel: Channel; author: Actor; text: string; ownVoiceCommand?: boolean }
  | { kind: "job"; id: string; status: string; finalText?: string; error?: string }
  | { kind: "proposal"; id: string; status: "pending" | "approved" | "rejected" | "applied" | "needs_rebase"; summary?: string };

export function narrationForRoomEvent(event: VoiceNarrationEvent): VoiceNarrationUtterance | null {
  switch (event.kind) {
    case "message":
      if (event.ownVoiceCommand || event.author.kind !== "agent") return null;
      return {
        id: `voice-narration-message-${event.id}`,
        text: compactSpeech(event.text),
        priority: event.channel === "public" ? "normal" : "low",
        source: "room_event",
      };
    case "job":
      return narrationForJob(event);
    case "proposal":
      return narrationForProposal(event);
  }
}

function narrationForJob(event: Extract<VoiceNarrationEvent, { kind: "job" }>): VoiceNarrationUtterance | null {
  if (event.status === "running" || event.status === "queued") {
    return { id: `voice-narration-job-${event.id}-${event.status}`, text: "NodeAgent is working.", priority: "low", source: "job_event" };
  }
  if (event.status === "completed") {
    return {
      id: `voice-narration-job-${event.id}-completed`,
      text: event.finalText ? compactSpeech(event.finalText) : "NodeAgent completed the run.",
      priority: "normal",
      source: "job_event",
    };
  }
  if (event.status === "cancelled") {
    return { id: `voice-narration-job-${event.id}-cancelled`, text: "The active NodeAgent job was cancelled.", priority: "high", interrupt: true, source: "job_event" };
  }
  if (event.status === "failed" || event.status === "blocked") {
    return {
      id: `voice-narration-job-${event.id}-${event.status}`,
      text: event.error ? `NodeAgent ${event.status}: ${compactSpeech(event.error)}` : `NodeAgent ${event.status}.`,
      priority: "high",
      source: "job_event",
    };
  }
  return null;
}

function narrationForProposal(event: Extract<VoiceNarrationEvent, { kind: "proposal" }>): VoiceNarrationUtterance | null {
  if (event.status === "pending") {
    return {
      id: `voice-narration-proposal-${event.id}-pending`,
      text: event.summary ? `A proposal needs review: ${compactSpeech(event.summary)}` : "A proposal needs review.",
      priority: "high",
      source: "proposal_event",
    };
  }
  if (event.status === "applied" || event.status === "approved") {
    return { id: `voice-narration-proposal-${event.id}-${event.status}`, text: "The proposal was approved.", priority: "normal", source: "proposal_event" };
  }
  if (event.status === "rejected") {
    return { id: `voice-narration-proposal-${event.id}-rejected`, text: "The proposal was rejected.", priority: "normal", source: "proposal_event" };
  }
  if (event.status === "needs_rebase") {
    return { id: `voice-narration-proposal-${event.id}-needs-rebase`, text: "The proposal still needs review after a version conflict.", priority: "high", source: "proposal_event" };
  }
  return null;
}

export function compactSpeech(text: string, maxLength: number = 240): string {
  const cleaned = text.replace(/[`*_#[\]()>-]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}
