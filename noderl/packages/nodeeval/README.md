# @noderl/nodeeval

The **reward builder + judge layer**: turn a finished run into rewards from tests, scorers,
visual/video judges, citation verification, export-reopen, and cost/latency.

## Status

Anchored on a component that is **already standalone**: the `walkthrough-review` CLI + MCP server.
The judges and scorers are runnable; the net-new work is a generic judge-fn contract and a
`proof-schema` package.

## What it bundles

| Piece | Source (exists today) | Maturity |
|---|---|---|
| `walkthrough-review` CLI + MCP | `packages/walkthrough-review-cli` (zero deps, `walkthrough_review_run`) | standalone |
| Gemini media/video judge | `scripts/gemini-demo-media-judge.ts` | runnable |
| GIF judge (frame-level) | `scripts/judge-demo-gif.ts` | runnable |
| deterministic scorers | `src/eval/*Scorer.ts`, `*Runner.ts` (formula recompute, exact/semantic golden) | runnable |
| citation verifier | `boundary_box_receipts` locator contract | runnable |
| proof-receipt schema | `docs/eval/fresh-room/proof-registry.json` → `../../spec/proof-receipt-contract.md` | spec |
| cost/latency ledger | per-step token + time recording | runnable |

**Leave behind:** `btb_noderoom_agent/harbor_adapter.py` (BTB-specific + contaminated), task-family
materializers, Room/RoomTools backend.

## The judge is pluggable

`walkthrough-review` orchestrates `capture → render → media judge → UX judge → report` but
delegates judgment to injected commands. NodeRL formalizes that as a **judge-fn contract** so you
bring your own vision model.

```
feature spec → browser capture → render → judge(video|frames) → reward + Markdown/JSON report
```

## Reward output

Produces a `NodeRewardSummary` (see `../../spec/reward-design.md`) plus a machine-checkable proof
receipt. Headline rewards are **generic-only**; per-task materializers, if any, are diagnostic and
labeled — never the reported number.
