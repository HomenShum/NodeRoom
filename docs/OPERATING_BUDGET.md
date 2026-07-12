# Operating budget — the $100/month experiment

**Decision (2026-06-10):** NodeRoom runs as a real-user experiment under a **$100/month hard
envelope**. A breach is a *signal*, not a failure — but only when real users induce it. The caps
are enforced in code (see below), so a breach surfaces as a diagnosable error, never a surprise bill.

## Envelope

| Line | Allocation | Trigger to spend it |
|---|---|---|
| Convex | $0 (free tier, 1M function calls/mo) | Breaching 1M calls **is itself signal #1** → upgrade to Pro ($25) |
| OpenRouter (agent runs) | **$75/mo hard cap** | The metered experiment |
| Buffer | $25 | Absorbs the month Convex upgrades mid-cycle |

## Enforcement contract

```
NODEAGENT_LAUNCH_MODE     = private_pilot | public_launch
CREDITS_ENFORCED          = true
NODEAGENT_NEW_ROOM_GRANT_CREDITS = 1..20 (explicit; 0 disables automatic enrollment)
global monthly            = $75
per-room daily            = $3
per-room monthly          = $50
per-user daily            = $3
foreground concurrency    = 10 global | 2 per room
deep concurrency          = 1 per room
```

`src/nodeagent/core/creditModel.ts` owns these values. `src/launch/budgetPolicy.ts` applies
projected-cost, wallet, concurrency, benchmark-boundary, and kill-switch checks before admission.
`convex/agentJobs.ts` repeats the check at every lease claim; `convex/agentJobRunner.ts` settles the
attempt-specific hold from recorded usage.

Launch reservations hold the larger of the route estimate and the mode's LLM hard cap. Unresolved
reservations count toward global, room, and user spend before another request is admitted. Direct
private-provider work uses the same rule through one atomic `providerSpend:begin` mutation; stable
keys return `execute:false`, so a duplicate request cannot egress twice against one hold.

Until aggregate metering is certified, private-pilot and public-launch postures deliberately omit
provider-priced nested tools (`capture_source`, You.com, Tavily, Apify, external semantic search,
and dynamic subagents), disable model retries/fallbacks, and reject hosted voice, direct capture,
and external OKF embeddings. Local hashing, deterministic sample mode, direct model calls, and
governed workbook tools remain available. Deep mode remains approval-gated and is not admitted by
the default $3/day room/user envelope.

| Breach pattern | Reading | Action |
|---|---|---|
| Many distinct rooms | **Growth** — the signal we want | Raise the budget; start charging (credit-metered agent tasks per seat) |
| One room dominating | Runaway/abuse (the daily cap should have contained it first) | Investigate, don't celebrate |
| Bench/internal runs | Not a signal — benchmark runs use local in-memory tools and never touch the Convex ledger | Excluded by construction |

## Workflow → feature → unit cost → route

Unit costs from live OpenRouter pricing (snapshot 2026-06-11) against the v3 composite task shape.
The **v3 two-call composite** (`fetch_row_sources` → model synthesis → `write_row`) is what makes
these costs real: the latest live v3 smoke attempted 28 cheap/free or very low-cost OpenRouter
routes for a 1-company sourced research row. `nex-agi/nex-n2-pro:free` cleared 9/9 at $0,
`ibm-granite/granite-4.1-8b` cleared 9/9 at $0.0009, and
`deepseek/deepseek-v4-flash` cleared 9/9 at $0.0020. The older 3-company evidence still matters:
`deepseek/deepseek-v4-flash` cleared that larger run at $0.0034. See `docs/eval/results.json`.

| Persona workflow | NodeRoom feature | Type | Route | ~$/task |
|---|---|---|---|---|
| Founder: account/company research | research table + agent | deep | `nex` / `granite` / `deepseek-v4-flash` | 0–0.003 |
| Founder: investor update from room state | notes + summarize | light | `nex` / `granite` | 0–0.001 |
| GTM: pre-call account brief | research + /ask | deep | `granite` / `deepseek-v4-flash` | 0.001–0.003 |
| GTM: CRM-hygiene extraction | sheet extract | light | `nex` / `granite` | 0–0.001 |
| Finance: comps enrichment + verify | sheet + checks | deep, escalate on check-fail | `granite` → `deepseek-v4-pro` | 0.001 → 0.005 |
| Family office: pre-meeting decision memo | wiki + research | deep, escalated by default | `deepseek-v4-pro` / premium fallback | 0.005+ |
| Hackathon: brainstorm wall, build doc | post-its + notes | demo agents only | free routes | 0 |
| Conference: capture + debrief summary | notes + summarize | light | free / `granite` | 0–0.001 |
| Public `/free` demo rooms | demo room | deep-lite | `nex`, `nemotron`, `gpt-oss`, `poolside` free routes | 0 (rate-limited) |
| Safety pre-check on public inputs | guardrail | per message | `nemotron-3.5-content-safety:free` | 0 |

Routing logic: **cheap/free routes are candidates, not automatic defaults**. `nex-agi/nex-n2-pro:free`
is the fastest $0 v3 smoke clearer; `ibm-granite/granite-4.1-8b` is the cheapest paid clearer;
`deepseek/deepseek-v4-flash` remains the larger-run fallback. Free routes absorb bursty event personas
and `/free` demos, while collaboration still requires the lock/CAS/draft ladder before promotion. Routes
are promoted by the benchmark/ladder, never by price alone — and route prices reprice (every benchmark
row records `routeSnapshotId` + `pricingAtRun` for auditability).

## What $75 buys

A founder-profile power user (95 agent tasks/mo, ~70% light / 30% deep) costs **~$0.15–0.75/mo**
depending on escalation rate — the envelope supports **~100–500 real power users**. One 200-person
hackathon costs **~$0–1.30 marginal** (free routes); a 500-attendee conference activation
**~$40–200** only if paid routes are enabled for it. Events are distribution, not spend.

See `docs/AUDIENCE_WORKLOADS.md` for the persona research these numbers derive from.
