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

Agent writes land as evidence-bearing cells or host-review proposals. The host approves in context. Downstream cards prepare Gmail, Notion, Slack, Linear, LinkedIn, and CRM CSV drafts, with no live external side effects.

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
- `docs/eval/MEDIA_JUDGE.md` is the latest stable media judge report; run `20260614T233419Z` rates both startup MP4s publishable (`10.9/16` live join, `11.7/16` war room), with three P2 presentation-polish notes: rapid user-perspective transition, dense trace text, and a subtle Public-to-Private switch.
- `scripts/walkthroughs/specs.ts` has two startup clips: `startup-diligence-live-join` for live join, and `startup-diligence-war-room` for the broader scripted synthesis story.
- 2026-06-14 target alignment update: the scripts and regenerated MP4/GIF files now follow the CardioNova/bulk diligence/runway/no-clobber/private-handoff sequence from the deep review.
- The proof boundary is explicit in `docs/eval/startup-diligence-war-room-live.json`: live shell proof, deterministic UI proof, Convex contract proof, and one provider-produced CellPayload/final-copy proof are in hand; repeated N=5/p95 provider stability remains the next promotion gate.
- Remaining demo polish: combine the join beat with the synthesis/private/downstream story, add a stronger public/private lane transition, or add walkthrough-specific zoom/callouts for dense trace panels.
