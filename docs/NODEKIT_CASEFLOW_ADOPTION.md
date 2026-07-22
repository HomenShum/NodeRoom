# NodeKit Caseflow adoption boundary

NodeRoom/NodeSheet consumes NodeKit Caseflow from the exact source candidate
`5cc61578b3c1bd5b5c8195b83347b91f8b83242b`. The dependency is pinned to that
commit's immutable GitHub archive, and application code imports the supported
`@homenshum/nodekit/caseflow` subpath. This is a consumer integration, not a
published Convex component and not evidence that NodeKit is released on npm.

## Runtime mapping

| Portable Caseflow concept | NodeRoom implementation |
| --- | --- |
| Case | `nodekitCaseflowCases`, scoped to a verified room member |
| Run and stages | `nodekitCaseflowRuns`; active start is claim-or-reuse and stages keep an explicit next-action owner |
| Artifact | `nodekitCaseflowArtifacts` references a real private NodeRoom `artifacts` row and its reserved canonical `elements` cell |
| Artifact version | `nodekitCaseflowArtifactVersions` records the portable version and content hash; the authoritative write still passes through `applyCellEditCore` and NodeRoom's existing element CAS |
| Proposal and approval | `nodekitCaseflowProposals` and `nodekitCaseflowApprovals`; proposals do not mutate canonical content, stale acceptance fails closed, and a repeated identical decision returns the original approval without a second version |
| Exception and recovery | `nodekitCaseflowExceptions`; preserved state remains durable and resolution sets an explicit next action and owner |
| Event and receipt | `nodekitCaseflowEvents` plus immutable `nodekitCaseflowReceipts`; completion hashes the exact canonical receipt body and repeated completion returns the same row and hash |

The client adapter is
`src/integrations/nodekit/caseflowAdapter.ts`. It overwrites any caller-supplied
scope with its application-owned `roomId` and actor proof before invoking the
Convex functions in `convex/nodekitCaseflow.ts`. Every public lifecycle function
calls `requireActorProof`, reloads the member and room, requires a live room, and
checks the record's `roomId` and `ownerMemberId`. A different authenticated
member in the same room cannot read or mutate another member's lifecycle.

## Ownership boundary

Application-owned data stays in NodeRoom:

- Convex Auth identity, `rooms`, `members`, membership roles, revocation, and actor proof;
- `artifacts`, `elements`, `elementVersions`, locks, drafts, and the existing domain proposal surface;
- `RoomTools`, `agentJobs`, attempts, model-step journal, operation journal, leases, and streams;
- traces, `agentMutationReceipts`, finance and evaluation receipts, evidence, exports, file storage, and UI state.

Possible future Caseflow-component-owned data is limited to the isolated
`nodekitCaseflow*` lifecycle tables: cases, runs/stages, artifact references and
portable versions, proposals/approvals, exceptions, events, and completion
receipts. A component would receive only server-resolved owner/workspace and
external-resource identifiers. It must not own or reimplement NodeRoom auth,
room roles, domain artifacts, jobs, journals, prompts, model execution, storage,
or UI.

The generic conformance journey has no `agentJob`, so its receipt truthfully
records an empty `domainReceiptIds` list instead of inventing a domain receipt.
When an application workflow launches Caseflow, existing NodeRoom domain
receipt IDs can be referenced while their source rows remain application-owned.

## Verification and claim boundary

`tests/nodekitCaseflowConformance.test.ts` uses `convex-test` and the packaged
`runCaseflowConformance` function. It separately proves two Convex-authenticated
members, member-owner isolation, stale conflict behavior, exact decision and
completion reuse, exception recovery, next-action ownership, reload durability,
one authoritative artifact version increment, and receipt-hash recomputation
with NodeKit's packaged `contentHash`.

This revision may count only as the NodeRoom/NodeSheet consumer if those tests,
NodeRoom's floor, and build pass on the same implementation revision. It does
not establish three consumers, authorize component extraction, publish a
package, deploy Convex, mutate production, or satisfy NodeKit submission gates
that require independent consumers or human evidence.
