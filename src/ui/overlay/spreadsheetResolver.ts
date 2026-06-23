/**
 * SpreadsheetFocusResolver — cellRange -> viewport-px rects, for ALL three sheet renderers.
 *
 * Critic fixes baked in:
 *  - UNION selector `td[data-cell-key="id"], td[data-element-id="id"]`: ExcelGridSheet (the wedge) emits
 *    data-cell-key ONLY (Artifact.tsx:1344); Generic/Sheet emit both. One selector covers all three.
 *  - viewport-px relative to the scroll host (not %-of-offsetParent) so boxes don't drift under scroll;
 *    AttentionOverlay re-resolves on scroll/resize.
 *  - partial virtualization: a range merges the union of the VISIBLE cells found; fully off-screen -> rects:[]
 *    (honest — paint nothing, never a fabricated rect).
 *  - try/catch: a detached node / malformed id returns rects:[] rather than throwing into the paint path.
 */
import type { FocusTargetResolver, ResolvedRect, ResolvedFocus, TargetLocator } from "./types";

const COL_RE = /^([A-Za-z]+)(\d+)$/;
const colToNum = (s: string): number => {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const numToCol = (n: number): string => {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** Expand a cellRange into the list of cell ids to query. "C2" -> ["C2"]; "A1:C5" -> the rectangle;
 *  a non-A1 id (rid__col, no ':') -> [id]. Bounded so a giant range can't enumerate unboundedly. */
function cellIds(range: string): string[] {
  const colon = range.indexOf(":");
  if (colon < 0) return [range];
  const a = range.slice(0, colon);
  const b = range.slice(colon + 1);
  const ma = COL_RE.exec(a);
  const mb = COL_RE.exec(b);
  if (!ma || !mb) return [a, b]; // not A1 endpoints — just try both literally
  const c0 = Math.min(colToNum(ma[1]), colToNum(mb[1]));
  const c1 = Math.max(colToNum(ma[1]), colToNum(mb[1]));
  const r0 = Math.min(Number(ma[2]), Number(mb[2]));
  const r1 = Math.max(Number(ma[2]), Number(mb[2]));
  const ids: string[] = [];
  for (let r = r0; r <= r1 && ids.length < 4096; r++) {
    for (let c = c0; c <= c1 && ids.length < 4096; c++) ids.push(numToCol(c) + r);
  }
  return ids;
}

const ESC = (s: string): string =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");

/**
 * @param getViewportRef the position:relative scroll host (.r-sheet-wrap / .xl-scroll). Boxes are measured
 *   relative to its current viewport rect, so they track the cells as the grid scrolls (re-resolve on scroll).
 */
export function createSpreadsheetResolver(getViewportRef: () => HTMLElement | null): FocusTargetResolver {
  return {
    artifactKind: "spreadsheet",
    canResolve(t: TargetLocator) {
      return t.kind === "cellRange" && t.artifactKind === "spreadsheet" && getViewportRef() != null;
    },
    resolve(t: TargetLocator): ResolvedFocus {
      const host = getViewportRef();
      if (!host || t.kind !== "cellRange") return { viewportRef: null, rects: [] };
      try {
        const hr = host.getBoundingClientRect();
        const found: DOMRect[] = [];
        for (const id of cellIds(t.cellRange)) {
          const el = host.querySelector<HTMLElement>(`td[data-cell-key="${ESC(id)}"], td[data-element-id="${ESC(id)}"]`);
          if (el) found.push(el.getBoundingClientRect());
        }
        if (found.length === 0) return { viewportRef: host, rects: [] }; // virtualized / off-screen — honest empty
        // Merge the visible cells into ONE rect (clamped to what's actually on-screen, per the critic).
        const left = Math.min(...found.map((r) => r.left));
        const top = Math.min(...found.map((r) => r.top));
        const right = Math.max(...found.map((r) => r.right));
        const bottom = Math.max(...found.map((r) => r.bottom));
        const rect: ResolvedRect = {
          x: left - hr.left,
          y: top - hr.top,
          w: right - left,
          h: bottom - top,
          space: "viewport_px",
        };
        return { viewportRef: host, rects: [rect] };
      } catch {
        return { viewportRef: host, rects: [] };
      }
    },
  };
}
