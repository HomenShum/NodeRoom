// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
      operations: [
        { sequence: 1, kind: "mutation", name: "agentJobs.start", status: "completed", countDelta: 1 },
        { sequence: 2, kind: "scheduler", name: "agentWorkflows.freeAutoWorkflow", status: "completed", countDelta: 1 },
      ],
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

  it("shows early durable job operations while the public agent is queued", () => {
    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.getByTestId("agent-operation-stream")).toBeTruthy();
    expect(screen.getByText(/mutation: agentJobs.start/)).toBeTruthy();
    expect(screen.getByText(/scheduler: agentWorkflows.freeAutoWorkflow/)).toBeTruthy();
    expect(screen.queryByTestId("public-chat-empty")).toBeNull();
  });

  it("renders the active public job as one unified text plus tool stream", () => {
    const store = baseStore();
    store.lastLongFreeJob = () => ({
      id: "job1",
      status: "running",
      entrypoint: "public_ask",
      runtime: "workflow",
      attempts: 1,
      maxAttempts: 20,
      modelPolicy: "z-ai/glm-5.2",
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      updatedAt: 2000,
    });
    store.listMessages = () => [{
      id: "stream-msg",
      roomId: "r1",
      channel: "public",
      author: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" },
      text: "",
      clientMsgId: "pubstream-job1",
      kind: "agent",
      streamId: "stream-1",
      createdAt: 1000,
    }];
    store.lastLongFreeJobDetail = () => ({
      operations: [],
      reasoningFrames: [],
      receipts: [],
      leases: [],
      draftOperations: [],
      latestSteps: [],
      streamEvents: [],
      streamParts: [
        { type: "text" as const, text: "Calculating now. | Row | Q2 | Q3 | Variance % | |---|---:|---:|---:| | Revenue | $10,000 | $12,400 | +24% |", state: "streaming" as const },
        { type: "tool-write_locked_cells" as const, toolName: "write_locked_cells", toolCallId: "call-write", state: "call" as const, status: "started" as const, input: { ops: 10 } },
      ],
    });
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.getByTestId("agent-unified-stream")).toBeTruthy();
    expect(screen.getByTestId("agent-progress-card")).toBeTruthy();
    expect(screen.getByText("Updated Sheet 1")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Variance %" })).toBeTruthy();
    expect(screen.queryByText("write_locked_cells")).toBeNull();
    fireEvent.click(screen.getByTestId("agent-progress-details-toggle"));
    expect(screen.getByText("write_locked_cells")).toBeTruthy();
    fireEvent.click(screen.getByText("write_locked_cells"));
    expect(screen.getByText(/"ops": 10/)).toBeTruthy();
    expect(screen.queryByTestId("agent-operation-stream")).toBeNull();
  });

  it("passes the selected specific model through the public @nodeagent composer", async () => {
    const store = baseStore();
    store.lastLongFreeJob = () => null; // send path: with no active job the composer shows Send, not the #4 Stop swap
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
    store.lastLongFreeJob = () => null; // send path: with no active job the composer shows Send, not the #4 Stop swap
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
    expect(screen.queryByTestId("job-status")).toBeNull();
    expect(screen.queryByTestId("public-chat-empty")).toBeNull();
  });

  it("labels completed agent progress as complete even when step-start markers remain started", () => {
    const store = baseStore();
    store.lastLongFreeJob = () => ({
      id: "job1",
      status: "completed",
      entrypoint: "public_ask",
      runtime: "workflow",
      attempts: 1,
      maxAttempts: 1000,
      modelPolicy: "z-ai/glm-5.2",
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      finalText: "Room artifact count: 1.",
      updatedAt: 1,
    });
    store.lastLongFreeJobDetail = () => ({
      operations: [],
      reasoningFrames: [],
      receipts: [],
      leases: [],
      draftOperations: [],
      latestSteps: [],
      streamEvents: [],
      streamParts: [
        { type: "step-start" as const, title: "Model turn 1", step: 0, state: "started" as const },
        { type: "tool-list_artifacts" as const, toolName: "list_artifacts", toolCallId: "call-list", state: "output-available" as const, status: "completed" as const, output: [{ id: "sheet1", title: "Sheet 1" }] },
        { type: "tool-say" as const, toolName: "say", toolCallId: "call-say", state: "output-available" as const, status: "completed" as const, output: { ok: true } },
        { type: "text" as const, text: "Room artifact count: 1.", state: "done" as const },
      ],
    });
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.getByText("NodeAgent completed the run")).toBeTruthy();
    expect(screen.queryByText("NodeAgent is working")).toBeNull();
  });

  it("labels completed jobs with recovered tool errors as recovered instead of needing attention", () => {
    const store = baseStore();
    store.lastLongFreeJob = () => ({
      id: "job1",
      status: "completed",
      entrypoint: "public_ask",
      runtime: "workflow",
      attempts: 1,
      maxAttempts: 1000,
      modelPolicy: "qwen/qwen3.7-plus",
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      finalText: "BTB task complete. Deliverable package created.",
      updatedAt: 1,
    });
    store.lastLongFreeJobDetail = () => ({
      operations: [],
      reasoningFrames: [],
      receipts: [],
      leases: [],
      draftOperations: [],
      latestSteps: [],
      streamEvents: [],
      streamParts: [
        { type: "tool-source_open_literal" as const, toolName: "source_open_literal", toolCallId: "call-bad", state: "output-error" as const, status: "failed" as const, error: "tool_argument_error" },
        { type: "tool-create_btb_deliverable_package" as const, toolName: "create_btb_deliverable_package", toolCallId: "call-package", state: "output-available" as const, status: "completed" as const, output: { ok: true } },
        { type: "text" as const, text: "BTB task complete. Deliverable package created.", state: "done" as const },
      ],
    });
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.getByText("NodeAgent completed with recovered steps")).toBeTruthy();
    expect(screen.queryByText("NodeAgent needs attention")).toBeNull();
  });

  it("renders agent markdown with lists and tables instead of raw syntax", () => {
    const store = baseStore();
    store.lastLongFreeJob = () => null;
    store.listMessages = () => [{
      id: "agent-md",
      roomId: "r1",
      channel: "public",
      author: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" },
      text: [
        "Here's a quick rundown:",
        "",
        "**Spreadsheet work**",
        "- Read, search, and edit cells in the shared spreadsheet.",
        "- Compute and fill derived values.",
        "",
        "| Row | Q2 | Q3 | Variance % |",
        "|---|---:|---:|---:|",
        "| Revenue | $10,000 | $12,400 | +24% |",
      ].join("\n"),
      clientMsgId: "agent-md",
      kind: "agent",
      createdAt: 1000,
    }];
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    const bubble = screen.getByTestId("chat-message");
    expect(within(bubble).getByText("Spreadsheet work").tagName).toBe("STRONG");
    expect(within(bubble).getAllByRole("listitem")).toHaveLength(2);
    expect(within(bubble).getByRole("table")).toBeTruthy();
    expect(within(bubble).getByRole("columnheader", { name: "Variance %" })).toBeTruthy();
    expect(within(bubble).getByRole("cell", { name: "+24%" })).toBeTruthy();
    expect(bubble.textContent).not.toContain("**Spreadsheet work**");
  });

  it("sorts synthetic durable job results by timestamp instead of appending them below newer chat", () => {
    const store = baseStore();
    store.listMessages = () => [
      {
        id: "m1",
        roomId: "r1",
        channel: "public",
        author: me,
        text: "First user message",
        clientMsgId: "c1",
        kind: "chat",
        createdAt: 1000,
      },
      {
        id: "m2",
        roomId: "r1",
        channel: "public",
        author: me,
        text: "Later user message",
        clientMsgId: "c2",
        kind: "chat",
        createdAt: 3000,
      },
    ];
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
      finalText: "Durable result between messages",
      updatedAt: 2000,
    });
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    const feedText = Array.from(screen.getByTestId("chat-feed").querySelectorAll(".text")).map((el) => el.textContent);
    expect(feedText).toEqual(["First user message", "Durable result between messages", "Later user message"]);
  });

  it("formats multi-minute job attempt durations with one decimal place", () => {
    const store = baseStore();
    store.lastLongFreeJobAttempts = () => [{
      attempt: 1,
      status: "completed",
      resolvedModel: "z-ai/glm-5.2",
      stopReason: "done",
      ms: 130000,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    }];
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.getByText(/2\.2m/)).toBeTruthy();
    expect(screen.queryByText(/2\.166/)).toBeNull();
  });

  it("does not show cancel for terminal blocked jobs and only offers retry", () => {
    const store = baseStore();
    store.lastLongFreeJob = () => ({
      id: "job1",
      status: "blocked",
      entrypoint: "public_ask",
      runtime: "workflow",
      attempts: 1,
      maxAttempts: 20,
      modelPolicy: "gemini-3.5-flash",
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      error: "needs host review",
      updatedAt: 2000,
    });
    mockStore.current = store;

    render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    expect(screen.queryByTestId("job-cancel")).toBeNull();
    expect(screen.getByTestId("job-retry")).toBeTruthy();
  });

  it("collapses open successful job details once the job completes", async () => {
    const store = baseStore();
    let status = "running";
    store.lastLongFreeJob = () => ({
      id: "job1",
      status,
      entrypoint: "public_ask",
      runtime: "workflow",
      attempts: status === "running" ? 0 : 1,
      maxAttempts: 20,
      modelPolicy: "gemini-3.5-flash",
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      finalText: status === "completed" ? "Completed result" : undefined,
      updatedAt: status === "running" ? 1000 : 2000,
    });
    mockStore.current = store;
    const view = render(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    fireEvent.click(screen.getByTestId("job-detail-toggle"));
    expect(screen.getByTestId("job-detail")).toBeTruthy();

    status = "completed";
    view.rerender(<Chat roomId="r1" me={me} channel="public" variant="public" agentName="Room NodeAgent" />);

    await waitFor(() => expect(screen.queryByTestId("job-detail")).toBeNull());
    expect(screen.queryByTestId("job-status")).toBeNull();
    expect(screen.getByText("Completed result")).toBeTruthy();
  });
});
