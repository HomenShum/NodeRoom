# Browser E2E Flow Inventory

Updated: 2026-06-20

This is the concrete browser test inventory for NodeRoom's core workflows. The machine-readable source is [`browser-e2e-flow-inventory.json`](browser-e2e-flow-inventory.json); run `npm run qa:e2e:inventory:check` before changing the release claims.

## Product Rule

- Public room agent invocation is `@nodeagent ...`.
- The composer model picker records route preference: Adaptive, Free, Top paid,
  or Specific model. Browser specs should assert the server-resolved policy on
  the job detail; the client does not own `modelPolicy`, approval, evidence,
  allowlist, or rate-limit policy.
- `/ask` and `/free` are compatibility aliases only. They should remain accepted by the runtime, but they are not the taught UX in chips, docs, or walkthroughs.
- Private lane messages go to the user's private NodeAgent without requiring a mention.

## Gate Split

| Gate | Purpose | Runs |
| --- | --- | --- |
| Release floor | Stable PR gate for the product's core story | Single-user room shell, public chat, `@nodeagent` route selection, files/artifact refs, spreadsheet edit, proposal review, privacy basics, responsive shell |
| Nightly/full | Higher-cost proof for production confidence | Multi-user race cases, live-backend agent jobs, retry/cancel/resume, failure injection, private/public leak probes, wall/wiki collisions |

## Flow Inventory

| Flow | Release-floor examples | Nightly/full examples | Current state |
| --- | --- | --- | --- |
| Room entry and shell | Create demo room; panel toggles; usable desktop/compact shell | Join by room code from a second context | Partial: shell and responsive specs exist; join-by-code needs a dedicated two-context spec |
| Public chat | Send public message; edit own message | Forced failure and retry | Covered for send/edit; failure injection missing |
| Public `@nodeagent` | Mention agent; switch route picker; hidden slash alias mapping | Trace detail and live resolved-model drilldown | Partial: unit coverage for model routing; browser route smoke still needs a dedicated spec |
| Private agent | Private reply stays private | Promote private output; Room-mode shared action | Covered for private/public browser leak in production-preview; promote and Room-mode browser proof still need hardening |
| Durable jobs | Start Free route through model picker | Cancel, retry, detail drawer, reload resume | Covered in production-preview for free-route strip, details, cancel, and retry; live reload/resume remains open |
| Spreadsheet editing | Manual edit, keyboard commit, undo | Locked-cell rejection and stale conflict feedback | Partial: keyboard model covered; peer-visible undo/conflict gates need expansion |
| Proposals/review | Auto-allow off -> proposal -> approve | Reject, Accept all, non-host rejection | Covered for semantic proposal approve/reject feedback in production-preview; Accept all and live non-host rejection need browser proof |
| Research workflows | Company enrichment; upsert not duplicate | Artifact-targeted research with citations | Partial: deterministic harness exists; browser research flow is not complete |
| Files/artifact refs | Upload, paste, drag binder ref, open split | Reload and reopen uploaded artifact | Covered for upload/ref/split; reload persistence missing |
| Notes/wiki/wall | Note persistence; post-it CRUD | Wiki grounded update; multi-user wall collision | Wall add/edit/delete is covered in production-preview; note reload, wiki update, and multi-user wall collisions remain partial |
| Multi-user reactivity | Public chat across users; same-cell conflict | Agent-vs-human no-clobber; 3-user smoke | Partial: eval and 3-user specs exist; deterministic failure probes need expansion |
| Privacy/authz | Private leak proof; host-only controls | Private artifact ref boundary | Covered for private/public browser leak in memory preview plus server tests; live multi-user boundary matrix remains partial |
| Responsive shell | Desktop, tablet, mobile survival | Mobile full core flow | Mostly covered for layout; end-to-end mobile flow remains partial |
| Failure states | Agent dispatch error clears thinking | Optimistic rollback, partial upload failure, illegal job action | Partial: error surfaces exist; forced browser failure injection is the gap |

## Release-Floor Specs To Keep Fast

1. `e2e/chat.spec.ts` - public send/edit, file attach, artifact refs, `@nodeagent` taught UX.
2. `e2e/excel-grid.spec.ts` - manual edit, keyboard commit, workbook parity.
3. `e2e/privacy-job-wall-proposal.spec.ts` - private reply stays private, memory free-route job controls, wall CRUD, CRS reject.
4. `e2e/semantic-rebase.spec.ts` - proposal appears at changed cell; host approval applies it.
5. `e2e/responsive-qa.spec.ts` - desktop and compact shell sanity.
6. `e2e/work-surface-split.spec.ts` - center-stage split and source-open proof.
7. `e2e/reactivity.backend.spec.ts` - live Convex two-context chat/cell reactivity and same-cell CAS convergence.
8. `e2e/realtime-presence.spec.ts` - live Convex non-blocking spreadsheet presence.
9. `e2e/semantic-rebase.backend.spec.ts` - live Convex server-owned agent-intent proposal approval.
10. `e2e/live-broad-convex.spec.ts` - live Convex public/private chat isolation, wall CRUD fan-out, job cancel/retry, and agent-intent proposal rejection.

Future release-floor specs tracked in the JSON inventory but not yet committed:
`room-entry.spec.ts`, `nodeagent-public.spec.ts`, `job-controls.spec.ts`,
`research-flow.spec.ts`, `privacy-boundaries.spec.ts`, `note-wall.spec.ts`,
and `failure-states.spec.ts`.

## Nightly Specs To Expand

- `e2e/multiuser-reactivity.spec.ts` for same-cell conflict and public chat reactivity.
- `e2e/three-user-collab.spec.ts` for host + two members, agent proposals, and private boundaries.
- `e2e/failure-states.spec.ts` for optimistic rollback, agent dispatch errors, upload partial failure, illegal job controls.
- `e2e/wiki-flow.spec.ts` for agent-generated wiki table of contents and clickable artifact refs.
- `e2e/note-wall.spec.ts` for note persistence and post-it move/reload/collision.

## Maintenance Rule

Whenever a browser spec is added, renamed, or demoted, update `browser-e2e-flow-inventory.json` in the same commit. The checker is intentionally strict about:

- every flow having concrete steps and assertions;
- at least 18 release-floor scenarios;
- referenced coverage files existing;
- `@nodeagent` staying the public invocation contract;
- `/ask` and `/free` staying documented as hidden aliases, not visible UX.
