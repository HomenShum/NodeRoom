// @vitest-environment jsdom
/**
 * Receipts layer completion — per-cell version history/restore/diff, stale
 * chips, and Room-trace filters (src/ui/panels/Artifact.tsx owner pass).
 *
 * Persona: Maya hosts a live diligence room. The room agent overwrote her
 * hand-tuned funding cell during an enrichment run; she hovers the cell,
 * opens the clock-glyph history popover, audits the versions (value preview,
 * author, relative time, vN), diffs v2 against the current value, and
 * restores it — knowing a restore is a NEW CAS write that can conflict
 * honestly. Meanwhile the 400-event Room trace is unreadable until she
 * filters it by kind/person and groups the agent's write bursts by run.
 *
 * Angles covered: happy path (list/diff/restore), sad paths (conflict,
 * truncated snapshot, network failure, empty history, loading), adversarial
 * (hostile HTML values render as text, megacell values stay bounded, 50-actor
 * member churn), honesty (memory mode hides the affordance entirely; cells
 * without evidence NEVER get a stale chip), and scale — burst (500 events in
 * one minute fold into one run group) AND sustained (10k-event log filters
 * stay bounded at the 40-row render cap).
 *
 * jsdom renders are kept to the leaf components (CellHistory, StaleChip,
 * CellDiff, TraceStrip); everything else runs through the exported pure
 * helpers — same harness as tests/evidencePopover.test.tsx.
 */
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, CellPayload, TraceEvent } from "../src/engine/types";

const mockStore = vi.hoisted(() => ({ current: {} as any }));
const mockConvex = vi.hoisted(() => ({
  versions: undefined as unknown,
  lastQueryArgs: null as unknown,
  restore: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    mockConvex.lastQueryArgs = args;
    return args === "skip" ? undefined : mockConvex.versions;
  },
  useMutation: () => mockConvex.restore,
}));
vi.mock("../src/app/store", () => ({ useStore: () => mockStore.current }));

import {
  CellHistory,
  CellDiff,
  StaleChip,
  TraceStrip,
  cellHistoryEnabled,
  historyValuePreview,
  displayCellValue,
  historyTimeAgo,
  wordDiffSegments,
  staleLabelFor,
  cellStaleness,
  traceKindOf,
  traceFilterModel,
  filterTraces,
  groupTraceBursts,
  CELL_HISTORY_LIMIT,
  CELL_DIFF_MAX_WORDS,
  TRACE_PEOPLE_MAX,
  STALE_AFTER_MS,
} from "../src/ui/panels/Artifact";

const MAYA: Actor = { kind: "user", id: "u_maya", name: "Maya" };
const AGENT: Actor = { kind: "agent", id: "a_nodeagent", name: "Room NodeAgent", scope: "public" };
const PROOF = { actor: MAYA, token: "maya-session-token-0123456789" };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function versionRow(over: Partial<{ _id: string; version: number; value: unknown; truncated: boolean; updatedBy: Actor; kind: "set" | "create" | "delete"; ts: number }>) {
  return {
    _id: "row-" + Math.random().toString(36).slice(2),
    version: 1,
    value: "$12,400",
    truncated: false,
    updatedBy: AGENT,
    kind: "set" as const,
    ts: Date.now() - 5 * 60_000,
    ...over,
  };
}

function renderHistory(overrides: Partial<Parameters<typeof CellHistory>[0]> = {}) {
  return render(
    <CellHistory
      roomId="room1"
      artifactId="art1"
      elementId="rc_cardionova__funding"
      requester={PROOF}
      currentValue="$18M Series B"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mockConvex.versions = undefined;
  mockConvex.lastQueryArgs = null;
  mockConvex.restore = vi.fn().mockResolvedValue({ ok: true, version: 9 });
});
afterEach(() => cleanup());

/* ── live-only gating: honest absence in memory mode ─────────────────────── */

describe("cellHistoryEnabled — the affordance exists only where the version log does", () => {
  it("is on in live (convex) mode with a proof, off in memory mode and without proof", () => {
    expect(cellHistoryEnabled("convex", PROOF)).toBe(true);
    // Memory engine keeps no elementVersions log → hide, never fake rows.
    expect(cellHistoryEnabled("memory", PROOF)).toBe(false);
    expect(cellHistoryEnabled("convex", undefined)).toBe(false);
    expect(cellHistoryEnabled("memory", undefined)).toBe(false);
  });
});

/* ── history popover: list, restore, diff ────────────────────────────────── */

describe("CellHistory — Maya recovers the funding cell the agent overwrote", () => {
  it("opens from the clock glyph and lists versions with preview, author, vN, and relative time (bounded query)", () => {
    mockConvex.versions = [
      versionRow({ _id: "r3", version: 3, value: "$16M Series B", ts: Date.now() - 2 * 60_000 }),
      versionRow({ _id: "r2", version: 2, value: { value: "$14M Series A", status: "complete" }, updatedBy: MAYA, ts: Date.now() - 3 * HOUR }),
    ];
    renderHistory();
    // Closed by default: no popover, no query issued (calm cell, hover apparatus only).
    expect(screen.queryByTestId("cell-history-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("cell-history-btn"));

    const pop = screen.getByTestId("cell-history-popover");
    const rows = within(pop).getAllByTestId("cell-history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("v3");
    expect(rows[0].textContent).toContain("$16M Series B");
    expect(rows[0].textContent).toContain("Room NodeAgent");
    expect(rows[0].textContent).toContain("2m ago");
    // CellPayload values unwrap to their scalar for the preview.
    expect(rows[1].textContent).toContain("$14M Series A");
    expect(rows[1].textContent).toContain("Maya");
    expect(rows[1].textContent).toContain("3h ago");
    // The read is proof-gated and BOUNDED.
    const args = mockConvex.lastQueryArgs as { requester: unknown; limit: number };
    expect(args.requester).toBe(PROOF);
    expect(args.limit).toBe(CELL_HISTORY_LIMIT);
    expect(CELL_HISTORY_LIMIT).toBeLessThanOrEqual(50); // server take() cap
  });

  it("clicking the glyph never bubbles into the cell (grid selection/editing untouched)", () => {
    mockConvex.versions = [versionRow({ version: 2 })];
    const onCellClick = vi.fn();
    render(
      <div onClick={onCellClick}>
        <CellHistory roomId="room1" artifactId="art1" elementId="e1" requester={PROOF} currentValue="x" />
      </div>,
    );
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    fireEvent.click(screen.getByTestId("cell-history-popover"));
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it("restores a version through the mutation and closes on ok:true (restore = new CAS write)", async () => {
    mockConvex.versions = [versionRow({ _id: "r2", version: 2, value: "$14M Series A" })];
    const onFeedback = vi.fn();
    renderHistory({ onFeedback });
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    fireEvent.click(screen.getByTestId("cell-history-restore"));
    await waitFor(() => expect(screen.queryByTestId("cell-history-popover")).toBeNull());
    expect(mockConvex.restore).toHaveBeenCalledWith({
      roomId: "room1",
      artifactId: "art1",
      elementId: "rc_cardionova__funding",
      requester: PROOF,
      version: 2,
    });
    expect(onFeedback).not.toHaveBeenCalled();
  });

  it("surfaces a CAS conflict honestly through the EditFeedback path and keeps the popover open", async () => {
    mockConvex.versions = [versionRow({ version: 2 })];
    mockConvex.restore = vi.fn().mockResolvedValue({ ok: false, reason: "conflict", expected: 4, actual: 5 });
    const onFeedback = vi.fn();
    renderHistory({ onFeedback });
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    fireEvent.click(screen.getByTestId("cell-history-restore"));
    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith({ ok: false, reason: "conflict" }));
    expect(screen.getByTestId("cell-history-popover")).toBeTruthy();
  });

  it("reports a thrown mutation (network drop) as feedback instead of pretending success", async () => {
    mockConvex.versions = [versionRow({ version: 2 })];
    mockConvex.restore = vi.fn().mockRejectedValue(new Error("network"));
    const onFeedback = vi.fn();
    renderHistory({ onFeedback });
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    fireEvent.click(screen.getByTestId("cell-history-restore"));
    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith({ ok: false, reason: "restore_failed" }));
    expect(screen.getByTestId("cell-history-popover")).toBeTruthy();
  });

  it("refuses truncated snapshots: Restore disabled + truncated marker (display-only, never restorable)", () => {
    mockConvex.versions = [versionRow({ version: 5, value: "A".repeat(80), truncated: true })];
    renderHistory();
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    const restoreBtn = screen.getByTestId("cell-history-restore") as HTMLButtonElement;
    expect(restoreBtn.disabled).toBe(true);
    expect(screen.getByTestId("cell-history-row").textContent).toContain("truncated");
    fireEvent.click(restoreBtn);
    expect(mockConvex.restore).not.toHaveBeenCalled();
  });

  it("shows an honest empty state for a never-overwritten cell and a loading state while the query resolves", () => {
    mockConvex.versions = undefined; // convex useQuery: undefined = still loading
    renderHistory();
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    expect(screen.getByTestId("cell-history-popover").textContent).toContain("Loading history");
    cleanup();
    mockConvex.versions = [];
    renderHistory();
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    expect(screen.getByTestId("cell-history-empty").textContent).toMatch(/No prior versions/);
  });

  it("toggles an inline two-row diff per version (old vs current, word-level)", () => {
    mockConvex.versions = [versionRow({ version: 2, value: "Q3 variance +12.4% validated" })];
    renderHistory({ currentValue: "Q3 variance +18.1% validated" });
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    expect(screen.queryByTestId("cell-diff")).toBeNull();
    fireEvent.click(screen.getByTestId("cell-history-diff-toggle"));
    const diff = screen.getByTestId("cell-diff");
    const rows = diff.querySelectorAll(".r-hist-diff-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("v2");
    expect(rows[0].textContent).toContain("+12.4%");
    expect(rows[1].textContent).toContain("now");
    expect(rows[1].textContent).toContain("+18.1%");
    // Only the replaced word is highlighted on each side.
    expect([...rows[0].querySelectorAll(".chg")].map((n) => n.textContent)).toEqual(["+12.4%"]);
    expect([...rows[1].querySelectorAll(".chg")].map((n) => n.textContent)).toEqual(["+18.1%"]);
    fireEvent.click(screen.getByTestId("cell-history-diff-toggle"));
    expect(screen.queryByTestId("cell-diff")).toBeNull();
  });

  it("renders hostile HTML in logged values as text, never markup", () => {
    mockConvex.versions = [versionRow({ version: 2, value: "<img src=x onerror=alert(1)>" })];
    renderHistory();
    fireEvent.click(screen.getByTestId("cell-history-btn"));
    expect(screen.getByTestId("cell-history-popover").querySelector("img")).toBeNull();
    expect(screen.getByTestId("cell-history-row").textContent).toContain("<img");
  });
});

/* ── pure helpers: preview, relative time, diff bounds ───────────────────── */

describe("history pure helpers — bounded previews and diffs", () => {
  it("historyValuePreview clamps megacell values and unwraps CellPayload objects", () => {
    expect(historyValuePreview("$14M")).toBe("$14M");
    expect(historyValuePreview({ value: "$14M", evidence: [] })).toBe("$14M");
    expect(historyValuePreview("")).toBe("—");
    expect(historyValuePreview(null)).toBe("—");
    const huge = historyValuePreview("A".repeat(10_000));
    expect(huge.length).toBeLessThanOrEqual(60);
    expect(huge.endsWith("…")).toBe(true);
  });

  it("displayCellValue unwraps nested CellPayload/formula objects for visible sheet cells", () => {
    expect(displayCellValue({ value: { formula: "=E2-D2", value: 3250 }, status: "complete" })).toBe("3250");
    expect(displayCellValue({ formula: "=E2-D2", value: "+22.4%" })).toBe("+22.4%");
    expect(displayCellValue({ formula: "=E2-D2", value: null })).toBe("=E2-D2");
  });

  it("historyTimeAgo degrades from just-now to minutes/hours/days and rejects junk timestamps", () => {
    const now = Date.parse("2026-07-04T12:00:00Z");
    expect(historyTimeAgo(now - 10_000, now)).toBe("just now");
    expect(historyTimeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(historyTimeAgo(now - 3 * HOUR, now)).toBe("3h ago");
    expect(historyTimeAgo(now - 4 * DAY, now)).toBe("4d ago");
    expect(historyTimeAgo(Number.NaN, now)).toBe("");
    expect(historyTimeAgo(0, now)).toBe("");
  });

  it("wordDiffSegments marks only replaced words and stays bounded on 5,000-word adversarial values", () => {
    const d = wordDiffSegments("revenue up 12% QoQ", "revenue up 18% QoQ");
    expect(d.old.map((s) => s.changed)).toEqual([false, false, true, false]);
    expect(d.next.map((s) => s.changed)).toEqual([false, false, true, false]);
    // Pure insertion: old side fully unchanged.
    const ins = wordDiffSegments("alpha beta", "alpha beta gamma");
    expect(ins.old.every((s) => !s.changed)).toBe(true);
    expect(ins.next[2]).toEqual({ text: "gamma", changed: true });
    // Empty→value and value→empty stay coherent.
    expect(wordDiffSegments("", "new value").old).toHaveLength(0);
    expect(wordDiffSegments("old value", "").next).toHaveLength(0);
    // BOUND: word-level LCS is O(n*m) — both sides clamp.
    const mega = Array.from({ length: 5_000 }, (_, i) => `w${i}`).join(" ");
    const bounded = wordDiffSegments(mega, mega + " tail");
    expect(bounded.old.length).toBeLessThanOrEqual(CELL_DIFF_MAX_WORDS);
    expect(bounded.next.length).toBeLessThanOrEqual(CELL_DIFF_MAX_WORDS);
  });

  it("CellDiff renders the — placeholder for an empty before-image", () => {
    render(<CellDiff version={1} oldValue="" currentValue="fresh" />);
    const diff = screen.getByTestId("cell-diff");
    expect(diff.querySelector(".r-hist-diff-row.old")!.textContent).toContain("—");
    expect(diff.querySelector(".r-hist-diff-row.next")!.textContent).toContain("fresh");
  });
});

/* ── stale chips: amber freshness, never faked ───────────────────────────── */

describe("stale chips — recheck-due surfacing without fake staleness", () => {
  const now = Date.parse("2026-07-04T12:00:00Z");
  const sourced: CellPayload = {
    value: "$14M",
    evidence: [{ id: "e1", kind: "source", label: "Crunchbase", url: "https://crunchbase.com/org/x" }],
  };

  it("labels a checked source older than 72h in whole days and stays quiet at/below the threshold", () => {
    expect(staleLabelFor(now - (STALE_AFTER_MS + 60_000), now)).toBe("3d");
    expect(staleLabelFor(now - 10 * DAY, now)).toBe("10d");
    // Exactly 72h is NOT older than 72h — no chip.
    expect(staleLabelFor(now - STALE_AFTER_MS, now)).toBeUndefined();
    expect(staleLabelFor(now - HOUR, now)).toBeUndefined();
    expect(staleLabelFor(undefined, now)).toBeUndefined();
    expect(staleLabelFor(Number.NaN, now)).toBeUndefined();
    expect(staleLabelFor(0, now)).toBeUndefined();
  });

  it("cells WITHOUT evidence never get a chip, even with an ancient updatedAt (no freshness contract)", () => {
    expect(cellStaleness({ value: "manual note" }, now - 30 * DAY, now)).toBeUndefined();
    expect(cellStaleness(null, now - 30 * DAY, now)).toBeUndefined();
  });

  it("falls back to the element's updatedAt (the receipt's checked timestamp) for evidence cells", () => {
    expect(cellStaleness(sourced, now - 5 * DAY, now)).toBe("5d");
    expect(cellStaleness(sourced, now - HOUR, now)).toBeUndefined();
    // Not wired at all → nothing, never a fabricated label.
    expect(cellStaleness(sourced, undefined, now)).toBeUndefined();
  });

  it("an explicit checkedAt/retrievedAt on the payload or evidence wins over updatedAt (both directions)", () => {
    const freshCheck = {
      ...sourced,
      evidence: [{ ...sourced.evidence![0], checkedAt: now - HOUR } as never],
    } as CellPayload;
    // Re-verified an hour ago: an old commit timestamp must NOT fake staleness.
    expect(cellStaleness(freshCheck, now - 20 * DAY, now)).toBeUndefined();
    const oldCheck = { ...sourced, retrievedAt: now - 6 * DAY } as CellPayload;
    // Retrieved 6d ago but re-committed today: the source is still stale.
    expect(cellStaleness(oldCheck, now - HOUR, now)).toBe("6d");
  });

  it("StaleChip renders the amber mono chip for a label and nothing otherwise", () => {
    render(<StaleChip label="3d" />);
    const chip = screen.getByTestId("stale-chip");
    expect(chip.textContent).toContain("3d");
    expect(chip.className).toContain("r-stale-chip");
    cleanup();
    const { container } = render(<StaleChip label={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});

/* ── trace filters + run grouping ────────────────────────────────────────── */

function trace(over: Partial<TraceEvent>): TraceEvent {
  return {
    id: "t-" + Math.random().toString(36).slice(2),
    roomId: "room1",
    ts: Date.parse("2026-07-04T12:00:00Z"),
    actor: MAYA,
    type: "edit_applied",
    summary: "Maya set r1__funding = $14M",
    ...over,
  } as TraceEvent;
}

describe("trace pure helpers — kinds from prefixes, bounded people, honest AND filters", () => {
  it("traceKindOf collapses type prefixes into the filterable kind set", () => {
    expect(traceKindOf("edit_applied")).toBe("edit");
    expect(traceKindOf("proposal_resolved")).toBe("edit");
    expect(traceKindOf("lock_denied")).toBe("lock");
    expect(traceKindOf("draft_merged")).toBe("merge");
    expect(traceKindOf("semantic_conflict")).toBe("merge");
    expect(traceKindOf("schema_changed")).toBe("schema");
    expect(traceKindOf("notebook_read_model")).toBe("notebook");
    expect(traceKindOf("capture_saved")).toBe("capture"); // live traces are open-typed strings
    expect(traceKindOf("agent_status")).toBe("agent");
    expect(traceKindOf("member_joined")).toBe("room");
    expect(traceKindOf("message")).toBe("room");
  });

  it("traceFilterModel derives only PRESENT kinds (canonical order) and caps people by frequency", () => {
    const log = [
      trace({ type: "lock_acquired", actor: AGENT }),
      trace({ type: "edit_applied", actor: AGENT }),
      trace({ type: "edit_applied", actor: AGENT }),
      trace({ type: "schema_changed", actor: MAYA }),
    ];
    const model = traceFilterModel(log);
    expect(model.kinds).toEqual(["edit", "lock", "schema"]); // no notebook/capture chips invented
    expect(model.people).toEqual(["Room NodeAgent", "Maya"]); // frequency order
    // Adversarial member churn: 50 distinct actors stay bounded to TRACE_PEOPLE_MAX.
    const churn = Array.from({ length: 50 }, (_, i) =>
      trace({ actor: { kind: "user", id: `u${i}`, name: `Guest ${i}` } }));
    expect(traceFilterModel(churn).people).toHaveLength(TRACE_PEOPLE_MAX);
  });

  it("filterTraces applies kind AND person together", () => {
    const log = [
      trace({ type: "edit_applied", actor: MAYA, summary: "maya edit" }),
      trace({ type: "edit_applied", actor: AGENT, summary: "agent edit" }),
      trace({ type: "lock_acquired", actor: AGENT, summary: "agent lock" }),
    ];
    expect(filterTraces(log, null, null)).toHaveLength(3);
    expect(filterTraces(log, "edit", null)).toHaveLength(2);
    expect(filterTraces(log, "edit", "Room NodeAgent").map((t) => t.summary)).toEqual(["agent edit"]);
    expect(filterTraces(log, "schema", null)).toHaveLength(0);
  });

  it("groupTraceBursts folds consecutive same-actor same-minute rows and splits on actor or minute change", () => {
    const t0 = Date.parse("2026-07-04T12:00:00Z");
    const log = [
      trace({ actor: AGENT, ts: t0 + 1_000 }),
      trace({ actor: AGENT, ts: t0 + 20_000 }),
      trace({ actor: MAYA, ts: t0 + 30_000 }), // interleaved human splits the burst
      trace({ actor: AGENT, ts: t0 + 40_000 }),
      trace({ actor: AGENT, ts: t0 + 61_000 }), // next minute = next run group
    ];
    const groups = groupTraceBursts(log);
    expect(groups.map((g) => [g.actor.name, g.rows.length])).toEqual([
      ["Room NodeAgent", 2],
      ["Maya", 1],
      ["Room NodeAgent", 1],
      ["Room NodeAgent", 1],
    ]);
    // Burst scale: a 500-write agent storm inside one minute is ONE group.
    const storm = Array.from({ length: 500 }, (_, i) => trace({ actor: AGENT, ts: t0 + (i % 59) * 1_000 }));
    const stormGroups = groupTraceBursts(storm);
    expect(stormGroups).toHaveLength(1);
    expect(stormGroups[0].rows).toHaveLength(500);
    expect(stormGroups[0].kinds).toEqual(["edit"]);
  });
});

describe("TraceStrip — the 400-event room becomes readable", () => {
  const t0 = Date.parse("2026-07-04T12:00:00Z");
  function mountStrip(log: TraceEvent[]) {
    mockStore.current = {
      mode: "memory",
      listTraces: () => log,
      lastRun: () => null,
      listProposals: () => [],
      listMembers: () => [{ id: MAYA.id, name: MAYA.name, role: "host" }],
    };
    const utils = render(<TraceStrip roomId="room1" me={MAYA} />);
    fireEvent.click(screen.getByLabelText("Expand room trace")); // collapsed by default (no pending proposals)
    return utils;
  }

  function bigLog(): TraceEvent[] {
    const log: TraceEvent[] = [];
    for (let i = 0; i < 120; i++) {
      log.push(trace({ id: `agent-e${i}`, type: "edit_applied", actor: AGENT, ts: t0 + i * 500, summary: `agent wrote cell ${i}` }));
    }
    for (let i = 0; i < 6; i++) {
      log.push(trace({ id: `maya-l${i}`, type: "lock_acquired", actor: MAYA, ts: t0 + 120_000 + i * 61_000, summary: `maya locked range ${i}` }));
    }
    log.push(trace({ id: "schema-1", type: "schema_changed", actor: AGENT, ts: t0 + 600_000, summary: "agent added column funding" }));
    return log;
  }

  it("renders kind + person chips derived from the log, filters honestly, and keeps the 40-row bound (sustained load)", () => {
    const { container } = mountStrip(bigLog());
    // Kind chips: only the kinds present (edit, lock, schema — no fake notebook/capture chips).
    const kindChips = screen.getAllByTestId("trace-filter-kind");
    expect(kindChips.map((c) => c.textContent)).toEqual(["edit", "lock", "schema"]);
    const personChips = screen.getAllByTestId("trace-filter-person");
    expect(personChips.map((c) => c.textContent)).toEqual(["Room NodeAgent", "Maya"]);
    // Unfiltered: BOUND preserved — 127 events render only the newest 40 rows.
    expect(container.querySelectorAll(".r-trace-item")).toHaveLength(40);
    // Filter by lock: exactly Maya's 6 lock rows (filter runs BEFORE the bound).
    fireEvent.click(kindChips[1]);
    expect(container.querySelectorAll(".r-trace-item")).toHaveLength(6);
    expect(container.querySelector(".r-trace-list")!.textContent).toContain("maya locked range");
    // Person filter stacks with kind (AND): agent has no lock events.
    fireEvent.click(personChips[0]);
    expect(container.querySelectorAll(".r-trace-item")).toHaveLength(0);
    expect(container.querySelector(".r-trace-list")!.textContent).toContain("No events match this filter.");
    // Reset via "all".
    fireEvent.click(screen.getByText("all"));
    expect(container.querySelectorAll(".r-trace-item")).toHaveLength(40);
  });

  it("groups the agent's burst into run rows behind the group-by-run toggle and expands on demand", () => {
    const { container } = mountStrip(bigLog());
    fireEvent.click(screen.getByTestId("trace-group-runs"));
    const groups = screen.getAllByTestId("trace-run-group");
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // The agent's same-minute write storm folds into one labeled run row.
    expect(groups[0].textContent).toContain("Room NodeAgent");
    expect(groups[0].textContent).toMatch(/\d+ events · edit/);
    // Collapsed by default; expanding reveals the individual trace rows.
    expect(within(groups[0]).queryAllByText(/agent wrote cell/)).toHaveLength(0);
    fireEvent.click(within(groups[0]).getByRole("button"));
    expect(within(groups[0]).queryAllByText(/agent wrote cell/).length).toBeGreaterThan(0);
    // Toggle off restores the flat bounded list.
    fireEvent.click(screen.getByTestId("trace-group-runs"));
    expect(screen.queryAllByTestId("trace-run-group")).toHaveLength(0);
    expect(container.querySelectorAll(".r-trace-item")).toHaveLength(40);
  });

  it("stays bounded under a 10,000-event sustained log and shows the honest shown/total meta", () => {
    const log = Array.from({ length: 10_000 }, (_, i) =>
      trace({ id: `s${i}`, actor: i % 2 ? MAYA : AGENT, type: i % 3 ? "edit_applied" : "lock_acquired", ts: t0 + i * 1_000 }));
    const { container } = mountStrip(log);
    expect(container.querySelectorAll(".r-trace-item")).toHaveLength(40);
    expect(container.textContent).toContain("40 of 10000");
  });
});
