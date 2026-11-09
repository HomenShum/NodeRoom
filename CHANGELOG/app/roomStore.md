# roomStore

## 2026-11-09 — Identify fresh memory rooms as workspaces

Set workspace experience on a freshly created memory room so shared UI distinguishes the host's empty room from a seeded sample. This preserves the existing room creation API and starter sheet.

**Evidence**: `e2e/ui-flow/uf03-empty-room-cta-never-sends-sample.spec.ts`.

**Touches**: `CHANGELOG/components/Chat.md`, `CHANGELOG/components/RoomHome.md`.
