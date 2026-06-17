/**
 * pdfBox normalization adapter — pure-function contract. The LiteParse top-left origin is pinned to
 * the empirical probe (text at PDF coord 36,96 in a 300x144 page reports y=31.71 = glyph bbox TOP in
 * top-left y-down). Rotation/CropBox/skew math is pinned here; the multi-PDF acceptance test validates
 * it against real react-pdf/PDF.js viewports.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeBox,
  rotateNormBox,
  resolveEffectiveRotation,
  type PageGeometry,
} from "../src/nodeagent/capture/pdfBox";

const close = (n: number, v: number) => expect(n).toBeCloseTo(v, 3);
const expectBoxClose = (b: { x: number; y: number; w: number; h: number }, e: { x: number; y: number; w: number; h: number }) => {
  close(b.x, e.x); close(b.y, e.y); close(b.w, e.w); close(b.h, e.h);
};

describe("resolveEffectiveRotation — never adds prop + page rotation", () => {
  it("defaults to 0 and normalizes to the four valid buckets", () => {
    expect(resolveEffectiveRotation()).toBe(0);
    expect(resolveEffectiveRotation(undefined, 270)).toBe(270);
    expect(resolveEffectiveRotation(90)).toBe(90);
    expect(resolveEffectiveRotation(450)).toBe(90);
    expect(resolveEffectiveRotation(-90)).toBe(270);
    expect(resolveEffectiveRotation(135)).toBe(0);
    expect(resolveEffectiveRotation(180, 90)).toBe(180); // prop wins
  });
});

describe("rotateNormBox — clockwise viewport remap of a top-left-normalized box", () => {
  it("0deg is identity", () => {
    expectBoxClose(rotateNormBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 0), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });
  it("90deg swaps w/h and remaps corners", () => {
    expectBoxClose(rotateNormBox({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, 90), { x: 0.6, y: 0.1, w: 0.3, h: 0.3 });
  });
  it("180deg mirrors both axes", () => {
    expectBoxClose(rotateNormBox({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, 180), { x: 0.6, y: 0.6, w: 0.3, h: 0.3 });
  });
  it("270deg swaps w/h the other way", () => {
    expectBoxClose(rotateNormBox({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, 270), { x: 0.1, y: 0.6, w: 0.3, h: 0.3 });
  });
  it("preserves `page` across all rotations (no field-loss drift)", () => {
    for (const r of [0, 90, 180, 270] as const) {
      expect(rotateNormBox({ x: 0.1, y: 0.1, w: 0.3, h: 0.3, page: 7 }, r).page).toBe(7);
    }
  });
});

describe("normalizeBox — origin + per-page normalization", () => {
  const geo = (over: Partial<PageGeometry> = {}): PageGeometry => ({ page: 1, width: 300, height: 144, ...over });

  it("LiteParse top-left: NO flip (verified probe — y is glyph bbox top)", () => {
    const b = normalizeBox({ x: 36, y: 31.71, w: 172.06, h: 20.09 }, geo(), "top-left");
    expect(b.page).toBe(1);
    close(b.x, 36 / 300);     // 0.12
    close(b.y, 31.71 / 144);  // ~0.220
    close(b.w, 172.06 / 300); // ~0.574
    close(b.h, 20.09 / 144);  // ~0.139
  });

  it("PDF.js bottom-left: flips so y becomes the top edge", () => {
    const b = normalizeBox({ x: 36, y: 96, w: 172, h: 18 }, geo(), "bottom-left");
    close(b.x, 36 / 300);                 // 0.12
    close(b.y, 1 - (96 + 18) / 144);      // 1 - 0.7917 = 0.2083
    close(b.w, 172 / 300);
    close(b.h, 18 / 144);
  });

  it("CropBox offset: normalizes against the rendered crop, not MediaBox", () => {
    const b = normalizeBox({ x: 80, y: 40, w: 40, h: 20 }, geo({ cropBox: [50, 20, 250, 124] }), "top-left");
    close(b.x, (80 - 50) / 200); // 0.15
    close(b.y, (40 - 20) / 104); // ~0.192
    close(b.w, 40 / 200);         // 0.2
    close(b.h, 20 / 104);         // ~0.192
  });

  it("clamps out-of-page boxes to 0..1 (no overflow past the page edge)", () => {
    const b = normalizeBox({ x: -10, y: -10, w: 500, h: 500 }, geo(), "top-left");
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.w).toBe(1);
    expect(b.h).toBe(1);
  });

  it("90deg rotation: composition shifts the box into the rendered frame", () => {
    const b = normalizeBox({ x: 10, y: 10, w: 30, h: 30 }, geo({ width: 100, height: 100, rotation: 90 }), "top-left");
    close(b.x, 0.6); close(b.y, 0.1); close(b.w, 0.3); close(b.h, 0.3);
  });
});
