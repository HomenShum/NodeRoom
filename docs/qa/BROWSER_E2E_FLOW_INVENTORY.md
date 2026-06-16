# Browser E2E Flow Inventory

Updated: 2026-06-16

This is the concrete browser test inventory for NodeRoom's core workflows. The machine-readable source is [`browser-e2e-flow-inventory.json`](browser-e2e-flow-inventory.json); run `npm run qa:e2e:inventory:check` before changing the release claims.

## Product Rule

- Public room agent invocation is `@nodeagent ...`.
- The composer model picker controls route policy: Adaptive, Free, Top paid, or Specific model.
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
| Private agent | Private reply stays private | Promote private output; Room-mode shared action | Partial: privacy semantics exist, room-mode browser proof needs hardening |
| Durable jobs | Start Free route through model picker | Cancel, retry, detail drawer, reload resume | Partial: live CLI smoke exists; browser controls need fuller coverage |
| Spreadsheet editing | Manual edit, keyboard commit, undo | Locked-cell rejection and stale conflict feedback | Partial: keyboard model covered; peer-visible undo/conflict gates need expansion |
| Proposals/review | Auto-allow off -> proposal -> approve | Reject, Accept all, non-host rejection | Partial: unit and some 3-user proof exist; Accept all needs browser proof |
| Research workflows | Company enrichment; upsert not duplicate | Artifact-targeted research with citations | Partial: deterministic harness exists; browser research flow is not complete |
| Files/artifact refs | Upload, paste, drag binder ref, open split | Reload and reopen uploaded artifact | Covered for upload/ref/split; reload persistence missing |
| Notes/wiki/wall | Note persistence; post-it CRUD | Wiki grounded update; multi-user wall collision | Partial: wall/wiki tests exist but browser coverage needs consolidation |
| Multi-user reactivity | Public chat across users; same-cell conflict | Agent-vs-human no-clobber; 3-user smoke | Partial: eval and 3-user specs exist; deterministic failure probes need expansion |
| Privacy/authz | Private leak proof; host-only controls | Private artifact ref boundary | Partial: server tests exist; browser proof needs full matrix |
| Responsive shell | Desktop, tablet, mobile survival | Mobile full core flow | Mostly covered for layout; end-to-end mobile flow remains partial |
| Failure states | Agent dispatch error clears thinking | Optimistic rollback, partial upload failure, illegal job action | Partial: error surfaces exist; forced browser failure injection is the gap |

## Release-Floor Specs To Keep Fast

1. `e2e/room-entry.spec.ts` - create room, join shell, panel toggles.
2. `e2e/chat.spec.ts` - public send/edit, file attach, artifact refs, `@nodeagent` taught UX.
3. `e2e/nodeagent-public.spec.ts` - `@nodeagent` adaptive/free/top/specific route starts, job/trace affordance visible.
4. `e2e/private-agent.spec.ts` - private reply stays private, promote explicit.
5. `e2e/job-controls.spec.ts` - Free route starts through the picker; detail strip is visible.
6. `e2e/excel-grid.spec.ts` - manual edit, keyboard commit, undo.
7. `e2e/proposals-review.spec.ts` - proposal appears at changed cell; host approval applies it.
8. `e2e/research-flow.spec.ts` - upsert without duplicate rows.
9. `e2e/privacy-boundaries.spec.ts` - public/private leak and host-only controls.
10. `e2e/responsive-qa.spec.ts` - desktop and compact shell sanity.

## Nightly Specs To Expand

- `e2e/multiuser-reactivity.spec.ts` for same-cell conflict and public chat reactivity.
- `e2e/three-user-collab.spec.ts` for host + two members, agent proposals, and private boundaries.
- `e2e/failure-states.spec.ts` for optimistic rollback, agent dispatch errors, upload partial failure, illegal job controls.
- `e2e/wiki-flow.spec.ts` for agent-generated wiki table of contents and clickable artifact refs.
- `e2e/note-wall.spec.ts` for note persistence and post-it CRUD/collision.

## Maintenance Rule

Whenever a browser spec is added, renamed, or demoted, update `browser-e2e-flow-inventory.json` in the same commit. The checker is intentionally strict about:

- every flow having concrete steps and assertions;
- at least 18 release-floor scenarios;
- referenced coverage files existing;
- `@nodeagent` staying the public invocation contract;
- `/ask` and `/free` staying documented as hidden aliases, not visible UX.
