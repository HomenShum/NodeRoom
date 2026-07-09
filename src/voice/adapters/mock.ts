import type { SpeechToTextAdapter, TextToSpeechAdapter } from "../gateway";
import type { VoiceGatewayContext, VoiceNarrationUtterance, VoiceTranscriptChunk } from "../types";

export class MockSpeechToTextAdapter implements SpeechToTextAdapter {
  private stopped = false;

  constructor(private readonly chunks: VoiceTranscriptChunk[] = []) {}

  async *start(context: VoiceGatewayContext & { sessionId: string; signal: AbortSignal }): AsyncIterable<VoiceTranscriptChunk> {
    this.stopped = false;
    for (const chunk of this.chunks) {
      if (this.stopped || context.signal.aborted) return;
      yield { ...chunk, sessionId: chunk.sessionId || context.sessionId };
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

export class RecordingTextToSpeechAdapter implements TextToSpeechAdapter {
  readonly utterances: VoiceNarrationUtterance[] = [];
  stoppedCount = 0;

  async speak(utterance: VoiceNarrationUtterance): Promise<void> {
    this.utterances.push(utterance);
  }

  stop(): void {
    this.stoppedCount += 1;
  }
}
