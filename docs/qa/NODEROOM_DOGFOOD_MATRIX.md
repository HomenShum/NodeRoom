# NodeRoom Dogfood + QA Matrix

Generated: 2026-06-26

This is the universal QA bar for NodeRoom. Every row defines a real-user workflow, the surfaces it touches, how to prove it, and what "done" means.

## Proof Standard

Every serious QA flow should produce:

```
fresh room → real browser → real user action → public @nodeagent or private-agent →
visible streaming/progress → Focus Mode where relevant → trace panel →
artifact mutation visible → source/evidence view → screenshots → video →
trace.zip → exported files → reopened files → scorer/verifier result →
Gemini/visual judge → cost/latency telemetry → fresh-room receipt
```

## Categories

### A. Fresh-Room Entry

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| A1 | Blank room — user creates a room from scratch | landing, room shell | `e2e/fresh-room-blank.spec.ts` | Room opens, no dead panels, chat usable | P0 | shipped |
| A2 | Starter/demo room — user opens the demo room | landing, room shell, wall inventory | `e2e/privacy-job-wall-proposal.spec.ts` | Demo room loads, wall inventory default, all cards clickable | P0 | shipped |
| A3 | Shared link join — user joins via room code | landing, room shell | manual | Room code accepted, room state visible | P1 | shipped |
| A4 | Existing room reopen — user returns to a room | room shell, binder | manual | State restored, artifacts persisted | P1 | shipped |
| A5 | Mobile join — user joins on phone | responsive layout | `e2e/mobile-room.spec.ts` | No horizontal overflow, chat+artifact switchable | P1 | partial |
| A6 | Public observer join during agent run | room shell, chat | manual | Observer sees live state, no edit access | P2 | partial |
| A7 | Host + collaborator + observer | presence, permissions | manual | Three roles visible, permissions enforced | P2 | shipped |

### B. Chat / Collaboration

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| B1 | Public room chat — send a message | copilot panel | `e2e/chat-public.spec.ts` | Optimistic send, no duplicates | P0 | shipped |
| B2 | Private agent chat — send private message | copilot panel, private tab | `e2e/chat-private.spec.ts` | Private messages never leak to public | P0 | shipped |
| B3 | Mentions — @nodeagent in public chat | copilot panel | `e2e/nodeagent-public.spec.ts` | Agent receives and responds | P0 | shipped |
| B4 | Artifact references in chat | copilot panel, artifact panel | manual | Click opens correct artifact | P1 | shipped |
| B5 | File attachments in chat | copilot panel, file upload | `e2e/chat-attach.spec.ts` | File attached, preview opens | P1 | shipped |
| B6 | Multi-user concurrent messages | copilot panel | manual | No duplicate bubbles, order preserved | P1 | shipped |
| B7 | Mobile chat switch | responsive copilot | `e2e/mobile-room.spec.ts` | Chat ↔ artifact switch works | P1 | partial |

### C. Wall / Post-it / Inventory Surface

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| C1 | Wall opens by default when present | room shell, artifact panel | `tests/passiveIntelligence.test.tsx` | Wall is active tab on room open | P0 | shipped |
| C2 | Artifacts clustered by type | wall inventory | `tests/passiveIntelligence.test.tsx` | Groups: Deliverables, Spreadsheets, Files, Notes, Walls | P0 | shipped |
| C3 | Cards clickable — open target artifact | wall inventory, artifact panel | `e2e/privacy-job-wall-proposal.spec.ts` | Click card → correct artifact opens | P0 | shipped |
| C4 | Post-it add/edit/delete | wall captures | `e2e/privacy-job-wall-proposal.spec.ts` | CRUD persists, blur commits, delete syncs | P0 | shipped |
| C5 | Post-it conflict — two users edit same note | wall captures | manual | Last-write-wins or merge, no crash | P2 | partial |
| C6 | Empty room inventory | wall inventory | manual | Shows empty state, not blank | P1 | partial |

### D. Files / Previews / Evidence

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| D1 | Upload PDF | file upload, preview | `e2e/file-upload-pdf.spec.ts` | Artifact created, preview opens | P0 | shipped |
| D2 | Upload large PDF | file upload, preview | manual | No dead "PDF source stored" placeholder | P1 | partial |
| D3 | Upload XLSX | file upload, workbook preview | `e2e/file-upload-xlsx.spec.ts` | Workbook renders through unified grid | P0 | shipped |
| D4 | Upload CSV | file upload, sheet preview | `e2e/file-upload-csv.spec.ts` | CSV parsed, sheet renders | P0 | shipped |
| D5 | Upload DOCX | file upload, office preview | `e2e/file-upload-docx.spec.ts` | DOCX preview opens, content readable | P1 | shipped |
| D6 | Upload PPTX | file upload, office preview | `e2e/file-upload-pptx.spec.ts` | PPTX preview opens, slides visible | P1 | shipped |
| D7 | Upload image (PNG/JPG) | file upload, image preview | `e2e/file-upload-image.spec.ts` | Image renders, not broken | P1 | shipped |
| D8 | Drag/drop into chat | copilot panel, file upload | manual | Drag attaches file reference | P1 | partial |
| D9 | Paste upload | copilot panel | manual | Paste creates file artifact | P2 | partial |
| D10 | Multi-file batch upload | file upload | manual | All files create artifacts | P1 | partial |
| D11 | Evidence citation hover/click | artifact panel, evidence view | manual | Citation opens source with highlight | P1 | shipped |

### E. Spreadsheet Operations

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| E1 | Open sheet — no crash on malformed metadata | artifact panel, GenericSheet | `tests/passiveIntelligence.test.tsx` | No crash, columns render | P0 | shipped |
| E2 | Edit cell | artifact panel, sheet | `e2e/sheet-edit.spec.ts` | Value persists, version preserved | P0 | shipped |
| E3 | Export workbook to XLSX | artifact panel, export | `e2e/benchmark-ui-spreadsheetbench.spec.ts` | File downloads, reopenable | P0 | shipped |
| E4 | Reopen exported workbook | file system, sheet | `e2e/benchmark-ui-spreadsheetbench.spec.ts` | Reopened file matches | P0 | shipped |
| E5 | Scroll large sheet | artifact panel, sheet | manual | Smooth scroll, sticky headers | P1 | shipped |
| E6 | Column visibility — all columns visible | artifact panel, sheet | manual | No hidden columns, horizontal scroll works | P0 | shipped |
| E7 | Formula-like cells | artifact panel, sheet | manual | Formula cells protected, marked | P1 | shipped |
| E8 | Merged-cell metadata | artifact panel, sheet | `tests/passiveIntelligence.test.tsx` | No crash on merge ranges | P0 | shipped |

### F. Human + Agent Concurrency

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| F1 | Human edits C2 while agent works A1:C5 | sheet, trace, focus box | `e2e/human-agent-concurrency.spec.ts` | Human keeps typing, agent doesn't overwrite C2, C2 becomes proposal | P0 | partial |
| F2 | Agent clean cells commit | sheet, trace | `e2e/nodeagent-public.spec.ts` | Non-overlapping cells commit directly | P0 | shipped |
| F3 | Stale agent proposal | sheet, trace, review queue | manual | Stale output becomes proposal, not overwrite | P1 | shipped |
| F4 | Formula protection | sheet, trace | manual | Agent cannot overwrite protected formula | P1 | shipped |
| F5 | Multi-user live convergence | sheet, presence | `e2e/multi-user-convergence.spec.ts` | All clients converge to same state | P1 | shipped |

### G. Agent Lifecycle

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| G1 | Public @nodeagent — queued → running → completed | copilot, job panel, trace | `e2e/nodeagent-public.spec.ts` | Streaming visible, trace recorded | P0 | shipped |
| G2 | Private agent — private lane | copilot, private tab | `e2e/chat-private.spec.ts` | Private agent output stays private | P0 | shipped |
| G3 | Job cancel | job panel | manual | Cancel stops job, trace records cancellation | P1 | shipped |
| G4 | Job retry | job panel | manual | Retry works, first failure preserved | P1 | partial |
| G5 | Job failure — honest error UI | job panel, copilot | manual | Error visible, humanized, no raw stack | P1 | partial |
| G6 | Cost/latency/model telemetry | trace panel | `e2e/nodeagent-public.spec.ts` | Cost, latency, model, tool-count visible | P1 | shipped |

### H. Focus Mode

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| H1 | Focus Mode off → on | focus toggle, work surface | manual | Toggle works, no hijack | P1 | shipped |
| H2 | Select job to follow | focus mode, job panel | manual | Focus follows selected job only | P1 | shipped |
| H3 | User editing pauses follow | focus mode, sheet | manual | Focus does not hijack active typing | P1 | partial |
| H4 | Focus box on spreadsheet range | focus box, sheet | `e2e/focus-mode.spec.ts` | Box visible on correct range | P1 | shipped |
| H5 | Focus box on source PDF | focus box, PDF preview | manual | Box visible on correct page | P2 | partial |

### I. Notebook / Passive Intelligence

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| I1 | Capture note — blur/save | notebook, capture | `e2e/notebook-capture.spec.ts` | Note persists, passive chip appears | P0 | shipped |
| I2 | Passive chip → Noteworthy inbox | inbox panel | `tests/passiveIntelligence.test.tsx` | Chip classified, inbox entry created | P0 | shipped |
| I3 | Research / Add to sheet / Practice | inbox actions | `tests/passiveIntelligence.test.tsx` | Actions produce correct output | P1 | shipped |
| I4 | Agent sidecar/proposal — no arbitrary overwrite | notebook, proposals | manual | Agent writes proposals, not direct edits | P1 | shipped |
| I5 | Diligence memo alignment | notebook read model | `tests/passiveIntelligence.test.tsx` | No misalignment, clean rendering | P0 | shipped |

### J. Domain Workflows

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| J1 | GTM company match/enrich | sheet, chat, agent | `e2e/gtm-company-match.spec.ts` | CRM fields preserved, source cited | P1 | partial |
| J2 | Healthtech sector classification | sheet, agent | manual | Classification correct, no conflation | P2 | partial |
| J3 | Chat lead capture → watchlist row | chat, sheet | `e2e/chat-intake.spec.ts` | Lead creates row, fields mapped | P1 | shipped |
| J4 | PII masking in public summaries | chat, agent | `e2e/pii-masking.spec.ts` | PII masked in public, not in private | P0 | shipped |
| J5 | Finance cost reconciliation | sheet, agent | `e2e/finance-reconcile.spec.ts` | Reconciliation correct, evidence-bearing | P1 | partial |
| J6 | Timesheet/invoice review | sheet, agent | manual | Review produces correct output | P2 | partial |

### K. Benchmarks

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| K1 | FR-001 blank room first ask | fresh room, agent | `npm run fresh-room:proofs` | Fresh-room receipt valid | P0 | shipped |
| K2 | FR-010 SpreadsheetBench V1 | fresh room, sheet, export | `e2e/benchmark-ui-spreadsheetbench.spec.ts` | Export/reopen/score pass | P0 | shipped |
| K3 | FR-011 SpreadsheetBench V2 | fresh room, sheet, export, chart | manual | V2 workbook upload → export → reopen → score → chart/VLM grade | P0 | blocked |
| K4 | FR-020 BankerToolBench | fresh room, BTB package | `e2e/benchmark-ui-bankertoolbench.spec.ts` | Selective task pass, all deliverable types | P0 | shipped |
| K5 | FR-020B full BTB suite | fresh room, 100 tasks | manual | 100/100 tasks, aggregate score | P0 | blocked |
| K6 | FR-040 collaboration | fresh room, multi-user | `e2e/multi-user-convergence.spec.ts` | No-clobber proof, convergence | P1 | partial |
| K7 | FR-050 mobile | mobile room | `e2e/mobile-room.spec.ts` | Mobile review works | P1 | partial |
| K8 | FR-060 failure states | fresh room, error paths | manual | Honest failure UI, retry works | P1 | partial |

### L. Notifications / Downstream

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| L1 | Job completed notification | notification, deep link | manual | In-app notification, deep link valid | P2 | partial |
| L2 | Proposal needs review | notification, review queue | manual | Push/email draft, no private data in preview | P2 | partial |
| L3 | Export ready notification | notification, deep link | manual | Deep link opens exact artifact | P2 | partial |

### M. Accessibility / Visual Polish

| ID | User Story | Surfaces | Commands | Pass Criteria | Severity | Status |
|---|---|---|---|---|---|---|
| M1 | Keyboard navigation | all panels | manual | Tab through key controls | P1 | partial |
| M2 | Focus states | all interactive | manual | Visible focus rings | P1 | shipped |
| M3 | Color contrast | all surfaces | manual | WCAG AA on key text | P1 | shipped |
| M4 | Reduced motion | all surfaces | manual | Respects prefers-reduced-motion | P2 | partial |
| M5 | Screen-reader labels | key controls | manual | aria-labels on buttons, tabs | P1 | partial |
| M6 | Mobile/mid-width overflow | responsive | `e2e/mobile-room.spec.ts` | No horizontal overflow | P1 | partial |
| M7 | Gemini/visual judge scorecard | screenshots, video | `npm run gemini:judge` | No P0/P1 defects | P1 | shipped |

## Practical Dogfood Order

```
P0 — product sanity: blank room, starter room, wall/inventory default, upload/open, chat/send, @nodeagent, private no-leak
P1 — artifact work: spreadsheet edit/export/reopen, PDF/doc/ppt/image, evidence, proposals, notebook
P2 — human-agent collaboration: C2 vs A1:C5, stale proposal, formula protection, convergence
P3 — domain workflows: GTM, finance, banker package, mobile, notifications
P4 — benchmark proof: FR-001/002/010/011/020/040/050/060, BTB full matrix, SpreadsheetBench V2, official readiness
```
