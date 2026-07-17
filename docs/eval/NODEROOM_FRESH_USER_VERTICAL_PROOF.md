# NodeRoom Fresh-User Vertical Proof

Generated: 2026-07-12

## Scope

This receipt follows the path of a new user entering a guided synthetic room,
selecting the zero-cost model route, asking NodeAgent to inspect existing work,
and opening the resulting work-artifact, trace, and entity-graph surfaces. It is
product-path evidence, not a substitute for the benchmark scorer receipts.

## Live Path

1. Created guided room `NR1LI7BASBB` through the visible landing and consent
   flow.
2. Selected `Free $0` in the visible route control.
3. Sent: `@nodeagent read the Open questions / workplan notebook and summarize
   its existing human blocks without changing anything. Cite exact block IDs.`
4. NodeAgent selected `tencent/hy3:free`, completed three model turns and three
   tool calls in 22,861 ms, and recorded zero model cost.
5. The read returned five pre-existing human blocks,
   `legacy-dac84c29-1` through `legacy-dac84c29-5`, without an edit mutation.
6. Work Artifacts and Run Trace opened from the live room. The trace exposed
   `list_artifacts`, `read_notebook`, and `say`, plus the resulting receipts.
7. Entity Graph opened after a hard reload with 74 total nodes, 11 initially
   visible nodes, 18 visible links, cluster selection, depth controls, path-hop
   controls, and the NodeAgent context panel.

## Deeper Feature Proof

- Collaborative deck: persisted version 3 with six storyboard sections after
  create, rename, duplicate, reorder, and save interactions.
- Notebook kernel: bounded expression `(2400 - 1100) - 450` produced `850` with
  receipt hash `e0c5f851`.
- Entity graph: 88-node persisted-room graph; CardioNova depth 0 exposed 8
  nodes/14 links, depth 1 exposed 53 nodes/117 links, and a dragged node moved
  from `translate(570px,0px)` to `translate(865px,150px)`.
- Governed agent edit: graph-scoped NodeAgent produced a notebook proposal; a
  visible reviewer approval changed pending proposals from 1 to 0 and produced
  an 18-block, 5-section notebook.
- Lazy-loaded interiors: Work Artifacts, Run Trace, and Entity Graph all loaded
  after a hard reload while keeping those feature bundles out of the initial
  application chunk.

## Six-Persona Dogfood

- Analyst: repaired and verified a workbook mutation, survived a rejected
  conflict, and exported XLSX plus a proof bundle.
- Researcher: completed source-backed company enrichment, reviewed trace and
  graph evidence, and exported NodeGraph JSON.
- Finance operator: sourced runway inputs, preserved review gaps, survived a
  rejected conflict, and exported XLSX.
- Founder: transformed notebook evidence into a governed readout and exported a
  12,616-byte PPTX.
- Reviewer: approved a proposal through inline review and exported the proof
  bundle.
- Guest observer: exercised the recoverable `free-auto` job path with 2/2
  attempts and inspected stream/frame/tool receipts.

All six runs began at a fresh landing state and included NodeAgent use, a
mutation, conflict/error handling, evidence review, and export. The matrix
contains 79 visible interaction steps and zero console errors. See
`noderoom-persona-dogfood-receipt.json`.

## Visual Evidence

- [Collaborative deck](../synthesis/proof/m24-deck-collaboration-proof.png)
- [Notebook kernel](../synthesis/proof/m25-notebook-kernel-proof.png)
- [Graph clusters and dragging](../synthesis/proof/m26-graph-cluster-drag-proof.png)
- [Scoped chat context](../synthesis/proof/m27-chat-context-proof.png)

## Deterministic Validation

- Full tests: 318 files, 2,128 tests, 0 failures.
- TypeScript typecheck: passed.
- Convex TypeScript typecheck: passed.
- Production build: passed; initial application chunk 840.22 kB with no Vite
  chunk-size warning.
- Production-memory browser suite: 51 passed, with one explicit live-Convex
  creation test skipped because no live backend was requested.
- Feature-interior visual matrix: 36/36 states passed across desktop, compact
  desktop, tablet, and phone.
- Accessibility: passed with zero deterministic violations; keyboard navigation
  and reduced-motion checks passed.
- Performance: passed with CLS 0, zero long tasks, and 49 ms maximum measured
  interaction latency.
- NodeAgent frame smoke: passed.
- Omnigent NodeAgent compatibility smoke: passed; outer Omnigent CLI absent.
- ProofLoop doctor: 11/11 checks passed.
- Strict official preflight: 7/7 checks passed across six lanes.
- ProofLoop `official-scores` gate: 17/17 tasks passed; no blocked lanes;
  `resume` reports `next=none`.
- Final storyboard video: Gemini `publish`, 16/16, no defects.
- Lint: unavailable because the repository has no lint script.

## Honest Limits

- Free models are live capacity-dependent; five of eight tested tool-call routes
  passed in the current gauge.
- The notebook kernel deliberately excludes arbitrary Python, shell, package,
  network, and unrestricted SQL execution.
- Neo4j/Cognee persistence and external graph synchronization were not
  configured or live-tested here.
- SpreadsheetBench V2 has complete accepted full-suite scorer coverage but
  remains 0/321 exact passes. A separate scoped Task 90 official visual receipt
  passed 3/3 independent judge runs and a Template/14_09 repair lifted overall
  score from 0.4 to 0.4041665; neither revises the full-suite result.
- External Neo4j/Jupyter/container deployments remain opt-in boundaries that
  require explicit credentials and isolation.
