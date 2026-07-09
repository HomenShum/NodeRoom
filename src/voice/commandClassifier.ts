import type { Actor, Channel } from "../engine/types";
import type { AgentAskInput, AgentModelSelection } from "../app/store";
import type { RoomCommand, RoomCommandKind, VoiceRiskLevel, VoiceTurn } from "./types";

const DEFAULT_NODEAGENT_GOAL = "Diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps.";
const CANCEL_RE = /\b(cancel|stop|halt|abort|interrupt|stand down)\b(?:\s+(?:the\s+)?(?:job|agent|run|work|task))?\b/i;
const CONFIRM_RE = /^(yes|confirm|approved?|approve it|go ahead|do it|proceed|that's right|correct)\b/i;
const REJECT_RE = /^(no|reject|cancel that|never mind|do not|don't)\b/i;
const PUBLIC_AGENT_PREFIX_RE = /^(?:@nodeagent|\/ask|\/free)\b\s*/i;
const VOICE_AGENT_PREFIX_RE = /^(?:(?:ask|tell|have)\s+)?(?:the\s+)?(?:room\s+)?node\s*agent(?:\s+to)?\b[:,]?\s*/i;
const PRIVATE_AGENT_PREFIX_RE = /^(?:(?:ask|tell|have)\s+)?(?:my|private|personal)\s+(?:node\s*)?agent(?:\s+to)?\b[:,]?\s*/i;
const POST_TO_ROOM_RE = /^(?:say|post|send|tell everyone|tell the room)\b(?:\s+(?:to|in)\s+(?:the\s+)?room)?[:,]?\s*/i;

const DESTRUCTIVE_RE = /\b(delete|remove|clear|erase|drop|wipe|reset|overwrite|destroy)\b/i;
const WRITE_RE = /\b(approve|commit|publish|share|edit|write|update|change|set|fill|create|add|modify|merge|apply|send)\b/i;
const DRAFT_RE = /\b(draft|propose|plan|review|summarize|analyze|research|diligence|inspect|check|compare)\b/i;

export type ClassifyVoiceTranscriptArgs = {
  roomId: string;
  actor: Actor;
  channel: Channel;
  transcript: string;
  turn?: VoiceTurn;
  privateMode?: boolean;
  publishPrivateToRoom?: boolean;
  modelSelection?: AgentModelSelection;
  contextArtifactId?: string;
  references?: AgentAskInput["references"];
  now?: number;
};

export function classifyVoiceTranscript(args: ClassifyVoiceTranscriptArgs): RoomCommand {
  const now = args.now ?? Date.now();
  const raw = args.transcript.trim().replace(/\s+/g, " ");
  const lower = raw.toLowerCase();
  const base = {
    id: `voice-cmd-${args.turn?.id ?? stableCommandSuffix(raw, now)}`,
    source: "voice" as const,
    roomId: args.roomId,
    actor: args.actor,
    channel: args.channel,
    status: "classified" as const,
    transcript: raw,
    turnId: args.turn?.id,
    createdAt: now,
    metadata: {
      publishToRoom: args.publishPrivateToRoom,
      modelSelection: args.modelSelection,
      contextArtifactId: args.contextArtifactId,
      references: args.references,
    },
  };

  if (!raw) {
    return finalizeCommand({ ...base, kind: "public_chat_message", commandText: "", riskLevel: "read" });
  }
  if (CONFIRM_RE.test(lower)) {
    return finalizeCommand({ ...base, kind: "confirm_pending_command", commandText: raw, riskLevel: "read" });
  }
  if (REJECT_RE.test(lower)) {
    return finalizeCommand({ ...base, kind: "reject_pending_command", commandText: raw, riskLevel: "read" });
  }
  if (CANCEL_RE.test(lower)) {
    return finalizeCommand({ ...base, kind: "cancel_active_job", commandText: raw, riskLevel: "destructive" }, { requireConfirmation: false });
  }

  const publicDirective = parsePublicAgentDirective(raw);
  if (publicDirective) {
    return commandForAgent(base, "public_agent_request", publicDirective.goal, publicDirective.forceFree);
  }

  const privateDirective = raw.match(PRIVATE_AGENT_PREFIX_RE);
  if (privateDirective) {
    const goal = raw.slice(privateDirective[0].length).trim() || DEFAULT_NODEAGENT_GOAL;
    return commandForAgent(base, "private_agent_request", goal, false);
  }

  if (args.privateMode) {
    return commandForAgent(base, "private_agent_request", raw, false);
  }

  const roomPost = raw.match(POST_TO_ROOM_RE);
  if (roomPost) {
    const text = raw.slice(roomPost[0].length).trim() || raw;
    return finalizeCommand({ ...base, kind: "public_chat_message", commandText: text, riskLevel: classifyRisk(text) });
  }

  return commandForAgent(base, "public_agent_request", raw, false);
}

function parsePublicAgentDirective(raw: string): { goal: string; forceFree: boolean } | null {
  const slash = raw.match(PUBLIC_AGENT_PREFIX_RE);
  if (slash) {
    const prefix = slash[0].trim().toLowerCase();
    return {
      goal: raw.slice(slash[0].length).trim() || DEFAULT_NODEAGENT_GOAL,
      forceFree: prefix === "/free",
    };
  }
  const voice = raw.match(VOICE_AGENT_PREFIX_RE);
  if (!voice) return null;
  return { goal: raw.slice(voice[0].length).trim() || DEFAULT_NODEAGENT_GOAL, forceFree: false };
}

function commandForAgent(
  base: Omit<RoomCommand, "kind" | "commandText" | "riskLevel" | "requiresConfirmation" | "confirmed">,
  kind: Extract<RoomCommandKind, "public_agent_request" | "private_agent_request">,
  goal: string,
  forceFree: boolean,
): RoomCommand {
  return finalizeCommand({
    ...base,
    kind,
    commandText: goal,
    riskLevel: classifyRisk(goal),
    metadata: { ...base.metadata, forceFree },
  });
}

function finalizeCommand(
  command: Omit<RoomCommand, "requiresConfirmation" | "confirmed">,
  opts?: { requireConfirmation?: boolean },
): RoomCommand {
  const requiresConfirmation = opts?.requireConfirmation ?? commandRequiresConfirmation(command.kind, command.riskLevel);
  return {
    ...command,
    requiresConfirmation,
    confirmed: !requiresConfirmation,
    confirmationPrompt: requiresConfirmation ? confirmationPromptFor(command.commandText, command.riskLevel) : undefined,
    status: requiresConfirmation ? "awaiting_confirmation" : command.status,
  };
}

export function classifyRisk(text: string): VoiceRiskLevel {
  if (DESTRUCTIVE_RE.test(text)) return "destructive";
  if (WRITE_RE.test(text)) return "write";
  if (DRAFT_RE.test(text)) return "draft";
  return "read";
}

export function commandRequiresConfirmation(kind: RoomCommandKind, riskLevel: VoiceRiskLevel): boolean {
  if (kind === "cancel_active_job" || kind === "confirm_pending_command" || kind === "reject_pending_command") return false;
  return riskLevel === "write" || riskLevel === "destructive";
}

export function confirmCommand(command: RoomCommand): RoomCommand {
  return {
    ...command,
    confirmed: true,
    requiresConfirmation: false,
    status: "classified",
    confirmationPrompt: undefined,
  };
}

function confirmationPromptFor(text: string, riskLevel: VoiceRiskLevel): string {
  const preview = text.length > 120 ? `${text.slice(0, 117)}...` : text;
  return riskLevel === "destructive"
    ? `Confirm before I route this destructive voice command through NodeRoom governance: ${preview}`
    : `Confirm before I route this write-like voice command through NodeRoom governance: ${preview}`;
}

function stableCommandSuffix(text: string, now: number): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return `${now.toString(36)}-${hash.toString(36)}`;
}
