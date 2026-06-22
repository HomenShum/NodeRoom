# Live User QA Cases

Updated: 2026-06-21

This is the user-facing live browser QA matrix for NodeRoom. It is intentionally
stricter than a demo checklist: every case names the user story, the observable
browser assertion, and the automated proof file that currently covers it.

For Trace-specific proof boundaries, use
[`TRACE_USER_QA_CASES.md`](TRACE_USER_QA_CASES.md). Live browser QA proves the
collaboration surface and selected Trace Lens behavior; the full Trace workpaper
claim also depends on runtime, backend, eval, and provenance gates.

## Runbook

Use the full browser verification flow when validating release claims:

```bash
npm run test:product:memory
npm run test:product:live
npm run test:product:live:agent
```

`test:product:memory` is the fast release-floor browser suite against the
production bundle in memory mode. `test:product:live` runs the live Convex
multi-browser suite without provider calls, including the notebook work-plan
vertical. `test:product:live:agent` adds strict review mode and real provider
keys. For full production gating, `npm run prod:gate:live:agent` wraps the same
live gate after audit, security, typecheck, Vitest, memory-browser, build, and
dist scans.

## Latest Local Verification

Run date: 2026-06-21

| Layer | Command | Result | Notes |
|---|---|---:|---|
| Release-floor browser | `npm run test:product:memory` | 31/31 passed | Production bundle, memory mode, Chromium. |
| Live Convex browser | `npm run test:product:live` | 6/6 passed | Required unsandboxed network access. Covers backend reactivity, CAS loser convergence, advisory presence, notebook read-model/work-plan approval, private isolation, wall CRUD, job controls, and semantic proposals. |
| Live Convex strict agent browser | `npm run test:product:live:agent` | 6/6 passed | Required unsandboxed network access. Covers live Convex backend specs plus three-user public/private agent flow. |

The first live attempt inside the restricted sandbox timed out before the room
composer appeared in every live spec. The same command passed when rerun with
network access, so the recorded local result is a sandbox/network constraint,
not a product assertion failure.

## Live Convex User Cases

| ID | User case | Browser assertion | Proof |
|---|---|---|---|
| LV-01 | Host creates a live room and two collaborators join. | All browser contexts see the same room shell, live status, roster, and seeded Q3 variance sheet. | `e2e/three-user-collab.spec.ts` |
| LV-02 | Three people use public room chat. | Each public message fans out to every browser feed. | `e2e/three-user-collab.spec.ts`, `e2e/reactivity.backend.spec.ts` |
| LV-03 | A collaborator sends a private message. | Private text and private agent replies do not appear in public chat or another user's private lane. | `e2e/live-broad-convex.spec.ts`, `e2e/three-user-collab.spec.ts` |
| LV-04 | Two users edit different spreadsheet cells at the same time. | Both edits land in all browsers without blocking nearby work. | `e2e/three-user-collab.spec.ts` |
| LV-05 | Two users edit the same cell near-simultaneously. | CAS chooses one committed value; all browsers converge and the loser does not clobber the winner. | `e2e/reactivity.backend.spec.ts`, `e2e/three-user-collab.spec.ts` |
| LV-06 | A user sees someone else working in a cell. | Cell presence is visible and advisory; it does not disable the local editor. | `e2e/realtime-presence.spec.ts` |
| LV-07 | The public Room NodeAgent writes a cell. | The agent reads before writing, applies the exact requested value, and the value fans out to all browsers. | `e2e/three-user-collab.spec.ts` |
| LV-08 | A stale agent edit conflicts with human work. | Agent intent appears, CRS/proposal UI fans out, and host approval is required before commit. | `e2e/semantic-rebase.backend.spec.ts` |
| LV-09 | Review mode is on. | Agent writes become inline proposals at affected cells; host can approve, non-hosts cannot. | `e2e/three-user-collab.spec.ts`, `e2e/live-broad-convex.spec.ts` |
| LV-10 | Host rejects a semantic proposal. | Reject removes the CRS suggestion and preserves the host value. | `e2e/live-broad-convex.spec.ts` |
| LV-11 | A user adds, edits, and deletes wall notes. | Wall CRUD uses the same versioned mutation path and fans out through live state. | `e2e/live-broad-convex.spec.ts` |
| LV-12 | A user starts and controls a free-route job. | Job detail, cancel, retry, and resumed attempt controls are visible and mutate live backend state. | `e2e/live-broad-convex.spec.ts` |
| LV-13 | A private agent acts in the room lane. | A personal/private agent can produce room-visible work attributed through the owner, without leaking private chat text. | `e2e/three-user-collab.spec.ts` |
| LV-14 | Spreadsheet, note, and wall surfaces coexist in the room. | Browsers can open the core artifact surfaces; deeper all-artifact mutation coverage is deterministic rather than live-browser-only. | `e2e/three-user-collab.spec.ts`, `tests/allArtifactEdits.test.ts` |
| LV-15 | A user types a messy notebook note and wants the agent beside them, not inside the text. | The ProseMirror editor remains visible/editable, idle/blur queues notebook dirty metadata, the read model appears beside the note, an affected-source Agent Work Plan is drafted, exact plan-hash approval queues a job, and room trace shows read-model plus approval receipts. | `e2e/notebook-workplan-live.spec.ts`, `tests/notebookProcessingTarget.test.ts`, `tests/nativeNotebookProsemirror.test.ts` |

## Release-Floor Browser Cases

| ID | User case | Browser assertion | Proof |
|---|---|---|---|
| RF-01 | User sends and edits public chat. | Optimistic bubbles confirm and edit in place. | `e2e/chat.spec.ts` |
| RF-02 | User attaches files through chat. | Drop, paperclip, paste, and artifact-only references attach without extra text. | `e2e/chat.spec.ts` |
| RF-03 | User opens artifact references from chat. | Desktop opens beside the primary work surface; mobile switches back to the work surface. | `e2e/chat.spec.ts` |
| RF-04 | User invokes the taught public agent UX. | Quick chips use `@nodeagent`; slash aliases are not taught as primary UX. | `e2e/chat.spec.ts` |
| RF-05 | User works in an uploaded workbook. | File formats, formula bar, merged-cell-ish paper, CAS edits, formula display, and recalculation render correctly. | `e2e/excel-grid.spec.ts` |
| RF-06 | User uses spreadsheet keyboard muscle memory. | Arrow, type-to-replace, Enter, Tab, Escape, and Delete behave like a spreadsheet editor. | `e2e/excel-grid.spec.ts` |
| RF-07 | User fills down a range. | Range selection and fill-down rewrite values and formulas. | `e2e/excel-grid.spec.ts` |
| RF-08 | User expects private memory-mode chat isolation. | Private messages and memory-mode agent replies do not leak into public chat. | `e2e/privacy-job-wall-proposal.spec.ts` |
| RF-09 | User reviews a proposal in memory mode. | Rejecting a semantic conflict proposal removes it without overwriting host value. | `e2e/privacy-job-wall-proposal.spec.ts`, `e2e/semantic-rebase.spec.ts` |
| RF-10 | User uses wall notes in memory mode. | Post-its can be added, blur-committed, and deleted. | `e2e/privacy-job-wall-proposal.spec.ts` |
| RF-11 | User manages a free-route job in memory mode. | Job controls expose status, details, cancel, and retry. | `e2e/privacy-job-wall-proposal.spec.ts` |
| RF-12 | User changes viewport. | Phone, tablet, workspace, laptop, and desktop layouts remain usable. | `e2e/responsive-qa.spec.ts` |
| RF-13 | User splits the work surface. | Supported desktop widths open a second surface; compact widths correctly hide split. | `e2e/work-surface-split.spec.ts` |
| RF-14 | User opens source evidence. | Banker coach evidence opens its source beside the primary work surface. | `e2e/work-surface-split.spec.ts` |

## Visual And Media Proof Cases

| ID | User case | Browser assertion | Proof |
|---|---|---|---|
| VM-01 | Product is visually inspectable on desktop and mobile. | Scorecard captures desktop and mobile DOM/screenshots, with performance and accessibility layers. | `npm run qa:ui:scorecard -- --functional=passed`, `docs/eval/design-quality/latest.md` |
| VM-02 | Recorded live browser proof is judged by a VLM. | Gemini 3.5 Flash scores the checked-in live clip and records defects separately from functional gates. | `npm run media:gemini-judge -- --input=docs/eval/gemini-media-judges/live-convex-agent-20260621T113838Z/live-proof.webm --run-id live-convex-agent-20260621T113838Z --model gemini-3.5-flash` |

## Claim Boundaries

- We can claim broad live Convex browser coverage for privacy, wall CRUD, job
  controls, advisory presence, CAS no-clobber, agent intent, CRS proposals, and
  notebook-sidecar work-plan approval.
- We should not claim literal Google Sheets or Figma parity. The current claim is
  Google-Sheets/Figma-inspired collaboration behavior with stronger CAS truth.
- The current Gemini media judge result is `fix-then-publish`, not publish-grade
  media: the live clip demonstrates the workflow but needs the opening blank
  segment trimmed.
- Known gaps from `docs/qa/BROWSER_E2E_FLOW_INVENTORY.md` still include reload
  persistence for uploaded artifacts, live reload/resume for jobs, Accept all,
  dedicated join-by-code, richer failure injection, and multi-user wall collision
  coverage.
