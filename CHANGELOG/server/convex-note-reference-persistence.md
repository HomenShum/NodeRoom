# Convex note reference persistence

## 2026-07-29 — Fail closed on untrusted reference receipts

Persist an immutable note reference snapshot only after owner, room, artifact,
digest, policy, Ed25519, lifetime, producer, purpose, and version checks pass.
Exact replay is idempotent; competing versions return an honest conflict.

**Commit**: `87c67dd`. **Author**: Codex with Claude.

**Touches**: `CHANGELOG/contracts/note-reference-consumption.md`,
`CHANGELOG/components/NotebookDigestWorkbench.md`,
`CHANGELOG/qa/nodekit-note-reference-proof.md`
