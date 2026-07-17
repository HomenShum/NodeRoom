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

describe("Chat composer primitive polish", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mockStore.current = baseStore();
  });

  it("portals the picker outside clipping ancestors and restores focus on Escape", async () => {
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    const trigger = screen.getByTestId("chat-model-trigger");
    fireEvent.click(trigger);

    const popover = screen.getByTestId("chat-model-popover");
    expect(popover.closest(".r-model-picker")).toBeNull();
    expect(popover.closest("[data-radix-popper-content-wrapper]")).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("chat-model-popover")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("portals and searches governed work context, then restores composer focus", async () => {
    const store = baseStore();
    const artifact = {
      id: "sheet1",
      roomId: "r1",
      kind: "sheet",
      title: "Q3 variance",
      version: 1,
      order: ["deck_storyboard"],
      updatedAt: 1,
      elements: {
        deck_storyboard: { id: "deck_storyboard", type: "deck_storyboard", value: { slides: [{ slideId: "slide1", title: "Board readout" }] } },
      },
    };
    store.listArtifacts = () => [artifact];
    store.listProposals = () => [{ id: "proposal1", artifactId: "sheet1", status: "pending", op: { elementId: "revenue" } }];
    store.listTraces = () => [{ id: "trace1", type: "agent_run", summary: "Revenue repair", refs: { artifactId: "sheet1", elementId: "revenue" } }];
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);
    const composer = screen.getByTestId("chat-composer");
    composer.focus();
    fireEvent.click(screen.getByTestId("chat-context"));

    const picker = screen.getByTestId("chat-context-picker");
    expect(picker.closest(".r-composer")).toBeNull();
    expect(picker.closest("[data-radix-popper-content-wrapper]")).toBeTruthy();

    fireEvent.change(screen.getByTestId("chat-context-search"), { target: { value: "proposal" } });
    const options = await screen.findAllByTestId("chat-context-option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Proposal: revenue");
    fireEvent.click(options[0]);

    await waitFor(() => expect(screen.queryByTestId("chat-context-picker")).toBeNull());
    expect(screen.getByLabelText("Message references").textContent).toContain("Proposal: revenue");
    expect(document.activeElement).toBe(composer);
  });

  it("keeps @ typeahead keyboard-complete in a portaled Command surface", async () => {
    const store = baseStore();
    store.listArtifacts = () => [{
      id: "sheet1",
      roomId: "r1",
      kind: "sheet",
      title: "Q3 variance",
      version: 1,
      order: [],
      updatedAt: 1,
      elements: {},
    }];
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);
    const composer = screen.getByTestId("chat-composer") as HTMLTextAreaElement;
    composer.focus();
    fireEvent.change(composer, { target: { value: "@q3", selectionStart: 3 } });

    const menu = await screen.findByTestId("mention-menu");
    expect(menu.closest(".r-composer")).toBeNull();
    expect(composer.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(screen.queryByTestId("mention-menu")).toBeNull());
    expect(composer.value).toBe("");
    expect(screen.getByLabelText("Message references").textContent).toContain("Q3 variance");
    expect(document.activeElement).toBe(composer);
  });

  it("closes @ typeahead with Escape and keeps compatibility slash aliases hidden", async () => {
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);
    const composer = screen.getByTestId("chat-composer") as HTMLTextAreaElement;
    composer.focus();
    fireEvent.change(composer, { target: { value: "@", selectionStart: 1 } });
    expect(await screen.findByTestId("mention-menu")).toBeTruthy();
    fireEvent.keyDown(composer, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("mention-menu")).toBeNull());
    expect(document.activeElement).toBe(composer);

    fireEvent.change(composer, { target: { value: "/free inspect this workbook", selectionStart: 27 } });
    expect(screen.queryByRole("listbox", { name: "Commands" })).toBeNull();
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
