# NodeRoom pilot launch — cost model, credit system, and first-user readiness

_Generated 2026-06-27. Grounded in real production data (`agentRuns`, n=1639, dev deployment
`zealous-goshawk-766`) and the offline simulator at `src/benchmarks/costSimulator.ts`.
Re-run the numbers any time with `npm run simulate:credits`._

---

## 1. Decision / Recommendation

**Launch a small, credit-gated private pilot — not a 200-user open beta.** At today's per-run
economics, a **$150/month** budget safely supports **~1 VC team (4 users) + a handful of solo
testers**, or **~7–15 active solo users**. 200 users is only viable with **tiny free grants**
(a one-time 3–4 credit allowance, no daily activity) — which the credit system now makes
enforceable.

The credit system is **built and load-tested in memory mode** (the demo + simulator). The
**live wallet enforcement** (Convex backend) is the remaining piece (Section 7) and is the gate
before charging real money against real users.

---

## 2. The real cost data (what your agent actually costs today)

From 1,639 real `agentRuns` (LLM cost only — `costUsd` does **not** include Linkup/Firecrawl/
Browserbase substrate):

| metric | p50 | avg | p95 | max |
|---|---|---|---|---|
| **cost (USD)** | $0.084 | $0.20 | $0.70 | $4.60 |
| input tokens | 67k | 177k | 673k | 4.8M |
| output tokens | 2.6k | 5.8k | 24.6k | 57k |
| steps | 6 | 8.4 | 24 | 198 |

**Three findings that shape the whole launch:**

1. **Cost is input-token dominated** (avg 177k in vs 5.8k out) — context accumulation across
   steps, not output length. The cheap default `z-ai/glm-5.2` ($1.20/$4.10 per 1M) drives
   1,201 of 1,639 runs and keeps p50 at **8.4 cents**.
2. **The kill mechanism already works.** Of 1,639 runs: 824 done, 286 hit `step_budget`, **194
   hit `spend_budget`**, 191 `time_budget`, 141 error. The in-run ceiling (`checkSpendCeiling`)
   is real and firing — the credit hard caps plug into it, no new gate needed.
3. **Convex is not the wallet risk.** Marginal Convex cost is **$0.0007/run** (~$0.29–$1.12
   across a full month of any profile). **LLM + substrate dominate.** Your instinct was right.

---

## 3. Credit model (1 credit = $0.25)

The internal ledger is **USD** (the honest unit); credits are the user-facing wrapper. Modes
map onto the existing budget profiles. LLM estimate via `priceRun()` over the same pricing the
runtime uses; substrate priced from published provider rates (dated assumptions).

| Mode | Est. cost (LLM + substrate) | Credits (hold) | Hard cap (LLM-only) | Use |
|---|---|---|---|---|
| **Quick** | ~$0.13 ($0.08 + $0.05) | ~1 cr | $0.75 | First-touch lookup |
| **Standard** | ~$0.40 ($0.24 + $0.16) | ~3 cr | $3.00 | Evidence-backed packet |
| **Deep** | ~$2.14 ($0.88 + $1.26) | ~12 cr | $10.00 · approval | Broad diligence + capture |

> **Honesty note:** the hard cap governs **LLM tokens only** — that's all `checkSpendCeiling`
> can see in-run. Substrate (Linkup async research $0.25–2.50/call, Browserbase minutes,
> Firecrawl pages) is estimated for the bill but is **not** covered by the in-run cap. Deep mode
> is therefore approval-gated and rationed. Do **not** promise "this covers the whole run."

**Demo grant:** 20 credits ($5) — the individual-pilot allowance. Enough for ~6 standard packets
or ~20 quick lookups, so a user can "come back and revisit every day." Deep is rationed to ~1.

---

## 4. Per-workflow cost (30-day projection, daily-constant = conservative upper bound)

| Profile | Users/Rooms | Runs/mo | Total/mo | $/room/day | $/run | Flag |
|---|---|---|---|---|---|---|
| `pilot-vc` (UpscaleX) | 4 / 5 | 384 | **$110.90** | $0.74 | $0.29 | — |
| `finance-friend` | 1 / 3 | 78 | $20.14 | $0.22 | $0.26 | — |
| `gtm-sales` | 1 / 1 | 120 | $18.92 | $0.63 | $0.16 | — |
| `conference-room` (burst) | 10 / 1 | 480 | $163.03 | **$5.43** | $0.34 | ⚠ daily cap |
| `notebook-passive` | 1 / 2 | 39 | $7.47 | $0.12 | $0.19 | — |
| `parselyfi-bulk` | 1 / 1 | 1500 | $106.14 | $3.54 | $0.07 | cache 45% |
| `ta-studio` | 1 / 2 | 99 | $42.56 | $0.71 | $0.43 | — |

These assume **daily-constant** activity (every user runs their full mode mix every day for 30
days) — a deliberate upper bound. Real usage is bursty, so true cost is lower. `conference-room`
is the only profile that trips the $5/room/day cap (10 people in one room) — by design, the cap
throttles it.

---

## 5. "How many users can I open to?" — the headroom answer

Max identical workspaces that fit a monthly budget (from `simulate:credits --budget`):

| Budget/mo | pilot-vc (4-user teams) | finance-friend (solo) | gtm-sales (solo) |
|---|---|---|---|
| **$75** | 0 teams | 3 users | 3 users |
| **$150** | 1 team (4 users) | 7 users | 7 users |
| **$300** | 2 teams (8 users) | 14 users | 15 users |
| **$600** | 5 teams (20 users) | 29 users | 31 users |

**The 200-user reality:** 200 solo users at ~$20/mo each = **$4,000/mo** — that breaks the credit
card. To admit 200 people on a small budget, give a **tiny one-time free grant** (3–4 credits =
1 standard + a couple quick lookups, no daily refresh) and gate everything beyond it behind
manual approval. That is exactly what the credit ledger enforces.

**Recommended:** start at **$150/mo hard ceiling** → 1 UpscaleX team + ~5 solo friends, each
with a 20-credit grant. Expand only when cost-per-useful-packet and first-attempt success hold.

**Product Hunt launch override (2026-07-11):** the public candidate uses a $75 monthly model-spend
ceiling inside the separately approved $100 total launch envelope. The older $150 pilot proposal
above is historical and is not the active launch policy.

---

## 6. Recommended caps (encoded in `creditModel.DEFAULT_BUDGET_CAPS`)

```
global monthly:        $75
per-room daily:        $3
per-room monthly:      $50
per-user daily:        $3
concurrent foreground: 10 global · 2 per room
concurrent deep:       1 per room
passive jobs:          suggestions-only, 0 auto-research
```

These are the **wallet floor**. Credits are the UX layer on top; hard caps are what actually
protect the card; the work queue keeps foreground @nodeagent ahead of passive work (the
incident that previously starved a user's UpscaleX request must not recur).

---

## 7. What's built vs. what's next

### ✅ Shipped (this work — memory mode, fully tested)
- **`creditModel.ts`** — cost/credit SSOT, real-data calibrated, single place for every rate.
- **`creditLedger.ts`** — pure reserve→settle engine: fail-closed, idempotent settle, bounded
  event log, never-negative, honest overspend accounting. (11 unit tests)
- **`costSimulator.ts` + `npm run simulate:credits`** — 7 workload profiles, headroom analysis,
  the numbers in this report. (16 unit tests)
- **Memory-mode UI** — Quick/Standard/Deep selector + live balance chip; demo charges so users
  "feel" the credit system but the demo is **forgiving** (tasks always finish). (7 e2e tests)
- **`window.__simulateLoad`** — backend-free load harness for burst + sustained stress.

### ✅ Shipped: live wallet backend (Convex — Phase B, additive + flag-gated)
- `roomCredits` (materialized balance) + `creditLedger` (append-only audit) + `creditGrants`
  (append-only top-ups) tables; indexes `by_room` / `by_reservation` / `by_expiry`; excluded
  from retention pruning (financial records).
- `convex/credits.ts`: `reserve`/`settle` (idempotent, fail-closed, never-negative, honest
  overspend), `grantCredits`, `setPaused` (kill switch), `roomGate`, `sweepExpiredReservations`
  (**cost-aware**: charges a crashed run's actual/held cost — never silently refunds spent money),
  `balance`/`usageEvents` (auth-gated), `globalCreditSnapshot` (admin). reserve/settle/grant/pause
  are server-only `internalMutation`s.
- Enforcement wired into the `runRoomAgent` action behind `CREDITS_ENFORCED` (reserve at admission,
  settle actual cost at finish, refund on plan-block). **INERT unless the flag is on**, and even then
  meters only *enrolled* rooms (un-granted rooms pass through unmetered) — live `/ask` is unchanged.
- `roomSpendSince` bounded + fail-closed (was an unbounded `.collect()` that could fail open).
- 13 convex-test scenarios + the full adversarial review (boundary PASS; security P1/P2/P3 all fixed).
- Tables + functions are deployed (additively) to the Vercel-backing deployment `zealous-goshawk-766`;
  no behavior change because enforcement is flag-off and no grants are seeded yet.

### ⚠️ Important: Convex deploy ≠ git push
The credit **tables** are live on `zealous-goshawk-766` (codegen pushed the schema), but the credit
**functions** (`convex/credits.ts`) are **not deployed yet** (verified via `functionSpec`). The frontend
therefore must NOT call `api.credits.*` in live until those functions ship — so the live credit reads are
**gated off by `VITE_CREDITS_LIVE`** (default off → the live `/ask` path is provably unaffected). Deploying
to this Vercel-backing deployment is intentionally left to you (it also carries unrelated committed
run-path + cron changes), not done unilaterally.

### ⏳ Remaining — needs your go (cannot be self-led), in order
1. **Deploy the backend**: `npm run convex:deploy` (guarded to `zealous-goshawk-766`). Confirm with
   `functionSpec` that `credits:balance/reserve/settle/...` now exist.
2. **Seed grants**: `grantCredits({ roomId, credits, source })` via the Convex dashboard / a seed script.
   Suggested: UpscaleX team room 100 cr, solo friends 20 cr each.
3. **Enable the live UI**: set `VITE_CREDITS_LIVE=true` (Vercel env) → rebuild. The credit chip + selector
   then show real balances for enrolled rooms.
4. **Turn on metering**: set `CREDITS_ENFORCED=true` (Convex env). Test on ONE enrolled room first
   (run → balance moves → settles).
5. **The UpscaleX production dry run** (Section 8 checklist) before inviting anyone.
6. (Optional) wire enforcement into the durable-job path (`agentJobRunner.runFreeAutoJobSlice`) for
   parity with the inline `/ask` path; the sweep already reconciles any unsettled holds there.

---

## 8. Before the first user — checklist

- [x] **Phase B backend shipped** (tables + credits.ts + enforcement, flag-gated, deployed additively). ⏳ verify a real reserve→settle→balance move once `CREDITS_ENFORCED=true` + a grant is seeded.
- [x] Per-mode Quick/Standard/Deep with hard caps (LLM-only, labeled honestly).
- [x] `GLOBAL_MAX_USD_PER_MONTH` + per-room/day caps defined (`DEFAULT_BUDGET_CAPS`); `roomSpendSince` now bounded + fail-closed.
- [ ] Passive jobs confirmed **suggestions-only** (no passive auto-research). _(out of credit-scope — verify before launch)_
- [ ] `benchmark_completion` confirmed **internal-only** (not public; metered, no exemption).
- [x] Admin spend view — `internal.credits.globalCreditSnapshot` (enrolled rooms, totals, top spenders) + `roomUsageSnapshot`.
- [x] Kill switch — `internal.credits.setPaused(roomId, true)` (rejects new holds without redeploy); tested in convex-test.
- [ ] **The UpscaleX dry run on production**: fresh room → "@nodeagent research UpscaleX Palo
  Alto — events, portfolio companies, people" → evidence-backed packet, cost receipt, trace,
  re-openable next day, exportable. Save the video + numbers.
- [ ] Pilot data policy visible (no confidential/MNPI uploads; public-researchable dealflow only).
- [ ] First grants issued: UpscaleX team 100 cr, solo friends 20 cr each.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Substrate (Linkup research/Browserbase) blows past the LLM-only cap | Deep mode approval-gated + rationed; substrate metered in the bill; label the cap as LLM-only. |
| Retry storm on provider outage (the prior passive-intelligence incident) | Foreground > passive queue priority; passive suggestions-only; per-room concurrency cap. |
| A single benchmark job exhausts a room | No exemption — benchmark jobs reserve+settle like everyone; internal-only gating. |
| Dangling reservations from crashed runs permanently hold credits | Reservation-sweep cron refunds holds past expiry (Phase B). |
| Convex deploy ≠ git push (half-deployed backend) | Verify a live settled run before claiming live; prod deploy gated. |
| Per-user over-spend (no `userId` on `agentRuns` yet) | v1 caps per-room + global; per-user attribution is a tracked v2 migration. |
```
