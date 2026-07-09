import type { SpeechToTextAdapter, TextToSpeechAdapter } from "../gateway";
import type { VoiceGatewayContext, VoiceNarrationUtterance, VoiceTranscriptChunk } from "../types";
import { synthesizeVoiceSpeech, transcribeVoiceBlob, type VoiceProviderClientConfig } from "./providerHttp";

type QueueController<T> = {
  iterable: AsyncIterable<T>;
  push(value: T): void;
  close(): void;
  fail(error: Error): void;
};

export class ConvexProviderSpeechToTextAdapter implements SpeechToTextAdapter {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private cancelled = false;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: VoiceProviderClientConfig,
    private readonly options: { maxMs?: number; mimeType?: string } = {},
  ) {}

  async start(context: VoiceGatewayContext & { sessionId: string; signal: AbortSignal }): Promise<AsyncIterable<VoiceTranscriptChunk>> {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) throw new Error("voice_provider_microphone_unavailable");
    if (typeof MediaRecorder === "undefined") throw new Error("voice_provider_media_recorder_unavailable");

    const queue = createQueue<VoiceTranscriptChunk>();
    const stream = await mediaDevices.getUserMedia({ audio: true });
    const mimeType = this.options.mimeType ?? preferredRecordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];

    this.cancelled = false;
    this.stream = stream;
    this.recorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      queue.fail(new Error("voice_provider_recording_failed"));
      this.cleanup();
    };
    recorder.onstop = () => {
      const shouldTranscribe = !this.cancelled && !context.signal.aborted;
      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      this.cleanup();
      if (!shouldTranscribe) {
        queue.close();
        return;
      }
      void transcribeVoiceBlob({
        ...this.config,
        audio,
        locale: context.locale,
        fileName: `voice-${context.sessionId}.webm`,
      })
        .then((result) => {
          queue.push({
            id: `provider-speech-${Date.now()}`,
            sessionId: context.sessionId,
            text: result.text,
            isFinal: true,
            confidence: 1,
            locale: context.locale,
          });
          queue.close();
        })
        .catch((error) => queue.fail(error instanceof Error ? error : new Error(String(error))));
    };

    context.signal.addEventListener("abort", () => {
      this.cancelled = true;
      this.stopRecorder();
    }, { once: true });

    recorder.start();
    if (this.options.maxMs && this.options.maxMs > 0) {
      this.stopTimer = setTimeout(() => this.stopRecorder(), this.options.maxMs);
    }

    return queue.iterable;
  }

  stop(): void {
    this.stopRecorder();
  }

  cancel(): void {
    this.cancelled = true;
    this.stopRecorder();
  }

  private stopRecorder(): void {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    else this.cleanup();
  }

  private cleanup(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}

export function isProviderSpeechRecordingAvailable(): boolean {
  return Boolean(globalThis.navigator?.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

export class ConvexProviderTextToSpeechAdapter implements TextToSpeechAdapter {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  constructor(
    private readonly config: VoiceProviderClientConfig,
    private readonly options: { voice?: string } = {},
  ) {}

  async speak(utterance: VoiceNarrationUtterance): Promise<void> {
    if (utterance.interrupt) this.stop();
    const audioBlob = await synthesizeVoiceSpeech({ ...this.config, utterance, voice: this.options.voice });
    this.stop();
    const objectUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(objectUrl);
    this.audio = audio;
    this.objectUrl = objectUrl;
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("voice_provider_audio_playback_failed"));
      void audio.play().catch(reject);
    });
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
    }
    this.audio = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

function preferredRecordingMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function createQueue<T>(): QueueController<T> {
  const queue: T[] = [];
  const waiters: Array<(value: IteratorResult<T>) => void> = [];
  let closed = false;
  let failed: Error | null = null;

  const close = () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined });
  };

  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<T>> {
            if (failed) return Promise.reject(failed);
            const item = queue.shift();
            if (item) return Promise.resolve({ done: false, value: item });
            if (closed) return Promise.resolve({ done: true, value: undefined });
            return new Promise((resolve) => waiters.push(resolve));
          },
          return(): Promise<IteratorResult<T>> {
            close();
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
    push(value: T) {
      const waiter = waiters.shift();
      if (waiter) waiter({ done: false, value });
      else queue.push(value);
    },
    close,
    fail(error: Error) {
      failed = error;
      close();
    },
  };
}
