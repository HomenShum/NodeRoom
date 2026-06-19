# NodeRoom Visual Plans

These are local MDX visual review surfaces for high-risk NodeRoom architecture decisions.

They are intentionally source-controlled plan artifacts, not generated app code.

## Plans

| Plan | Purpose |
|---|---|
| [`passive-notebook-single-source-fix`](./passive-notebook-single-source-fix/plan.mdx) | ProseMirror snapshot registry-only bridge fix plus target dirty-signal/read-model implementation prep. |
| [`agent-privacy-security`](./agent-privacy-security/plan.mdx) | Public/private agent data boundary, privacy enforcement, model egress, trace redaction. |
| [`native-notebook-prosemirror-sidecar`](./native-notebook-prosemirror-sidecar/plan.mdx) | Convex ProseMirror Sync notebook with NodeRoom sidecar/read-model architecture. |
| [`notebook-ui-inspiration-motion`](./notebook-ui-inspiration-motion/plan.mdx) | Notebook-first capture flow, passive reveal motion, and inspiration-to-product mapping. |
| [`agent-artifacts-structured-review`](./agent-artifacts-structured-review/plan.mdx) | Structured Agent Artifact contract, rendered review surfaces, plan hash, planned-vs-actual loop. |
| [`passive-classifier-production-pattern`](./passive-classifier-production-pattern/plan.mdx) | Deterministic classifier + typed LLM extraction production pattern. |
| [`human-agent-approval-boundary`](./human-agent-approval-boundary/plan.mdx) | Human-owned source surfaces, agent-owned sidecars, approval bridge. |
| [`coach-mode-review-readiness`](./coach-mode-review-readiness/plan.mdx) | Evidence-grounded Coach Mode / Review Readiness workflow. |
| [`professional-spreadsheet-workflows`](./professional-spreadsheet-workflows/plan.mdx) | Formula-safe, evidence-bearing, versioned spreadsheet workflows. |
| [`nodeagent-runtime`](./nodeagent-runtime/plan.mdx) | NodeAgent runtime seams: model adapter, tools, RoomTools, Convex functions. |
| [`nodeagent-harness-frame-runner`](./nodeagent-harness-frame-runner/plan.mdx) | Durable reasoning frames, context packs, reducer/verifier, and smoke gates. |
| [`shipped-tools-and-roomtools`](./shipped-tools-and-roomtools/plan.mdx) | Shipped tool classes and the backend-neutral RoomTools port. |
| [`visual-plan-review-surface`](./visual-plan-review-surface/plan.mdx) | Meta-plan defining when and how NodeRoom should use visual plans. |
| [`security-production-readiness`](./security-production-readiness/plan.mdx) | Gate-by-gate security and production-readiness control story. |
| [`accessibility-wcag22`](./accessibility-wcag22/plan.mdx) | WCAG 2.2 AA target plan for notebook, sheet, Copilot, Coach, evidence, and Visual Plans. |
| [`incident-response-disaster-recovery`](./incident-response-disaster-recovery/plan.mdx) | Incident response, recovery, RTO/RPO, and runbook proof target. |
| [`multi-tenancy-data-isolation`](./multi-tenancy-data-isolation/plan.mdx) | Room/workspace isolation, visibility, owner, and agent privacy invariants. |
| [`privacy-retention-deletion`](./privacy-retention-deletion/plan.mdx) | Separate telemetry retention, export inventory, deletion request, and verified purge claims. |
| [`load-stress-chaos-testing`](./load-stress-chaos-testing/plan.mdx) | Staging load, chaos, provider failure, cron SLA, and cost-abuse evidence plan. |

## Review rule

Use a visual plan when the work is multi-file, architecture-heavy, data-heavy, UI-heavy, privacy-sensitive, or expensive to reverse.

For trivial fixes, the code diff is usually enough.

## Suggested approval flow

```text
Draft visual plan
  -> review diagrams, contracts, file map, open questions
  -> approve direction
  -> implement code
  -> verify with tests/build/Playwright
```
