# Agent Artifacts

## Decision

NodeRoom should not make the notebook the place where every important agent
output lives. The notebook is the fast human capture surface. Important agent
work should become structured, reviewable, permission-aware Agent Artifacts.

The source of truth is structured data. React, MDX, HTML, and ASCII are
renderings of that data.

## Product Primitive

```ts
type AgentArtifact =
  | AgentWorkPlan
  | SpreadsheetDiffPreview
  | EvidenceCard
  | NotebookInsertProposal
  | CoachFeedbackArtifact
  | PlannedVsActualReport
  | SourceCoverageMap;
```

Agent Artifacts exist so the user can inspect what the agent intends to read,
write, cite, spend, and ask for before approving source-of-truth mutations.

## Core Loop

```text
Capture Notebook
  -> processed read model (+ future OKF links)
  -> Agent Work Plan
  -> rendered review surface
  -> explicit approval
  -> checked NodeAgent tools and Convex mutations
  -> Planned-vs-Actual Report
```

## Target Product Contract

```ts
type AgentArtifactBase = {
  artifactId: string;
  roomId: string;
  createdByJobId: string;
  createdByAgent: string;
  visibility: "private" | "room" | "public";
  status: "draft" | "proposed" | "approved" | "executed" | "rejected" | "superseded";
  kind:
    | "agent_work_plan"
    | "spreadsheet_diff_preview"
    | "evidence_card"
    | "notebook_insert_proposal"
    | "coach_feedback"
    | "planned_vs_actual"
    | "source_coverage_map";
  title: string;
  summary: string;
  structuredPayload: unknown;
  renderHints?: {
    preferredRenderer: "react" | "mdx" | "html" | "ascii";
    compact?: boolean;
    showEvidence?: boolean;
  };
  evidenceRefs: string[];
  targetRefs: string[];
  planHash?: string;
  approvedBy?: string;
  approvedAt?: number;
  createdAt: number;
  updatedAt: number;
};
```

## Current Shipped Schema

The 2026-06-18 backend slice ships the storage and approval contract needed for
the first artifact kind. The schema is intentionally smaller than the target
product contract above:

```ts
type ShippedAgentArtifactRow = {
  roomId: Id<"rooms">;
  artifactId?: Id<"artifacts">;
  jobId?: Id<"agentJobs">;
  kind:
    | "agent_work_plan"
    | "spreadsheet_diff_preview"
    | "evidence_card"
    | "coach_feedback"
    | "planned_vs_actual";
  status: "draft" | "proposed" | "approved" | "executed" | "rejected" | "superseded";
  title: string;
  createdBy: Actor;
  visibility: "private" | "room" | "public";
  ownerId?: string;
  payload: unknown;
  payloadHash: string;
  planHash?: string;
  approvedBy?: Actor;
  approvedAt?: number;
  executedJobId?: Id<"agentJobs">;
  createdAt: number;
  updatedAt: number;
};
```

`notebook_insert_proposal`, `source_coverage_map`, render hints, evidence ref
arrays, and target ref arrays are target product fields. They should be added
when their renderer/workflow has a concrete test and review surface.

## Agent Work Plan

```ts
type AgentWorkPlan = AgentArtifactBase & {
  kind: "agent_work_plan";
  structuredPayload: {
    goal: string;
    plannedReads: Array<{
      kind: "notebook" | "sheet" | "source" | "okf" | "trace" | "cache";
      ref: string;
      reason: string;
      visibility: "private" | "room" | "public";
    }>;
    plannedWrites: Array<{
      kind: "sheet_cell" | "notebook_insert" | "coach_cue" | "task" | "okf_concept";
      ref: string;
      writePolicy: "direct_if_clean" | "proposal_first" | "human_approval_required";
    }>;
    previewPatches: Array<{
      targetRef: string;
      currentValue: string | null;
      proposedValue: string;
      sourceRefs: string[];
      status: "verified" | "needs_review" | "estimate" | "manual";
    }>;
    evidenceRequirements: string[];
    privacyBoundary: "public_only" | "room_visible" | "private_allowed";
    risks: string[];
    openQuestions: string[];
    costEstimate: {
      modelCalls: number;
      searchCalls: number;
      sourceCaptures: number;
      estimatedUsd: number;
    };
  };
};
```

The user approves the canonical hash of this structured payload, not the
rendered MDX/HTML view.

## Security Rules

- Do not render arbitrary LLM HTML into the app.
- Render Agent Artifacts through allowlisted React/MDX components.
- Redact private refs for non-owners before rendering.
- Buttons call checked Convex mutations; the artifact itself does not mutate.
- `approvedPlanHash` must be copied onto the `agentJob` before execution.
- Planned-vs-actual review compares approved plan hash to receipts, traces,
  mutations, evidence refs, and actual cost.

## Renderer Surfaces

| Renderer | Purpose |
|---|---|
| React panel | Primary in-app review surface. |
| MDX visual plan | Developer/enterprise review package. |
| Static HTML | Local/exported artifact for audits and walkthroughs. |
| ASCII chat fallback | Compact version in chat or traces. |

## First Implementation Slice

The first shipped backend slice implements one artifact kind:
`agent_work_plan`.

Code:

- `convex/schema.ts` defines `agentArtifacts`.
- `convex/agentArtifacts.ts` creates work plans, computes canonical
  `payloadHash` / `planHash`, and approves only when the submitted hash matches
  the stored structured payload.
- `tests/notebookProcessingTarget.test.ts` covers the approval gate and proves
  the approved job receives `request.approvedPlanHash`.

Shipped backend happy path:

```text
user writes CardioNova note
  -> notebook read model creates one passive item
  -> Agent Work Plan artifact is created with structured payload
  -> user approval submits the exact planHash
  -> approveAgentWorkPlan re-hashes the stored payload
  -> matching hash creates/reuses a queued NodeAgent job
  -> job.request.approvedPlanHash carries the approved plan into execution
```

Remaining UI/product work:

- allowlisted React/MDX renderer for the plan review surface;
- Edit Scope / Dismiss actions;
- additional artifact kinds such as `notebook_insert_proposal` and
  `source_coverage_map`;
- Planned-vs-Actual artifact comparing approved plan, receipts, traces, cost,
  and final writes.

## References

- Anthropic Artifacts show the product value of rendered, inspectable outputs:
  https://www.anthropic.com/news/artifacts
- Anthropic's multi-agent research writeup describes persistent artifact
  handoff patterns and the cost discipline required for multi-agent workflows:
  https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic's Claude Agent SDK article discusses visual feedback loops for
  rendered outputs:
  https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
