import { classifyVoiceTranscript, confirmCommand } from "./commandClassifier";
import { initialVoiceSessionState, reduceVoiceSession } from "./stateMachines";
import type {
  RoomCommand,
  VoiceDispatchResult,
  VoiceGatewayContext,
  VoiceNarrationUtterance,
  VoiceSessionState,
  VoiceTranscriptChunk,
  VoiceTurn,
} from "./types";

export type SpeechToTextAdapter = {
  start(context: VoiceGatewayContext & { sessionId: string; signal: AbortSignal }): AsyncIterable<VoiceTranscriptChunk> | Promise<AsyncIterable<VoiceTranscriptChunk>>;
  stop?(): void | Promise<void>;
};

export type TextToSpeechAdapter = {
  speak(utterance: VoiceNarrationUtterance): Promise<void>;
  stop(): void;
};

export type VoiceCommandRouter = {
  dispatch(command: RoomCommand): Promise<VoiceDispatchResult>;
};

export type VoiceGatewayOptions = {
  sessionId?: string;
  now?: () => number;
  makeId?: () => string;
  onState?: (state: VoiceSessionState) => void;
  onCommand?: (command: RoomCommand) => void;
};

export class VoiceGateway {
  private stateValue: VoiceSessionState;
  private abortController: AbortController | null = null;
  private readonly now: () => number;
  private readonly makeId: () => string;

  constructor(
    private readonly stt: SpeechToTextAdapter,
    private readonly tts: TextToSpeechAdapter,
    private readonly router: VoiceCommandRouter,
    private readonly options: VoiceGatewayOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.makeId = options.makeId ?? (() => crypto.randomUUID());
    this.stateValue = initialVoiceSessionState(options.sessionId ?? `voice-session-${this.makeId()}`, this.now());
  }

  get state(): VoiceSessionState {
    return this.stateValue;
  }

  async start(context: VoiceGatewayContext): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.commit({ type: "START_LISTENING", now: this.now() });
    try {
      const stream = await this.stt.start({ ...context, sessionId: this.state.sessionId, signal: this.abortController.signal });
      for await (const chunk of stream) {
        if (this.abortController.signal.aborted) break;
        await this.acceptTranscriptChunk(context, chunk);
      }
    } catch (error) {
      if (!this.abortController.signal.aborted) this.fail(error);
    }
  }

  async submitTranscript(context: VoiceGatewayContext, transcript: string, confidence?: number): Promise<VoiceDispatchResult | null> {
    const now = this.now();
    const turn: VoiceTurn = {
      id: `voice-turn-${this.makeId()}`,
      sessionId: this.state.sessionId,
      transcript,
      confidence,
      startedAt: now,
      endedAt: now,
      locale: context.locale,
    };
    return this.acceptFinalTurn(context, turn);
  }

  async interrupt(cancelActiveJob = false, context?: VoiceGatewayContext): Promise<VoiceDispatchResult | null> {
    this.abortController?.abort();
    await this.stt.stop?.();
    this.tts.stop();
    this.commit({ type: "INTERRUPT", now: this.now() });
    if (!cancelActiveJob || !context) return null;
    return this.submitTranscript(context, "cancel the active job");
  }

  async speak(utterance: VoiceNarrationUtterance): Promise<void> {
    this.commit({ type: "SPEAK_START", now: this.now() });
    try {
      await this.tts.speak(utterance);
      this.commit({ type: "SPEAK_DONE", now: this.now() });
    } catch (error) {
      this.fail(error);
    }
  }

  reset(): void {
    this.abortController?.abort();
    this.tts.stop();
    this.commit({ type: "RESET", now: this.now() });
  }

  private async acceptTranscriptChunk(context: VoiceGatewayContext, chunk: VoiceTranscriptChunk): Promise<VoiceDispatchResult | null> {
    if (!chunk.isFinal) {
      this.commit({ type: "PARTIAL_TRANSCRIPT", chunk, now: this.now() });
      return null;
    }
    const now = this.now();
    const turn: VoiceTurn = {
      id: chunk.id,
      sessionId: chunk.sessionId,
      transcript: chunk.text,
      confidence: chunk.confidence,
      startedAt: chunk.startedAt ?? now,
      endedAt: chunk.endedAt ?? now,
      locale: chunk.locale,
    };
    return this.acceptFinalTurn(context, turn);
  }

  private async acceptFinalTurn(context: VoiceGatewayContext, turn: VoiceTurn): Promise<VoiceDispatchResult | null> {
    const command = classifyVoiceTranscript({
      roomId: context.roomId,
      actor: context.actor,
      channel: context.channel,
      transcript: turn.transcript,
      turn,
      privateMode: context.privateMode,
      publishPrivateToRoom: context.publishPrivateToRoom,
      modelSelection: context.modelSelection,
      contextArtifactId: context.contextArtifactId,
      references: context.references,
      now: this.now(),
    });
    this.options.onCommand?.(command);

    if (command.kind === "confirm_pending_command") {
      return this.dispatchConfirmedPending();
    }
    if (command.kind === "reject_pending_command") {
      this.commit({ type: "CANCEL", now: this.now() });
      return { ok: false, kind: "rejected", reason: "voice_command_rejected" };
    }
    if (command.requiresConfirmation && !command.confirmed) {
      this.commit({ type: "AWAIT_CONFIRMATION", command, now: this.now() });
      await this.speak({
        id: `voice-confirm-${command.id}`,
        text: command.confirmationPrompt ?? "Please confirm that voice command.",
        priority: "high",
        source: "voice_gateway",
      });
      return { ok: false, kind: "confirmation_required", reason: command.confirmationPrompt ?? "confirmation_required" };
    }

    this.commit({ type: "FINAL_TRANSCRIPT", turn, command, now: this.now() });
    return this.dispatch(command);
  }

  private async dispatchConfirmedPending(): Promise<VoiceDispatchResult | null> {
    const pending = this.state.pendingCommand;
    if (!pending) return { ok: false, kind: "failed", reason: "confirm_without_pending_command" };
    const command = confirmCommand(pending);
    this.commit({ type: "CONFIRM", command, now: this.now() });
    return this.dispatch(command);
  }

  private async dispatch(command: RoomCommand): Promise<VoiceDispatchResult> {
    this.commit({ type: "DISPATCH_START", command, now: this.now() });
    const result = await this.router.dispatch(command);
    if (result.ok) this.commit({ type: "DISPATCH_DONE", command, now: this.now() });
    else this.commit({ type: "FAIL", error: result.reason, now: this.now() });
    return result;
  }

  private fail(error: unknown): void {
    this.commit({ type: "FAIL", error: error instanceof Error ? error.message : String(error), now: this.now() });
  }

  private commit(event: Parameters<typeof reduceVoiceSession>[1]): void {
    this.stateValue = reduceVoiceSession(this.stateValue, event);
    this.options.onState?.(this.stateValue);
  }
}
