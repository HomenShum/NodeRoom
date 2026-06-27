# Assistive Inbox — Passive Intelligence Redesign

> **Status:** Approved  
> **Date:** 2026-06-27  
> **Owner:** Homen  
> **Doctrine:** NodeRoom should notice passively, but act explicitly.  
> **One-sentence:** Passive should create options, not jobs.

## Problem

The current Passive Room Intelligence (PRI) auto-executes LLM research jobs
whenever it detects entity-like text. This caused workpool saturation, user job
starvation, and thousands of OCC conflicts.

The failure chain:

```
user edits / uploads / saves
  -> enqueueRoomActivity
  -> debounce
  -> classifyNoteworthy
  -> score >= 0.35
  -> auto-create passive research job
  -> free-auto workflow
  -> spend/rate failure
  -> requeue
  -> workpool saturation
  -> user-initiated @nodeagent job starved
```

PRI violated the most important product rule:

> A background helper must never make the foreground user feel abandoned.

## New Product Definition

Stop calling it "Passive Room Intelligence." Call it **Assistive Inbox**.

```
NodeRoom quietly notices possible work, groups it, explains why it matters,
and lets the user approve, batch, dismiss, or promote it.
```

### The New Rule

```
Passive detection may be automatic.
Passive execution must be gated.
```

**Allowed automatically:**
- detect entity, company, evidence gap, to-do, CRM row, research topic
- create inbox suggestion
- group duplicates
- update priority score

**Not allowed automatically:**
- call LLM, Linkup, Firecrawl
- start NodeAgent job
- mutate spreadsheet
- generate report, write memo, send notification

**Only exception:** explicitly cheap deterministic processing (hashing, dedupe,
local entity extraction, schema validation, source indexing, metadata-only
dirty marking).

## Architecture

```
USER ACTIVITY -> LIGHTWEIGHT ACTIVITY EVENT -> DEBOUNCED LOCAL CLASSIFIER
  -> ASSISTIVE INBOX ITEM (roomSuggestions)
  -> USER / HOST ACTION (Research / Add to sheet / Dismiss / Batch)
  -> EXPLICIT AGENT JOB (foreground / approved_background)
  -> OUTPUT LAYER (evidence cards, proposed rows, research memo)
```

## Queue Redesign

```
Queue 0 — foreground_interactive    (explicit @nodeagent, host Research)
Queue 1 — approved_background       (user-approved batch, scheduled)
Queue 2 — passive_classification    (cheap local classifier, no external API)
Queue 3 — maintenance               (cleanup, dead letters, analytics)
```

Hard guarantees:
- Passive queue can never consume foreground slots
- Passive jobs have maxAttempts ≤ 2
- Passive jobs cannot requeue on spend_budget/rate_limit
- Passive jobs cannot patch agentJobs hot documents for every stream event

## Data Model Split

```
agentJobs          — one durable job row, slow-changing status only
agentJobEvents     — append-only events (tool_started, model_call, retry, etc.)
agentStreamChunks  — append-only text chunks
agentLiveOperations— append-only UI trace
roomSuggestions    — passive inbox items (suggestionKind, confidence, status)
```

## Kill Switches

```
PASSIVE_INTELLIGENCE_ENABLED=false
PASSIVE_CREATE_AGENT_JOBS=false
PASSIVE_MAX_ATTEMPTS=1
PASSIVE_MAX_PER_ROOM_PER_HOUR=10
PASSIVE_WORKPOOL_MAX_PARALLELISM=1
PASSIVE_ALLOWED_ACTIONS=suggest_only
```

User-facing controls:
```
Room Settings → Assistive suggestions:
  Off / Suggestions only / Ask before research / Auto-research approved watchlist only
Default: Suggestions only
```

## Implementation Priority

### P0 (immediate)
1. Disable auto-create passive research jobs
2. Passive classifier may only create roomSuggestions
3. Put all existing passive jobs behind a kill switch
4. Foreground @nodeagent gets hard priority
5. Passive maxAttempts = 1, not 20
6. Passive jobs cannot requeue on spend_budget/rate_limit
7. Move stream/live-operation writes to append-only tables
8. Add workpool saturation dashboard / warning

### P1
1. RoomSuggestions UI in Room Home
2. Batch approval workflow
3. Per-room passive quota
4. Per-actor debounce and maxWait
5. Deduplication by entity/source/action
6. Cost preview before research
7. "Why am I seeing this?" explanation

### P2
1. Learning from dismissals
2. Digest mode
3. Workspace-level passive policy
4. Team-level suggestions
5. Admin controls for passive automation

## QA Tests

1. Passive suggestion never creates agentJobs unless user approves
2. User @nodeagent job is processed even when 100 passive suggestions exist
3. Passive classifier cannot exceed per-room quota
4. spend_budget does not requeue passive jobs indefinitely
5. passive workpool cannot starve foreground workpool
6. recordStreamEvent writes append-only, not patching agentJobs hot row
7. Dismissing a suggestion reduces similar future suggestions
8. Batch approval creates one grouped job, not N duplicate jobs
9. Private room suggestions do not leak into public room
10. Suggested item shows why it was created and what action it would take

Regression test:
```
Seed demo room with 15 entity-like notes.
Create another room.
Send explicit @nodeagent Research upscaleX...
Assert explicit user job starts within N seconds.
Assert passive suggestions do not consume foreground slots.
```

## References

- Ambient AI Architecture — "filtering is the product"
- Backpressure in Agent Pipelines — bounded queues, circuit breakers
- GitHub Copilot / Cursor — separate async job queue for non-interactive work
- Notion — hash-based change detection, dual-path indexing
- Linear — push detection to edge, progressive surfacing
