# PDF citation box — handoff plan (next coding session)

**Status: RESEARCHED + VERIFIED, NOT BUILT.** This doc is the spec to build it. Everything it depends on
(the capture lanes, the Trace box overlay) is already shipped + deployed (dev + prod). Pick this up cold.

## Goal
Render a screenshot of a source **with a pixel highlight box on the exact value** in the Trace tab —
audit-grade "here's the number AND exactly where on the filing it came from." This is the original
north star. We proved it CANNOT be done for live web pages inside Convex (see "Why this approach"), and
the right mechanism is **document citation** (PDF.js render + a parse-time / text-layer bbox), the same
way the LlamaIndex citation UI does it. Diligence sources that matter (SEC 10-Ks/10-Qs, uploaded
financials) are PDFs, so this covers the real cases.

## What is already shipped (build ON this, don't rebuild)
- **Capture lanes (in-Convex, member-authed, no worker/token):**
  - Firecrawl screenshot+extract: `convex/capturesNode.ts` (`capture` action) + `convex/captures.ts`
    (`record` internalMutation, `byRoom` query, `assertMember` internalQuery), pipeline in
    `src/nodeagent/capture/*`, tool `src/nodeagent/skills/search/captureSourceFirecrawlTool.ts`.
  - SEC EDGAR data API (authoritative values, free, no key): `convex/sec.ts` (`facts` action),
    `src/nodeagent/capture/secFacts.ts`, tool `src/nodeagent/skills/search/secFactsTool.ts`.
  - Both persist a `captureRecords` row (`convex/schema.ts`) and render via `byRoom`.
- **The box overlay primitive (REUSE AS-IS):** `src/app/styles.css` `.r-tracevu-box` positions
  `left/top/width/height` as **percent** of its frame; `src/ui/panels/TraceStepRow.tsx` renders it over
  an `<img>`. `TraceAttachment.box` in `src/ui/panels/traceData.ts` is `{x,y,w,h}` normalized 0..1.
  This % overlay is the CORRECT scale-invariant primitive — keep it. The citation feature swaps the
  `<img>` for a `react-pdf`/PDF.js-rendered page and feeds the box from a PDF parser / the text layer.
- **UI trigger:** `TraceSurface` `CaptureForm` (Web | SEC toggle), `store.captureSource` / `store.secFacts`.

## Why this approach (decisions already made — don't relitigate)
- **Live-browser pixel box is impossible in Convex.** Proven by spikes: `playwright-core` won't bundle
  (esbuild can't resolve `chromium-bidi`); Convex "use node" **blocks outbound WebSockets**
  (`getaddrinfo EBUSY`, fetch-only) so a hand-rolled CDP client can't run there; `@browserbasehq/convex-stagehand`
  returns data + CSS selectors with **no screenshot and no pixel box**. Box ⇒ a real browser (off-box
  worker) OR document parsing. We chose document parsing (no worker, no new vendor for native-text PDFs).
- **Use `react-pdf` (wojtekmaj) as the renderer + our own `%` overlay.** The turnkey highlight libs have
  React-19 friction: `react-pdf-highlighter-extended` only does React 19 via a fork-of-a-fork that
  removed features; `@react-pdf-viewer/highlight` lagged React 19 + commercial bent; `@llamaindex/pdf-viewer`
  last published ~1 year ago (stale, pre-R19). `react-pdf` officially supports React 19 (v9+), is MIT,
  and we already have the % overlay — so it's less work AND lower risk than adopting a highlight wrapper.

## VERDICT: is the box ALWAYS accurate over multiple results?
**No — not with a naive overlay. YES with one normalization seam.** A normalized-% overlay is
automatically zoom/DPI/resize-invariant (that part is safe), but a naive overlay BREAKS on:
- **Page rotation** (`/Rotate` 90/180/270 — swaps width/height)
- **Multi-page** (no `page` field on the box; pages with *different* dimensions normalized against page-1)
- **CropBox ≠ MediaBox** (PDF.js renders CropBox; a parser may report MediaBox → offset)
- **Rotated/skewed text** (axis-aligned x/y/w/h is wrong; needs the affine transform)
- **Origin** (LlamaParse/LiteParse are top-left → do NOT flip Y; PDF.js text-layer is bottom-left → MUST flip)

## THE RECIPE (build to this — all fixes live in ONE parser→box adapter)
1. **One box contract:** extend the box to `{page, x, y, w, h}`, all `0..1` fractions of *that* page,
   **top-left origin, y-down**. (Today the box lacks `page`; add it in `traceData.ts` + the `captureStepV`
   schema in `convex/captures.ts`.) Persist fractions, never raw points/pixels.
2. **Normalize per-page at the source:** divide x/w by *its* page width, y/h by *its* page height, in the
   SAME units the producer used. LlamaParse/LiteParse (top-left points) → **no Y-flip**. PDF.js text-layer
   (bottom-left) → flip: `ny = 1 - (y + h) / H`. Tag the origin explicitly so the adapter knows.
3. **Rotation:** resolve ONE effective rotation `((rotateProp ?? page.rotate) % 360 + 360) % 360` and build
   the box in the SAME viewport frame react-pdf renders — `page.getViewport({ scale: 1, rotation })`,
   convert corners through it. NEVER add the prop rotation and the page rotation.
4. **CropBox:** normalize in **CropBox** space (what PDF.js renders): subtract the CropBox−MediaBox offset,
   divide by CropBox width/height (`viewport.viewBox`); fall back to MediaBox when no CropBox; clamp 0..1.
5. **Skew/affine:** for rotated/skewed text, rebuild the rect from `Math.min/max` of the transformed
   corners (read `item.transform = [a,b,c,d,e,f]`), not the raw axis-aligned box.
6. **Render the right page:** `<Page pageNumber={box.page}>`; overlay only that page's boxes.
7. **CSS stays `%`:** keep `.r-tracevu-box` (left/top/w/h in %); never floor to px; pin the overlay
   container EXACTLY to the rendered page element (no padding/border/contain-fit).
8. **Acceptance test (the definition of "always accurate"):** render N varied PDFs — rotated,
   CropBox-offset, multi-page with differing page sizes, scanned/OCR, native-text — and assert the
   overlay rect covers the target text's rendered rect within a pixel tolerance. This is the gate.

## Convex cost: NOT too much (negligible done client-side)
Per citation, client-side design = **1 mutation, 0 actions, 0 storage writes** (the row carries
`{page, box}` but NO `screenshotId`, so zero `ctx.storage.getUrl` resolutions; PDF.js re-renders the
already-stored PDF in the browser).

The real amplifier is the EXISTING `byRoom` reactive query (re-runs per subscriber on every new record +
re-resolves storage URLs per screenshot step per run). Mitigations (also help the current capture/SEC rows):
- Stop re-resolving `getUrl` every `byRoom` run (persist the URL at record time, or resolve lazily for the
  selected record). **Biggest amplifier.**
- Paginate `byRoom` (`usePaginatedQuery` / cursor) instead of `.take(20)`-whole-window-every-run.
- Keep coords **client-side** (PDF.js text layer) — avoid a per-citation Convex *action* (actions bill
  wall-clock GB-s, the expensive axis). Only parse via LlamaParse for scanned/no-text-layer PDFs, and then
  parse ONCE per document on upload, cache page geometry on the artifact, derive citations client-side after.
- Don't store a rendered page image per citation (wasted write + permanent `getUrl` tax).
- Add a member-gated **public** mutation for client citations (today `captures.record` is `internalMutation`
  → would cost 1 action + 1 mutation; a thin public mutation = 1 mutation).
- Gate the `byRoom` subscription on the Trace tab being open (`"skip"` otherwise) to drop the per-member multiplier.
- Keep `MAX_CAPTURE_RECORDS=20` + `assertMember`.

**GO/NO-GO: GO.** Every failure mode has a concrete fix, all in one adapter; cost is negligible client-side.

## Build plan (next session)
1. `npm i react-pdf` (verify React 19 + Vite at install — we hit a nested-React bundling issue with
   @xyflow before; check `vite.config.ts resolve.dedupe` already lists react/react-dom).
2. Add `page?: number` to `TraceAttachment.box` (`traceData.ts`) + `captureStepV` (`convex/captures.ts`).
3. Write `src/nodeagent/capture/pdfBox.ts` — the normalization adapter implementing the recipe (parser
   box / PDF.js text-layer item → `{page, x, y, w, h}` 0..1 top-left). Unit-test it (pure function).
4. Add a `PdfCitation` viewer component (react-pdf `<Document><Page>` + the existing `.r-tracevu-box`
   overlay) used by `TraceStepRow` when a step's attachment is a PDF page + box.
5. Source the PDF: uploaded room artifact (already in Convex storage) or a fetched SEC filing PDF.
6. Acceptance test (step 8 above) — the gate before shipping.

## Lessons / guardrails for the next session
- **Cap workflow fan-out.** The verification workflow for this had a runaway: an "enumerate exhaustively"
  sweep returned ~58 modes and a per-mode fan-out spawned **68 agents** (synthesis never ran). If you run a
  multi-agent verify, cap the dynamic fan-out (e.g. `allModes.slice(0, 12)`) so a "list everything" agent
  can't explode the agent count. The 28 verdicts it did produce are the basis of the recipe above.
- Edit + deploy Convex from the **worktree** (`.claude/worktrees/ui-subtraction`), not the main tree —
  prior slips deployed code that silently lacked changes.
- Convex's tsconfig has no DOM lib → avoid DOM-only types (`BlobPart`) in `convex/**`; cast `as any`.
- Prod env keys carry a stray `\r` (Windows artifact); env reads are `.trim()`-ed in the capture code
  (`reasoning.ts`, `firecrawl.ts`, etc.) — re-set prod keys clean to remove the root cause everywhere.
