# Mobbin reference trace

This trace records the concrete reference atoms used for the Investigation Mode
surface. The references are design inputs, not implementation dependencies, and
no product copy or branded assets were reused.

## Adopted atoms

| Reference | Observed atomic fact | NodeRoom application | Verification signal |
| --- | --- | --- | --- |
| [StackAI Run Details](https://mobbin.com/screens/bb0174f4-60aa-4e30-ac5f-73679b160f38) | Files, Text Input, OpenAI, and Output form a vertical node list whose rows align with duration bars on one horizontal run-time axis. (`obs-stackai-run-details-1/f2`, `/f4`, `/f6`) | Investigation Mode keeps the five task rows visible as one execution sequence. Room Chat is not part of this mapping. | `tests/investigationSurface.test.tsx` verifies five bounded task rows before inspecting the selected-run detail contract. |
| [StackAI selected-node details](https://mobbin.com/screens/5ef8b027-f8ea-4a46-9c11-ab04084430c2) | The same vertical list remains visible with OpenAI highlighted while input, output, model, and token groups occupy the right detail region. (`obs-stackai-selected-node-1/f2`, `/f3`, `/f4`) | A selected `analysis-task-run` exposes its task identity, state, target, output, and error in `nr-investigation-run-detail` without replacing the task sequence. The Report/Teaching case toggle is not part of this mapping. | `aria-controls="nr-investigation-run-detail"` binds every task row to the one detail region; the selected run is read from the workspace contract. |
| [Airtable data grid](https://mobbin.com/screens/8ad4f505-28a8-4b6b-86a9-58c7d4c4dbd4) | One record maps to one row, fields align by column, and project state occupies one categorical field. (`obs-airtable-data-grid-1/f1`, `/f2`, `/f3`, `/f5`) | The report uses one seven-metric row and bounded task/claim rows with categorical states rather than a separate card for every field. | Entity, task, completed-run, collected-ref, verified-ref, supported-claim, and review counts remain visible above the task and evidence sections. |
| [Coinbase asset detail](https://mobbin.com/screens/47c660d9-e55d-4627-9a5d-193b2948dea3) | Tether identity and three tabs precede a price chart with six range choices; a Buy/Sell/Convert card with one Review order action sits beside the chart. (`obs-coinbase-asset-detail-1/f1`, `/f2`, `/f4`, `/f8`) | Dataset identity, Report/Teaching case tabs, the seven-metric row, and the single `Run pending research` action form the first report viewport. | `analysis-dataset-version`, view toggles, metric labels, and one `investigation-run-research` control are present. |

## Deliberate departures

- No chart is shown when the investigation has no trustworthy time series.
- No source is promoted to “supported” from visual status alone; the evidence
  receipt and field status gates remain authoritative.
- Room Chat remains a collaboration rail, but it is not cited as the StackAI
  task-detail analogue.
- The primary action stays disabled until explicit public-source egress consent
  is present.

## Acceptance

- One pinned Investigation tab and one report surface.
- One dominant run action.
- Seven lifecycle metrics.
- Task selection retains the task sequence and populates one exact run-detail
  region.
- In-place Report/Teaching case switching.
- Exact dataset and plan identity visible before execution.
- Source support, stale state, and review state derived from receipts rather
  than decorative badges.
