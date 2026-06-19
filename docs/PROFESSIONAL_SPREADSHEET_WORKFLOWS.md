# Professional Spreadsheet Workflows

This is the product-facing map for supporting the reviewed CSV/XLSX workflows in
NodeRoom. The companion eval plan is `docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md`.

## Workflow Families

### GTM And Company Research

Examples:

- PitchBook upload templates and match results.
- ParselyFi company reports and classification outputs.
- Healthtech/JPM conference lists.
- Sector-tagging and investor/company brief workbooks.

NodeRoom support pattern:

```text
upload files -> open artifacts -> drag refs into chat
  -> search_sheet_context narrows relevant rows
  -> SpreadsheetDiffPreview artifact shows planned changes
  -> agent writes CellPayloads for match, classification, reason, and source
  -> wiki/note summarizes cited results
```

What must be enforced:

- Original CRM/source columns stay untouched unless explicitly targeted.
- Ambiguous matches become `needs_review`, not guesses.
- Every enrichment/classification write carries evidence.
- Public summaries avoid contact PII by default.

### Finance And Operations

Examples:

- AI cost exports and partial parsed outputs.
- Business income/expense templates.
- Timecards, timesheets, and invoice-review sheets.
- Brokerage/account transaction exports.

NodeRoom support pattern:

```text
upload source + template -> parse schema/layout/formulas
  -> reconcile or populate bounded cells
  -> lock formula dependencies
  -> preview formula/value changes as an Agent Artifact
  -> write variance/exception notes with evidence
  -> review before final output
```

What must be enforced:

- Formula cells are preserved unless formula editing is the requested task.
- Already-correct cells are skipped without a version bump.
- Raw account, transaction, timestamp, payroll, and worker details are masked in
  public output.
- Source rows/ranges are cited for totals and exceptions.

### Harness And Context Engineering

Examples:

- NodeBench fast/slow templates.
- UI action to file/class/data-flow mappings.
- Prior generated artifacts that need migration into a room wiki.

NodeRoom support pattern:

```text
workflow evidence -> typed eval case
  -> starting room state
  -> allowed tools
  -> expected artifact state
  -> expected trace
  -> runtime/cost/privacy budget
```

What must be enforced:

- Cases are executable or explicitly marked live/optional.
- Results never store raw private fixture rows.
- Long-running cases use `/free` with checkpoints and resolved-model audit.
- Wiki updates use stable sections and cited artifact ids.

### Analytics And Optimization

Examples:

- Weighted hotel/option ranking.
- Project idea comparison.
- Workout progress dashboards.

NodeRoom support pattern:

```text
parse table -> expose assumptions/weights
  -> compute derived score or aggregate
  -> update only dependent outputs
  -> explain sensitivity and uncertainty
```

What must be enforced:

- Scores cite source columns and weight assumptions.
- Unit semantics are preserved; dollars, hours, distance, duration, and points do
  not collapse into one opaque number.
- Personal logs are summarized, not dumped.

## Current Support

Built:

- CSV/TSV/XLSX parsing into sheet artifacts.
- Artifact browsing and drag-to-chat references.
- Spreadsheet semantic index and `search_sheet_context`.
- Evidence-bearing `CellPayload` writes.
- Cross-file reads/writes and grounded wiki updates.
- Lock/CAS/draft/no-clobber collaboration protocol.
- Formula dependency records for lock expansion.
- Provider parser adapter plus LiteParse fallback smoke.
- Workflow/Workpool-backed `/free` jobs with checkpoints and resolved-model
  attempt audit.
- First Agent Artifact backend slice for `agent_work_plan` approval by
  canonical `planHash`.

Still production work:

- Convex File Storage for canonical raw-file upload in all modes.
- Agent-operable `parse_file`/`ingest_file` tool over stored files.
- Server-side parsing lane for large workbooks and non-spreadsheet documents.
- PII classifier/redaction policy with retention and provider-egress controls.
- Exact-once side-effect journal for provider file uploads and row-level bulk
  jobs.
- Spreadsheet diff preview and planned-vs-actual Agent Artifact renderers.
- Redacted fixture packs converted from the reviewed workflow shapes.

## Interview Explanation

Say:

> The professional workflow work was context engineering first. I profiled real
> files to learn the shape of the work, then converted that shape into redacted
> eval cases. The harness is the product boundary: it decides what context the
> model sees, which tools may mutate state, how evidence is stored, how privacy
> is enforced, and how long-running work resumes.

Then connect it to users:

> A GTM user uploads company lists and expects sourced classifications. A finance
> user uploads cost, transaction, or timesheet files and expects safe
> reconciliation. Both users need the same guarantees: files are clickable,
> sources are cited, private values are protected, and the agent cannot silently
> clobber a spreadsheet.
