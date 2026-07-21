# SMB Lending Deployment Room

## Decision

The Casca FDE proof is a domain workspace inside NodeRoom. The standalone
`casca-fde-deployment-lab` remains a reference implementation and portable case-study
source, but it is not a second product runtime.

## Ownership

| Concern | Canonical owner |
| --- | --- |
| Collaborative room, authentication, live state, CAS, approvals | NodeRoom |
| Generic plans, tools, routing, jobs, and frame lifecycle | NodeAgent |
| Lending vocabulary, requirements, graph queries, ratios, fixtures | SMB Lending Deployment Pack |
| Portable graph document and bounded graph result | NodeGraph contract |
| Deep relationship traversal | Neo4j read projection |
| Workbook operations and formula lineage | NodeRoom spreadsheet / NodeSheet contract |
| Trace and source workpapers | NodeTrace contract |
| Certification, held-out fixtures, and immutable receipts | ProofLoop / NodeProof |

Neo4j is never the authoritative room database. NodeRoom commits state, produces a
reviewable graph sync plan, and may project an approved `NodeGraphDocument` into
Neo4j for bounded read queries.

## First room

The room has three coordinated regions:

1. Deployment Quest rail: discovery, configuration, integration, validation, and
   launch status, including current blockers and human-required work.
2. Primary artifact stage: application, graph, workbook, evidence, credit packet,
   and deployment feedback board.
3. FDE Copilot: graph-aware questions, source-backed answers, proposed operations,
   and trace/proof summaries.

## Golden product journey

The primary fixture is a synthetic restaurant group requesting working capital.
The application starts with missing bank statements. The runtime explains the
blocker, proposes a document request against an exact base version, waits for human
approval, applies the request without making a lending decision, prepares a credit
review packet, exports it, reopens it, and issues a proof receipt.

The held-out fixture is a synthetic medical practice with a missing guarantor
personal financial statement. It prevents fixture-specific blocker logic.

## Benchmark modes

- Manual: static checklist and manual packet assembly.
- Chat only: agent answer without governed artifacts or graph state.
- NodeRoom pack: graph, workbook, evidence, proposals, review, and proof.
- Memory enhanced: a second deployment may reuse confirmed implementation lessons,
  never applicant facts or hidden evaluator data.

The comparison records mapping time, packet time, requirement recall, false
requirements, extraction and formula accuracy, source lineage, blocker accuracy,
human interventions, repair cycles, cost, reload/export success, and fresh-user
completion. Completion proof remains separate from any official semantic benchmark
score.

The checked-in evaluator implements the four named modes and reports each dimension
separately. Its tests are conformance fixtures, not live performance claims. Runtime,
human-intervention, tool-call, and provider-cost claims require an authenticated run
ID and receipt before publication.

## Governed evidence lifecycle

The reusable pack now implements both versioned transitions:

1. `missing -> requested` through a human-reviewed document-request proposal.
2. `requested -> verified` through a separate human-reviewed evidence proposal that
   requires an immutable content hash.

Both transitions reject stale base versions. After evidence verification, the packet
is regenerated with no unresolved blocker and still records `decision: not_made`.
The packet, application, and proof receipt can be exported as a content-checked JSON
bundle; reopen rejects any tampered application or packet.

## Browser-complete local golden slice

The `#smb-lending` route now exposes two sequential native proposal operations. The
hashed evidence proposal is not created until the document request passes final CAS.
After the second human approval, NodeRoom writes exact source and locator lineage,
regenerates the decision-free packet and proof receipt, enables a byte-backed JSON
download, and independently reopens the downloaded bundle to verify both hashes.

The deterministic local profile persists this synthetic workflow state in browser
storage so a reload can prove recovery. This is deliberately labeled local; production
certification still requires the same journey through authenticated Convex state.

The live four-mode benchmark used `gpt-4.1-mini` for three repetitions each of chat-only,
graph-agent, and memory-enhanced lanes. The medical fixture was held out and the evaluator
was applied only after candidate emission. Results are dimensional and make no universal
winner claim.
