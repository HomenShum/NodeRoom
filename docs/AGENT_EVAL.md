# NodeRoom agent evaluation

Read this before you explain how we know the agent is *correct*, not just *working*. The harness in `docs/AGENT_RUNTIME.md` defines the contract; this defines how we hold it to that contract — deterministically, in CI.

The one thing this whole framework exists to protect: **a human or another agent is never silently clobbered.** Everything below is in service of making that measurable and keeping it at 1.0.

It's runnable:

```
npm run eval          # the golden suite, scripted model (deterministic, no keys)
npm run eval:real     # the same suite against the real Anthropic model
```

Professional workflow evals are tracked separately in
`docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md` and
`evals/professionalWorkflows.ts`. That suite converts real reviewed CSV/XLSX
workflow shapes into redacted GTM, finance, parsing, wiki, and long-running
cases without committing private rows. Private gold packs such as the
three-statement modeling test run only when the local workbook path is provided.
Not every feature starts with a file: the same suite now tracks `chat_only`,
`upload`, `selected_artifact`, `mixed_room_state`, and `external_retrieval`
intake modes so a user can start from a sentence in chat, a selected artifact,
or a room full of existing context — plus `pasted_content` for forwarded
emails/transcripts, whose claims carry `quoted_third_party` provenance, below
user-said. Every intake mode now has at least one declaring case (enforced by
test), and every chat-started case declares an output contract (which surface
the result lands on; person facts private-by-default). The proof boundary is
mechanical: `evals/harnessStatus.ts` maps each harness requirement to a real
entry point or an honest `contract` status, while
`evals/professionalCatalogProofs.ts` verifies every catalog case has intake,
output-surface, provenance, trajectory, privacy/long-running/private-gold, and
requirement-evidence checks. Current deterministic catalog proof is 21/21 with 0 unproofed cases (`npm run eval:professional:catalog-proofs`). Current live-provider catalog proof is also 21/21 for `deepseek/deepseek-v4-flash` (`npm run eval:professional:live-catalog -- --real deepseek/deepseek-v4-flash --require-full`). Current live-provider runtime smoke is 21/21 through `PRODUCTION_ROOM_TOOLS` and runtime-managed locks (`npm run eval:professional:live-runtime -- --strict`). The proof ledger separates that runtime execution from deeper domain blockers: 5 cases are full `live_provider`, 16 are `partial_live_provider`, and 0 remain catalog-only.

The live company-research benchmark is a separate router/cost harness:

```bash
npm run benchmark -- nex-agi/nex-n2-pro:free,ibm-granite/granite-4.1-8b,deepseek/deepseek-v4-flash,z-ai/glm-4.7-flash --no-merge --companies=1 --model-timeout-ms=120000 --model-reserve-ms=10000 --row-hard-timeout-ms=150000
npm run benchmark:charts
```

The supported route bakeoff is generated from a route/scenario registry:

```bash
npm run eval:model-matrix -- --json-out docs/eval/model-eval-matrix-plan.json
npm run eval:model-matrix:live
npm run eval:finance-model
npm run eval:finance-model -- --gold "C:\path\to\modeling-test.xlsx"
```

`docs/eval/MODEL_EVAL_MATRIX.md` defines the supported OpenRouter/native routes
and the scenario split: v3 research synthesis plus L1-L7 collaboration safety.
Passing one lane is not promotion for the other lane. New feature evals are
ranked in `docs/eval/FEATURE_EVAL_BACKLOG.md` and must earn a route proof before
they become product claims.

Its current verified artifact is `docs/eval/results.json`
(`company-research-v3-composite-synthesis`). It records route snapshots,
pricing-at-run, failure ownership, and per-row trace refs
(`docs/eval/traces/benchmark/`). v3 is a **two-call composite**: the harness's
`fetch_row_sources` owns lock/fetch and returns fenced snippets, the model
synthesizes the research fields in its own words, and `write_row` validates
with zod and owns CAS writes/citations/freshness/status/release. A content
floor in `STRUCTURED_FIELDS` rejects disclaimer-shaped non-answers and
from-memory text with no derivation from the fetched evidence — the two
strategies that gamed earlier generations (v2's "9/9" was a deterministic
template grading itself and was invalidated on review; see the README's
"Why v3 exists"). Latest verified v3 run: a 2026-06-11 OpenRouter cheap/free
catalog smoke attempted 28 current tool-capable free or very low-cost routes;
18 cleared 9/9. Fastest free clearer was `nex-agi/nex-n2-pro:free` at $0 and
6.2s; cheapest paid clearer was `ibm-granite/granite-4.1-8b` at $0.0009.
Treat a 9/9 as proof for the background research workflow only. Interactive
collaboration still needs the L1-L7
lock/CAS/draft ladder below — L7 (RESUME) is the rung that gates checkpointed
background jobs: a forced slice death mid-task, a human revision landing while
the agent is dead, and a cold-context continuation that must finish only the
remaining targets without touching completed or human-revised cells.

---

## 0. The user → agent case checklist

Every eval in this repo serves one of **six interaction modes** — the distinct ways a user puts
NodeAgent to work. ✅ = executable behavioral proof today. 🧾 = deterministic catalog proof:
intake/output/provenance/trajectory/privacy contracts are fully specified, but runtime/live promotion
is still separate. 🔜 = designed, sequenced, not yet built. This is the single inventory; if a case
isn't on this list, we don't claim coverage of it.

### Mode 1 — "Do it for me" (autonomous solve)

- ✅ Recompute the variance column with the legacy lock → CAS → release proof lane (`evals/cases.ts` S1)
- ✅ Selective footnote — touch only matching cells, argument correctness (S2)
- ✅ Legacy note resolution + wall sticky through the same CAS path (use cases 6–7); native notebook sync/proposals are tracked separately.
- ✅ GTM tabular research enrichment — pending rows, sourced, status-gated (`tests/researchHarness.test.ts` + the v3 cheap/free live smoke, 18/28 routes 9/9, source fetches + content floor + judge)
- ✅ Executable professional workflow subset — GTM runtime enrichment, messy spreadsheet parsing, cross-file note write, grounded wiki update, and deterministic finance reconciliation (`tests/workflowEvals.test.ts`)
- [live] Professional workflow runtime smoke - 21/21 cases in `evals/professionalWorkflows.ts` pass deterministic catalog proof, 21/21 pass the live-provider catalog planner, and 21/21 now execute through the live room runtime with `deepseek/deepseek-v4-flash`, `PRODUCTION_ROOM_TOOLS`, evidence payload writes, and runtime-managed locks. IBM Granite remains a catalog cross-check at 19/21; GLM Flash and Nex free remain narrow catalog smokes.
- [live] Chat-first GTM intake - **live provider runtime** - "just spoke with X / company Y raised $Z" graded through the real room runtime (`evals/chatIntakeRuntime.ts`, `npm run eval:chat-intake:live -- --managed-locks`): production-managed `write_locked_cell_results` / `write_locked_cells`, runtime coordination evidence (`lockHeldDuringWrite`, `releaseOrTtlFallback`, `noSilentClobber`), capture-first before the single clarifying question, chat claims stay manual evidence, CAS duplicate prevention, ambiguous "Caldera" held at needs_review without guessing, private channel only, and no model-visible lock/unlock calls. The deterministic rung still runs with a naive-saboteur negative control (`tests/chatIntakeRuntime.test.ts`). The pasted-content and background-job cases now have the generic live-runtime smoke; richer domain-specific runners remain separate.
- ✅ Credit analysis — MM-banking ratio cascade + **cell-mapping rejection** (misbound inputs must be refused, `evals/creditEval.ts`)
- ✅ **3-statement modeling test · Solve mode** — private workbook full solve **measured, not single-pass**: `deepseek/deepseek-v4-flash` 5/5 model-owned runs across base/distractor/concurrent-edit room variants (16/16 linked cells each, no answer-key leakage, median 105.0s, p95 $0.1068/run); free `nex-agi/nex-n2-pro:free` is promoted only through the income rung (`docs/eval/FINANCE_MODEL_EVAL.md`)
- 🔜 **SEC model build flagship** — tiered: XBRL fact tie-out → derived ratios with formulas → statement linkage + cited assumptions page
- 🔜 Benchmark v4 — N-document targeted research with the comprehensive company-profile field set (business model, moat, SWOT, funding)
- 🔜 File-drop ingestion — 10-K PDF / XLSX dropped in the room → extracted to the sheet with per-cell citations; receipts → formatted expense report
- 🔜 Knowledge-organization pack — find / link / move / restructure notes and wiki nodes (feeds L9 entity resolution)

### Mode 2 — "Do it with us" (live collaboration)

- ✅ Ladder L1–L7 scripted (read-only · CAS edit · conflict re-read · blocked→draft · large-range discipline · long-horizon compaction · **resume after slice death**)
- ✅ Ladder L1–L4 **live** across the recorded route set (`docs/eval/model-ladder-supported.json`): full passes are `gemini-3.5-flash` and `nvidia/nemotron-3-ultra-550b`; the research champion `deepseek-v4-flash` fails L1/L4 — **proof the two lanes promote separately**
- ✅ Multi-turn refinement with fresh-read provenance (M1) + sustained concurrent room (golden L1)
- ✅ Lock lease fencing, expiry, janitor sweep, host takeover (`tests/lockFencing.test.ts` et al.)
- 🔜 Ladder L5–L7 live across supported routes (config landed at `--levels=1-7`; next matrix run)
- 🔜 **Modeling test · Collaborate mode** — agent + scripted teammates split IS/BS/CF sections under locks/drafts on shared linkage rows
- 🔜 L8 multi-role + redaction · L9 entity resolution · L10 cross-artifact grounded update
- 🔜 Live adversarial-source rung — hostile instructions inside a fetched page during a real route's run (deterministic fence already proven: `tests/promptInjection.test.ts` 4/4)

### Mode 3 — "Work under review" (proposals & approval)

- ✅ Review-mode proposals — auto-allow off → inline cell proposals; room-policy briefing regression (born from a real dogfood bug, `docs/dogfood/FRICTION_LOG.md`)
- 🔜 Contractor-time professional approval fixture — cataloged, but not yet a behavioral runner.
- 🔜 L8 formalizes role-gated approve/promote/redact as a graded rung

### Mode 4 — "Advise me privately" (read-only consult)

- ✅ Private NodeAgent reply — one call, **no tools**, never mutates canonical state; private until promoted
- ✅ Privacy boundaries — private draft ops redacted from non-owners; fenced untrusted room content (prompt injection 4/4)
- 🔜 Sensitive-query guardrail — decline specific financial/medical advice **with a stated reason**, routed through the safety lane

### Mode 5 — "Work in the background" (jobs: long-running, resumable, budgeted)

- ✅ Durable job lifecycle — `agentJobs` checkpointing, exactly-once journal replay, `/free` lane smoke (`tests/agentJobsRuntime.test.ts` et al.)
- ✅ L7 RESUME scripted — forced slice death + human revision while dead + cold continuation
- ✅ Spend governance — per-slice / per-room-day / global-monthly USD caps with breach attribution (`tests/productionGates.test.ts`)
- 🔜 L7 live across supported routes
- 🔜 Checkpointed batch eval — a 100-row research job as resumable per-row units with partial-success reporting

### Mode 6 — "Teach me" (guided solve) — *entirely to build*

- 🔜 **Modeling test · Guide mode** — the agent must coach a scripted student through the model **with zero writes to answer cells** (mechanically checkable), hints graded for referencing the right cell/concept, convergence measured. Restraint as a first-class eval axis — no framework benchmark measures it.

**Cross-cutting gates (all running):** eval store + `eval:diff` regression gate (degraded/removed
fail CI) · supported-route model matrix (research v3 + collab ladder, separate promotions) · HALO
improvement loop · Gemini media judge on every published clip.

---

## 1. Who uses the agent

You can't write good evals until you name who's on the other side of the table. Six personas, each with one thing they care about:

| Persona | Invokes the agent to… | Cares most about |
|---|---|---|
| **Founder / deal lead** (host) | recompute a column, footnote outliers, while teammates type in the same cells | nothing they typed gets silently overwritten |
| **Analyst teammate** (human co-editor) | pull NetSuite numbers in by hand *while* the agent runs | the agent treats their live edits as a moving target (CAS re-read), never clobbers their commit |
| **Guest / anon viewer** | read-only / low-trust participant | the agent never leaks private-channel context to them; `say()` stays correctly scoped |
| **Private NodeAgent owner** | run a private agent that works *around* a lock the public agent holds | drafts merge deterministically and never apply onto a diverged baseline |
| **Runtime engineer** | swap the model seam or the backend seam | a regression gate that proves the no-clobber contract still holds after a prompt/tool/backend change |
| **Eval / QA owner** | run the golden suite in CI | task-completion + no-silent-clobber rate tracked over time; new goldens curated from real traces |

---

## 2. What they do (use cases)

This historical eval set proves the legacy lock → CAS → release / draft
protocol on the three original artifact types. It remains a no-clobber proof,
not the final fast-coediting UX, which is advisory intent plus short publish
leases and CRS/proposals.

1. **Recompute the variance column** — lock the range → read → CAS-edit → release.
2. **Selective footnote** — "footnote any variance over 15%" → edit only the matching `__note` cells (argument correctness).
3. **CAS re-read under a live human edit** (no lock) — a colleague commits between your read and write; survive via re-read + retry.
4. **Lock prevents the race** — claim the exact range first; the concurrent human write is *blocked*, so you see zero conflicts.
5. **Locked range → draft → smart-merge** — the range is already held; draft around it instead of waiting; merge on release only if the baseline is unchanged.
6. **Legacy note artifact** — resolve the open question in the note (same protocol on a `kind:"note"` single `doc` element). Native notebook evals should instead cover ProseMirror dirty events, read-model processing, proposals, and approved/labeled append blocks.
7. **Wall artifact** — add/reposition a sticky (structured `{text,x,y,color}` value through the same CAS write path).
8. **Multi-turn refinement** — turn 1 recompute; turn 2 footnote — must re-read fresh versions, not reuse turn-1 baselines.
9. **Sustained concurrent room** — agents + humans hammering the variance column; measure no-clobber across many interleavings.

---

## 3. The golden-case shape

A golden case is an **input** paired with the **desired output** — and for an agent, "output" is both the final state *and* the path it took. Defined in `evals/cases.ts`:

```
input    = { goal, room_seed (artifact + element values + versions), concurrency_script, maxSteps }
expected = {
  final_state:     per-element { value, minVersion }          // outcome
  trace_invariants: ordered + unordered assertions over the   // trajectory
                    AgentTraceEvent[] — baseVersion provenance,
                    lock-before-edit, draft-on-denied-lock,
                    release-after-edit, conflict→re-read
  forbidden:       clobbers · ignored conflicts · edits on others' locks
  budget:          exhausted === false
}
```

Both halves are scored **deterministically** — outcome by `engine.getArtifact()` / `snapshot()`, trajectory by filtering the `trace`. **No LLM judge is needed for the core gate** (an LLM-as-judge is reserved only for the P2 narration-quality check). The runner is `evals/runEval.ts`; inputs reuse the real `demoRoom` rows (`r_rev/r_cogs/r_gp/r_opex/r_ni`, editable `__variance`/`__note`).

---

## 4. Golden references (the desired I/O pairs)

### Single-turn

**S1 · recompute-variance (happy path, with lock).**
Input: `goal = "recompute Q3 variance from the NetSuite export"`, seed `r_rev__variance=''[v1]`, `r_cogs__variance=''[v1]`, no concurrency, `maxSteps=14`.
Expected final: `r_rev__variance={value:"+24%", minVersion:2}`, `r_cogs__variance={value:"+27.5%", minVersion:2}`.
Invariants: `propose_lock([r_rev__variance,r_cogs__variance])` **before** any `edit_cell`; every `edit_cell.baseVersion` came from a preceding `read_range` of *that* cell; `release_lock` after the last edit; `conflicts==0`; `exhausted=false`.

**S2 · selective footnote (argument correctness).**
Input: `goal = "add a footnote to any variance over 15%"`, seed `r_rev__variance="+24%"[v2]`, `r_cogs__variance="+9%"[v2]`, `r_gp__variance="+21.7%"[v2]`.
Expected: `r_rev__note` and `r_gp__note` set; **`r_cogs__note` unchanged** (9% < 15%).
Invariant: reads precede the note edits; **no `edit_cell` touches `r_cogs__note`** — the agent targeted only the right cells.

### Multi-turn

**M1 · two-turn refinement in one thread.**
Turn 1: "recompute Revenue and COGS variance" → claim → edit → release (`+24%[v2]`, `+27.5%[v2]`).
Turn 2 (fresh `runAgent` on the **same** room): "now also footnote anything over 20%".
**The invariant that matters:** every turn-2 `edit_cell.baseVersion` is sourced from a **turn-2** `read_range` — never reused from turn-1 context. `context.ts` rebuilds the JIT table each run, so stale-baseVersion reuse is a real, detectable regression. The room *is* the shared state across turns — no conversation memory required.

### Long-running

**L1 · sustained concurrent room (the headline stress test).**
The public agent holds a lock on `[r_rev__variance, r_cogs__variance]` and commits; the private agent is asked to set a contended range; two humans inject timed edits during the window. Behavior under test: a blocked agent **does not wait** — it reads the locked range as context and `create_draft`s; while locked the cells stay unchanged; on `release_lock` the draft smart-merges (clean-apply if baseline unchanged, no-op if equal, **flag-without-applying if diverged**).
Measured over the window: (1) **sustained no-silent-clobber = 1.0**; (2) draft-merge correctness (clean / no-op / flag verdict per draft); (3) **lock-scope tightness** — `|locked|` never exceeds `|edited|`; (4) **liveness** — every participant makes progress, no dead-wait, `exhausted=false`. Run the same interleaving with **N random orderings** of the injected edits and assert no-clobber holds for *every* ordering — that's the duration axis, not one happy path.

---

## 5. The metrics

Outcome metrics say *what* happened; trajectory metrics say *how*. A planning agent can make every individual tool call look reasonable while following a bad plan — so we score both.

| Metric | Kind | What it asserts | Target |
|---|---|---|---|
| **No-silent-clobber rate** ⭐ | outcome + trace | every applied `edit_cell` had a preceding `read_range` of that cell at the same version; no committed value overwritten without an intervening read | **1.0** |
| Task completion | outcome | final element values + versions match `expected.final_state` | 1.0 on goldens |
| Conflict-recovery rate | trajectory | of `edit_cell` calls that returned `{conflict:true}`, fraction followed by a re-read + successful retry | 1.0 |
| Protocol adherence | trajectory | lock-before-edit · baseVersion provenance · release-after-edit · `draft` on denied lock (not wait/retry-loop) · no edit on another holder's locked cell | per-invariant pass-rate |
| Lock-scope tightness | trajectory | `editedCells / lockedCells` — don't lock the whole sheet to edit two cells (starves teammates) | 1.0 |
| Tool / step efficiency | trajectory | steps vs the golden minimum; redundant-read / over-lock rate | flag at > 2× min |
| Budget safety | outcome | `AgentResult.exhausted === false` — finished inside `maxSteps`, didn't loop | always |
| Narration scope | trajectory (light judge) | one `say()` at start + finish; a public agent posts publicly, a private agent only to its owner — no private context leaks | pass |
| Latency & cost | operational (real-model only) | wall-clock + tokens + tool calls; not gating on the scripted path | track |

**CI gate:** a golden PASSES only if task completion = 1.0 **and** every required invariant holds **and** `exhausted = false`. No-silent-clobber failing is an automatic fail regardless of task completion — *completing by clobbering is the worst outcome, not a partial win.*

`evals/runEval.ts` runs **6 golden cases** deterministically and scores task completion + the protocol invariants. It executes all three shapes: **single-turn** (S1-style lock/CAS), **multi-turn** (M1 — runs each turn on the same room and asserts the shared cell's version strictly increases per turn, proving fresh re-reads), and **long-running** (L1 — a property test that runs N interleavings of an injected concurrent edit and asserts no-silent-clobber holds for *every* ordering). It grows toward the full metric table above.

Private answer-key workbooks are handled separately from committed goldens.
`eval:finance-model-private` validates a local three-statement modeling workbook
and its answer-key formulas without storing the workbook or expected values in
git. `eval:finance-model` runs the actual NodeAgent tool workflow: lock the
forecast cells, read versions, CAS-write formulas, release, then grade both the
artifact and trace. Its default committed trace uses an owned synthetic gold
pack for README media; passing `--gold` runs the same workflow against a private
local workbook. Live private runs write full traces under gitignored
`docs/eval/finance-model-runs/` and commit only the redacted
`docs/eval/finance-model-live.json` summary. The current full Solve promotion is
`deepseek/deepseek-v4-flash`: 5/5 model-owned full solves, 16/16 linked forecast
cells each run, no answer-key leakage, median 105.0s, p95 $0.1068/run, and zero
provider-owned failures. That aggregate was recorded with `--runs=5 --record`.

---

## 6. Context compaction (long-running runs)

A long-running agent's message history is dominated by **old `read_range` results** — fat JSON arrays, each superseded by the next read. Left alone, the context window fills with dead weight. The fix, matched to the top production patterns:

- **Anthropic Claude — "context editing":** clear stale tool results from the window; keep the system prompt, the latest state, and recent turns. (Plus the *memory tool* and *compaction* = summarize old turns.)
- **Nous Research Hermes:** structured tool-call turns — we preserve the turn shape so the model stays coherent.

NodeRoom implements this in `src/nodeagent/core/contextCompactor.ts` (`compactMessages`), wired into `runtime.ts` (the model sees a compacted view each turn; the full history is kept for audit):

- **Trigger** — when the estimated context exceeds `maxChars` (~`chars/4` tokens).
- **Preserve** — message 0 (the task + initial snapshot), the last `keepRecent` turns verbatim, and every message **envelope** (so the assistant↔tool pairing the API requires is never broken).
- **Elide** — replace the *content* of old `read_range` tool results with a one-line stub (they're stale). An optional `summarize` seam swaps the stub for an LLM running-summary (the Claude "compaction" pattern).

Tested in `tests/compaction.test.ts`: it shrinks the history, preserves every envelope, and an agent run with compaction enabled still completes the task.

---

## 7. Curating new goldens

The suite grows from two sources, both standard practice:
1. **Anonymized production traces** — replay a real room trace, freeze the desired final state, add it as a golden.
2. **Dueling-LLM synthesis** — generate candidate goals, run two models, diff the trajectories, and promote the disagreements into goldens (they're where the contract is ambiguous).

Never delete a failing golden to make the suite green — fix the harness.

---

## File map

| Concern | File |
|---|---|
| Golden cases (the I/O pairs) | `evals/cases.ts` |
| Eval runner + scoring | `evals/runEval.ts` |
| Context compaction | `src/nodeagent/core/contextCompactor.ts` |
| Compaction + runtime tests | `tests/compaction.test.ts`, `tests/agentRuntime.test.ts` |
| The harness being evaluated | `src/nodeagent/` (see `docs/AGENT_RUNTIME.md`) |
