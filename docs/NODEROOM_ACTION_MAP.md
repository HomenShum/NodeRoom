# NodeRoom Action Map

NodeRoom should run safe work automatically and ask humans only when cost, privacy, evidence, or mutation risk crosses a threshold.

## Budget Lanes

| Profile | Default? | Approval | Use |
|---|---:|---:|---|
| `instant` | no | no | Small read/draft work. |
| `standard` | yes | no | Default public `@nodeagent` lane. |
| `background` | no | no | Safe resumable continuation while progress is clear. |
| `deep_diligence` | no | yes | Host-approved long run with cost/time estimate. |
| `benchmark_completion` | no | yes | Opt-in, high-budget eval lane; requires explicit approval before it spends. |

The single source of truth is `src/nodeagent/core/budgetProfiles.ts`; the runtime policy view in `src/nodeagent/runtimeProfiles.ts` is derived from it. The default public lane must remain conservative; the two high-budget lanes (`deep_diligence`, `benchmark_completion`) are opt-in and require explicit approval before spending (direction audit 2026-07-12, C1).

## Low-Friction Policy

| Workflow | Friction | Agent behavior |
|---|---:|---|
| Read current room context | zero clicks | Auto-read allowed context. |
| Classify obvious note/entity | zero clicks | Passive chip or inbox item. |
| Search public source under small budget | zero or one click | Auto-run if policy allows. |
| Write new blank row/cell | low | Auto-commit when clean and evidence-backed. |
| Modify human-authored cell | review required | Proposal, not overwrite. |
| Touch formula cell | review required | Preserve formula unless explicitly approved. |
| Use private notes in public output | blocked/approval | Never silently leak. |
| Send to Slack/Gmail/CRM | explicit approval | Downstream draft first. |
| Run expensive deep diligence | explicit approval | Plan, budget, background job. |

## End-to-End UI Contracts

| Flow | UI touched | Backend touched | Friction target |
|---|---|---|---|
| Create/join room | Landing, room code input, header, binder, chat, artifact surface | room create/join, membership query, artifact query | 1 click or paste code |
| Type messy note | Capture notebook, editor, save status, Noteworthy chip/inbox | ProseMirror sync, dirty signal, snapshot processor, classifier | zero extra clicks |
| Public `@nodeagent` prompt | Composer, model/profile label, public feed, job card, stream line, trace tab, Focus Mode | optimistic message, `startPublicAsk`, job row, runtime policy, slice loop, trace | one text submission |
| Agent fills cells | Grid, formula bar, intent outline, evidence chips, proposal/conflict card, trace row | spreadsheet context, lock/claim, CAS, semantic rebase, mutation receipt | auto-commit clean cells |
| Human edits during agent work | human focus box, agent affected-set outline, proposal badge, conflict card | presence claim, affected-set claim, branch work, short commit lease | human never loses cursor |
| Capture source/evidence | source viewer, citation hovercard, evidence card, bbox, trace preview | `capture_source`, `cite_in_file`, `source_open_literal`, evidence fact | one hover/click to inspect |
| Focus Mode follow-along | Focus toggle, watch task selector, artifact surface, trace caption, boxes | selected job subscription, focus events, affected ids, evidence bboxes | one toggle |
| Review proposal | proposal card, diff, evidence card, accept/reject/edit buttons | apply proposal, CAS final check, mutation receipt | batch accept clean proposals |
| Export deliverable | export toolbar, download toast, proof receipt panel, scorecard | export action, file generation, download, reopen validation, scorer handoff | one export click |
| Coach readiness | coach panel, answer box, feedback card, missed evidence refs | evidence packet, evaluation action, readiness delta | optional one-click |
| Downstream sync | draft panel, destinations, evidence summary, send/export confirmation | permission check, connector action, trace receipt | draft-first, never silent send |

## Release Rule

Every workflow that produces a claim must have:

```text
fresh room or honest starting state
real user input path
visible streaming/progress
artifact mutation or exported file
trace/video/receipt evidence
scorer or verifier when benchmarked
budget profile label
```

The fresh-room proof receipts in `docs/eval/fresh-room/<case-id>/latest.json` are the benchmark-facing version of this rule.
