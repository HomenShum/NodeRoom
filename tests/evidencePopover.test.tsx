// @vitest-environment jsdom
/**
 * In-cell evidence hover popover — the receipts payoff.
 *
 * Scenario: an analyst reviewing an agent-enriched company-research sheet
 * hovers (or keyboard-focuses) the "N src" cite chip on a funding cell to
 * audit the receipts — label, quoted snippet, source host link, confidence,
 * and when the source was checked — before trusting the number.
 *
 * Covers: happy path (2 receipts), overflow (+N more bound), degraded
 * receipts (no snippet / no url / null payload), adversarial inputs
 * (hostile scheme, oversized snippet, out-of-range confidence, 5k receipts),
 * grid-editing safety (chip/link clicks don't bubble into cell selection),
 * and viewport-aware placement (flip up near the bottom, left-anchor at the
 * left edge).
 */
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellEvidence, CellPayload } from "../src/engine/types";

const mockStore = vi.hoisted(() => ({ current: {} as any }));

vi.mock("convex/react", () => ({ useQuery: () => null, useMutation: () => () => Promise.resolve() }));
vi.mock("../src/app/store", () => ({ useStore: () => mockStore.current }));

import {
  EvidenceReceipt,
  evidencePopoverModel,
  evidenceCheckedLabel,
  evidencePopoverPlacement,
  EVIDENCE_POPOVER_MAX_ITEMS,
  EVIDENCE_POPOVER_SNIPPET_MAX,
} from "../src/ui/panels/Artifact";

function ev(over: Partial<CellEvidence>): CellEvidence {
  return { id: "e-" + Math.random().toString(36).slice(2), kind: "source", label: "web source", ...over };
}

const fundingPayload: CellPayload = {
  value: "$14M Series A",
  status: "complete",
  confidence: 0.87,
  evidence: [
    ev({ id: "e1", label: "CardioNova product page", url: "https://www.cardionova.example/product", snippet: "CardioNova provides AI-assisted triage for hospital emergency departments.", confidence: 0.92 }),
    ev({ id: "e2", label: "Crunchbase funding round", url: "https://crunchbase.com/org/cardionova", snippet: "Series A, $14M, led by Meridian Health Ventures.", confidence: 0.81 }),
  ],
};

afterEach(() => cleanup());

describe("EvidenceReceipt popover — analyst audits a sourced cell", () => {
  it("renders the chip with the source count and a full receipt popover (labels, quotes, host links, confidence, checked line)", () => {
    const noon = new Date();
    noon.setHours(12, 32, 0, 0);
    render(<EvidenceReceipt payload={fundingPayload} checkedAt={noon.getTime()} />);

    // The chip keeps its contract: "N src", tooltip, keyboard focusable.
    const chip = screen.getByTestId("grid-cite-chip");
    expect(chip.textContent).toBe("2 src");
    expect(chip.tabIndex).toBe(0);

    const pop = screen.getByTestId("evidence-popover");
    // Both receipts: label + quoted snippet + host-only link + per-item confidence.
    expect(within(pop).getByText("CardioNova product page")).toBeTruthy();
    expect(within(pop).getByText("Crunchbase funding round")).toBeTruthy();
    expect(pop.textContent).toContain("CardioNova provides AI-assisted triage");
    expect(pop.textContent).toContain("Series A, $14M");
    const links = within(pop).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["cardionova.example", "crunchbase.com"]);
    expect(links[0].getAttribute("href")).toBe("https://www.cardionova.example/product");
    expect(links[0].getAttribute("rel")).toBe("noreferrer");
    expect(pop.textContent).toContain("92%");
    expect(pop.textContent).toContain("81%");
    // Checked/updated footer line + payload confidence.
    expect(pop.textContent).toContain("checked 12:32");
    expect(pop.textContent).toContain("87% confidence");
    // No "+N more" when everything fits.
    expect(screen.queryByTestId("evidence-popover-more")).toBeNull();
  });

  it("keeps the legacy grid-cite-popover testid working (e2e decision-assistant contract)", () => {
    render(<EvidenceReceipt payload={fundingPayload} />);
    const legacy = screen.getByTestId("grid-cite-popover");
    expect(legacy.textContent).toMatch(/cardionova/i);
  });

  it("caps rendering at 4 receipts and shows '+N more' when the agent stacked six sources", () => {
    const payload: CellPayload = {
      value: "x",
      evidence: Array.from({ length: 6 }, (_, i) => ev({ id: `s${i}`, label: `Source ${i}`, url: `https://host${i}.example/page` })),
    };
    render(<EvidenceReceipt payload={payload} />);
    expect(screen.getByTestId("grid-cite-chip").textContent).toBe("6 src");
    const pop = screen.getByTestId("evidence-popover");
    expect(pop.querySelectorAll(".r-evidence-item")).toHaveLength(EVIDENCE_POPOVER_MAX_ITEMS);
    expect(screen.getByTestId("evidence-popover-more").textContent).toBe("+2 more");
  });

  it("degrades honestly: manual receipt with no snippet/url shows the kind label as text, no link, no empty quote", () => {
    const payload: CellPayload = { value: "manual entry", evidence: [ev({ id: "m1", kind: "manual", label: "Homen typed this", url: undefined, snippet: undefined })] };
    render(<EvidenceReceipt payload={payload} />);
    const pop = screen.getByTestId("evidence-popover");
    expect(within(pop).queryAllByRole("link")).toHaveLength(0);
    expect(pop.querySelector(".r-evidence-quote")).toBeNull();
    expect(pop.textContent).toContain("manual entry");
    // No checkedAt → honest fallback, no fabricated timestamp.
    expect(pop.textContent).toContain("source checked");
    expect(pop.textContent).not.toContain("checked 0");
  });

  it("renders nothing at all for cells without evidence (calm by default)", () => {
    const { container } = render(<EvidenceReceipt payload={{ value: 42 }} />);
    expect(container.firstChild).toBeNull();
    const empty = render(<EvidenceReceipt payload={null} />);
    expect(empty.container.firstChild).toBeNull();
  });

  it("does not bubble chip or link clicks into the cell (grid selection/editing stays untouched)", () => {
    const onCellClick = vi.fn();
    render(
      <div onClick={onCellClick} data-testid="host-cell">
        <EvidenceReceipt payload={fundingPayload} />
      </div>,
    );
    fireEvent.click(screen.getByTestId("grid-cite-chip"));
    const pop = screen.getByTestId("evidence-popover");
    fireEvent.click(within(pop).getAllByRole("link")[0]);
    expect(onCellClick).not.toHaveBeenCalled();
    // Sanity: the host cell itself still receives its own clicks.
    fireEvent.click(screen.getByTestId("host-cell"));
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });
});

describe("evidencePopoverModel — adversarial and scale inputs", () => {
  it("drops non-http(s) URLs so hostile schemes render as text, never as a link", () => {
    const model = evidencePopoverModel({ value: "x", evidence: [ev({ id: "bad", label: "poisoned", url: "javascript:alert(1)" })] });
    expect(model.items[0].href).toBeUndefined();
    render(<EvidenceReceipt payload={{ value: "x", evidence: [ev({ id: "bad", label: "poisoned", url: "javascript:alert(1)" })] }} />);
    expect(within(screen.getByTestId("evidence-popover")).queryAllByRole("link")).toHaveLength(0);
  });

  it("caps runaway snippets with an ellipsis (BOUND_READ on receipt text)", () => {
    const huge = "A".repeat(5_000);
    const model = evidencePopoverModel({ value: "x", evidence: [ev({ id: "big", label: "long", snippet: huge, url: "https://a.example" })] });
    expect(model.items[0].snippet!.length).toBeLessThanOrEqual(EVIDENCE_POPOVER_SNIPPET_MAX);
    expect(model.items[0].snippet!.endsWith("…")).toBe(true);
  });

  it("clamps out-of-range confidence instead of rendering fake >100% receipts", () => {
    const model = evidencePopoverModel({
      value: "x",
      confidence: 3.7,
      evidence: [ev({ id: "hi", label: "over", confidence: 42 }), ev({ id: "lo", label: "under", confidence: -1 }), ev({ id: "nan", label: "nan", confidence: Number.NaN })],
    });
    expect(model.confidencePct).toBe(100);
    expect(model.items.map((i) => i.confidencePct)).toEqual([100, 0, undefined]);
  });

  it("stays bounded when an agent loop stacked 5,000 receipts on one cell", () => {
    const payload: CellPayload = {
      value: "x",
      evidence: Array.from({ length: 5_000 }, (_, i) => ev({ id: `r${i}`, label: `Receipt ${i}`, url: `https://r${i}.example` })),
    };
    const model = evidencePopoverModel(payload);
    expect(model.count).toBe(5_000);
    expect(model.items).toHaveLength(EVIDENCE_POPOVER_MAX_ITEMS);
    expect(model.moreCount).toBe(5_000 - EVIDENCE_POPOVER_MAX_ITEMS);
    render(<EvidenceReceipt payload={payload} />);
    expect(screen.getByTestId("evidence-popover").querySelectorAll(".r-evidence-item")).toHaveLength(EVIDENCE_POPOVER_MAX_ITEMS);
    expect(screen.getByTestId("evidence-popover-more").textContent).toBe("+4996 more");
  });
});

describe("evidenceCheckedLabel — checked/updated timestamp line", () => {
  it("formats same-day timestamps as checked HH:MM", () => {
    const now = new Date(2026, 6, 3, 12, 32).getTime();
    expect(evidenceCheckedLabel(new Date(2026, 6, 3, 9, 5).getTime(), now)).toBe("checked 09:05");
  });

  it("includes the date for older receipts and returns undefined for missing/invalid timestamps", () => {
    const now = new Date(2026, 6, 3, 12, 0).getTime();
    expect(evidenceCheckedLabel(new Date(2026, 5, 12, 8, 15).getTime(), now)).toMatch(/^checked .*08:15$/);
    expect(evidenceCheckedLabel(undefined, now)).toBeUndefined();
    expect(evidenceCheckedLabel(0, now)).toBeUndefined();
    expect(evidenceCheckedLabel(Number.NaN, now)).toBeUndefined();
  });
});

describe("evidencePopoverPlacement — viewport-aware flip/align", () => {
  const viewport = { width: 1280, height: 800 };

  it("opens downward-right by default (mid-viewport cell)", () => {
    expect(evidencePopoverPlacement({ top: 300, bottom: 322, left: 600, right: 650 }, viewport)).toEqual({ flip: "down", align: "right" });
  });

  it("flips above the chip for cells near the bottom edge", () => {
    expect(evidencePopoverPlacement({ top: 720, bottom: 742, left: 600, right: 650 }, viewport)).toEqual({ flip: "up", align: "right" });
  });

  it("does NOT flip up when there is no room above either (short viewport keeps it below)", () => {
    expect(evidencePopoverPlacement({ top: 100, bottom: 122, left: 600, right: 650 }, { width: 1280, height: 300 })).toMatchObject({ flip: "down" });
  });

  it("left-anchors for cells hugging the left viewport edge", () => {
    expect(evidencePopoverPlacement({ top: 300, bottom: 322, left: 10, right: 60 }, viewport)).toEqual({ flip: "down", align: "left" });
  });

  it("keeps the right anchor on narrow viewports where neither side fits (CSS width clamp handles it)", () => {
    expect(evidencePopoverPlacement({ top: 300, bottom: 322, left: 10, right: 60 }, { width: 200, height: 800 })).toMatchObject({ align: "right" });
  });
});
