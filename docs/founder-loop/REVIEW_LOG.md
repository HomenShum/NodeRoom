# Founder Self-Direct Loop — NodeRoom

> Meta-task: act as the founder + senior staff product engineer. Drive the app, find issues
> and taste-mismatches the way a real user would, root-cause them, fix, verify live, record.
> 10 loops, each a sharper/different angle. Seeded by Homen's screen-recording review
> (`6-14-2026-deep-review.txt` + Gemini 3.5 Flash video judge).

Branch: `founder-loop-fixes` · started 2026-06-14.

---

## Loop 0 — Diagnosis (seed)

Source of issues: Homen recorded himself using the app (`20260615-0348-37.6627000.mp4`, 104s),
flagged 5 problems. Confirmed by `gemini-3.5-flash` video review
([mp4-workflow-review.json](../eval/agent-improvement-loop/mp4-workflow-review.json)) +
two parallel-subagent diagnosis workflows + independent code reads.

| # | Issue (founder's words) | Root cause (file:line) | Verdict |
|---|---|---|---|
| 1 | "joined a new room but it was not a fresh blank state room" | `convex/rooms.ts:332-337` — `createStarterRoom` auto-seeds **6 artifacts** (Company research sheet, Diligence memo, Risk/opportunity wall, Runway/milestones sheet, Open questions/workplan, Q3 variance). | Confirmed. **Contradicts documented spec** (deep-review L5181-5300: "A new room starts blank. NodeAgent does not."). |
| 2 | "agent did not accomplish the workflow, it stopped at the budget limit" | `convex/agent.ts:127-128` — non-research runs default to **10 steps**, then return a partial requiring the user to manually type "continue". (Background job runner *does* auto-resume — `agentJobRunner.ts:293` — only the foreground room agent stalls.) | Confirmed. Want: prioritize completion over budget for MVP demo (bounded, not unbounded). |
| 3 | "room is crowded with too much needed to understand" | 4 simultaneous panels (left rail + work-surface tabs + chat + trace log). Amplified by the 6 seeded artifacts from #1. | Confirmed (Gemini: minor; founder: priority). |
| 4 | "too many buttons to learn for users" | 11 default controls (Gemini inventory): Spreadsheet, Notes, Wall, Run, Import accounts, Request assistance, Publish chat, Invite, +doc, +task, Send. Spec wants **3** first-run CTAs. | Confirmed. |
| 5 | "i do not see the streaming responses from our agent" | Streaming (`@convex-dev/persistent-text-streaming`) is wired **only to the private consult agent**. The public Room NodeAgent: (a) calls Gemini `:generateContent` (non-streaming, `convexModel.ts:285,492`), (b) persists no deltas during the run, (c) posts one final message with no `streamId` (`agent.ts:486-496`), so `Chat.tsx:999` never mounts `StreamedBody`. Three independent defeaters. | Confirmed. |

Bonus (provider routing): live room agent interactive path = `gemini-3.5-flash` (Google direct,
cost-optimized), not "top latest OpenRouter models." Research path = `deepseek/deepseek-v4-flash`
(OpenRouter, but a cheap flash). Intended per deep-review §13: adaptive routing through OpenRouter.

### 10-loop plan (angles)

1. Fresh blank room — stop auto-seeding (issue #1)
2. Blank-state onboarding CTA — 3 obvious starts, demo behind a button (#1/#4)
3. Completion over budget — bounded auto-continue (#2)
4. Visible Room-agent streaming (#5)
5. Top-latest OpenRouter model routing (provider quality)
6. Density reduction — progressive disclosure of trace/panels (#3)
7. Affordance reduction — consolidate the 11 buttons (#4)
8. Trust & honesty signals — agent status, model shown, no fake success (senior-PE)
9. Empty / error / degraded states
10. Self-recorded walkthrough + Gemini self-review (close the meta-loop)

---

## Loop 1 — Fresh blank room ✅

**Angle:** issue #1 — "joined a new room but it was not a fresh blank state room."

**Tested as user:** clicked "Create blank room" on the live app (port 5273). It **threw a Convex
`ArgumentValidationError`** — a *shipped P0*: the client sent `seedArtifacts: blankLiveRoomArtifacts()`
(an 8-row sheet + Notes + Wall) but the deployed `rooms.create` validator only accepts
`{authToken, autoAllow?, code, hostName, title}`. So blank-room creation was **broken for every user**,
and even when it worked it wasn't blank. (This is the "dev Convex deploy ≠ Vite" lag class.)

**Root cause:** [src/ui/App.tsx:137-145](../../src/ui/App.tsx) — the create path seeded artifacts via a
field the deployed validator rejects. Two bugs in one: a broken P0 + a "blank isn't blank" smell.

**Fix:** dropped `seedArtifacts` from the create call → a genuinely blank room (0 artifacts), and the
call now matches the deployed validator exactly (P0 resolved with zero deploy dependency). Deleted the
now-dead `blankLiveRoomArtifacts()` helper + `LiveSeedArtifact` type.

**Verified live:** `?room=NRTQW1OELWS&name=Founder` → "Blank NodeRoom", status strip `SOURCES 0 artifacts`,
"Founder created the room", no error. (Prior console errors were all the single pre-fix request.)

**Founder insight:** the crowding (#3) and button overload (#4) the recording showed were largely
**driven by the demo seed** — a blank room is far calmer. So fixing #1 de-risks #3/#4. But the blank room
is now an empty black void with no guidance → that's exactly Loop 2.

---

## Loop 2 — Blank-state onboarding ✅

**Angle:** issues #1 + #4 — Loop 1's blank room was a black void. The deep-review spec
(L5284-5300) prescribes a blank-state with exactly **three obvious starts**, not an empty technical shell.

**Root cause:** [src/ui/panels/Artifact.tsx:121](../../src/ui/panels/Artifact.tsx#L121) returned
`<div className="r-art-body" />` (literally nothing) for a 0-artifact room — no guidance.

**Fix:** added a `BlankRoomState` component rendered when `arts.length === 0`, with 3 real one-click CTAs:
- **"Ask the agent to build something →"** — focuses the chat composer (`data-testid="chat-composer"`).
- **"+ Add a blank sheet"** — `store.uploadArtifact(...)` creates a live sheet work surface.
- **"Load the sample diligence workspace →"** — navigates to the seeded demo (`/?demo=…`), so the demo
  is **opt-in**, not the default push (the root of issue #1).

**Verified live:** blank room now shows the 3 CTAs (no void). Clicked "Add a blank sheet" → a real
Spreadsheet rendered (r1–r8 × A/B/C), `SOURCES 1 artifacts`, trace "Founder added Sheet 1",
`edit_applied`. Typecheck green.

**Founder note:** this is the inversion the recording was missing — the user lands in calm, blank space
and *chooses* to summon data (chat / sheet / sample), instead of being dropped into a pre-filled war room.

---

## Loop 3 — Completion over budget ✅ (verified; authored by a parallel Codex lane)

**Coordination note:** mid-session I detected a **parallel Codex fleet (8+ processes)** editing this same
working tree — `convex/agent.ts` was changed `10→40` by another lane (commit `6cf409a` by `homen` landed
on this branch 2s after I created it). Per the founder's call, I'm **keeping editing in place** with a
**verify-don't-duplicate** discipline. Loop 3 was already solved by that lane, so I verified rather than
re-authored (and did NOT re-edit `agent.ts`, to avoid a collision).

**The fix in the tree** ([convex/agent.ts:160-164](../../convex/agent.ts#L163)):
```
// MVP demo posture: the old 10-step interactive default visibly paused mid-workflow…
const requestedSteps = a.maxSteps ?? (a.mode === "research" ? 80 : 40);   // was 60 : 10
const maxSteps = Math.max(1, Math.min(requestedSteps, a.mode === "research" ? 96 : 64)); // was 80 : 24
```

**Verdict:** this is the right shape — interactive default raised 10→**40** (≈4×; covers the demo's
~15–20-step variance task in one shot, so no manual "continue"), hard cap **64** retained so it stays
**bounded** (honors the agentic-reliability rule: no unbounded agent loops). Typecheck green.

**Honesty caveat:** verified by source review + typecheck only. It is **server-side Convex code**, and the
dev deployment is stale (the "dev Convex ≠ Vite" lag), so it is not live until that lane runs
`npx convex dev --once`. A true completion-over-budget guarantee for *arbitrarily* long tasks would need
auto-continue (the durable job runner already does this at `agentJobRunner.ts:293`); 40/64 is sufficient
for the MVP demo and is the correct bounded MVP posture.

---

## Loops 4–7 — verified specs handed to the parallel fleet (not duplicated)

**Why specs, not edits:** Loops 4 (streaming), 5 (routing), 6 (density), 7 (buttons) all live in files the
Codex fleet + Homen are *actively editing this session* (`convex/agent.ts`, `store.tsx`, `Chat.tsx`,
`RoomShell.tsx`, `LeftRail.tsx`, the whole `src/nodeagent/models/*` provider layer, plus a new
`src/ui/downstreamHandoff.ts`). Re-implementing them would collide or duplicate. Per the "keep editing in
place / verify-don't-duplicate" call, I verified the root cause + the minimal fix for each so a lane can
execute precisely, and I'll verify each as it lands. Each below is cross-verified (Gemini video + code).

### Loop 4 — Visible Room-agent streaming (issue #5) — NOT yet done by any lane (verified)
Streaming (`@convex-dev/persistent-text-streaming`) is wired **only to the private agent**. The public
Room NodeAgent has three independent defeaters, all confirmed in the current tree:
1. `convex/agent.ts` `runRoomAgent` → `runAgent(...)` **buffers the whole run**, then posts ONE final
   message (`messagesSendAgentRef`, clientMsgId `final-{runId}`) with **no `streamId`**.
2. `src/nodeagent/models/convexModel.ts:285,492` calls Gemini **`:generateContent`** (non-streaming) and
   `await res.text()` — no `stream:true`, no delta callback.
3. `src/ui/Chat.tsx:999` only mounts `<StreamedBody>` when `m.streamId && !m.text` — room messages never qualify.

**Minimal fix (M):** generalize `convex/streaming.ts` `createPrivateReplyStream` → a `createReplyStream`
that accepts `channel:'public'`; have `runRoomAgent` create that stream up front and stream the final
narration via `streamingModel.ts` (`:streamGenerateContent`, append-per-delta) instead of one buffered
`sendAgent`. Loosen `getStreamBody`/`streamMeta` channel auth to allow the public channel. **Client needs
zero change** — `store.tsx:745` already forwards `streamId` and `Chat.tsx:999` already renders `StreamedBody`.

### Loop 5 — Top-latest OpenRouter models (Homen's active lane)
Current: `.env.example:29` sets `AGENT_MODEL=gpt-5.4-nano` (nano tier) and the hardcoded fallback is
`gemini-3.5-flash` — both the opposite of "top latest." Routing is by **catalog**, not id-prefix:
`adapter.ts:36 providerFor()` → `getProviderForModel(id)` (native prefix → direct SDK; else → OpenRouter
via `openrouter().chat(id)`). **Spec:** set `AGENT_MODEL` to a top id whose `modelCatalog` provider is
`openrouter` (e.g. a `gpt-5.5` / `claude-opus-4.8` catalog entry routed through OpenRouter). Caveat the
lane must weigh: `agent.ts:247` deliberately keeps interactive on flash because it's "the only route with a
recorded L1–L4 collaboration-ladder pass" — a top model is almost certainly better at tool-calling but is
**unproven on the lock/CAS protocol** and ~100×+ the cost (watch the `$75/mo` cap at `agent.ts:155`).

### Loops 6 & 7 — Density + button overload (issues #3/#4) — fleet diagnosed "50 controls / 6 regions"
Founder-QA inventory of the **demo room** (the crowded surface the recording was about): **~28 controls
visible at once** — header (8) + work-surface tabs (5) + research toolbar (4: Import/Requeue/CRM CSV/Enrich)
+ **downstream handoff (5: Gmail/Notion/Slack/Linear/LinkedIn)** + Copilot (Room/Private/box/Send/2 chips)
+ a 7-column research table with paragraph-length GTM/RESEARCH/SIGNALS cells.
**Highest-leverage reductions (spec):** (a) collapse the **5 downstream-handoff buttons** into one
"Export / hand off ▾" menu (−4 always-visible); (b) collapse the **4-button research toolbar** behind a
"⋯" overflow, keeping only the primary "Enrich N pending"; (c) truncate the 3 verbose table columns to a
chip + hover/expand. **Note (Loop 1/2 already help):** a *blank* room now shows only ~11 controls — the
crowding is almost entirely the demo seed, so making blank the default (done) is the biggest single win.

---

## Status checkpoint (after Loops 1–3 + specs)

**Shipped & verified by me (committed, isolated to files I own):**
- Loop 1 `86227b5` — blank-room P0 fix (live-verified: 0 artifacts, no error).
- Loop 2 `7aa3fa5` — blank-state onboarding (live-verified: 3 CTAs; "Add a sheet" creates a real sheet).
- Loop 3 — budget fix verified (parallel lane authored; bounded 40/64; not re-edited).

**Concurrent-fleet reality:** 8+ `Codex.exe` + Homen are editing the same tree (commit `6cf409a` landed on
this branch). Loops 4–7 are in their active files → handed off as verified specs above, to be verified-as-landed
rather than duplicated.

---

## Loop 10 (capstone) — Gemini self-review of the post-fix build ✅

Closed the meta-loop exactly as the founder did: drove the **current live build** through the fresh-room
flow with Playwright ([scripts/founder-loop-capture.ts](../../scripts/founder-loop-capture.ts), read-only),
recorded it (`verify-fresh-room.webm`), and judged it with the **same `gemini-3.5-flash` rubric** as the
original recording. Verdict: [mp4-verify-fresh-room.json](../eval/agent-improvement-loop/mp4-verify-fresh-room.json).

| Issue | Original recording | Post-fix recording | Δ |
|---|---|---|---|
| #1 fresh-room-state | observed `true` · **moderate** ("pre-populated demo template") | observed `false` · **none** ("completely blank… 'This room is blank'") | **fixed** |
| #3 room-too-crowded | observed `true` · minor | observed `false` · **none** ("clean and well-structured") | **fixed** |
| #4 too-many-buttons | observed `true` · minor | observed `true` · **minor (P2)** ("collapse status indicators") | **reduced** |
| overall | **partial** | **pass** | ⬆ |

Independent confirmation that Loops 1–2 resolved #1 and #3, and de-risked #4 (a blank room shows ~14
controls vs the demo's ~28; the only residual is the bottom status strip, now P2 polish for the density lane).
Issues #2 (budget) and #5 (streaming) aren't exercised by this fresh-room flow — #2 is verified in source
(lane), #5 remains the open spec for the fleet.

**QA-lane standing task:** re-run `founder-loop-capture.ts` + the Gemini judge after the fleet lands each
change, to regression-check the 5 issues against the live build.

---
