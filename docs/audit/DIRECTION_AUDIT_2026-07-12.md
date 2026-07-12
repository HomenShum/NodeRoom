# Direction Audit — 2026-07-12

**Scope:** every file tied to project direction — ~430 markdown files across root, docs/ (436 files), proofloop/, .proofloop/lanes/, .claude/, and the cross-session memory directory — audited by an 8-cluster multi-agent pass with adversarial verification of all 43 claimed contradictions (14 CONFIRMED, 24 PARTIAL, 5 REFUTED), plus 2 usage-mining passes (25 session transcripts / 103,977 events; claude-mem DB 42,484 observations; 769 commits since 2026-05-01). Companion report: `CLAUDE_USAGE_ANALYSIS_2026-07-12.md`.

## 0. Executive summary

The repo's facts are mostly right; its **lifecycle hygiene is broken**. The dominant defect is not "wrong direction" but *executed work still documented as pending* (or vice versa) with no supersession markers. Three structural failures generate almost every finding:

1. **Uncommitted truth.** The newest certification state (54 receipt files, "Official scores claimed: 5"), the July product direction (`docs/synthesis/WORK_ARTIFACTS_*`), the certified release receipt, and the newest design authority docs exist only in the working tree. Git HEAD — what CI, fresh clones, and worktrees see — says the *opposite* on official scores (1 vs 5) and carries month-old priorities.
2. **Invisible harness.** `.claude/` is gitignored wholesale; the enforcement layer the docs assume (hooks, reviewer agents, most skills) does not exist on any fresh checkout, and `design-reference/` — the token bundle CLAUDE.md's hard rule depended on — is gitignored and absent even locally.
3. **No supersession convention.** Docs, memories, and receipts are point-in-time snapshots written in present tense. Nearly every confirmed contradiction is a newer artifact winning over an unmarked stale one.

## 1. Contradictions (adversarially verified)

### Tier 1 — live policy conflicts and prod-touching traps

| # | Contradiction | Verdict | Resolution |
|---|---|---|---|
| C1 | benchmark_completion approval: `src/nodeagent/core/budgetProfiles.ts` (explicit approval) vs `src/nodeagent/runtimeProfiles.ts` (`requiresExplicitApproval: false`); two docs each crown their own file "source of truth" | CONFIRMED high | **Strict side wins** (fail-closed on a spend lane). Consolidate the duplicate modules; fix `docs/NODEROOM_ACTION_MAP.md` cell. *Not yet applied — code change, see §7.* |
| C2 | `GLOBAL_MAX_USD_PER_MONTH`: $75 (`docs/OPERATING_BUDGET.md` + `convex/agent.ts:220` default) vs $150 (`docs/launch/PILOT_LAUNCH_REPORT.md` + `src/nodeagent/core/creditModel.ts:242`) | CONFIRMED high | **$150 wins** (17 days newer, grounded in n=1639 runs). Mark OPERATING_BUDGET superseded; reconcile `convex/agent.ts`. *Not yet applied — code change, see §7.* |
| C3 | "convex codegen deploys to prod" memory vs "codegen only regenerates types" (`CONVEX_AS_LEDGER.md:354`). CLI source shows codegen does a network `startPush` (bundle upload + schema-change start) but never `finishPush` — and the post-edit hook auto-ran it against a prod-pinned env | PARTIAL med, prod-touching | **Memory wins operationally.** ✅ FIXED this pass: `.claude/hooks/post-edit.mjs` now skips auto-codegen when `.env.local` pins zealous-goshawk-766; CLAUDE.md documents the gotcha. Amend the doc sentence when next touched. |
| C4 | Deploy topology: `memory/convex-deploy-not-git-push.md` (`npx convex deploy` → aromatic-bass-102; `vercel deploy --prod`) vs `memory/noderoom-convex-env-keys.md` + `docs/SOURCE_OF_TRUTH.md:142` (zealous-goshawk-766 IS prod; `npm run convex:deploy`; Vercel auto-deploys from git). The old memory deploys to a read-only standby | PARTIAL high | **noderoom-convex-env-keys wins** (newer, live-verified, matches the deploy guard). ✅ FIXED this pass: stale memory updated; topology stated once in CLAUDE.md. |

### Tier 2 — false "blocked / not built" claims that cause re-work or wrong public claims

| # | Contradiction | Verdict | Resolution |
|---|---|---|---|
| C5 | BankerToolBench: README/`docs/ARCHITECTURE.md` say official scoring "remains blocked until Harbor/MCP/Gandalf" vs NODE-LOOPS + FR-020B receipt (100/100 executed AND officially scored, mean reward 0.2519, pass-rate 0.0000, flipEligible: true) | CONFIRMED high | Receipt wins. Fix README/ARCHITECTURE wording — preserving that this is COMPLETION+SCORING, never a "pass" claim (pass-rate is 0). |
| C6 | `docs/architecture/NODEAGENT_REVIEW_ALIGNMENT.md` claims six Convex ledger tables (toolEvents, cellVersions, linkupLogs, financialData, downstreamPublishes, sourceRefs) that never existed in git history; only `semanticConflicts` is real | CONFIRMED high | Code wins. Strike the phantom tables. |
| C7 | `docs/architecture/PDF_CITATION_BOX_PLAN.md` says "NOT BUILT — pick this up cold", but pdfBox.ts / PdfCitation.tsx / react-pdf shipped the same day and are wired. Following the doc clobbers shipped code | CONFIRMED high | Code wins. Flip header to BUILT (as-built record). |
| C8 | CLAUDE.md called DESIGN_PARITY_PLAN "the parity queue" + "lift the exact CSS"; the plan's own (uncommitted) 2026-07-10 authority notice declares itself historical (authority = UI_CONTRACT; "exact CSS never lifted"); its MISSING items are shipped | CONFIRMED high | Authority notice wins. ✅ FIXED this pass in CLAUDE.md (UI_CONTRACT authority; KEEP/REFINE/REJECT rule). Commit the plan's authority notice. |
| C9 | `MVP_WORKBOOK_STACK.md` presents ExcelGridSheet + proof gate as current — component removed ~06-25, gate cannot run; 3 stale inbound links | CONFIRMED med | Code wins. Archive; fix inbound refs. |
| C10 | `LIVE_CAPTURE_PIPELINE.md` "ready to apply" recipe for convex/capture.ts — shipped as capturesNode.ts/captures.ts (deployed dev+prod) | CONFIRMED med | Code wins. Replace recipe with pointer to shipped files. |
| C11 | `REPO-PARITY-CHANGELOG.md` + `CONTRACT_PARITY_AUDIT.md` instruct merging branch claude/inspiring-newton-187f71 — PR #187 merged same day; deltas verified on main | CONFIRMED med | main wins. Mark done; keep only the unclaimed live-DOM verification step. |
| C12 | Two rework ledgers: `docs/traces/TRACE_REWORK_LEDGER.md` (8 seeds) vs `docs/rework/REWORK_LEDGER.md` + JSON (CI-enforced). Zero overlap | CONFIRMED med | docs/rework wins (newer, CI-enforced). Migrate the 8 seeds; make the traces doc a pointer. |
| C13 | Scaffold allowlist drift: CLAUDE.md omitted CLAUDE.md itself + proofloop.config.json while `scripts/scaffold-check.ts:202` and `src/eval/scaffoldProposal.ts:58` allow both; every listed glob was dead (subagents/ absent; scenarios are .spec.ts; adapters are .mjs/.ts; real YAML in proofloop/accounting|notion/) | CONFIRMED med ×2 | Code wins. ✅ FIXED this pass: CLAUDE.md allowlist now matches disk + code. |
| C14 | solo-founder-nodes skill: the copy Claude Code loads lacks the Phase 0 "Reference RALPH" gate + anti-cheat doctrine that exist only in the uncommitted gitignored nested clone; both link a dead `templates/run/README.md` | CONFIRMED med | Clone working tree wins. Sync into .claude/skills, push upstream, remove nested clone. |

### Tier 3 — stale status snapshots (fix-in-passing)

| # | Contradiction | Verdict | Resolution |
|---|---|---|---|
| C15 | Board "Official scores claimed: 5 / blockers none" vs all six lane receipts `officialScoreClaimable: false`; **SpreadsheetBench's board flip has NO supporting receipt** (regeneration bug) | PARTIAL high | Board wins for finch/finauditing/workstreambench/BTB (accepted scorer receipts exist); lane receipts win for SpreadsheetBench — **fix the board row before committing**. |
| C16 | Committed HEAD board ("claimed: 1 / blocked: 4") vs working tree ("claimed: 5 / blocked: 0") — 54 files uncommitted since 07-08 | PARTIAL high | Working tree wins — but **commit it** (after C15) or HEAD keeps lying to CI/clones. |
| C17 | Finch "GPT-5-mini scoring is the remaining gate" vs same-day receipt: scored/accepted via hash-bound transport equivalent | PARTIAL high | Receipt wins. Update + commit the (untracked) imports doc. |
| C18 | `docs/audit/AUDIT_SUMMARY.md` headlines "zero browser E2E / no data-testid" — 5 playwright configs + 68 testid files exist | PARTIAL high | QA_FINDINGS wins. Add a supersession banner. |
| C19 | Memory: concurrent-codex-fleet (commit on shared main, preserve foreign hunks) vs no-codex-fleet-do-it-myself (verbatim repudiation) — index still offered the repudiated advice | PARTIAL high | no-codex-fleet wins. ✅ FIXED this pass in the memory index/files. |
| C20 | WEDGE roadmap "official benchmark score claims: not built" vs generated Proof Release (certified, receipt-backed) | PARTIAL med | README wins; the WEDGE rule was conditional and its condition is now satisfied. Update the roadmap line. |
| C21 | Ladder L0–L6 (docs/AUDIT.md) vs L1–L7 (README/NODE-LOOPS/evals/ladder.ts L7_resume) | PARTIAL med | Code wins. Add L7 row; mark the 06-07 status historical. |
| C22 | DYNAMIC_SKILL_RETRIEVAL P1–P3 "apply on approval" vs shipped + regression-gated (`okf.ts:607`) | PARTIAL med | QA doc wins. Mark shipped. |
| C23 | Devin adapter "ready" (generated) vs dogfood docs "needs_adapter" — wiring landed in the same commit that last touched the docs | PARTIAL med | Receipt wins (launcher-ready ≠ runtime-verified). Update both dogfood docs. |
| C24 | GAPS_NOT_DONE (06-18) vs WORK_ARTIFACTS_PROGRESS_RECEIPT (07-11, untracked) | PARTIAL med | Receipt wins where they overlap. Reconcile; commit the receipt. |
| C25 | Assistive Inbox (Approved, implemented) vs Passive Room Intelligence v2 (Proposed) — no banner on the older doc | PARTIAL med | Assistive Inbox wins. Banner the v2 doc. |
| C26 | DESIGN_BENCHMARK "No command palette anywhere" vs shipped CommandPalette.tsx that UI_CONTRACT preserves — its own revisit clause was met | PARTIAL med | UI_CONTRACT + code win. Note the revisit condition was met 07-04. |
| C27 | `always-run-playwright-e2e` memory ("npx playwright test auto-starts dev server ~2 min") vs verified gotcha (it HANGS; use build → preview + PLAYWRIGHT_PORT/REUSE_SERVER/BASE_URL) | PARTIAL med | Gotcha wins. ✅ FIXED this pass: working recipe embedded in the memory + `docs/qa/BROWSER_VERIFY.md`. |
| C28 | "do NOT rename solo-founder-nodes" memory vs recorded rename → solo-founder-agent-builder (301 redirect) | PARTIAL med | Rename wins for the GitHub slug; the SKILL/BotLearn slug stays solo-founder-nodes. ✅ FIXED in memory. |
| C29 | MEMORY.md index "Coach = Copilot tab" vs the linked file's own SUPERSEDED banner (Coach = mode inside Private) | PARTIAL med | Successor wins. ✅ FIXED in index. |
| C30 | BotLearn hero: SHIP_PLAN (powerpoint = HERO) vs later pitch (suite = submission). Event closed 06-27, no outcome recorded | PARTIAL med | Pitch wins. Archive SHIP_PLAN; record the outcome. |
| C31 | PITCH_ONE_PAGER "benchmark UI lane in flight" — PR #40 merged 55 min before the pitch commit | PARTIAL med | Git history wins on lane status; the "no clickable graded surface" bullet stays (still true per coverage ledger). |
| C32 | ship skill hardcodes "Co-Authored-By: Claude Opus 4.8" + a dead CLAUDE.md merge-policy citation | PARTIAL low | Harness wins. Make the trailer generic; drop the citation. |
| C33 | "certified" enum leaking into buyer-visible release doc vs buyer-validation rule ("verification you run, not certification") | PARTIAL low | Buyer rule wins outward. Fix `proofReleasePublishing.ts` rendering; keep the internal enum. |
| C34 | MEMORY.md "proofloop@0.2.0" vs body "0.1.0" — live npm is 0.3.0 | PARTIAL low | Neither. ✅ FIXED: hardcoded versions dropped; `npm view proofloop version` is authoritative. |
| C35 | DEMO.md teaches `/ask` as primary vs DESIGN/ARCHITECTURE (@nodeagent primary, /ask hidden alias) | PARTIAL low | Shipped UI wins. Update DEMO.md. |

**REFUTED (no action):** desktop light-vs-dark palette; scaffold-handoff advisory warning; eval:real Anthropic vs provider-agnostic prod; proof-ledger aromatic-bass row; nodemem dormant-in-prod (properly labeled "(Historical, pre-fix)").

## 2. Gaps — ranked by junior-model impact

1. ✅ `design-reference/` gitignored+absent while CLAUDE.md's hard token rule depended on it (with a decoy `.design-ref/` at root) — *fixed: CLAUDE.md now states the styles.css fallback and bans `.design-ref/`.*
2. ✅ No file bridged NodeRoom (product) and ProofLoop (harness) — *fixed: CLAUDE.md "What this repo is" section.*
3. The newest direction is uncommitted (July plan + receipts, release docs, authority notices, mobile/first-run contracts). HEAD tells the opposite certification story. → commit sequence in §6.
4. ✅ `.claude/` gitignored wholesale, nothing said so — *fixed: CLAUDE.md "Local harness" section.* (Note: no `proofloop hooks install` command exists — earlier drafts of this advice were aspirational.)
5. ✅ Scaffold-editable globs matched nothing on disk — *fixed (C13).*
6. No single authored certification doc — *being fixed: `docs/eval/CERTIFICATION_GATES.md`.*
7. No July-2026 current-priorities statement (NEXT_STEPS_PRIORITY is 06-21). → owner input needed; see §7.
8. Undefined load-bearing jargon (OKF, Harbor/Gandalf, HALO, CRS, flipEligible, FR-0xx, fresh-room) — *being fixed: `docs/GLOSSARY.md`.*
9. ✅ No canonical pre-ship gate statement — *fixed: CLAUDE.md names `floor` + `prod:gate` and forbids restating step lists elsewhere.*
10. docs/eval (159 files) has no index or generated-vs-authored marking — partially fixed by `docs/eval/BENCHMARK_RUNBOOK.md`; index README remains open.
11. Machine-local ground truth (design HTMLs in Downloads/, donor repo paths, DrawIO paths) — flagged; portable fallbacks are the checked-in PNG captures.
12. Case-colliding `docs/dogfood/FRICTION_LOG.md` vs `friction-log.md` (different subjects) breaks case-insensitive checkouts. → rename one.
13. ✅ No supersession convention in the memory system — *fixed: MEMORY.md restructured with dates + SUPERSEDED markers.*
14. No QA run-artifact retention policy (fixloop vs prod-dogfood inconsistent). → owner decision.
15. Misc path rot (model-delta.md path ✅ fixed in CLAUDE.md; security-reviewer `src/agent/*` paths; AGENT_EVAL `context.ts`; README anchor typo; duplicate npm aliases ✅ deleted).

## 3. Dead-weight dispositions (~95 items)

Full per-file table lives in the machine session's master report; summary by class:

- **40 archive** — executed plans still framed as pending: botlearn event docs, June-26 QA campaign snapshots titled "Current State" (`docs/qa/CURRENT_STATE_RECEIPT.md`, `NODEROOM_CURRENT_STATE.md` — the worst misleaders), ~75 gemini-media-judge run logs, superseded design passes (open-design-redesign/, CONTRACT_PARITY_AUDIT, SURFACE_WEB_DESIGN_AUDIT, PARITY.md), one-off eval run reports, dated seo reports ×7.
- **35 update** — false "NOT BUILT" headers on shipped features (C7, C10, C22); stale budget/priority/gap registers (OPERATING_BUDGET, NEXT_STEPS_PRIORITY, TARGET_2026_06, GAPS_NOT_DONE); memory mechanics superseded by newer topology.
- **8 merge** — README changelog/architecture sections → docs/CHANGELOG + ARCHITECTURE; REPO-PARITY-CHANGELOG → UI_CONTRACT; TRACE_REWORK_LEDGER → docs/rework JSON; nested solo-founder-nodes clone → .claude/skills; coach/decisive-default memories → successors; demo plan → latest review; ROOM_OS map → voice ADR.
- **6 delete** — gitignored generated docs/agents receipts, stray NUL file, dead scheduled_tasks.lock, and the two byte-identical npm aliases (✅ deleted this pass: `omniagent:nodeagent:smoke`, `previews:render`).

## 4. Canon — the minimal current-direction set

`docs/WEDGE.md` · `NODE-LOOPS.md` · `CLAUDE.md` · `AGENTS.md` · `README.md` (after slimming) · `docs/ARCHITECTURE.md` · `docs/SOURCE_OF_TRUTH.md` · `docs/design/UI_CONTRACT.md` · `docs/architecture/CONVEX_AS_LEDGER.md` · `docs/eval/CERTIFICATION_GATES.md` (new) · `docs/eval/PROOFLOOP_BENCHMARK_BOARD.md` (generated) · `docs/synthesis/WORK_ARTIFACTS_IMPLEMENTATION_AND_DOGFOOD_PLAN.md` (commit it) · `docs/GAPS_NOT_DONE.md` (after reconciliation) · `memory/MEMORY.md`.

Second ring (authoritative for their domains): docs/design/mobile/* + first-run/* (commit), docs/DESIGN.md, docs/AGENT_RUNTIME.md family, docs/NODEAGENT_FRICTION_BUDGET_POLICY.md (post-C1), docs/launch/PILOT_LAUNCH_REPORT.md, proofloop/scaffold/current.md, docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md, docs/rework/REWORK_LEDGER.md, docs/qa/ANTI_SHALLOW_QA_POLICY.md, docs/design/DESIGN_QA_LADDER.md.

## 5. Policy decisions adopted in this pass (flag if you disagree)

| Decision | Adopted | Basis |
|---|---|---|
| benchmark_completion approval | **Explicit approval required** (strict side) | Fail-closed on a spend lane; 2 docs + the executable helper agree behaviorally |
| Global monthly cap | **$150** | 17 days newer, n=1639-grounded, encoded in creditModel with a "reconcile agent.ts" comment |
| Is CLAUDE.md a legal scaffold target? | **Yes** (doc updated, not the code) | `scaffold-check.ts` + `scaffoldProposal.ts` both allow it |
| Status vocabulary | "proven" = official score imported, NEVER "passed" | BTB's proven score has pass-rate 0.0000; overclaiming is exactly what official-score-boundary.md forbids |

## 6. Required commit sequence (not done in this pass)

1. Fix the SpreadsheetBench board row (C15 — the flip has no supporting receipt; regeneration bug), regenerate lane receipts, then **commit the 54-file receipt refresh atomically** with the board.
2. **Commit the July direction:** synthesis plan + receipts, release docs, PROOFLOOP_OFFICIAL_SCORE_IMPORTS, DESIGN_PARITY_PLAN authority notice, docs/design/mobile/** + first-run/** + the three *_CONTRACT.md files.
3. Decide the fixloop/QA run-artifact retention policy.

## 7. Open items needing owner or code-level work

- C1 module consolidation (budgetProfiles vs runtimeProfiles) — full diff first, then one module.
- C2 reconcile `convex/agent.ts` $75 default → $150 (or set the prod env var) — touches deployed Convex.
- README slimming (187KB → headline + generated proof block + quickstart + links).
- July priorities statement (successor to NEXT_STEPS_PRIORITY / TARGET_2026_06).
- Media-skill trio consolidation, fleet-merge skill, seed command, shared Gemini-judge module (see usage analysis §rebuilds).
- FRICTION_LOG case-collision rename; security-reviewer agent path fix; solo-founder-nodes doctrine sync.
