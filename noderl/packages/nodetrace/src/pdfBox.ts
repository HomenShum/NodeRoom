/**
 * PDF citation box normalization adapter — the ONE seam between a PDF producer's raw box / text item
 * and the Trace tab's normalized overlay. Emits `{page,x,y,w,h}` as 0..1 fractions of the RENDERED
 * page, top-left origin, y-down — exactly what `.r-tracevu-box` (left/top/w/h in %) paints over a
 * react-pdf `<Page>`.
 *
 * Producers differ in origin, and LiteParse's was verified empirically (probe over the smoke fixture):
 * LiteParse/LlamaParse are TOP-LEFT where y is the glyph bbox TOP edge (no flip); PDF.js text-layer
 * items are BOTTOM-LEFT (must flip). Rotation, CropBox≠MediaBox, and skewed text are handled so the
 * overlay lands on the target text regardless of how the page was authored or rendered.
 *
 * Pure functions — server-safe (no DOM). The multi-PDF acceptance test (PDF_CITATION_BOX_PLAN.md
 * recipe step 8) is the empirical correctness gate; the unit tests below pin the intended math.
 */
import type { NormBox } from "./types";

export type BoxOrigin = "top-left" | "bottom-left";

export interface PageGeometry {
  page: number;
  width: number;
  height: number;
  /** Effective viewport rotation in degrees (0/90/180/270). Use resolveEffectiveRotation(). */
  rotation?: number;
  /** CropBox in user units [x1,y1,x2,y2]; PDF.js renders this. Falls back to MediaBox when absent. */
  cropBox?: [number, number, number, number];
  /** MediaBox in user units [x1,y1,x2,y2]; defaults to [0,0,width,height]. */
  mediaBox?: [number, number, number, number];
}

export interface RawBox { x: number; y: number; w: number; h: number }

export type PdfOverlayBox = NormBox & { page: number };

/** Resolve the single effective rotation a viewport must render. Never adds prop + page rotation. */
export function resolveEffectiveRotation(rotateProp?: number, pageRotate?: number): 0 | 90 | 180 | 270 {
  const r = ((rotateProp ?? pageRotate ?? 0) % 360 + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Remap a top-left-normalized box (fractions of the UNROTATED page) into fractions of the RENDERED
 * page for a clockwise viewport rotation. Derivations (corner min/max in normalized space):
 *   90°:  (x,y,w,h) -> (1-y-h, x, h, w)
 *   180°: (x,y,w,h) -> (1-x-w, 1-y-h, w, h)
 *   270°: (x,y,w,h) -> (y, 1-x-w, h, w)
 * Spreads `page` (and any other NormBox field) into every branch so rotation never drops it.
 */
export function rotateNormBox(box: NormBox, rotation: 0 | 90 | 180 | 270): NormBox {
  if (rotation === 0) return { ...box };
  if (rotation === 90) return { ...box, x: 1 - box.y - box.h, y: box.x, w: box.h, h: box.w };
  if (rotation === 180) return { ...box, x: 1 - box.x - box.w, y: 1 - box.y - box.h, w: box.w, h: box.h };
  return { ...box, x: box.y, y: 1 - box.x - box.w, w: box.h, h: box.w };
}

/**
 * Normalize a producer raw box to a `{page,x,y,w,h}` overlay box: fractions of the RENDERED page,
 * top-left, y-down, clamped 0..1. Pipeline: CropBox shift -> origin flip (bottom-left only) ->
 * viewport rotation -> clamp. Pass an axis-aligned rect in user space when the producer gives
 * skewed text (reduce via min/max of transformed corners before calling).
 */
export function normalizeBox(raw: RawBox, geom: PageGeometry, origin: BoxOrigin): PdfOverlayBox {
  const [mx1, my1, mx2, my2] = geom.mediaBox ?? [0, 0, geom.width, geom.height];
  const [cx1, , cx2, cy2] = geom.cropBox ?? [mx1, my1, mx2, my2];
  const cy1 = geom.cropBox ? geom.cropBox[1] : my1;
  const cropW = cx2 - cx1;
  const cropH = cy2 - cy1;
  const x = (raw.x - cx1) / cropW;
  const w = raw.w / cropW;
  const y = origin === "bottom-left"
    ? 1 - (raw.y - cy1 + raw.h) / cropH
    : (raw.y - cy1) / cropH;
  const h = raw.h / cropH;
  const rotated = rotateNormBox({ x, y, w, h }, resolveEffectiveRotation(geom.rotation));
  return { page: geom.page, x: clamp01(rotated.x), y: clamp01(rotated.y), w: clamp01(rotated.w), h: clamp01(rotated.h) };
}
