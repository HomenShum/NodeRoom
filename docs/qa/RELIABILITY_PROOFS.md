# NodeRoom Reliability & Recovery Proofs

Generated: 2026-06-26
Mode: memory (local, offline)

## Summary

- Flows executed: 3
- Flows passed: 3
- Console errors: 0

## R1: Agent Lifecycle — @nodeagent command → session → work → lock release

- **Action**: Click "@nodeagent runway gaps" quick action → send message
- **Result**: PASS
- **Evidence**:
  - Session started: `agent_session_started`
  - Agent worked: "Sourced cash + burn and computed runway for CardioNova (11.7 months) and Pulley (16.2 months). Wrote 8 cells behind a lock with CAS; milestone gaps stay flagged for review."
  - Lock released: "Room NodeAgent: done — released lock"
  - Status emitted: `agent_status`
- **Sheet verification**: Runway sheet updated with real data:
  - CardioNova: cash $2.1M, burn $180K/mo, runway ~11.7 months, status sourced
  - Pulley: cash $3.4M, burn $210K/mo, runway ~16.2 months, status sourced
- **Screenshot**: `dogfood-11-agent-lifecycle.png`, `dogfood-12-agent-updated-sheet.png`

## R2: Leave Room → Rejoin → Fresh Room

- **Action**: Click leave button → landing page → create new room
- **Result**: PASS
- **Evidence**:
  - Leave returns to landing page with "Create a room" button
  - New room opens with wall as default tab
  - 8 inventory cards, 3 post-its — fresh state, no stale data
  - Zero console errors
- **Screenshot**: `dogfood-13-leave-rejoin-fresh-room.png`

## R3: Multi-User Coordination (deterministic)

- **Source**: `docs/eval/multi-user-coordination-proof.json`
- **Result**: PASS (6/6 scenarios)
- **Invariants proven**:
  1. Range lock blocks peer writes to target cells, allows non-target writes
  2. Stale base version returns conflict data, preserves canonical value
  3. Blocked agent drafts, then smart-merges on lock release
  4. Lock released in finally even on CAS conflict
  5. Stale agent write cannot clobber human's newer edit
  6. Zero active locks at end of every scenario

## Error States Observed

- Zero console errors across all flows
- Zero unhandled promise rejections
- Zero React render errors
- No stale lock leaks
