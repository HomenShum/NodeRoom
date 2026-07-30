# Note reference consumption

## 2026-07-29 — Bind note references to canonical NodeKit records

Define one engine-level contract for digest-closed observations, design rules,
score receipts, execution edges, candidate revisions, and external run
attestations. Derived verification rejects caller-supplied authority, stale or
drifting links, cache material, and false independence claims.

**Commit**: `87c67dd`. **Author**: Codex with Claude.

**Touches**: `CHANGELOG/components/NotebookDigestWorkbench.md`,
`CHANGELOG/components/PassiveReferenceInbox.md`,
`CHANGELOG/server/convex-note-reference-persistence.md`,
`CHANGELOG/qa/nodekit-note-reference-proof.md`

```text
Mobbin observation
        |
        v
Canonical NodeKit records + execution edge
        |
        v
Convex authority verification + version CAS
        |
        v
Notebook and inbox projections
```
