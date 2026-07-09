// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/engine/types";

const mockStore = vi.hoisted(() => ({ current: {} as any }));

vi.mock("convex/react", () => ({
  useQuery: () => null,
}));

vi.mock("../src/app/store", () => ({
  CONVEX_SITE_URL: "https://example.convex.site",
  useStore: () => mockStore.current,
}));

import { Chat } from "../src/ui/Chat";

const me: Actor = { kind: "user", id: "u1", name: "Maya" };
let recognition: MockSpeechRecognition | null = null;
let recorder: MockMediaRecorder | null = null;
type VoicePolicyGlobal = typeof globalThis & {
  __NODEROOM_VOICE_CLIENT_POLICY_ENV__?: Record<string, string | undefined>;
};

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => { recognition = this; });
  stop = vi.fn(() => { this.onend?.(); });
}

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    recorder = this;
  }

  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob(["provider-audio"], { type: this.mimeType }) });
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

function installSpeechRecognitionMock() {
  recognition = null;
  Object.defineProperty(globalThis, "SpeechRecognition", { value: MockSpeechRecognition, configurable: true });
  Object.defineProperty(window, "SpeechRecognition", { value: MockSpeechRecognition, configurable: true });
  Object.defineProperty(globalThis, "webkitSpeechRecognition", { value: undefined, configurable: true });
}

function installProviderMicMock() {
  recorder = null;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    configurable: true,
  });
  Object.defineProperty(globalThis, "MediaRecorder", { value: MockMediaRecorder, configurable: true });
  Object.defineProperty(window, "MediaRecorder", { value: MockMediaRecorder, configurable: true });
  globalThis.fetch = vi.fn<typeof fetch>(async () => Response.json({
    text: "ask nodeagent to summarize current diligence gaps",
    model: "local-provider-proof",
    durationMs: 10,
  }));
}

function baseStore(): any {
  return {
    mode: "convex",
    listMessages: () => [],
    actorProof: () => ({ actor: me, token: "test-token-with-sufficient-entropy-1234567890" }),
    privateStreamAccess: () => null,
    listMembers: () => [{ id: "u1", roomId: "r1", name: "Maya", role: "host", anon: false, color: "#111111", lastSeenAt: 1 }],
    listArtifacts: () => [],
    getArtifact: () => undefined,
    listProposals: () => [],
    awareness: () => ({ activeLocks: [] }),
    lastRun: () => null,
    lastLongFreeJob: () => null,
    activeLongFreeJobs: () => [],
    lastLongFreeJobAttempts: () => [],
    lastLongFreeJobDetail: () => null,
    okfTraceLens: () => null,
    postMessage: vi.fn(async () => ({ ok: true })),
    askAgent: vi.fn(async () => undefined),
    askPrivateAgent: vi.fn(async () => undefined),
    cancelLongFreeJob: vi.fn(async () => ({ ok: true })),
    retryLongFreeJob: vi.fn(async () => ({ ok: true })),
    uploadArtifact: vi.fn(async () => "artifact1"),
  };
}

describe("Chat composer provider microphone path", () => {
  beforeEach(() => {
    delete (globalThis as VoicePolicyGlobal).__NODEROOM_VOICE_CLIENT_POLICY_ENV__;
    installSpeechRecognitionMock();
    installProviderMicMock();
    mockStore.current = baseStore();
  });

  afterEach(() => {
    delete (globalThis as VoicePolicyGlobal).__NODEROOM_VOICE_CLIENT_POLICY_ENV__;
  });

  it("uses getUserMedia plus provider transcription before browser SpeechRecognition", async () => {
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("chat-voice"));
    await waitFor(() => expect(recorder).not.toBeNull());
    expect(recognition).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("chat-voice"));
    });

    await waitFor(() => expect(mockStore.current.postMessage).toHaveBeenCalledTimes(1));
    expect(globalThis.fetch).toHaveBeenCalledWith("https://example.convex.site/voice/transcribe", expect.objectContaining({ method: "POST" }));
    expect(mockStore.current.askAgent).toHaveBeenCalledWith(expect.objectContaining({
      goal: "summarize current diligence gaps",
      modelSelection: { mode: "adaptive" },
    }));
  });

  it("honors browser-first voice STT provider order when configured", async () => {
    (globalThis as VoicePolicyGlobal).__NODEROOM_VOICE_CLIENT_POLICY_ENV__ = {
      VITE_VOICE_STT_PROVIDER_ORDER: "browser,provider",
    };

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("chat-voice"));
    await waitFor(() => expect(recognition).not.toBeNull());
    expect(recorder).toBeNull();

    fireEvent.click(screen.getByTestId("chat-voice"));
  });
});
