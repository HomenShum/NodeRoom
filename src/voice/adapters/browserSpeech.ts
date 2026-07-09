import type { SpeechToTextAdapter, TextToSpeechAdapter } from "../gateway";
import type { VoiceGatewayContext, VoiceNarrationUtterance, VoiceTranscriptChunk } from "../types";

type SpeechRecognitionAlternativeLike = { transcript: string; confidence?: number };
type SpeechRecognitionResultLike = { isFinal: boolean; length: number; [index: number]: SpeechRecognitionAlternativeLike };
type SpeechRecognitionResultListLike = { length: number; [index: number]: SpeechRecognitionResultLike };
type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechRecognitionResultListLike };
type SpeechRecognitionErrorEventLike = { error?: string; message?: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionGlobal = typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export class BrowserSpeechToTextAdapter implements SpeechToTextAdapter {
  private recognition: SpeechRecognitionLike | null = null;

  start(context: VoiceGatewayContext & { sessionId: string; signal: AbortSignal }): AsyncIterable<VoiceTranscriptChunk> {
    const ctor = browserSpeechRecognitionConstructor();
    if (!ctor) throw new Error("browser_speech_recognition_unavailable");
    const recognition = new ctor();
    this.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = context.locale ?? "en-US";
    return speechRecognitionIterable(recognition, context);
  }

  stop(): void {
    this.recognition?.stop();
    this.recognition = null;
  }
}

export function isBrowserSpeechRecognitionAvailable(): boolean {
  return browserSpeechRecognitionConstructor() != null;
}

export function isBrowserSpeechSynthesisAvailable(): boolean {
  return typeof globalThis.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

export class BrowserSpeechSynthesisAdapter implements TextToSpeechAdapter {
  async speak(utterance: VoiceNarrationUtterance): Promise<void> {
    const synth = globalThis.speechSynthesis;
    if (!isBrowserSpeechSynthesisAvailable() || !synth) throw new Error("browser_speech_synthesis_unavailable");
    if (utterance.interrupt) synth.cancel();
    await new Promise<void>((resolve, reject) => {
      const item = new SpeechSynthesisUtterance(utterance.text);
      item.onend = () => resolve();
      item.onerror = () => reject(new Error("speech_synthesis_failed"));
      synth.speak(item);
    });
  }

  stop(): void {
    globalThis.speechSynthesis?.cancel();
  }
}

function browserSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const speechGlobal = globalThis as SpeechRecognitionGlobal;
  return speechGlobal.SpeechRecognition ?? speechGlobal.webkitSpeechRecognition ?? null;
}

function speechRecognitionIterable(
  recognition: SpeechRecognitionLike,
  context: VoiceGatewayContext & { sessionId: string; signal: AbortSignal },
): AsyncIterable<VoiceTranscriptChunk> {
  const queue: VoiceTranscriptChunk[] = [];
  const waiters: Array<(value: IteratorResult<VoiceTranscriptChunk>) => void> = [];
  let closed = false;
  let failed: Error | null = null;

  const push = (chunk: VoiceTranscriptChunk) => {
    const waiter = waiters.shift();
    if (waiter) waiter({ done: false, value: chunk });
    else queue.push(chunk);
  };
  const close = () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined });
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const alternative = result[0];
      if (!alternative?.transcript) continue;
      push({
        id: `speech-${Date.now()}-${i}`,
        sessionId: context.sessionId,
        text: alternative.transcript,
        isFinal: result.isFinal,
        confidence: alternative.confidence,
        locale: context.locale,
      });
    }
  };
  recognition.onerror = (event) => {
    failed = new Error(event.message || event.error || "speech_recognition_failed");
    close();
  };
  recognition.onend = close;
  context.signal.addEventListener("abort", () => {
    recognition.stop();
    close();
  }, { once: true });
  recognition.start();

  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<VoiceTranscriptChunk>> {
          if (failed) return Promise.reject(failed);
          const chunk = queue.shift();
          if (chunk) return Promise.resolve({ done: false, value: chunk });
          if (closed) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolve) => waiters.push(resolve));
        },
        return(): Promise<IteratorResult<VoiceTranscriptChunk>> {
          recognition.stop();
          close();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}
