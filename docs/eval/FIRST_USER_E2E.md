# First-user end-to-end journey — measured on the live UI (2026-06-28)

**The question:** how does everything we built this week — orchestrator/worker per-phase routing,
prompt-cache observability, and NodeMem — actually work together when a *real user first lands*? This is
the measured answer: a cold first visit driven through the **real served production build** (not memory
mode), against a **live Convex backend**, with every number read back from `agentRuns` after the run.

Artifacts (all checked in under [`docs/eval/firstuser-e2e/`](firstuser-e2e/)): 4 stage screenshots +
[`result.json`](firstuser-e2e/result.json) + [`metrics.json`](firstuser-e2e/metrics.json) +
[`agentruns-parsed.txt`](firstuser-e2e/agentruns-parsed.txt) (labeled per-slice breakdown) +
[`agent-chat.txt`](firstuser-e2e/agent-chat.txt) (the agent's exact chat message, from the `messages` table).

> Every quantitative claim below was adversarially fact-checked by a 6-agent verification workflow against
> these raw artifacts before this doc was committed. Two real corrections it caught are folded in: the cell
> count (8, not 5 — `result.json` was truncated) and the provenance of the agent's failure-code quote (the
> `messages` chat channel, *not* `result.json`). See "Evidence layers" below.

---

## TL;DR (measured, live, glm-5.2)

A first-time user lands → creates a room → asks the agent to research a company → the agent runs a real
multi-step job on the cheap model and writes structured cells. Headline run (room `NRFUTF79DTL`):

| metric | value | source |
|---|---|---|
| Model actually used | **`z-ai/glm-5.2`** (configured tier resolved live) | `agentRuns.model` |
| Net cost | **$0.0868** | `agentRuns.costUsd` (summed) |
| Net tokens | **50,248 in / 6,463 out** | `agentRuns.inputTokens/outputTokens` |
| `cachedInputTokens` | **0** (observability wired; empirically 0 — see finding 2) | `agentRuns.cachedInputTokens` |
| Tool calls | **36** across 8 slices (9 real per terminal slice) | `agentRuns.toolCalls` |
| Wall latency | **9.3 min** (full poll window) | journey `latencyMs` |
| Output | **8 structured cells** (row r1); every unverifiable fact `needs_review` (the `last_researched` timestamp is `complete`); **zero fabrication** | `agent-chat.txt` + `result.json` |

**Three honest headlines, not one happy-path screenshot:**
1. **The plumbing works end-to-end on the live UI** — routing resolved glm-5.2 per room, the agent ran, the
   sheet was written, and the cache metric persisted. Screenshots prove each stage.
2. **The honesty gate held under failure.** Web sources failed (You.com `422`, Crunchbase `408`, direct
   fetch aborted); the agent reported `needs_review` with the exact failure codes and asked a human to
   verify — instead of hallucinating UpscaleX facts. This is the NodeRoom value prop, proven live on a
   cheap model.
3. **The cache-hit metric is 0 — and that's a *finding*, not a bug in the measurement.** It empirically
   confirms the two deferred next-steps already written into [`CACHING_STRATEGY.md`](../architecture/CACHING_STRATEGY.md):
   pin the OpenRouter provider, and probe `res.providerMetadata` for cache fields.

---

## The live stack (what "live UI like a real user lands" means here)

```
 Playwright (a first-time user)
        │  real browser, real served build — NOT ?mode=memory
        ▼
 vite preview  :5273   ── serves the production build (vite build, glob baked in)
        │  VITE_CONVEX_URL
        ▼
 Convex local anonymous deployment  :3210
        │  deployed = merged main (per-phase routing + cachedInputTokens observability)
        │  env: AGENT_ORCHESTRATOR_MODEL=z-ai/glm-5.2, AGENT_WORKER_MODEL=z-ai/glm-5.2,
        │       AWARENESS_WINDOW=30, NODEMEM_ROOM_CONFIG_ENABLED=1
        ▼
 agentJobRunner → modelForFramePhase(phase) → OpenRouter (glm-5.2)
        │  real model calls, real fetchSource (You.com / Crunchbase / direct)
        ▼
 agentRuns  ← model, tokens, cachedInputTokens, costUsd, ms (read back as the measurement)
```

The backend is the **merged `main`** another session pushed (Nebius provider + `phaseModel.ts` per-phase
routing, commit `94c29860`) *plus* this branch's cache-observability change — so this journey verifies the
two compose and run together live.

---

## The journey, stage by stage

| # | stage | screenshot | what it proves |
|---|---|---|---|
| 1 | **Land** (cold first visit) | [`01-landing.png`](firstuser-e2e/01-landing.png) | the served production build renders for a brand-new visitor |
| 2 | **Create room** (blank sheet) | [`02-room-blank.png`](firstuser-e2e/02-room-blank.png) | `create-room` → `blank-cta-sheet` → "live convex" badge (real backend, not memory) |
| 3 | **Ask** the agent | [`03-agent-working.png`](firstuser-e2e/03-agent-working.png) | the chat composer accepts the task and the agent starts a real job |
| 4 | **Filled sheet** | [`04-sheet-filled.png`](firstuser-e2e/04-sheet-filled.png) | the glm-5.2 route chip (`attempt 3 · 9/10`) and the agent's honest `needs_review` chat message are both legible here |
| 4b | clean grid view | [`04b-sheet-filled-clean.png`](firstuser-e2e/04b-sheet-filled-clean.png) | same room with the onboarding modal dismissed (lower-res; read the route chip in 04, not here) |

### The agent's exact output (two evidence layers)

NodeRoom captures the agent's work in **two** channels, and they say different things — both honest:

- **The chat `say` message** (the `messages` table, kind `agent`; rendered in the screenshot-04 chat panel;
  full text in [`agent-chat.txt`](firstuser-e2e/agent-chat.txt)) carries the **why**, verbatim:

  > UpscaleX research complete — wrote 8 cells to row r1 via managed batch (lock released, all v1). All cells
  > marked **needs_review** because every source attempt failed: You.com search returned 422 errors,
  > upscalex.com fetch was aborted, and Crunchbase capture timed out (408). No funding, investor, or team data
  > could be verified. Row status set to `needs_review`, `last_researched` = 2025-07-11. A human should
  > manually verify UpscaleX's details or provide a working URL.
  >
  > *(Transparency note: the agent's chat says "All cells … needs_review"; `result.json` shows the `last_researched`
  > timestamp cell is actually `status=complete`. Every cell representing an **unverifiable fact** is `needs_review`
  > — the agent's blanket "all" slightly overstates, which is why we cite the cell layer too.)*

- **The cell values** (read back by `benchRoomAnswer` into [`result.json`](firstuser-e2e/result.json)) carry
  the **what**, per cell — structured `{value, status, confidence, evidence}` objects, e.g.
  `"status":"needs_review", "value":"Could not verify — no funding round information found in public sources"`.

This two-layer split is why the verification workflow first "refuted" the failure-code quote: it isn't in
`result.json` (the cell layer) — it lives in the chat layer. The fix was provenance, not the claim.

---

## Measured metrics — headline + comparison

Both runs are the *same* journey/task; the only difference is the routed model. Per-slice breakdown in
[`agentruns-parsed.txt`](firstuser-e2e/agentruns-parsed.txt).

| run | model | net cost | in / out tokens | cached | tool calls | slices | done within poll | outcome |
|---|---|---|---|---|---|---|---|---|
| **headline** | `z-ai/glm-5.2` | **$0.0868** | 50,248 / 6,463 | 0 | 36 | 8 (4 done) | no (poll-lag) | 8 cells; unverifiable facts `needs_review`, `last_researched` `complete` |
| comparison | `minimax/minimax-m3` | $0.0236 | 58,788 / 4,957 | 0 | 100 | 20 (10 done) | no (poll-lag) | same honest behavior, ~3.7× cheaper |

Read the cost honestly: it is the **net** of the free-auto ladder — most slices replay journaled steps and
bill $0, so only the one fresh terminal slice (315 s for glm) actually bills. The minimax tier is cheaper
per task but is *not* a free win — see finding 5.

---

## How it all works together (the architecture, traced through this run)

1. **Land + create** — the served build talks to the live Convex backend; the room is real (the "live
   convex" badge is the guard, not a memory stub).
2. **Ask** — the chat goes to `agentJobRunner` (the chat-path runner — *not* `agent.ts`; that distinction
   was the breakthrough fix in the NodeMem recall work).
3. **Route** — `modelForFramePhase(phase, fallback)` resolves the model per phase from
   `AGENT_ORCHESTRATOR_MODEL` / `AGENT_WORKER_MODEL`. Here both tiers are glm-5.2, so every slice records
   `model = z-ai/glm-5.2`. (A simple chat task doesn't decompose into orchestrator *frames*, so the split
   is single-model for this shape; the split engages on frame-decomposing research fan-outs.)
4. **Slice + dedup** — the free-auto ladder runs the job as N `agentRuns`. The runtime journals steps and
   **dedups billing on replay**, so 19/20 (minimax) and 7/8 (glm) slices show $0 — only the fresh terminal
   slice carries the real tokens/cost.
5. **Observe the cache** — every slice now records `cachedInputTokens` (adapter → runtime → `agentRuns`).
   This is the #1 cache-health metric, previously unmeasured. Here it reads 0 (finding 2).
6. **Record (NodeMem)** — on a cold first visit there is *nothing to recall yet*, so NodeMem is the
   recording substrate, not the payoff. Its measured value shows up on the **return visit**, once history
   exceeds the agent's window — that is what the recall + fairtest benchmarks below quantify.
7. **Honesty gate** — `fetchSource` is SSRF/timeout/size bounded; when sources fail, the agent surfaces
   `needs_review` with evidence rather than fabricating. Proven live under real `422/408` failures.

This is the full lifecycle in three measured artifacts:

| phase | what's measured | where |
|---|---|---|
| **Cold first visit** (this doc) | live UI + routing + cache observability + honesty gate | **FIRST_USER_E2E.md** |
| **Return visits** (history accumulates) | NodeMem recall lift **0.00 → 1.00** | [`nodemem-recall-benchmark.md`](nodemem-recall-benchmark.md) · [`nodemem-fairtest.md`](nodemem-fairtest.md) |
| **Cost discipline across both** | tier-specific cache economics + the pin/probe next-steps | [`CACHING_STRATEGY.md`](../architecture/CACHING_STRATEGY.md) |

The fairtest is the honest framing of marginal value: NodeMem adds **+0.00** on a short room (existing
`awareness` window already recalls everything) and **+1.00** on a long room (once relevant history scrolls
past the window). A cheaper 80% — raising `AWARENESS_WINDOW` 6→30 — covers the long tail up to ~N items but
breaks past N because it is recency-ordered; NodeMem's relevance-ranked retrieval does not.

---

## Findings

1. **Routing resolves live, per room.** `agentRuns.model` was `glm-5.2` for the headline room and
   `minimax-m3` for the comparison room, switched purely by env — `modelForFramePhase` works against the
   live backend, not just in unit tests.
2. **`cachedInputTokens` = 0 on BOTH glm-5.2 and minimax-m3 via OpenRouter — and the metric is trustworthy.**
   The observability is wired end-to-end and persists; reading 0 means one of two things, both already
   prescribed as next-steps in CACHING_STRATEGY.md: (a) OpenRouter routed each call to a possibly-different
   backend with a cold cache (→ **pin the provider**), or (b) the cache-read count lives in
   `res.providerMetadata`, not `usage.cachedInputTokens` (→ **probe providerMetadata in `adapter.ts`**).
   The live run turns those from "deferred hypotheses" into "do these next, the data says so."
3. **The free-auto ladder makes per-slice cost misleading; read the net.** Most slices bill $0 (replayed
   journal steps). Any cost/cache dashboard must **aggregate across a job's slices**, or it will report a
   stream of $0 runs and miss the one slice that pays.
4. **`done=false` here is poll-lag, not failure.** The job's terminal status reached `completed` *after* the
   9-min poll on the single-node local backend; the cells, tool calls, and cost all landed. On a multi-node
   prod backend the terminal status would settle inside the window. (Don't ship "done=false" as "the agent
   failed" — that would be a false-status lie the run data contradicts.)
5. **Cheaper model ≠ free win.** minimax-m3 is ~3.7× cheaper per task but, in an earlier attempt as the
   *worker* tier, thrashed the room tool-call schema (alternating `error`/`done` slices) — the same class as
   the `glm-5.2` schema-strictness issue fixed in the cellMutator hardening. glm-5.2 is the reliable default;
   minimax-m3 needs the same tolerant-schema treatment before it's worker-ready.

---

## Limitations (so nothing is oversold)

- **Single-node local backend.** Latency and slice counts reflect a local anonymous Convex deployment, not
  multi-node prod. The mechanism (routing, billing dedup, cache observability) is deployment-independent; the
  wall-clock and the poll-lag are not.
- **The task hit a company with no fetchable public data** (UpscaleX) and degraded web sources, so the
  *content* outcome is all `needs_review`. That makes it a clean **honesty-gate** demo, not a "rich filled
  sheet" demo. A real, fetchable company would fill verified cells; the infra path is identical.
- **NodeMem is dormant on this cold room by design** — its value is measured separately on return visits.
- **One trial per model.** This is a live-UI integration proof, not a powered A/B; the recall/fairtest docs
  carry the n>1 statistical claims.

---

## Reproduce

```bash
# 1) build + serve the production UI against the local backend
npx convex dev --once                 # deploy merged code to local :3210
vite build && vite preview --host 127.0.0.1 --port 5273

# 2) point routing + the room-config gate at the local deployment
npx convex env set AGENT_ORCHESTRATOR_MODEL z-ai/glm-5.2
npx convex env set AGENT_WORKER_MODEL z-ai/glm-5.2
npx convex env set NODEMEM_ROOM_CONFIG_ENABLED 1
npx convex env set AWARENESS_WINDOW 30

# 3) run the journey (exports MUST reach the test process, not just the build)
export VITE_CONVEX_URL=http://127.0.0.1:3210
export NODEMEM_ROOM_CONFIG_SECRET="$(npx convex env get NODEMEM_ROOM_CONFIG_SECRET)"
BENCH_BASE_URL=http://127.0.0.1:5273 \
  npx playwright test --config playwright.real-flow.config.ts e2e/nodemem-firstuser.spec.ts

# 4) read metrics back from agentRuns for the room printed as FIRSTUSER roomId=…
npx convex data agentRuns --limit 40   # parse anchored columns; see agentruns-parsed.txt
npx convex data messages  --limit 200  # the agent's chat say message; see agent-chat.txt
```

> Gotcha (cost us a failed run): the first attempt failed at `new ConvexHttpClient("")` because
> `VITE_CONVEX_URL` was set for the *build* but never exported into the Playwright *process*. Export it (and
> the secret) in the same shell that runs the test.
