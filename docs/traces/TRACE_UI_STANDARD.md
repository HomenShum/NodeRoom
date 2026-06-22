# Trace UI Standard

TraceView should answer five questions immediately:

```text
1. What did the user ask?
2. What did the agent see?
3. What did the agent do?
4. What changed?
5. Can I trust it?
```

## Required Views

| View | Purpose |
|---|---|
| Graph view | Show phases, branching, risk, where time was spent, and where the run failed. |
| Step list view | Let a human read every step, receipt, source, mutation, and verdict. |

## Required Step Content

Each important step should render:

- phase and title
- status or verdict
- model route and cost when available
- tool name, latency, and args/result hashes
- evidence refs and source open links
- screenshot or artifact preview
- source/cell highlight box when available
- mutation before/after or proposal/commit state
- approval badge
- eval verdict or failure class

## Visual Requirements

- Compact phase columns for scanability.
- Risk-colored minimap for large traces.
- Click node -> full step preview.
- Screenshot with highlighted box when the trace captured UI or source context.
- Tool log accordion for details without flooding the default view.
- Mutation diff cards for spreadsheet or artifact writes.
- Locked Builder-only ownership for private file/query/mutation/skill refs.

The public client state should show refs and bounded summaries. Raw private
payloads stay behind server-verified Builder access.
