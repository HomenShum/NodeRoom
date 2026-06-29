# Reward design

Rewards are built from signals that **already exist as runnable code** in the originating product,
plus penalties that encode product values. The reward summary attaches to a trajectory.

```ts
interface NodeRewardSummary {
  taskSuccess: number;        // deterministic test / benchmark scorer
  evidenceGrounding: number;  // citation verifier (boundary-box receipts)
  visualQuality: number;      // Gemini media / video judge
  noClobber: number;          // human-agent safety (no overwrite of human edits)
  costEfficiency: number;     // relative to a successful baseline
  latencyEfficiency: number;
  safety: number;             // privacy / SSRF / secret handling
  total: number;
  labels: string[];
  failureCategories: string[];
}
```

## Signals and where they come from

| Signal | Source (exists today) |
|---|---|
| deterministic tests | benchmark runners / scorers (`src/eval/*Runner.ts`, `*Scorer.ts`) |
| benchmark scorer | formula recompute + exact/semantic golden comparison |
| evidence grounding | citation verifier — `boundary_box_receipts` locator contract |
| visual quality | Gemini media/video judge + GIF judge (frame-level) |
| export-reopen | downloaded `.xlsx/.pptx/.docx/.pdf` reopened + structure-validated |
| cost / latency | per-step token + time ledger |
| no-clobber | human-agent edit-collision check (product-side; spec here) |

## Example reward (banker-style task)

```
R = 1.00·task_pass
  + 0.40·deliverables_reopened
  + 0.40·evidence_grounded_claims
  + 0.25·no_human_clobber
  + 0.20·visual_trace_quality
  + 0.15·final_answer_honesty
  − 0.25·unsupported_claims
  − 0.20·repeated_tool_error
  − 0.15·cost_over_budget
  − 0.15·latency_over_budget
  − 1.00·privacy_or_security_violation
```

## Example reward (coding-agent repair)

```
R = 1.00·proof_verdict_pass
  + 0.40·browser_proof_pass
  + 0.30·negative_fixture_added
  + 0.30·architecture_graph_updated
  + 0.20·small_readable_diff
  − 0.50·fake_done_claim
  − 0.40·shallow_qa
  − 0.30·god_object_or_bad_directory
  − 1.00·secret_or_destructive_violation
```

## Anti-reward-hacking

The headline number is **generic-only** (no per-task answer-key writers). Per-task materializers,
if present, are diagnostic and must be labeled as such — never the reported reward. A reward that
can be earned by hardcoding the output is the wrong reward (see `anti-cheat-doctrine.md`).
