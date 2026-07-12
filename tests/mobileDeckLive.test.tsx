// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactSheet, buildLiveDeckRequest } from "../src/ui/mobile/MobileDeck";
import { buildRecents } from "../src/ui/mobile/MobileAppLive";
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
    recordDeckExportReceipt: vi.fn(async () => ({ ok: true })),
    credits: {
      mode: "standard",
      availableCredits: 20,
      reservedCredits: 0,
      lifetimeSpentCredits: 0,
      availableUsd: 5,
      reservedUsd: 0,
      estimateUsdLow: 0.12,
      estimateUsdHigh: 0.28,
      hardCapUsd: 2,
      requiredCredits: 8,
      enforced: true,
      enrolled: true,
      paused: false,
    },
    liveEvidence,
    ...overrides,
  } as unknown as MobileCtx;
}

describe("mobile live deck review", () => {
  it("bounds live deck request provenance to the durable job goal contract", () => {
    const request = buildLiveDeckRequest({
      deckId: "deck-live",
      slideIndex: 1,
      slideId: "slide-1",
      slideTitle: "Live ARR bridge",
      target: { label: "h1", text: "Current title" },
      requestedChange: "Tighten this title. ".repeat(500),
      sourceIds: Array.from({ length: 50 }, (_, index) => `source-${index}`),
      traceIds: Array.from({ length: 50 }, (_, index) => `trace-${index}`),
    });

    expect(request.length).toBeLessThanOrEqual(1_800);
    expect(request).toContain("Do not directly mutate the deck");
    expect(request).toContain("(+46 more on storyboard)");
    expect(request).toContain("Return a sourced proposal for host review");
  });

  it("projects the governed live storyboard into the Home artifact library", () => {
    const recents = buildRecents([], liveDeck());

    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({ kind: "deck", title: "Live diligence readout" });
    expect(recents[0].sig).toMatchObject({ type: "deck", count: 1, active: 0 });
  });

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

  it("routes live deck evidence follow-ups through the governed room agent", async () => {
    const requestRoomAgent = vi.fn(async (_goal: string) => ({ ok: true }));
    render(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck(), requestRoomAgent })} />);

    fireEvent.click(screen.getByText("Evidence"));
    fireEvent.change(screen.getByPlaceholderText(/Ask a follow-up about this claim/i), { target: { value: "What remains unverified?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(requestRoomAgent).toHaveBeenCalledTimes(1));
    expect(requestRoomAgent.mock.calls[0][0]).toMatch(/do not mutate the deck/i);
    expect(await screen.findByText(/Read the answer in the Agent tab/i)).toBeTruthy();
    expect(screen.queryByText(liveEvidence.fallback)).toBeNull();
  });

  it("submits an element-scoped live request without claiming the patch was applied", async () => {
    let resolveRequest!: (result: { ok: boolean }) => void;
    const requestRoomAgent = vi.fn((_goal: string) => new Promise<{ ok: boolean }>((resolve) => { resolveRequest = resolve; }));
    const { rerender } = render(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck(), requestRoomAgent })} />);

    fireEvent.click(screen.getByRole("button", { name: "Scope revision request to the slide title" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe the change for this element/i), { target: { value: "Tighten this title" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(requestRoomAgent).toHaveBeenCalledTimes(1));
    expect(requestRoomAgent.mock.calls[0][0]).toMatch(/Element scope: h1 - "Live ARR bridge"/);
    rerender(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck(), requestRoomAgent })} />);
    resolveRequest({ ok: true });
    expect(await screen.findByText("request accepted")).toBeTruthy();
    expect(screen.queryByText("patch applied")).toBeNull();
  });

  it("shows the launch estimate and blocks provider work when the hard-cap hold does not fit", () => {
    const requestRoomAgent = vi.fn(async () => ({ ok: true }));
    render(<ArtifactSheet ctx={makeCtx({
      liveDeck: liveDeck(),
      requestRoomAgent,
      credits: {
        mode: "standard",
        availableCredits: 1,
        reservedCredits: 0,
        lifetimeSpentCredits: 0,
        availableUsd: 0.25,
        reservedUsd: 0,
        estimateUsdLow: 0.12,
        estimateUsdHigh: 0.28,
        hardCapUsd: 2,
        requiredCredits: 8,
        enforced: true,
        enrolled: true,
        paused: false,
      },
    })} />);

    expect(screen.getByTestId("mobile-deck-cost-estimate").textContent).toContain("hold of up to 8.0 credits");
    fireEvent.click(screen.getByRole("button", { name: "Scope revision request to the slide title" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe the change for this element/i), { target: { value: "Tighten this title" } });
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    expect(requestRoomAgent).not.toHaveBeenCalled();
  });

  it("blocks a live deck request when the wallet is unavailable", () => {
    const requestRoomAgent = vi.fn(async () => ({ ok: true }));
    render(<ArtifactSheet ctx={makeCtx({ liveDeck: liveDeck(), requestRoomAgent, credits: undefined })} />);

    expect(screen.getByTestId("mobile-deck-cost-estimate").textContent).toContain("Live wallet unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Scope revision request to the slide title" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe the change for this element/i), { target: { value: "Tighten this title" } });
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    expect(requestRoomAgent).not.toHaveBeenCalled();
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

    await waitFor(() => expect(screen.getByTestId("mobile-deck-export-receipt").textContent).toMatch(/Download started .*\.pptx - 1 slides .* SHA-256 [a-f0-9]{64} .* receipt synced/i));
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringMatching(/^Download started .*\.pptx - 1 slides/i));
    expect(ctx.recordDeckExportReceipt).toHaveBeenCalledWith(expect.objectContaining({
      deliveryStatus: "download_started",
      integrityAlgorithm: "sha256",
      integrityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(ctx.toast).not.toHaveBeenCalledWith(expect.stringContaining("CardioNova_update.pptx downloaded"));
  });
});
