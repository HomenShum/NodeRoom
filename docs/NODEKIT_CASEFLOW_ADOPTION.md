# NodeRoom × NodeKit Caseflow consumer boundary

NodeRoom now mounts the packaged NodeKit Caseflow Convex component. The former
895-line copied backend and nine host lifecycle tables are gone. This worktree
uses a provisional local tarball while NodeKit's final exact-revision package is
being frozen, so it is an engineering-valid consumer implementation but not yet
a final qualifying receipt or production claim.

## Ownership boundary

The installed component owns all portable lifecycle state:

- cases, runs, and stages;
- artifact metadata and immutable versions;
- proposals and approvals;
- exceptions and recovery state;
- timeline events;
- terminal receipt-v2 records.

NodeRoom owns only application authority and domain state:

- Convex Auth identity, rooms, members, revocation, and membership roles;
- real NodeRoom artifacts, elements, version history, locks, and cell CAS;
- agent jobs, leases, traces, model calls, evidence, files, exports, and UI.

The host schema contains three relationship tables, not a lifecycle fork:

| Host table | Purpose |
| --- | --- |
| `nodekitCaseflowBindings` | Binds a component case and its current run to one authenticated room member and an opaque scope key. |
| `nodekitCaseflowRunBindings` | Retains every component run-to-case relationship so old receipts and timelines survive later reruns. |
| `nodekitCaseflowArtifactBindings` | Binds a component artifact ID to the real private NodeRoom artifact and canonical element. |

No token, bearer, model secret, prompt, proposal body, approval, exception, event,
or receipt is copied into these binding tables.

## Authenticated wrapper

`convex/nodekitCaseflow.ts` is the thin host wrapper. Every public function:

1. verifies the NodeRoom actor proof;
2. requires the Convex identity to match the member in production mode;
3. requires a live room and non-revoked membership;
4. derives the opaque component `scopeKey` server-side from room and member IDs;
5. checks the host binding before calling the component;
6. replaces any portable actor with the authenticated member identity.

The component never receives a token and the browser never receives `scopeKey`.
A second authenticated member in the same room gets a different scope and cannot
read or mutate the first member's lifecycle.

## One artifact authority

The component stores the portable artifact history, while NodeRoom's artifact is
the product's authoritative editable object. The versions remain aligned:

```text
component proposal
→ component base-version check
→ NodeRoom artifact/element preflight
→ component decision
→ NodeRoom applyCellEditCore CAS
→ one outer Convex transaction commits both sides
```

If a human edits the NodeRoom element first, acceptance fails before the component
advances and the human value remains canonical. If a lock causes NodeRoom CAS to
reject after the component call begins, the outer mutation rolls back the component
decision too; clearing the lock and retrying applies one component version and one
NodeRoom version. Completion, cancellation, and safe failure verify that every
bound artifact still matches before a receipt can be issued.

## Local verification coverage

`tests/nodekitCaseflowConformance.test.ts` registers the component exported by the
installed package in `convex-test` and proves:

- the packaged `runCaseflowConformance()` suite passes in its authenticated
  `host-bound` actor profile with a real cross-owner and forged-identity probe;
- actual component execution through the mounted host wrapper;
- required Convex identity and room-member ownership;
- two-member isolation and forged-identity rejection;
- idempotent stage, artifact, proposal, decision, exception, and terminal retries;
- a real private NodeRoom artifact and existing `applyCellEditCore` CAS;
- stale component proposal conflict without a second canonical version;
- newer human edit preservation;
- cross-component rollback when NodeRoom CAS is locked;
- multiple-exception containment and explicit recovery ownership;
- reload durability, including prior-run timelines and receipts after a rerun;
- cancellation and failed-safe terminal receipts;
- receipt-v2 artifact, proposal, approval, event, and content-hash bindings.

## Evidence and final-package gate

`scripts/prove-nodekit-caseflow-consumer.mjs` is fail-closed. It requires:

- a committed consumer source set;
- a NodeKit tarball packed from a clean 40-character source commit;
- the exact 64-character distributable source hash and tarball SHA-256;
- lockfile integrity matching the tarball manifest;
- adapter constants bound to those exact identities;
- component tests, the complete NodeRoom floor, production build, and production audit;
- recursively byte-verified source, logs, package manifest, and nested evidence;
- a canonical content hash over the final local consumer verdict.

The complete floor runs with two Vitest workers and a 60-second infrastructure
timeout. All assertions remain intact; this prevents the repository's
filesystem-heavy 5-second defaults from failing only because other worktrees
share the same CPU and disk.

The package preparation step also hashes the distributable source and Git status
immediately before and after `npm pack`. If either changes while npm is reading
the package, the archive is discarded. This prevents a concurrent edit from
producing a tarball whose recorded source identity describes different bytes.

The current provisional manifest intentionally records
`source.workingTreeClean=false`, so the proof command refuses to issue a passing
verdict. After NodeKit freezes, replace the tarball and manifest, reinstall, update
the three constants in `src/integrations/nodekit/caseflowAdapter.ts`, commit that
exact package binding, and then run:

```bash
npm run proof:nodekit-caseflow
```

That local receipt still does not claim production deployment, a signed-in browser
journey, npm publication, Convex submission, or independent ProofLoop approval.
Those remain separate external gates.
