# NodeRoom Mobile Behavior Inventory

Captured: 2026-07-09

This is the pre-implementation preservation ledger. `MobileHeader` and shell
CSS may adapt presentation only. Store/Convex calls remain in `MobileRoot` and
`MobileAppLive`.

## Entry And Session

| UI entry | Current transition/callback | Durable call | Source | Existing proof | Must survive |
|---|---|---|---|---|---|
| Phone-sized public URL | `normalizeMobileLandingUrl()` before app boot | none | route | `mobile-story-surfaces.spec.ts` | Standard room/create/demo intents normalize into `#mobile`; `surface=desktop` escapes. |
| `#mobile?mode=memory` | `MobileRoot -> MobileApp` | none | sample | mobile story + mobile gap tests | Deterministic visual/demo path stays explicitly sample-backed. |
| Live mobile route | `MobileRoot -> MobileLiveRoot` | Convex room query | live | design audit + routing tests | Live mode must never silently fall back to sample room data. |
| Join room | `JoinForm.onJoin -> start("join")` | `rooms.byCode`, `rooms.joinAnonymous` | live | routing/model tests; live e2e when env enabled | Validation, room-full errors, proof token, URL replacement. |
| Create route | `initialReq -> create` | `rooms.create` | live | design audit | Title/name/code and auto-allow policy preserved. |
| Start demo | `JoinForm.onDemo -> RoomJoinConsent` | `rooms.createStarterRoom` after consent | live | `mobileGapScreens`, live e2e | No room mutation before explicit auto/review choice. |
| Session restore | `loadSession(liveKey(code))` | localStorage + room subscription | live | routing tests | Existing live session resumes by code. |
| Leave | `leave()` | `rooms.leave`, clear local session | live | behavior audit | Leave remains reachable and returns to join state. |
| Live failure | `ErrorBoundary -> leave()` | cleanup only | live | component coverage | Revoked/stale proof does not strand a blank phone. |

## Shell And Navigation

| UI entry | Current transition | Durable call | Source | Existing proof | Preservation decision |
|---|---|---|---|---|---|
| Header mark | `setTab("home")` | none | both | indirect | Home stays reachable through bottom navigation; remove duplicate header command. |
| Room selector | `openSheet("rooms")` | none | both | mobile surface e2e | Becomes one transparent room-context control. |
| Dynamic header action | Jobs, Review, or notification toast based on tab/count | none | both | missing semantic regression | Replace with stable Review plus stable Overflow. |
| Pulse people | `openSheet("manage")` | none | both | gap screens | Move to Overflow > People. |
| Pulse agents | `openPulse("agents")` | none | both | gap screens | Move to Overflow > Room activity. |
| Pulse cost/jobs | `openPulse("cost")` or `openSheet("jobs")` | none | sample/live | gap screens | Move to stable Overflow > Usage/Jobs; no persistent strip. |
| Bottom tabs | `setTab(home/capture/room/agent/inbox/files)` | none | both | mobile story/full UX | Remain the only primary navigation set. |
| Quick-action FAB | Contextual action fan | callbacks below | both | full modern UX bar | Remains contextual; remove duplicate `Go to` navigation tier only. |

## Work And Communication

| Surface/action | State/callback | Live call | Honest sample behavior | Existing proof |
|---|---|---|---|---|
| Note capture/edit | `setNote`, extraction effects, save states | no live persistence exposed here | local sample extraction | mobile surface tests |
| Public message | `sendComposer` | `store.postMessage(public)` | appends local room message | mobile routing/full UX |
| Private agent | `sendAgent(private)` | private post + `store.askPrivateAgent` | local scripted reply | model-routing tests |
| Room agent | `sendAgent(room, model)` | public post + `store.askAgent(modelSelection)` | local scripted reply | `mobileAgentModelRouting.test.tsx` |
| Model selection | `mobileAgentModelSelection` | forwarded only for room agent route | visible selector | model-routing tests |
| Optimistic retry | `retryMessage(id)` | repost failed message | re-add local message | behavior path present; focused failure-state test remains desirable |
| Attachments | add/remove local attachment choices | no upload backend in mobile adapter | explicit local attachment UI | full UX path |
| Voice | `startVoice/stopVoice` and draft fill | no microphone backend claim | timed local affordance | interaction path present |
| Scope/lane | `scope`, `agentLane`, `composerMode` | selects public/private call | local state | model-routing tests |

## Artifacts And Governance

| UI entry | Callback/state | Live call | Live/sample status | Existing proof |
|---|---|---|---|---|
| Home recents | open deck/sheet/plan/evidence/room | live artifacts projected by `buildRecents`; otherwise sample | both | mobile deck/gap tests |
| Files | artifact list and open sheet | live recents where available | both; no fake live deck | `mobileDeckLive.test.tsx` |
| Row field edit | `editRowField` | `store.applyEdit` with CAS base version | live only; offline returns reason | agent routing/work-artifact tests |
| Flag review | `flagRowNeedsReview` | CAS status edit | live only | mobile gap tests |
| Deck review | plan/slides/comments/evidence, element request | derived live storyboard; proposal/trace IDs | live read-only until persistence/export receipt; sample only in memory | mobile deck live tests |
| Export | export intent in live; sample download copy in memory | no real live PPTX receipt yet | honest limitation | mobile deck live tests |
| Proposal open | `openInbox(item)` currently branches to artifact sheets | none until decision | both; live plan proposals do not resolve from that sheet | gap screens; adapter repair required |
| Proposal accept/reject | `resolveProposalById` | `store.resolveProposal` | host-only live; local memory resolution | agent routing/mobile deck tests |
| Jobs | `JobsSheet` currently reads static `D.JOBS`; `ctx.jobs/jobAct` already exist | existing cancel/retry long-free-job methods are not reached by current sheet | sample UI even in live mode; adapter repair required | gap screens |
| Trace | Trace list uses `ctx.traceRows`, but overlay currently resolves only static `D.TRACES` | live trace projection exists but live IDs can open an empty overlay | mixed; adapter repair required | work-artifact/semantic graph tests |
| Evidence/source | `openSource`, `startSearch`, `beginRun` | room agent/read-only run in live path | explicit source/fallback state | mobile deck/full UX |
| Plan/coach | open sheet/run prompt | agent request where invoked | live projection/sample | focused mobile tests |

## Collaboration, Policy, And Resilience

| UI entry | Callback | Live call | Status | Existing proof |
|---|---|---|---|---|
| People/presence | manage sheet, mention, pin | live member/session reads | live or labeled sample | gap screens |
| Share | copy invite URL/code | browser clipboard | live code or sample code | gap screens |
| Auto-allow | `setAutoAllow` | `store.toggleAutoAllow` only on desired-state change | live; local memory toggle | gap screens |
| Watches | `watchRow` | Convex `setWatch` with requester proof | live; local memory set | gap screens |
| Notification tiers | settings rows | backed only when live proof exists | memory explicitly says preview-only | gap screens |
| Offline-held edits | banner/conflict acknowledgement | existing offline queue callbacks | live snapshot only | gap screens |
| Gestures | swipe/watch/review affordances | delegates to watch/review callbacks | both | `mobileGapScreens.test.tsx` |
| First join | once-per-session overlay | sessionStorage marker only | live only | live mobile e2e |
| Room switch/join/leave sheet | `switchRoom`, `joinRoom`, `leaveRoom` | live leave callback where bound | both | mobile surface tests |
| Settings | tweak state + `saveTweaks` | localStorage only | both | settings rendering in gap tests |

## Pre-Existing Adapter Integrity Issues To Repair

- Review entry points must route to the real Inbox decision controls; opening a
  plan sheet and running the memory-mode animation is not equivalent to
  `store.resolveProposal`.
- Jobs must render `ctx.jobs` and call `ctx.jobAct` instead of hard-coded
  `D.JOBS` plus a toast.
- Live trace IDs need an honest summary overlay when no rich local `D.TRACES`
  fixture exists.
- The Ask visibility toggle must update composer route and agent lane together;
  it may never say `Private to you` while `composerMode === "room"` will post to
  the public channel.
- Live room switching remains a single-room binding. Join-another-room currently
  returns to the join form only through Leave; this limitation must be labeled
  or the existing leave callback reused, not represented as a successful switch.

## Preservation Gate

The migration may remove duplicate entry points, but not the destination or its
callback. The post-change tests must prove all six tabs, stable Review, Jobs,
People, activity, usage, Trace, Share, Settings, room switching, quick actions,
composer/model/voice, proposal decisions, live route wiring, offline state, and
governed artifact sheets remain reachable.
