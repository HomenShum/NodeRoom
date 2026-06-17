<div align="center">

# NodeRoom

### A live room where humans and NodeAgents edit together — without clobbering each other.

**Public room chat, a private NodeAgent, and a shared spreadsheet / note / post-it wall —
with a `lock → draft → smart-merge` model so a human and an AI agent edit the same cells
through the same versioned concurrency control.**

`multi-panel room` · `public + private agents` · `composer model picker` · `affected-range lock` · `draft-for-merge` · `per-room traces` · `live Convex + real LLM`

[Why Convex](#why-convex-and-why-not) · [Audience fluency](#audience-world-proof-artifacts) · [Lessons](#lessons-from-building-noderoom) · [Managed locks](#managed-locks-what-to-give-the-agent) · [Multi-user proof](docs/eval/MULTI_USER_COORDINATION_PROOF.md) · [June 2026 target](docs/TARGET_2026_06.md) · [Sequences](#live-collaboration-sequence) · [Harness reasoning](docs/HARNESS_RECURSIVE_REASONING.md) · [Adoption](docs/NODEAGENT_ADOPTION.md) · [Why & HALO](docs/WHY_NODEAGENT_AND_HALO.md) · [Quickstart](#quickstart) · [Agent runtime](docs/AGENT_RUNTIME.md) · [NodeAgent source map](docs/NODEAGENT_SOURCE_MAP.md) · [Agent eval](docs/AGENT_EVAL.md) · [Model eval matrix](docs/eval/MODEL_EVAL_MATRIX.md) · [Feature eval backlog](docs/eval/FEATURE_EVAL_BACKLOG.md) · [Agent wiki](docs/AGENT_WIKI.md) · [Design](docs/DESIGN.md) · [Stack](docs/STACK.md) · [Walkthrough](docs/WALKTHROUGH.md) · [Architecture](docs/ARCHITECTURE.md) · [Diagrams](docs/diagrams/README.md) · [Open gaps](docs/GAPS_NOT_DONE.md)

[Interview notes](docs/INTERVIEW_NOTES.md) · [Over-engineering audit](docs/OVERENGINEERING_AUDIT.md) · [Improvement roadmap](docs/IMPROVEMENT_ROADMAP.md) · [Next priorities](docs/NEXT_STEPS_PRIORITY.md) · [Operating budget](docs/OPERATING_BUDGET.md) · [Audience workloads](docs/AUDIENCE_WORKLOADS.md)

[Deal workplan](#deal-workplan-human-readable-ownership) | [Semantic rebase](#semantic-rebase-compare-reason-swap) | [Research map](#research-backed-design-map)

[Latest Firecrawl capture change](#latest-change-firecrawl-capture-in-convex) | [Convex components](#convex-components-we-reuse) | [Changelog](docs/CHANGELOG.md)

</div>

---

NodeRoom is a collaborative room where a **public room NodeAgent** and your **private NodeAgent**
work alongside humans on a shared spreadsheet, note, and post-it wall. The hard part — and the
point — is that **an agent and a human never silently overwrite each other**: every edit carries a
per-element version (CAS), an agent claims an *affected range* with a lock that makes it read-only
(but still readable as context), a blocked agent **drafts** changes around the lock, and on unlock
the draft **smart-merges** and can never clobber committed work.

The current reasoning direction is also explicit: "Fable-like" recursive context
and multi-frame reasoning are harness capabilities, not provider dependencies.
NodeAgent owns durable frames, context packs, entity/facet cache, OKF evidence,
verification, and managed writes; Omnigent, when used, stays the optional outer
meta-harness for policies, sessions, sandboxing, and model/harness selection.
The smallest adoption proof is runnable with:

```bash
npm run nodeagent:frame:smoke
npm run omnigent:nodeagent:smoke
```

The first command proves the NodeAgent frame runner itself. The second validates
the Omnigent YAML specs, checks that an Omnigent-launched worker is pointed at
the right NodeAgent proof commands, runs the frame smoke, and writes
`docs/eval/omnigent-nodeagent-smoke.json`. If the Omnigent CLI is installed,
use `omni run examples/omnigent/nodeagent-room.yaml` for the outer harness live
check.

## NodeRoom, NodeAgent, And NodeTrace

NodeRoom is the live reference app. It proves the end-to-end product behavior:
shared room state, managed locks, draft/review flows, Convex-backed durable
agent jobs, source-backed evidence, and the Trace Lens UI used by real room
surfaces.

Two public repos are extracted from this app so other teams can adopt the pieces
without copying the whole room:

- [NodeAgent](https://github.com/HomenShum/NodeAgent): the canonical agent
  harness and durable runtime contract. Use it when another app wants the
  frame runner, context packs, verifier receipts, SQLite/Convex adapter shape,
  Omnigent compatibility, and the no-key local dashboard scaffold.
- [NodeTrace](https://github.com/HomenShum/nodetrace): the portable Trace Lens
  UI and SQLite setup. Use it when another app already has an agent runtime and
  only needs Review/Builder trace surfaces, business proof cards, bounded
  runtime rows, and server-gated code ownership.

Update flow is intentional: NodeRoom gets the newest product Trace Lens behavior
first; NodeTrace should mirror the portable subset. The current portable Builder
ownership shape is component, query, mutation, skill, and test ownership behind
a privileged route. `nodetrace` now proves a 125-step QA-agent trace fixture, so
an external team can prompt their coding agent to inject Trace Lens into a demo
without adopting NodeAgent.

It runs in **two modes from the same code**:

- **No keys** — a deterministic in-memory engine + scripted agents. `npm run demo` / `npm run dev`.
- **Live** — a real **Convex** backend (reactive, optimistic) + a server-side model-routed LLM
  agent selected by `AGENT_MODEL`. Routes are promoted by ladder evidence, not provider brand.
  Verified end-to-end: the agent locks → CAS-edits → releases on real infra and the UI
  syncs reactively.

## Latest Change: Firecrawl Capture In Convex

The latest server-agent update makes source capture work where it belongs:
inside Convex actions, through a server-only NodeAgent tool registry.

Plain version: NodeRoom now has two capture lanes instead of one overloaded
path. **Firecrawl** is the default Convex action lane for public web evidence:
the agent asks to capture a source, Firecrawl fetches it over HTTP, the
reasoning step extracts structured evidence, and Convex records the result in
the room trace. **Browserbase** stays available for exact-browser workflows,
walkthrough recording, and pixel/box evidence, but it is not imported by the
browser-safe tool registry.

Why this matters:

| If we do not split the lanes | With the Firecrawl adaptation |
|---|---|
| Browserbase/Playwright-style dependencies can leak into browser or Convex bundles that should stay simple. | The browser-safe tools stay small; Convex runners import a server-only registry. |
| A server agent may fail before it can capture the source it needs for a finance or GTM claim. | A Convex action can call `capture_source` through Firecrawl and persist source-backed evidence. |
| The architecture is hard to explain: one capture path tries to be browser UI, server action, and worker automation all at once. | The rule is clear: Firecrawl for Convex HTTP capture; Browserbase for external exact-browser capture. |
| Trace evidence is inconsistent because capture is optional or text-only. | Captures record URL, title, extracted data, and step metadata back through the NodeAgent room port. |

Tracked in [`docs/CHANGELOG.md`](docs/CHANGELOG.md) and implemented by
`SERVER_PRODUCTION_ROOM_TOOLS` plus
`src/nodeagent/skills/search/captureSourceFirecrawlTool.ts`.

<div align="center">

![NodeRoom — the live 4-panel room after the real agent filled the variance column](docs/screenshots/live-room-after-agent.png)

<sub>Legacy capture from the pre-migration MVP four-panel shell. The shipped shell now follows the June 2026 target roles: <b>Room/Deal Binder</b> + <b>Work Surface</b> + <b>Copilot</b> + <b>Signal Tape</b> + <b>Status Strip</b>. The production matrix keeps the remaining live/Gemini/source-split proof gates visible until the media is recaptured.</sub>

</div>

<div align="center">

### The headline, shown literally — two clients, one room, live

</div>

A change in one client appears in the other **with no refresh**, and a **server-led agent**'s work reaches **every** client. Captured **multi-pane** — one browser context per client — with the [`feature-walkthrough-gif`](https://github.com/HomenShum/feature-walkthrough-gif#live-collaboration-multi-pane) skill (a single cursor can't show cross-client sync; this can). Two angles:

**The busy shared room.** In the live `Q3DEMO` room (with dozens of real guests already present): a human chat message syncs A→B, then `@nodeagent reconcile Q3 revenue` runs and its result broadcasts to all — authentic, amid real concurrent activity. The older fresh-room side-by-side clip is retired from the README until it is re-captured at a more legible zoom; Gemini 3.5 Flash marked it `fix-then-publish` for small text.

![Busy shared room, two clients side by side: a chat message syncs from Client A to Client B, then an @nodeagent run reconciles the sheet and broadcasts to both](docs/walkthroughs/two-client-live-sync.gif)

<sub>Both: <b>independent</b> browser clients (separate Convex sessions) side by side; sync is Convex reactive <code>useQuery</code>, the agent is server-led (<code>internalMutation</code> + scheduler) so its writes land on every client at once. A single-cursor screen capture can show neither — multi-pane is the only honest way to film a collaborative app.</sub>

## Diagrams — how it fits together

Three views of the system — editable sources + SVG/PNG in [`docs/diagrams/`](docs/diagrams/README.md), authored with the [drawio-skill](https://github.com/Agents365-ai/drawio-skill).

**System architecture** — one reactive Convex ledger sits under both the React UI and the NodeAgent engine; humans and agents write the same versioned cells through one CAS contract.

![NodeRoom system architecture](docs/diagrams/01-architecture.png)

**The no-clobber wedge** — the headline mechanism. A stale write comes back as *data*, never a silent overwrite: per-element CAS, `lock → draft → smart-merge`, review-mode proposals, and an append-only trace.

![The no-clobber wedge](docs/diagrams/02-no-clobber-wedge.png)

**Startup-diligence war room** — the end-to-end demo arc: people ask → self-directed agents research with cited sources → findings stream into one shared sheet (no-clobber) → runway forecast → hand-off drafts.

![Startup-diligence war room flow](docs/diagrams/03-diligence-war-room.png)

---

## Watch it work — live walkthroughs

**Try it yourself → [noderoom.live](https://noderoom.live)** — join with a room code or start a
room; no account needed. **Status: live beta** on a dev Convex deployment. Production-readiness is
tracked **gate by gate** in [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md): the
no-clobber spine, agent reliability, and the public-app abuse surface (prompt-injection fencing,
join rate-limits + caps, cumulative daily spend cap, telemetry retention) are **proven by tests**;
OpenRouter's live data policy, rate-limiting + lock fencing under real concurrency, and cron SLA are
**honestly marked "needs a live audit,"** which is what keeps "beta" on
([`docs/GAPS_NOT_DONE.md`](docs/GAPS_NOT_DONE.md) has the narrative).
One privacy note before you bring real data: the **Free** route in the model picker uses community
free-tier models whose providers may log prompts — keep sensitive GTM/finance figures out of Free
runs (the paid/adaptive lanes do not use those routes by default).

Every clip below is a **captured walkthrough of the real running app UI** - not a staged hero
shot. Live-provider clips use noderoom.live + Convex; deterministic clips are explicitly marked
and use the same browser UI in memory mode so the walkthrough is stable enough to teach. You see
the empty state, the cursor glide to each click (with a ripple), the loading state, and the
result, with step captions and a progress bar. Regenerate any time with `npm run walkthroughs`
(capture) + `npm run walkthroughs:render`.

### Flagship: Startup diligence war room
![Startup diligence war room: agents research, chart runway, preserve human edits, and prepare handoff drafts](docs/walkthroughs/startup-diligence-war-room.gif)
<sub>Deterministic memory-mode walkthrough of the startup-diligence product story: CardioNova intake, a five-company banking watchlist, concurrent research/finance/review lanes, cited cells, runway/milestone work, no-clobber proof, private banker lane, and draft-only downstream handoff. This is the flagship product walkthrough; live-provider proof is tracked separately in [`docs/eval/startup-diligence-war-room-live.md`](docs/eval/startup-diligence-war-room-live.md).</sub>

### Live startup room join
![Fresh startup diligence room with teammates joining by code](docs/walkthroughs/startup-diligence-live-join.gif)
<sub>Live Convex walkthrough: a fresh Startup Banking Diligence War Room is created, the room code is shared, Priya joins to bulk-run CardioNova plus the startup-banking list, and Alex joins to own runway/milestone questions. This proves the live create/join/multi-user room shell; the richer agent package above is intentionally deterministic until the live provider eval is fully green.</sub>

### Join a live room & chat
![Join a live room and chat — walkthrough](docs/walkthroughs/chat.gif)

### Edit the sheet — and take it back (Undo / Ctrl+Z)
![Spreadsheet edit and undo — walkthrough](docs/walkthroughs/sheet-undo.gif)

### Mention the Room NodeAgent to do the work (`@nodeagent`)
![@nodeagent reconcile drives the sheet through chat](docs/eval/workflow-previews/app-ask-reconcile.gif)

### Multi-agent work queue (`/demo multi-agent`)
![Multi-agent work queue: one prompt splits into concurrent agent lanes with claims, streams, batched commits, and final proof](docs/walkthroughs/multi-agent-workbench.gif)
<sub>Deterministic memory-mode walkthrough of the same UI contract: one burst prompt fans out into
TAT-DQA arithmetic, FinanceBench citation QA, SEC XBRL watchlist fill, and a NodeRoom no-clobber
overlay. The proof board uses public-source gold answers and visible validators; this is media
evidence for the workbench interaction, not a live-provider parser proof.</sub>

### GTM research import — updates, never duplicates
![CRM-style research import upsert — walkthrough](docs/walkthroughs/research-upsert.gif)

### Review mode — approve agent edits at the cell
![Review-mode inline proposal approve — walkthrough](docs/walkthroughs/review-approve.gif)
<sub>Live run, real LLM: with auto-allow off the agent's writes become inline proposals you approve at the cell. (Capturing this walkthrough originally exposed a real agent bug — the model was never told review mode existed and either burned its budget or quit without writing; fixed with a room-policy briefing + two harness guards. See <code>docs/dogfood/FRICTION_LOG.md</code>.)</sub>

<sub>Method: Playwright drives the live app through a versioned spec
([`scripts/walkthroughs/specs.ts`](scripts/walkthroughs/specs.ts)), captures clean per-state frames +
cursor targets into `remotion/walkthrough.data.js`, and a Remotion composition overlays the animated
cursor, captions, and progress bar. Packaged as a reusable skill:
[`.claude/skills/readme-walkthroughs`](.claude/skills/readme-walkthroughs/SKILL.md).</sub>

### Watch the narrated episodes (click a poster — plays in your browser, with sound)

Two rendered explainers are linked below, assembled from the live captures above + real code
panels, an animated mental-model diagram, and ElevenLabs narration. Current batch media QA is
tracked in `docs/eval/MEDIA_JUDGE.md`; it is publishing evidence for the assets, not a replacement
for production gates.

| The builder story (58s) | The two-stacks story (50s) |
|---|---|
| [![I tried to make a demo GIF — it turned into a multiplayer AI workspace](episodes/noderoom-live-collab-v1/poster.jpg)](https://noderoom.live/episodes/noderoom-live-collab-v1.mp4) | [![I built it on Streamlit first — then the demo needed a second user](episodes/stack-before-after-v1/poster.jpg)](https://noderoom.live/episodes/stack-before-after-v1.mp4) |
| Naive agent clobbers a human → the code that fixes it → review mode live | The REAL Streamlit baseline (ParselyFi) → where typical stacks structurally stop → the same workflow in a live room |

The investment-room episode is retired from the README showcase until it is
re-rendered in landscape; Gemini 3.5 Flash marked the portrait render
`fix-then-publish` because desktop spreadsheet text was too cramped.

**Media QA.** The tracked README GIFs, workflow previews, and episode renders are
now batch-judgeable with Gemini video understanding: `npm run
media:gemini-judge -- --all`. GIFs are converted to temporary MP4 with ffmpeg,
then each asset gets a concrete verdict for clarity, visual design, consistency,
evidence quality, legibility, and professional-workflow relevance. Use
`--include-ignored` only when intentionally judging local capture intermediates.
Latest aggregate:
[`docs/eval/MEDIA_JUDGE.md`](docs/eval/MEDIA_JUDGE.md).

## Workflow Skill Previews

HALO is only useful if it changes the actual user-agent interaction, not just a
score file. Each workflow below has a visual preview, the user contract it must
preserve, and the eval/trace evidence that gates promotion. Refresh trace
previews with `npm run workflow:previews`, or refresh both trace previews and
real DOM captures with `npm run workflow:previews:all`. Evidence levels are
explicit: `render-workflow-preview.ts` produces trace replays, and
`workflow:app-previews` captures the real DOM in memory mode. A GIF is visual
evidence, not a production gate. Full evidence and research links:
[`docs/WORKFLOW_PREVIEWS.md`](docs/WORKFLOW_PREVIEWS.md).

### How these demos are judged

Every shipped GIF is gated by a **gemini-3.5-flash vision judge** (`npm run qa:gif`) that
decodes the shipped `.gif` itself — exact frames + real per-frame delays — and scores five
dimensions 0–10: **readability** (every label legible?), **pacing** (can a first-time viewer
follow each change?), **narrative completeness** (goal → actions → verified result?),
**visual polish** (nothing overlapping or misaligned?), and **honesty** (no glitches or UI
claiming work that isn't shown). Pass bar: **average ≥ 7, no dimension < 5**. The judge is
prompted adversarially, so read 7–8 as ship-quality, 9+ as exceptional, 5–6 as specific named
defects, < 5 as structural.

The full methodology — including **frame-level evidence** of what failing scores look like
(the literal-`null` cell bug the judge caught in the real app, before/after; the L3 conflict
story it forced us to rebuild) and the current per-dimension scoreboard — is in
[`docs/eval/GIF_JUDGE.md`](docs/eval/GIF_JUDGE.md). Verdicts with the judge's exact
frame-cited issues live in `docs/eval/gif-judge/`.

The earlier screenshot-slideshow previews were retired after this judge found structural
honesty defects (frames from different sessions, reversed narratives); the replacements are
recorded from the REAL app UI driven by the real agent runtime in memory mode
(`e2e/capture-previews.spec.ts`).

### Public `@nodeagent` Spreadsheet Reconciliation

![@nodeagent reconcile drives the sheet through chat](docs/eval/workflow-previews/app-ask-reconcile.gif)

User types `@nodeagent reconcile Q3 revenue`; the public chat composer can pin that
request to the adaptive lane, free-auto, top-paid, or a specific model policy.
The Room NodeAgent creates/reuses an `agentJobs` root, locks exact cells, reads
versions, writes with CAS, releases, and leaves visible room trace receipts.

### GTM Research Enrichment

![GTM research enrichment (real app)](docs/eval/workflow-previews/app-research-enrich.gif)

User adds or requeues accounts, then the agent enriches only pending/stale rows
with source-backed `CellPayload` values, CRM fields, citations, and freshness.

### Deal Workplan: Human-Readable Ownership

Traces prove what happened. The deal workplan should explain what matters now.
This is the target product layer above `agentJobs`, room traces, review rounds,
and managed lock/CAS writes: a human-readable operating plan for the shared room,
not a replacement for the ledger.

The workplan contract:

- Track deliverables as a tree: workbook tabs, memo blocks, decks, notes, wall
  decisions, source packs, and benchmark/eval artifacts.
- Attach an owner, status, review round, source evidence, privacy boundary, and
  next action to each deliverable or section.
- Separate verified source facts, manual claims, model proposals, open
  questions, and client/senior feedback.
- Produce email-style updates for seniors and collaborators: what changed, what
  is blocked, what needs review, and what evidence supports the recommendation.
- Keep the human accountable. Agents can propose work and explain traces; the
  room still shows who approved client-facing meaning.

This keeps the README honest: the current runtime already proves lock/CAS,
drafts, proposals, traces, and algorithm patch bundles. The deal workplan is the
next contract that makes those receipts legible to finance, GTM, and operator
workflows.

### Grounded Wiki And Note Update

User asks for a room summary; the NodeAgent discovers artifacts, reads the
source sheet, writes a grounded note/wiki update, and keeps private context out
of public surfaces unless promoted. *(Preview remains retired: Gemini 3.5 Flash
accepted the UI navigation capture as honest, but correctly rejected it as not
showing the grounding action itself. The contract is tested; the demo needs a
native grounded-update flow before it is README-ready.)*

### Proposal Review And Wall Collaboration

![Review mode: agent edits arrive as proposals](docs/eval/workflow-previews/app-proposals-review.gif)

With Auto-allow off, agent writes become host-reviewed proposals. Wall edits and
approvals stay versioned artifact mutations with conflicts surfaced in the UI.

### Long-Running Free Route Job And HALO Handoff

User selects **Free** in the model picker and mentions `@nodeagent`; the same
`agentJobs` contract shows status, attempts, details, traces, receipts, and the
HALO regression handoff evidence. `/free` remains a hidden compatibility alias,
not the taught UX. *(Preview retired pending a judged real-app recording; the
contract is tested in `tests/agentJobsRuntime.test.ts` and the L7 RESUME rung.)*

### Finance Model Solve

![Finance model solve](docs/eval/workflow-previews/finance-model-solve.gif)

User uploads a three-statement modeling test and asks NodeAgent to solve it.
The eval seeds the `Your Model` sheet, locks the critical forecast cells, reads
versions, writes linked formulas through CAS, releases the lock, and grades the
final artifact plus trace against a gold oracle. The GIF above is a committed
synthetic trace replay so the media can stay public; the private workbook runs
locally and its answer-key formulas never enter the agent's context or the repo
(`evals/financeModelLive.ts`; content-based leakage gate). The private live
proof is the redacted summary in `docs/eval/finance-model-live.json`.

**The live scoreboard is the point, and it's honest:** the full-solve champion
claim is a **measured reliability batch, not a best run**.
`deepseek/deepseek-v4-flash` passed **5/5 model-owned runs** of the full
private-workbook lane (16/16 linked forecast cells each, lock → read →
CAS-write → release, no answer-key leakage) **across three room variants** —
clean room, a room salted with distractor artifacts that reuse the target cell
ids, and a concurrent human edit landing mid-run (the human's cell survives;
their write into the locked range is rejected). Median 105.0s, p95 $0.1068/run,
$0.4424 total, zero provider-owned failures
(`docs/eval/finance-model-live.json`, attempt-by-attempt ledger included; the
claim goes stale-red in CI 30 days after `generatedAt` — `npm run
proofs:staleness`). The free route `nex-agi/nex-n2-pro:free` is promoted only
through the income rung for now (6/6 in 74.1s at $0); its full rerun hit an
OpenRouter invalid-JSON provider failure after lock/read — recorded as
`failureOwner: provider`, not a model failure, and not a promotion.

The HALO ladder also renders trace-replayed skill previews from real ladder JSON
(`l1-read` through `l6-long-horizon`) in `docs/eval/workflow-previews/`, so a
workflow change has a small visual proof, not only a text score.

### Managed Locks: What To Give The Agent

The first lock/CAS evals intentionally made the model call `propose_lock -> edit_cell -> release_lock` so we could prove it understood the collaboration protocol. Production should not keep paying for that once the invariant is proven. The production bundle now exposes `write_locked_cells` / `write_locked_cell_results`: the model supplies target cells, values/formulas/evidence, and base versions; the runtime acquires the range lock, writes with CAS, drafts if blocked, releases in `finally`, and returns coordination evidence.

| Lane | Evidence | Model calls | Agent tool calls | Model-visible lock calls | Tool trace |
|---|---:|---:|---:|---:|---|
| Explicit lock tools | deterministic runtime | 7 | 6 | 2 | `propose_lock -> read_range -> edit_cell -> read_range -> edit_cell -> release_lock` |
| Runtime-managed lock | deterministic runtime | 3 | 2 | 0 | `read_range -> write_locked_cells` |
| Explicit lock tools | live `deepseek/deepseek-v4-flash` | 5 | 5 | 2 | `read_range -> propose_lock -> edit_cell -> edit_cell -> release_lock` |
| Runtime-managed lock | live `deepseek/deepseek-v4-flash` | 4 | 3 | 0 | `read_range -> write_locked_cells -> read_range` |

The safety invariant did not move to the model: `tests/managedLockTools.test.ts` injects a human write during the managed write and proves it is blocked while the runtime-held lock is active. `npm run eval:multiuser-coordination` extends that to a multi-actor proof: human-vs-human same-cell edits converge with one winner and one CAS conflict, target writes are blocked, non-target peer writes continue, stale bases conflict, blocked second agents draft, and every path releases its lock. The eval artifacts are [`docs/eval/managed-lock-performance.json`](docs/eval/managed-lock-performance.json), [`docs/eval/managed-lock-performance-live.json`](docs/eval/managed-lock-performance-live.json), [`docs/eval/multi-user-coordination-proof.json`](docs/eval/multi-user-coordination-proof.json), [`docs/eval/MANAGED_LOCK_PERF.md`](docs/eval/MANAGED_LOCK_PERF.md), and [`docs/eval/MULTI_USER_COORDINATION_PROOF.md`](docs/eval/MULTI_USER_COORDINATION_PROOF.md).

**Rule of thumb:** give the agent business intent, target cells, formulas/values/evidence, and base versions. Take away lock acquisition, unlock sequencing, range coordination, draft-on-blocked mechanics, and release cleanup. Deterministic coordination belongs in the harness.

### Algorithm Artifacts: Learn Like AI, Run Like Code

The next tool-contract lesson is the same one artifact systems teach for
generated UI: model output should become a durable artifact the runtime can
inspect and rerun, not a one-off answer. For NodeRoom spreadsheets, the artifact
is a deterministic calculation plan.

`run_algorithm_artifact` now lets the model submit a narrow
`spreadsheet_formula` artifact with named input cells, output cells, formula-DSL
expressions, deterministic constraints, and small fixtures. The runtime reads
the current versioned cells, validates the artifact, runs the fixture tests,
materializes evidence-bearing `CellPayload` patches, and returns a patch bundle
plus ready-to-pass `write_locked_cell_results` arguments. It does **not** commit.
The managed write tool still owns lock, CAS, proposal/review, draft behavior, and
trace evidence.

The checked proof is [`docs/eval/algorithm-artifact-smoke.json`](docs/eval/algorithm-artifact-smoke.json):
`revenue_variance_pct_v1` computes `(q3 - q2) / q2` from source cells, passes its
fixture, writes `+24.0%` through `write_locked_cell_results`, preserves the
formula on the resulting `CellPayload`, and attaches three evidence entries
(algorithm proof plus two source-cell refs). `tests/algorithmArtifacts.test.ts`
also proves deterministic rerun on a changed snapshot, managed-write application,
and rejection of unknown identifiers or non-deterministic constraints.

This is intentionally L1/L2 only: formula/DSL artifacts. Convex persistence,
artifact promotion/version UI, workbook-wide runtime adapters, and any sandboxed
code lane remain tracked gaps. The product rule is stricter now: high-stakes
calculation work should be authored by AI when useful, but committed only after a
deterministic runner turns it into auditable patches.

### Where the walkthroughs go next

The clip set expands along the **six user → agent interaction modes** from the
[eval checklist](docs/AGENT_EVAL.md) — every mode that earns a passing eval
earns a captured walkthrough, in this order:

1. **Teach me (Guide mode)** — the agent coaches a student through the model
   with **zero writes to answer cells**; the clip shows hints landing while the
   sheet stays agent-untouched (restraint is the visual).
2. **Modeling test · Collaborate** — agent + two humans split IS/BS/CF under
   range locks; drafts smart-merge on release across shared linkage rows.
3. **L7 RESUME live** — slice death mid-job, a human revises a cell while the
   agent is dead, the cold continuation finishes only what remains.
4. **File-drop ingestion** — a 10-K PDF + XLSX dropped into the room becomes a
   cited sheet (plus the receipts → expense-report variant).
5. **Sensitive-query guardrail** — the private agent declining specific
   financial advice *with a stated reason* (the discretion clip).
6. **Spend-cap breach attribution** — `global_monthly_spend_cap:rooms=N`
   rendered as the growth-vs-runaway diagnosis it encodes.

## Audience-World Proof Artifacts

NodeRoom's distribution story should not be "look at this AI workspace." The stronger proof is:
**here is what happens when high-trust teams need to coordinate research, decisions, documents,
spreadsheets, advisors, and AI without losing discretion, accuracy, provenance, or control.**
That matters for GTM sales teams and finance/banker workflows, and it matters even more for
private-client contexts where the buyer recognizes the operating texture before they trust the
software.

The repo now treats that as an eval surface, not marketing copy:

- Audience research lives in [`episodes/_audiences/`](episodes/_audiences/). The current canonical
  lane is [`family-office.yaml`](episodes/_audiences/family-office.yaml), which captures values,
  repeated questions, recognizable artifacts, product mappings, trust signals, and source notes.
- The reusable agent contract is [`docs/skills/audience-fluency/SKILL.md`](docs/skills/audience-fluency/SKILL.md):
  audience research → client-world map → scenario translation → lexicon mining → trust-signal check
  → cultural-fluency eval.
- The first affluent/private-investment scenario is
  [`episodes/private-investment-room-v1/brief.md`](episodes/private-investment-room-v1/brief.md):
  a private investment team preparing for an IC meeting, where the product proof is not "AI fills
  cells" but "who changed what, from which source, and what can the principal safely review?"
- The already-rendered generic engineering explainer is
  [`episodes/noderoom-live-collab-v1/report.md`](episodes/noderoom-live-collab-v1/report.md), with
  Gemini video-understanding judge evidence at
  [`episodes/noderoom-live-collab-v1/judge.md`](episodes/noderoom-live-collab-v1/judge.md).

Run `npm run content:fluency:check` to keep this layer honest. Current status is **yellow**:
the audience context, private-investment brief, rendered episode, and Gemini
media judge are present, but content-fluency/trust-signal review and current
media judge defects still need to be closed before it can be called
production-proven.

### Research-Backed Design Map

Every source below maps to a specific product consideration. This table is a
design contract, not a runtime-completeness claim: it states what NodeRoom should
preserve and which failure mode the research warns against. The local citation
audit is [`docs/synthesis/CITATION_LEDGER.md`](docs/synthesis/CITATION_LEDGER.md);
the finance-spreadsheet row uses `MBABench` because the repo audit corrected the
earlier `WorkstreamBench` shorthand.

| Source | Exact consideration | NodeRoom feature or invariant | Without it | Expected with it |
|---|---|---|---|---|
| [BankerToolBench](https://arxiv.org/abs/2604.11304) | End-to-end investment-banking deliverables are multi-file, rubric-scored, and judged for client readiness. | Deal workplan, package-level deliverables, expert-review gates, no false "done". | A model can produce a plausible sheet or memo while the package is not client-ready. | Workbook, memo, deck, source pack, and review status are tracked together with explicit blockers. |
| [MBABench](https://arxiv.org/abs/2605.22664) | Finance spreadsheets need Accuracy, Formula, and Format quality, not just final numbers. | Spreadsheet evals split numeric correctness, formula preservation, and layout/format checks. | A result can be numerically close but unmaintainable or visually unusable. | The review surface shows whether each artifact is accurate, formula-safe, and editable. |
| [BlueFin](https://arxiv.org/abs/2605.30907) | Professional finance spreadsheets need granular rubrics, expert-aligned judging, and dynamic correctness. | Workbook-scoring rubrics, formula-result packaging, dynamic validation, expert-style failure reasons. | A package hash or one static oracle hides why the workbook fails. | Reviewers see which cells, formulas, assumptions, and deliverable criteria passed or failed. |
| [Finch / FinWorkBench](https://arxiv.org/abs/2512.13168) | Enterprise finance work is messy, cross-file, multimodal, and long-horizon. | Cross-artifact workplan, source/evidence graph, PDF/XLSX/email-style context, checkpoints. | The product only works on clean demo sheets and loses real version-history context. | Agents work from bounded context capsules across files while preserving provenance and review state. |
| [APEX-Agents](https://arxiv.org/abs/2601.14242) | Professional-service tasks span applications, files, rubrics, gold outputs, and realistic work environments. | Long-running `agentJobs`, workplan ownership, multi-artifact task packs, budgeted execution. | A chat demo looks good but cannot carry a real analyst task to completion. | Each task has files, allowed tools, status, deliverables, budget, and acceptance evidence. |
| [SpreadsheetBench](https://arxiv.org/abs/2406.14991) | Real spreadsheet manipulation involves forum-like ambiguity, varied workbook structure, and robust test cases. | SpreadsheetBench staging, agent workspaces, formula-result packaging, official-readiness gates. | Synthetic tasks overstate ability and miss brittle range/layout behavior. | Benchmarks run against real workbook shapes with isolated input/gold boundaries. |
| [SheetAgent / SheetRM](https://arxiv.org/abs/2403.03636) | Planning, retrieval, and iterative correction improve long-horizon spreadsheet manipulation. | `search_sheet_context`, planner-style room tools, retryable patches, reflection through trace evidence. | The model reads a huge sheet dump and guesses. | The agent narrows context, plans ops, retrieves related ranges, and repairs failed attempts. |
| [SpreadsheetAgent](https://arxiv.org/abs/2604.12282) | Localized, multimodal structural sketches beat loading the whole workbook at once. | Spreadsheet semantic index, surrounding-cell capsules, visual/package chart checks. | Important layout semantics are flattened into plain text. | Conflict packets and tool calls carry nearby cells, layout, formulas, and visual context. |
| [SheetBrain](https://arxiv.org/abs/2510.19247) | Neuro-symbolic execution plus validation is safer than prose-only spreadsheet reasoning. | Algorithm artifacts, deterministic runners, validation before managed writes. | The model writes confident calculations that are never rerun. | Formula work is executed, fixture-tested, and converted to auditable patch bundles. |
| [SheetMind](https://arxiv.org/abs/2506.12339) | Manager/action/reflection decomposition and grammar-like commands make spreadsheet automation inspectable. | Structured ops, `PlanPreview`, schema-validated patch bundles, reviewable commands. | Freeform text patches are hard to validate or approve. | Users and validators inspect typed operations before commit. |
| [Semantic Commit](https://arxiv.org/abs/2504.09283) | Semantic conflicts need impact analysis and local review before AI rewrites global state. | Semantic conflict packets, local resolution UI, review proposals. | The app offers only "yours or theirs" or lets AI rewrite too much. | Users inspect base/current/proposed state, evidence, and impact before accepting a merge. |
| [Merge-Bench](https://arxiv.org/abs/2605.25890) | Even strong LLMs do not reliably solve all merge conflicts. | Human-review tiers, no unconditional LLM auto-commit, final CAS after resolution. | LLM merge suggestions silently overwrite professional work. | Risky resolutions become proposals; safe ones still pass validators and CAS. |
| [Rover](https://arxiv.org/abs/2605.17279) | Conflict resolution improves when the model receives dependency-aware context. | Formula dependency graph, surrounding cells, comments, trace summaries, source refs in the conflict packet. | The resolver judges one cell in isolation. | The resolver sees the cells, formulas, sources, and downstream outputs affected by the change. |
| [Harness-Bench](https://arxiv.org/abs/2605.27922) | Agent capability should be reported at the model-plus-harness configuration level with traces, artifacts, usage, and validators. | Model eval matrix, HALO traces, managed tool contracts, cost and validator reports. | A base-model leaderboard hides tool/runtime effects. | Reports name the route, harness, budget, artifacts, trace shape, validators, and cost. |
| [Claw-SWE-Bench](https://arxiv.org/abs/2606.12344) | Adapter and harness design can swing scores dramatically under the same model. | Managed lock tools, adapter contracts, route promotion by workflow lane. | The team blames or praises the model for harness behavior. | NodeRoom promotes the cheapest model that is safe in this exact runtime. |
| [WildClawBench](https://arxiv.org/abs/2605.10912) | Native-runtime, long-horizon tasks expose failures hidden by mock APIs. | Real Convex/live-app captures, Docker/native-runtime probes, long-running `/free` jobs. | Demos pass in toy sandboxes and fail in the deployed room. | Walkthroughs and evals run through real UI/runtime paths when the claim depends on them. |
| [HAL](https://arxiv.org/abs/2510.11977) | Agent evals need standardized, cost-aware infrastructure and log inspection. | HALO loop, cost-quality matrix, trace ledgers, regression handoff evidence. | A single score masks cost, lucky behavior, and benchmark-search shortcuts. | Promotion requires cost, traces, validators, and failure attribution. |
| [AgentLens](https://arxiv.org/abs/2605.12925) | Passing final tests can hide chaotic or lucky trajectories. | Trace-stage quality checks, workflow previews, process evidence, not just final cell state. | A lucky pass is counted the same as disciplined work. | The trace must show exploration, implementation, verification, and cleanup in the right order. |
| [AI Agents That Matter](https://arxiv.org/abs/2407.01502) | Agent evaluation must jointly optimize accuracy, cost, standardization, and holdout integrity. | Cost gates, route ladders, contamination checks, reproducible scripts. | The most expensive route wins by default and benchmark shortcuts survive. | The cheapest safe route wins per workflow, with reproducible eval evidence. |
| [Agentic Harness Engineering](https://arxiv.org/abs/2604.25850) | Harness evolution needs component, experience, and decision observability. | HALO improvement loop, falsifiable harness changes, trace-derived fixes. | Prompt tweaks accumulate without knowing what worked. | Every harness change names the component, expected effect, trace evidence, and outcome. |
| [Search-Time Data Contamination](https://arxiv.org/abs/2508.13180) | Search agents can retrieve benchmark questions and answers during evaluation. | Benchmark source blocking, contamination scans, agent/evaluator workspace separation. | A research agent wins by finding the answer key online. | Agent-facing files exclude gold/rubric/canary data and leakage is scanned before claims. |
| [SWE-Bench+](https://arxiv.org/abs/2410.06992) | Solution leakage and weak tests can inflate benchmark scores. | Hidden gold, stronger validators, candidate-before-evaluator trajectory checks. | Passing tests are treated as proof even when the issue leaks the solution. | Reports distinguish candidate generation, evaluator access, weak-test risk, and true pass evidence. |
| [ImpossibleBench](https://arxiv.org/abs/2510.20270) | Agents may exploit tests or evaluator access instead of solving the task. | No evaluator-file access, answer-key isolation, Docker sandbox probes, exploit-aware policy. | The agent can delete or game tests and still look successful. | Impossible/negative controls expose cheating, and production paths block evaluator-only state. |
| [Linear Agent Interaction Guidelines](https://linear.app/developers/aig) | Agent work should be visible, bounded, interruptible, and native to human workflows. | Deal workplan UX, status strip, owner/reviewer state, bounded questions. | Agents disappear into background work with unclear state. | Users see what the agent is doing, what it needs, and when human review is required. |
| [Linear webhooks and agent sessions](https://linear.app/developers/agent-interaction) | External task systems need webhook-triggered sessions and visible lifecycle state. | Future task sync, workplan updates from issues/review rounds, session state mirroring. | Linear/Jira-style task state drifts away from the room. | Issue events can create/update workplan tasks while room traces remain the source of artifact truth. |

Target workflow expectations:

| Audience workflow | Without this map | Expected NodeRoom behavior |
|---|---|---|
| GTM / sales account research | CRM fields get overwritten, ambiguous matches become guesses, duplicate rows appear, or PII leaks into public summaries. | Sourced enrichment of pending/stale rows, `needs_review` for weak evidence, research upsert, cited `CellPayload`s, and clear eval gates. |
| Chat-first founder or BD lead capture | "Just spoke with X" gets treated as verified fact, capture blocks on perfect identity, or person details become public. | Capture first as private/manual evidence, ask at most one clarifying question, enrich later from public sources, and prevent duplicate rows. |
| Finance / ops spreadsheets | Formula cells become hardcoded, correct cells churn versions, totals lack source rows, or payroll/account data leaks. | Preserve formulas/layout, reconcile bounded cells only, skip already-correct cells, cite source rows, and redact sensitive public output. |
| Banker / finance modeling | Best-run demos overclaim, answer-key leakage contaminates results, formulas and export/reopen fidelity are unproven. | Report solve/guide/collaborate as harnessed proof tiers, keep private gold private, and include model plus harness plus budget plus evaluator. |
| Family office / private wealth IC rooms | Unsourced allocation numbers and private working notes become trust failures, especially if sent to third-party models. | Chain of custody, review-before-mutation, private-draft redaction, evidence-bearing cells, and bounded principal-ready summaries. |
| Founder / advisor collaboration | Counsel, banker, accountant, and agent silently overwrite each other; stuck locks block deadline work. | Affected-range lock, per-element CAS, host-reviewed proposals, host takeover, and trace/status evidence for what changed. |
| Boutique M&A / deal teams | Comps and QoE adjustments lose provenance, working layers leak, concurrent edits corrupt live deal workbooks. | Deal-binder framing, source/proof panes, full operation ledger, no-silent-clobber, and redacted summaries for readouts. |
| Multi-file research and grounded wiki | Agent cites chat instead of artifacts, leaks private files into public traces, or writes unstable wiki sections. | Artifact refs, cited wiki/note updates, public/private boundaries, stable sections, and no private-source leakage. |
| Large-sheet / long-running workflows | A 9,000-row sheet turns into one giant prompt, resumes duplicate writes, or spend is unbounded. | Semantic chunks, checkpoints, resolved-model audit, `/free` as budgeted/experimental, and idempotent resume behavior. |
| Event-led conference / hackathon users | README mistakes bursty free distribution for revenue, or hides cost/bill-shock risks. | Position events as low-cost distribution with spend caps, free-route disclosure, and conversion path to founder/GTM/finance users. |
| Analytics / optimization sheets | Scores become opaque, weights are hidden, units collapse, or personal logs are dumped. | Expose assumptions/weights, cite source columns, preserve unit semantics, and update only dependent outputs. |
| Engineers / eval consumers | README reports raw model scores, cites bad research, or treats catalog proof as runtime proof. | Honest proof tiers, negative controls, route plus harness plus budget reporting, and corrected citations before external claims. |

## Why Convex (and why not)

NodeRoom's entire product is one loop: **human edit → optimistic client store → agent action →
internal mutation → reactive query stream → every screen updates**. Convex is the only piece of
infrastructure in this repo because that loop is exactly what it sells natively: transactional
mutations (serializable OCC), reactive subscriptions over WebSockets, and a scheduler — the
pub/sub, cache-invalidation, and message-broker layers you'd otherwise hand-build. The no-clobber
spine (per-element CAS + affected-range locks + draft-merge) rides *on top* of Convex's OCC; the
database's own concurrency control protects transactions, and the app-level versions protect
*intent* — both layers are needed, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) shows where each one catches what.

**The pedigree is real.** Convex was built by Dropbox infrastructure veterans — Jamie Turner
(ex-Dropbox senior engineering leadership) and James Cowling, the MIT PhD (under Turing-laureate
Barbara Liskov) who architected **Magic Pocket**, the exabyte-scale storage system that moved
Dropbox off S3. They built Convex after a decade of watching every team rebuild the same
sync/invalidation machinery they'd built at Dropbox. The engine is hardened by **deterministic
simulation testing** — the database, message bus, and runtime execute in a single-threaded
simulated sandbox where network drops, clock drift, and write collisions are injected millions of
times, so race conditions are caught deterministically before release.

**And the honest trade-offs** (why it isn't everywhere, and why we accepted them):

| Trade-off | Reality | Why it's acceptable *here* |
|---|---|---|
| Runtime coupling | Schema, transactions, and functions are tied to Convex's engine — no lift-and-shift to raw SQL over a weekend | The engine seams (`RoomTools`, the in-memory `RoomEngine`) keep the collaboration logic portable; Convex is the *port*, not the *spine* |
| OLTP, not OLAP | This is a real-time transactional store; scanning billions of rows for analytics is the wrong tool | NodeRoom is the textbook OLTP case: small hot documents, high-frequency concurrent reads/writes, agents and humans interleaved |
| Enterprise adoption lag | Conservative stacks take a decade to absorb a new paradigm | A spike that exists to prove agent-collaboration patterns should optimize for iteration speed, not procurement checklists |

What this combination unlocks is the category NodeRoom lives in: **AI-augmented collaborative
canvases** — where a background agent's mutation and a human's keystroke flow through the same
transaction log and the same reactive stream, so neither ever waits on (or clobbers) the other.
The same loop powers the adjacent categories — self-healing QA sandboxes where a human corrects a
stuck agent mid-run, and multi-agent operational simulations watched by many operators — without
an enterprise-sized DevOps budget. Full stack rationale: [docs/STACK.md](docs/STACK.md).
Workbook MVP rationale: [docs/architecture/MVP_WORKBOOK_STACK.md](docs/architecture/MVP_WORKBOOK_STACK.md).

## Convex Components We Reuse

NodeRoom uses Convex components authored outside this repo as durable
infrastructure, not as a replacement for the NodeAgent collaboration harness.
The official component model is useful here because each component is an
isolated mini-backend: it cannot read NodeRoom tables or call NodeRoom functions
unless we explicitly wire that access.

| Component | What it gives us | How NodeRoom adapts it |
|---|---|---|
| [`@convex-dev/workflow`](https://www.convex.dev/components/workflow) | Durable multi-step functions with persisted state, delays, retries, cancellation, and reactive status. | Long agent jobs run as slices, but `agentJobs` stays the user-facing source of truth. Workflow ids are runtime metadata. |
| [`@convex-dev/workpool`](https://www.convex.dev/components/workpool) | Queues for actions/mutations with parallelism limits, backoff, jitter, and completion callbacks. | Background agent slices go through the named `agentWorkpool` so slow routes do not become unbounded server fan-out. |
| [`@convex-dev/persistent-text-streaming`](https://www.convex.dev/components/persistent-text-streaming) | Streaming text chunks that are also persisted to Convex for recovery and later reads. | Private text replies can stream; spreadsheet/note/wall writes still go through CAS, proposals, and evidence-bearing tools. |
| [`@convex-dev/agent`](https://www.convex.dev/components/agent) | Agent threads, vector search, and long-running workflows for Convex-native agents. | Researched as an adjacent reference, but not the canonical runtime. NodeAgent keeps custom locks, CellPayload evidence, trace receipts, model routing, and spreadsheet-safe mutation policy. |

In plain language: the Convex components give NodeRoom durable plumbing. They
do not decide what an agent is allowed to edit. That decision stays in
NodeAgent, where the app can enforce no-clobber locks, versioned cell writes,
budget policy, evidence rules, and review-mode proposals.

## Lessons From Building NodeRoom

This repo is intentionally written as a learning artifact, not just a runnable
demo. The main lesson from iterating on NodeRoom is that useful professional AI
systems are mostly **harness engineering and context engineering**. The model is
allowed to reason and propose; bounded tools own mutation, versions, permissions,
traceability, file evidence, budgets, and recovery. That is the through-line from
the first lock/CAS spreadsheet demo to the current GTM, finance, file parsing,
long-running job, and QA matrix work.

The professional workflow review changed the project. A local corpus of 70
spreadsheet files became the eval backlog: 23 CSVs, 47 XLSX files, 46
GTM/company-research files, 11 finance/ops files, 47 header-level PII signals,
16 formula-bearing workbooks, and 18 merged-cell workbooks. Private rows were
not committed; the durable artifact is the workflow shape. See
[`docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md`](docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md)
and [`evals/professionalWorkflows.ts`](evals/professionalWorkflows.ts).

### What The Professional Files Taught

| Workflow | User job | Harness lesson |
|---|---|---|
| GTM sales / company research | Upload PitchBook, ParselyFi, JPM, sector-tagging, and AMO-style lists **or start from chat**: "just spoke with X at startup Y" / "company Y just raised $Z"; classify, enrich, create/update watchlists, preserve CRM fields, and cite sources. | Do not let the agent write loose text. ENRICH / CLASSIFY / RESOLVE writes need `CellPayload` values with status, confidence, and evidence; chat claims stay `manual` evidence until verified by fetched or artifact sources. |
| Finance / banker workflows | Upload spend exports, transaction files, timecards, timesheets, and income/expense templates; reconcile or populate bounded cells. | Preserve formulas and layout, skip already-correct cells, cite source rows, and mask sensitive values in public output. |
| Parser and document workflows | Work across CSV/XLSX plus PDFs, Office files, screenshots, OCR, and layout/bounding boxes. | Keep raw room files canonical; provider file ids are cache metadata. Provider extraction and LiteParse-style local parsing both normalize into evidence-bearing artifacts. |
| Long-running research / ops | Run slow free models, bulk classification, and multi-file enrichment past one action window. | Split work into budgeted slices, compact context, checkpoint state, record attempts, and resume through durable jobs rather than trusting one giant call. |
| Interview / QA workflows | Explain exactly what the agent did and how it was verified. | Treat traces, wiki updates, evals, and the QA matrix as product surfaces, not afterthoughts. |

### How The Agent Harness Evolved

1. **Prompt wrapper -> agent harness.** `src/nodeagent/core/runtime.ts` is a bounded loop:
   context -> one model step -> validated tool calls -> tool results -> repeat.
   The three seams in [`src/nodeagent/core/types.ts`](src/nodeagent/core/types.ts) are model,
   tools, and `RoomTools`, so the same loop runs with a scripted model,
   in-memory engine, live Convex backend, and provider routes.

2. **Static prompt -> protocol plus just-in-time context.**
   [`src/nodeagent/models/prompts/systemPrompt.ts`](src/nodeagent/models/prompts/systemPrompt.ts) carries the rules:
   look first, claim exact ranges, edit with the version read, release, and
   narrate. [`src/nodeagent/core/worldModel.ts`](src/nodeagent/core/worldModel.ts) injects the current
   sheet, versions, locks, awareness, and artifact refs. The version tags are
   what make CAS possible.

3. **Database OCC -> app-level no-clobber.** Convex optimistic concurrency
   protects transactions, not stale intent. NodeRoom still needs per-element
   versions. A lock prevents races; CAS catches stale writes; a blocked agent
   drafts instead of forcing. The L1-L7 ladder in [`evals/ladder.ts`](evals/ladder.ts)
   makes that measurable.

4. **Scalar spreadsheet values -> evidence-bearing cell payloads.** GTM and
   finance workflows need answers users can audit. Parser extraction,
   enrichment, classification, reconciliation, and wiki/report updates carry
   source evidence back to the durable room artifact. See
   [`tests/workflowEvals.test.ts`](tests/workflowEvals.test.ts) and
   [`tests/providerParserAdapter.test.ts`](tests/providerParserAdapter.test.ts).

5. **One file id -> two identities.** Raw Convex/NodeRoom file and artifact ids
   are the system of record. Gemini/OpenAI/Claude/OpenRouter file ids are
   provider caches. This keeps permissions, provenance, and cache expiry from
   being mixed together.

6. **Chat-only UI -> room workbench.** The room now has public chat, private
   NodeAgent, clickable files, spreadsheet, note/wiki, wall, room trace,
   drag-to-chat artifact refs, proposal review, host accept-all, and host-gated
   auto-accept. The UI is not decoration; it is how humans inspect evidence and
   control agent writes.

7. **Single action -> durable sliced workflow.** Mutating or long-running agent
   commands create or reuse a durable `agentJobs` row; private read-only advise
   can stay a one-call private reply until it needs continuation or mutation.
   public `@nodeagent` runs the first slice immediately for responsive UX; if it exhausts
   step or time budget, it checkpoints cursor state and resumes through the same
   Workflow/Workpool slice runner. The continuation function is still named
   `freeAutoWorkflow` from its first use case, but it preserves the job's model
   policy, so `@nodeagent`, `/ask`, and `/free` share the durable contract. `/free` is a
   hidden compatibility model-policy shortcut that forces
   `openrouter/free-auto`, not a second agent architecture. The remaining
   production hardening is stricter deadline/tool abort behavior, provider
   request idempotency where available, and model health/quarantine. See
   [`docs/LONG_RUNNING_AGENTS.md`](docs/LONG_RUNNING_AGENTS.md).

8. **Transcript memory -> harness-native reasoning frames.** Room-work/entity
   flows now materialize `agentReasoningFrames`, `entityWorkItems`, and
   `entityResearchCache` rows so recursive context is explicit, queryable, and
   cache-first. The plan shape is `intake -> plan -> execute -> verify ->
   synthesize`, with child frames only for stale or missing entity/facet work.
   See [`docs/HARNESS_RECURSIVE_REASONING.md`](docs/HARNESS_RECURSIVE_REASONING.md)
   and [`docs/OMNIGENT_INTEGRATION.md`](docs/OMNIGENT_INTEGRATION.md).

9. **Model benchmark -> model routing gate.** The cheapest model that passes a
   flat research benchmark is not automatically safe for collaboration. Live
   provider results are recorded in
   [`docs/eval/live-provider-agent-ladder-2026-06-08.md`](docs/eval/live-provider-agent-ladder-2026-06-08.md):
   provider connectivity is not the same as lock/CAS/draft safety.

9. **Ad hoc docs -> governed memory.** The wiki and docs use stable sections,
   clickable artifact refs, room-visible evidence, and private-context rules.
   The self-updating wiki skill is documented in
   [`docs/skills/self-updating-wiki/SKILL.md`](docs/skills/self-updating-wiki/SKILL.md).

10. **Manual confidence -> append-only QA ledger.** Every new user-facing
    feature, agent tool, provider route, or production invariant should update
    [`docs/qa/production-matrix.json`](docs/qa/production-matrix.json) and run
    `npm run qa:matrix`. The generated QA cockpit below is how the README stays
    honest as the system grows.

11. **One backend -> data by access pattern.** Convex/realtime state owns room
    truth, artifact versions, messages, locks, proposals, traces, and
    permissions. Object storage owns large uploads and generated exports. A hot
    cache should hold only version-keyed ephemeral data such as presence, room
    tails, recent sheet ranges, idempotency windows, and semantic answer cache.
    CDN is for static assets and explicitly public artifacts, while serverless
    actions/workers own bursty parsing, retrieval, model calls, exports, and
    evals.

12. **AI code -> simplification gate.** New architecture is treated as a first
    draft until it has a direct workflow hook, a test/eval, and a reason a
    simpler existing module cannot own it. The current watch list is in
    [`docs/OVERENGINEERING_AUDIT.md`](docs/OVERENGINEERING_AUDIT.md).

The detailed interview version of this story lives in
[`docs/INTERVIEW_NOTES.md`](docs/INTERVIEW_NOTES.md). The product support map
for the reviewed GTM and finance files lives in
[`docs/PROFESSIONAL_SPREADSHEET_WORKFLOWS.md`](docs/PROFESSIONAL_SPREADSHEET_WORKFLOWS.md).

The full **design rationale** — *every* architecture "why", the trade-offs, the live-collaboration
differences versus the past **Streamlit (ParselyFi)** and **Next.js + SSE client GraphStore**
projects, and the **HALO self-improvement loop** (how a replayable trace becomes a Codex / Claude Code
handoff so the agent improves its own harness, eval-gated) — lives in
[`docs/WHY_NODEAGENT_AND_HALO.md`](docs/WHY_NODEAGENT_AND_HALO.md). The founder thesis there: a solo
builder can't hand-verify every trace, but professional workflows (IB diligence, GTM sales, middle-market
banking, corporate-finance analysis, marketing) are *researchable online* — so the internet supplies the
spec, the eval supplies the contract, and the loop supplies the labor.

## Provider-Step Journal

The long-running path uses a durable model-step journal so Workflow retries do
not re-call a provider after a completed model response has already been
recorded. This is the reliability boundary behind the "run past 10 minutes"
claim: checkpoint state resumes the job, while the journal prevents duplicate
provider billing for completed steps.

```mermaid
flowchart LR
  A["Client request<br/>@nodeagent + model picker"] --> B["agentJobs row<br/>intent + model policy"]
  B --> C0["Optional room-work plan<br/>agentReasoningFrames + entityWorkItems + entityResearchCache"]
  C0 --> C["Slice runner<br/>inline action or Workflow/Workpool"]
  C --> D["Derive sliceKey<br/>job + cursor or artifact version + goal + model"]
  D --> E{"Journal row?<br/>jobId + sliceKey + step"}
  E -- "yes" --> F["Replay stored AgentStep<br/>0 provider calls<br/>0 new tokens"]
  E -- "no" --> G["Call provider<br/>Gemini / OpenAI / Claude / OpenRouter"]
  G --> H["Record agentModelStepJournal<br/>result + model + hashes"]
  F --> I["Execute tool calls<br/>locks + CAS + receipts"]
  H --> I
  I --> J{"Slice complete?"}
  J -- "yes" --> K["Complete job<br/>runs + steps + receipts + trace"]
  J -- "budget hit" --> L["Checkpoint cursor/handoff<br/>Workflow sleeps then resumes"]
  L --> C
```

The remaining edge case is a crash before the provider response is committed to
the journal; provider request idempotency keys are the next adapter-level
hardening where supported.

## Quickstart

```bash
npm install

# ── No keys: deterministic engine + scripted agents ──────────────────────────
npm run demo            # collaboration model: lock → draft → smart-merge, printed
npm run demo:agent      # the agent harness: lock-prevents vs CAS-catches, live conflict→retry
npm run eval            # the golden suite (4/4 deterministic cases)
npm run dev             # the multi-panel app (in-memory) → http://localhost:5260

# ── Live: real Convex backend + real LLM agent ───────────────────────────────
npx convex dev                                  # creates a deployment + generates types
npx convex env set AGENT_MODEL gemini-3.5-flash # or another ladder-approved route
npx convex env set GOOGLE_GENERATIVE_AI_API_KEY ... # set the key for the selected route
# Alternative route keys may include OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY.
npx convex env set SEED_ADMIN_TOKEN <admin-secret>
npx convex run seed:seedDemoRoom '{"adminToken":"<admin-secret>"}'
# Optional: add "hostAuthToken":"<32+ random chars, no spaces>" if you need a host browser session.
# Already seeded before member tokens? Repair in place without reseeding artifacts:
npx convex run seed:backfillDemoAuthTokens '{"adminToken":"<admin-secret>"}'
# Existing deployments with legacy raw member tokens:
npx convex run seed:migrateLegacyAuthTokens '{"adminToken":"<admin-secret>"}'
npm run dev             # now reads/writes live Convex (optimistic); the agent runs server-side

# ── Verify ───────────────────────────────────────────────────────────────────
npm run typecheck   &&   npm test   &&   npm run build      # tsc, full tests, vite build
npm run test:product:memory      # local browser gate: entry/story, chat, workbook formulas, range fill-down, responsive UX
npm run test:product:live        # live Convex backend gate: entry/create/join, reactivity, same-cell CAS, semantic rebase
npm run test:product:live:agent  # live Convex + provider gate: three-user public/private agent and review-mode flow
```

To run a local live smoke with a provider key read from the Convex deployment
instead of `.env.local`, preserve the injected process environment:

```powershell
$env:NODEROOM_PRESERVE_PROCESS_ENV = "1"
$env:OPENROUTER_API_KEY = (npx convex env get OPENROUTER_API_KEY).Trim()
npm run provider-parser:smoke -- --providers=openrouter
```

The product gates are intentionally broader than the benchmark harness, but each
gate owns a different claim. `test:product:memory` proves the local browser UX:
entry/story navigation, chat, uploaded-workbook formulas, range fill-down,
semantic review, and responsive surfaces. `test:product:live` starts the app
against live Convex and proves live entry/create/join, recoverable room errors,
cross-browser reactivity, same-cell CAS convergence, and host-reviewed semantic
rebase. `test:product:live:agent` adds
provider-backed three-user proof: public/private agent lanes, personal room-lane
actions, all-artifact visibility, and in-cell review proposals. Latest evidence:
[`docs/eval/THREE_USER_COLLAB.md`](docs/eval/THREE_USER_COLLAB.md).

## Architecture

```mermaid
flowchart LR
  subgraph Client["React room UI (src/ui)"]
    LeftRail["LeftRail<br/>files + people"]
    Chat["Chat<br/>public + private"]
    ArtifactPanel["Artifact panel<br/>Wiki | Spreadsheet | Research | Note | Wall"]
    Trace["Room trace<br/>tool evidence"]
  end

  Store["useStore()<br/>src/app/store.tsx"]

  subgraph MemoryMode["No-key mode"]
    RoomEngine["RoomEngine<br/>CAS + locks + drafts + smart-merge"]
    ScriptedAgents["Scripted agents"]
  end

  subgraph LiveMode["Live mode"]
    Convex["Convex<br/>rooms + artifacts + elements + locks + drafts"]
    AgentAction["runRoomAgent action<br/>ConvexRoomTools"]
  end

  subgraph AgentRuntime["Agent runtime (src/nodeagent)"]
    Loop["runAgent loop"]
    Context["JIT context + context packs + compaction"]
    Frames["reasoningFrames + frame utilities"]
    Tools["RoomTools port"]
    Models["modelCatalog + providers"]
  end

  Evals["Tests + evals<br/>Vitest | ladder | pain rubric | benchmark"]

  LeftRail --> Store
  Chat --> Store
  ArtifactPanel --> Store
  Trace --> Store
  Store --> RoomEngine
  Store --> Convex
  RoomEngine --> ScriptedAgents
  Chat --> Loop
  Loop --> Context
  Loop --> Tools
  Loop --> Models
  Tools --> RoomEngine
  Tools --> AgentAction
  AgentAction --> Convex
  Convex --> Store
  Evals --> RoomEngine
  Evals --> Loop
```

## The three layers

```
  UI (src/ui)  ──useStore()──▶  src/app/store.tsx  ──▶  RoomEngine (in-memory)   ← no keys
                                       └──────────────▶  Convex (useQuery + CAS) ← live
  Agent (src/nodeagent)  ──RoomTools──▶  InMemoryRoomTools  |  ConvexRoomTools (convex/)
```

1. **The collaboration engine** (`src/engine/`) — the truth. Every artifact is a bag of
   **elements** (`{ id, version, value }`), so locks, CAS, drafts, and smart-merge are **one**
   generic mechanism. Pure, deterministic, 12 scenario tests.
2. **The agent harness** (`src/nodeagent/`) — context engineering + tool construction + a bounded loop
   with an **injectable model** (scripted or routed real provider) and a **swappable backend** (in-memory
   or Convex). Context **compaction** keeps long runs bounded. See [`docs/AGENT_RUNTIME.md`](docs/AGENT_RUNTIME.md).
3. **The store seam** (`src/app/store.tsx`) — the UI calls `useStore()`; one provider is the
   in-memory engine, the other is live Convex with **optimistic updates**. The components don't change.

## The collaboration model

- **CAS** — `applyCellEdit` checks the element `version`; a stale base returns `{conflict, expected, actual}`
  **as data, never a throw**. (Convex's OCC alone does *not* stop a stale-base clobber — the app-level version does.)
- **Lock** — `proposeLock(elementIds)` makes an affected range read-only for non-holders; reads still
  return it (**locked ≠ invisible**). The lock *prevents* races; CAS *catches* the ones with no lock.
- **Draft → smart-merge** — a blocked agent drafts around the lock; on release the draft applies on
  untouched elements, no-ops if already equal, and **flags-without-applying if diverged**. Committed work is never clobbered.
- **Auto-allow** — when OFF, agent edits become proposals for host approve/reject; humans always apply directly.

### Semantic Rebase: Compare-Reason-Swap

CAS protects the cell. Semantic rebase protects the meaning.

Detailed design and implementation status:
[`docs/architecture/SEMANTIC_REBASE_CRS.md`](docs/architecture/SEMANTIC_REBASE_CRS.md).
The current repo has the deterministic policy classifier and packet builder tests; durable
Convex packet tables, LLM resolver action, validators, and semantic conflict UI
are still explicitly open.

Compare-and-swap remains the hard safety gate: "is the thing I read still the
thing I am about to overwrite?" Compare-Reason-Swap (CRS) is the collaboration
layer above it: "given what changed, why it changed, who intended what, what
evidence exists, and what this task is trying to accomplish, what is the best
safe next version?"

Target loop:

```text
agent patch bundle built from base versions
  -> managed write checks current versions
  -> no conflict: commit through lock/CAS
  -> conflict: build semantic conflict packet
  -> deterministic resolver handles safe independent patches
  -> LLM may propose a resolution for semantic cases
  -> validators check formulas, evidence, privacy, policy, and review tier
  -> safe ops commit only through a fresh final CAS
  -> stale again: rebase again or create a human review proposal
```

The conflict packet should include base, current, and proposed state; task
intent; actor and review-round context; comments; formula dependencies; source
evidence; trace summaries; open questions; and policy flags such as
`formulaOverwriteAllowed`, `humanWinsByDefault`, and
`publicPrivateBoundary`.

| Tier | Auto behavior | Examples |
|---|---|---|
| Deterministic auto-merge | Commit through managed lock/CAS after validation. | Different cells with no dependency overlap; appending a non-conflicting citation; safe derived-output refresh. |
| LLM-assisted, validator-approved | May auto-commit only when validators pass and policy allows it. | Note cleanup, memo paragraph synthesis, chart annotation rewrite, task summary reconciliation. |
| LLM-assisted, human review required | Create a proposal; do not auto-commit. | Revenue forecast, EBITDA adjustment, debt schedule input, formula replacement, private-to-public evidence boundary. |
| Forbidden without explicit override | Reject or force manual review. | Formula-to-scalar overwrite, deleting human comments, marking manual claims verified, exposing private source evidence in public output, changing evaluator gold. |

For users, the UI should say "Conflict found in Revenue Growth assumption" and
show who changed the base case, what the agent proposed, what sources exist, and
why the recommended merge is safe or needs review. It should not expose an
internal packet id as the primary experience.

## Live collaboration sequence

This is the actual multi-user path readers should hold in their head. The
browser may paint optimistically, but Convex mutations own durable writes, the
NodeAgent writes through the same checked mutations as humans, and Workflow /
Workpool only continues a checkpointed job; it is not the source of truth.

```mermaid
sequenceDiagram
  autonumber
  participant Host as "Host browser"
  participant Peer as "Peer browser"
  participant Store as "React useStore"
  participant Query as "Convex reactive queries"
  participant Mutation as "Convex mutations"
  participant Agent as "NodeAgent action"
  participant Flow as "Workflow / Workpool"
  participant LLM as "Gemini / OpenAI / Claude / OpenRouter"
  participant DB as "Convex DB"

  Host->>Query: subscribe room, artifacts, messages, jobs
  Peer->>Query: subscribe same room with member proof
  Query->>DB: read authorized room state
  DB-->>Host: files, spreadsheet, note, wall, trace
  DB-->>Peer: same public state, private data redacted

  Host->>Store: edit spreadsheet cell
  Store-->>Host: optimistic paint
  Store->>Mutation: applyCellEdit(elementId, baseVersion, value)
  Mutation->>DB: check member proof, lock, CAS version
  alt current and unlocked
    Mutation->>DB: write element, increment version, receipt
    DB-->>Host: confirmed canonical state
    DB-->>Peer: live reactive update
  else stale or locked
    Mutation-->>Host: conflict/locked result as data
    Host->>Mutation: draft or proposal path, no silent overwrite
  end

  Host->>Mutation: send public "@nodeagent" request
  Mutation->>DB: append message and create/reuse agentJobs row
  Host->>Agent: runRoomAgent(goal, artifact, requester proof)
  Agent->>DB: hydrate context from room state
  Agent->>Agent: fence untrusted data, compact context, derive slice key
  Agent->>DB: check model-step journal
  alt no journaled step
    Agent->>LLM: bounded model call with tools
    LLM-->>Agent: assistant text and tool calls
    Agent->>DB: record model-step journal
  else retry of completed step
    DB-->>Agent: replay model output, no provider call
  end
  Agent->>Mutation: read_range / write_locked_cells / write_locked_cell_results
  Mutation->>DB: permission, schema, managed range lock, CAS, evidence checks
  Mutation->>DB: commit safe write, create proposal, or create blocked draft
  DB-->>Host: inline chips, trace, job status
  DB-->>Peer: same public receipts
  alt budget remains and goal is done
    Agent->>Mutation: finish job with run + steps + cost
  else budget exhausted
    Agent->>Mutation: checkpoint cursor and handoff
    Mutation->>Flow: start continuation workflow
    Flow->>Agent: resume bounded slice from durable state
  end
```

Production uses managed write tools. The explicit `propose_lock -> edit_cell -> release_lock`
sequence remains useful in ladder evals and debug traces, but the production bundle hides those
coordination tools from the model. One visible `write_locked_cells` call expands inside the
runtime/mutation layer like this:

```mermaid
sequenceDiagram
  autonumber
  participant Agent as "NodeAgent"
  participant Mutation as "Convex mutation"
  participant Peer as "Peer browser"
  participant DB as "Convex DB"

  Agent->>Mutation: write_locked_cells(ops, baseVersions)
  Mutation->>DB: acquire exact target-range lock
  par peer edits target cell
    Peer->>Mutation: applyCellEdit(target, peerBaseVersion)
    Mutation-->>Peer: locked result as data
  and peer edits outside target range
    Peer->>Mutation: applyCellEdit(otherCell, currentVersion)
    Mutation->>DB: CAS commit allowed
  end
  Mutation->>DB: apply each target op with CAS
  alt target base is current
    Mutation->>DB: write element, bump version, receipt
  else target base is stale
    Mutation-->>Agent: conflict result as data
  end
  Mutation->>DB: release lock in finally
  Mutation->>DB: merge blocked drafts or flag review conflicts
  DB-->>Peer: reactive canonical state
```

`npm run eval:multiuser-coordination` is the deterministic proof for that expansion: human-vs-human
same-cell edits converge with one winner and one CAS conflict, target writes block, non-target writes
continue, stale writes conflict, blocked agents draft, smart-merge runs on release, and all scenarios end
with zero active locks. The generated artifact is
[`docs/eval/multi-user-coordination-proof.json`](docs/eval/multi-user-coordination-proof.json),
with the method documented in [`docs/eval/MULTI_USER_COORDINATION_PROOF.md`](docs/eval/MULTI_USER_COORDINATION_PROOF.md). The next promotion layer is the gated browser/live Convex spec: `E2E_LIVE=1 E2E_REQUIRE_REVIEW_MODE=1 npx playwright test e2e/three-user-collab.spec.ts --project=chromium`.

The long form, including file/provider extraction and architecture alternatives
against client-side SSE, REST polling, CRDT/local-first, and worker-queue
designs, lives in
[`docs/LIVE_COLLABORATION_SEQUENCES.md`](docs/LIVE_COLLABORATION_SEQUENCES.md).

## The agent — runtime, context, eval

The agent is the centerpiece, built to be *explained* and *trusted*. **Mention `@nodeagent <goal>`
in the public chat to drive the Room NodeAgent end-to-end** - it reads current versions, calls managed write tools, and lets the runtime expand lock/CAS/draft/release internally (the real `runRoomAgent` action when on Convex; the real in-memory harness with no keys). The composer model picker decides whether the same request uses Adaptive, Free, Top paid, or a specific model route.

- **Runtime + context engineering + tool backend** → [`docs/AGENT_RUNTIME.md`](docs/AGENT_RUNTIME.md).
  Three seams (model · tools · RoomTools), the loop, the system-prompt protocol + JIT context, and
  the CAS mutation that makes "no silent clobber" true.
- **Harness-native recursive reasoning** → [`docs/HARNESS_RECURSIVE_REASONING.md`](docs/HARNESS_RECURSIVE_REASONING.md).
  Durable frames, context packs, entity/facet cache, OKF evidence, child work,
  verification, and the Omnigent boundary.
- **Omnigent / Omniagent bridge** -> [`docs/OMNIGENT_INTEGRATION.md`](docs/OMNIGENT_INTEGRATION.md).
  Runnable: `npm run omnigent:nodeagent:smoke`; optional outer harness:
  `omni run examples/omnigent/nodeagent-room.yaml`.
- **Evaluation framework** → [`docs/AGENT_EVAL.md`](docs/AGENT_EVAL.md). Who the users are, their use
  cases, the golden-case schema, single/multi/long-running references, and 10 metrics led by
  **no-silent-clobber rate**. Runnable: `npm run eval` (deterministic) / `npm run eval:real`.
- **Feature eval backlog** → [`docs/eval/FEATURE_EVAL_BACKLOG.md`](docs/eval/FEATURE_EVAL_BACKLOG.md).
  Public/private gold sources, workflow contracts, and route-proof gates for the next features.

### The user → agent eval checklist

Everything the agent is tested on — or owes a test — sorted by the **six ways a user puts
NodeAgent to work**. The full per-case inventory (with file refs and recorded results) lives in
[`docs/AGENT_EVAL.md` § 0](docs/AGENT_EVAL.md); this is the honest scoreboard:

| Interaction mode | Running today | Designed, to build |
|---|---|---|
| **1 - Do it for me** (autonomous solve) | variance/footnote/note/wall goldens - GTM research enrichment (v3 cheap/free smoke, 18/28 routes 9/9) - executable professional subset (GTM runtime enrichment, messy-sheet parsing, cross-file note write, grounded wiki update, finance reconciliation) - chat-first lead capture through live room tools (`deepseek/deepseek-v4-flash`, 100%) - credit cascade + cell-mapping rejection - 3-statement modeling test Solve (private full lane, measured: `deepseek/deepseek-v4-flash` 5/5 model-owned across base/distractor/concurrent-edit rooms, median 105.0s, p95 $0.1068/run) | background chat-to-research intake - SEC model-build flagship - N-doc research (benchmark v4) - file-drop ingestion (10-K/XLSX/receipts) - knowledge-organization pack |
| **2 · Do it with us** (live collaboration) | ladder **L1–L7 scripted** + **L1–L4 live** across 11 routes (full passes: `gemini-3.5-flash`, `nemotron-3-ultra` — the research champion fails L1/L4, proving lanes promote separately) · multi-turn provenance · sustained concurrent room · lease fencing/takeover | L5–L7 live · modeling test (Collaborate: split IS/BS/CF under locks) · L8 roles/redaction · L9 entity resolution · L10 cross-artifact · live adversarial-source rung |
| **3 · Work under review** (proposals) | review-mode inline proposals + room-policy briefing regression | contractor-time professional approval fixture · L8 formalizes role-gated approve/promote/redact |
| **4 · Advise me privately** (read-only consult) | private no-tools reply path · private-draft redaction · prompt-injection fencing 4/4 | sensitive-query guardrail (decline with stated reason) |
| **5 · Work in the background** (resumable jobs) | durable `agentJobs` + exactly-once journal · frame-claimed room-work reasoning frames/cache rows · L7 RESUME scripted · spend caps (slice/day/month) with breach attribution | live tiny-budget frame resume across routes · frame-level retry/cancel controls · 100-row checkpointed batch with partial-success reporting |
| **6 · Teach me** (guided solve) | — | modeling test (Guide): **zero writes to answer cells**, hint quality, student convergence — restraint as a first-class eval axis |

Cross-cutting and always on: the eval store + `eval:diff` regression gate, the supported-route
model matrix (research and collaboration promote **separately**), the HALO improvement loop, and
the Gemini media judge on every published clip.

Professional proof state:

- `npm run eval:professional:catalog-proofs` proves **21/21** professional catalog cases at the deterministic catalog layer.
- `npm run eval:professional:live-catalog -- --real deepseek/deepseek-v4-flash --require-full` proves **21/21** catalog contracts with a live OpenRouter route.
- Route cross-checks: `ibm-granite/granite-4.1-8b` completed the full catalog at **19/21** (`finance-cost-reconciliation` missed `validCaseId`; `eval-ui-action-execution-map` missed `reviewIfNeeded`), `z-ai/glm-4.7-flash` passed a 3-case smoke but full-catalog timing is too slow for the current runner, and `nex-agi/nex-n2-pro:free` passed a 1-case smoke after the full sweep timed out.
- `npm run eval:chat-intake:live -- --managed-locks` proves the chat-first GTM workflow through the real room runtime with `deepseek/deepseek-v4-flash`: production-managed `write_locked_cell_results` / `write_locked_cells`, evidenced writes, CAS duplicate prevention, unresolved Caldera, one private clarifying question, release evidence, and no public PII leak.
- `npm run eval:professional:live-runtime -- --strict` proves **21/21** professional catalog cases execute through the real room runtime with `deepseek/deepseek-v4-flash`, `PRODUCTION_ROOM_TOOLS`, evidence payload writes, and runtime-managed lock coordination.

- `npm run eval:professional:proofs` now records **5 live-provider**, **16 partial live-provider**, **0 live-provider catalog**, **0 deterministic runtime**, and **0 contract-shape** cases; its live runtime smoke is **21/21**, and lock-mode counts are **21 runtime-managed**, **0 explicit-agent-lock**, and **0 catalog-only**.
- `npm run benchmark:openrouter-convex -- --strict` is the OpenRouter-on-Convex benchmark contract: **6/6** harness cases pass across durable `agentJobs`, model-step journaling, L1-L7 collaboration/resume, multi-user coordination, SpreadsheetBench route selection, rendered chart visual proof, and Docker workspace isolation. It now emits a closer official-style suite scorecard across **53 configured agent LLM routes** (**41** OpenRouter/internal-alias routes), including **25 current top-paid OpenRouter tool-capable candidates** from the `top-weekly` Models API snapshot. SpreadsheetBench-like N=5, BankerToolBench-like package/verifier, multi-user conflict, and provider-route N=5/p95 are scored separately. Current state is **3/4** official-style suites passing; provider-route N=5/p95 remains blocked for routes without repeated live evidence. Official promotion stays separate: BankerToolBench still needs Harbor/MCP/Gandalf before any official-score claim.
- **Context compaction** (`src/nodeagent/core/contextCompactor.ts`) — elides stale `read_range` results (Claude
  "context editing" pattern), preserves the turn structure (Hermes), keeps the latest state + recent turns.
- **Reasoning frames** (`src/nodeagent/core/reasoningFrames.ts`, `contextPack.ts`, `frameReducer.ts`,
  `frameVerifier.ts`) — make recursive context and multi-frame work a harness
  capability above swappable models.
- **Library stack** (TipTap, dnd-kit, lucide, assistant-ui, the `@convex-dev/*` components) → [`docs/STACK.md`](docs/STACK.md).

<!-- QA_COCKPIT_START -->
## Production QA cockpit

This section is generated from `docs/qa/production-matrix.json`. When the system grows, append or update a matrix row, then run `npm run qa:matrix`; CI can run `npm run qa:matrix:check` to catch stale docs.

<sub>25 feature guarantees tracked | 6 green | 17 yellow | 2 red | 1 live model route(s) cleared L1-L4 in the latest recorded ladder.</sub>

![QA coverage graph](docs/eval/qa-coverage.svg)

![Live model ladder graph](docs/eval/model-ladder-matrix.svg)

| Feature area | Status | Required production gate |
|---|---|---|
| Startup diligence demo | Yellow | README links the startup media, the walkthrough scripts match the latest target, Gemini judges the recaptured clips, the Convex contract eval records core invariants, and the provider-produced eval proves model-generated CellPayload/final copy flowing through the same job/proposal/trace contract. |
| Files + spreadsheet | Yellow | Parser fixtures, provider parser adapter tests, live file preview smoke, and Convex raw-file canonicalization. |
| Public/private chat + agent | Yellow | Scope separation tests, room member proof, and browser smoke for public/private panels. |
| Trace + proposals | Green | Host-only controls, proposal resolution tests, UI consent modal, and no silent direct-write bypass. |
| Research + ops workflows | Yellow | Deterministic workflow evals pass, provider parser smoke is green, and model routes are ladder-gated before interactive promotion. |
| Notes + spreadsheet agent | Green | Cross-file RoomTools test, grounded wiki write test, and CAS conflict checks. |
| Wall | Green | Create/delete operation tests and browser smoke for Wall tab. |
| Multi-user production paths | Yellow | Room auth proof, Convex codegen/typecheck, duplicate-operation idempotency, load/concurrency smoke, and deployment observability. |
| Long-running /free jobs | Yellow | Forced multi-slice test, crash-after-checkpoint resume, duplicate stale lease rejection, and live /free smoke. |
| Provider parser | Green | Adapter separation tests, live provider smoke, redacted errors, and artifact evidence checks. |
| QA system | Green | Matrix schema tests plus qa:matrix --check as a docs-sync drift gate, not a quality gate. |
| Browser E2E dogfood | Red | Playwright or equivalent real-browser specs for two-context cell edits, optimistic chat failure/retry, public/private leak checks, wall CRUD, job controls, and proposal conflict feedback. |
| Professional workroom shell | Yellow | Browser layout E2E proves wide desktop binder, center work surface, right Copilot, compact overlays, no overflow, no lost spreadsheet affordances, plus live/Convex and Gemini UI judge walkthrough evidence. |
| Signal tape + status strip | Yellow | DOM/browser tests prove two distinct bottom rows, pause/reduced-motion/filter behavior, click-to-open related artifact, no unauthorized private data in the tape, and precise non-scrolling status events. |
| Intake preflight scheduler | Yellow | Unit/runtime evals prove affected-set expansion, partial scheduling, intent claims, short commit leases, dedupe, cost authorization, privacy/formula checks, and that the LLM recommends while the harness schedules before live provider spend. |
| Workbook runtime adapter | Yellow | A POC loads the Q3 sheet into a candidate runtime, captures local mutations into Convex CAS ops, replays remote patches, preserves focus/selection, renders evidence/human/agent overlays, and runs headless formula/gold validation. |
| Public gold demo | Yellow | Manifest check, public fixture downloader/cache hash, LiteParse/provider extraction, formula/citation/page or bbox validators, CellPayload evidence, and trace read/write-set validators all pass. |
| Finance model gold pack | Yellow | Current solve batch stays fresh; guide zero-write, collaborate human-agent injection, withheld-data reconstruction, XLSX export/reopen, formula AST/value tie-out, citation coverage, and trace completeness lanes are added. |
| NodeRoomBench + eval trust | Yellow | Eval store records required metadata; eval:diff catches regressions, removed cases, model swaps, and check redefinitions; external benchmark adapters run benchmark-faithful mode without hidden gold access, evaluator edits, public answer lookup, or hardcoded cases. |
| Official benchmark readiness | Red | Readiness report exists; strict mode passes only when BankerToolBench and SpreadsheetBench adapters/runs are implemented without hidden-gold access, answer lookup, benchmark hardcoding, or evaluator mutation. |
| Unified NodeAgent jobs | Yellow | Interactive /ask and /free both create or reuse agentJobs, artifact writes emit receipts, job details are browser-visible, notebook graph mutations enqueue embeddings, and live browser/backend smoke proves linked runs/steps. |
| OKF retrieval + evidence memos | Green | OKF parser/retrieval tests prove candidate slates, literal source resolution, evidence sufficiency, and memo actions; persistent Convex OKF tables/outbox, provider-capable embeddings, vector indexes, live RoomTools port wiring, retrieval events, and Trace Lens UI are covered by runtime/source gates. |
| Agent improvement loop | Yellow | Deterministic loop passes, live provider/Convex/UI media lanes run when keys are present, and failures generate a handoff before chart promotion. |
| Demo/media evidence quality | Yellow | Gemini 3.5 Flash batch-judges every GIF/MP4 after capture/render refresh; P0 defects block publishing and P1 defects stay visible until fixed. |

| Live route | Provider | L1 | L2 | L3 | L4 | Promotion call |
|---|---|---:|---:|---:|---:|---|
| `gemini-3.5-flash` | Gemini | PASS | PASS | PASS | PASS | eligible for interactive collaboration promotion after repeated runs |
| `gpt-5.4-mini` | OpenAI | PASS | PASS | FAIL | PASS | parser/read-only/background until conflict rung passes |
| `claude-haiku-4-5` | Anthropic | PASS | PASS | PASS | FAIL | parser/read-only/background until blocked-range rung passes |
| `openai/gpt-4o-mini` | OpenRouter | PASS | PASS | PASS | FAIL | parser/read-only/background until blocked-range rung passes |
| `openrouter/free-auto` | OpenRouter free-auto router | PASS | FAIL | PASS | TIMEOUT | opt-in /free only; hit step budget on L2 despite correct value/provenance and timed out L4 |
| `openrouter/free-auto top-5 candidates` | OpenRouter router-expanded ladder | PASS | PASS | PASS | TIMEOUT | not promotable; summarizes routed top free candidates, see concrete rows |
| `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter free candidate | PASS | PASS | PASS | TIMEOUT | best free candidate for /free; not interactive because L4 times out |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | OpenRouter free candidate | FAIL | FAIL | FAIL | FAIL | do not route; invalid JSON in live ladder |
| `qwen/qwen3-coder:free` | OpenRouter free candidate | FAIL | FAIL | FAIL | FAIL | do not route; provider retry errors in live ladder |
| `openrouter/owl-alpha` | OpenRouter free candidate | FAIL | FAIL | PASS | FAIL | not safe; mutates during read and misses required draft |
| `qwen/qwen3-next-80b-a3b-instruct:free` | OpenRouter free candidate | FAIL | FAIL | FAIL | FAIL | do not route; provider retry errors in live ladder |
| `gpt-5.4-nano` | OpenAI | PASS | FAIL | FAIL | FAIL | research benchmark winner candidate only when collaboration safety is not required |
| `gpt-5.4` | OpenAI | PASS | FAIL | PASS | PASS | requires rerun because L2 time-budget failure blocks promotion |

Research benchmark route: `nex-agi/nex-n2-pro:free` is the fastest $0 current v3 composite-synthesis model clearing 9/9 checks at $0.0000 per run. Collaboration routing still uses the ladder gate above, not benchmark cost alone.

Full QA ledger: [`docs/PRODUCTION_GUARANTEE_MATRIX.md`](docs/PRODUCTION_GUARANTEE_MATRIX.md).
<!-- QA_COCKPIT_END -->

## The collaboration ladder (L1–L7)

**Captured live from the running app.** These are the **actual NodeRoom DOM** (memory mode),
screenshotted frame-by-frame by a Playwright run
([`e2e/capture-previews.spec.ts`](e2e/capture-previews.spec.ts) · `npm run workflow:app-previews`) —
not mockups, not slideshows.

*The Room NodeAgent fills the Q3 variance column — lock → read the version → CAS-edit → release — with the room trace updating live:*

![Real-app capture — the Room NodeAgent fills the variance column with lock + CAS](docs/eval/workflow-previews/app-variance-fill.gif)

*GTM research enrichment — the agent enriches only the pending accounts with source-backed values:*

![Real-app capture — GTM research enrichment](docs/eval/workflow-previews/app-research-enrich.gif)

The per-rung previews below are **trace replays** — the same agent-runtime tool calls (L1–L3 from a live
`gemini-3.5-flash` run, L4/L6 from the deterministic engine) drawn into a clean sheet by
[`scripts/render-workflow-preview.ts`](scripts/render-workflow-preview.ts), so each rung has an isolated
visual of the `lock → CAS → draft → smart-merge` protocol the [HALO loop](#agent-improvement-loop)
re-verifies every cycle. The rungs L1–L7 are the [`evals/ladder.ts`](evals/ladder.ts) bar that turns
"completed" into "right tool, no clobber, in budget."

**L7 · RESUME (slice death + cold continuation)** is the newest rung and tests the promise long-running
jobs actually depend on: slice 1 gets the full task but a step budget that kills it mid-way (a real
exhaustion + handoff, not a simulated flag); while the agent is dead a human revises one of its
completed cells; slice 2 is a **fresh context** — no conversation memory, only room state and the
handoff — and must finish only the remaining targets. Pass requires: completed work untouched, the
human's between-slice revision left standing, fresh read provenance for every slice-2 edit, and no
lock shortcut. This is the rung that separates "can edit a sheet" from "can be trusted with a
checkpointed background job."

### Evidence Levels

The README uses evidence labels deliberately:

| Label | Meaning |
|---|---|
| Deterministic catalog proof | A typed professional case passed checks for intake surface, output contract, provenance, trajectory, privacy/long-running/private-gold contracts, and requirement-proof evidence. This is not live model proof. |
| Deterministic runtime | A local harness executed real NodeRoom logic and checked final artifact state plus trace behavior without provider nondeterminism. |
| DOM preview | Playwright captured the real NodeRoom UI, usually in memory mode, to verify the visible workflow. |
| Deterministic replay | A scripted or fixture trace replayed through the real harness without provider nondeterminism. |
| Live provider | A real model/provider produced the agent trace or media judge result. |
| Live Convex | The path crossed the deployed Convex backend and reactive clients, not only the in-memory engine. |

Promotion claims require the level named in the QA matrix; a nice GIF is not a
production gate by itself.

### Judging Methodology

NodeRoom uses a tiered judge stack, not one blended score. Deterministic checks
grade artifact state, trace shape, locks/CAS, provenance, privacy, and budgets
first. LLM or vision judges are used only where the output is inherently
semantic or visual, and their verdicts are recorded with the trace instead of
silently replacing deterministic gates. Regression evidence is append-only and
case-keyed (`commitSha`, `caseId`, `ts`) so `npm run eval:diff` can say which
case degraded, by how much, and which check broke. This follows the current
production-eval pattern from
[Braintrust trace/score tracking](https://www.braintrust.dev/articles/llm-evaluation-guide),
[LangSmith curated regression datasets](https://docs.langchain.com/langsmith/evaluation),
and [OpenAI-style custom evals](https://github.com/openai/evals) for the
workflows that actually matter to the product.

### L1 · Read — answer without touching

![Read workflow](docs/eval/workflow-previews/l1-read.gif)

The agent reports a cell's value and changes nothing. The discipline is *not writing*: read the exact
cell, return it, stop.
**Research / repo:** just-in-time context + read-before-write — Anthropic, *Effective context
engineering for AI agents*; the scratchpad-first pattern.

### L2 · Edit with CAS — claim, read the version, compare-and-set

![Edit workflow](docs/eval/workflow-previews/l2-edit.gif)

The agent locks the exact cell, reads its `version`, and writes with that version as the CAS baseline.
A write whose baseline is stale is rejected, not applied.
**Research / repo:** application-level optimistic concurrency beyond DB OCC — per-element `version` in
[`convex/schema.ts`](convex/schema.ts) + the `applyCellEdit` check; classic OCC (Kung & Robinson, 1981).

### L3 · No clobber — a human edits mid-write

![No-clobber workflow](docs/eval/workflow-previews/l3-no-clobber.gif)

A human edits the same cell while the agent is working. The agent's stale-baseline write hits a
**conflict** — surfaced as *data*, not an exception — so it re-reads and retries. Committed human work
is never overwritten.
**Research / repo:** conflict-as-data + retry — Convex transactional OCC is necessary but not sufficient;
the per-element CAS check is what prevents the clobber.
the conflict-as-data / async-reliability pattern.

### L4 · Draft when blocked — the range is locked

![Draft workflow](docs/eval/workflow-previews/l4-draft.gif)

Another agent holds an affected-range lock. Instead of forcing, the agent **drafts** its change
(`create_draft`) for smart-merge on unlock, and never writes directly through the lock.
**Research / repo:** propose/draft + smart-merge over force-write — proposal/draft tables in
[`convex/schema.ts`](convex/schema.ts); the scratchpad-first pattern,
Anthropic *Building Effective Agents*.

### L5 · Large range — 600 rows, load only the window

![Large-range workflow](docs/eval/workflow-previews/l5-large-range.gif)

A 600-row operating model; the agent loads only the 5-row window around the target, never the full
sheet, touches only the allowed cell, and stays inside a bounded context budget.
**Research / repo:** just-in-time context windows over full-snapshot loading — `rangeContext` in
[`evals/ladder.ts`](evals/ladder.ts); Anthropic *Effective context engineering*.

### L6 · Long horizon — many cells, repeated conflicts, compaction

![Long-horizon workflow](docs/eval/workflow-previews/l6-long-horizon.gif)

Fill five cells under repeated concurrent edits, **compacting context** as the window fills, recovering
from each conflict, never locking, all inside a wall-clock budget.
**Research / repo:** orchestrator durability + context compaction —
the orchestrator-workers pattern,
the layered-memory pattern; Anthropic *Effective context engineering*.

> The previews replay genuine agent-runtime traces (the tool protocol + CAS results are real).
> Live provider evidence exists for selected L1-L4 routes; the free-auto/top-5 router ladder
> failed overall. L5-L6 preview evidence is deterministic unless a separate live run is recorded.

## Agent improvement loop

NodeRoom uses the same loop described in OpenAI's Agents SDK cookbook: real traces, human/model
feedback, reusable evals, a validation gate, and a Codex handoff — then it repeats.

**HALO — Hierarchical Agent Loop Optimization**

![HALO loop](docs/eval/halo-loop-diagram.svg)

| # | Stage | What happens | Where in this repo |
|---|---|---|---|
| 1 | **Trace** | every agent run records a replayable trace (tools, args, results, versions) | `writeTraceArtifact` (`evals/ladder.ts`) · `agentSteps` (convex) |
| 2 | **Feedback** | three sources score the run: trace signals, human, LLM-judge | trace checks · review · judge |
| 3 | **Evals** | each rung raises the bar from "completed" to "right tool, no clobber, in budget" | `evals/ladder.ts` (L1–L7) · `tests/workflowEvals.test.ts` · `evals/creditEval.ts` |
| 4 | **Record** | append-only store keyed by `(commit + worktree, case, ts)` with per-check booleans + trace ref | `evals/evalStore.ts` → `docs/eval/eval-runs.jsonl` |
| 5 | **Gate** | cross-version diff names the degraded case **and the exact check that broke** | `npm run eval:diff` (exit 1 on regression) |
| 6 | **Handoff** | the failing trace + ranked recommendations become a Codex / Claude Code packet | [`docs/WHY_NODEAGENT_AND_HALO.md`](docs/WHY_NODEAGENT_AND_HALO.md) handoff contract |
| 7 | **Fix** | the smallest necessary workflow/harness change lands; previews refresh if user interaction changed; the loop re-gates | `npm run workflow:previews:all` Â· back to stage 1 |

The repo-owned runner is:

```bash
npm run agent:improve              # deterministic workflow + ladder evidence
npm run halo:self-improve:smoke    # N=5 path fingerprints + context quality
npm run halo:variant:select        # score competing harness variants and write selectedParent
npm run halo:convex-context:smoke  # mirror Convex job context into HALO metrics
npm run halo:live-path:calibrate   # N=5 real-provider path calibration
npm run agent:improve -- --live    # add provider parser, free route discovery, Convex /free smoke
npm run agent:improve -- --full-live
npm run agent:improve -- --ui-media=docs/eval/ui-recordings/<recording-or-screenshot>
```

The self-improvement smoke is the HyperAgents-inspired part of HALO, kept at a
safe altitude: it does not execute model-generated code. It repeats two
deterministic runtime cases five times each, fingerprints the tool path, checks
assistant/tool-result pairing, records p95 model/tool calls, and measures context
compaction savings. The checked artifact
[`docs/eval/halo-self-improvement-smoke.json`](docs/eval/halo-self-improvement-smoke.json)
currently records 2 cases / 10 runs, one fingerprint per case, zero missing tool
results, 25 compaction events, 21,600 saved chars, and three meta-improvement
proposals. HALO now also runs the HyperAgents-style selection step at a safe
altitude: [`halo-variant-selection.json`](docs/eval/halo-variant-selection.json)
scores competing harness variants and writes `selectedParent`; the current parent
is `runtime-managed-lock-v1` because it removes model-visible lock/unlock calls
while preserving runtime lock/CAS evidence. [`halo-convex-context-telemetry.json`](docs/eval/halo-convex-context-telemetry.json)
mirrors real Convex `agentJobs.detail` data into the same context metric shape.
[`halo-live-path-calibration.json`](docs/eval/halo-live-path-calibration.json)
records the live N=5 provider calibration: `deepseek/deepseek-v4-flash`, 5 runs,
2 accepted fingerprints, p95 3 tool calls, p95 4 model calls.

Run the whole loop continuously until a clock deadline. Deterministic-only is the default safe overnight
shape; full-live adds provider spend, the current benchmark contract, and the free-auto router ladder:

```bash
npm run halo:overnight -- --skip-e2e --skip-live --until "2026-06-09T17:00:00Z" --sleep-minutes 25
npm run halo:overnight -- --full-live --ui-media=docs/eval/ui-recordings/live-ui-walkthrough-20260608.mp4 --until "2026-06-09T17:00:00Z" --sleep-minutes 30
npm run halo:supervise -- -Until "2026-06-10T17:00:00Z" -PollSeconds 300
npm run halo:status -- --strict --require-supervisor
npm run halo:status -- --strict --require-supervisor --record
npm run halo:snapshots
```

Each cycle writes `docs/eval/halo-runs/<runId>/status.json` (live state) and `summary.jsonl` (every step of every cycle).
The runner also maintains `docs/eval/halo-runs/.active-run.json`; a second runner exits before writing
run artifacts while a live lock points at an active process.
The supervisor waits behind the active lock, then starts the next deterministic
loop through the handoff deadline, so a long full-live run can finish without a
duplicate writer and coverage still continues afterward.
The Windows cron wrapper checks for an existing supervisor before launch, so
scheduled fires do not create short-lived duplicate supervisors.
The strict status command is the handoff guard: it reports lock age, deadline,
latest events, router-ladder artifact state, active process tree, and supervisor
liveness, and exits nonzero if coverage is missing or duplicated.
Add `--record` to append the same report to
`docs/eval/halo-runs/status-snapshots.jsonl` for the handoff trail.
`npm run halo:snapshots` renders the JSONL trail to
`docs/eval/halo-runs/status-snapshots.md`.
Current overnight run notes: [`docs/eval/HALO_OVERNIGHT_RUN.md`](docs/eval/HALO_OVERNIGHT_RUN.md).

Live run status (regenerated every loop) — each bar is one loop step:

![Agent improvement loop status](docs/eval/agent-improvement-loop.svg)

Latest loop report: [`docs/eval/agent-improvement-loop.md`](docs/eval/agent-improvement-loop.md).
The full founder-level rationale, past-project comparison, and HALO handoff contract live in
[`docs/WHY_NODEAGENT_AND_HALO.md`](docs/WHY_NODEAGENT_AND_HALO.md).
Architecture ownership/budget gate: `npm run architecture:budget -- --strict`.

Official benchmark posture: `npm run benchmark:official:readiness` is a reporting gate, and
`npm run benchmark:official:readiness -- --strict` remains red until at least one official runner
can execute, export, reopen, and score benchmark work products without hidden-gold access.
`npm run benchmark:official:task-coverage` writes the stricter no-shorthand task ledger:
[`docs/eval/OFFICIAL_BENCHMARK_TASK_COVERAGE.md`](docs/eval/OFFICIAL_BENCHMARK_TASK_COVERAGE.md).
Current checked-in coverage is deliberately not green: **1/5** tracks complete, **409/1,738**
declared task targets staged, **408** deterministic-run tasks, and **7** model-run cases. The
important split is that SpreadsheetBench Verified has **400/400** staged and copy-baseline-run
evidence, but only **3/400** verified cases have N=5 model-run evidence; SpreadsheetBench V1 full
**912/912**, SpreadsheetBench 2 full **321/321**, and BankerToolBench full **100/100** remain
blocked until their complete official bundles are staged and model-run under the benchmark policy.
SpreadsheetBench V1/V2 now has a local official-bundle ingest adapter (`npm run
benchmark:spreadsheetbench:ingest`) that separates agent-visible workbooks/prompts from
evaluator-only golden files and scorer metadata, a staging adapter (`npm run
benchmark:spreadsheetbench:stage`) that writes separate `agent/` and `evaluator/` manifests, and a
baseline runner (`npm run benchmark:spreadsheetbench:run`) that emits candidate workbooks from the
staged `agent/` directory before opening the evaluator manifest. A local workbook scoring adapter
(`npm run benchmark:spreadsheetbench:score`) then reopens candidate/golden workbooks and compares
values, formulas, optional cell style fingerprints, answer-range column/row layout, and merge
ranges. Smoke artifacts cover the V1 verified-400 bundle and the V2 public example bundle. The
runner also supports `--mode apply-agent-patch`, which reads
`agent/edit-plan.json`, applies cell-level value/formula/style edits, emits a candidate workbook,
then opens evaluator metadata for scoring; the checked-in edit-plan smoke records a passing
candidate and a zero-mismatch score. It also supports `--mode model-edit-plan --model <route>`,
which snapshots only the staged `agent/` workbook/prompts, asks the configured model for a JSON
edit plan, applies it, records token/cost usage, emits a candidate workbook, then scores afterward.
The checked-in live smoke (`docs/eval/spreadsheetbench-model-edit-plan-live-smoke.json`) passed one
staged task with `gpt-5.4-nano` and recorded trajectory, timing, and cost. These artifacts prove
ingest, sandbox-staging, candidate-output, edit/export/reopen, model-planning, and diff plumbing.
The official V1 smoke (`docs/eval/spreadsheetbench-v1-model-edit-plan-live-smoke.json`) deliberately
showed the next harder truth: a model can choose the wrong spreadsheet path on a real staged task,
and the harness must record model call, tokens, cost, trajectory, parser repair, and score evidence
instead of summarizing it away. The N=5 live smoke
(`docs/eval/spreadsheetbench-v1-model-edit-plan-n5-live-smoke.json`) now repeats that official task
five times and records `taskCount: 5`, `caseCount: 1`, `passRate: 1`, p95 latency 4.593s,
`providerCostUsd: 0.01059125`, zero failure counts, and average overall `1`. The harness improvement
is visible in the artifacts: the planner sees agent-visible `aggregate_section` candidates for
section-level table grouping, unsupported invented operations are dropped, section rewrites apply
after scalar cell edits, and the scorer only enforces formula equality when the evaluator gold cell
actually contains a formula. A broader official V1 three-task stability smoke
(`docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json`) now repeats all three
locally staged official tasks five times each: `taskCount: 15`, `caseCount: 3`, `repeatCount: 5`,
`passRate: 1`, average overall `1`, p95 latency 5.080s, `$0.0462905` spend, zero failure counts,
zero retry attempts, and 0 candidate-output leaks across 75 checked files
(`docs/eval/spreadsheetbench-v1-run-3task-n5-contamination-smoke.json`). `npm run
benchmark:spreadsheetbench:proof` now enforces those run metrics, leak bounds, result-level
sidecar hashes for candidate manifests, agent-workspace manifests, generated edit plans, raw model
outputs, and candidate-before-evaluator trajectory order. HALO runs that proof gate on every
`agent:improve`. That run exercises the next two spreadsheet-harness lessons
repeatedly under live model variance: deterministic structural operators for visible date filters
(`filter_rows`) and visible duplicate-removal/sort tables (`sort_unique_rows`) belong in the harness
tool contract, not as fragile one-cell dynamic formulas or short prefix writes. `npm run
benchmark:spreadsheetbench:routes` now classifies staged SpreadsheetBench V1/V2 tasks into
deterministic table transforms, model-planned formula edits, model-planned format/general edits, or
chart-visual work using only agent-visible manifests; the checked-in V1 report classifies
400 tasks as 41 deterministic table transforms, 218 formula edits, 33 format edits, and 108 general
edits with `blocked_chart_visual=0`. The full V1 copy-input baseline also has a chunked runner
(`npm run benchmark:spreadsheetbench:run-chunked`) that records all 400 staged tasks instead of
letting one pathological workbook abort the run: the checked-in report
(`docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json`) records 400/400 attempted tasks,
15/400 pass, average overall `0.257472`, and zero failure counts after malformed answer-position,
unsupported XLSX package-part, and external-link cell-read repair. This is a benchmark-path lesson, not a broad
official-readiness claim: larger held-out model/route-execution runs and official scoring parity are
still tracked as blockers below.
The contamination gate
(`npm run benchmark:contamination`) now scans agent-facing benchmark manifests, candidate manifests,
agent-workspace manifests, and generated edit plans for evaluator-only gold/rubric/canary metadata; checked-in smokes show 0
leaks for the staged V1 root, the full verified-400 V1 stage (`400/400` tasks,
800 agent-facing files, 400 evaluator gold files, 0 leaks across 800 checked
files), the V2 public-example stage (3 paired input/gold tasks from 26 example
tasks with clean isolation), the N=5 one-task V1 candidate output, the
three-task N=5 V1 candidate output, the retry V1 candidate output, and the
staged BTB fixture. The runner also has an explicit retry policy: `--retry-failed N` retries
candidate-generation or scoring errors, `--retry-score-failures` opts into retrying
scored-but-wrong candidates, and the report records case-level attempts, retry exhaustion,
pass-after-retry counts, p95 latency, tokens, and provider cost. The checked-in retry smoke
(`docs/eval/spreadsheetbench-v1-model-edit-plan-retry-live-smoke.json`) ran one official V1 task
with `gpt-5.4-nano`, `--retry-failed 2`, and `--retry-score-failures`: all 3 attempts reached
scoring, each attempt created an agent-only workspace manifest before candidate generation, each
attempt saw the full 302-cell official workbook snapshot, simple `SUM(...)` formulas get cached
results on export/reopen, best overall was `0.616667`, p95 latency was 11.033s, spend was
`$0.0095201`, and pass remained 0/3. That proves retry accounting, attempt-local workspace
boundaries, fuller context capture, formula-result packaging, and leakage scanning while still
surfacing the planner gap honestly. `npm run benchmark:agent-sandbox` now adds a local Node
permission subprocess proof: an agent process can read its copied `agent-workspace/` file and is
denied evaluator-only gold outside that root. This tightens the file-boundary story, but it is not
Docker/Harbor isolation, network isolation, or a resource sandbox, and these artifacts are not
official benchmark scores until run across official bundles under the benchmark policy. `npm run
benchmark:docker-sandbox:probe` records that stronger boundary separately in
`docs/eval/docker-sandbox-probe.json`; the current checked-in artifact records
`container_isolation_proven` on Docker `28.5.1` with `node:22-alpine`, `--network=none`,
`--read-only`, an agent-workspace-only mount, and denied evaluator reads. That closes the local
Docker tool blocker; official readiness still stays red until the benchmark runners themselves are
executed under the full official policy.

The deterministic formula-result lane has since moved beyond `SUM(...)`: `apply-agent-patch` and
`model-edit-plan` candidate manifests now record `formulaResultPolicy:
deterministic_local_subset`, covering arithmetic, same-sheet cell refs/ranges,
`SUM`/`AVERAGE`/`MIN`/`MAX`/`COUNT`/`COUNTA`, `ABS`,
`ROUND`/`ROUNDUP`/`ROUNDDOWN`, `IF`/`IFERROR`, single-criteria
`SUMIF`/`COUNTIF`/`AVERAGEIF`, and multi-criteria
`SUMIFS`/`COUNTIFS`/`AVERAGEIFS`, plus exact
`MATCH`/`INDEX`/`VLOOKUP`/`XLOOKUP`, `SUMPRODUCT`, text extraction/search
(`LEFT`/`RIGHT`/`MID`/`LEN`/`FIND`/`SEARCH`/`REPLACE`), `TEXT`/`DATE`, `VALUE`,
`CONCATENATE`, and `TRIM` before export/reopen scoring, including basic wildcard
criteria. That is useful for SpreadsheetBench smokes, but still not a complete
Excel calculation engine; approximate lookup, array formulas, volatile
functions, external refs, and dynamic Excel functions remain outside the local
deterministic subset.

SpreadsheetBench format evidence now goes beyond individual cell style hashes when
`--compare-styles` is enabled: the scorer also checks answer-range column widths/hidden state,
row heights/hidden state, and merge ranges that intersect the answer region. That makes layout
drift visible in workbook score reports without widening access to evaluator-only gold before
candidate emission. It still is not the official benchmark's complete formatting policy, and it
does not replace rendered chart/layout grading.

SpreadsheetBench V2 chart evidence now has two lanes:
`src/eval/spreadsheetBenchChartScorer.ts` compares candidate and golden `.xlsx` chart packages by
normalizing and hashing `xl/charts/*.xml` plus `xl/drawings/*.xml`, then reports matched, missing,
extra, and mismatched chart parts. The workbook scorer and staged runner can carry that evidence in
score reports, so V2 chart-package drift is no longer invisible. The rendered lane is now live too:
`npm run benchmark:spreadsheetbench:chart-visual:grade` exports a real SpreadsheetBench V2
Visualization chart sheet through Excel, rasterizes it with Poppler, and asks Gemini 3.5 Flash to
accept the matching oracle candidate while rejecting the raw-input negative control. The resulting
`docs/eval/spreadsheetbench-chart-visual/task-126/vlm-report.json` is consumed by
`npm run benchmark:spreadsheetbench:chart-visual:probe -- --strict`, whose current checked-in
artifact is `chart_visual_grade_proven` with renderer, candidate/gold PNG hashes, dimensions, and an
accepted VLM report. The refreshed V2 score/run smokes still show the static signal explicitly:
copy-input candidates miss two evaluator-only chart/drawing package parts per sampled task, dropping
runner best-overall scores from workbook-only near-passes to chart-aware failures while the V2
staged/run contamination smokes stay at 0 leaks.

BankerToolBench now has the same first boundary in place: `npm run
benchmark:bankertoolbench:ingest` scans an already-downloaded BTB bundle (`tasks.jsonl`,
`task-data/`, optional `golden-outputs/`) and parses input files plus weighted rubric metadata
without putting rubric, canary, or golden-output paths into the agent-facing task payload. `npm run
benchmark:bankertoolbench:stage` writes separate `agent/` and `evaluator/` manifests; the agent
side contains only the official default `final_prompt` plus input files, while the evaluator side
holds prompt context, formatting context, canary, weighted rubric, and golden outputs. Checked-in
smoke artifacts and the contamination gate prove that boundary on a local BTB-shaped fixture.
`npm run benchmark:bankertoolbench:run` now adds the next boundary: it copies each attempt into an
agent-only workspace, emits candidate deliverables before opening evaluator-only rubric/golden
metadata, validates the exact expected output package shape for supported spreadsheet, deck,
document, PDF, CSV, and image deliverables, records a trajectory, and runs a local exact-package /
exact-or-workbook-semantic weighted-rubric smoke verifier. Excel deliverables now get reopened and
scored with the workbook scorer, so a semantically identical `.xlsx` can pass even when package
metadata changes the file hash. The checked-in run smoke is deliberately 0/6 because copy-input is
not a solution, but it proves the runner/verifier handoff, multi-file package accounting, workbook
semantic scoring, and 0-leak artifact path. A second checked-in `apply-agent-output` smoke proves
the positive path: agent-authored deliverables score 6/6 weighted points, pass 1/1, and keep
candidate emission before evaluator access with 0 leaks across 4 checked files. `npm run
benchmark:bankertoolbench:proof` now enforces both local BTB harness boundaries in HALO: staged
isolation, candidate-before-evaluator trajectory, negative baseline accounting, positive
weighted-rubric/package scoring, supported deliverable policy, and 0-leak artifacts. This is
still not a BTB score: Harbor/Docker process isolation, MCP financial tools, and Gandalf verifier
replay remain red gates. `npm run benchmark:bankertoolbench:manifest-lock` now hashes a BTB bundle's
`tasks.jsonl`, `task-data/**`, and `golden-outputs/**` into a provenance lockfile; the checked-in
fixture smoke is `docs/eval/bankertoolbench-manifest-lock-smoke.json`. `npm run
benchmark:bankertoolbench:official-contract` makes the full external contract explicit in
`docs/eval/bankertoolbench-official-contract.json`: dataset revision and manifest-lock hashes,
Harbor/Docker mount policy, required SEC/market-data/logo/document/web MCP tools, and the Gandalf
score-import schema. The Docker availability probe makes the process-isolation blocker executable
instead of hand-wavy: it must pass with `container_isolation_proven` before any public BTB readiness
claim can move out of red.

## Benchmark Harness / v3 Composite-Synthesis Run

The agent is model-agnostic (one `AgentModel` seam), so the diligence-research task can run across
providers and the cheapest model that clears the **boolean gate** wins. Providers are routed by
**NodeBench's `modelCatalog.ts`** (copied verbatim — reuse, not reinvent), reaching cheap + free
models through OpenRouter's OpenAI-compatible endpoint. The checked-in `docs/eval/results.json`
is the latest verified run of the listed routes, not proof that all models and all scenarios were
rerun.

Because NodeRoom primarily targets OpenRouter routes, there is now a separate Convex-shaped
benchmark contract: `npm run benchmark:openrouter-convex -- --strict` writes
[`docs/eval/OPENROUTER_CONVEX_BENCHMARK.md`](docs/eval/OPENROUTER_CONVEX_BENCHMARK.md). That gate
checks whether OpenRouter/internal-alias routes can run benchmark-shaped work through Convex-owned
`agentJobs`, `convexModel`, leases, model-step journals, mutation receipts, artifact evidence, and
workspace isolation. The same report now includes the full configured agent LLM scorecard from
`llmModelCatalog.agent` plus curated OpenRouter routes and the current top-paid OpenRouter
tool-capable candidate set from `npm run openrouter:paid`, with four closer official-style
families: SpreadsheetBench-like workbook edits, BankerToolBench-like package/verifier tasks,
multi-user conflict tasks, and provider route N=5/p95 stability. It is intentionally not an
official SpreadsheetBench/BankerToolBench score; official promotion remains gated by the strict
readiness report and the strict full-task coverage ledger.

**The charts are downstream of a real run — never hand-drawn.** `npm run benchmark` writes
`docs/eval/results.json` (real $/latency/tokens from `agentRuns`, real pass% from deterministic
checks); `npm run benchmark:charts` renders these SVGs from it. Reproduce it yourself.

**Why v3 exists (an honest history).** Two earlier benchmark generations were invalidated on
review and are not comparable to v3: the v1 low-level runs executed with a broken fetch path
(every `fetch_source` failed, so two checks measured the network, not the model), and the v2
single-call composite let a deterministic harness template author the row fields — every check
graded our own code, and a content-free "no claim asserted" template passed `NO_FABRICATION`
vacuously. v3 (`company-research-v3-composite-synthesis`) splits the workflow so each layer is
measured for what it owns: a **fetch preflight** aborts before any model spend if the environment
cannot fetch; `fetch_row_sources` (harness) locks the row and returns fenced source snippets;
**the model synthesizes the four research fields in its own words**; `write_row` (harness)
validates with zod and does the CAS writes, citations, freshness, status, and lock release. A
**content floor** in `STRUCTURED_FIELDS` rejects both disclaimer-shaped non-answers and
from-memory text with no derivation from the fetched evidence, and the LLM judge grades the
model-authored summaries against the actual fetched snippets.

Latest verified v3 run (2026-06-11 OpenRouter cheap/free catalog smoke, 1 company,
route snapshot `fabbcd520e971ec7`, per-row trace refs in `docs/eval/traces/benchmark/`):

| Route | Gate | Cost/run | Time | What the gate saw |
|---|---|---|---|---|
| `nex-agi/nex-n2-pro:free` | **9/9** | $0.0000 | 6.2s | Fastest free route that completed the current smoke. |
| `ibm-granite/granite-4.1-8b` | **9/9** | $0.0009 | 6.3s | Cheapest paid route that completed the current smoke. |
| `z-ai/glm-4.7-flash` | **9/9** | $0.0013 | 17.5s | Low-cost paid route with successful sourced synthesis. |
| `deepseek/deepseek-v4-flash` | **9/9** | $0.0020 | 38.7s | Prior 3-company champion still clears the cheaper smoke. |

The run attempted 28 current cheap/free or very low-cost OpenRouter routes; 18 cleared 9/9 and 10
were recorded as provider, harness, or model failures instead of being hidden. This is promotion
evidence for the background research workflow only; collaboration routing still uses the
lock/CAS/draft ladder.
Run `npm run benchmark` or `npm run benchmark:free` to refresh it.

The broader supported-model bakeoff is tracked separately in
[`docs/eval/MODEL_EVAL_MATRIX.md`](docs/eval/MODEL_EVAL_MATRIX.md). Dry-run the
whole route/scenario plan with `npm run eval:model-matrix -- --json-out
docs/eval/model-eval-matrix-plan.json`; run it live with
`npm run eval:model-matrix:live` when you intentionally want the full
OpenRouter/native route spend. That matrix covers the v3 research task plus
L1-L4 collaboration scenarios, so a model cannot be promoted from research
quality alone.

![Cost vs quality](docs/eval/cost-quality.svg)
![Leaderboard](docs/eval/leaderboard.svg)

Legacy run (`company-research`, older deterministic checks: `ALL_COMPLETE · EVERY_ROW_SOURCED ·
SOURCES_FETCHED · COMPLETED_IN_BUDGET`):

Legacy models, cheapest → priciest. **6 boolean checks** — 4 deterministic (complete · sourced ·
fetched-not-invented · in-budget) + 2 **LLM-judge** (`NO_FABRICATION`, `RIGHT_ENTITY`, judged by
`gemini-3.1-flash-lite`, calibrated to flag only invented *specifics* — synthesis is the product,
not hallucination, per `grounded_eval`):

| model | provider | checks | $/run | latency |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` | Google | **6/6 ✓** | **$0.0076** | 10 s |
| `gpt-5.4-nano` | OpenAI | 6/6 ✓ | $0.0130 | 60 s |
| `gpt-5.4-mini` | OpenAI | 6/6 ✓ | $0.0151 | 15 s |
| `claude-haiku-4-5` | Anthropic | 6/6 ✓ | $0.1201 | 34 s |
| `claude-sonnet-4-6` | Anthropic | 6/6 ✓ | $0.1789 | 44 s |
| `gemini-3.5-flash` | Google | 5/6 ✗fabrication | $0.2339 | 58 s |

**Legacy routing call (pre-v2 benchmark):** `gemini-3.1-flash-lite` wins outright — **cheapest
($0.0076), fastest (10 s), 6/6**. The *priciest* model, `gemini-3.5-flash` ($0.2339), is the
**only one that fabricated a specific** not in its sources — dominated on both axes. More expensive
≠ better; route to the cheapest that clears the gate. (That's the LLM-judge earning its place — the
4 deterministic checks alone scored everyone 6/6.)

**Honest caveat (first-principles):** the research run above is a *floor* task — summarize
well-documented companies — so quality is near-saturated (5 of 6 perfect) and **cost dominates**.
A quality-*spread* benchmark needs the **task ladder** below.

### Task ladder - where models actually diverge

`npm run ladder:real` runs each model up a complexity ladder (the spec's keystone): read,
edit, conflict-recovery, blocked-must-draft, large range, and long-horizon recovery. It prints
a failure heatmap that a single-task chart cannot show (`evals/ladder.ts`):

```
model                     L1  L2  L3  L4  L5  L6
scripted                  ok  ok  ok  ok  ok  ok
<real model>              ok  ok  ok  no  ... ...
```

L1 read-only; L2 single CAS edit; L3 concurrent-edit no-clobber; L4 locked-range must-draft;
L5 large-sheet range discipline; L6 compaction plus repeated conflict recovery.

**The finding the flat benchmark hid:** `gemini-3.1-flash-lite` *won* the research benchmark
outright (cheapest, fastest, 6/6), but it **fails L4**: when another agent holds the lock it
doesn't draft, it forces. So the routing call is
*task-dependent*: cheapest model for solo work, a collaboration-safe model once edits contend.
That safety tradeoff is invisible on a cost-quality chart and obvious on the ladder. **A good
model isn't the smartest-sounding one; it's the cheapest that safely completes the hardest level
without corrupting shared state.**

The **notebook / cross-collaboration / risk-attack** harnesses are the sequenced next milestones;
the full task-ladder spec is in [`docs/AUDIT.md`](docs/AUDIT.md).

**Diagnosis wins (analyst, not guesswork — each found by the `probe.ts`, then fixed):**
- **Gemini 3.x thinking models** (`gemini-3.5-flash`, `gemini-3.1-flash-lite`) first failed —
  *"function call missing a thought_signature"*. They require their `thought_signature`
  round-tripped across tool turns; the harness now preserves provider metadata per tool call
  (`ToolCall.providerMetadata` → replayed in `toSdkMessages`). 2.5-class models don't need it.
- **`claude-*` 404'd locally** with a valid key → a stale shell `ANTHROPIC_BASE_URL` missing
  `/v1`; the runner now loads `.env.local` first (`loadEnv.ts`) so providers capture the right URL.
- Earlier: AI-SDK **version skew** (pinned providers to v2), OpenRouter **Responses→`.chat()`**,
  OpenRouter **lazy key** capture.

**Still open (documented, not hidden):**
- **`gpt-5.5`** (flagship *reasoning* model) hits the OpenAI-Responses-API analog of the Gemini
  issue — a `function_call` needs its reasoning item round-tripped. The metadata round-trip needs
  extending to OpenAI's reasoning path; the **GPT-5.4 tier works clean**.
- **OpenRouter free tier** is task-dependent. It is useful for explicit `/free`
  and budgeted background experiments, but the current v3 GTM research
  benchmark keeps it at 7/9 because it fails the content floor, and the live
  L1-L4 lock/CAS/draft ladder times out or fails on blocked-range behavior. Do
  not promote it as the default shared-room editor.

Model ids are **discovery-verified** (parallel subagents + a live probe corrected
`claude-*.5`→`claude-*-5`, dropped shut-down `gemini-3.1-flash-lite-preview`, added
`gemini-3.5-flash` / `gpt-5.5`). `modelCatalog.ts` is the single source of truth.

## Repo structure

```
noderoom/
├── src/
│   ├── engine/       # collaboration engine — CAS · lock · draft · smart-merge (pure, tested)
│   ├── nodeagent/    # canonical runtime — core · models · skills · components · guardrails
│   ├── shared/       # generic non-agent utilities (for example grid helpers)
│   ├── app/          # store (engine | Convex seam) · roomStore · main · styles
│   └── ui/           # Landing · RoomShell · Chat · Artifact · LeftRail
├── convex/        # live backend — schema + rooms · artifacts(CAS) · locks · drafts · messages · the agent action
├── evals/         # golden cases + the eval runner
├── demo/          # CLI: collaboration demo + agent demo
├── tests/         # 20 scenarios — engine · agent runtime · compaction
└── docs/          # AGENT_RUNTIME · AGENT_EVAL · DESIGN · STACK · WALKTHROUGH · ARCHITECTURE
```

## License

MIT © [Homen Shum](https://github.com/homenshum). Distilled from NodeBench AI / ScratchNode.
