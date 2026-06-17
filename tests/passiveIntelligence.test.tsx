// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mockStore = vi.hoisted(() => ({ current: {} as any }));

vi.mock("convex/react", () => ({ useQuery: () => null }));

vi.mock("../src/app/store", () => ({
  useStore: () => mockStore.current,
}));

// NodeReveal/NodeCount use IntersectionObserver — jsdom doesn't provide it.
// Stub it to immediately call the callback with isIntersecting=true so content renders.
beforeAll(() => {
  (globalThis as any).IntersectionObserver = class {
    constructor(private cb: (entries: any[]) => void) {}
    observe() { this.cb([{ isIntersecting: true }]); }
    disconnect() {}
    unobserve() {}
  };
  (globalThis as any).matchMedia = (globalThis as any).matchMedia ?? ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

import { PassiveAgentChip } from "../src/ui/insights/PassiveAgentChip";
import type { PassiveActivityItem } from "../src/app/store";

function item(over: Partial<PassiveActivityItem>): PassiveActivityItem {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    sourceKind: "element",
    sourceId: "art1:cell1",
    eventKind: "cell_committed",
    status: "job_created",
    visibility: "room",
    createdAt: 1,
    updatedAt: 1,
    latestJobId: "job1",
    entityNames: ["CardioNova"],
    facets: ["funding"],
    reasons: ["company_mention"],
    score: 0.8,
    action: "start_research_job",
    textPreview: "Met Maya from CardioNova, raising Series B.",
    ...over,
  };
}

function withFeed(items: PassiveActivityItem[]) {
  mockStore.current = { listPassiveActivity: () => items };
}

describe("PassiveAgentChip + NoteworthyInbox", () => {
  beforeEach(() => { mockStore.current = {}; });
  afterEach(() => cleanup());

  it("renders nothing when there is no actionable activity (calm by default)", () => {
    withFeed([]);
    const { container } = render(<PassiveAgentChip roomId="r1" onOpenArtifact={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("passive-agent-chip")).toBeNull();
  });

  it("filters out settled/quiet statuses so the chip only counts actionable work", () => {
    withFeed([
      item({ status: "job_created" }),
      item({ status: "noteworthy", action: "create_coach_cue", id: "c2" }),
      item({ status: "not_noteworthy", action: "ignore", id: "c3" }), // filtered
      item({ status: "completed", action: "index_file", id: "c4" }),  // filtered
    ]);
    render(<PassiveAgentChip roomId="r1" onOpenArtifact={vi.fn()} />);
    expect(screen.getByTestId("passive-agent-chip").textContent).toContain("noticed 2");
  });

  it("opens the inbox, shows status pills, and routes cell click-through to the stage", () => {
    const onOpen = vi.fn();
    withFeed([
      item({ status: "job_created", sourceKind: "element", sourceId: "sheetArt:r_gp__variance", entityNames: ["CardioNova"], id: "c1" }),
      item({ status: "noteworthy", action: "create_coach_cue", sourceKind: "node", sourceId: "node42", entityNames: ["Acme"], textPreview: "Acme note", id: "c2" }),
    ]);
    render(<PassiveAgentChip roomId="r1" onOpenArtifact={onOpen} />);

    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    const cards = screen.getAllByTestId("noteworthy-item");
    expect(cards).toHaveLength(2);

    // Researching pill on the job_created card, plus an Open cell button.
    expect(screen.getByText("Researching")).toBeTruthy();
    const openBtn = screen.getByTestId("noteworthy-open");
    fireEvent.click(openBtn);
    expect(onOpen).toHaveBeenCalledWith("sheetArt", { elementId: "r_gp__variance" });
  });

  it("renders informational cards without an open button for sources we can't navigate to yet", () => {
    withFeed([item({ status: "noteworthy", action: "create_coach_cue", sourceKind: "node", sourceId: "node42", entityNames: ["Acme"], id: "c2" })]);
    render(<PassiveAgentChip roomId="r1" onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    expect(screen.getByText("Coach cue")).toBeTruthy();
    expect(screen.queryByTestId("noteworthy-open")).toBeNull();
  });

  it("dismisses the inbox on Escape", () => {
    withFeed([item({ id: "c1" })]);
    render(<PassiveAgentChip roomId="r1" onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    expect(screen.getByTestId("noteworthy-inbox")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("noteworthy-inbox")).toBeNull();
  });
});
