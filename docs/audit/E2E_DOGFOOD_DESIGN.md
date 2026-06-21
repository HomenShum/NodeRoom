# E2E Dogfood Harness — Design

**Status:** historical design plus active gap register
**Owner:** infra/test
**Current note:** The original scope sentence below is historical. There is now
Playwright coverage for production-preview memory mode and a live two-context
spreadsheet presence spec; the remaining gap is broad live Convex coverage for
privacy, wall, job controls, optimistic failure/retry, proposals, and agent
intent conflict flows.
**Historical scope:** this doc originally specified the missing end-to-end dogfood layer. `convex-test` and `vitest run` still cover backend/unit logic, while Playwright now covers production-preview memory mode and a narrow live two-context presence path. The remaining high-value gap is broader React UI coverage against a running Convex backend for privacy, wall, job controls, optimistic failure/retry, proposals, and agent intent conflict flows.

**2026-06-09 update:** later branch work added some Chat/job-control
`data-testid` hooks. The design remains current because the missing layer is a
committed real-browser harness and consuming assertions, not a total absence of
test hooks.

**2026-06-20 update:** the missing layer is no longer zero-state:
`e2e/realtime-presence.spec.ts` now proves live two-context spreadsheet presence
and one visible edit path. `npm run test:product:memory` covers production-preview
memory-mode chat, workbook, privacy/job/wall/proposal, responsive, and split
surface paths. Note-editor blur-commit specs below are legacy TipTap fallback
coverage only; native notebook collaboration should be tested through
ProseMirror Sync dirty metadata and read-model/proposal flows.

---

## 0. Why this doc exists — the gap, stated precisely

NodeRoom is a *real-time, multi-actor, optimistic* collaborative app. The interesting behavior lives in the seam between three things that no current test touches at once:

1. **React rendering** of reshaped Convex data (`src/app/store.tsx` `ConvexStoreProvider:297` reads `api.rooms.full` and a fan of channel/trace/run/job/proposal queries).
2. **Optimistic updates** held in the Convex client and atomically swapped on server confirmation.
3. **Cross-actor reactivity** — actor A's mutation must reactively appear in actor B's open subscription.

Today's stack proves none of that:

| Tool installed | Version | Proves | Cannot prove |
|---|---|---|---|
| `convex-test` | `0.0.53` | Pure function behavior, auth gates, channel-leak rules, CAS/idempotency math — **in an in-memory mock** | No browser, no React, no Convex client, **no optimistic update, no reactivity**. It calls handlers directly. |
| `vitest` | `2.1.8` | Node-side unit/logic tests (`tests/*.test.ts`) | No DOM rendering — Browser Mode is not configured, and 2.1.8's Browser Mode is still experimental. |
| Playwright | `@playwright/test` installed; `playwright.config.ts` present | Production-preview memory-mode browser flows plus a narrow live two-context spreadsheet presence/edit path | Broad live Convex dogfood for privacy, wall, job controls, optimistic failure/retry, proposals, and agent intent conflict flows. |

The original `data-testid` inventory is stale: core chat, proposal, trace, presence, and work-surface paths now have browser selectors. Selector coverage still needs to stay scoped to production workflows rather than becoming a parallel test-only UI API.

This design fills that gap with a three-layer pyramid, a concrete `data-testid` plan, five dogfood specs mapped to the **real** API surface, and the determinism scaffolding (seed/clear, anonymous identity, web-first waits, stubbed LLM) that makes the top layer reliable in CI.

---

## 1. The test pyramid for a Convex + React app

```
                 ┌─────────────────────────────────────────────┐
        TOP      │  Playwright  ×  real local Convex backend     │   5–8 specs
       (E2E)     │  real browser · real client · real reactivity │   slow, nightly + PR
                 │  two browser contexts · LLM stubbed at edge   │
                 └─────────────────────────────────────────────┘
              ┌──────────────────────────────────────────────────────┐
   MIDDLE     │  Vitest Browser Mode component tests (real DOM)        │   ~20–40 tests
 (component)  │  render <Chat/>, <Artifact/> with a fake store         │   fast, every push
              │  assert markup, a11y, optimistic-render shape locally  │
              └──────────────────────────────────────────────────────┘
        ┌────────────────────────────────────────────────────────────────┐
 BASE   │  convex-test (in-memory) — function · auth · channel-leak · CAS   │   many, ms each
        │  messages.send idempotency · artifacts.applyCellEdit CAS gate     │   every push
        │  rooms.full requireActorProof · resolveProposal authz             │
        └────────────────────────────────────────────────────────────────┘
```

### Base — `convex-test` (already present, keep + extend)
**What only this layer can prove:** server-side correctness in isolation, deterministically, at millisecond cost. It runs the actual handler code against an in-memory data model.
- `messages.send` (`convex/messages.ts:21`) is idempotent on `clientMsgId` — the same key collapses to one row (`sendCore` returns the existing `_id` at `messages.ts:22`). This is the invariant that makes the optimistic insert safe to reconcile.
- `artifacts.applyCellEdit` CAS gate (`convex/artifacts.ts:211`): `if (actual !== a.baseVersion) return { ok:false, reason:"conflict" }`. Plus the lock gate (`artifacts.ts:205`) and the agent-without-autoAllow → `pending_approval` proposal branch (`artifacts.ts:215-224`).
- `rooms.full` (`convex/rooms.ts:69`) calls `requireActorProof` and `messages.list` (`messages.ts:39-40`) calls `requireActorCanUseChannel` — so a wrong/forged proof or a foreign private channel is rejected **server-side**.

**What it categorically cannot prove:** there is no browser, no React reconciler, and **no Convex client**, so optimistic updates and reactive subscriptions simply do not exist in this layer. A green `convex-test` says nothing about whether the optimistic message bubble appears, reconciles, or rolls back.

### Middle — Vitest Browser Mode component tests (to add)
**What only this layer can prove:** that a presentational component, given a known `RoomStore`, renders the correct DOM, the correct ARIA, and the correct *local* optimistic shape — fast, with no backend. We render `<Chat/>` / `<Artifact/>` wrapped in a **fake `useStore()`** provider and assert real DOM in a real (headless) browser engine.
- Example: feed `<Chat/>` a store whose `listMessages` returns an optimistic row with `_id: "opt-..."` and assert the bubble renders and the composer clears.
- Example: feed `<TraceStrip/>` (`Artifact.tsx:710`) a store with one pending proposal and assert an Approve/Reject card renders for a host and "awaiting host review" for a non-host (`Artifact.tsx:766-771`).

**What it cannot prove:** the *real* optimistic mechanism. The fake store fakes optimism; it does not exercise `withOptimisticUpdate` or the held-then-swapped lifecycle. Cross-actor reactivity is impossible (one render tree, no server). Component tests catch rendering regressions cheaply; they do not catch reconciliation bugs.

### Top — Playwright × a real (local) Convex backend (to add)
**What only this layer can prove — the whole reason the harness exists:**
1. **Real optimistic updates.** Convex's client holds the optimistic patch until *both* the mutation result and the affected query update arrive, then atomically swaps (per the Convex optimistic-update contract — see §3 docs). Only a real client driving a real backend exercises that lifecycle.
2. **Real reactivity across actors.** Two browser contexts = two members with distinct identities; a mutation in context A must reactively surface in context B's open `useQuery`.
3. **Optimistic *rollback*.** When a mutation is rejected at the network edge, the held optimistic patch must revert and the UI must show the server truth. This is the single highest-value, currently-untested behavior.
4. **End-to-end agent flow.** `/ask` → `agent.runRoomAgent` (action) → proposal insert (autoAllow off) → host accept → applied edit → trace row. This spans an `action`, two idempotency mutations (`convex/agent.ts:130`, `:160`), a query refresh of `rooms.full` (`agent.ts:69`), and three reactive UI surfaces.

---

## 2. The five critical dogfood flows (Playwright specs)

All specs target the **real API surface** that the UI actually calls (confirmed in `src/app/store.tsx`):
`rooms.byCode`, `rooms.joinAnonymous`, `messages.send`, `agent.runRoomAgent`, `agentJobs.startFreeAuto`, `artifacts.listProposals` / `resolveProposal` / `applyCellEdit`, `collab.traces`, `agentRuns.list`.

The **identity primitive** every spec uses: a member is created via `rooms.joinAnonymous` (`convex/rooms.ts:28`), which returns `{ roomId, memberId }`. The client then builds `proof = { actor: { kind:"user", id: memberId, name, scope:"public" }, token: authToken }` (`store.tsx:84`, `ConvexStoreProvider:297`). The **private channel is keyed on `me.id` = the memberId** (`store.tsx:301` `privQuery = { channel: me.id }`). So per-context identity = per-context `{ memberId, authToken }` pair. This is what makes spec (e) — the leak test — possible without real auth.

> **Optimism map (do not get this wrong).** `applyCellEdit` (`store.tsx:312`) is the optimistic write path for **all** artifact elements: the UI `commit()` helper (`Artifact.tsx:398`) → `store.applyEdit` (`store.tsx:366`) → `applyCellEdit`. So **note editing** (`Artifact.tsx:588` blur-commit), **post-it text** (`Artifact.tsx:688`), **post-it drag** (`Artifact.tsx:642`), **spreadsheet cells**, and **element create/delete** (`Artifact.tsx:403/406`) are **already optimistic**. The genuinely *non-optimistic* mutations are the seven hooks at `store.tsx:332-340`: `toggleAutoAllow(332)`, `editMsg(333)`, `resolveProposal(334)`, `addResearchRows(335)`, `createArtifact/upload(336)`, `runAgent` action(337), and job `start/cancel/retry(338-340)`. Specs below are written with this in mind — e.g. spec (b)/(c) verify *persistence + reconciliation* of an already-optimistic path, not "add optimism."

### (a) `chat-agent-proposal.spec.ts` — chat send → agent run → cell proposal → accept → trace
Pre-state: room created with `autoAllow = false` (so agent edits become proposals, per `artifacts.ts:215`). One host context.

| Step | Action (real API behind it) | Web-first assertion |
|---|---|---|
| 1 | Type `/ask reconcile Q3 variance` in composer (`composer` testid), press Enter | `message-bubble` containing the text is visible (optimistic insert via `sendMsg`, `store.tsx:327`) |
| 2 | The `/ask` branch fires `store.askAgent` → `runAgent` action `api.agent.runRoomAgent` (`store.tsx:337`, `Chat.tsx:79`) | `agent-thinking` indicator visible (`Chat.tsx:231`), then hidden |
| 3 | Agent (LLM stubbed, §3) calls `edit_cell`; with autoAllow off the backend inserts a proposal (`artifacts.ts:216-224`) → reactive `listProposals` (`store.tsx:310`) | `proposal-card` visible; its text matches `proposed <elementId> = <value>` (`Artifact.tsx:765`) |
| 4 | Host clicks Approve (`proposal-approve` testid) → `resolveProposal(id, true)` (`store.tsx:334`, `Artifact.tsx:768`) | `proposal-card` disappears; target `cell` shows the new value |
| 5 | Reactive `collab.traces` (`store.tsx:304`) | a `trace-row` (`Artifact.tsx:784`) for the applied edit is visible; expand it and assert `tool`/`result` detail (`Artifact.tsx:792`) |

### (b) `note-persist.spec.ts` — legacy TipTap note edit persists across reload
The legacy TipTap fallback commits **on blur** (`Artifact.tsx:588` `onBlur: commit(... "doc", editor.getHTML())`), which is the optimistic `applyCellEdit` path. This is not the serious native notebook sync contract.

1. Focus the TipTap note (`note-editor` testid), type text, blur (Tab away) → optimistic `applyCellEdit`.
2. Assert text is present (optimistic).
3. **Reload the page** (`page.reload()`), re-join with the **same** `{ memberId, authToken }` (persisted in the fixture's storage state).
4. Assert the note text is still present — proving it round-tripped to the backend and survives a cold subscription (`rooms.full` → `elements`).

> Native notebook target: ProseMirror Sync owns live text, and actor-authenticated
> dirty metadata drives the read-model processor. Keep this blur-commit spec only
> for legacy/export/checkpoint fallback behavior.

### (c) `postit-crud.spec.ts` — post-it create / edit text / move / delete
All four are the optimistic `applyCellEdit` path (`create` → `Artifact.tsx:648`, text → `:688`, drag → `:642`, `delete` → `:657`).

1. Click "Post-it" (`postit-add` testid, `Artifact.tsx:663`) → `createElement` (kind `create`). Assert a new `post-it` appears optimistically.
2. Edit its `contentEditable` text (`post-it-text`), blur → optimistic text set. Assert new text.
3. Drag it (dnd-kit) → `onDragEnd` commits new `{x,y}` (`Artifact.tsx:642`). Assert position style changed.
4. Click delete (`post-it-delete`, `Artifact.tsx:686`) → `deleteElement` (kind `delete`). Assert the post-it is gone.
5. Reload → assert surviving post-its persisted (backend round-trip).

### (d) `concurrency-rollback.spec.ts` — multi-user concurrency + optimistic rollback
**Two browser contexts**, two distinct members joined via `rooms.joinAnonymous` (distinct `memberId`/`authToken`). This is the spec only the top layer can express.

Part 1 — reactivity:
1. Context A edits a `cell` → optimistic locally.
2. Assert Context B's **same cell** reactively shows A's value (no reload). Proves cross-actor `rooms.full` reactivity.

Part 2 — optimistic rollback (the headline test):
3. In Context A, install a Playwright **route interception** that aborts/500s the next `applyCellEdit` mutation request (Convex mutations go over the WS/HTTP sync endpoint; intercept that request — see §3 for the exact matcher).
4. Context A edits the cell to value `X` → optimistic patch shows `X` immediately.
5. The mutation is rejected at the edge → the held optimistic patch is discarded on the failed swap → assert the cell **reverts** to the prior server value (not `X`), and an error surfaces (`editErrorMsg`, `Artifact.tsx:411`, surfaced for sticky/note via the `r-wall-error` path; for sheet cells via the cell's feedback).
6. Assert Context B **never saw** `X` (it was optimistic-only in A, never committed).

This is also where the **CAS conflict** path can be exercised honestly: have B commit the real change first, then A commit a stale `baseVersion` → backend returns `{ ok:false, reason:"conflict" }` (`artifacts.ts:211`) → A's UI reverts and shows the conflict message (`Artifact.tsx:412`). No route interception needed; it's a *real* server rejection.

### (e) `public-private-leak.spec.ts` — anonymous join must not see foreign private content
Two anonymous members, distinct `sessionId`/`memberId`. The private channel is keyed on the member's own id (`store.tsx:301`), and `messages.list` enforces `requireActorCanUseChannel` (`messages.ts:40`).

1. Member A sends a message into A's private channel (`channel = A.memberId`).
2. Member B sends into B's private channel.
3. Assert B's UI **never renders** A's private message — B's `messages.list` query is `{ channel: B.memberId }`, and the server rejects a request for `channel: A.memberId` from B's proof.
4. Negative-path hardening: drive a direct client call from B's context requesting `messages.list({ channel: A.memberId, requester: B.proof })` and assert it **throws / returns no rows** (the auth gate, not just the UI hiding it). This proves the leak protection is server-enforced, not a render-time filter.
5. Also assert `collab.traces` / `agentRuns.list` honor the same `requester` proof — a member only sees room-scoped trace, never another member's private draft (`rooms.full` already masks private drafts: `rooms.ts:90` `note: scope==="private" ? "[private draft]"`).

---

## 3. Determinism — making the top layer reliable in CI

The top layer is only worth having if it is **deterministic**. Five rules:

### 3.1 `IS_TEST`-gated `seed()` / `clearAll()` testing mutations
Add `convex/testing.ts`, exporting mutations built with `convex-helpers`' `customMutation` so they are **trivially strippable / guarded** and never reachable in production:

```ts
// convex/testing.ts  — only callable when CONVEX env IS_TEST === "true"
import { customMutation } from "convex-helpers/server/customFunctions";
import { mutation } from "./_generated/server";

const testOnly = customMutation(mutation, {
  args: {},
  input: async () => {
    if (process.env.IS_TEST !== "true") throw new Error("testing mutations disabled");
    return { ctx: {}, args: {} };
  },
});

export const clearAll = testOnly({ args: {}, handler: async (ctx) => { /* delete all rows in every table */ } });
export const seed = testOnly({
  args: { /* room code, host name, sheet/wall/note seeds, autoAllow */ },
  handler: async (ctx, a) => { /* deterministic room + members + artifacts + public agent session */ },
});
```

`seed` returns the fixed `{ roomId, code, hostMemberId, hostToken, sheetArtifactId }` the specs expect, so no spec depends on UUIDs or wall-clock ordering. The Convex dev/test server is launched with `IS_TEST=true`; the prod deploy never sets it, so `clearAll`/`seed` hard-fail there. (`convex-helpers` is the canonical pattern for env-gated test functions — Convex testing docs, §References.)

> **Note on the public agent session:** `agent.runRoomAgent` requires a `scope:"public"` agent session to exist (`convex/agent.ts:74-75` throws `agent_session_mismatch` otherwise). `rooms.create` inserts both sessions (`rooms.ts:21-22`), so `seed()` must do the same, or spec (a) cannot start an agent.

### 3.2 Anonymous join + per-context `sessionId` as the identity primitive
No real auth in tests. Each Playwright **browser context** = one identity:
- `seed()` creates the room + host.
- Each additional actor calls `rooms.joinAnonymous({ code, name, authToken })` (`rooms.ts:28`) → `{ memberId }`.
- The fixture writes `{ memberId, authToken, name }` into that context's app storage so the React app boots straight into the room with `proof = { actor:{ kind:"user", id: memberId, name }, token: authToken }`.
- Distinct contexts ⇒ distinct `memberId` ⇒ distinct private channel ⇒ spec (e) is meaningful.

This mirrors production's intent: `joinAnonymous` is explicitly the stand-in for `@convex-dev/auth`'s Anonymous provider (`rooms.ts:2-3`).

### 3.3 WAIT-ON-REACTIVE web-first assertions — never `sleep`
Convex is reactive and optimistic, so there is **no fixed delay** that is both fast and safe. Every assertion uses Playwright web-first auto-retrying expects:
```ts
await expect(page.getByTestId("proposal-card")).toBeVisible();        // retries until the reactive query lands
await expect(page.getByTestId("cell-B7")).toHaveText("42");           // retries through the optimistic→server swap
await expect(page.getByTestId("proposal-card")).toHaveCount(0);       // retries until resolveProposal reconciles
```
Banned: `page.waitForTimeout(...)`, `sleep`. Enforced by an ESLint rule on the `e2e/` dir (`no-restricted-syntax` against `waitForTimeout`). The whole point of waiting on the reactive UI is that it self-synchronizes with backend confirmation; a sleep would either flake or slow every run.

### 3.4 `workers: 1` against one shared local backend
The specs share **one** local Convex backend and mutate global state via `seed`/`clearAll`. Running specs in parallel against shared state is non-deterministic. So: `workers: 1`, and a `clearAll()` + `seed()` in `beforeEach` (or per-spec fixture) gives each spec a clean, known room. Trade-off accepted: E2E is the slow nightly/PR layer, not the every-push layer — throughput is not its job; trust is.

### 3.5 Stub the LLM at the network edge
The agent action (`agent.runRoomAgent`) calls a model provider via the AI SDK (`@ai-sdk/google` default `gemini-3.5-flash`, `agent.ts:78`). For determinism and zero cost/flake:
- **Preferred:** point the agent at a fake model endpoint by env (`AGENT_MODEL` + a base-URL override) that the test harness serves — returns a canned tool-call sequence (`edit_cell` with a fixed element/value). The agent's CAS/lock/proposal logic then runs for real; only the *token stream* is canned.
- **Fallback:** Playwright `page.route()` to intercept the provider's outbound HTTP and fulfill with a fixture. (Works only when the call originates browser-side; the Convex action runs server-side, so the env-based fake endpoint is the robust path — interception is the fallback for any client-side model calls.)

Either way the LLM is never hit in CI. Spec (a)'s assertions are on the *deterministic downstream effect* (proposal → accept → trace), not on model prose.

**Route-interception target for spec (d):** Convex client traffic goes to the deployment's sync/mutation endpoint. The matcher is the deployment URL path for the function call (e.g. `**/api/mutation` or the WS frame for the sync protocol depending on transport). The fixture exposes a helper `failNextMutation(page, "artifacts:applyCellEdit")` that arms a one-shot `page.route` aborting the matching request, then auto-unroutes — so only the targeted optimistic write is rejected and the revert is observed.

---

## 4. The `data-testid` plan (exact ids + attachment point)

Currently **zero** testids exist in `src/`. Add stable hooks at these precise sites. Class-based selectors (`.r-send`, `.r-proposal`) are brittle against the hand-tuned CSS; testids are the contract.

| `data-testid` | Component / file | Exact attachment site |
|---|---|---|
| `composer` | `src/ui/Chat.tsx` | the `<textarea ref={taRef}>` at `Chat.tsx:265` |
| `send-button` | `src/ui/Chat.tsx` | `<button className="r-send" ...>` at `Chat.tsx:268` |
| `message-bubble` | `src/ui/Chat.tsx` | the `Bubble` root `<div className="r-msg">` at `Chat.tsx:296` (add `data-msg-id={m.id}` too, so optimistic `opt-…` ids are queryable) |
| `agent-thinking` | `src/ui/Chat.tsx` | the thinking row `<div className="r-msg agent">` at `Chat.tsx:231` |
| `proposal-card` | `src/ui/panels/Artifact.tsx` | `ProposalRow` root `<div className="r-proposal">` at `Artifact.tsx:762` (add `data-proposal-id={proposal.id}`) |
| `proposal-approve` | `src/ui/panels/Artifact.tsx` | Approve `<button>` at `Artifact.tsx:768` |
| `proposal-reject` | `src/ui/panels/Artifact.tsx` | Reject `<button>` at `Artifact.tsx:769` |
| `proposal-accept-all` | `src/ui/panels/Artifact.tsx` | "Accept all" `<button>` at `Artifact.tsx:738` |
| `trace-row` | `src/ui/panels/Artifact.tsx` | `TraceRow` button `<button className="r-trace-row">` at `Artifact.tsx:784` (add `data-trace-type={t.type}`) |
| `post-it` | `src/ui/panels/Artifact.tsx` | `Sticky` root `<div className="r-postit">` at `Artifact.tsx:684` (add `data-postit-id={id}`) |
| `post-it-text` | `src/ui/panels/Artifact.tsx` | the `contentEditable` `<div className="pt-text">` at `Artifact.tsx:687` |
| `post-it-delete` | `src/ui/panels/Artifact.tsx` | delete `<button className="r-postit-delete">` at `Artifact.tsx:686` |
| `postit-add` | `src/ui/panels/Artifact.tsx` | "Post-it" add `<button>` at `Artifact.tsx:663` |
| `note-editor` | `src/ui/panels/Artifact.tsx` | the `EditorContent` wrapper `<div className="r-note">` at `Artifact.tsx:591` |
| `cell-<addr>` | `src/ui/panels/Artifact.tsx` | each spreadsheet cell in the sheet `<tbody>` (`Artifact.tsx:~390`) — `data-testid={"cell-" + elementId}` so `getByTestId("cell-B7")` is exact |
| `job-row` | `src/ui/Chat.tsx` | the long-job strip `<div className="r-job-strip">` at `Chat.tsx:180` (add `data-job-status={longJob.status}`) |
| `job-cancel` | `src/ui/Chat.tsx` | cancel `<button>` at `Chat.tsx:168` |
| `job-retry` | `src/ui/Chat.tsx` | retry `<button>` at `Chat.tsx:173` |
| `autoallow-switch` | `src/ui/RoomShell.tsx` | the `<button className="r-switch">` at `RoomShell.tsx:107` (needed to flip autoAllow for spec (a) setup if not seeded off) |

Convention: prefer `getByRole`/`getByLabel` where strong ARIA already exists (`aria-label="Send message"` at `Chat.tsx:268`, `aria-label="Room activity log"` at `Artifact.tsx:741`); add `data-testid` where role/label is ambiguous or dynamic (cells, proposals, bubbles, post-its, job rows). Both can coexist.

---

## 5. File tree, configs, scripts, CI

### 5.1 New files
```
convex/
  testing.ts                      # IS_TEST-gated seed() / clearAll() via convex-helpers customMutation
e2e/
  fixtures.ts                     # Playwright test fixtures: per-context identity, seeded room, failNextMutation()
  backendHarness.ts              # boot/teardown a local Convex backend for the run; expose deployment URL
  chat-agent-proposal.spec.ts     # flow (a)
  note-persist.spec.ts            # flow (b)
  postit-crud.spec.ts             # flow (c)
  concurrency-rollback.spec.ts    # flow (d)
  public-private-leak.spec.ts     # flow (e)
src/
  test/component/                 # Vitest Browser Mode component tests (middle layer)
    Chat.browser.test.tsx
    Artifact.browser.test.tsx
    fakeStore.tsx                 # a RoomStore stub for component rendering
playwright.config.ts
vitest.config.ts                  # add test.projects split (node | browser)
```

### 5.2 `vitest.config.ts` — projects split
Split the suite so the existing fast Node tests and the new browser tests run as distinct projects (the convex-test/unit suite stays headless and fast; the component suite needs a browser provider):
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        // BASE + Node logic: convex-test + tests/*.test.ts
        test: { name: "node", environment: "edge-runtime", include: ["tests/**/*.test.ts", "convex/**/*.test.ts"] },
      },
      {
        // MIDDLE: real-DOM component tests
        test: {
          name: "browser",
          include: ["src/test/component/**/*.browser.test.tsx"],
          browser: { enabled: true, provider: "playwright", instances: [{ browser: "chromium" }] },
        },
      },
    ],
  },
});
```
> `convex-test` runs under the edge-runtime VM (`@edge-runtime/vm` is already a devDependency, matching Convex's recommended environment).

### 5.3 `playwright.config.ts` — with `webServer`
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,                         // §3.4 — shared local backend, serialized
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:5260", trace: "on-first-retry" },
  webServer: [
    {
      // local Convex backend (seed/clear enabled)
      command: "npx convex dev --once && npx convex dev",  // or convex-local-backend; IS_TEST=true in env
      env: { IS_TEST: "true", AGENT_MODEL: "fake-local" },
      url: "http://127.0.0.1:3210",   // convex local backend port
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run preview",     // vite preview on :5260 (strictPort already set in package.json)
      url: "http://localhost:5260",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
```

### 5.4 `package.json` script additions
```jsonc
{
  "scripts": {
    // existing: "test": "vitest run", ...
    "test:node":      "vitest run --project node",
    "test:component": "vitest run --project browser",
    "test:e2e":       "playwright test",
    "test:e2e:ui":    "playwright test --ui",
    "test:all":       "npm run test:node && npm run test:component && npm run test:e2e"
  }
}
```
New devDependencies: `@playwright/test`, `convex-helpers` (for `customMutation`), and the Browser Mode provider (`@vitest/browser` + `playwright`). **Vitest must be upgraded — see §6.**

### 5.5 CI job split — fast every push, E2E on PR/nightly
```yaml
jobs:
  fast:                       # every push — the pyramid's base + middle
    steps:
      - run: npm run typecheck
      - run: npm run test:node
      - run: npm run test:component       # headless chromium via playwright provider
  e2e:                        # PRs to main + nightly cron — the top
    if: github.event_name == 'pull_request' || github.event_name == 'schedule'
    steps:
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e             # webServer boots local Convex (IS_TEST=true) + vite preview
```
Rationale: the base/middle layers are fast and deterministic enough to gate every push; the top layer (boots two servers, two browser contexts, stubbed LLM) is slower and is reserved for PR + nightly so it never bottlenecks inner-loop pushes — while still blocking any merge to `main`.

---

## 6. Vitest 2.1.8 → 4 upgrade (required for stable Browser Mode)

The repo pins `vitest@^2.1.8` (`package.json:73`). **Browser Mode is experimental in v2** and the stable, supported Browser Mode (with `test.projects`, the `browser.instances` API, and first-class Playwright provider) ships in **Vitest 4**. The middle layer of this pyramid depends on it. Plan:
- Bump `vitest` to `^4`, add `@vitest/browser@^4` and `playwright`.
- Migrate config to the `test.projects` form shown in §5.2 (v3+ renamed `workspace` → `projects`; the `browser.instances` array is the v4 shape).
- Re-run the existing `tests/**` suite under the new `node` project to confirm no regressions before adding browser tests.
- This is a contained devDependency upgrade; it does not touch the Convex `^1.31.0` (1.40.0 installed) client or its optimistic API.

---

## References (Convex testing docs — cite in PR)
- Convex testing overview: https://docs.convex.dev/testing
- `convex-test` (in-memory backend for function tests): https://docs.convex.dev/testing/convex-test
- Testing against a **local** Convex backend (the top-layer dependency): https://docs.convex.dev/testing/convex-backend
- Optimistic updates (the contract the rollback spec verifies — held until result + query update, then atomic swap; `localStore.getQuery/setQuery/getAllQueries`, paginated helpers): https://docs.convex.dev/client/react/optimistic-updates
- `convex-helpers` custom functions (`customMutation`, used for the `IS_TEST`-gated `seed`/`clearAll`): https://www.npmjs.com/package/convex-helpers
- Playwright web-first assertions (the no-sleep auto-retry contract): https://playwright.dev/docs/test-assertions
- Vitest Browser Mode (stable in v4, the upgrade in §6): https://vitest.dev/guide/browser/
