// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactSheet } from "../src/ui/mobile/MobileDeck";
import { slideDoc, type Evidence } from "../src/ui/mobile/mobileData";
import type { MobileCtx, MobileDeckArtifact } from "../src/ui/mobile/mobileTypes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const liveEvidence: Evidence = {
  claim: "Live ARR bridge is source-backed",
  status: "verified",
  answer: "The live room evidence supports the ARR bridge claim.",
  support: [
    { kind: "cite", n: "1", text: "ARR bridge source artifact", host: "room artifact", verified: true },
    { kind: "gap", text: "Export file receipt still pending." },
  ],
  followups: [],
  fallback: "No additional live evidence is available yet.",
};

function liveDeck(): MobileDeckArtifact {
  return {
    id: "room-1:storyboard",
    storyboard: {
      deckId: "room-1:storyboard",
      roomId: "room-1",
      title: "Live diligence readout",
      audience: "room reviewers",
      objective: "Turn live room evidence into a reviewable deck.",
      privacy: "room",
      storyboardStatus: "needs_review",
      slides: [{
        slideId: "slide-1",
        title: "Live ARR bridge",
        purpose: "Review the live ARR bridge claim.",
        claims: [{ claimId: "claim-1", text: "ARR bridge needs reviewer approval.", status: "needs_review", sourceArtifactId: "artifact-1", traceId: "trace-1", proposalId: "proposal-1" }],
        sourceArtifactIds: ["artifact-1"],
        evidenceIds: [],
        unresolvedGaps: ["Export file receipt still pending."],
        status: "needs_review",
      }],
      requiredEvidence: ["Primary ARR bridge source"],
      unresolvedGaps: ["Export file receipt still pending."],
      sourceArtifactIds: ["artifact-1"],
      traceIds: ["trace-1"],
      proposalIds: ["proposal-1"],
      planHash: "hash-live",
      version: 1,
    },
    roomId: "room-1",
    workArtifactId: "room-1:storyboard",
    traceIds: ["trace-1"],
    sourceIds: ["artifact-1"],
    proposalIds: ["proposal-1"],
    readonly: true,
    fallbackReason: "Derived mobile storyboard.",
    title: "Live diligence readout",
    audience: "room reviewers",
    status: "proposed",
    planHash: "hash-live",
    privacy: "Room",
    exportState: "not_started",
    exportFormat: "PPTX",
    exportSize: "receipt pending",
    sourceGaps: 1,
    plan: {
      goal: "Turn live room evidence into a reviewable deck.",
      todos: [
        { text: "Read live room artifacts", status: "done" },
        { text: "Map claims to evidence", status: "running" },
        { text: "Produce export receipt", status: "todo" },
      ],
      ran: 2,
      guard: "No slide write lands without proposal approval.",
      willRead: ["artifact-1"],
      willCreate: ["Mobile storyboard preview"],
      wontWrite: ["Deck HTML"],
      stats: [{ v: "1", l: "slides", mono: true }],
    },
    slides: [
      {
        id: "slide-1",
        index: 1,
        title: "Live ARR bridge",
        status: "needs_review",
        html: slideDoc("<h1>Live source-backed claim</h1><p>ARR bridge needs reviewer approval.</p>"),
      },
    ],
    patchSample: {
      target: "Proposal proposal-1",
      before: "ARR bridge needs reviewer approval.",
      after: "Keep ARR bridge marked needs_review until the proposal is accepted.",
      evidence: [{ n: "1", text: "ARR bridge source artifact", verified: true }],
    },
    receipt: {
      reads: { planned: 1, actual: 1 },
      writes: { planned: 0, actual: 0 },
      cost: { planned: "room policy", actual: "not run from mobile" },
      coverage: "1 claim needs evidence",
      gaps: ["Export file receipt still pending."],
      files: ["Mobile storyboard preview"],
    },
    versions: [{ v: "v1", label: "Live storyboard projection", t: "now", current: true }],
  };
}

function makeCtx(overrides: Partial<MobileCtx> = {}): MobileCtx {
  return {
    isLive: true,
    canBack: false,
    closeSheet: vi.fn(),
    backSheet: vi.fn(),
    openSheet: vi.fn(),
    toast: vi.fn(),
    openSource: vi.fn(),
    liveEvidence,
    ...overrides,
  } as unknown as MobileCtx;
}

describe("mobile live deck review", () => {
  it("does not show sample CardioNova deck content when a live room has no deck", () => {
    render(<ArtifactSheet ctx={makeCtx({ liveDeck: undefined })} />);

    expect(screen.getByTestId("mobile-live-deck-empty")).toBeTruthy();
    expect(screen.getByText("No live deck to review")).toBeTruthy();
    expect(screen.queryByText(/CardioNova investor update/i)).toBeNull();
  });

  it("renders the live storyboard and live evidence instead of sample evidence", () => {
    const { container } = render(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck() })} />);

    expect(screen.getByText("Live diligence readout")).toBeTruthy();
    expect(screen.getByText("Live ARR bridge")).toBeTruthy();
    expect(screen.queryByText(/CardioNova investor update/i)).toBeNull();
    expect(container.querySelector(".na-sheet-body > .na-thumbs")).toBeTruthy();
    expect(container.querySelector(".na-sheet-body > .na-slide-toolbar")).toBeTruthy();
    expect(container.querySelector(".na-sheet-body > .na-slidewrap")).toBeTruthy();
    expect(container.querySelector(".na-thumbs > .na-slide-toolbar")).toBeNull();
    expect(container.querySelector(".na-thumbs > .na-slidewrap")).toBeNull();

    fireEvent.click(screen.getByText("Evidence"));
    expect(screen.getByText(/Live ARR bridge is source-backed/)).toBeTruthy();
    expect(screen.getByText(/The live room evidence supports the ARR bridge claim/)).toBeTruthy();
    expect(screen.getByText("verified")).toBeTruthy();
  });

  it("submits an element-scoped live request without claiming the patch was applied", async () => {
    const requestDeckPatch = vi.fn(async () => ({ ok: true }));
    const requestRoomAgent = vi.fn(async () => ({ ok: true }));
    render(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck(), requestDeckPatch, requestRoomAgent })} />);

    fireEvent.click(screen.getByRole("button", { name: "Scope revision request to the slide title" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe the change for this element/i), { target: { value: "Tighten this title" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(requestDeckPatch).toHaveBeenCalledTimes(1));
    expect(requestDeckPatch).toHaveBeenCalledWith(expect.objectContaining({
      slideId: "slide-1",
      targetField: "title",
      reviewerRequest: expect.stringMatching(/Element scope: h1 - "Live ARR bridge"/),
    }));
    expect(requestRoomAgent).not.toHaveBeenCalled();
    expect(await screen.findByText("request submitted")).toBeTruthy();
    expect(screen.queryByText("patch applied")).toBeNull();
  });

  it("preserves the live request thread across same-deck trace refreshes", async () => {
    let resolveRequest!: (result: { ok: boolean }) => void;
    const requestDeckPatch = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      resolveRequest = resolve;
    }));
    const { rerender } = render(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck(), requestDeckPatch })} />);

    fireEvent.click(screen.getByRole("button", { name: "Scope revision request to the slide title" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe the change for this element/i), { target: { value: "Tighten this title" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(requestDeckPatch).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Tighten this title")).toBeTruthy();
    expect(screen.getByText(/Submitting this exact slide/i)).toBeTruthy();

    const refreshedDeck = liveDeck();
    refreshedDeck.traceIds = [...refreshedDeck.traceIds, "trace-2"];
    refreshedDeck.slides[0].title = "Updated live ARR bridge";
    const refreshedStoryboard = refreshedDeck.storyboard;
    if (!refreshedStoryboard) throw new Error("live deck fixture requires a storyboard");
    refreshedStoryboard.traceIds = [...refreshedStoryboard.traceIds, "trace-2"];
    rerender(<ArtifactSheet ctx={makeCtx({ liveDeck: refreshedDeck, requestDeckPatch })} />);

    expect(screen.getByText("Tighten this title")).toBeTruthy();
    expect(screen.getByText(/Submitting this exact slide/i)).toBeTruthy();
    expect(screen.getByText("Updated live ARR bridge")).toBeTruthy();
    await act(async () => resolveRequest({ ok: true }));

    expect(await screen.findByText("request submitted")).toBeTruthy();
    expect(screen.getByText(/Inbox will show a reviewable proposal only if/i)).toBeTruthy();
    expect(screen.getByText("Tighten this title")).toBeTruthy();
    expect(screen.queryByText("patch applied")).toBeNull();
  });

  it("does not append a late request result after switching decks", async () => {
    let resolveRequest!: (result: { ok: boolean }) => void;
    const requestDeckPatch = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      resolveRequest = resolve;
    }));
    const { rerender } = render(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck(), requestDeckPatch })} />);

    fireEvent.change(screen.getByPlaceholderText(/Ask NodeAgent to revise a slide/i), { target: { value: "Review this slide" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(requestDeckPatch).toHaveBeenCalledTimes(1));

    const nextDeck = liveDeck();
    nextDeck.id = "room-1:second-storyboard";
    nextDeck.title = "Second live readout";
    rerender(<ArtifactSheet ctx={makeCtx({ liveDeck: nextDeck, requestDeckPatch })} />);
    await act(async () => resolveRequest({ ok: true }));

    expect(screen.getByText("Second live readout")).toBeTruthy();
    expect(screen.queryByText("Review this slide")).toBeNull();
    expect(screen.queryByText("request submitted")).toBeNull();
  });

  it("downloads real live storyboard PPTX bytes and exposes a receipt", async () => {
    const ctx = makeCtx({ liveDeck: liveDeck() });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:deck") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ArtifactSheet ctx={ctx} />);

    fireEvent.click(screen.getByText("Export"));
    expect(screen.getByTestId("mobile-live-deck-version-note")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    fireEvent.click(screen.getByText("Download PPTX"));

    await waitFor(() => expect(screen.getByTestId("mobile-deck-export-receipt").textContent).toMatch(/Downloaded .*\.pptx - 1 slides .* integrity/i));
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringMatching(/^Downloaded .*\.pptx - 1 slides - /i));
    expect(ctx.toast).not.toHaveBeenCalledWith(expect.stringContaining("CardioNova_update.pptx downloaded"));
  });
});
