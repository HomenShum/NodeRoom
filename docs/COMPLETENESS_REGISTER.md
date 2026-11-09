<!-- Provenance: completeness-audit workflow wf_5f78c0e2-e83 (2026-06-09, 5 agents, 439k tokens), GROUND-TRUTH CORRECTED same session: the auditors flagged 3 items from stale plan docs that are actually DONE in the tree (mobile overlay fix + responsive 4/4; eval-gate removed-class + tamper guard; WHY free-auto rewrite). Those are struck from the register. REAL items fixed immediately after the audit: production-claim relabel + user CTA + privacy disclosure (README), 4 dangling rules links, l5-large-range.gif rendered, priceStep wired into both Convex lanes (USD ceiling now reachable). -->

# NodeRoom Completeness Verdict — Historical Audit Snapshot

> Current status lives in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) and
> [GAPS_NOT_DONE.md](GAPS_NOT_DONE.md). This file is retained as the historical
> June 9 audit input, not as the current open-register source of truth. Several
> items below were subsequently closed, including the README beta relabel,
> public CTA/privacy disclosure, mobile overlay gate, eval tamper/case-set
> hardening, USD ceilings, prompt-injection fencing, anon join caps, retention
> cron, CI, and the L5/failure-replay media artifacts.

Synthesized 2026-06-09 from four parallel audits (README/docs, audience-fit, feature-coverage inventory, production-gap/roadmap verification) against the noderoom repo (read-only). Spot-verified directly: README:47 \"real production app\" wording, missing `l5-large-range.gif` (l1-l4 + l6 exist), and the absent `.claude/rules/` directory behind 4 README links.

## 1. Audience verdicts

| Audience | Verdict | Summary | Top gaps |
|---|---|---|---|
| **Interviewers / hiring managers** | **Well served** | INTERVIEW_NOTES.md (658 lines, 45-min plan, drill-down cards, verification commands; deleted 2026-10-29 because its runtime claims went stale), WHY_NODEAGENT_AND_HALO.md, and the strategic-honesty stack (GAPS_NOT_DONE, red/yellow QA cockpit, 25KB roadmap, 26-item do-NOT-build denylist) make this the strongest pathway. | (1) \"real production app\" claim is falsifiable by the repo's own P0 gate — the one credibility crack; (2) WHY_NODEAGENT free-auto claim contradicts README ladder results (P0-6); (3) 4 broken `.claude/rules` links; (4) the showcased eval gate is itself gameable (P0-1/P0-2) — a probing interviewer lands on it. |
| **Engineers (learning artifact for agent-collab on Convex)** | **Well served** | Keyless quickstart works (demo/eval/dev), WALKTHROUGH 8-point entry map with accurate file:line refs, real implementations of fencing/janitor/takeover/redaction, 39/39 features implemented — the gap is surfacing, not coverage. | (1) HALO eval-gate integrity holes an adopter inherits (P0-1 silent case removal, P0-2 no tamper denylist, P0-4 USD ceiling unwired); (2) README undersells the 4 most teachable shipped Convex patterns; (3) broken rules links + missing L5 GIF; (4) 12 test scenarios and the professional-workflow evals not discoverable/runnable from README. |
| **Prospective users (noderoom.live)** | **Poorly served** | No clickable live-app link/CTA, no onboarding, no privacy/safety disclosure, no /free experimental warning, no QA legend, no maturity boundary — and mobile is functionally broken (3 of 4 panels + toggles `display:none` ≤980px, `openArtifact()` silent no-op). Users cannot land safely. | (1) Mobile P0 CSS/routing fix pending; (2) no safe-landing path or Beta callout before users bring real GTM/finance data; (3) /free routes to community models with recorded FAIL/TIMEOUT and zero disclosure; (4) injection + anon-abuse gates are unsized open questions on a live anonymous site. |

## 2. Are the docs up to date?

**Verdict: mostly current and unusually honest, but not fully — wrong in both directions.**

- **Overstated:** README:47 \"real production app\" — backend is dev Convex (zealous-goshawk-766); GAPS_NOT_DONE's own P0 gate forbids the claim until a live smoke passes. WHY_NODEAGENT_AND_HALO.md:151-152 contradicts README:400-402's recorded L3 FAIL / L4 TIMEOUT (roadmap P0-6). Brief's \"responsive mobile overhaul\" contradicted by QA_UI_FIX_PLAN.
- **Broken/stale:** 4 dangling `.claude/rules/*` links (README 477/497/506/516-517 — directory verified absent); `l5-large-range.gif` missing from the L1-L6 narrative (verified).
- **Undersold (code ahead of docs):** host force-release takeover (`convex/locks.ts:142-172`), lock TTL janitor (`convex/crons.ts:12`), lease-fencing renewal + `lease_expired`-as-data (`convex/artifacts.ts:282`), privacy redaction (`convex/rooms.ts:89-102`), USD spend-ceiling primitives (`src/nodeagent/gateway.ts`, partial) — all shipped/tested, absent from README.
- **Stale in engineer's favor:** IMPROVEMENT_ROADMAP P0-3 (`--strict`) is now verified wired (`scripts/agent-improvement-loop.ts:90,147-149`).
- **Verified accurate:** all 19 walkthrough/workflow/rung media files except L5, all SVG charts, 28+ npm scripts, 20+ doc links, corpus counts (70 files / 17 cases), code-walkthrough line refs, mermaid diagrams, undo implementation.

## 3. Not-yet-addressed register (deduped, prioritized)

*P0 = wrong/broken claim or audience-blocking · P1 = this sprint · P2 = later. No item below re-proposes anything on the 26-item do-NOT-build denylist in docs/IMPROVEMENT_ROADMAP.md.*

### P0

| # | Item | Audience | Evidence / source |
|---|---|---|---|
| 1 | Relabel \"real production app\" (README:47, caption ~401) → \"live dev deployment / Beta\", or pass the live Convex smoke the P0 gate requires | user, interviewer | README audit; GAPS_NOT_DONE P0 deployment-proof gate; verified README:47 |
| 2 | Fix free-auto reliability contradiction: WHY_NODEAGENT_AND_HALO.md:151-152 vs README:400-402 recorded L3 FAIL / L4 TIMEOUT | engineer, interviewer | IMPROVEMENT_ROADMAP P0-6 (6-line fix) |
| 3 | Mobile panel routing: remove `.r-toggle-group display:none` (styles.css:404), fixed-overlay panels, matchMedia-aware show-state init — `openArtifact()` is a silent no-op on mobile | user | QA_UI_FIX_PLAN P0-1/P0-2 |
| 4 | README user pathway: noderoom.live CTA, Getting-Started-for-Users / join-by-code section, QA legend, 1-line \"Status: Beta\" callout linking GAPS_NOT_DONE | user | Audience-fit audit (Landing.tsx has CTAs; README has none) |
| 5 | Privacy & safety disclosure incl. /free experimental warning (README §/free + in-app tooltip on the command hint) | user | Audience-fit audit; GAPS_NOT_DONE security/privacy P0 gate |
| 6 | Eval case-set hashing: `diffByCase` (evals/evalStore.ts:85-95) must emit case-removed/added/redefined verdicts — silent case removal currently passes eval:diff; gates P0-2→P2-12 | engineer, interviewer | IMPROVEMENT_ROADMAP P0-1 (first blocker) |
| 7 | Tamper-guard **denylist** on eval artifacts (eval-runs.jsonl, cases.ts, evalDiff.ts) — architectureBudget.ts:119-121 currently whitelists evals/ as evidence | engineer | IMPROVEMENT_ROADMAP P0-2 |
| 8 | Wire USD spend ceiling: pass `priceRun` as `priceStep` in agentJobRunner.ts:242; add `AGENT_MAX_COST_USD_PER_SLICE` — gateway.ts:19 `maxCostUsd` check is unreachable in free-auto | engineer | IMPROVEMENT_ROADMAP P0-4 (USD gate receives costUsd: 0) |
| 9 | Security spikes for the live anonymous site: prompt-injection defense (zero injection/sanitize hits) + anon-abuse rate limiting (none wired) | user, engineer | IMPROVEMENT_ROADMAP Q1/Q2; GAPS_NOT_DONE security/privacy P0 gate |

### P1

| # | Item | Audience | Evidence / source |
|---|---|---|---|
| 10 | Fix 4 dangling `.claude/rules` links (README 477/497/506/516-517) — create files or inline + drop links | engineer | README audit; verified directory absent |
| 11 | Generate `l5-large-range.gif` via capture-previews.spec.ts, or document the omission | engineer | README audit; verified only l1-l4 + l6 exist |
| 12 | Surface shipped reliability features in README: host takeover, TTL janitor, lease fencing, privacy redaction; USD-ceiling primitives with honest \"not yet enforced in /free\" caveat | engineer, interviewer | Roadmap verification (P0-5/P1-1/P1-2/P1-6 done in code, invisible in README) |
| 13 | Qualify \"responsive mobile overhaul\"; land hard-assert e2e gate (375/768px affordances, ref-chip nav, no overflow); update QA cockpit red reason text | engineer, user | README audit; QA_UI_FIX_PLAN gate (current check = overflow only) |
| 14 | QA P1 batch (8 S-M items): 44px touch targets (`pointer:coarse`), keyboard nav (tabIndex/Escape), contentEditable a11y, chat wrapping, landing grid, tour anchors, chip contrast, optimistic updates | user | QA_UI_FIX_PLAN P1-1…P1-8 |
| 15 | README test/eval discoverability: enumerate the 12 engine scenarios; point Professional Workflow Evidence at evals/professionalWorkflows.ts + tests/workflowEvals.test.ts with a run command | engineer | Audience-fit audit |
| 16 | Surface release checklist in README (`qa:matrix:check` + build before production; link GAPS_NOT_DONE from QA section) + \"no API keys needed\" quickstart clarification | engineer, interviewer | GAPS_NOT_DONE release checklist (113-123); audience-fit audit |
| 17 | Free-model privacy routing filter (Q5): data-policy filter so private-room content never silently routes to free community models — technical counterpart to P0 #5 | user, engineer | IMPROVEMENT_ROADMAP Q5 |
| 18 | Cost-runaway visibility: size the Q3 nightly-cost-ledger spike (remainder beyond P0-4 wiring), per the roadmap's own proposed fix | engineer | IMPROVEMENT_ROADMAP Q3 |

### P2

| # | Item | Audience | Evidence / source |
|---|---|---|---|
| 19 | Drag-to-chat artifact-refs GIF (~20s; fully implemented at LeftRail.tsx:68-69 + src/ui/artifactRefs.ts, zero visual demo) and mobile panel-toggle GIF after #3 lands — the only 2 implemented-but-invisible affordances of 39 features | user, engineer | Feature-coverage audit |
| 20 | Q4 retention is partially landed (bounded telemetry prune exists); remaining Q4 export cadence/trace caps, Q6 capacity ceilings + pagination (unbounded `.collect()`), and Q7 `valueBefore` persistence + restore runbook (the documented lower-altitude alternative to the denylisted full agent-run revert) | engineer | IMPROVEMENT_ROADMAP Q4/Q6/Q7 |
| 21 | Doc bookkeeping: mark roadmap P0-3 (`--strict`) as verified wired; add diagram-freshness keep-alive line to README (`npm run architecture:budget`) | engineer | Roadmap verification; GAPS_NOT_DONE P2-1 |

## Sequencing note (from the roadmap-verification audit)

Close **#6 (P0-1 case-set hashing) first** — it gates the trustworthiness of every later eval claim — then **#8 (P0-4 USD wiring)**, then **#7 (P0-2 tamper denylist)**. Docs fixes #1/#2 are same-day, near-zero-cost, and remove the only two falsifiable claims in an otherwise honest documentation stack. The user-audience block (#3, #4, #5) is the difference between an interview artifact and a product.
