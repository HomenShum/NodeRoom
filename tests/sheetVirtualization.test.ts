// @vitest-environment jsdom
/**
 * TRUE ROW VIRTUALIZATION + presence cursor ladder on the generic/scale sheet
 * (src/ui/panels/Artifact.tsx owner pass — GenericSheet).
 *
 * Persona: Priya opens the "Company research" scale sheet — 1,000+ enriched
 * account rows the room agent is still writing. The old renderer painted a
 * fixed 23-row window with a "Show next" button; she could never jump to row
 * 900 without clicking twenty times, and a 100k-row workbook would have tried
 * to mount 100k <td>s. Now the sheet scroll-virtualizes: only the rows around
 * the viewport mount, between top/bottom spacer rows sized from the fixed 44px
 * row height, so the scrollbar stays honest and the DOM stays bounded. The row
 * she has selected stays mounted even after she scrolls it out of view (an
 * agent/QA focus must never unmount mid-interaction). And when 1, 3, or 5
 * teammates land on the same cell, the single presence badge becomes a cursor
 * ladder: one named flag → a small stack → a "+N" cluster pill.
 *
 * Angles covered:
 *  - happy path: top / middle / bottom scroll windows compute correctly.
 *  - pinning: a focused row OUTSIDE the window is reported (never unmounted).
 *  - edge clamping: scrollTop past the end, tiny/zero viewport, 0 rows.
 *  - scale math is O(1): 100k and 100M rows cost the same, no per-row walk.
 *  - jsdom render of a 1,000-row sheet: spacer heights + rendered-row count +
 *    "rows X-Y rendered" chip honesty (the chip must not lie about the window).
 *  - ladder rungs: 1 claim = flag, 3 = stack (bounded members), 5 = cluster +N;
 *    self is excluded; expired claims are ignored; the ladder is pointer-events
 *    none so the cell keeps its behavior.
 *
 * Same harness as tests/cellHistoryUi.test.tsx: convex/react + the store are
 * mocked; the real GenericSheet mounts in jsdom so the windowing wiring, the
 * spacer rows, and the ladder DOM are the real thing.
 */
import { render, screen, cleanup, act as reactAct } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Artifact as Art, DataframeColumn } from "../src/engine/types";
import type { PresenceClaim } from "../src/app/store";

// The ladder's pointer-events:none contract lives in the (non-JS-loaded) receipts stylesheet;
// read it as text so we can assert the contract that jsdom cannot compute.
const LADDER_CSS = readFileSync(resolve(__dirname, "../src/ui/panels/artifact-receipts.css"), "utf8");

const mockStore = vi.hoisted(() => ({ current: {} as any }));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}));
vi.mock("../src/app/store", () => ({ useStore: () => mockStore.current }));

import {
  GenericSheet,
  PresenceLadder,
  presenceLadderModel,
  computeRowWindow,
  SCALE_SHEET_ROW_PX,
  SCALE_SHEET_OVERSCAN,
} from "../src/ui/panels/Artifact";

const PRIYA: Actor = { kind: "user", id: "u_priya", name: "Priya" };
const ROW = SCALE_SHEET_ROW_PX; // 44
const OVER = SCALE_SHEET_OVERSCAN; // 8

/* ─────────────────────────── pure computeRowWindow ─────────────────────────── */

describe("computeRowWindow — pure scroll-driven windowing math", () => {
  it("top of a large sheet: window starts at 0, top spacer is 0, bottom spacer covers the rest", () => {
    const w = computeRowWindow(0, 660, 1_000);
    expect(w.start).toBe(0);
    // visible band = ceil(660/44) = 15 rows; + overscan below.
    expect(w.end).toBe(Math.min(1_000, 15 + OVER));
    expect(w.topPad).toBe(0);
    expect(w.bottomPad).toBe((1_000 - w.end) * ROW);
    expect(w.focusedPinned).toBe(false);
  });

  it("middle scroll: window brackets the viewport with overscan and honest spacers", () => {
    const scrollTop = 500 * ROW; // scrolled to row 500
    const w = computeRowWindow(scrollTop, 660, 1_000);
    const firstVisible = Math.floor(scrollTop / ROW); // 500
    const lastVisible = Math.ceil((scrollTop + 660) / ROW); // 500 + 15
    expect(w.start).toBe(firstVisible - OVER); // 492
    expect(w.end).toBe(lastVisible + OVER); // 523
    // Spacers exactly reconstruct the un-mounted rows' height → scrollbar stays honest.
    expect(w.topPad).toBe(w.start * ROW);
    expect(w.bottomPad).toBe((1_000 - w.end) * ROW);
    // topPad + rendered-rows-height + bottomPad === full virtual height.
    expect(w.topPad + (w.end - w.start) * ROW + w.bottomPad).toBe(1_000 * ROW);
  });

  it("bottom: scrolled past the last row clamps end to totalRows and zeroes the bottom spacer", () => {
    const scrollTop = 10_000 * ROW; // way past the 1,000 rows
    const w = computeRowWindow(scrollTop, 660, 1_000);
    expect(w.end).toBe(1_000);
    expect(w.start).toBeLessThanOrEqual(1_000);
    expect(w.bottomPad).toBe(0);
    expect(w.start).toBeGreaterThanOrEqual(0);
  });

  it("pins a focused row that falls OUTSIDE the window; not pinned when inside", () => {
    // Viewport at the top, focus at row 800 → outside → pinned.
    const outside = computeRowWindow(0, 660, 1_000, 800);
    expect(outside.focusedPinned).toBe(true);
    // Focus at row 5, which is inside the top window → not pinned (already mounted).
    const inside = computeRowWindow(0, 660, 1_000, 5);
    expect(inside.focusedPinned).toBe(false);
    // Focus index out of range (>= total) is never pinned.
    expect(computeRowWindow(0, 660, 1_000, 5_000).focusedPinned).toBe(false);
    expect(computeRowWindow(0, 660, 1_000, -1).focusedPinned).toBe(false);
  });

  it("edge clamps: zero rows, zero/negative viewport, negative scroll never produce a negative or inverted window", () => {
    const empty = computeRowWindow(0, 660, 0);
    expect(empty).toMatchObject({ start: 0, end: 0, topPad: 0, bottomPad: 0, focusedPinned: false });
    const zeroView = computeRowWindow(0, 0, 1_000);
    expect(zeroView.start).toBe(0);
    expect(zeroView.end).toBe(OVER); // ceil(0)=0, +overscan, clamped ≥ start
    const negScroll = computeRowWindow(-500, 660, 1_000);
    expect(negScroll.start).toBe(0); // negative scroll treated as top
    // end is always ≥ start; spacers never negative.
    for (const w of [empty, zeroView, negScroll]) {
      expect(w.end).toBeGreaterThanOrEqual(w.start);
      expect(w.topPad).toBeGreaterThanOrEqual(0);
      expect(w.bottomPad).toBeGreaterThanOrEqual(0);
    }
  });

  it("scale math is O(1): 100k and 100M rows cost the same and never mount more than the band", () => {
    const scrollTop = 50_000 * ROW;
    const w100k = computeRowWindow(scrollTop, 660, 100_000);
    const w100m = computeRowWindow(scrollTop, 660, 100_000_000);
    // Same viewport → same rendered band size regardless of total magnitude.
    expect(w100k.end - w100k.start).toBe(w100m.end - w100m.start);
    // Rendered band is bounded (viewport rows + 2×overscan), independent of totalRows.
    const bandRows = w100m.end - w100m.start;
    expect(bandRows).toBeLessThanOrEqual(Math.ceil(660 / ROW) + 2 * OVER + 1);
    // Bottom spacer scales with the (unmounted) remainder — 100M rows still reconstruct honestly.
    expect(w100m.topPad + bandRows * ROW + w100m.bottomPad).toBe(100_000_000 * ROW);
  });
});

/* ─────────────────── jsdom render of a 1,000-row scale sheet ─────────────────── */

function makeScaleArt(rowCount: number): Art {
  const columns: DataframeColumn[] = [
    { id: "company", label: "Company", order: 0, mode: "manual", type: "text", agentWritable: false },
    { id: "status", label: "Status", order: 1, mode: "manual", type: "text", agentWritable: true },
    { id: "funding", label: "Funding", order: 2, mode: "enrich", type: "text", agentWritable: true },
  ];
  const elements: Record<string, unknown> = {};
  const order: string[] = [];
  for (let r = 1; r <= rowCount; r++) {
    const rid = `sr_${String(r).padStart(4, "0")}`;
    for (const col of columns) {
      const id = `${rid}__${col.id}`;
      order.push(id);
      elements[id] = { value: col.id === "company" ? `Acct ${r}` : col.id === "status" ? "complete" : `$${r}M`, version: 1, updatedAt: 1_000, updatedBy: PRIYA };
    }
  }
  return {
    id: "art_scale",
    roomId: "r1",
    kind: "sheet",
    title: "Company research",
    version: 3,
    elements: elements as Art["elements"],
    order,
    updatedAt: 1_000,
    meta: { dataframe: { columns, rowCount, sourceFile: "scale-demo", parser: "seed", truncated: false, warnings: [] } },
  } as unknown as Art;
}

function baseStore(presence: PresenceClaim[] = []) {
  return {
    mode: "memory" as const,
    listPresence: () => presence,
    listProposals: () => [],
    listDrafts: () => [],
    lockFor: () => null,
    listMembers: () => [{ id: PRIYA.id, name: PRIYA.name, role: "host", color: "#8A4B38" }],
    getArtifact: () => undefined,
    applyEdit: vi.fn(async () => ({ ok: true })),
  };
}

function renderScaleSheet(art: Art) {
  mockStore.current = baseStore();
  return render(createElement(GenericSheet, { roomId: "r1", me: PRIYA, art }));
}

describe("GenericSheet virtualization — Priya opens the 1,000-row scale sheet", () => {
  it("mounts only the top window (not all 1,000 rows), with a zero top spacer and a bottom spacer sized to the remainder", () => {
    const { container } = renderScaleSheet(makeScaleArt(1_000));
    // Only a bounded window of rows mount — never 1,000 rows' worth of cells.
    const dataRows = container.querySelectorAll("tbody tr:not(.r-vrow-spacer):not(.r-row-add)");
    expect(dataRows.length).toBeGreaterThan(0);
    expect(dataRows.length).toBeLessThan(60); // window + overscan, nowhere near 1,000

    // jsdom has no layout: scrollTop=0, clientHeight falls back to 640 → window starts at row 0.
    const topSpacer = container.querySelector<HTMLElement>('[data-testid="grid-spacer-top"]');
    const bottomSpacer = container.querySelector<HTMLElement>('[data-testid="grid-spacer-bottom"]');
    // Top window: no top spacer (start at 0), bottom spacer stands in for the unmounted tail.
    expect(topSpacer).toBeNull();
    expect(bottomSpacer).not.toBeNull();
    const bottomPx = parseInt(bottomSpacer!.style.height, 10);
    expect(bottomPx).toBeGreaterThan(0);
    // Honest spacer: bottom spacer + mounted-rows height reconstruct the full virtual height.
    const mountedRows = dataRows.length;
    expect(bottomPx).toBe((1_000 - mountedRows) * ROW);
  });

  it("keeps the 'rows X-Y rendered' meta chip HONEST — it names the true mounted band, not a fake count", () => {
    const { container } = renderScaleSheet(makeScaleArt(1_000));
    const chip = container.querySelector<HTMLElement>('[data-testid="grid-render-window"]');
    expect(chip).not.toBeNull();
    const dataRows = container.querySelectorAll("tbody tr:not(.r-vrow-spacer):not(.r-row-add)").length;
    // Chip must read "rows 1-<N> rendered" where N === the actual mounted row count.
    expect(chip!.textContent).toMatch(/^rows 1-\d+ rendered$/);
    const claimed = parseInt(chip!.textContent!.match(/rows 1-(\d+)/)![1], 10);
    expect(claimed).toBe(dataRows);
  });

  it("shows the true total (1,000 rows) in the scale count chip and NO 'Show next' paging button", () => {
    const { container } = renderScaleSheet(makeScaleArt(1_000));
    expect(container.querySelector('[data-testid="grid-scale-count"]')!.textContent).toContain("1,000 rows");
    // Scroll-virtualized sheets have no page button (scroll drives the window).
    expect([...container.querySelectorAll(".r-mini-btn")].some((b) => /Show next/.test(b.textContent ?? ""))).toBe(false);
  });

  it("scrolling to the middle re-windows: a top spacer appears and the mounted band moves down", () => {
    // Drive rAF synchronously so the scroll-sync effect flushes deterministically (jsdom's real rAF
    // is timer-backed and races the assertion). Restored in afterEach via restoreAllMocks.
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 1 as unknown as number; });
    const { container } = renderScaleSheet(makeScaleArt(1_000));
    const wrap = container.querySelector<HTMLElement>(".r-sheet-wrap")!;
    // jsdom reports 0 for layout metrics; force a real viewport + scroll offset.
    Object.defineProperty(wrap, "clientHeight", { configurable: true, value: 660 });
    Object.defineProperty(wrap, "scrollTop", { configurable: true, writable: true, value: 500 * ROW });
    reactAct(() => { wrap.dispatchEvent(new Event("scroll")); });

    const topSpacer = container.querySelector<HTMLElement>('[data-testid="grid-spacer-top"]');
    expect(topSpacer).not.toBeNull();
    const topPx = parseInt(topSpacer!.style.height, 10);
    // Top spacer accounts for the ~492 rows above the window (500 − overscan).
    expect(topPx).toBe((500 - OVER) * ROW);
    // The first mounted row is no longer account 1 — the window slid down.
    const firstRowNum = container.querySelector("tbody tr:not(.r-vrow-spacer) td.r-rownum")!.textContent;
    expect(Number(firstRowNum)).toBeGreaterThan(1);
    // The render-window chip stays honest to the NEW band (not "rows 1-N").
    const chip = container.querySelector<HTMLElement>('[data-testid="grid-render-window"]')!;
    expect(chip.textContent).toMatch(/^rows (49[0-9]|50[0-9]|51[0-9])-\d+ rendered$/);
    rafSpy.mockRestore();
  });
});

/* ──────────────────────── presence cursor ladder rungs ──────────────────────── */

function claim(over: Partial<PresenceClaim> & { actor: Actor }): PresenceClaim {
  return {
    id: "p_" + Math.random().toString(36).slice(2),
    roomId: "r1",
    artifactId: "art_scale",
    targetKind: "cell",
    targetId: "sr_0001__funding",
    mode: "focus",
    label: over.actor.name,
    color: "#5E6AD2",
    updatedAt: 1_000,
    expiresAt: Date.now() + 60_000,
    ...over,
  } as PresenceClaim;
}

function actors(n: number): Actor[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "user", id: `u_${i}`, name: `Guest ${i}` }));
}

describe("presenceLadderModel — the ladder rung for one cell", () => {
  it("1 claim = flag, 3 = stack (bounded members), 5 = cluster with the honest total count", () => {
    const one = actors(1).map((a) => claim({ actor: a }));
    const three = actors(3).map((a) => claim({ actor: a }));
    const five = actors(5).map((a) => claim({ actor: a }));

    expect(presenceLadderModel(one, "sr_0001__funding", PRIYA.id).mode).toBe("flag");
    const m3 = presenceLadderModel(three, "sr_0001__funding", PRIYA.id);
    expect(m3.mode).toBe("stack");
    expect(m3.count).toBe(3);
    const m5 = presenceLadderModel(five, "sr_0001__funding", PRIYA.id);
    expect(m5.mode).toBe("cluster");
    expect(m5.count).toBe(5); // honest total…
    expect(m5.members.length).toBeLessThanOrEqual(3); // …but the preview is bounded (never a 5-entry array)
  });

  it("excludes self and ignores expired claims / other targets", () => {
    const mixed = [
      claim({ actor: PRIYA }), // self — dropped
      claim({ actor: actors(1)[0], expiresAt: Date.now() - 1 }), // expired — dropped
      claim({ actor: { kind: "user", id: "u_x", name: "Xavier" }, targetId: "sr_0002__funding" }), // other cell
      claim({ actor: { kind: "user", id: "u_y", name: "Yara" } }), // the only live one on this cell
    ];
    const m = presenceLadderModel(mixed, "sr_0001__funding", PRIYA.id);
    expect(m.mode).toBe("flag");
    expect(m.count).toBe(1);
    expect(m.members[0].name).toBe("Yara");
  });
});

describe("PresenceLadder DOM — flag / stack / cluster, pointer-events none", () => {
  it("renders nothing when no one else is on the cell", () => {
    const { container } = render(createElement(PresenceLadder, { rows: [], elementId: "sr_0001__funding", selfId: PRIYA.id }));
    expect(container.firstChild).toBeNull();
  });

  it("renders a single named flag for 1 claim, on the passive .r-presence-ladder layer", () => {
    const rows = [claim({ actor: { kind: "user", id: "u_ana", name: "Ana" } })];
    render(createElement(PresenceLadder, { rows, elementId: "sr_0001__funding", selfId: PRIYA.id }));
    const flag = screen.getByTestId("presence-flag");
    expect(flag.querySelectorAll(".sc-flag")).toHaveLength(1);
    expect(flag.textContent).toContain("Ana");
    // Passive read — the ladder lives on the .r-presence-ladder layer which the stylesheet pins to
    // pointer-events:none (jsdom does not apply the imported CSS, so we assert the contract in CSS).
    expect(flag.className).toContain("r-presence-ladder");
    expect(LADDER_CSS).toMatch(/\.r-presence-ladder\s*\{[^}]*pointer-events:\s*none/);
  });

  it("renders a bounded stack for 3 claims (freshest first) and a +N cluster for 5", () => {
    const three = actors(3).map((a, i) => claim({ actor: a, updatedAt: 1_000 + i }));
    const { rerender, container } = render(createElement(PresenceLadder, { rows: three, elementId: "sr_0001__funding", selfId: PRIYA.id }));
    const stack = screen.getByTestId("presence-stack");
    expect(stack.querySelectorAll(".sc-flag")).toHaveLength(3);

    const five = actors(5).map((a) => claim({ actor: a }));
    rerender(createElement(PresenceLadder, { rows: five, elementId: "sr_0001__funding", selfId: PRIYA.id }));
    const cluster = screen.getByTestId("presence-cluster");
    expect(cluster.className).toContain("sc-cluster");
    expect(cluster.textContent).toBe("+5");
    expect(cluster.getAttribute("data-count")).toBe("5");
    // No stray flag DOM once we collapse to a cluster.
    expect(container.querySelectorAll(".sc-flag")).toHaveLength(0);
  });
});

afterEach(() => cleanup());
beforeEach(() => { mockStore.current = baseStore(); });
