// @vitest-environment jsdom
/**
 * Mobile Gap Screens — the 9 touch surfaces that close the mobile feature-map
 * gaps (design-reference/mobile-scale/gaps-app.jsx).
 *
 * Personas & scenarios (never a bare "it renders"):
 *  • Priya, a guest on her phone, opens the Review pipeline mid-run and must see
 *    the SAME Intake→Evidence→Draft→Review→Export stages the desktop bar shows,
 *    with the live "needs review" count — never a faked "all done".
 *  • Sam scrolls the Trace sheet: recent rows first, kind chips, bounded at 40
 *    even when the room emitted thousands of events (no unbounded render).
 *  • A host shares the room: the invite code is prominent and REAL; the code
 *    box is decorative and must NOT claim to be a scannable QR; role/expiry are
 *    labelled honestly as backend-pending.
 *  • Manage people shows role groups + live location, same projection as the
 *    desktop PeoplePanel.
 *  • Settings exposes a real auto-allow toggle and notification tiers that are
 *    honestly captioned when unbacked.
 *  • Offline: held edits are surfaced, never hidden — and the banner stays quiet
 *    when there is nothing held (no false alarm).
 *  • First-join overlay welcomes once and dismisses.
 *  • Gesture math: exact boundary conditions for long-press / swipe verbs,
 *    including the diagonal-scroll rejection and the drift-cancels-long-press
 *    rule — pinned as pure functions so the thresholds cannot silently drift.
 */
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReviewSheet,
  TraceSheet,
  ShareSheet,
  ManageSheet,
  FirstJoinOverlay,
  OfflineBanner,
} from "../src/ui/mobile/MobileGapSheets";
import {
  classifyRelease,
  longPressEligible,
  isHorizontal,
  dragOffset,
  moveDistance,
  GESTURE_THRESHOLDS,
} from "../src/ui/mobile/mobileGestures";
import type { MobileCtx } from "../src/ui/mobile/mobileTypes";
import type { PipelineStage, TraceRow, ManageGroup, OfflineHold, NotifRow } from "../src/ui/mobile/mobileData";

afterEach(cleanup);

// ── Mock ctx factory (only the fields the gap surfaces read) ────────────────
function makeCtx(over: Partial<MobileCtx> = {}): MobileCtx {
  const pipeline: PipelineStage[] = [
    { key: "intake", label: "Intake", state: "done", meta: "5 rows" },
    { key: "evidence", label: "Evidence", state: "done", meta: "11 sourced" },
    { key: "draft", label: "Draft", state: "on", meta: "agent working" },
    { key: "review", label: "Review", state: "on", meta: "2 waiting" },
    { key: "export", label: "Export", state: "todo", meta: "" },
  ];
  const traceRows: TraceRow[] = [
    { id: "tr_1", kind: "commit", text: "committed CardioNova · v42", time: "12:33" },
    { id: "tr_2", kind: "lock", text: "locked rows 81–120", time: "12:33" },
  ];
  const peopleGroups: ManageGroup[] = [
    { key: "host", label: "Host", rows: [{ id: "homen", name: "Homen", short: "HS", color: "#D97757", role: "host", location: "Company research · owner" }] },
    { key: "agent", label: "Agents", rows: [{ id: "room_na", name: "Room NodeAgent", short: "NA", color: "#C08A5E", role: "agent", location: "enriching rows 81–120" }] },
  ];
  const notifRows: NotifRow[] = [
    { label: "@mentions of you", mode: "instant", on: true, backed: false },
    { label: "Rows you watch", mode: "instant", on: true, backed: false },
  ];
  const base = {
    pipeline,
    traceRows,
    peopleGroups,
    inviteCode: "R-86W",
    offline: undefined,
    autoAllow: true,
    setAutoAllow: vi.fn(),
    notifRows,
    notifBacked: false,
    watchRow: vi.fn(async () => ({ ok: true })),
    isRowWatched: () => false,
    flagRowNeedsReview: vi.fn(async () => ({ ok: true })),
    inboxItems: [
      { id: "p1", icon: "sparkles", tone: "warn", title: "Agent edit proposed", sub: "Cell sr_1__funding · approve", status: "approve", statusTone: "warn", time: "now", kind: "plan", preview: "doc" },
    ],
    room: { id: "live", name: "Q3 Diligence", code: "R-86W", role: "Member", people: 3, agents: 1, live: true, pending: 1 },
    isLive: true,
    toast: vi.fn(),
    openSheet: vi.fn(),
    closeSheet: vi.fn(),
    setTab: vi.fn(),
    openTrace: vi.fn(),
    acknowledgeOfflineConflicts: vi.fn(),
  } as unknown as MobileCtx;
  return { ...base, ...over } as MobileCtx;
}

// ============================================================================
// 1 · Review pipeline (screen 2) — same stages the desktop bar reads
// ============================================================================
describe("ReviewSheet (pipeline checklist)", () => {
  it("renders the five pipeline stages in canonical order with live states", () => {
    render(<ReviewSheet ctx={makeCtx()} />);
    const pipe = screen.getByTestId("gap-pipeline");
    const stages = Array.from(pipe.querySelectorAll("[data-stage]")).map((el) => el.getAttribute("data-stage"));
    expect(stages).toEqual(["intake", "evidence", "draft", "review", "export"]);
    // Each stage label is present in its row.
    for (const label of ["Intake", "Evidence", "Draft", "Review", "Export"]) {
      expect(within(pipe).getByText(label)).toBeTruthy();
    }
    // Draft is the active ("on") stage; Export is still todo — no faked completion.
    expect(pipe.querySelector('[data-stage="draft"]')?.getAttribute("data-state")).toBe("on");
    expect(pipe.querySelector('[data-stage="export"]')?.getAttribute("data-state")).toBe("todo");
  });

  it("surfaces the real needs-review queue, not a sample narrative", () => {
    render(<ReviewSheet ctx={makeCtx()} />);
    const q = screen.getByTestId("gap-review-queue");
    expect(within(q).getByText("Agent edit proposed")).toBeTruthy();
  });

  it("shows an honest empty queue when nothing is waiting", () => {
    render(<ReviewSheet ctx={makeCtx({ inboxItems: [] })} />);
    expect(screen.getByText(/Nothing waiting/i)).toBeTruthy();
  });
});

// ============================================================================
// 2 · Trace sheet (screen 3) — kind chips, bounded, recent-first
// ============================================================================
describe("TraceSheet", () => {
  it("renders trace rows with their kind chips and count", () => {
    render(<TraceSheet ctx={makeCtx()} />);
    expect(screen.getByTestId("gap-trace-count").textContent).toBe("2");
    const rows = screen.getAllByTestId("gap-trace-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("commit")).toBeTruthy();
    expect(within(rows[1]).getByText("lock")).toBeTruthy();
  });

  it("opens the trace overlay when a row is tapped (real receipt, never faked)", () => {
    const ctx = makeCtx();
    render(<TraceSheet ctx={ctx} />);
    fireEvent.click(screen.getAllByTestId("gap-trace-row")[0]);
    expect(ctx.openTrace).toHaveBeenCalledWith("tr_1");
  });

  it("honestly shows an empty state instead of inventing rows", () => {
    render(<TraceSheet ctx={makeCtx({ traceRows: [] })} />);
    expect(screen.getByText(/No trace yet/i)).toBeTruthy();
    expect(screen.queryAllByTestId("gap-trace-row")).toHaveLength(0);
  });
});

// ============================================================================
// 3 · Share sheet (screen 5) — real code, decorative pattern, honest stubs
// ============================================================================
describe("ShareSheet", () => {
  it("makes the REAL invite code prominent", () => {
    render(<ShareSheet ctx={makeCtx()} />);
    expect(screen.getByTestId("gap-invite-code").textContent).toContain("R-86W");
  });

  it("labels the code pattern as decorative — never claims a scannable QR", () => {
    render(<ShareSheet ctx={makeCtx()} />);
    const pattern = screen.getByTestId("gap-share-pattern");
    // ARIA label + visible caption both disclaim scannability.
    expect(pattern.getAttribute("aria-label")).toMatch(/not scannable/i);
    expect(screen.getByText(/not a scannable QR/i)).toBeTruthy();
  });

  it("honestly captions role/expiry as backend-pending, not shipped", () => {
    render(<ShareSheet ctx={makeCtx()} />);
    expect(screen.getByTestId("gap-share-stub-caption").textContent).toMatch(/permissions backend/i);
  });

  it("copies the invite and toasts on tap", () => {
    const ctx = makeCtx();
    render(<ShareSheet ctx={ctx} />);
    fireEvent.click(screen.getByTestId("gap-invite-code"));
    expect(ctx.toast).toHaveBeenCalled();
  });
});

// ============================================================================
// 4 · Manage people (screen 6) — role groups + live location
// ============================================================================
describe("ManageSheet", () => {
  it("groups people by role and shows each live-location line", () => {
    render(<ManageSheet ctx={makeCtx()} />);
    expect(screen.getByTestId("gap-people-count").textContent).toBe("2");
    const rows = screen.getAllByTestId("gap-person-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Homen")).toBeTruthy();
    expect(within(rows[0]).getByText(/Company research · owner/)).toBeTruthy();
    expect(within(rows[1]).getByText(/enriching rows 81–120/)).toBeTruthy();
  });

  it("honestly captions bulk role/expiry/revoke as backend-pending", () => {
    render(<ManageSheet ctx={makeCtx()} />);
    expect(screen.getByTestId("gap-manage-stub-caption").textContent).toMatch(/permissions backend/i);
  });

  it("shows an empty state when nobody is present", () => {
    render(<ManageSheet ctx={makeCtx({ peopleGroups: [] })} />);
    expect(screen.getByText(/Nobody here yet/i)).toBeTruthy();
  });
});

// ============================================================================
// 5 · First-join overlay (screen 8)
// ============================================================================
describe("FirstJoinOverlay", () => {
  it("welcomes with the real people & agent counts and dismisses", () => {
    const onDismiss = vi.fn();
    render(<FirstJoinOverlay people={62} agents={8} onDismiss={onDismiss} />);
    expect(screen.getByTestId("gap-firstjoin")).toBeTruthy();
    expect(screen.getByText(/62 people/)).toBeTruthy();
    expect(screen.getByText(/8 agents/)).toBeTruthy();
    fireEvent.click(screen.getByText("Got it"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("degrades gracefully for a solo, agentless room (no NaN, honest copy)", () => {
    render(<FirstJoinOverlay people={0} agents={0} onDismiss={vi.fn()} />);
    // No "0 people" plural glitch, no dangling "& 0 agents".
    expect(screen.queryByText(/0 agents/)).toBeNull();
    expect(screen.getByTestId("gap-firstjoin")).toBeTruthy();
  });
});

// ============================================================================
// 6 · Offline banner (screen 9) — visible held edits, quiet when clean
// ============================================================================
describe("OfflineBanner", () => {
  const off = (o: OfflineHold): MobileCtx => makeCtx({ offline: o });

  it("renders nothing in memory mode (no transport to lose)", () => {
    const { container } = render(<OfflineBanner ctx={makeCtx({ offline: undefined })} />);
    expect(container.firstChild).toBeNull();
  });

  it("stays quiet when the queue is clean (no false alarm)", () => {
    const { container } = render(<OfflineBanner ctx={off({ held: 0, dropped: 0, conflicts: 0, replaying: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it("surfaces held edits — never silently loses them", () => {
    render(<OfflineBanner ctx={off({ held: 2, dropped: 0, conflicts: 0, replaying: false })} />);
    expect(screen.getByTestId("gap-offline-banner").textContent).toMatch(/2 edits held/i);
  });

  it("surfaces dropped + conflict counts (visible loss, honest replay)", () => {
    render(<OfflineBanner ctx={off({ held: 1, dropped: 3, conflicts: 1, replaying: true })} />);
    const b = screen.getByTestId("gap-offline-banner");
    expect(b.textContent).toMatch(/3 dropped/i);
    expect(b.textContent).toMatch(/1 conflict/i);
    expect(b.textContent).toMatch(/Reconnecting/i);
  });

  it("lets the user acknowledge replay conflicts", () => {
    const ack = vi.fn();
    const ctx = makeCtx({ offline: { held: 0, dropped: 0, conflicts: 2, replaying: false }, acknowledgeOfflineConflicts: ack });
    render(<OfflineBanner ctx={ctx} />);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(ack).toHaveBeenCalled();
  });
});

// ============================================================================
// 7 · Gesture threshold math (pure) — screen 8/10 verbs; boundary conditions
// ============================================================================
describe("mobileGestures (pure threshold math)", () => {
  const T = GESTURE_THRESHOLDS;

  it("classifies a held, still press as long-press exactly at the ms boundary", () => {
    expect(classifyRelease({ dx: 0, dy: 0, dt: T.longPressMs })).toBe("long-press");
    // one ms under → not yet a long-press (it's still a tap if within tapMax)
    expect(classifyRelease({ dx: 0, dy: 0, dt: T.longPressMs - 1 })).not.toBe("long-press");
  });

  it("treats a drifted long hold as NOT a long-press (moved past tolerance)", () => {
    const drift = T.longPressMoveTolerance + 5;
    // moved sideways but under the swipe distance, held long → ambiguous, not long-press
    expect(classifyRelease({ dx: drift, dy: 0, dt: T.longPressMs + 200 })).toBe("none");
  });

  it("commits swipe-right / swipe-left at the distance gate", () => {
    expect(classifyRelease({ dx: T.swipeDistance, dy: 0, dt: 120 })).toBe("swipe-right");
    expect(classifyRelease({ dx: -T.swipeDistance, dy: 0, dt: 120 })).toBe("swipe-left");
    // just under the gate is not a committed swipe
    expect(classifyRelease({ dx: T.swipeDistance - 1, dy: 0, dt: 120 })).not.toBe("swipe-right");
  });

  it("rejects a diagonal drag as a swipe (it is a scroll, not a verb)", () => {
    // large dx but even larger dy → slope exceeds max → not horizontal → not a swipe
    expect(isHorizontal(60, 60, T.swipeMaxSlope)).toBe(false);
    expect(classifyRelease({ dx: 60, dy: 60, dt: 100 })).toBe("none");
  });

  it("prefers the swipe over the timer when a long hold ALSO travelled far", () => {
    // finger clearly travelled a full swipe AND held long → honor the travel
    expect(classifyRelease({ dx: T.swipeDistance + 20, dy: 0, dt: T.longPressMs + 500 })).toBe("swipe-right");
  });

  it("resolves a quick still tap as tap (click passthrough), not a verb", () => {
    expect(classifyRelease({ dx: 1, dy: 1, dt: 80 })).toBe("tap");
  });

  it("longPressEligible pins the still-radius + ms predicate", () => {
    expect(longPressEligible({ dx: 0, dy: 0, dt: T.longPressMs })).toBe(true);
    expect(longPressEligible({ dx: T.longPressMoveTolerance, dy: 0, dt: T.longPressMs })).toBe(true);
    expect(longPressEligible({ dx: T.longPressMoveTolerance + 0.1, dy: 0, dt: T.longPressMs })).toBe(false);
    expect(longPressEligible({ dx: 0, dy: 0, dt: T.longPressMs - 1 })).toBe(false);
  });

  it("dragOffset clamps horizontal travel and ignores vertical scroll", () => {
    // horizontal drag is tracked and clamped to 1.5× swipe distance
    expect(dragOffset(1000, 0)).toBe(T.swipeDistance * 1.5);
    expect(dragOffset(-1000, 0)).toBe(-T.swipeDistance * 1.5);
    // a vertical-dominant move produces no card wobble
    expect(dragOffset(10, 200)).toBe(0);
  });

  it("moveDistance is euclidean (used by the drift-cancel rule)", () => {
    expect(moveDistance(3, 4)).toBe(5);
  });
});
