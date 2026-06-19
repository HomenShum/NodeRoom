# Startup Diligence War Room Demo Plan

Status: next product/demo push plan. This is a truthful demo script, not a production-completeness claim.

## Demo Thesis

Traditional startup diligence is split across calls, CRMs, spreadsheets, source tabs, Slack, email, decks, and memos. NodeRoom makes the room itself the operating system: people, agents, artifacts, evidence, review, and handoff live together.

## Persona

- Primary: startup banker or innovation-economy coverage lead.
- Secondary: GTM sales ops lead managing account research and prioritization.
- Secondary: finance operator reconciling uploaded workbooks and evidence.

## Setup

Use a fresh live "Startup Banking Diligence War Room" room with:

- A visible host create flow and a second-user join-by-code flow.
- Source files or fixture references.
- Company research sheet with company, website, owner, tier, recent signal, sources, freshness, CRM status, and status columns.
- Shared note titled "Diligence memo".
- Wall with risk/opportunity post-its.
- Q3 variance / runway-style sheet retained as the finance and no-clobber proof surface.
- Public Room NodeAgent and private per-user NodeAgent lanes.
- Signal tape or trace panel visible enough to show locks, reads, writes, proposals, and handoff.

## Three Act Walkthrough

### Act 1: Intake

The host imports or pastes a short account list. The sheet updates existing accounts instead of duplicating them. The room trace records the import and the selected artifact remains clickable.

### Act 2: Multi-Agent Diligence

The host asks: "Research these accounts, cite sources, update the sheet, and draft an IC memo." The work queue fans out into research, finance, source QA, and no-clobber proof lanes. The viewer should see concurrent progress, not a single opaque spinner.

### Act 3: Review And Handoff

Agent writes land as evidence-bearing cells or host-review proposals. The host
approves in context. The research handoff bar prepares Gmail, Notion, Slack,
Linear, and LinkedIn markdown drafts; CRM CSV is a separate export/menu path.
Banker Coach packet generation can cover all six targets, still with no live
external side effects.

## Required Proof Shots

- Artifact binder with source files, workbook/sheet, memo, wall, proof/trace.
- Sheet cells with evidence/confidence/status, not just scalar values.
- Public and private agent lanes both visible.
- Work queue with multiple concurrent lanes and per-lane receipts.
- Proposal chip next to the changed cell.
- Trace row showing read set, write set, model route, and resolved model.
- Downstream handoff card clearly labeled "draft".

## Claims To Avoid

- Do not claim live OAuth publishing.
- Do not claim JPM affiliation.
- Do not claim official benchmark scores.
- Do not claim full public token streaming.
- Do not show private source content in the public room.

## Current Capture Inputs

- `docs/walkthroughs/startup-diligence-live-join.mp4` and `docs/walkthroughs/startup-diligence-war-room.mp4` are the flagship media assets for this story.
- `docs/demo/STARTUP_DILIGENCE_LATEST_REVIEW.md` is the current safe-claims boundary for narration, README copy, and interview notes after OKF production hardening.
- `docs/walkthroughs/startup-diligence-live-join.mp4` and `.gif` now show the live room create/code/join path with Maya, Priya, and Alex.
- Media evidence is split by asset: live-join remains covered by run
  `20260614T233419Z` (`publish`, `10.9/16`, one P2 transition note), while the
  current war-room asset is covered by run `20260617T2015Z` (`publish`,
  `10.4/16`, no defects reported).
- `scripts/walkthroughs/specs.ts` has two startup specs:
  `startup-diligence-live-join` for live join and
  `startup-diligence-war-room` for the broader scripted synthesis story.
  Current Remotion generated data includes the war-room asset; regenerate
  Remotion data before claiming the live-join clip is in the active render set.
- 2026-06-14 target alignment update: the scripts and regenerated MP4/GIF files now follow the CardioNova/bulk diligence/runway/no-clobber/private-handoff sequence from the deep review.
- The proof boundary is explicit in `docs/eval/startup-diligence-war-room-live.json`: live shell proof, deterministic UI proof, Convex contract proof, and one provider-produced CellPayload/final-copy proof are in hand; repeated N=5/p95 provider stability remains the next promotion gate.
- Remaining demo polish: combine the join beat with the synthesis/private/downstream story, add a stronger public/private lane transition, or add walkthrough-specific zoom/callouts for dense trace panels.
