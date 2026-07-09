# Semantic Entity Graph Proof

Date: 2026-07-08

## Scope

Implemented the deeper semantic entity graph pass requested for the room graph/mind-map surface. The graph now derives a semantic view model from existing room artifacts, spreadsheet rows, notebook blocks, evidence payloads, traces, proposals, sessions, and members. No backend schema, Convex API, auth, persistence, or NodeAgent runtime behavior was changed.

## Changed Surface

- Default Entity mode now renders a focused company-centered semantic slice instead of a decorative hairball.
- Full graph remains available through search and filters.
- Nodes include companies, people, artifacts, spreadsheet rows, notebook blocks, sources, evidence facts, funding, trace steps, proposals, open questions, and agent jobs.
- Edges carry semantic verbs such as researched, cited, supported by, authored, updated, proposed, reviewed, and triggered.
- Click selection opens a detail panel with people/agent context, evidence/sources, rows/blocks, traces/proposals, and open actions.
- Search, semantic kind filters, evidence/agent/human toggles, minimap, pan/zoom, local drag, edge hover/click, and Escape close are covered by the browser spec.

## Proof Artifacts

- Default graph screenshot: `docs/design/ui-contract/20260708-migration-proof/semantic-graph-default.png`
- Selected CardioNova detail screenshot: `docs/design/ui-contract/20260708-migration-proof/semantic-graph-cardionova-detail.png`
- Capture metrics: `docs/design/ui-contract/20260708-migration-proof/semantic-graph-metrics.json`
- Gemini review: `docs/eval/semantic-entity-graph-gemini-review.json`
- Renderer research note: `docs/design/ui-contract/semantic-entity-graph-research.md`

## Validation

Passed:

- `npm run typecheck -- --pretty false`
- `npm test -- --run tests/semanticGraph.test.ts`
- `npm test -- --run tests/passiveIntelligence.test.tsx`
- `npx playwright test e2e/semantic-entity-graph.spec.ts --project=chromium --workers=1`
- `npm run build`
- `git diff --check`

Note: `git diff --check` exited 0 and repeated the pre-existing CRLF warning for `docs/architecture-budget.json`.

Gemini:

- `npm run ui:gemini-review -- --media=".tmp-qa\semantic-graph\semantic-graph-cardionova-detail.png" --out="docs\eval\semantic-entity-graph-gemini-review.json"`
- Verdict: `partial`.
- Caveat: the generic Gemini rubric expected chat, wall, trace, and multi-user evidence in the same screenshot. It did positively identify the graph as a polished CardioNova entity/evidence map with evidence citations and spreadsheet linkage.

## Preserved Functionality Checklist

- Existing graph tab route and artifact panel route remain intact.
- Existing artifact open callback is preserved.
- Graph positions from drag are local React state only; no backend writes were added.
- Store reads remain read-only: artifacts, traces, proposals, sessions, presence, and members.
- Existing non-Entity graph modes keep the legacy inline graph extraction path.
- No Convex schema/API/auth/runtime files were modified for this feature.

## Known Gaps

- The default graph intentionally shows a focused slice; the whole semantic graph is available through search/filters, but there is not yet a dedicated "show all" toggle.
- The current open-tab strip can hide the graph tab behind overflow in the demo route; the e2e opens the existing graph tab by dispatching its click handler, then verifies real graph interactions.
- The implementation keeps React Flow as the production renderer. Cytoscape/Sigma/NVL remain research candidates only; NVL is blocked pending license review.
