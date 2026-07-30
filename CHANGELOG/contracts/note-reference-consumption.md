# Note reference consumption

## 2026-07-30 — Add the V2 identity and compatibility envelope

Bind canonical snapshots to exact Caseflow, repository, artifact owner/CAS,
candidate render, surface/state, proof-profile, and review-receipt identities.
Keep V1 readable through an explicit adapter, require V2 for new writes, reject
unknown semantic aliases, and project valid records as Incomplete until an
external NodeProof barrier verifies the chain.

**Commit**: 05d9fe3a. **Author**: Codex.

**Evidence**: `evidence/nodekit-note-reference-v2/`,
`evidence/nodekit-note-reference-surface/after/`

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
