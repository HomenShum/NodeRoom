# Intuitiveness QA — how we judge "feels right" vs "too many steps"

> The missing third lens. Our QA already proves **correct** (CAS/locks/isolation tests) and
> **fast** (optimistic-paint proofs). This process proves — or disproves — **intuitive**, which
> neither of those can, because "intuitive" is a judgment against what users already expect.
> Grounded in: NN/g complex-application research, GitLab's dogfooding handbook, Stripe/Google
> friction-log practice, and the documented conventions of the four tools our users live in.
> All sources fetched and cited at the bottom; nothing asserted from memory.

## 0. The operational definition (this is the whole trick)

**"Intuitive" is measurable.** For a finance/GTM user it means: *the interaction matches the
muscle memory of the four tools they already use eight hours a day* — Excel/Google Sheets,
Slack, Google Docs, and their CRM. **"Friction" is every step beyond the minimum path those
tools trained them to expect.** That turns a vibe ("feels clunky") into a test:

1. Every NodeRoom interaction either **matches the convention** of the tool it resembles, or
   has a **written reason to differ**. No third option.
2. Every job-to-be-done has a **step budget**: the step count in the benchmark tool, plus at
   most one. Exceeding budget = a finding, automatically.

O'Neill's quality bar for analytics/sales tools backs this up: enter "the user's work stream
like a raft on a river — minimize behavior change"; adoption, not features, is the success
measure ([Designing for Analytics ep. 182][oneill]).

## 1. The muscle-memory benchmark (what "production app patterns" actually are)

| Tool they know | Documented convention (source) |
|---|---|
| **Excel / Sheets** | Click cell or F2 to edit · **Enter commits + moves down** · Tab commits + moves right · **Esc cancels** the in-progress edit · Ctrl+V pastes multi-cell ranges ([Microsoft][xl] · [Google][gs]) |
| **Google Docs (suggest mode)** | Suggestions render **in context at the change location**, in a distinct color · **Accept/Reject is one click adjacent to the suggestion** · bulk "Accept all" exists as the secondary path ([Google][docs]) |
| **Slack** | Enter sends · **Up-arrow edits your last message** (documented default) · hover reveals actions · threads keep noise out of the main feed ([Slack][slack]) |
| **CRM (HubSpot pattern)** | Paste/upload a list → column-map preview with error counts → import · **re-importing the same identity UPDATES the record, never duplicates it** ([HubSpot][hs]) |

## 2. The golden paths + step budgets (finance/GTM jobs-to-be-done)

Budget = benchmark steps + 1. Counted as user-visible interactions (clicks, keys, panel jumps).

| # | Job-to-be-done | Benchmark (tool) | Steps | Ours today | Steps | Verdict |
|---|---|---|---|---|---|---|
| G1 | Mark up a variance cell during close review | Sheets: click → type → Enter | 3 | hover → pencil click → type → Enter | 4 | At budget ✓ |
| G2 | Tell the room what you found | Slack: type → Enter | 2 | type → Enter | 2 | Parity ✓ |
| G3 | Fix a typo in what you just said | Slack: **↑** → edit → Enter | 3 | hover → pencil → edit → Enter | 4 | At budget, convention miss (↑) |
| G4 | Add 10 target accounts to research | CRM: paste → preview → import | 3 | Research tab → paste → Add accounts | 3 | Parity ✓ (no preview step — see F7) |
| G5 | Approve a teammate's/agent's proposed edit | Docs: click Accept **next to the change** | 1 | scan bottom activity strip → find proposal → Approve | 3 | **Over budget + out of context** |
| G6 | Get the agent to do the work | Slack-style mention: type `@nodeagent …` → Enter | 2 | same | 2 | Parity ✓ |
| G7 | Take back a mistake | Sheets: Ctrl+Z | 1 | re-edit the cell by hand (no undo) | 4+ | **Over budget** |

## 3. The three instruments (how a run actually works)

**Instrument A — Convention-parity sweep (automated, cheap).** A checklist of the benchmark
conventions, each verified against the code/DOM (greppable or Playwright-assertable: "Esc
restores the old value", "↑ opens last-message edit", "paste of 3×2 TSV fills 6 cells").
Run on every UI change. Deviations land in the friction log with a verdict: *fix* or
*differ-with-reason*.

**Instrument B — Friction log (human, during real work).** Stripe's format ([source][stripe]):
log **while doing a real task** — not retrospectively ("arrive to the product the way the user
would… else you will miss half the friction" [sbensu][sbensu]). Fields: context (persona +
goal) · stream-of-consciousness narrative with screenshots · per-moment stoplight from Google's
practice ([devrel.net][devrel]): 🟢 delightful / 🟡 frustrating / 🔴 "would have given up if
this weren't my job". Every log must end in filed issues (Stripe's follow-up rule).
Lives in [FRICTION_LOG.md](./FRICTION_LOG.md), append-only.

**Instrument C — Heuristic judge pass (structured, per release).** NN/g's method for complex
apps ([how-to][nng-how]): 3–5 **independent** judges (humans or LLM judges over screen
recordings + DOM transcripts — our existing judge-workflow pattern), two passes (learn, then
log), every violation tied to a specific rule + concrete evidence, consolidated afterward.
The rulebook is NN/g's complex-app set ([heuristics][nng-heur] · [8 guidelines][nng-8] ·
[progressive disclosure][nng-pd] · [workflow expectations][nng-we]) — the 6 most load-bearing
for us:
1. Background/agent work shows progress without navigating away (no bare spinner >10s).
2. Every multistep flow has an emergency exit (Undo / Cancel / restore-version).
3. Safe trial-and-error: a new user can poke around without fear of breaking shared state.
4. Accelerators taught in context (tooltip at the moment of use), novice path still visible.
5. Recognition over recall: options visible at the point of need, never remembered across panels.
6. No step asks for input before the user can sensibly answer ("premature requests").

**The "too many steps" test specifically** (NN/g's actual position): a step earns its place by
*frequency* — frequently-needed things on the first screen, rare things one obvious level down;
a rigid sequence with no skip/loop-back is itself a defect; input requested before the user
understands why should be deferred ([progressive disclosure][nng-pd] · [workflow expectations][nng-we]).

## 4. Cadence + triage (GitLab's rules, adapted)

GitLab's handbook rules ([source][gitlab]), sized for us:
- **Use it for real work** — run our own weekly Q3-style review and GTM target-list session *in
  NodeRoom* (their "use it for as much of your job as possible"). Demo-driving doesn't count.
- **Engineering logs friction; product must fix or justify** — their split: dogfooders feed
  back, the owner *must* prioritize or write the won't-fix reason. No silent backlog death.
- **Stage gates, not vibes** — their minimal→viable→complete ladder: viable means designated
  people use it *extensively*; complete means *exclusively*. We ship a workflow "complete"
  only when we'd run a real close review in it with no escape hatch to Sheets.
- **Label and thread** — every friction entry becomes a labeled issue with a feedback thread.

**Known limits (so we don't fool ourselves)** — dogfooding is NOT user research
([UX Insight][uxi]): we are experts who "instinctively avoid the rough spots" ([devrel][devrel]).
Mitigations we adopt: newest person runs the friction log; enter through the front door (join
by code, cold) not dev shortcuts; pair each release's judge pass with at least one outside
user watching session (conference/hackathon counts).

## 5. First pass — ran today (proof the instrument works)

One convention-parity sweep over the code, same day the rulebook was assembled:

| ID | Finding | Convention violated | Stoplight | Judged |
|---|---|---|---|---|
| F1 | Esc cancels a cell edit, restores prior value (`Artifact.tsx:450`) | Excel Esc | 🟢 | Already right |
| F2 | Enter commits but does **not** move to the next cell | Excel Enter-moves-down | 🟡 | Accept for the 5-row variance sheet; revisit if grids grow |
| F3 | **↑ does not edit your last chat message** (hover→pencil only) | Slack documented default | 🟡 | Fix — small, pure win for chat-heavy users |
| F4 | **No multi-cell paste** on the sheet grid (no `onPaste` anywhere) | Excel/Sheets TSV paste | 🟡 | Defer — research import covers the real bulk case; note reason |
| F5 | **No Undo anywhere** — versions/traces exist server-side, but no user-facing take-back | NN/g emergency exit; Sheets Ctrl+Z | 🔴 | Fix — top finding. We already store every version; this is surfacing, not new infra |
| F6 | **Proposals approve in the bottom activity strip**, not next to the affected cell (`Artifact.tsx:765+`) | Docs accept-adjacent-to-change | 🔴 | Fix — host looks *away from the sheet* to approve a change *to the sheet*. Keep the strip as the bulk/"Accept all" secondary path (that part matches Docs) |
| F7 | **Re-importing an existing company creates `acme_1`** instead of updating `acme` (`convex/artifacts.ts:392-394` suffix loop) | HubSpot update-on-reimport | 🔴 | Fix — GTM users re-paste lists constantly; duplicates poison the research sheet |

Three reds, none of which correctness-QA or speed-QA could ever have caught. That's the lens
earning its keep on day one.

### Implementation update - 2026-06-09

- F5 fixed: spreadsheet Undo is visible in the sheet footer and Ctrl/Cmd+Z routes through the same CAS edit path.
- F6 fixed: pending spreadsheet proposals now render approve/reject controls on the affected cell; the trace strip remains the audit and Accept all path. Review-mode agent runs now create one pending proposal per target and stop retrying the same write.
- F7 fixed: research imports now update existing accounts by company/domain identity instead of creating suffixed duplicates, while preserving sourced research fields.

## 6. Sources (all fetched, not recalled)

[xl]: https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-1798d9d5-842a-42b8-9c99-9b7213f0040f
[gs]: https://support.google.com/docs/answer/181110
[docs]: https://support.google.com/docs/answer/6033474
[slack]: https://slack.com/help/articles/202395258
[hs]: https://knowledge.hubspot.com/import-and-export/understand-the-import-tool
[oneill]: https://designingforanalytics.com/resources/episodes/182-designing-with-the-flow-of-work-accelerating-sales-in-b2b-analytics-and-ai-products-by-minimizing-behavior-change/
[gitlab]: https://handbook.gitlab.com/handbook/product/product-processes/dogfooding-for-r-d/
[stripe]: https://mikebifulco.com/posts/how-stripe-uses-friction-logs
[devrel]: https://devrel.net/guides/an-introduction-to-friction-logging
[sbensu]: https://blog.sbensu.com/posts/friction-logs/
[uxi]: https://uxinsight.org/dogfooding-a-powerful-addition-to-the-user-research-toolkit/
[nng-heur]: https://www.nngroup.com/articles/usability-heuristics-complex-applications/
[nng-8]: https://www.nngroup.com/articles/complex-application-design/
[nng-pd]: https://www.nngroup.com/articles/progressive-disclosure/
[nng-we]: https://www.nngroup.com/articles/workflow-expectations/
[nng-how]: https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/

- Excel keyboard model: [Microsoft Office support][xl] · Sheets paste: [Google][gs]
- Docs suggest mode: [Google support][docs] · Slack ↑-edit + Enter-send: [Slack help][slack]
- HubSpot import/dedup: [knowledge base][hs] · O'Neill quality baseline: [DFA ep. 182][oneill]
- GitLab dogfooding rules: [handbook][gitlab] · Friction logs: [Stripe via Bifulco][stripe] ·
  [devrel.net][devrel] · [sbensu][sbensu] · Limits: [UX Insight][uxi]
- NN/g: [heuristics for complex apps][nng-heur] · [8 design guidelines][nng-8] ·
  [progressive disclosure][nng-pd] · [workflow expectations][nng-we] · [how to run it][nng-how]
