import type { Actor, Channel } from "../engine/types";
import type { AgentAskInput, AgentJobTelemetry, AgentModelSelection } from "../app/store";

export type VoiceSessionStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "awaiting_confirmation"
  | "dispatching"
  | "speaking"
  | "interrupted"
  | "cancelled"
  | "failed";

export type VoiceRiskLevel = "read" | "draft" | "write" | "destructive";

export type RoomCommandKind =
  | "public_chat_message"
  | "public_agent_request"
  | "private_agent_request"
  | "cancel_active_job"
  | "confirm_pending_command"
  | "reject_pending_command";

export type RoomCommandStatus =
  | "received"
  | "classified"
  | "awaiting_confirmation"
  | "dispatching"
  | "dispatched"
  | "completed"
  | "cancelled"
  | "failed";

export type VoiceTranscriptChunk = {
  id: string;
  sessionId: string;
  text: string;
  isFinal: boolean;
  confidence?: number;
  startedAt?: number;
  endedAt?: number;
  locale?: string;
};

export type VoiceTurn = {
  id: string;
  sessionId: string;
  transcript: string;
  confidence?: number;
  startedAt: number;
  endedAt: number;
  locale?: string;
};

export type VoiceCommandMetadata = {
  forceFree?: boolean;
  publishToRoom?: boolean;
  modelSelection?: AgentModelSelection;
  contextArtifactId?: string;
  references?: AgentAskInput["references"];
  reason?: string;
  provider?: string;
};

export type RoomCommand = {
  id: string;
  source: "voice";
  roomId: string;
  actor: Actor;
  channel: Channel;
  kind: RoomCommandKind;
  status: RoomCommandStatus;
  transcript: string;
  commandText: string;
  riskLevel: VoiceRiskLevel;
  requiresConfirmation: boolean;
  confirmed: boolean;
  confirmationPrompt?: string;
  turnId?: string;
  createdAt: number;
  metadata?: VoiceCommandMetadata;
};

export type VoiceSessionState = {
  sessionId: string;
  status: VoiceSessionStatus;
  startedAt?: number;
  updatedAt: number;
  activeTurnId?: string;
  partialTranscript?: string;
  pendingCommand?: RoomCommand;
  lastCommand?: RoomCommand;
  lastError?: string;
};

export type VoiceSessionEvent =
  | { type: "START_LISTENING"; now: number }
  | { type: "PARTIAL_TRANSCRIPT"; chunk: VoiceTranscriptChunk; now: number }
  | { type: "FINAL_TRANSCRIPT"; turn: VoiceTurn; command?: RoomCommand; now: number }
  | { type: "AWAIT_CONFIRMATION"; command: RoomCommand; now: number }
  | { type: "CONFIRM"; command: RoomCommand; now: number }
  | { type: "DISPATCH_START"; command: RoomCommand; now: number }
  | { type: "DISPATCH_DONE"; command: RoomCommand; now: number }
  | { type: "SPEAK_START"; now: number }
  | { type: "SPEAK_DONE"; now: number }
  | { type: "INTERRUPT"; now: number }
  | { type: "CANCEL"; now: number }
  | { type: "FAIL"; error: string; now: number }
  | { type: "RESET"; now: number };

export type RoomCommandState = {
  command: RoomCommand;
  status: RoomCommandStatus;
  updatedAt: number;
  failureReason?: string;
};

export type RoomCommandEvent =
  | { type: "CLASSIFIED"; now: number }
  | { type: "REQUIRES_CONFIRMATION"; now: number }
  | { type: "CONFIRMED"; now: number }
  | { type: "REJECTED"; now: number }
  | { type: "DISPATCH_START"; now: number }
  | { type: "DISPATCH_OK"; now: number }
  | { type: "DISPATCH_FAILED"; reason: string; now: number }
  | { type: "CANCELLED"; now: number };

export type VoiceDispatchResult =
  | { ok: true; kind: "message_posted" | "agent_started" | "private_agent_started" | "job_cancelled"; jobId?: string }
  | { ok: false; kind: "confirmation_required" | "no_active_job" | "rejected" | "failed"; reason: string };

export type VoiceGatewayContext = {
  roomId: string;
  actor: Actor;
  channel: Channel;
  privateMode?: boolean;
  publishPrivateToRoom?: boolean;
  modelSelection?: AgentModelSelection;
  contextArtifactId?: string;
  references?: AgentAskInput["references"];
  locale?: string;
};

export type VoiceRoomStore = {
  postMessage(args: { roomId: string; channel: Channel; author: Actor; text: string; clientMsgId: string; kind?: "chat" | "agent" | "system" }): Promise<{ ok: boolean; reason?: string }>;
  askAgent(input: AgentAskInput): Promise<void>;
  askPrivateAgent(input: AgentAskInput, opts?: { publish?: boolean }): Promise<void>;
  cancelLongFreeJob(jobId: string): Promise<{ ok: boolean; reason?: string }>;
  lastLongFreeJob(): AgentJobTelemetry | null;
  activeLongFreeJobs?(): AgentJobTelemetry[];
};

export type VoiceNarrationUtterance = {
  id: string;
  text: string;
  priority: "low" | "normal" | "high";
  interrupt?: boolean;
  source: "room_event" | "job_event" | "proposal_event" | "voice_gateway";
};
