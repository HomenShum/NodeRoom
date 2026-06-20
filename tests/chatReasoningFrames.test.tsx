// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    privateStreamAccess: () => null,
    listMembers: () => [{ id: "u1", roomId: "r1", name: "Maya", role: "host", anon: false, color: "#111111", lastSeenAt: 1 }],
    listArtifacts: () => [],
    listProposals: () => [],
    lastRun: () => null,
    lastLongFreeJob: () => ({
      id: "job1",
      status: "queued",
      entrypoint: "room_work",
      runtime: "workflow",
      attempts: 0,
      maxAttempts: 20,
      modelPolicy: "openrouter/free-auto",
      approvalPolicy: "draft_first",
      evidencePolicy: "public_only",
      actionSliceCount: 0,
      queryCount: 2,
      mutationCount: 3,
      modelCallCount: 0,
      toolCallCount: 0,
      schedulerHandoffCount: 1,
      receiptCount: 0,
      updatedAt: 1,
    }),
    lastLongFreeJobAttempts: () => [],
    lastLongFreeJobDetail: () => ({
      operations: [],
      receipts: [],
      leases: [],
      draftOperations: [],
      latestSteps: [],
      reasoningFrames: [
        {
          frameId: "rf_intake",
          sequence: 1,
          frameKind: "phase" as const,
          phase: "intake",
          status: "completed",
          goal: "Parse request",
          toolAllowlist: ["normalize_room_intake"],
        },
        {
          frameId: "rf_execute",
          sequence: 3,
          frameKind: "phase" as const,
          phase: "execute",
          status: "pending",
          goal: "Execute child work",
          toolAllowlist: ["fetch_source", "write_locked_cell_results"],
        },
        {
          frameId: "rf_child_funding",
          parentFrameId: "rf_execute",
          sequence: 6,
          frameKind: "child" as const,
          phase: "execute",
          status: "pending",
          goal: "Resolve funding for CardioNova",
          displayName: "CardioNova",
          facet: "funding",
          cachePolicy: "missing_research_now",
          cacheKey: "entityResearchCache:company:cardionova:funding",
          toolAllowlist: ["fetch_source", "source_compare_claim"],
        },
      ],
    }),
    cancelLongFreeJob: vi.fn(),
    retryLongFreeJob: vi.fn(),
    postMessage: vi.fn(async () => ({ ok: true })),
    askAgent: vi.fn(async () => undefined),
    startLongFreeAgent: vi.fn(async () => undefined),
    runAgent: vi.fn(),
    startPrivateAgent: vi.fn(),
    uploadSourceFile: vi.fn(),
  };
}

describe("Chat reasoning-frame job detail", () => {
  beforeEach(() => {
    mockStore.current = baseStore();
  });

  it("renders durable reasoning frames from the long-running job detail drawer", () => {
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByTestId("reasoning-frame-tree")).toBeTruthy();
    expect(screen.getByText("Reasoning frames")).toBeTruthy();
    expect(screen.getByText("intake")).toBeTruthy();
    expect(screen.getByText("execute")).toBeTruthy();
    expect(screen.getByText("CardioNova / funding")).toBeTruthy();
    expect(screen.getByText(/missing_research_now/)).toBeTruthy();
  });

  it("passes the selected specific model through the public @nodeagent composer", async () => {
    const store = baseStore();
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.change(screen.getByTestId("chat-model-preset"), { target: { value: "specific" } });
    fireEvent.change(screen.getByTestId("chat-model-specific"), { target: { value: "claude-sonnet-4.6" } });
    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "@nodeagent review the latest CardioNova diligence notes" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(store.askAgent).toHaveBeenCalledWith(expect.objectContaining({
        goal: "review the latest CardioNova diligence notes",
        modelSelection: { mode: "specific", modelPolicy: "claude-sonnet-4.6" },
      }));
    });
  });

  it("keeps /free as a hidden compatibility alias for the central free route", async () => {
    const store = baseStore();
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "/free review the latest CardioNova diligence notes" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(store.askAgent).toHaveBeenCalledWith(expect.objectContaining({
        goal: "review the latest CardioNova diligence notes",
        modelSelection: { mode: "free" },
      }));
    });
    expect(store.startLongFreeAgent).not.toHaveBeenCalled();
  });

  it("starts the room agent from the empty public chat CTA when the demo sheet is seeded", async () => {
    const store = baseStore();
    store.lastLongFreeJob = () => null;
    store.listArtifacts = () => [{ id: "sheet1", roomId: "r1", kind: "sheet", title: "Q3 variance", version: 1, order: [], updatedAt: 1, elements: {} }];
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("chat-empty-agent-cta"));

    await waitFor(() => {
      expect(store.askAgent).toHaveBeenCalledWith(expect.objectContaining({
        goal: "diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps",
      }));
    });
    expect(store.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("@nodeagent diligence CardioNova"),
    }));
  });

  it("renders durable agent job finalText in the chat when no agent message was posted", () => {
    const store = baseStore();
    store.lastLongFreeJob = () => ({
      id: "job1",
      status: "completed",
      entrypoint: "public_ask",
      runtime: "workflow",
      attempts: 1,
      maxAttempts: 20,
      modelPolicy: "gemini-3.5-flash",
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      finalText: "Done from the durable job row.",
      updatedAt: 1,
    });
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.getByTestId("agent-job-result")).toBeTruthy();
    expect(screen.getByText("Done from the durable job row.")).toBeTruthy();
    expect(screen.queryByTestId("public-chat-empty")).toBeNull();
  });
});
