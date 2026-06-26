# NodeRoom Anti-Shallow QA Policy

> **No visible workflow, no QA. No before/after proof, no UX fix. No receipt, no benchmark claim.**

## Core Rules

1. **No DOM-only pass for visual UI.** DOM inspection can say elements exist while the screenshot shows a broken or empty surface. A pass requires headed browser screenshots proving pixels are visible and understandable.

2. **No unit-only pass for collaboration.** Unit tests prove the CAS engine works; they do not prove two real browser contexts can collaborate without clobbering. A pass requires a live two-user browser proof.

3. **No screenshot-only pass for data workflows.** A screenshot proves pixels; it does not prove the data is correct. A pass requires export/reopen validation and domain invariant checks.

4. **No export-only pass without reopen validation.** A file download proves bytes exist; it does not prove the file is valid. A pass requires reopening the file from disk and scoring its contents.

5. **No benchmark claim without fresh-room receipt.** A runner-only pass proves plumbing; it does not prove a real user workflow. A pass requires a fresh-room proof receipt with durable evidence paths.

6. **No finance/domain claim without evidence/no-clobber/privacy gates.** Financial outputs must have source citations, no-clobber proof, and privacy redaction checks.

7. **No UX fix without before/after screenshot.** A code change proves intent; it does not prove the user-visible result. A pass requires a before screenshot (showing the issue) and an after screenshot (showing the fix).

8. **No fix claim unless the old issue is captured as a regression fixture.** A fix that cannot regress is not a fix. A pass requires a test that fails if the old behavior returns.

## Minimum Proof Depth by Feature Type

| Feature Type | Minimum Proof |
|---|---|
| Pure utility | unit + negative fixture |
| UI component | DOM + screenshot + console check |
| User workflow | headed browser + video/trace + reload |
| File upload/preview | upload + open + reload + attach/reference |
| Spreadsheet | visible headers/data + edit/version/CAS + export/reopen |
| Human-agent collaboration | two browser contexts + no-clobber + proposal/trace/focus boxes |
| Finance workflow | evidence facts + citations + privacy + export/reopen |
| Benchmark | fresh room + public @nodeagent + trace/video + scorer/verifier + receipt + visual judge if available |
| Notification/downstream | audience + privacy redaction + idempotency + delivery/draft receipt |

## QA Depth Ladder

| Level | Check | Example |
|---|---|---|
| L0 | Component compiles | `tsc --noEmit` passes |
| L1 | Unit test passes | `columnsOf` returns expected columns |
| L2 | DOM has expected nodes | `[data-element-id="r1__A"]` exists |
| L3 | Screenshot proves it is visible | Headers and data are pixel-visible |
| L4 | User path completes | Click tab → see data → edit cell → save |
| L5 | Reload/reopen still works | Reload page → same artifact opens → data persists |
| L6 | Visual judge / human review says it is understandable | Gemini or human confirms screenshot is legible |
| L7 | Regression fixture blocks the old failure | Test fails if old screenshot/condition returns |

**Minimum for visual UI: L3.** Minimum for user workflows: L4. Minimum for benchmark claims: L4 + receipt.

## Change Budget Policy

| Level | Scope | When to use |
|---|---|---|
| Level 0 | Copy, labels, helper text, tooltips | Empty state text, button labels |
| Level 1 | CSS/state treatment only | Active tab styling, focus ring, contrast |
| Level 2 | Internal component layout or state guard | Sheet fallback state, column visibility guard |
| Level 3 | Information architecture change | Default surface or tab hierarchy |
| Level 4 | Data model, routing, or shell architecture | Only if tests prove architecture is broken |

**For dogfood UX fixes, prefer Level 0–2.** Use Level 3 only if screenshots show the current IA is itself the failure. Avoid Level 4 unless tests prove the architecture is broken.

## UX Issue Receipt Format

Every UX issue found during dogfood must produce:

```json
{
  "issueId": "ux-<surface>-<symptom>",
  "surface": "<artifact or panel name>",
  "severity": "P0|P1|P2",
  "type": "user-visible-state|visual-bug|workflow-bug|taste-issue|architecture-issue",
  "observed": "<what the user sees>",
  "whyItMatters": "<why a first-time user is confused>",
  "minimalFixLevel": 0|1|2|3|4,
  "allowedChanges": ["<specific changes>"],
  "forbiddenChanges": ["<what not to touch>"],
  "proofRequired": ["before screenshot", "after screenshot", "console error check"],
  "beforeScreenshot": "docs/qa/screenshots/<issue-id>-before.png",
  "afterScreenshot": "docs/qa/screenshots/<issue-id>-after.png",
  "filesChanged": ["<files>"],
  "testsRun": ["<test commands>"],
  "consoleErrorCount": 0,
  "layoutArchitectureChanged": false,
  "whyNotRedesign": "<explanation>"
}
```

## Durable Evidence Paths

All proof artifacts must be saved to durable paths under `docs/eval/` or `docs/qa/`:

- Screenshots: `docs/qa/screenshots/<issue-id>-{before,after}.png`
- Videos: `docs/eval/fresh-room/<case-id>/evidence/<task-id>.webm`
- Traces: `docs/eval/fresh-room/<case-id>/evidence/<task-id>.zip`
- Exports: `docs/eval/fresh-room/<case-id>/evidence/<filename>`
- Receipts: `docs/eval/fresh-room/<case-id>/latest.json`

**Never use `test-results/` paths in proof receipts.** These are transient and machine-specific.

## Receipt Validation

A proof receipt is valid only when:
- `memoryMode` is `false`
- `passed` is `true`
- All `screenshotPaths` exist on disk
- All `exportedFiles` paths exist on disk
- All `reopenedFiles` have `reopened: true`
- `scorer.verdict` is `"pass"` (when scorer is required)
- All required gates are in `gatesProven`
- No gates in `gatesNotProven` that are required
