import type {
  RoomCommand,
  RoomCommandEvent,
  RoomCommandState,
  VoiceSessionEvent,
  VoiceSessionState,
} from "./types";

export function initialVoiceSessionState(sessionId: string, now: number = Date.now()): VoiceSessionState {
  return {
    sessionId,
    status: "idle",
    updatedAt: now,
  };
}

export function reduceVoiceSession(state: VoiceSessionState, event: VoiceSessionEvent): VoiceSessionState {
  switch (event.type) {
    case "START_LISTENING":
      return { ...state, status: "listening", startedAt: state.startedAt ?? event.now, updatedAt: event.now, lastError: undefined };
    case "PARTIAL_TRANSCRIPT":
      return {
        ...state,
        status: "transcribing",
        activeTurnId: event.chunk.id,
        partialTranscript: event.chunk.text,
        updatedAt: event.now,
      };
    case "FINAL_TRANSCRIPT":
      return {
        ...state,
        status: event.command?.requiresConfirmation && !event.command.confirmed ? "awaiting_confirmation" : "dispatching",
        activeTurnId: event.turn.id,
        partialTranscript: undefined,
        pendingCommand: event.command?.requiresConfirmation && !event.command.confirmed ? event.command : state.pendingCommand,
        lastCommand: event.command ?? state.lastCommand,
        updatedAt: event.now,
      };
    case "AWAIT_CONFIRMATION":
      return { ...state, status: "awaiting_confirmation", pendingCommand: event.command, lastCommand: event.command, updatedAt: event.now };
    case "CONFIRM":
      return { ...state, status: "dispatching", pendingCommand: undefined, lastCommand: event.command, updatedAt: event.now };
    case "DISPATCH_START":
      return { ...state, status: "dispatching", lastCommand: event.command, updatedAt: event.now };
    case "DISPATCH_DONE":
      return { ...state, status: "speaking", lastCommand: event.command, updatedAt: event.now };
    case "SPEAK_START":
      return { ...state, status: "speaking", updatedAt: event.now };
    case "SPEAK_DONE":
      return { ...state, status: "listening", updatedAt: event.now };
    case "INTERRUPT":
      return { ...state, status: "interrupted", partialTranscript: undefined, updatedAt: event.now };
    case "CANCEL":
      return { ...state, status: "cancelled", pendingCommand: undefined, partialTranscript: undefined, updatedAt: event.now };
    case "FAIL":
      return { ...state, status: "failed", lastError: event.error, updatedAt: event.now };
    case "RESET":
      return initialVoiceSessionState(state.sessionId, event.now);
  }
}

export function initialRoomCommandState(command: RoomCommand): RoomCommandState {
  return {
    command,
    status: command.status,
    updatedAt: command.createdAt,
  };
}

export function reduceRoomCommandState(state: RoomCommandState, event: RoomCommandEvent): RoomCommandState {
  switch (event.type) {
    case "CLASSIFIED":
      return withCommandStatus(state, "classified", event.now);
    case "REQUIRES_CONFIRMATION":
      return withCommandStatus(state, "awaiting_confirmation", event.now);
    case "CONFIRMED":
      return {
        ...withCommandStatus(state, "classified", event.now),
        command: { ...state.command, confirmed: true, requiresConfirmation: false },
        failureReason: undefined,
      };
    case "REJECTED":
      return withCommandStatus(state, "cancelled", event.now);
    case "DISPATCH_START":
      return withCommandStatus(state, "dispatching", event.now);
    case "DISPATCH_OK":
      return withCommandStatus(state, "completed", event.now);
    case "DISPATCH_FAILED":
      return { ...withCommandStatus(state, "failed", event.now), failureReason: event.reason };
    case "CANCELLED":
      return withCommandStatus(state, "cancelled", event.now);
  }
}

function withCommandStatus(state: RoomCommandState, status: RoomCommandState["status"], updatedAt: number): RoomCommandState {
  return {
    ...state,
    status,
    command: { ...state.command, status },
    updatedAt,
  };
}
