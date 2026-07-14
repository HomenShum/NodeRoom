// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Artifact, Proposal, TraceEvent } from "../src/engine/types";
import type { MobileLive } from "../src/ui/mobile/mobileTypes";
import { buildDeckStoryboardFromRoom, collaborativeDeckArtifactInput, deckSlideElementId } from "../src/ui/workArtifacts";

const captured = vi.hoisted(() => ({ live: null as MobileLive | null }));
const storeRef = vi.hoisted(() => ({ current: null as any }));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => ({})),
  useQuery: () => [],
}));

vi.mock("../src/app/store", () => ({
  useStore: () => storeRef.current,
}));

vi.mock("../src/ui/mobile/MobileApp", async () => {
  const actual = await vi.importActual<typeof import("../src/ui/mobile/MobileApp")>("../src/ui/mobile/MobileApp");
  return {
    ...actual,
    MobileApp: ({ live }: { live?: MobileLive }) => {
      captured.live = live ?? null;
      return null;
    },
  };
});

import { MobileAppLive } from "../src/ui/mobile/MobileAppLive";
import { mobileAgentModelSelection } from "../src/ui/mobile/MobileApp";

const me: Actor = { kind: "user", id: "u1", name: "Maya" };

const liveArtifact: Artifact = {
  id: "artifact-1",
  roomId: "r1",
  kind: "sheet",
  title: "ARR bridge",
  version: 1,
  elements: {
    A1: {
      id: "A1",
      version: 1,
      value: {
        value: "ARR bridge increased 12 percent and needs reviewer approval.",
        status: "needs_review",
        evidence: [{ id: "ev-1", kind: "source", label: "ARR worksheet", url: "https://example.test/arr" }],
      },
      updatedAt: 2,
      updatedBy: me,
    },
  },
  order: ["A1"],
  updatedAt: 2,
  createdBy: me,
  visibility: "room",
  meta: { summary: "ARR bridge needs review." },
};

const liveProposal: Proposal = {
  id: "proposal-1",
  roomId: "r1",
  artifactId: "artifact-1",
  op: { opId: "op-1", artifactId: "artifact-1", elementId: "A1", kind: "set", value: "approved ARR bridge", baseVersion: 1 },
  author: me,
  status: "pending",
  createdAt: 3,
  review: { kind: "agent_edit", status: "needs_review", reason: "Reviewer approval required." },
};

const liveTrace: TraceEvent = {
  id: "trace-1",
  roomId: "r1",
  ts: 4,
  actor: me,
  type: "edit_proposed",
  summary: "Proposed ARR bridge update",
  refs: { artifactId: "artifact-1", proposalId: "proposal-1" },
};

function baseStore(): any {
  return {
    getRoom: () => ({ id: "r1", title: "Live Room", code: "R-123", autoAllow: false }),
    listMembers: () => [{ id: "u1", roomId: "r1", name: "Maya", role: "host", anon: false, color: "#111111", lastSeenAt: 1 }],
    listMessages: () => [],
    listArtifacts: () => [],
    getArtifact: () => undefined,
    listProposals: () => [],
    listPresence: () => [],
    lastLongFreeJob: () => null,
    listSessions: () => [],
    listTraces: () => [],
    postMessage: vi.fn(async () => ({ ok: true })),
    uploadArtifact: vi.fn(async () => "deck-artifact-1"),
    askAgent: vi.fn(async () => undefined),
    askPrivateAgent: vi.fn(async () => undefined),
    applyEdit: vi.fn(async () => ({ ok: true })),
    resolveProposal: vi.fn(async () => ({ ok: true })),
    cancelLongFreeJob: vi.fn(async () => ({ ok: true })),
    retryLongFreeJob: vi.fn(async () => ({ ok: true })),
    toggleAutoAllow: vi.fn(),
    acknowledgeOfflineConflicts: vi.fn(),
  };
}

describe("mobile agent model routing", () => {
  beforeEach(() => {
    captured.live = null;
    storeRef.current = baseStore();
  });

  afterEach(cleanup);

  it("maps the mobile Auto-route chip to the governed adaptive route", () => {
    expect(mobileAgentModelSelection("auto")).toEqual({ mode: "adaptive" });
    expect(mobileAgentModelSelection("z-ai/glm-5.2")).toEqual({ mode: "specific", modelPolicy: "z-ai/glm-5.2" });
  });

  it("forwards selected model routes through the live public room-agent path", async () => {
    render(<MobileAppLive roomId="r1" me={me} />);
    expect(captured.live).toBeTruthy();

    const modelSelection = { mode: "specific" as const, modelPolicy: "z-ai/glm-5.2" };
    await captured.live!.askRoomAgent("review the CardioNova row", modelSelection);

    expect(storeRef.current.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "r1",
      channel: "public",
      text: "review the CardioNova row",
      kind: "chat",
    }));
    expect(storeRef.current.askAgent).toHaveBeenCalledWith({
      goal: "review the CardioNova row",
      modelSelection,
    });
  });

  it("keeps private live asks on the private-agent API without a model override", async () => {
    render(<MobileAppLive roomId="r1" me={me} />);
    expect(captured.live).toBeTruthy();

    await captured.live!.askPrivateAgent("summarize privately");

    expect(storeRef.current.askPrivateAgent).toHaveBeenCalledWith({ goal: "summarize privately" });
    expect(storeRef.current.askAgent).not.toHaveBeenCalled();
  });

  it("does not pass a sample deck into live mode when no live artifact or proposal exists", () => {
    render(<MobileAppLive roomId="r1" me={me} />);

    expect(captured.live).toBeTruthy();
    expect(captured.live!.deck).toBeUndefined();
  });

  it("derives the mobile live deck from work artifacts, proposals, and traces", () => {
    storeRef.current = {
      ...baseStore(),
      listArtifacts: () => [liveArtifact],
      getArtifact: () => liveArtifact,
      listProposals: () => [liveProposal],
      listTraces: () => [liveTrace],
    };

    render(<MobileAppLive roomId="r1" me={me} />);

    expect(captured.live?.deck).toBeTruthy();
    expect(captured.live!.deck!.title).toBe("Live Room readout");
    expect(captured.live!.deck!.sourceIds).toEqual(["artifact-1"]);
    expect(captured.live!.deck!.proposalIds).toContain("proposal-1");
    expect(captured.live!.deck!.traceIds).toContain("trace-1");
    expect(captured.live!.deck!.slides[0].title).toBe("ARR bridge");
    expect(captured.live!.deck!.exportSize).toBe("receipt pending");
  });

  it("persists the live storyboard and scopes a mobile patch request to the exact deck slide", async () => {
    storeRef.current = {
      ...baseStore(),
      listArtifacts: () => [liveArtifact],
      getArtifact: () => liveArtifact,
      listTraces: () => [liveTrace],
    };
    render(<MobileAppLive roomId="r1" me={me} />);
    const storyboard = captured.live?.deck?.storyboard;
    if (!storyboard) throw new Error("expected a live storyboard");
    const slideId = storyboard.slides[0].slideId;
    const modelSelection = { mode: "specific" as const, modelPolicy: "z-ai/glm-5.2" };

    const result = await captured.live!.requestDeckPatch({
      reviewerRequest: "Element scope: h1. Requested change: tighten the title.",
      slideId,
      targetField: "title",
    }, modelSelection);

    expect(result).toEqual({ ok: true });
    expect(storeRef.current.uploadArtifact).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "r1",
      actor: me,
      visibility: "room",
      artifact: expect.objectContaining({
        kind: "note",
        meta: expect.objectContaining({ tags: expect.arrayContaining(["noderoom:deck", "work-artifact"]) }),
      }),
    }));
    expect(storeRef.current.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "r1",
      channel: "public",
      text: expect.stringMatching(/Deck revision request/),
    }));
    expect(storeRef.current.askAgent).toHaveBeenCalledWith(expect.objectContaining({
      contextArtifactId: "deck-artifact-1",
      contextArtifactRequired: true,
      allowedElementIds: [deckSlideElementId(slideId)],
      maxAttempts: 1,
      modelSelection,
      goal: expect.stringMatching(/Submit exactly one governed edit proposal/),
    }));
    expect(storeRef.current.askAgent.mock.calls[0][0].goal).toContain('"changes":{"title":"REPLACE_WITH_REVIEWED_TITLE"}');
  });

  it("projects a real deck proposal into a reviewable mobile before-and-after receipt", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "r1",
      roomTitle: "Live Room",
      artifacts: [liveArtifact],
      traces: [liveTrace],
    });
    const input = collaborativeDeckArtifactInput(storyboard);
    const deckArtifact: Artifact = {
      id: "deck-artifact-1",
      roomId: "r1",
      kind: "note",
      title: input.title,
      version: 1,
      order: input.seed.map((element) => element.id),
      elements: Object.fromEntries(input.seed.map((element) => [element.id, {
        id: element.id,
        version: 1,
        value: element.value,
        updatedAt: 5,
        updatedBy: me,
      }])),
      updatedAt: 5,
      createdBy: me,
      visibility: "room",
      meta: input.meta,
    };
    const slide = storyboard.slides[0];
    const elementId = deckSlideElementId(slide.slideId);
    const deckProposal: Proposal = {
      id: "deck-proposal-1",
      roomId: "r1",
      artifactId: deckArtifact.id,
      op: {
        opId: "deck-op-1",
        artifactId: deckArtifact.id,
        elementId,
        kind: "set",
        value: { schema: 2, kind: "slide_patch", objectId: elementId, slideId: slide.slideId, changes: { title: "Evidence-backed ARR bridge" } },
        baseVersion: 1,
      },
      author: { kind: "agent", id: "agent-1", name: "Room NodeAgent" },
      status: "pending",
      createdAt: 6,
    };
    storeRef.current = {
      ...baseStore(),
      listArtifacts: () => [liveArtifact, deckArtifact],
      getArtifact: (id: string) => id === deckArtifact.id ? deckArtifact : liveArtifact,
      listProposals: () => [deckProposal],
      listTraces: () => [liveTrace],
    };

    render(<MobileAppLive roomId="r1" me={me} />);

    expect(captured.live?.inboxItems).toEqual([expect.objectContaining({
      id: "deck-proposal-1",
      kind: "deck",
      title: "Deck slide proposal",
      review: expect.objectContaining({
        target: expect.stringMatching(/Slide 1/),
        before: expect.stringMatching(/Title: ARR bridge/),
        after: "Title: Evidence-backed ARR bridge",
        sources: ["ARR bridge"],
        traceIds: expect.arrayContaining(["trace-1"]),
      }),
    })]);
  });
});
