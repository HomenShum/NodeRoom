# NodeKit note-reference requirement audit

Audited against the supplied 2026-07-28 NodeKit architecture discussion and the
current worktree.

| Requirement | Current evidence | Result |
| --- | --- | --- |
| Canonical state remains authoritative; the UI is only a projection | `ArtifactMeta.noteSurfaceReferenceConsumption` stores the immutable snapshot; `src/engine/noteSurfaceReference.ts` validates it; UI components only project the result | Proven locally |
| Edges bind exact artifacts, repository revision, and authority evidence | Digest-closed observation, rule, score receipt, edge, commit, render commits, and attestation references are checked by `evaluateNoteSurfaceReferenceConsumption` | Proven by focused tests |
| Edges cannot carry pass, approval, verified, or verdict authority | Recursive prohibited-authority-key inspection rejects those fields inside the edge | Proven by adversarial tests |
| Fresh context is not independent evaluation | `fresh-context` plus `claimedIndependent: true` is rejected | Proven by focused tests |
| NodeProof-style verification covers the full chain rather than final output only | Observation → rule → score → edge → candidate bindings and derived coverage/verdict are checked before persistence | Proven locally; external NodeProof receipt still required |
| External Mobbin work is authenticated, bounded, and non-retentive | Exact policy bytes, bounded credentials, S2/S3 purpose/producer allowlists, seven-day TTL, Ed25519 signature, and prohibited-material flags are enforced | Proven with cryptographic fixtures; genuine external receipt still required |
| Headless lane supplies repeatable UI proof | Sequential desktop/phone proof plus the deterministic demo scenario exercise armed, disarmed, empty, captured, reopened, responsive, error, and accessibility states | Proven locally |
| Signed-in headful Chrome supplies operational truth | Chrome CDP was unavailable; opening a fresh signed-in Chrome window requires user permission | Not yet proven |
| User status remains simple and the graph stays hidden by default | Notebook and inbox expose only bound/needs-review/failed labels and an inspection disclosure | Proven by component and browser tests |
| Capture is fail-safe during protected review/conflict | Capture becomes disarmed while reference inspection or conflict handling is active | Proven by unit, UI, and browser scenarios |
| Quick capture persists as a notebook block | The `CellPayload` guard now requires an own `value` field; exact captured text survives close/reopen in memory mode | Proven by regression and browser demo |
| Persistence is owner-scoped, note-scoped, idempotent, and CAS-protected | Convex mutation checks actor ownership, room/artifact binding, note kind, exact replay, and version conflict | Proven by Convex scenarios |
| No second canonical design authority is introduced | No handwritten `design.md` was added; Mobbin observations remain a bounded evidence packet | Proven by diff |
| Full local release gate passes | Typechecks, 2,709 tests, build, design audit, architecture budget, and `npm run prod:gate` logs are present | Proven locally |
| Main branch, deployment, and live production signals | No implementation commit or deployment exists yet | Open release item |

The existing `npm run convex:boundaries` failure in `convex/artifacts.ts` is
reproducible on the clean baseline. It is not evidence against this slice, but
it must not be represented as fixed.
