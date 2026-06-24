# NodeRoom agent runtime

This is the doc you read before you explain NodeRoom's agent out loud — in an interview, a design review, or to a new teammate. The goal is that you can draw the whole thing on a whiteboard and defend every box.

The hard problem NodeRoom solves: an LLM agent and a human are editing the same spreadsheet cell at the same time, and neither one is allowed to silently clobber the other. Everything below builds up to how that's guaranteed, and where the guarantee actually lives in the code.

In the battlefield flow, the user is not asking for a chatbot opinion. They are
asking for work in a live room: recompute a spreadsheet, research a company,
draft a note, review a private file, or coach a teammate. The happy path is:

```text
user intent
  -> optional Agent Work Plan artifact with planned reads/writes/evidence
  -> approval by structured plan hash, not by the pretty rendering
  -> NodeAgent bounded model/tool loop
  -> RoomTools checked reads, locks, CAS edits, drafts, and evidence writes
  -> traces and receipts now; planned-vs-actual review as the target follow-up
```

That is why the runtime is intentionally boring. The model may improvise inside
a bounded turn, but the room state changes only through typed tools and checked
backend functions.

Everything here is real, typechecked code you can run:

```
npm run demo:agent          # the harness, scripted model (no keys), two scenarios
npm run demo:agent -- --real  # the same harness on the configured real provider route
npm test                    # full Vitest suite
npm test -- --run tests/agentRuntime.test.ts tests/frameRunner.test.ts
```

---

## 1. Start with the simplest mental model: one loop, three seams

An agent is just a loop. You give a model some context, it asks to call a tool, you run the tool, you hand back the result, and you do it again until the model says it's done. That's it. If you can explain that loop, you can explain this system.

The current architecture keeps that loop small on purpose. Recursive context and
multi-frame reasoning live above it as a harness layer: durable frames,
`ContextPack`s, cache policy, verification, and job status are explicit
NodeAgent/Convex state, not hidden model memory.

NodeRoom's harness lives in `src/nodeagent/` and is deliberately tiny. The only thing that makes it interesting is that it has **three swappable seams** — three places where you can yank out the implementation and plug in a different one without touching anything else. That's what makes it both testable (swap in fakes) and shippable (swap in the real thing).

```
                 ┌──────────── runAgent (src/nodeagent/core/runtime.ts) ───────────┐
   buildContext  │   ① ask model → ② run tools → ③ feed results → loop    │
 (worldModel.ts) ─▶│   bounded by a step budget; conflicts come back as     │
                 │   DATA so the model re-reads and retries, never throws  │
                 └───────┬───────────────┬───────────────────┬───────────┘
                         │               │                   │
                  seam ① the model   seam ③ the tools    seam ② the backend
                  ───────────────    ───────────────     ────────────────
                  scriptedModel      read_range          InMemoryRoomTools
                  model()/convexModel propose_lock       (over RoomEngine)
                  (adapter.ts)       edit_cell  …        ConvexRoomTools
                                     (cellMutator.ts)    (over Convex)
```

Here are the three seams, defined in the header of `src/nodeagent/core/types.ts` (lines 4-10):

- **Seam 1 — the model** (`AgentModel`, `src/nodeagent/core/types.ts:43-46`). The brain. Current implementations include `scriptedModel` (deterministic, no network), `model(modelId)` for local/provider runs, and `convexModel(modelId)` for Convex actions. The loop doesn't care which it's holding.
- **Seam 2 — the tool backend** (`RoomTools`, `src/nodeagent/core/types.ts:75-92`). The thing the tools actually call. Two implementations: `InMemoryRoomTools` over the in-process engine (`src/nodeagent/skills/integration/noderoomAdapter.ts`) and `ConvexRoomTools` over Convex (`convex/convexRoomTools.ts`). Same interface, so the agent code is identical between the spike and production.
- **Seam 3 — the tools** (`AgentTool[]`, `src/nodeagent/core/types.ts:49-54`). The selected registry the model is allowed to call: base `ROOM_TOOLS`, browser-safe `PRODUCTION_ROOM_TOOLS`, or server-only `SERVER_PRODUCTION_ROOM_TOOLS`.

The point to hammer: **the harness code — `worldModel.ts`, `cellMutator.ts`, `runtime.ts` — is identical across both backends.** Only the `RoomTools` implementation swaps. So when you say "we tested this end-to-end with no API keys," you mean the *real* runtime and the *real* tool layer ran; only the brain and the database were fakes.

---

## 2. The runtime loop (`src/nodeagent/core/runtime.ts`)

`runAgent` is the bounded runtime loop. Walk it as five responsibilities.

1. **Assemble scoped context.** `buildContext` and the surface-specific builders
   render live room facts, versions, locks, review policy, and untrusted-room-data
   fences before the model sees the task.
2. **Loop under budgets.** The loop is bounded by step count, deadlines, reserve
   time, spend ceilings, and compaction policy.
3. **Ask the model for one step.** The provider returns prose plus zero or more
   tool calls. Provider tools are declarations only; NodeRoom executes effects.
4. **Journal and replay safely.** Tool calls and results can be journaled for
   durable slices so retries do not re-run already-recorded provider/tool turns.
5. **Validate and execute tools.** Tool args are schema-validated; tool results,
   including conflicts, are returned as JSON context for the next step.

The current loop also handles resumable tool calls, handoff events,
read-loop/done-without-writes steering, and bounded trace output. The simple
mental model is still correct, but the production loop has the guardrails needed
for durable workflow slices.

> **Budget profile rule.** Normal public `@nodeagent` prompts use the conservative
> `standard` profile. Higher budgets are opt-in via `deep_diligence` or
> `benchmark_completion`, with visible labels and receipts. The source of truth is
> `src/nodeagent/core/budgetProfiles.ts`; product policy and workflow map live in
> `docs/NODEAGENT_FRICTION_BUDGET_POLICY.md` and `docs/nodeagent-action-map.json`.

Here's the loop, lightly trimmed:

```ts
for (let step = 0; step < maxSteps; step++) {
  const out = await model.next({ system: SYSTEM_PROMPT, messages, tools });
  if (out.done || out.toolCalls.length === 0) {
    if (out.text) messages.push({ role: "assistant", content: out.text });
    return { finalText, steps: step + 1, exhausted: false, trace, messages };
  }
  messages.push({ role: "assistant", content: out.text ?? "", toolCalls: out.toolCalls });
  for (const call of out.toolCalls) {
    const tool = tools.find((x) => x.name === call.tool);
    const parsed = tool.schema.safeParse(call.args);
    const result = parsed.success ? await tool.execute(parsed.data, rt) : { error: "invalid arguments" };
    messages.push({ role: "tool", toolCallId: call.id, toolName: call.tool, content: JSON.stringify(result) });
  }
}
return { finalText, steps: maxSteps, exhausted: true, trace, messages }; // budget hit
```

The single most important design decision is hiding in step 5. **A conflict comes back as a tool result, not a thrown exception.** When the database rejects a stale write, that rejection is just JSON the model reads on its next turn — same as any other tool output. That's what turns a race condition into a re-read-and-retry instead of a crash.

This is the same shape the AI SDK's `generateText({ tools, stopWhen })` runs internally. We keep it explicit so the contract — context in, tools out, conflict-as-data, bounded steps — is visible. To go from the demo to production, you swap the model. Nothing else in this file changes.

> **Talking point.** The harness turns a race into a re-read because the *result*, not an exception, carries the conflict back into the model's context.

---

## 3. Context engineering — two halves

The model only knows what you put in front of it. So "context engineering" here is just two concrete decisions: what rules do we state once, and what live facts do we surface on every call. One is static, one is just-in-time.

### Half 1 — the system prompt is the protocol, not the data

`SYSTEM_PROMPT` in `src/nodeagent/models/prompts/systemPrompt.ts:8-23` is still
the legacy lock/CAS protocol. It is useful for ladder evals and debugging, but
the fast coediting target is stricter about ownership: the client/model submits
intent or typed patch ops, while the runtime derives policy, affected set,
publish lease, final CAS, and CRS/proposal behavior.

The legacy prompt describes the protocol in order:

1. **LOOK FIRST** — you're given a snapshot, never edit blind.
2. **CLAIM before you commit** — call `propose_lock` on the exact cells you'll change.
3. **EDIT with the version you read (CAS)** — `edit_cell` takes a `baseVersion`; a conflict means re-read and retry.
4. **RELEASE when done.**
5. **NARRATE** — one line when you start, one when you finish.

Then a short list of hard rules: never edit without a `baseVersion` you actually read; never ignore a conflict; lock only the cells you need; locked cells are still readable. The next prompt/tool contract should replace model-visible locks with server-owned affected-set planning, advisory intent claims, patch-bundle publish, and short exact-target commit leases.

Notice what's *not* in here: any spreadsheet data. The prompt is deliberately pure protocol. It makes the model cooperate with the exact same invariant the engine enforces, instead of fighting it. The engine guarantees no-clobber whether or not the model behaves; the prompt just makes the model behave so it doesn't waste turns getting rejected.

### Half 2 — the live state is just-in-time, rendered as a table

`buildContext` in `src/nodeagent/core/worldModel.ts:15-47` is the other half. Each run, before the model sees anything, it pulls a fresh snapshot and awareness **in parallel** (`worldModel.ts:16`) and renders them into one compact, aligned text message — not a JSON blob:

```
YOUR TASK: Set r_rev=+24%, r_cogs=+27.5%
SPREADSHEET (artifact "...", v41). Editable cells are `{rowId}__variance` / `{rowId}__note`:
  r_rev    Revenue       Q2=$10,000  Q3=$12,400  variance=(empty)  [v1]
  r_cogs   COGS          Q2=$4,000   Q3=$5,100   variance=(empty)  [v1]
  ...
ACTIVE LOCKS (held read-only by others — you can still read them):
  - Priya·Agent holds [r_gp__variance] — drafting GP (lockId ...)
AGENTS IN THE ROOM:
  - Room NodeAgent [public] · working
```

Two reasons we render it ourselves instead of dumping JSON. First, the model reasons better over a small aligned table than over a blob. Second, and more important, we choose exactly what it sees. The table carries a per-cell **version** (the `[v1]` tag, `worldModel.ts:19`) and a `<LOCKED>` flag, plus the active locks held by others (`worldModel.ts:22-24`) and who's in the room.

That version tag is load-bearing. **The versions in this table are what make CAS possible** — without them the model has no `baseVersion` to pass to `edit_cell`. The whole anti-clobber mechanism in section 5 is impossible if this table doesn't surface versions. The prompt tells the model to use the version it read; the context is where it reads it.

Current context builders also fence untrusted room content, inject review-mode
policy, and switch shape for spreadsheet, note, wall, and research tasks. The
teaching example above is the compact spreadsheet view, not the only context
shape.

> **Talking point.** Context engineering here is two decisions: what rules to state once (the prompt) and what live facts to surface per call (versions + lock flags). The versions are the hook CAS hangs on.

---

## 4. The tools (`src/nodeagent/skills/spreadsheet/cellMutator.ts`)

Each tool is `{ name, description, schema (zod), execute }` — the shape from `src/nodeagent/core/types.ts:49-54`. NodeRoom now has three registries:

- `ROOM_TOOLS` is the base/test registry: `read_range`,
  `search_sheet_context`, `propose_lock`, `edit_cell`, `write_cell_result`,
  `list_artifacts`, `update_wiki`, `reconcile_cell`,
  `run_algorithm_artifact`, `create_draft`, `release_lock`, `say`, and
  `fetch_source`.
- `PRODUCTION_ROOM_TOOLS` swaps raw lock/edit/draft tools for managed write
  tools, then adds OKF retrieval, Banker Coach tools, and `set_artifact_meta`.
- `SERVER_PRODUCTION_ROOM_TOOLS` adds Convex/worker-only tools such as
  `capture_source` and SEC facts. This registry is server-only so browser-safe
  bundles never import Firecrawl, SEC, Playwright, or Browserbase paths.

Three things matter about how these are built:

- **The descriptions encode the protocol.** `edit_cell`'s description (`cellMutator.ts`) literally tells the model the `baseVersion` MUST be the version it last read, and to re-read and retry on a conflict. The tool teaches the model how to use it correctly — the prompt and the description reinforce the same rule.
- **The zod schema is the validation boundary.** The runtime `safeParse`s the args before `execute` ever runs (`runtime.ts:62`). A malformed call becomes a tool error the model can recover from, not a thrown exception that kills the run.
- **`execute` never touches a database.** Every tool just forwards to a `RoomTools` method. For example: `execute: (a, rt) => rt.editCell(a.elementId, a.value, a.baseVersion)` (`cellMutator.ts`).

That last point is why the tool layer is pure and portable. The tools don't know whether they're talking to the in-memory engine or Convex — they call a method on the `RoomTools` port and let the seam decide. Swap the backend, the tools don't change.

---

## 5. The backend: `applyCellEdit` is the whole ballgame

`RoomTools` is the port; `applyCellEdit` (`convex/artifacts.ts:56-87`) is the production implementation of its most important method. If you only memorize one function for the interview, memorize this one. It's a Convex mutation that runs a four-step gated write, and the order of the gates is the design.

```ts
// 1. LOCK gate — a held range is read-only for non-holders.
const lock = await activeLockOn(ctx, a.artifactId, a.elementId);
if (lock && lock.holder.id !== a.actor.id)
  return { ok: false, reason: "locked", by: lock.holder.name };          // no write happens

// 2. CAS gate — reject a stale baseline (the anti-clobber check).
const actual = el?.version ?? 0;
if (actual !== a.baseVersion)
  return { ok: false, reason: "conflict", expected: a.baseVersion, actual }; // returned as DATA

// 3. APPLY — bump the per-element version + the artifact clock.
await ctx.db.patch(el._id, { value: a.value, version: actual + 1, ... });

// 4. TRACE — every applied edit is auditable.
```

Step by step:

- **Step 1, the lock gate** (`artifacts.ts:67-70`). `activeLockOn` looks for an active lock. If one exists and the holder isn't the actor, return `{ ok: false, reason: "locked", by }` — **without writing anything.**
- **Step 2, the CAS gate** (`artifacts.ts:72-76`). Read the element's current version (`actual = el?.version ?? 0`). If `actual !== baseVersion`, return `{ ok: false, reason: "conflict", expected, actual }` as **data, never thrown.**
- **Step 3, apply** (`artifacts.ts:78-82`). Patch the value, bump the per-element version to `actual + 1`, bump the artifact clock.
- **Step 4, trace** (`artifacts.ts:84`). Insert an audit row.

The lock gate runs **before** the CAS gate. And the same function backs hand-edits from the UI, so humans and agents share exactly one write path. There is no second door into the spreadsheet.

### The subtlety that earns the interview: Convex's own OCC is not enough

This is the sharp part, and it's worth getting exactly right — it's written into the file header (`convex/artifacts.ts:5-10`).

Convex has its own optimistic concurrency control. If two transactions touch the same document and race, Convex detects the conflict and **retries** the losing transaction. So you might think: the database already prevents clobbers, why do I need a `version` field?

Because OCC protects the *transaction*, not your *intent*. Picture the sequence:

```
agent reads r_gp at version 1
human commits r_gp → version 2     (a separate, fully-committed transaction)
agent's edit_cell fires, based on version 1
```

The agent's write is a brand-new transaction. It doesn't race anyone — the human's transaction already committed and is gone. Convex's OCC has nothing to retry. It will **happily commit the agent's write**, overwriting the human's version-2 value with a value computed against the stale version-1 baseline. That's the clobber. Convex never knew the agent's write was *conditional on version 1* — that condition lives in your application logic, not in the database's transaction model.

The per-element `version` check in `applyCellEdit` (step 2) is that application-level condition. It's the CAS that says "only apply if the baseline I read is still current," rejects the stale write, and returns the conflict as data. **App-level CAS does the anti-clobber work; the database's OCC alone is not sufficient.**

`ConvexRoomTools` then maps the mutation's native result shape to the harness's `RoomTools` shape — `{ reason: 'conflict', ... }` becomes `{ conflict: true, ... }` (`convex/convexRoomTools.ts:56`) — so the model sees one stable contract no matter the transport.

---

## 6. Lock PREVENTS the race; CAS CATCHES the race

These are two different safety mechanisms, and conflating them is the common mistake. The demo (`demo/runAgent.ts:4-13`) runs both, back to back, so you can see the difference.

```
              concurrent human write
                       │
        ┌──────────────┴───────────────┐
   WITH LOCK                       NO LOCK (CAS only)
   agent claims the range first    agent does read → edit
   human's write hits the          human's write lands between
   lock gate → BLOCKED             the read and the edit
   ⇒ zero conflicts                ⇒ stale write hits the CAS
   the LOCK PREVENTS the race      gate → REJECTED → re-read → retry
                                   the CAS CATCHES the race
```

**Scenario A — legacy lock lane.** The agent calls `propose_lock` to claim the range first. Now the concurrent human write hits step 1 of `applyCellEdit` and is rejected with `reason: 'locked'` before it can touch anything. The demo logs Priya's edit as `BLOCKED` (`demo/runAgent.ts:42-43`). Zero CAS conflicts occur — the lock prevented the race from ever happening. This proves the invariant, but it is intentionally higher friction than the desired Google-Sheets/Figma-like coediting feel.

**Scenario B — no lock, CAS only.** The agent does a plain read-then-edit. With no lock, the human's write lands in the gap between the agent's read and its write. The agent's now-stale write hits the CAS gate, gets rejected, the agent re-reads and retries. Here's the actual demo output (`npm run demo:agent`, scenario B):

```
▸ read_range    {"elementIds":["r_gp__variance"]}
      → [{"id":"r_gp__variance","value":"","version":1,"locked":null}]
⚡ Priya edits r_gp__variance → "+19%" (v2) — no lock to stop her; the agent's next write will be STALE
▸ edit_cell     {"elementId":"r_gp__variance","value":"+21.7%","baseVersion":1}
      → {"ok":false,"conflict":true,"expected":1,"actual":2}        ← stale write REJECTED
▸ read_range    {"elementIds":["r_gp__variance"]}
      → [{"id":"r_gp__variance","value":"+19% (Priya)","version":2,"locked":null}]
▸ edit_cell     {"elementId":"r_gp__variance","value":"+21.7%","baseVersion":2}
      → {"ok":true,"version":3}                                     ← retried on the fresh version
── 7 steps · 6 tool calls · 1 CAS conflict(s) survived · exhausted=false
```

The scripted planner `recomputeVariancePlan` (`src/nodeagent/core/plans.ts:63-96`) drives both scenarios off a single `opts.lock` flag (`plans.ts:64, 72-95`).

The key insight: the agent **saw Priya's value before overwriting it.** That's the whole point. CAS doesn't forbid all overwrites — it forbids *blind* ones. After an informed re-read, the agent is allowed to overwrite; that's a decision. What it can never do is clobber a value it never read. CAS catches the blind write and forces the read.

> **What happens when the cell is locked and you can't wait?** The agent reads it anyway (locked means read-only, not invisible) and calls `create_draft`. When the lock releases, `mergeBlockedDrafts` (`convex/drafts.ts:36-67`) deterministically clean-applies each op if the element is still at the drafted baseline, no-ops it if the value already matches, and flags-without-applying if it diverged (`drafts.ts:49-57`). The release and the merge happen in one transaction (`convex/locks.ts:36`). Note: the file header calls this "the LLM-resolver seam," but the current implementation is purely deterministic baseline comparison — there's no LLM in the merge path today. An LLM resolver is a future extension point, not current behavior.

---

## 7. The injectable model: scripted vs real providers (seam 1)

Model implementations sit behind the same `AgentModel` interface.

Current production model wiring is provider-agnostic: `model(modelId)` routes through the catalog and
AI SDK adapters for OpenAI, Gemini, Anthropic, and OpenRouter, while `convexModel(modelId)` provides
the Convex action variant. Provider SDK tools are still declared without `execute`; the model returns
tool calls and NodeRoom runs them against `RoomTools`. `openrouter/free-auto` is explicit for the
Free route in the public composer and records the concrete resolved model for audit.

**Provider adapters** are route-based, not Anthropic-only. `model(modelId)` uses the catalog-backed local/provider adapter path, while `convexModel(modelId)` is the Convex-safe action adapter. The critical detail is unchanged: provider tools are declared without local side effects. The provider returns tool calls; NodeRoom validates and executes them against `RoomTools`. The division of labor: the provider adapter owns model plumbing, while the harness owns the loop, context, tool validation, backend writes, conflict recovery, compaction, budgets, and traceability.

**`scriptedModel`** (`src/nodeagent/models/scripted.ts`) is a deterministic
model for demos and tests. It takes a `Planner` that reads the running message
history — so it can see prior tool results, including versions and conflicts —
and returns the next step. No network, no keys. The `lastVersions` helper also
lives in `scripted.ts`. Provider routing lives in
`src/nodeagent/models/adapter.ts`; Convex action routing lives in
`src/nodeagent/models/convexModel.ts`.

Why this seam earns its keep: the demo and tests use the scripted model so they exercise the **real runtime, the real tool backend, and the real engine** — only the brain is fixed. When the tests pass, you've verified the loop, the gates, the conflict-as-data contract, and the smart-merge. You've just held the LLM constant so the test is deterministic.

---

## 8. Production wiring: inline action and workflow slice runner

Current production wiring uses `convexModel(process.env.AGENT_MODEL ?? "gemini-3.5-flash")`, so
provider keys depend on the selected model route rather than being Anthropic-only.

`convex/agent.ts` is the inline/publish/fallback action path. It is a Convex
action because model calls and external services belong outside deterministic
mutations. Provider keys depend on the selected model route, not on Anthropic
alone. `runRoomAgent` claims or creates an inline-compatible `agentJobs` row,
applies spend and time budgets, enables compaction, uses the provider-step
journal, and hands off when that slice cannot finish:

```ts
const job = await createOrReuseAgentJob(...);
const rt = new ConvexRoomTools(ctx, roomId, artifactId, actor, sessionId);
const model = convexModel(job.modelPolicy ?? process.env.AGENT_MODEL ?? "gemini-3.5-flash");
const result = await runAgent({
  rt,
  goal,
  model,
  tools: PRODUCTION_ROOM_TOOLS,
  journal: makeConvexStepJournal(...),
  deadlineAt,
  compaction: ...
});
await finishInteractiveOrCheckpoint(job, result);
```

The public chat route starts a durable job through `agentJobs.start`; it does
not rely on an immediate inline first slice. `convex/agentJobRunner.ts` then
claims workflow slices and runs the same `runAgent` loop with
`SERVER_PRODUCTION_ROOM_TOOLS`. That's the seam paying off: the loop is shared
between deterministic tests, local provider runs, inline Convex actions, and
workflow-backed production slices; only the model, tool registry, and backend
implementation differ.

> **Step budgets, for precision.** Three different rails are in play: the
> runtime's own default is 8, the production action defaults to 40 steps for
> normal runs and 80 for research runs (clamped to 64/96), and the local demo
> uses 16. Same loop, different limits for different contexts.

The action returns a summary `{ finalText, steps, exhausted, toolCalls,
conflictsSurvived }`, where `conflictsSurvived` counts the `edit_cell` trace
results that came back with `conflict: true`. The live effects - locks, edits,
traces, chat - are written through the mutations and stream to every client via
reactive `useQuery` subscriptions. That's how "multiple users and agents see
updates while editing concurrently" actually becomes true on the screen.

**The user entry point.** Mentioning `@nodeagent <goal>` in the public chat calls `store.askAgent({ goal, references, modelSelection })` (`src/app/store.tsx`): the chat composer keeps dragged file chips as structured artifact references, and the store converts those references into scoped artifact context before invoking the agent. The route picker records a user preference; the server should derive the final `modelPolicy`, `approvalPolicy`, `autoAllow`, `evidencePolicy`, host/source allowlist, and rate-limit bucket before `agentJobs.start`. `/ask` and `/free` remain hidden compatibility aliases that pass through the same durable route. On Convex the store calls `agentJobs.start`, then the workflow runner claims slices for the user's goal; with no keys it runs the *same* `runAgent` loop in the browser against the in-memory engine (scripted model). Same loop, same contract — only the brain, registry, and backend differ.

`ConvexRoomTools` is the only thing that differs between the spike and
production. It implements the same `RoomTools` interface, each method running
an internal Convex query or mutation: `snapshot -> internal.artifacts.getSheet`,
`readRange -> internal.artifacts.readRange`, `proposeLock ->
internal.locks.proposeLock`, `editCell ->
internal.artifacts.applyAgentCellEdit`, `createDraft ->
internal.drafts.createDraft`, `say -> internal.messages.sendAgent`, and so on.

---

## 9. File map

| Concern | File |
|---|---|
| The seams (types + the `RoomTools` port) | `src/nodeagent/core/types.ts` |
| The loop (harness) | `src/nodeagent/core/runtime.ts` |
| Reasoning frame plan/types | `src/nodeagent/core/reasoningFrames.ts` |
| Frame context envelopes | `src/nodeagent/core/contextPack.ts` |
| Frame result reduction/verification | `src/nodeagent/core/frameReducer.ts`, `src/nodeagent/core/frameVerifier.ts` |
| Context — the protocol (system prompt) | `src/nodeagent/models/prompts/systemPrompt.ts` |
| Context — the live JIT table | `src/nodeagent/core/worldModel.ts` |
| Base and browser-safe tools | `src/nodeagent/skills/spreadsheet/cellMutator.ts` |
| Server-only production tools | `src/nodeagent/skills/server/productionTools.ts` |
| Seam 1 — model adapters (scripted + provider routes) | `src/nodeagent/models/scripted.ts`, `src/nodeagent/models/adapter.ts`, `src/nodeagent/models/convexModel.ts` |
| Scripted planners (drive the demo/tests) | `src/nodeagent/core/plans.ts` |
| Seam 2 — in-memory backend | `src/nodeagent/skills/integration/noderoomAdapter.ts` (over `src/engine/roomEngine.ts`) |
| Seam 2 — Convex backend | `convex/convexRoomTools.ts` |
| The CAS write — `applyCellEdit` | `convex/artifacts.ts` |
| Lock gate backend | `convex/locks.ts` |
| Draft + smart-merge backend | `convex/drafts.ts` |
| Inline production action | `convex/agent.ts` |
| Workflow slice runner | `convex/agentJobRunner.ts` |
| Runnable demo (both scenarios) | `demo/runAgent.ts` |
| Scenario tests | `tests/agentRuntime.test.ts`, `tests/roomEngine.test.ts` |
