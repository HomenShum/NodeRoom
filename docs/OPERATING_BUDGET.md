# Operating budget — the $100/month experiment

> **UPDATED 2026-07-12 (owner decision):** the hard global monthly cap
> (`GLOBAL_MAX_USD_PER_MONTH`) is **$100/month**. This overrides both the $75 LLM
> figure below and the pilot report's $150 (`docs/launch/PILOT_LAUNCH_REPORT.md`).
> $100 is encoded in `src/nodeagent/core/creditModel.ts` (`globalMonthlyUsd`) and is
> the default in `convex/agent.ts`. It is the hard LLM cap; with Convex on the free
> tier it is also the total monthly spend (if Convex Pro's ~$25 is later added,
> revisit to keep the total at/under $100). The prod env var
> `GLOBAL_MAX_USD_PER_MONTH` overrides the code default and should be set to 100. The
> rest of this doc (per-slice, per-day caps, enforcement mechanics) remains accurate.

**Decision (2026-06-10):** NodeRoom runs as a real-user experiment under a **$100/month hard
envelope**. A breach is a *signal*, not a failure — but only when real users induce it. The caps
are enforced in code (see below), so a breach surfaces as a diagnosable error, never a surprise bill.

## Envelope

| Line | Allocation | Trigger to spend it |
|---|---|---|
| Convex | $0 (free tier, 1M function calls/mo) | Breaching 1M calls **is itself signal #1** → upgrade to Pro ($25) |
| OpenRouter (agent runs) | **$75/mo hard cap** | The metered experiment |
| Buffer | $25 | Absorbs the month Convex upgrades mid-cycle |

## Enforcement (all shipped, armed on dev and prod)

```
AGENT_MAX_USD_PER_SLICE   = 0.50   # per-slice ceiling (convex/agentJobRunner.ts + convex/agent.ts, priceStep)
ROOM_MAX_USD_PER_DAY      = 3      # per-room rolling-day cap (agentRuns.roomSpendSince)
GLOBAL_MAX_USD_PER_MONTH  = 75     # cross-room rolling-30d cap (agentRuns.globalSpendSince)
```

The global cap's breach error self-diagnoses:
`global_monthly_spend_cap:spentUsd=76.20:rooms=14:runs=312`

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
