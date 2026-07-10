# NodeRoom First-Run Baseline Behavior Inventory

Captured before implementation: 2026-07-10

This table is the baseline receipt. Completed outcomes and current blockers are
recorded in `FIRST_RUN_EXECUTION_RECEIPT.md`; do not read the baseline column as
the current implementation.

| Entry/action | Current behavior | Durable call/state | Required result |
|---|---|---|---|
| Public SSR Create | Links directly to `?create=1&surface=desktop` | URL triggers app mutation | Route to a preflight intent; never force desktop or mutate from the link. |
| React desktop Create | Opens title/name dialog | `rooms.createStarterRoom`, auto-allow true | Empty `rooms.create`, review-first, truthful code-access copy. |
| Desktop sample | Memory demo or live starter mutation | `rooms.createStarterRoom` | Explicit sample preflight and persistent sample identity. |
| Desktop Join | Code, then guest-name dialog | `rooms.joinAnonymous` | Preserve code and show code-access/audience truth. |
| Mobile root | Join form plus demo | local state | Add explicit Create and keep Join/Sample distinct. |
| Mobile Create URL | Can stage a create request immediately | `rooms.create` | Stage create form and policy confirmation before mutation. |
| Mobile demo URL | Stages policy consent | `rooms.createStarterRoom` | Keep consent, default to Review, label sample. |
| Room creation | Desktop seeds starter room | room/member/agents/artifacts/traces | Blank create is empty; sample create alone seeds fixtures. |
| Session restore | Per-room token in localStorage | `noderoom:live:<CODE>` | Preserve across reload; invalid/revoked proof returns to Join with a reason. |
| First room | Desktop Home plus broad controls | live room/store | One primary task; advanced systems remain reachable but secondary. |
| Mobile first join | Non-modal welcome | sessionStorage | Label sample/live truth and preserve composer interaction. |
| Public chat | Room channel | message + agent job paths | Label `Everyone in this room`; never imply public internet visibility. |
| Private chat | User-owned private lane | private message/agent path | Label it private inside NodeRoom and disclose that requests/context go to the configured model provider. |
| Agent edits | Auto-allow or proposals | room policy + CAS/proposals | Review-first default; audience and mutation authority visible before send. |
| Export XLSX | Real browser download and filename status | client workbook build | Add format, row count, timestamp, and failure/retry receipt. |
| Leave | Revokes/clears current session | `rooms.leave`, localStorage | Revoke an ordinary member and return to entry; keep a host active until ownership can be transferred. |

## Dirty-Lane Boundary

The working tree contains mobile, work-artifact, graph, proofloop, benchmark,
Convex, and release changes from other lanes. Do not revert them. Preview and
production deployment must come from an isolated, reviewed snapshot; the mixed
working directory is not itself a deployable artifact.
