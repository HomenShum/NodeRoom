// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("Chat model picker polish", () => {
  beforeEach(() => {
    mockStore.current = baseStore();
  });

  it("offers a searchable model picker and sends the selected specific model", async () => {
    const store = baseStore();
    mockStore.current = store;
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("chat-model-trigger"));
    expect(screen.getByTestId("chat-model-popover")).toBeTruthy();
    expect(screen.getByTestId("chat-model-preset-free").textContent).toContain("$0");
    expect(screen.getByTestId("chat-model-preset-free").textContent).toContain("resolved model");

    fireEvent.change(screen.getByTestId("chat-model-search"), { target: { value: "claude sonnet" } });
    fireEvent.click(await screen.findByTestId("chat-model-option-claude-sonnet-4-6"));

    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "@nodeagent review the latest CardioNova diligence notes" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(store.askAgent).toHaveBeenCalledWith(expect.objectContaining({
        goal: "review the latest CardioNova diligence notes",
        modelSelection: { mode: "specific", modelPolicy: "claude-sonnet-4-6" },
      }));
    });
  });

  it("keeps legacy value-bearing controls for existing proof scripts", async () => {
    const store = baseStore();
    mockStore.current = store;
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.getByTestId("chat-model-preset").getAttribute("data-compat-only")).toBe("legacy-proof-hook");
    expect(screen.getByTestId("chat-model-specific").getAttribute("data-compat-only")).toBe("legacy-proof-hook");

    fireEvent.change(screen.getByTestId("chat-model-preset"), { target: { value: "specific" } });
    fireEvent.change(screen.getByTestId("chat-model-specific"), { target: { value: "claude-sonnet-4.6" } });
    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "@nodeagent review the latest CardioNova diligence notes" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(store.askAgent).toHaveBeenCalledWith(expect.objectContaining({
        modelSelection: { mode: "specific", modelPolicy: "claude-sonnet-4.6" },
      }));
    });
  });

  it("shows actionable model failure recovery and retries through the free route", async () => {
    const store = baseStore();
    store.askAgent = vi.fn()
      .mockRejectedValueOnce(new Error("model_not_found: claude-sonnet-4-6"))
      .mockResolvedValueOnce(undefined);
    mockStore.current = store;
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("chat-model-trigger"));
    fireEvent.change(screen.getByTestId("chat-model-search"), { target: { value: "claude sonnet" } });
    fireEvent.click(await screen.findByTestId("chat-model-option-claude-sonnet-4-6"));
    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "@nodeagent review the latest CardioNova diligence notes" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    const failure = await screen.findByTestId("agent-error");
    expect(failure.textContent).toContain("Model unavailable");
    expect(failure.textContent).toContain("claude-sonnet-4-6");

    fireEvent.click(screen.getByTestId("agent-error-use-free"));

    await waitFor(() => expect(store.askAgent).toHaveBeenCalledTimes(2));
    expect(store.askAgent).toHaveBeenLastCalledWith(expect.objectContaining({
      goal: "review the latest CardioNova diligence notes",
      modelSelection: { mode: "free" },
    }));
  });

  it("keeps private-agent failures actionable without unsupported route switches", async () => {
    const store = baseStore();
    store.askPrivateAgent = vi.fn().mockRejectedValue(new Error("upstream timeout"));
    mockStore.current = store;
    render(<Chat roomId="r1" me={me} channel={{ private: me.id }} variant="private" agentName="Your NodeAgent" />);

    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "summarize the room privately" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    const failure = await screen.findByTestId("agent-error");
    expect(failure.textContent).toContain("Timeout");
    expect(screen.getByTestId("agent-error-retry")).toBeTruthy();
    expect(screen.getByTestId("agent-error-copy")).toBeTruthy();
    expect(screen.queryByTestId("agent-error-use-free")).toBeNull();
    expect(screen.queryByTestId("agent-error-use-adaptive")).toBeNull();
  });
});
