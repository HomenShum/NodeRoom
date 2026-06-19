# Design grounding synthesis — 2026-06-13

Output of a 17-agent grounding workflow over the June 2026 design corpus
(UI shell · intake/scheduler harness · Univer runtime · eval stack / NodeRoomBench · harness-honesty).
Every proposal was checked against the **actual repo**; every external citation was web-verified.

Status note after the target implementation pass: this folder is the grounded design/readout that drove
the June target work. Current built-vs-gap status lives in `docs/TARGET_2026_06.md` and
`docs/qa/production-matrix.json`. In this commit, the MVP shell moved to Room Binder -> Work Surface ->
Copilot with a shell-level Signal Tape/Status Strip, and the typed intake/preflight contract landed as
`src/nodeagent/core/intakePreflight.ts`; center-stage split mode, richer binder click-through, live provider
PlanPreview gating, and workbook-runtime adapter work remain tracked gaps.

2026-06-18 docs cleanup note: this folder is historical design synthesis, not
current implementation authority. For the current notebook/passive-intelligence
and agent-review architecture, read:

- [`../PASSIVE_NOTEBOOK_SINGLE_SOURCE_FIX.md`](../PASSIVE_NOTEBOOK_SINGLE_SOURCE_FIX.md)
- [`../NATIVE_NOTEBOOK_ARCHITECTURE.md`](../NATIVE_NOTEBOOK_ARCHITECTURE.md)
- [`../AGENT_ARTIFACTS.md`](../AGENT_ARTIFACTS.md)
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md)

## The one-line verdict

> ~80% of all four proposals restate doctrine or code that **already exists** in this repo.
> The net-new surface is small and specific: **UI shell restructure · preflight+classifier intake router ·
> runtime-independent grid/eval wins · a thin NodeRoomBench.**
> Strategic fork resolved: **EXTEND the home-grown workbook engine — do not adopt Univer as the runtime.**

## Read in this order

1. [00_ROADMAP.md](00_ROADMAP.md) — master roadmap: executive decision, already-built list, scope-gravity drop-list, cross-workstream sequencing, harness-honesty one-pager, open decisions.
2. [CITATION_LEDGER.md](CITATION_LEDGER.md) — all 28 external citations fact-checked. **26 verified, 2 need correction** (WorkstreamBench→MBABench; SheetAgent 20–30%→20–40%).
3. Per-workstream build specs:
   - [specs/A_UI_SHELL.md](specs/A_UI_SHELL.md) — shell restructure as tickets against the existing canonical `docs/TARGET_2026_06.md`.
   - [specs/B_INTAKE_SCHEDULER.md](specs/B_INTAKE_SCHEDULER.md) — classifier → preflight → scheduler front door, reusing existing lock/closure code.
   - [specs/C_UNIVER_RUNTIME.md](specs/C_UNIVER_RUNTIME.md) — extend-vs-adopt verdict + the runtime-independent wins worth building now.
   - [specs/D_NODEROOMBENCH.md](specs/D_NODEROOMBENCH.md) — 4-layer naming + thin packaging + the two genuinely-missing graders.
   - [specs/E_FIRST_TIME_BANKER_HAPPY_PATH.md](specs/E_FIRST_TIME_BANKER_HAPPY_PATH.md) — historical first-time banker notebook/passive-inbox slice; passive trigger details are superseded by the native notebook single-source docs above.

## Scaling, cost & architecture boundaries (added 2026-06-13)

4. [SCALING_COST_ANALYSIS.md](SCALING_COST_ANALYSIS.md) — real latency / multi-user / multi-agent / bandwidth / cost, grounded in the measured perf docs (memory mode vs live Convex).
5. [PRODUCTION_SCALING_PATTERNS.md](PRODUCTION_SCALING_PATTERNS.md) — how production apps (Figma, Linear, Replicache, Convex, …) solve each bottleneck B1–B6, web-sourced. *(The B5 per-cell-LWW line is superseded for finance cells — keep CAS + proposals; see CONVEX_AS_LEDGER.md §B5.)*
6. [../architecture/CONVEX_AS_LEDGER.md](../architecture/CONVEX_AS_LEDGER.md) — **authoritative architecture rule**: Convex = ledger (not keystroke pipe / scratchpad / OLAP); per-bottleneck prescription, the C2/A1:C5 runtime, streaming policy, algorithm artifacts, implementation order. Validated against code: ~70% confirms shipped/designed primitives; net-new = pagination, viewport-range index, branch/patch-bundle layer, `/ask` admission control.

## Key grounding facts that reframe the corpus

- The Deal Binder / Work Surface / Copilot / Signal Tape / Status Strip shell, the four-role contract,
  the binder-is-navigational rule, and the four responsive bands are **already canonical** in `docs/TARGET_2026_06.md`.
- The "artifacts wrongly in a bottom drawer" correction is a **no-op** — no such desktop drawer exists in the code.
  The genuinely-missing piece is center-stage **split mode**.
- Locks / CAS / drafts / no-clobber / dependency-closure expansion / idempotency are **built** (`convex/locks.ts`,
  `drafts.ts`, `src/nodeagent/core/idempotency.ts`). The intake **router** (queue vs parallel vs steer) and the **preflight**
  call at plan time are the real gaps.
- Eval Layers 1/2/4 and the harness-honesty standard are **already implemented**; only Layer 3
  (format + dynamic-correctness perturbation) is net-new.
