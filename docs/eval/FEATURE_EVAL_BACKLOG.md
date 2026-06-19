# Feature Eval Backlog

This is the eval backlog for features we can offer only after they have a
public or private gold source, a trajectory contract, and a live route proof.
The finance model lane proved the pattern: an uploaded workbook is not a
feature claim until a real route completes the same lock/read/CAS/release flow
that users see. The same rule applies when there is no upload: a chat-only
company note, selected existing artifact, or mixed room state is not a product
claim until the agent proves it can infer the workflow, gather evidence, and
write the right artifact safely.

The unifying principle: **every feature is a proven conversion from how a user
actually starts (usually a sentence in chat) to a governed artifact, with
provenance attached and a measured reliability rate.** Intake modes describe
the start; the output contract describes the landing; the promotion rule
describes the proof.

## Promotion Rule

Each feature needs four artifacts before it can be marketed:

1. A golden reference source: public dataset/API, owned synthetic fixture, or
   private local gold pack with a redacted committed summary.
2. A workflow contract: user intent, allowed tools, mutation policy, expected
   artifact state, trace invariants, **and an output contract** (which surface
   the result lands on — see Output Contracts below).
3. A reliability proof, not a route proof: at least one supported cheap/free
   route passes **>= 4 of 5 model-owned runs across >= 2 room-setup variants**
   (empty room / pre-populated with distractor artifacts / concurrent edit
   mid-run). Cost and latency are **gates, not recordings**: each rung
   declares `maxCostUsd` and `maxMs`, judged at p95 across the runs. The
   committed summary carries the **aggregate plus every attempt** (including
   failures, with `failureOwner` per attempt) — never best-run-only. If
   provider-owned failures exceed 40% of attempts the verdict is
   "inconclusive — rerun", never "passed".
4. A regenerable walkthrough capture of the real flow (the same
   capture→render→judge pipeline as the README media). If we cannot film it,
   we cannot market it — and the film doubles as the marketing asset.

Two honesty rules attached to the proof:

- **Proofs decay.** A committed champion summary older than 30 days (or
  surviving a model-catalog change) is stale until re-verified; stale proofs
  are labeled, not silently trusted.
- **Single passes are labeled as such.** Until a lane has the N-run
  aggregate, its docs must say "single live pass, reliability rate not yet
  measured". The finance full-solve lane is no longer the example: its current
  committed proof is a 5/5 model-owned DeepSeek v4 Flash batch in
  `docs/eval/finance-model-live.json`.

Enforcement is planned as code, not prose: a `docs/eval/features.json`
manifest (featureId → gold source hash, contract case ids, reliability proof
summary path) plus a test that fails when any README-marketed feature lacks a
complete manifest entry. Until that test exists, this rule is a convention —
treat that as a known gap, not a license.

## Intake Modes

Every feature eval should declare which starting surfaces it supports:

| Intake mode | Example user request | Required behavior |
|---|---|---|
| `chat_only` | "Just spoke with Sarah at Nira; they do AI QA for clinics and raised $4M." | **Capture first**: write the provisional row/note immediately with `needs_review` status — never block capture on perfect identity. At most **one** clarifying question, asked alongside (not before) the write; the answer upgrades the row asynchronously. Preserve the user statement as manual evidence. **Person-subject facts (who the user met, when) default to private visibility**; company facts may go to shared surfaces; promotion of person facts to shared/public requires explicit user action. |
| `pasted_content` | User pastes a forwarded intro email, a call-transcript chunk, or a LinkedIn blurb into chat. | Detect that the text is third-party authored (headers, signatures, speaker labels). Record provenance as `quoted_third_party` — **below** `user_said`, above unverified — and attribute claims to the original author, never to the user. Redact the sender's contact details by default. This is the most common real GTM capture behavior; treating it as `chat_only` would inflate a founder's "we're growing 40% MoM" to user-asserted evidence. |
| `upload` | User drops an XLSX/CSV/PDF and asks NodeAgent to solve, classify, reconcile, or summarize it. | Parse/render the file, ground writes in artifact evidence, preserve formulas/layout, and keep private gold out of public traces. |
| `selected_artifact` | User selects a sheet/wiki row and says "update this from public sources." | Use artifact refs and versions, read before write, and avoid unrelated artifacts. Declared on the finance reconciliation case; an intake coverage test fails if any mode loses its declaring case. |
| `mixed_room_state` | Chat note plus existing watchlist/wiki plus prior agent trace. | Fuse available evidence by provenance tier: `user_said` > `quoted_third_party` > room artifact > fetched source > computed. Chat-tier claims are never silently upgraded to sourced facts. |
| `external_retrieval` | "This company just raised; verify and add comps." | Fetch/cite public sources, separate unverified chat claims from sourced facts, and record failureOwner when retrieval/provider issues block proof. |

## Output Contracts (the other half of "flexibly adaptive")

Intake modes say where a request starts. The output contract says where the
result lands — and picking the wrong surface IS the product failure the user
experiences, even when extraction is perfect. Every intake-bearing eval case
declares:

- `allowedSurfaces`: which of watchlist_row / wiki_note / background_job /
  chat_reply_only / private_note the workflow may produce.
- `defaultSurface`: what happens with no explicit instruction. For chat
  capture: a private watchlist row plus a short chat acknowledgment.
- `escalationRule`: what user language upgrades the surface — "queue it /
  research this" → background job; "share with the room / add to the wiki" →
  shared artifact. No unrequested public artifact, ever.

## Ranked Eval Candidates

Ranking rule: `demand evidence x harness reuse x days-to-reliability-proof`.
Data-source convenience is explicitly **not** a ranking factor — a free public
API makes a lane cheap to start, not worth starting.

| Rank | Feature eval | Buyer + demand evidence | Golden source | User workflow | Gate |
|---|---|---|---|---|---|
| 1 | Chat-first lead capture + GTM enrichment | Founder/BD/investor capturing between meetings. **Demand evidence: the owner's own repeated requests verbatim** ("just spoke with X; their startup Y does Z", "company Y just raised $ABC"). Highest harness reuse: agentJobs checkpointing + research harness already exist. | Recorded HTTP cassettes first (see Next Builds), then Companies House, SEC EDGAR, Wikidata/OpenAlex | User writes one sentence in chat; NodeAgent captures first (provisional private row + needs_review), enriches from public sources, asks at most one non-blocking question. | Chat entity extraction, manual-vs-fetched evidence separation, duplicate-row prevention, capture-before-clarify, person-facts-private-by-default. |
| 2 | SEC filing model build | Analyst persona; extends the proven finance lane. Demand evidence: inferred from the finance-lane work, not yet user-requested — one rung behind rank 1 for that reason. | [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | User drops a company/ticker; NodeAgent pulls filings, creates cited financial rows, computes ratios, and writes assumptions into the workbook/wiki. | XBRL fact tie-out, cited filing refs, formulas not hardcoded, no private data in public traces. |

### Parked until buyer signal

These have free gold sources, which makes them feel one API away from
buildable. The real cost of a lane is the runner + grader + fixture pack (the
finance lane's true cost), and each row below is a different buyer persona.
None starts before rank 1 has a runnable fixture and a reliability proof —
starting a third lane before then is scope gravity, not progress.

| Feature eval | Golden source | Gate (when unparked) |
|---|---|---|
| Vendor/procurement diligence | [SAM.gov Exclusions API](https://open.gsa.gov/api/exclusions-api/), [USAspending API](https://api.usaspending.gov/) | No false "clear" on missing data, evidence-bearing writes, risk flags reproducible from API payloads. |
| Nonprofit/foundation diligence | [IRS TEOS bulk data](https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads), ProPublica Nonprofit Explorer | EIN/entity match, status/fiscal-year accuracy, numeric tie-outs against Form 990 fields. |
| Life-sciences trial and safety table | [ClinicalTrials.gov API](https://clinicaltrials.gov/data-api/api), [openFDA APIs](https://open.fda.gov/apis/) | NCT match, phase/status accuracy, cited snippets. **The hardest gate (no medical advice) has zero safety-lane scaffolding — budget that harness first or sequence this last.** |
| Spreadsheet manipulation benchmark | [SpreadsheetBench](https://github.com/RUCKBReasoning/SpreadsheetBench) plus our XLSX upload renderer | Coordinate accuracy, formula preservation, no overwriting formula cells unless asked, final workbook diff. |
| Meeting-to-wiki/action room | [QMSum](https://github.com/Yale-LILY/QMSum), MeetingBank | Query-focused summary quality, action extraction precision, private speaker details redacted by scope. |
| Regulatory research matrix | [eCFR API](https://www.ecfr.gov/developers/documentation/api/v1), [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | Citation section accuracy, effective-date handling, no legal advice (same safety-lane caveat as life-sciences). |

## What Not To Build Yet

- A broad "universal professional eval" with dozens of domains and no route
  proof. That recreates the old harness problem: expensive runs that measure
  setup mistakes.
- A judge-only score with no final artifact diff. Every feature here must grade
  the state the user sees.
- A full model bakeoff before the harness has a cheap smoke and a targeted
  intermediate rung. The finance lane now uses smoke -> income -> full for
  exactly this reason.
- **Catalog proof counted as behavior.** The professional catalog now has a real
  deterministic proof gate, but it still proves specification quality, not
  model execution. Green catalog proof must be presented as catalog proof;
  runtime and live-provider promotion still require final artifact diffs,
  traces, and route evidence in the proof ledger.
- **Best-of-N champion claims.** Keeping the best of several manual reruns as
  the committed proof is a max-statistic; it measures "can it ever", not
  "will it". Either commit the aggregate or label the proof single-pass.

## Next Builds (ordered)

1. **Chat-first capture, deterministic rung first.** Replicate the finance
   pattern, which is already the in-repo template: commit recorded HTTP
   cassettes (request hash → PII-scrubbed, size-capped response) for 5–10
   named entities **including one deliberately ambiguous pair**; grade chat
   entity extraction, capture-before-clarify, duplicate prevention, and the
   clarify-vs-guess decision as booleans from the trace, exactly the way
   `financeModelRuntime.ts` grades lock/read/CAS/release. Only after the
   scripted rung is green does a live rung run — as a scheduled canary with
   fetch failures auto-classified `failureOwner='provider'`, not as the
   promotion gate. This is rank 1 because the demand evidence is the owner's
   own usage, and it is also the cheapest proof: the agentJobs/checkpoint
   substrate and research harness already exist.
2. **Finance Guide mode.** Same private workbook, but the invariant flips:
   NodeAgent must coach and write zero answer cells. Mechanically checkable
   restraint — no framework benchmark measures it.
3. **SEC filing model build L0–L2.** Public EDGAR facts only: ticker/CIK
   lookup → one filing fact table → formula ratios with citations.

## Harness Hardening (mechanical, before any new lane)

These convert the promotion rule from prose to code. Anchors are current as
of 2026-06-11.

Status: **all seven items are implemented.** Items 1-5: `evals/financeModelLive.ts`
(runs aggregation, budget gates, structured attribution, model-owned pass rate
with the >40%-provider-share `inconclusive` verdict), `evals/harnessStatus.ts`
(implemented-vs-contract manifest with on-disk entry-point checks), and the
catalog (`pasted_content` intake mode, output contracts on every chat-started
case, `selected_artifact` declared on the reconciliation case). Item 6:
`--variants` room rotation (base / distractors-with-colliding-cell-ids /
concurrent human edit mid-run) with a no-variant-goes-0-for aggregate gate.
Item 7: `npm run proofs:staleness` + `tests/proofStaleness.test.ts` — every
marketed proof in `evals/proofStaleness.ts` MARKETED_PROOFS goes red in CI 30
days after its `generatedAt`; rerun the batch or pull the claim. Scenario
coverage: `tests/financeModelReliability.test.ts`,
`tests/financeModelLive.test.ts`, `tests/proofStaleness.test.ts`,
`tests/professionalWorkflows.test.ts`.

1. `--runs N` on `evals/financeModelLive.ts` main(): loop the solve, commit
   the aggregate `{passRate, medianMs, p95CostUsd, perCheckPassCounts}` with
   a `runs[]` ledger of every attempt. Append a run-history JSONL so
   `eval:diff` can catch champion regression.
2. Cost/latency as check booleans: `withinCostBudget` / `withinTimeBudget`
   per rung join the checks object (`financeModelLive.ts:527-536`) so they
   participate in `passed = all-true`.
3. Structured failure attribution: today `classifyRunFailure` regexes error
   text, which launders model faults — a model emitting malformed JSON tool
   args matches "Invalid JSON", a model dawdling past the deadline matches
   "timeout", and both get filed as provider failures. Split: transport
   errors tagged at the fetch site (HTTP 429/5xx, ECONNRESET) = provider;
   deadline hit mid-protocol = model; JSON parse failure on tool-call args =
   model, on the provider envelope = provider. Record the raw status code.
4. Implemented-vs-contract manifest: `evals/harnessStatus.ts` mapping every
   `ProfessionalHarnessRequirement` to `implemented | contract` with an
   entryPoint for implemented ones, plus a test that a `runnable` case may
   only require implemented harnesses. Today `chat_intake_parser`,
   `entity_resolution`, and `clarifying_question_gate` exist only as catalog
   strings — honest as a contract, invisible as one in CI.
5. Intake coverage test: every `ProfessionalWorkflowIntake` union member has
   >= 1 declaring case (`selected_artifact` currently has zero), and every
   `chat_only` case declares an output contract.
6. Room-setup perturbation in promotion runs (the shipped passed-once-then-
    0/3 bug is exactly this class): the N-run matrix covers the three room
   variants; no variant may go 0-for.
7. Staleness gate: committed proof summaries carry `generatedAt`; a check
   flags any marketed champion older than 30 days for re-verification.
