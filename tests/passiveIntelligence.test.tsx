// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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
import { preferredRoomArtifact } from "../src/ui/RoomShell";
import { inventoryGroups } from "../src/ui/panels/Artifact";

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
    reasons: ["organization_candidate"],
    score: 0.8,
    action: "start_research_job",
    textPreview: "Met Maya from CardioNova, raising Series B.",
    ...over,
  };
}

function withFeed(items: PassiveActivityItem[], extra?: Partial<typeof mockStore.current>) {
  mockStore.current = { listPassiveActivity: () => items, ...extra };
}

const ME = { kind: "user" as const, id: "me-1", name: "Maya" };

describe("PassiveAgentChip + NoteworthyInbox", () => {
  beforeEach(() => { mockStore.current = {}; });
  afterEach(() => cleanup());

  it("renders nothing when there is no actionable activity (calm by default)", () => {
    withFeed([]);
    const { container } = render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
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
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    expect(screen.getByTestId("passive-agent-chip").textContent).toContain("noticed 2");
  });

  it("opens the inbox, shows status pills, and routes cell click-through to the stage", () => {
    const onOpen = vi.fn();
    withFeed([
      item({ status: "job_created", sourceKind: "element", sourceId: "sheetArt:r_gp__variance", entityNames: ["CardioNova"], id: "c1" }),
      item({ status: "noteworthy", action: "create_coach_cue", sourceKind: "node", sourceId: "node42", entityNames: ["Acme"], textPreview: "Acme note", id: "c2" }),
    ]);
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={onOpen} />);

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
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    expect(screen.getByText("Coach cue")).toBeTruthy();
    expect(screen.queryByTestId("noteworthy-open")).toBeNull();
  });

  it("dismisses the inbox on Escape", () => {
    withFeed([item({ id: "c1" })]);
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    expect(screen.getByTestId("noteworthy-inbox")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("noteworthy-inbox")).toBeNull();
  });

  it("Dismiss calls dismissActivity and removes the item from the actionable feed", () => {
    const dismiss = vi.fn();
    const target = item({ id: "dismiss-1", status: "noteworthy", action: "create_coach_cue" });
    let feed = [target];
    mockStore.current = {
      listPassiveActivity: () => feed,
      dismissActivity: (activityId: string) => { feed = feed.filter((i) => i.id !== activityId); dismiss(activityId); return Promise.resolve(); },
    };
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    const dismissBtn = screen.getByTestId("noteworthy-dismiss");
    expect(dismissBtn).toBeTruthy();
    fireEvent.click(dismissBtn);
    expect(dismiss).toHaveBeenCalledWith("dismiss-1");
  });

  it("Research calls researchActivity and the pill reflects Researching state", () => {
    const research = vi.fn();
    const target = item({ id: "research-1", status: "noteworthy", action: "start_research_job", entityNames: ["CardioNova"] });
    withFeed([target], { researchActivity: (i: PassiveActivityItem) => { research(i.id); return Promise.resolve(); } });
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    const researchBtn = screen.getByTestId("noteworthy-research");
    expect(researchBtn).toBeTruthy();
    fireEvent.click(researchBtn);
    expect(research).toHaveBeenCalledWith("research-1");
  });

  it("Add to sheet opens the research row returned by addActivityToSheet", () => {
    const add = vi.fn();
    const target = item({ id: "add-1", status: "noteworthy", action: "create_coach_cue", entityNames: ["CardioNova"] });
    const onOpen = vi.fn();
    withFeed([target], { addActivityToSheet: (i: PassiveActivityItem) => { add(i.id); return Promise.resolve({ artifactId: "research-art", rowId: "rc_cardionova", created: false }); } });
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={onOpen} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    const addBtn = screen.getByTestId("noteworthy-add");
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);
    expect(add).toHaveBeenCalledWith("add-1");
    return waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith("research-art", { elementId: "rc_cardionova__company" });
    });
  });

  it("Research button is hidden when item is already Researching", () => {
    const target = item({ id: "r1", status: "job_created", action: "start_research_job", entityNames: ["CardioNova"] });
    withFeed([target], { researchActivity: vi.fn().mockResolvedValue(undefined) });
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    // research button hidden when tone === "researching"
    expect(screen.queryByTestId("noteworthy-research")).toBeNull();
  });

  it("Coach cue shows a Practice button that opens the explain-and-defend form", () => {
    const target = item({ id: "practice-1", status: "noteworthy", action: "create_coach_cue", entityNames: ["CardioNova"] });
    withFeed([target], { practiceActivity: vi.fn().mockResolvedValue(undefined) });
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    const practiceBtn = screen.getByTestId("noteworthy-practice");
    expect(practiceBtn).toBeTruthy();
    fireEvent.click(practiceBtn);
    expect(screen.getByTestId("noteworthy-practice-form")).toBeTruthy();
    expect(screen.getByTestId("noteworthy-practice-answer")).toBeTruthy();
  });

  it("Practice submit calls practiceActivity (Coach Mode wiring end-to-end)", async () => {
    const practice = vi.fn().mockResolvedValue(undefined);
    const target = item({ id: "practice-2", status: "noteworthy", action: "create_coach_cue", entityNames: ["CardioNova"] });
    withFeed([target], { practiceActivity: (i: PassiveActivityItem, _actor: typeof ME, _answer: string) => { practice(i.id); return Promise.resolve(); } });
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    fireEvent.click(screen.getByTestId("noteworthy-practice"));
    // React 19 controlled textarea: set the native value via the prototype setter
    // (jsdom's fireEvent.change target shape doesn't reliably update React state),
    // then dispatch an input event so onChange fires and the submit button enables.
    const ta = screen.getByTestId("noteworthy-practice-answer") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(ta, "Runway is needs_review because burn sources conflict.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    fireEvent.click(screen.getByTestId("noteworthy-practice-submit"));
    await waitFor(() => {
      expect(practice).toHaveBeenCalledWith("practice-2");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("noteworthy-practice-form")).toBeNull();
    });
  });

  it("Practice submit is disabled when the answer is empty", () => {
    const target = item({ id: "practice-3", status: "noteworthy", action: "create_coach_cue", entityNames: ["CardioNova"] });
    withFeed([target], { practiceActivity: vi.fn().mockResolvedValue(undefined) });
    render(<PassiveAgentChip roomId="r1" me={ME} onOpenArtifact={vi.fn()} />);
    fireEvent.click(screen.getByTestId("passive-agent-chip"));
    fireEvent.click(screen.getByTestId("noteworthy-practice"));
    const submit = screen.getByTestId("noteworthy-practice-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe("preferredRoomArtifact", () => {
  it("prefers the wall (inventory surface) when present", () => {
    const chosen = preferredRoomArtifact([
      { id: "wiki", kind: "note", title: "Agent wiki" },
      { id: "capture", kind: "note", title: "Capture Notebook" },
      { id: "wall", kind: "wall", title: "Risk / opportunity wall" },
      { id: "sheet", kind: "sheet", title: "Q3 variance" },
    ]);
    expect(chosen?.id).toBe("wall");
  });

  it("prefers the dedicated Capture Notebook over the Agent wiki when no wall", () => {
    const chosen = preferredRoomArtifact([
      { id: "wiki", kind: "note", title: "Agent wiki" },
      { id: "capture", kind: "note", title: "Capture Notebook" },
      { id: "sheet", kind: "sheet", title: "Q3 variance" },
    ]);
    expect(chosen?.id).toBe("capture");
  });

  it("falls back to a generic note before any sheet", () => {
    const chosen = preferredRoomArtifact([
      { id: "sheet", kind: "sheet", title: "Blank sheet" },
      { id: "note", kind: "note", title: "Note" },
    ]);
    expect(chosen?.id).toBe("note");
  });
});

describe("inventoryGroups", () => {
  const actor = { kind: "user" as const, id: "u1", name: "Homen" };
  const base = { version: 1, updatedAt: 1, updatedBy: actor };
  const arts = [
    { id: "wall", roomId: "r1", kind: "wall" as const, title: "Risk / opportunity wall", elements: {}, order: ["s1"], ...base, createdBy: actor },
    { id: "sheet", roomId: "r1", kind: "sheet" as const, title: "Company research", elements: {}, order: [], ...base, createdBy: actor },
    { id: "note", roomId: "r1", kind: "note" as const, title: "Diligence memo", elements: { doc: { id: "doc", value: "<p>memo</p>", ...base } }, order: ["doc"], ...base, createdBy: actor },
    { id: "file", roomId: "r1", kind: "note" as const, title: "btb-1a2b3c4d-support-memo.docx", elements: { doc: { id: "doc", value: { upload: true, fileName: "btb-1a2b3c4d-support-memo.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10240 }, ...base } }, order: ["doc"], ...base, createdBy: actor },
    { id: "btb-sheet", roomId: "r1", kind: "sheet" as const, title: "btb-1a2b3c4d-valuation.xlsx", elements: {}, order: [], ...base, createdBy: actor },
  ];

  it("clusters Banker Tool Bench deliverables, spreadsheets, files, notes, and walls", () => {
    const groups = inventoryGroups(arts as any);
    const keys = groups.map((g) => g.key);
    expect(keys).toEqual(["deliverables", "sheets", "notes", "walls"]);
    expect(groups.find((g) => g.key === "deliverables")?.items.map((i) => i.id)).toEqual(["file", "btb-sheet"]);
    expect(groups.find((g) => g.key === "sheets")?.items.map((i) => i.id)).toEqual(["sheet"]);
    expect(groups.find((g) => g.key === "notes")?.items.map((i) => i.id)).toEqual(["note"]);
    expect(groups.find((g) => g.key === "walls")?.items.map((i) => i.id)).toEqual(["wall"]);
  });
});
