# Semantic Rebase: Compare-Reason-Swap

Status: first durable spreadsheet stale-agent proposal path implemented; full
CRS runtime still open.

CAS protects the cell. Semantic Rebase protects the meaning.

NodeRoom already has the hard write gate: managed locks, per-element
`baseVersion` checks, proposal routing, draft smart-merge, and final writes
through Convex mutations. Compare-Reason-Swap (CRS) is the layer above that
gate. It decides what should happen when a stale patch, draft conflict, or
proposal approval conflict is not just a physical write conflict but a business
meaning conflict.

## Runtime Boundary

CRS must not weaken CAS. The model may reason, but it never writes durable room
state directly.

```mermaid
sequenceDiagram
  participant Human as Human or agent
  participant Mut as Convex mutation
  participant CRS as CRS classifier
  participant Act as Node action / LLM resolver
  participant Val as Validators
  participant CAS as Final CAS write

  Human->>Mut: submit patch bundle with base versions
  Mut->>Mut: check lock, version, policy
  alt current versions still match
    Mut->>CAS: commit through existing managed write path
  else stale or semantically conflicted
    Mut->>CRS: build conflict packet
    CRS-->>Mut: deterministic tier or review tier
    alt deterministic safe
      Mut->>CAS: re-check and commit after final CAS
    else text/semantic resolver allowed
      Mut->>Act: call structured resolver with packet
      Act-->>Val: proposed semantic resolution
      Val-->>CAS: formula/evidence/privacy/policy checks
      CAS-->>Mut: commit, proposal, or reject
    else human review or forbidden
      Mut-->>Human: create proposal or reject with reason
    end
  end
```

## Implemented Now

`src/nodeagent/skills/spreadsheet/semanticRebase.ts` defines:

- `SemanticConflictPacket`
- `SemanticResolution`
- deterministic policy classification
- hard stops for formula-to-scalar overwrite, private evidence in public output,
  manual-claim verification, deleted human comments, and evaluator artifact
  mutation
- review routing for banker assumptions like revenue forecasts, EBITDA
  adjustments, debt schedule inputs, and client-facing judgement calls

`tests/semanticRebase.test.ts` covers the first policy surface.

Durable spreadsheet wiring now exists for the stale agent-write path:

- `convex/artifacts.ts` calls CRS when an agent write loses per-element CAS.
- `convex/semanticRebase.ts` records a `semanticConflicts` packet and, in
  review mode, creates one deduped rebased proposal for the current cell
  version.
- `resolveProposal` applies an approved proposal only through final CAS.
- `tests/convexSemanticRebase.test.ts`, `tests/durableSemanticRebase.test.ts`,
  and `tests/noClobberWedge.test.ts` cover the no-clobber and proposal paths.

## Still Open

The current implementation is intentionally not a full CRS runtime. Remaining
work:

- Trigger CRS from stale algorithm patch bundles, `draft_conflict`, and proposal
  approval CAS conflicts beyond the existing stale agent-write path.
- Add an LLM resolver action with structured output only.
- Add validators for formula preservation, evidence sufficiency, privacy
  boundary, review tier, and stale-again final CAS.
- Extend the existing proposal UI from inline semantic chips to full semantic
  conflict cards.
- Add all-or-none multi-op commits before claiming semantic multi-cell atomicity.

## Policy Tiers

| Tier | Behavior | Examples |
|---|---|---|
| Deterministic auto-merge | Commit only after validation and fresh final CAS. | Different cells with no dependency overlap; formatting-only changes; safe derived refresh. |
| LLM-assisted, validator-approved | Let the model propose a resolution, then validate and route. | Memo paragraph synthesis; note cleanup; chart annotation rewrite. |
| Human review required | Create a proposal; do not auto-commit. | Revenue forecast, EBITDA adjustment, debt schedule input, client-facing assumption. |
| Forbidden | Reject before the model resolver runs. | Formula-to-scalar overwrite, public output from private uploaded evidence, evaluator gold mutation, deleting human comments. |

## Interview Answer

Convex OCC and NodeRoom CAS prevent stale physical writes. They do not decide the
best business resolution when two people changed the same assumption, formula,
or memo paragraph. CRS adds a semantic packet with base/current/proposed state,
intent, evidence, dependencies, comments, privacy policy, and review tier. Safe
cases merge deterministically; risky cases become proposals; forbidden cases are
blocked; every successful result still passes a final CAS.
