# Chat

## 2026-11-09 — Let hosts choose the first agent task

The empty chat action now prefills and focuses the composer. Workspace rooms reject empty agent directives before posting or spending, and use a neutral room hint instead of sample-company prompts. Explicit sample prompts remain in sample rooms.

**Evidence**: `e2e/ui-flow/uf03-empty-room-cta-never-sends-sample.spec.ts`, `evidence/ui-flow/uf03-empty-room-cta-never-sends-sample/`.

**Touches**: `CHANGELOG/components/RoomHome.md`, `CHANGELOG/app/roomStore.md`.
