# Attention Overlay Standard — the Trace Focus Box primitive

> **Trace is the receipt. The box is the pointer.**
> Trace tells *what* happened; the box shows *where*; evidence says *why it's true*;
> a proposal asks *whether to apply it*. The box is the agent's finger pointing at the work.

This standard defines **one** primitive — the **Trace Focus Box** — that visually anchors every
important human/agent action to the exact place it read, touched, cited, proposed, or changed,
across every artifact surface (spreadsheet, PDF, web, JSON/research, notebook, app-UI, image, chart).

## 0. Grounding — this is a UNIFICATION, not a greenfield build

NodeRoom already has the parts; they are fragmented across three subsystems that never share a
rendering layer. This standard unifies them and renders the overlay **inline on the live artifact**
(today boxes only render inside the Trace tab).

| Capability | Already exists | File |
|---|---|---|
| Normalized box overlay (PDF, screenshot, image) | `.r-tracevu-box`, `NormBox {x,y,w,h}` 0..1 | `src/app/styles.css:1028`, `PdfCitation.tsx:72`, `TraceStepRow.tsx:41`, `capture/types.ts` |
| PDF bbox normalization (rotation/cropbox/origin) | `normalizeBox(raw, geom, origin)` | `src/nodeagent/capture/pdfBox.ts` |
| Persisted citation box | `captureRecords.steps[].box` + `pdfStorageId`/`screenshotId` | `convex/schema.ts:342`, `convex/citations.ts`, `convex/citePdf.ts` |
| **Ephemeral focus (who/where/mode + TTL)** | `presenceClaims` (actor, targetKind, mode, color, `expiresAt`) | `convex/schema.ts:205` |
| **No-clobber / conflict / proposal** | `locks`, `drafts` (`blockedByLockId`, CAS `baseVersion`), `proposals` | `convex/schema.ts:186/234/253` |
| Evidence chain (claim→fact→source→bbox) | `sourceCaptures`, `evidenceFacts` (`bboxNorm`,`usedBy`), `CellPayload.evidence[].bbox` | `convex/schema.ts:598/627`, `src/engine/types.ts:61` |
| Actor + 3-state visibility | `actor{kind,id,name,scope}`, `private\|room\|public` | `convex/schema.ts:21/66` |
| App-UI target identification | TraceLens: Cmd/Ctrl+click `[data-noderoom-surface]`→`data-element-id` | `src/ui/traceLens/` |

**The three real gaps:**
1. No shared semantic — boxes have no `focusKind`/`actorKind`; presence has no spatial box; locks draw no overlay.
2. No **inline** overlay on live artifacts (only Trace-tab replay).
3. No **`FocusTargetResolver`** — the per-surface adapter from a logical target to viewport rects.

## 1. The primitive

```ts
type TraceFocusBox = {
  id: string;
  traceId?: string; stepId?: string;
  actorId?: string;
  actorKind: "human" | "agent" | "system";

  focusKind:
    | "user_focus"     // blue  — human is here (presenceClaims mode=focus/edit)
    | "agent_read"     // amber — agent reading/reasoning scope (presenceClaims mode=agent_intent)
    | "agent_write"    // amber — agent actively writing
    | "citation"       // green — a cited source location (captureRecords pdf_citation)
    | "evidence"       // green — evidence supports this output (evidenceFacts.bboxNorm)
    | "proposal"       // purple— proposed agent change awaiting review (drafts/proposals)
    | "conflict"       // red   — overlaps a human-held lock; deflected (drafts.blockedByLockId)
    | "needs_review"   // red   — flagged for human check
    | "coach_prompt";  // teal  — Coach Mode is asking about this region

  target: TargetLocator;          // polymorphic — see §2
  label: string; description?: string;
  confidence?: number; sourceRef?: string;

  visibility: "private" | "room" | "public";
  durability: "ephemeral" | "trace_persisted" | "evidence_persisted";

  createdAt: number; expiresAt?: number;
};
```

`focusKind` + `actorKind` are the net-new semantic fields. Everything else maps onto existing tables (§3).

## 2. Coordinate systems & the polymorphic target

The renderer must **not** care whether the source is a PDF or a sheet. Each surface owns a resolver that
turns a logical `TargetLocator` into viewport-pixel rects; the overlay layer just draws rects.

```ts
type TargetLocator = {
  artifactId: string;
  artifactKind: "spreadsheet"|"pdf"|"html"|"json"|"research"|"notebook"|"app_ui"|"image"|"chart";
} & (
  | { cellRange: string }                         // "C2" | "A1:C5"  → DOM rects of data-element-id cells
  | { pageNumber: number; bboxNorm: NormBox }     // PDF / image / screenshot → % overlay (DONE)
  | { domSelector: string; bboxNorm?: NormBox }   // html / app_ui → getBoundingClientRect
  | { testId: string }                            // app_ui / Playwright → [data-testid] rect
  | { jsonPointer: string }                       // "/companies/0/funding/stage" → row/line rect
  | { blockId: string }                           // notebook block → data-element-id rect
);
```

```ts
// Every artifact renderer implements ONE small interface.
type FocusTargetResolver = {
  artifactKind: TargetLocator["artifactKind"];
  canResolve(t: TargetLocator): boolean;
  resolve(t: TargetLocator): Promise<{
    viewportRef: HTMLElement | null;          // the positioned container to overlay into
    boxes: Array<{ x: number; y: number; w: number; h: number; space: "viewport_px" }>;
  }>;
};
```

Resolvers register into one `OverlayRegistry`; the `AttentionOverlay` component subscribes to the
active `TraceFocusBox[]` for the visible artifact, resolves each, and paints `.r-focus-box`
(generalized `.r-tracevu-box`) with the `focusKind` color/icon/label.

## 3. Durability tiers map onto existing tables (do NOT add new stores)

| Tier | Lives in | TTL | Use |
|---|---|---|---|
| `ephemeral` | **`presenceClaims`** (`schema.ts:205`) — add `box?: NormBox` + `focusKind` | `expiresAt` (e.g. now+5–30s) | live human cursor/selection, agent read/write focus |
| `trace_persisted` | **`captureRecords.steps[].box`** (`schema.ts:342`) — add `focusKind`,`actorKind` | none (replayable) | agent run steps: read this range, clicked this button, proposed this write |
| `evidence_persisted` | **`evidenceFacts.bboxNorm`** + `CellPayload.evidence[].bbox` | none (workpaper) | the source quote/line/cell that PROVES a claim |

Proposals/conflicts are **derived** focus boxes: a `drafts` row with `blockedByLockId` set →
render a `conflict` (red) box on its `ops[].elementId`; a pending `drafts`/`proposals` op →
render a `proposal` (purple) box. No new table.

## 4. Per-surface status (grounded)

| Surface | Renderer | Today | Addressing | Box work |
|---|---|---|---|---|
| **PDF** | `PdfCitation.tsx:72` | ✅ `.r-tracevu-box` over react-pdf page | `pageNumber`+`bboxNorm` | **done** |
| **Web/screenshot** | `TraceStepRow.tsx:41` | ✅ box over `<img>` | `bboxNorm` | **done** |
| **Image** | `Artifact.tsx` (`r-file-image`) | bbox pattern | `bboxNorm` | **trivial** |
| **Spreadsheet ×3** | `Artifact.tsx` Excel/Generic/Sheet | selection, presence colors, lock outline, evidence-class | `data-element-id="A1"`, `rangeBox()` | **easy — the wedge** |
| **Research** | `Artifact.tsx` `r-research-row` | row expand, evidence-class | `rid__col` (add `data-element-id`) | **easy–medium** |
| **Notebook** | `Artifact.tsx` `r-notebook-block` | read-model display | add `data-element-id={blockId}` | **medium** |
| **App-UI / QA** | `traceLens/`, `qa-trace` screenshots | TraceLens identifies target; screenshots have boxes | `data-noderoom-surface`+`data-element-id`, `testId` | **medium** (render highlight on identified target) |
| **Chart** | `RunwayMilestoneChartArtifact` | none | needs `data-element-id` per mark | **hard** |
| **Firecrawl extract** | `TraceSurface.tsx` markdown | text only | no source map | **hard** (store char-offset→bbox map at capture) |
| **Agent notes / wall** | `r-agent-notes`, dnd-kit | rich text / canvas | none granular | **hard** |

## 5. Worked runtime — human C2 vs agent A1:C5 (≈70% already built)

```
Human clicks C2
  → client paints C2 blue instantly + writes presenceClaims{mode:edit,target:cell:C2,expiresAt:+15s}   [EXISTS]
  → room + agent harness see C2 is human-held

Agent plans to analyze A1:C5
  → presenceClaims{actor:agent,mode:agent_intent,target:cell-range:A1:C5}                                [add box]
  → UI: amber range outline A1:C5 with blue C2 inside                                                     [NET-NEW render]

Agent proposes writes A1,B2,C2,C4
  → applyAgentCellEdit CAS(baseVersion): A1,B2,C4 commit; C2 overlaps human lock                          [EXISTS]
  → C2 deflected to drafts{ops:[C2], blockedByLockId}                                                     [EXISTS]
  → UI: purple "suggestion" box on C2 (proposal); red if hard conflict                                   [NET-NEW render]

Human clicks C2 proposal
  → sees old value / current typed / agent proposed / evidence box / reason → approve|reject              [drafts UI exists; box net-new]
```

The only net-new work is the **visual overlay + the spreadsheet resolver**; the state machine exists.

## 6. Semantics & accessibility

| focusKind | color token | icon | also encode (never color alone) |
|---|---|---|---|
| user_focus | blue | ◦ cursor | actor name flag |
| agent_read / agent_write | amber `--accent-primary` | ◎ eye / ✎ | "Agent reading"/"writing" label |
| citation / evidence | green | ❝ / ✓ | support strength + source ref |
| proposal | purple | ⊕ | "Suggestion available" |
| conflict / needs_review | red | ⚠ | reason text |
| coach_prompt | teal | ? | question text |

Box **hierarchy** when overlapping (paint order, low→high): historical trace < evidence < conflict <
active agent focus < active user focus. **Behavior:** hover → label+source+action; click →
open the trace step / evidence card / proposal; double-click → jump to full artifact; ephemeral
boxes fade on `expiresAt`; evidence boxes **pin** while their citation is selected. Respect
`prefers-reduced-motion`; every box carries an `aria-label` of `{focusKind}: {label}`.

## 7. Sequenced plan

1. **Generalize the primitive** — rename/alias `.r-tracevu-box`→`.r-focus-box`, add `data-focus-kind`; add `focusKind`/`actorKind` to `captureRecords.steps[].box` and `box?:NormBox`+`focusKind` to `presenceClaims`. (No new tables.)
2. **`OverlayRegistry` + `AttentionOverlay`** component + `FocusTargetResolver` interface.
3. **Wedge: SpreadsheetResolver** — `cellRange`→`td[data-element-id]` rects; wire `presenceClaims`(blue/amber) + `drafts`/`locks`(purple/red) to inline boxes on the live grid. One Playwright test + one screenshot proof.
4. **PDF/screenshot/image resolvers** — thin wrappers around the existing render (already correct).
5. **Research + Notebook resolvers** — add `data-element-id`, reuse the cell pattern.
6. **TraceLens → highlight** — render a focus box on the identified `[data-noderoom-surface]` target.
7. **Trace-tab parity** — Trace replay reuses the same `AttentionOverlay`, so a step's box renders identically inline and in replay.

## 8. The product rule (enforce in review)

> **Every important trace step must either point to a visual target, or explicitly say why it has none.**
> "Searched Linkup" → no target yet (creates source candidates). "Opened PDF p.4" → p.4 boxed.
> "Extracted revenue" → bbox on the line. "Proposed C2" → purple C2. "Human editing C2" → blue C2.

## 9. Cookbook — adding a new artifact renderer

1. Implement a `FocusTargetResolver` for the artifact kind (logical target → viewport rects).
2. Register it in `OverlayRegistry`; render inside a `position:relative` viewport container.
3. Support hover (label/source), click (open step/evidence/proposal), pin (evidence).
4. Connect the surface's actions to focus boxes: human focus → `presenceClaims`; agent step → `captureRecords`; evidence → `evidenceFacts`.
5. Add **one Playwright test** asserting the box appears on the right target, and **one screenshot proof**.

## 10. Honest delta (net-new only)

- 2 schema fields (`focusKind`,`actorKind`) on `captureRecords.steps[].box`; `box`+`focusKind` on `presenceClaims`.
- `TargetLocator` type + `FocusTargetResolver` interface + `OverlayRegistry`.
- `AttentionOverlay` component (generalizes the inline render that today lives only in `PdfCitation`/`TraceStepRow`).
- Per-surface resolvers (spreadsheet first; PDF/screenshot/image are wrappers).
- `data-element-id` on Research rows + Notebook blocks.

Everything else — the box CSS, normalization math, presence TTL system, locks/drafts/proposals
conflict flow, evidence chain, actor/visibility model, TraceLens target identification — **already exists.**
