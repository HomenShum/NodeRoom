# Deck Storyboard Contract

Status: implementation contract

Source prototype: `C:/Users/hshum/Downloads/NodeAgent-handoff_07062026/nodeagent/project/mobile/app-terracotta/na-deck.jsx`

## Product Role

The deck surface is a governed work artifact, not a generic slide editor. NodeRoom should turn room evidence into a reviewable narrative plan first, then render slides from that approved plan. Every material deck claim must remain connected to the room artifact, evidence, trace, or proposal that produced it.

## Behavior Contract

Required flow:

1. Plan first: NodeAgent proposes a storyboard before slide generation.
2. Human approval: the user approves, revises, or rejects the storyboard before slides become the working preview.
3. Sandboxed preview: slides render as preview artifacts. HTML/PPTX/PDF are derived outputs, not collaborative source of truth.
4. Element targeting: users can select a slide component or whole slide as the comment/patch target.
5. Scoped agent patch: NodeAgent returns a localized patch with before, after, and evidence.
6. Human gate: patch changes only apply after accept. Reject logs the request without mutating the slide.
7. Evidence tab: every cited claim shows verified or needs-review evidence state.
8. Export tab: exports include version and planned-vs-actual receipt metadata.
9. Present mode: full-deck viewing is supported without changing source state.
10. Version history: restore is a governed action and should point to a trace receipt.

## Source Of Truth

The durable source should be structured deck-plan JSON:

- `deckId`
- `roomId`
- `title`
- `audience`
- `objective`
- `privacy`
- `storyboardStatus`
- `slides[]`
- `claims[]`
- `requiredEvidence[]`
- `unresolvedGaps[]`
- `sourceArtifactIds[]`
- `traceIds[]`
- `proposalIds[]`
- `planHash`
- `version`

HTML preview, PPTX, PDF, thumbnails, and screenshots are derived from the deck plan. They should not become the collaborative state object.

## Minimum Slide Plan Shape

Each slide plan should include:

- stable `slideId`
- `title`
- `purpose`
- `claims[]`
- `sourceArtifactIds[]`
- `evidenceIds[]`
- `unresolvedGaps[]`
- `speakerNote`
- `status`: `draft`, `approved`, or `needs_review`

Each claim should include:

- stable `claimId`
- `text`
- `status`: `verified`, `manual`, or `needs_review`
- `sourceArtifactId`
- optional `traceId`
- optional `proposalId`
- optional `evidenceId`

## Patch Contract

NodeAgent deck edits should be represented as a deck delta, not a full deck rewrite:

- `patchId`
- `deckId`
- `slideId`
- optional `componentId`
- `targetLabel`
- `before`
- `after`
- `reason`
- `evidence[]`
- `status`: `pending`, `approved`, or `rejected`
- `traceId`

Accepted patches update the deck plan version and append a trace receipt. Rejected patches stay visible in the workpaper/proposal log.

## Visual Contract

The deck workbench should follow the Cloud Design direction:

- calm dark shell;
- thin dividers instead of nested boxes;
- dense thumbnail rail;
- large preview area;
- compact evidence and status chips;
- visible but quiet accept/reject controls;
- no decorative hero treatment;
- no static fake deck content in product routes.

## First Implementation Slice

The first implementation slice is intentionally read-only:

- derive a storyboard from existing room artifacts, traces, and proposals;
- expose it as a `deck` work artifact in the unified proof bundle;
- mark unsupported or proposal-backed claims as `needs_review`;
- link storyboard sections to artifact, trace, and proposal receipts;
- avoid schema/backend changes.

Future slices can add the editor/preview/export loop after this contract is proven by tests and live dogfood.
