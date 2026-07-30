# RoomShell

## 2026-07-30 — Move usage out of the passive status strip

Remove the always-visible credit chip from the workspace footer and expose the
same honest enforced/demo balance under the top-right room controls. This
keeps operational usage reachable while preserving the footer for passive
room and agent state.

**Evidence**: `e2e/credit-load.spec.ts`
