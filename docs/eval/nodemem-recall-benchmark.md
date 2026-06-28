# NodeMem Long-Context Recall Benchmark — before/after

**Question that started it:** *is the NodeMem benchmark accurately testing real end users (e.g. Mark Liu's VC
diligence) when context grows long?* No — the original benchmark seeded 3 facts on a trivially-completable
task, so memory could not matter. This benchmark accumulates a realistic memory graph and asks a
**recall-dependent** task whose answers are **memory-only** private-diligence notes (synthetic, non-web,
not in any label/question), then measures whether memory injection lets the agent recall them.

- Harness: `e2e/nodemem-recall-benchmark.spec.ts` · graph: `e2e/nodemem/portfolioGraph.ts`
- Matrix: memory size {10, 50, 200} × variant {bare, shadow, bounded(600), full(1200)} × 3 trials = 36 runs
- Environment: isolated LOCAL Convex backend (never prod), model `z-ai/glm-5.2`
- recall = (buried facts the agent answered correctly) / (buried facts present in memory at that size)
- Answer graded from the authoritative `agentJobs.finalText` (the agent writes to virtualized sheet rows +
  chat that DOM-scraping silently misses).

## Result

| size | bare | shadow | bounded (600) | full (1200) | pack bounded/full |
|-----:|:----:|:------:|:-------------:|:-----------:|:-----------------:|
|  10  | 0.00 | 0.00   | 0.00          | 0.00        | 1421 / 1974 |
|  50  | 0.00 | 0.00   | **1.00**      | **1.00**    | 1525 / 2736 |
| 200  | 0.00 | 0.00   | **1.00**      | **1.00**    | 1506 / 2716 |

n=3, stdev=0.00 on every cell.

## Interpretation

- **Memory provides a decisive recall lift: 0.00 → 1.00.** With injection off (`bare`) or recorded-but-not-
  injected (`shadow`), the agent cannot recall the private facts and marks `needs_review` (10–19 per run).
  With injection on (`bounded`/`full`), it recalls **every** answerable buried fact.
- **Size 10 is the control.** At 10 facts only public tier-1 facts are in memory; the buried targets aren't
  present, so 0 targets are answerable and recall is 0 for *all* variants — confirming the agent does **not**
  hallucinate the synthetic tokens when the fact is absent (no false positives).
- **Robust to noise.** At size 200 (≈190 noise tracking notes burying the ~6 signal notes) recall stays
  **1.00** — content-aware retrieval surfaces the relevant notes despite heavy accumulation.
- **bounded ≡ full on recall (both 1.00), but at ~55% of the tokens.** The 600-token budget already fits all
  ~6 simultaneously-needed notes, so the budget never binds for this 6-question task — `full` injects ~2×
  the tokens for the same recall. The budget would only bind (bounded < full) with many more simultaneous
  recall targets; that's a future extension, not a property of memory size.

## How it was made to work — seven fixes

The fixed-version recall above required closing seven stacked gaps the benchmark exposed (commits
`de2dc49e` → `f7acf155`):

1. Compiler emitted coarse `(entity) mentioned_in (sourceKind)` triples → pack now carries **raw note text**.
2. Binary top-5+5 trim (`bounded`≡`full`) → **budget-proportional**.
3. Content-blind ranking → **content-aware** raw-note selection by goal overlap.
4. Injection was wired only into `agent.ts runRoomAgent`; the chat path is `agentJobRunner.ts` → injected there.
5. Grader scraped DOM that misses the answer → grades authoritative `agentJobs.finalText` (env-gated query).
6. Grader stabilized before the agent replied → polls job completion.
7. Prompt-echo + leaky labels false-positived the grader → clean labels + synthetic tokens.

## Caveats

- Run on a single-node **local** backend (latency not prod-comparable; *relative* recall is the signal).
- Cheap model (`glm-5.2`); a stronger model would likely not change the off→on recall gap.
- The per-room override + `benchRoomAnswer` are **env-gated** (`NODEMEM_ROOM_CONFIG_ENABLED` + a shared
  secret) and inert in production.
