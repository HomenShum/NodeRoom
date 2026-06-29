# Proof-receipt contract

A proof receipt is what turns "the agent says it's done" into "here is the evidence it's done."
This contract is generalized from NodeRoom's fresh-room proof registry — the reusable standard
NodeRL publishes.

## Shape

```json
{
  "caseId": "FR-020",
  "lane": "selective_live_task | full_suite",
  "status": "passed | partial | blocked",
  "proves": [
    "fresh live room", "official fixture upload", "public agent invocation",
    "export/download", "reopen", "scorer handoff"
  ],
  "gates": [
    { "id": "fresh_room_ui",   "label": "Fresh live-browser session + official prompt + public agent", "status": "pass | blocked" },
    { "id": "export_reopen",   "label": "Deliverable exported and reopened",  "status": "pass | blocked", "evidence": ["…/latest.json"] },
    { "id": "official_verifier","label": "Benchmark-faithful verifier handoff", "status": "pass | blocked", "evidence": ["…/package-manifest.json"] },
    { "id": "visual_judge",    "label": "Media/visual judge handoff",         "status": "pass | blocked", "evidence": ["…/summary.md"] }
  ],
  "perTask": {
    "taskId": "btb-…",
    "model": "…",
    "runtimeProfile": "benchmark_completion",
    "deliverables": [".xlsx", ".xlsm", ".pptx", ".docx", ".pdf"],
    "artifacts": {
      "trajectory": "…/trajectory.json",
      "packageManifest": "…/evidence/package-manifest.json",
      "boundaryReceipts": "…/evidence/boundary_box_receipts.json",
      "screenshots": "…/evidence/*.png"
    }
  }
}
```

## Rules

1. **`status` is computed from gates, not asserted.** If any required gate is `blocked`, the case
   is `blocked` or `partial` — never `passed`.
2. **A claim's scope is its lane.** A `selective_live_task` receipt proves one task. It does **not**
   license a "full suite passed" claim; that requires the `full_suite` lane to be `passed`.
3. **Evidence paths must resolve.** A gate with no resolvable evidence is `blocked`.
4. **No headline beyond the receipts.** The public claim is exactly what the receipts back —
   if the registry says `blocked`, the README says "in progress," not a number.

## Why a contract, not a dashboard

Receipts are machine-checkable and portable: another team can adopt the gate list, point their
own runner at it, and produce comparable proof. The dashboard is a view; the contract is the truth.
