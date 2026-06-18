# NodeRoom Visual Plans

These are local MDX visual review surfaces for high-risk NodeRoom architecture decisions.

They are intentionally source-controlled plan artifacts, not generated app code.

## Plans

| Plan | Purpose |
|---|---|
| [`agent-privacy-security`](./agent-privacy-security/plan.mdx) | Public/private agent data boundary, privacy enforcement, model egress, trace redaction. |
| [`native-notebook-prosemirror-sidecar`](./native-notebook-prosemirror-sidecar/plan.mdx) | Convex ProseMirror Sync notebook with NodeRoom sidecar/read-model architecture. |
| [`passive-classifier-production-pattern`](./passive-classifier-production-pattern/plan.mdx) | Deterministic classifier + typed LLM extraction production pattern. |
| [`human-agent-approval-boundary`](./human-agent-approval-boundary/plan.mdx) | Human-owned source surfaces, agent-owned sidecars, approval bridge. |
| [`coach-mode-review-readiness`](./coach-mode-review-readiness/plan.mdx) | Evidence-grounded Coach Mode / Review Readiness workflow. |
| [`visual-plan-review-surface`](./visual-plan-review-surface/plan.mdx) | Meta-plan defining when and how NodeRoom should use visual plans. |

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
