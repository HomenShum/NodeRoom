<!-- Provenance: synthesized by ultra workflow wf_c8370206-f4e (2026-06-09): 25 agents, 4.0M tokens, 554 tool calls.
     Pipeline: 6 subsystem deep-reads + 5 production-pattern researchers -> 10 root-cause clusters -> altitude judges
     -> adversarial skeptic (killed 7 of 88 candidates) -> completeness critic -> this synthesis. -->

<!-- STATUS-UPDATE 2026-06-09 (post-implementation; read THIS before trusting item statuses below): -->
<!-- DONE+TESTED: P0-1 caseSetHash + removed/model-changed/checks-redefined diff classes (evals/evalStore.ts, 8 tests) ·
     P0-2 tamper guard (evals/evalDiff.ts tamperIssues, append-only always-on + --tamper-strict) ·
     P0-3 --strict pass-through + handoff demotion when budget red (scripts/agent-improvement-loop.ts, verified live) ·
     P0-4 USD ceiling: runtime priceStep + wired into convex/agent.ts AND convex/agentJobRunner.ts (AGENT_MAX_USD_PER_*) ·
     P0-5 lease-epoch fencing + renewal (convex/artifacts.ts, lib.ts lockCoveringElement; tests/lockFencing.test.ts 6/6) ·
     P0-6 free-auto claims rewritten (docs/WHY_NODEAGENT_AND_HALO.md) ·
     P1-1 private-draft ops redaction (convex/rooms.ts) · P1-2 lock TTL janitor (convex/crons.ts + locks.ts sweepExpiredLocks) ·
     P1-3 error-handoff preserves unexecuted tool calls via emitHandoff (src/nodeagent/core/runtime.ts) ·
     P1-4 failingEvalEvidence in handoff packet (suite-aware repro) · P1-5 check-to-trace pointers (evals/ladder.ts checkFailurePointers) ·
     P1-6 host takeover (convex/locks.ts hostForceReleaseLock) · P1-7 cell-mapping credit eval (evals/creditEval.ts, 5/5) ·
     P1-8 event-driven capture · P1-9 docs honesty batch. STILL OPEN: P2 table below + the 8 completeness-gap open questions. -->

# NodeRoom + HALO — Final Ranked Improvement Roadmap

> Historical status, 2026-06-18: retained for rationale, failure modes, and the
> do-not-build list. Do not use this as the current implementation queue.
> Current authority is [SOURCE_OF_TRUTH.md](SOURCE_OF_TRUTH.md),
> [NEXT_STEPS_PRIORITY.md](NEXT_STEPS_PRIORITY.md), and
> [GAPS_NOT_DONE.md](GAPS_NOT_DONE.md).

Date: 2026-06-09 · Repo: `D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom` · Status: synthesis of skeptic-tested candidates, refutations, subsystem audits, completeness gaps, and production-pattern research. All P0 evidence anchors were re-verified against source in this session (grep/read), including one previously-unverified leak (P1-1). The repo currently has ~80 dirty in-flight files from a parallel agent and a running overnight eval loop — nothing in this doc was edited into the repo; it is a plan, not a change.

## Executive summary

- **The eval gate is the load-bearing wall, and it is currently game-able and blind.** `diffByCase` silently drops removed cases (evals/evalStore.ts:86-89 iterates `toMap` only), and `isEvidenceFile` (src/eval/architectureBudget.ts:119-121) whitelists `evals/` and `docs/eval/` — so a loop-originated patch can edit the goldens, the append-only store, or the gate itself and go green. P0-1/P0-2 close this before anything else is trusted.
- **Two safety caps are theater, one core invariant is structurally broken.** The spend ceiling receives `costUsd: 0` (src/nodeagent/core/runtime.ts:225, verified) while overnight live lanes run; and LOCK_TTL (5min, convex/locks.ts:32) < slice budget (9min, convex/agentJobRunner.ts:25) guarantees every long job writes after its lease lapses with no fencing (convex/artifacts.ts:204-207 rejects only *other* holders; writes carry no lockId). P0-4/P0-5.
- **The handoff loop currently feeds its fix agent thin or false information.** Packets say "see captured output" while the store row one import away carries checks/failureSummary/traceRef (P1-4); the budget gate's `--strict` flag exists but no loop passes it (P0-3); and WHY_NODEAGENT_AND_HALO.md:151-152 contradicts the repo's own recorded L3 FAIL (P0-6).
- **One newly verified data leak:** convex/rooms.ts:90 masks a private draft's `note` but returns its `ops` verbatim to every room member (P1-1, one-line fix).
- **The do-not list is as load-bearing as the roadmap.** 26 candidate classes were judged over-engineering (judge-in-the-gate, held-out slices, registries, presence channels, ABL engines, packet ceremony) — recorded here with reasons so future sessions do not re-propose them.

## Roadmap

### P0 — load-bearing, ordered by dependency

| # | Item | Root cause it fixes | Evidence | Effort | Order |
|---|------|---------------------|----------|--------|-------|
| P0-1 | `caseSetHash` (sorted-key) pinned in EvalRunRecord + diff delta classes: regressed / case-added / case-removed / case-redefined / model-changed | Incomparable runs diffed silently: removed cases vanish; check-tightening reported as code regression; fallback-model swaps reported as degradation | evals/evalStore.ts:86-89 (verified: only `toMap` iterated); harnessVersion already on record; convention: stableJournalHash in src/nodeagent/core/journal.ts; pattern: LangSmith dataset versioning (docs.smith.langchain.com/evaluation/how_to_guides/dataset_version) | S | 1 — every later item is verified through this gate |
| P0-2 | Tamper-guard path denylist in eval:diff: fail on diffs touching `docs/eval/eval-runs.jsonl` (append-only prefix vs HEAD), `evals/cases.ts`, `evals/evalDiff.ts` | Trust inversion: the budget check actively whitelists the store, goldens, and gate as "evidence", so the canonical proxy-hack path passes both checks. Unattended nightly loop + literature showing 47-74% of unguarded self-improvement wins are proxy hacks | src/eval/architectureBudget.ts:119-121 (verified whitelist); evals/evalDiff.ts:35 exits 1 (enforcement home); openreview.net/forum?id=ikrQWGgxYg; arxiv.org/html/2511.16858v1 | S | 2 — rides on P0-1's delta classes |
| P0-3 | Pass `--strict` to architecture-budget in both loops; demote impl handoffs to blocked when the budget step is red | Gate exists but is never armed: no invocation passes `--strict`, and buildHandoff emits implementationHandoffCandidates even when the budget says review-required — Codex receives scoped impl handoffs while forbidden surfaces are dirty | scripts/architecture-budget-check.ts:9-10 (verified flags exist, unused); scripts/agent-improvement-loop.ts:311-348, :139 | S | 3 — honest caveat: whole-worktree gitChangedFiles() stays red under ~80 parallel-agent dirty files; the zero-false-positive half is handoff demotion |
| P0-4 | Wire running cost into checkSpendCeiling; nightly cumulative USD cap halting the supervisor | `maxCostUsd` is dead API surface (HONEST_STATUS class): the only caller sets tokens only, and the gate receives a hardcoded zero — total job cost unbounded if FREE_AUTO_JOB_MODEL points at a paid model (one env var) | src/nodeagent/core/runtime.ts:225 (verified `costUsd: 0`); per-step cost already computed via convexPriceRun (convex/agentJobRunner.ts:179) | S | 4 — independent; most urgent runtime safety item while overnight lanes run |
| P0-5 | Lease-epoch fencing: writes carry lockId, expired lease → `lease_expired` as data; renew lease on successful write | Structurally guaranteed hole: 5min TTL < 9min slice budget means every long job writes un-fenced after expiry; the lock gate rejects only OTHER holders; per-cell CAS does not restore the cross-cell range guarantee the formula-dependency lock expansion exists to provide | convex/locks.ts:32, convex/agentJobRunner.ts:25, convex/artifacts.ts:204-207 (all verified; zero `lockId` matches in artifacts.ts); martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html (fencing tokens) | M | 5 — core product invariant; pairs with P1-2 janitor |
| P0-6 | Rewrite free-auto reliability claims against recorded ladder results (~6 lines) | A 10-second-checkable contradiction feeding a false belief to the HALO handoff agent, which could productize a durable lane on a route that fails the correctness rung | docs/WHY_NODEAGENT_AND_HALO.md:151-152 (verified: "correct but… doesn't finish L4") vs README:400 (L3 FAIL, L4 TIMEOUT); README:401-402 holds the honest nuance (expanded candidates pass L3) | S | 6 — no dependencies; protects loop diagnosis quality |

### P1 — this sprint

| # | Item | Root cause it fixes | Evidence | Effort |
|---|------|---------------------|----------|--------|
| P1-1 | Redact `ops` for private-scoped drafts in room-state query | Field-level redaction incomplete: private draft masks `note` only, leaks actual cell edits to all members | convex/rooms.ts:90 — **verified in this session**: `ops: d.ops` returned verbatim while note is masked | S |
| P1-2 | Lock TTL janitor: transition status, clear session heldLockId, fire mergeBlockedDrafts for the expired lockId | Three live bugs: expired locks render locked-forever (status='active' filters); TTL-expired locks strand blocked drafts in 'pending' permanently (sole merge call site is releaseLock, convex/locks.ts:95 — verified); zombie rows grow unbounded scans | convex/locks.ts:95,104; convex/artifacts.ts:109 | M |
| P1-3 | Preserve unexecuted tool calls (or stub results) in the error-path handoff | Mid-turn tool throw checkpoints a cursor with unpaired tool_use blocks → every durable resume 400s until maxAttempts kills the job. The corruption kernel is real; conflicts/transients are already handled as data | src/nodeagent/core/runtime.ts:100,136 (verified `remainingToolCalls: ToolCall[] = []` default on error handoffs) | S |
| P1-4 | Embed checks, failureSummary, traceRef, caseId, runKey + repro command in the handoff packet | Packet discards evidence that exists one import away ("see captured output"); minimal slice of packet v2 | scripts/agent-improvement-loop.ts:320; evals/evalStore.ts:19-39; pattern: OpenAI agent-improvement-loop cookbook fixed-section contract (developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop); context-labs/halo evidence-linked claims | S |
| P1-5 | Check-to-trace event mapper: failing-event pointer on each false check | Predicates already compute the offending event index, then discard it — bare booleans force the fix agent to grep full trace JSON | evals/ladder.ts:395-449 (rungChecks); scope to pointer only, not a check framework | S |
| P1-6 | Human lock takeover (host-only force-release; Hex "Yoink") | Humans wait up to 5min behind a stuck agent lock with zero recourse; release path already calls mergeBlockedDrafts; conflict-as-data loop absorbs post-takeover CAS losses | convex/locks.ts:73; convex/lib.ts:158; hex.tech/blog/a-pragmatic-approach-to-live-collaboration/ | S |
| P1-7 | Cell-mapping eval + deterministic RatioResult provenance (build as one unit) | Credit suite tests the math library against itself (model:'deterministic'); the seam where production spreading fails — cell→argument binding — has zero coverage; today the LLM authors the evidence the tool mandates | evals/creditEval.ts; mapping scored as per-check booleans in existing EvalRunRecord shape; ratio path reads via readRange, emits {cellRef, elementVersion}; arxiv.org/abs/2211.12588 (PoT); scryai.com/blog/automated-financial-spreading-commercial-lending/; moodys.com agentic Credit Memo (provenance-per-figure) | M |
| P1-8 | Event-driven preview frame capture: await the collab done signal, assert finished cell state | 16 blind 160ms sleeps + `frames.length > 10` silently capture mid-run state under load — degraded proof asset nobody notices. NOT a tool-results event bus | e2e/capture-previews.spec.ts:51-56 | S |
| P1-9 | Docs honesty batch (one pass): live-vs-deterministic caveat w/ gate link; "4/4" → 6 golden cases linking evals/cases.ts; CAS-vs-agentLeases boundary sentence | Three checkable staleness/ambiguity classes in an interview artifact; the boundary sentence is mandated by the architecture doc itself and prevents a HALO agent believing agentLeases enforce writes | README:28-33 + docs/GAPS_NOT_DONE.md:24-33; README:254 vs evals/cases.ts:37-110; NODEAGENT_ARCHITECTURE.md:699-700 | S |

### P2 — later (with explicit triggers where deferral is evidence-gated)

| # | Item | Trigger / sequence | Effort |
|---|------|--------------------|--------|
| P2-1 | README showcase pass: hero GIF above fold (app-variance-fill.gif, 620KB real DOM capture); L5 large-range preview (traces exist, replayer renders unchanged); skill-bar anchor index for 13 GIFs; CI size/duration/alt assertions (~20 lines, qa:matrix:check pattern) | One markdown+script PR; explicitly excludes renderer-hash drift gating | S |
| P2-2 | Per-cell attribution chips + actor-filtered history | Thin UI over existing by_room_element index (schema.ts:561-570 comment names this exact use) | S |
| P2-3 | Record `valueBefore` in agentMutationReceipts | Honest slice of undo (GAPS_NOT_DONE P1); full revert mutation deferred until a forcing failure | S |
| P2-4 | `--record` shim on existing workflowEvals suite (suite='workflow') | The 5 runnable scenario evals never reach the store; shim, not a new producer | S |
| P2-5 | Persist costUsd/tokens in eval records (no budget gate) | 3-line additive; live-run cost otherwise unrecoverable from JSONL | S |
| P2-6 | Cross-foot/tie-out primitives + error-injection detection eval | After P1-7's messy fixtures exist; methodology: arxiv.org/abs/2506.17282 | M |
| P2-7 | FinChain-style parameterized borrowers, seeds recorded in store | Only after P1-7 puts mapping under test (otherwise circular); arxiv.org/abs/2506.02515 | M |
| P2-8 | Draft auto-rebase loop (bounded retries vs fresh snapshot) | Trigger: P1-2 janitor landed AND nonzero conflicted-draft rate in evals; pattern: stack.convex.dev/object-sync-engine | M |
| P2-9 | Block-granular notes/wiki elements on existing lock/CAS/draft machinery | Trigger: note collisions appear in evals (wiki_update writes one whole-note element, tools.ts:126). Right altitude vs OT/CRDT | L |
| P2-10 | Grouped proposal review: diff preview, partial accept, batch apply | After P2-3 and P1-6; interim per-proposal flow exists (Artifact.tsx:738-771); patterns: Google Docs suggestion sets, Ink&Switch Patchwork partial merge | M |
| P2-11 | Human calibration set + judge alignment gate | Trigger: a judge produces in-store verdicts. Start labeling ~20-30 retained traces opportunistically now; blog.langchain.com/introducing-align-evals/ | M |
| P2-12 | Diagnosis denoisers: passing-run trace diff (deterministic lanes) after P1-5; markdown per-case regression report after P1-4 | Google Auto-Diagnose differential pattern, arxiv.org/html/2604.12108v1 | S |
| P2-13 | Runtime hygiene batch: agentOperationEvents retention cron; journal per-step inputHash validation (column exists, constant recorded — agentStepJournalClient.ts:20); redactPII coverage for tool-result messages; supervisor max-consecutive-instant-exit counter (exit 1 + diagnostic); age cap on in-flight idempotency reuse (orphaned row currently bricks a goal forever) | Each S; none load-bearing today; the idempotency age cap fixes the REAL latent bug the cut time-bucketing candidate missed | S each |
| P2-14 | Capture polish: two-client CAS-conflict GIF (trigger: reactivity.backend.spec passes with E2E_CONVEX_URL + data-cell-key testid exists); fake cursor with caption disclosure; provenance caption autogen (after manifest covers all three channels) | Sequenced behind real prerequisites the original candidates falsely assumed existed | S-M |
| P2-15 | Security & capacity track — see Open Questions; each item needs its own skeptic-tested audit before sizing | Not yet through the verification pipeline; do not implement from this doc alone | M-L |

## Do-NOT-build list (judged over-engineering — do not re-propose)

1. **LLM-judge producer wired into the diff gate**, and per-dimension rubric judges riding on it. The ui lane is manual (`--ui-media`), media differ per run, the judge is stochastic — verdicts in an exit-1 gate become flaky named regressions that send the handoff agent chasing phantoms. Advisory standalone JSON is the correct altitude until deterministic per-commit media capture + variance handling exist. (Skeptic-refuted.)
2. **Handoff packet v2 schema/zod ceremony.** LoopRun is already a typed, fixed-schema artifact. The executable delta is evidence plumbing (P1-4) + one repro string. (Skeptic-refuted.)
3. **Held-out eval slice.** Withholding from a 12-case corpus destroys coverage signal. (Self-amputated by the surviving tamper-guard candidate.)
4. **Renderer-hash CI drift gate / regenerating GIF binaries in CI.** Red-noise on a cosmetic surface trains gate-ignoring; the surviving trace preview and app-capture generators already fail on missing frames/assets. P2-1's budget assertions are the honest insurance. (Skeptic-refuted.)
5. **A/B experiment mode in runEval.** Compose `--record` × 2 + `eval:diff --from/--to`; the store keys dirty worktrees distinctly for exactly this.
6. **Unified check registry / late-binding check schemas.** Checks are an open `Record<string,boolean>`; diff is already suite-agnostic; introduced/retired tracking falls out of P0-1.
7. **Trace schema versioning + sufficiency metadata.** `schema: 1` + harnessVersion exist; the sufficiency half serves a judge that doesn't exist — add it in the judge's PR.
8. **Case-ID rename registry.** Governance for a 12-case founder corpus; the dangerous half (silent vanishing) is P0-1's case-removed class.
9. **Decoupling caseId from requestedModel.** Wrong direction — destroys a working comparison axis; the root cause is the model-changed annotation inside P0-1.
10. **Worktree-hash collision detection + multi-run aggregation.** 64-bit content hash, 15 runKeys, 135/138 deterministic rows: fabricated failure mode.
11. **Agentless-style ranked localization stage.** Invariants live in a handful of greppable files; keep only a static check→owning-module map inside the packet.
12. **`gate_reason` field; policy-version hash registry.** `reasons[]` exists; every LoopRun serializes full policy content by value. One line adds the git SHA if ever needed.
13. **Supervisor exponential backoff; heartbeat worker threads.** Respawn already throttled (300s poll + PID lock); heartbeat is its own 30s interval doing tiny appends. Real gap = instant-exit counter (P2-13).
14. **Redundant resume guards**: atomic lease validation in claimSlice (serializable mutations + leaseId fence exist), snapshot/goal validity guards (artifact_room_mismatch + CAS), cursor content-hash versioning (single-writer lease; sliceKey covers cursor+modelPolicy), workflow auto-continuation past 200 slices (retry-from-cursor exists; maxAttempts binds first), idempotency time-bucketing (real bug is the in-flight age cap, P2-13).
15. **Provider-reported cost instrumentation.** Providers don't return USD; the catalog is the deliberate single source of truth. P0-4 fixes the actual bug.
16. **Compaction staleTools += fetch_source.** Different-URL fetches aren't superseded; eliding destroys citation evidence; no observed overflow.
17. **CAS/merge "hardening" that breaks designed semantics**: server-side honest-conflict decoration when baseVersion is guessed (provenance is client-side; fix the plans.ts:200 fallback if traces show it), artifact-level version gate on draft merge (already one ACID transaction with per-op CAS; would add conflicts, prevent zero clobbers).
18. **Element-level agent presence channel.** Grid already shades locked cells in both runtimes; the lock IS the write-intent signal at this scale.
19. **Registering ~10 creditRatios as live tools now.** No failing live fixture; +10 tools nearly doubles selection space for every non-finance task. Sequence: P1-7 fixture → ONE minimal compute tool. (Skeptic-refuted; repo's own handoff policy states it verbatim.)
20. **New professional-suite producer.** workflowEvals.test.ts already asserts 5 runnable scenarios; the gap is recording (P2-4). (Skeptic-refuted.)
21. **Full agent-run revert mutation.** valueBefore slice first (P2-3); inverse-op revert is M-effort capability with no forcing failure. (Skeptic-refuted scope.)
22. **Showcase over-builds**: replayer validation layer (one frameCount assert suffices), in-GIF phase badges (ticker/tags/rung badge already in-frame), adaptive quantization (premise false — per-frame quantize(data,256) exists), frame-to-trace-step binding (requires runtime pause instrumentation for marketing GIFs), GIF↔eval-gate automation.
23. **Finance breadth ahead of demand**: borrowing-base certificate engine (ABL product category, zero ABL workload — one fixed-rule fixture demos the pattern at 5% surface), dual risk-rating roll-up, global cash flow/guarantor primitives before any fixture exercises them.
24. **Online live-traffic sampling; corrections-as-few-shot.** Both presuppose traffic/judge-verdicts that don't exist; overnight lanes already score real Convex+LLM behavior into the same store.
25. **HALO persistence tables before a workflow needs them.** NODEAGENT_ARCHITECTURE.md:1364-1366 marks them target-only; the file-based loop is the running system.
26. **Hand-maintained status tables duplicating the generated qa:matrix cockpit** (Professional Workflow QA roadmap table, HALO Current/Target README split, TOOL_REGISTRY_ROADMAP.md). Manual copies drift; the marker system + cockpit already carry it.

## Completeness gaps — open questions (not yet skeptic-tested; audit before sizing)

These came from the gap sweep, not the verified-candidate pipeline. One (P1-1) was verified in this session and promoted. The rest are real-looking but unsized:

1. **Prompt injection across the room→agent boundary.** Zero hits for injection/sanitize/untrusted anywhere in convex/, src/, scripts/; room content authored by other members is packed into NodeAgent context unwrapped. Open question: tag room-derived text as untrusted in context assembly + adversarial-injection ladder cases — what does an L-x injection rung look like, and does it gate?
2. **Anonymous-join abuse surface.** Client-side room-code generation, no rate limits, no member caps, public VITE_CONVEX_URL means every mutation is directly callable. Open question: server-side code entropy + Convex rate-limiter component + per-room caps — what is the minimal set before any public link is shared?
3. **Cost runaway beyond the per-run ceiling.** P0-4 fixes the per-run gate; a nightly cumulative cap + cost-per-case in eval:diff is sketched but unsized. Open question: where does the cumulative ledger live (status.json vs Convex)?
4. **Data retention.** No pruning anywhere except the 5-min lock lease; traces/messages/agentSteps/journal/runs/drafts/embeddings grow unbounded; docs/eval already at 235 files / ~8.1MB compounding nightly. Open question: summarize-then-prune policy vs external artifact store for run logs.
5. **Privacy: room content → OpenRouter free tier.** Free-endpoint discovery doesn't filter by data-policy flags; MM-banking figures can transit logging/training providers. Open question: deny-training filter + per-room private flag forbidding the free-auto path + provider disclosure in the trace UI.
6. **Capacity (distinct from concurrency correctness).** ~36 unbounded `.collect()` calls; room-state collects ALL elements per artifact. Open question: pagination/index bounds on hot queries + a 1k-cell/20-actor sustained scenario eval — what are the documented artifact size ceilings?
7. **Disaster recovery.** Elements store only current value+version; an approved-but-wrong merge is unrecoverable; no scheduled `npx convex export` or restore runbook. P2-3 (valueBefore) is the first slice; the export+runbook is independent and cheap.

## Research citations (load-bearing prior art)

**Eval platforms & gates**: Anthropic, Demystifying evals for AI agents (anthropic.com/engineering/demystifying-evals-for-ai-agents) · LangSmith dataset versioning (docs.smith.langchain.com/evaluation/how_to_guides/dataset_version) · Align Evals (blog.langchain.com/introducing-align-evals/) · Braintrust eval-action + online scoring (github.com/braintrustdata/eval-action; braintrust.dev/articles/how-to-eval) · Hamel Husain, LLM judges (hamel.dev/blog/posts/llm-judge/) · EvalGen / Who Validates the Validators (arxiv.org/abs/2404.12272) · OpenAI trace grading (developers.openai.com/api/docs/guides/trace-grading).

**Self-improving loops & anti-reward-hacking**: OpenAI Agent Improvement Loop cookbook (developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop) · context-labs/halo (github.com/context-labs/halo) · AlphaEvolve generator/evaluator split (deepmind.google/blog/alphaevolve…; arxiv.org/abs/2506.13131) · Google Auto-Diagnose (arxiv.org/html/2604.12108v1) · Devin Autofix (cognition.ai/blog/closing-the-agent-loop-devin-autofixes-review-comments) · SWE-agent ACI (arxiv.org/abs/2405.15793) · Agentless (arxiv.org/abs/2407.01489) · Reward hacking in self-improving code agents (openreview.net/forum?id=ikrQWGgxYg) · APR test-overfitting (arxiv.org/html/2511.16858v1) · SWE-bench Verified (openai.com/index/introducing-swe-bench-verified/).

**Collaborative editing**: Kleppmann, How to do distributed locking — fencing tokens (martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) · Figma multiplayer (figma.com/blog/how-figmas-multiplayer-technology-works/) · Hex pragmatic live collaboration — cell locks + Yoink (hex.tech/blog/a-pragmatic-approach-to-live-collaboration/) · Liveblocks AI presence (liveblocks.io/docs/get-started/nextjs-ai-presence) · Google Docs Gemini tracked changes (workspaceupdates.googleblog.com 2026-04) · Notion agent audit/undo (notion.com/releases/2025-09-18) · Ink & Switch Patchwork (inkandswitch.com/patchwork/notebook/2024-version-control/07/) · Convex object sync engine (stack.convex.dev/object-sync-engine) · CHI agent-in-team study (arxiv.org/abs/2509.11826).

**Finance-agent rigor**: Program of Thoughts (arxiv.org/abs/2211.12588) · FinChain (arxiv.org/abs/2506.02515) · LLM audit automation w/ error injection (arxiv.org/abs/2506.17282) · Moody's agentic Credit Memo (moodys.com/web/en/us/capabilities/gen-ai/agentic-solutions/credit-memo.html) · Trullion/Suralink/DataSnipper tie-out category · spreading-architecture consensus (scryai.com; besmartee.com).

**Demo/showcase**: charm vhs + vhs-action demos-as-code (github.com/charmbracelet/vhs) · Rekort GIF-for-README spec (rekort.app/blog/gif-for-github-readme) · GitHub attachment-URL video embeds (github.com/orgs/community/discussions/4818) · Riot ability-preview pattern (technology.riotgames.com) · Playwright demo pipelines (playwright.dev/docs/videos; justin.abrah.ms 2026-02-12) · terminalizer --real-timing provenance (github.com/faressoft/terminalizer).

## Verification note

Re-verified against source in this session (2026-06-09, read-only): runtime.ts:225 `costUsd: 0`; locks.ts:32 5-min TTL vs agentJobRunner.ts:25 9-min slice; evalStore.ts:86-89 toMap-only diff; architecture-budget-check.ts:9-10 unused `--strict`/`--human-approved`; architectureBudget.ts:119-121 evidence whitelist; WHY_NODEAGENT_AND_HALO.md:151-152 free-auto claim; artifacts.ts:204-207 other-holder-only lock gate + zero lockId on writes; runtime.ts:100/136 `remainingToolCalls = []` error default; locks.ts:95 sole mergeBlockedDrafts call site; rooms.ts:90 private-draft ops leak (newly verified, promoted to P1-1). All other file:line anchors carry forward from the skeptic-tested inputs.
