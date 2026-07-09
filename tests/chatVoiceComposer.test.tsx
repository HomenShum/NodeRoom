// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/engine/types";

const mockStore = vi.hoisted(() => ({ current: {} as any }));

vi.mock("convex/react", () => ({
  useQuery: () => null,
}));

vi.mock("../src/app/store", () => ({
  CONVEX_SITE_URL: "",
  useStore: () => mockStore.current,
}));

import { Chat } from "../src/ui/Chat";

const me: Actor = { kind: "user", id: "u1", name: "Maya" };
let recognition: MockSpeechRecognition | null = null;

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => { recognition = this; });
  stop = vi.fn(() => { this.onend?.(); });

  emit(text: string, isFinal = true, confidence = 0.94) {
    this.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal,
          length: 1,
          0: { transcript: text, confidence },
        },
      },
    });
  }
}

function installSpeechRecognitionMock() {
  recognition = null;
  Object.defineProperty(globalThis, "SpeechRecognition", { value: MockSpeechRecognition, configurable: true });
  Object.defineProperty(window, "SpeechRecognition", { value: MockSpeechRecognition, configurable: true });
  Object.defineProperty(globalThis, "webkitSpeechRecognition", { value: undefined, configurable: true });
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
    activeLongFreeJobs: () => [{ id: "job1", status: "running", attempts: 1, maxAttempts: 3, modelPolicy: "fast", updatedAt: 1 }],
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

describe("Chat composer voice input", () => {
  beforeEach(() => {
    installSpeechRecognitionMock();
    mockStore.current = baseStore();
  });

  it("routes a safe public voice transcript through visible chat plus askAgent", async () => {
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("chat-voice"));
    await waitFor(() => expect(recognition).not.toBeNull());
    act(() => recognition?.emit("ask nodeagent to summarize current diligence gaps"));

    await waitFor(() => expect(mockStore.current.postMessage).toHaveBeenCalledTimes(1));
    expect(mockStore.current.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: "public",
      text: "ask nodeagent to summarize current diligence gaps",
      kind: "chat",
    }));
    expect(mockStore.current.askAgent).toHaveBeenCalledWith(expect.objectContaining({
      goal: "summarize current diligence gaps",
      modelSelection: { mode: "adaptive" },
    }));
  });

  it("requires composer confirmation before dispatching a risky voice command", async () => {
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("chat-voice"));
    await waitFor(() => expect(recognition).not.toBeNull());
    act(() => recognition?.emit("nodeagent overwrite the company research sheet"));

    expect(await screen.findByTestId("chat-voice-confirm")).toBeTruthy();
    expect(mockStore.current.askAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("chat-voice-confirm-yes"));

    await waitFor(() => expect(mockStore.current.askAgent).toHaveBeenCalledTimes(1));
    expect(mockStore.current.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "nodeagent overwrite the company research sheet",
    }));
  });

  it("keeps private Room-lane voice on the personal agent publish path", async () => {
    render(<Chat roomId="r1" me={me} channel={{ private: me.id }} variant="private" agentName="Your NodeAgent" />);

    fireEvent.click(screen.getByTestId("lane-room"));
    fireEvent.click(screen.getByTestId("chat-voice"));
    await waitFor(() => expect(recognition).not.toBeNull());
    act(() => recognition?.emit("update the shared memo"));
    fireEvent.click(await screen.findByTestId("chat-voice-confirm-yes"));

    await waitFor(() => expect(mockStore.current.askPrivateAgent).toHaveBeenCalledTimes(1));
    expect(mockStore.current.askPrivateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ goal: "update the shared memo" }),
      { publish: true },
    );
  });
});
