# NodeRoom Product Completion Contract

Generated: 2026-07-12

This contract turns the remaining product limits into evidence-backed gates. A
surface is complete only when its required tests and live receipts pass. Prior
proof remains valid baseline evidence, but does not satisfy a stronger gate by
itself.

## Required Gates

| Gate | Acceptance | Current evidence | Status |
| --- | --- | --- | --- |
| Baseline | Preserve or exceed the 313-file / 2,099-test baseline, typecheck, build, NodeAgent smokes, and locked scorer hashes. | `proof-release-validation.json`; accepted official-score receipts. | Passed: 318 files / 2,128 tests |
| Workbook quality | Keep accepted V1 artifacts byte-identical, lift at least one unchanged V2 modification score, produce a nonzero scoped V2 exact pass, and repeat that scoped pass three times. | `spreadsheetbench-v2-task90-official-visual-receipt.json`; `nodeagent-workbook-improvement-receipt.json`. | Passed (scoped; full suite remains 0/321) |
| Free routing | Probe current free routes, rank capability and health, fail over within one request, apply cooldown/retry budgets, expose honest route state, and complete a forced first-two-route failure workflow. | `openrouter-free-routing-resilience-receipt.json` | Passed |
| Notebook execution | Use a brokered kernel contract with bounded local execution, isolated Pyodide, and optional container/Jupyter adapters; deny network by default; prove stream, timeout, cancel, artifact, and concurrency behavior. | `notebook-kernel-production-receipt.json` plus live success/policy/timeout screenshots. | Passed |
| Deck collaboration | Persist stable slide/object IDs with object-level CAS; prove presence, selection, comments, proposals, conflicts, restore, storyboard composition, and export with humans plus NodeAgent. | `WORK_ARTIFACTS_PROGRESS_RECEIPT.md`; deck CAS/UI tests; founder persona PPTX proof. | Passed |
| NodeGraph | Share the graph contract across NodeRoom and NodeGraph; prove adapters/contracts, provenance, ranked neighborhoods, path explanations, pinning, filters, dragging, and large-graph interaction. | NodeGraph integration and semantic graph tests; `m26-graph-cluster-drag-proof.png`. | Passed |
| Visual parity | Compare spreadsheet, notebook, deck, graph, chat, and trace interiors to the standalone design at desktop, compact desktop, tablet, and mobile sizes. | 36/36 surface/viewport states; `docs/design/ui-contract/20260708-migration-proof/PROOF.md`; Gemini parity receipts. | Passed |
| Vertical dogfood | Analyst, researcher, finance operator, founder, reviewer, and guest each complete a fresh-user workflow including NodeAgent, mutation, failure/conflict handling, evidence review, and export. | `noderoom-persona-dogfood-receipt.json`; 79 visible steps; zero console errors. | Passed |
| Certification/publication | Full tests, typecheck, build, smokes, accessibility, responsive E2E, official scorers, and ProofLoop gate pass; storyboarded README/social media are regenerated from final receipts. | Clean `prod:gate`; official gate 17/17; final clip judge 16/16; media manifest and generated release packet. | Passed |

## Completion Evidence

- Full production gate passed in 339.4 seconds, including 318 test files / 2,128
  tests, 51 passing production-memory browser tests, one intentional live-Convex
  skip, two TypeScript projects, build, audit, SLO, source security, and
  distribution security.
- ProofLoop `official-scores` reports `passed`, 17/17 required tasks, no blocked
  tasks, and `resume` reports `next=none`.
- Six fresh-user personas completed 79 visible steps across workbook, research,
  runway, notebook/deck, review, graph, chat, trace, and export paths with zero
  console errors.
- The final storyboarded 1080x1920 clip received `publish`, 16/16, and no defects
  from Gemini video understanding. The teaser and media manifest were regenerated
  from that exact render.

## Intentional Boundaries

- Free-provider uptime cannot be guaranteed. NodeRoom must guarantee bounded
  attempts, transparent status, recovery, and a usable non-model fallback where
  the task permits one.
- Arbitrary notebook code is never executed in the application process. Network
  access is denied by default; container/Jupyter execution is optional,
  isolated, resource-limited, cancellable, and approval-gated.
- External Neo4j, Jupyter, and container services require explicit user
  configuration and credentials. Their absence is a deployment boundary, not a
  reason to weaken local contracts or tests.
- Official benchmark fixtures, checklists, and scorers remain immutable.
  Exploration output cannot promote or grade itself.
- A scoped official pass is reported as scoped until the full official suite is
  rerun and accepted.
- The accepted SpreadsheetBench V2 full-suite result remains 0/321 exact passes.
  The separate scoped Task 90 receipt proves one unchanged official visual task
  passed three independent runs; it does not revise the full-suite result.
- Guest-observer memory-mode dogfood proves the observer workflow perspective,
  while live guest-role enforcement remains a backend/multi-user certification
  concern.

Machine-readable status: `docs/eval/noderoom-product-completion-contract.json`.
