# Building the deployment room I would have wanted as a banker

## Executive summary

This project tests the core Forward Deployed Engineer loop on a synthetic small-business
lending workflow:

```text
enter the operator's world
→ reconstruct actors, documents, dependencies, and authority
→ ship one governed workflow inside the product
→ exercise it in production
→ turn failures and customer-specific logic into platform learning
```

The result is the **SMB Lending Deployment Room**, a native NodeRoom template. It is not
a separate loan-origination product and does not make a credit decision. It creates a
collaborative room containing the synthetic application, evidence checklist, process
graph, underwriting workbook, application notebook, proposal review, proof receipt,
and human-review credit packet.

## Why this problem fits my background

At JPMorgan Chase I worked in commercial credit, healthcare and life-science banking,
and startup banking. That context taught me that the operational problem is not simply
"upload files and ask a model." A credit file depends on document state, missing
information, source lineage, calculations, exceptions, handoffs, and explicit decision
authority.

This implementation uses only generalized workflow knowledge and synthetic data. It
does not use JPMorgan customer data, internal policies, documents, or screenshots, and
it does not represent prior SBA underwriting experience.

## What was built

NodeRoom remains the product and source of truth. The lending vertical adds domain
fixtures, document requirements, deterministic blocker and critical-path logic,
financial calculations, validators, and packet renderers. All durable changes pass
through NodeRoom's existing proposal, human decision, version/CAS, artifact, and receipt
spine.

The production transaction is:

1. Create an authenticated room containing eight canonical binder artifacts and the
   first version-pinned proposal.
2. Approve the document-request proposal.
3. Apply `missing → requested` through the canonical CAS path and create the sequential
   evidence-verification proposal.
4. Approve evidence containing a source identifier, locator, and immutable digest.
5. Apply `requested → verified` and atomically regenerate the proposal review, proof
   receipt, decision-free human-review packet, and export bundle.
6. Export and independently reopen both the application and packet hashes.
7. Reload the room and recover the same verified state and receipt.

## Production proof

The exact reviewed implementation merged in PR #238 at
`631c53089a1bd3dc8354e21b20b31bfa880f5020`. The final clean-tree Vercel deployment was
`dpl_4mnkzEvigrAZLcu2brhmc1KS3gaj`, backed by Convex deployment
`zealous-goshawk-766`.

The production browser journey passed with:

- application version `3`;
- application hash
  `6cf83646c22f4dae8cb922d5aa222f0c3fa33b58786f5078cb77eff76953306d`;
- packet hash
  `59cdd91e4b4b2f71a6ff984c0b108f2317b50ef2dd5dc2aefc645e3260db44dc`;
- proposal reviewed `true`;
- base versions matched `true`;
- source lineage present `true`;
- no credit decision `true`.

The full release gate passed: zero audit vulnerabilities, both TypeScript targets,
370 test files / 2,563 tests, browser tests, the production build, and all 313 Convex
exports live.

## The defect the proof run found

The first production browser attempt stalled even though the page and deployments looked
healthy. The served Vercel frontend had been compiled against a fallback Convex target
while the reviewed functions were deployed elsewhere. HTTP health checks did not expose
the split.

The production environment was corrected, the exact clean commit was redeployed, and the
served runtime bundle was inspected before the browser journey was repeated. The same
workflow then passed and persisted after reload.

That failure is an FDE result, not an embarrassment: a deployment is not complete until
the user-visible workflow proves the exact frontend/backend binding.

## Benchmark result

The locked four-mode benchmark ran manual, chat-only, graph-agent, and
memory-enhanced variants. All ten runs passed the dimensional evaluator. Each
model-backed mode ran three times. Required-document recall, blocker recall,
critical-path exactness, authority-boundary exactness, and source-lineage coverage were
all `1.0`; false-requirement rate was `0.0`.

Mean recorded runtime was:

| Mode | Runs | Mean runtime |
|---|---:|---:|
| Manual fixture baseline | 1 | 0 ms |
| Chat-only | 3 | 3,328 ms |
| Graph agent | 3 | 7,009 ms |
| Memory-enhanced | 3 | 8,367 ms |

The provider response did not include billed cost, so cost is recorded as `n/a` rather
than estimated. The result is not a universal winner claim; it proves that all four
modes satisfied the locked contract on these fixtures.

## Customer-specific configuration versus platform capability

| Bank-specific configuration | Reusable platform capability | Remaining platform gap |
|---|---|---|
| Document checklist | Version-pinned proposals and CAS | Actual-byte browser upload |
| Product stages | Evidence identifiers, locators, and digests | Optional Neo4j read projection |
| Policy and exception rules | Human authority and approval history | External bank connectors |
| Integration mapping | Decision-free packets and proof receipts | More held-out products |
| Bank UI language | Export, reopen, and tamper checks | Institution-specific deployment proof |

The promotion rule is conservative: customer-specific behavior becomes a core primitive
only after it survives the real product path and produces a portable receipt.

## Why this is relevant to a Casca FDE role

The project combines three capabilities:

1. **Operator fluency:** understand the banker, applicant, analyst, underwriter, and
   approver handoffs without collapsing them into a chat interaction.
2. **Production ownership:** implement the workflow inside the canonical product,
   deploy the reviewed code, and verify it through the rendered user path.
3. **Platform feedback:** separate one bank's configuration from reusable primitives
   and preserve the failure as a future release invariant.

The concise pitch is: **former JPMorgan banker and credit analyst turned AI product
engineer, building the systems I previously needed as a user.**

## Limitations and next tests

- The fixtures are synthetic and the workflow does not make a lending decision.
- The production-certified template supplies synthetic evidence through a governed
  proposal. A separate browser test with actual uploaded fixture bytes remains open.
- Neo4j/Aura has not been added. If used, it should remain a bounded, tenant-scoped read
  projection whose failure cannot corrupt or block NodeRoom.
- No external bank core, KYB, credit bureau, or document-provider connector is claimed.
- This work does not imply affiliation with or endorsement by Casca or JPMorgan Chase.

