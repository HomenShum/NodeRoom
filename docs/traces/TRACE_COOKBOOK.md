# Trace Cookbook

Use this recipe whenever a feature changes NodeAgent behavior.

## Add A Feature

1. Add or update a trace step.
2. Add a tool receipt for each tool call.
3. Add evidence receipts for cited sources, screenshots, DOM/PDF/markdown, or
   extracted facts.
4. Add mutation receipts for proposals, commits, skips, conflicts, and
   pending approvals.
5. Add UI rendering for the receipt when the user should inspect it.
6. Add an eval assertion that links the result to `traceId`.
7. Add browser proof for user-visible behavior.
8. Add a rework ledger entry when replacing old behavior.

## Minimal NodeAgent Trace

```ts
import {
  buildNodeAgentTrace,
  defaultTracePlan,
  traceContextPackFromFrame,
} from "../src/nodeagent";

const trace = buildNodeAgentTrace({
  traceId: "trace_job_123",
  roomId,
  agentJobId,
  startedAt: Date.now(),
  trigger: {
    kind: "spreadsheet",
    selectedArtifactIds: [sheetId],
    openedSurface: "workSurface.trace",
  },
  plan: defaultTracePlan("Reconcile Q3 revenue with source proof.", {
    reads: [{ kind: "cell", refId: "sheet!C4" }],
    writes: [{ kind: "cell", refId: "sheet!D4" }],
    approvalRequired: true,
    riskFlags: ["financial_fact"],
  }),
  contextPack: traceContextPackFromFrame(frame),
  agentResult,
});
```

## Done Criteria

The run is not done just because it generated text. A trace-backed feature is
done when a human or coding agent can answer:

```text
What did the user ask?
What did the agent see?
What context was included or excluded?
What tools were called?
What evidence was captured?
What changed?
What was approved?
What eval or UI proof backs the result?
```

## Commands

Run these when changing the NodeAgent trace spine:

```bash
npm run nodeagent:frame:smoke
npm run omnigent:nodeagent:smoke
npm test -- --run tests/nodeagentTraceSpine.test.ts
npm test -- --run tests/frameRunner.test.ts
```
