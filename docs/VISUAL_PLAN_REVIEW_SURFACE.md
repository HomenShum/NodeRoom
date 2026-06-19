# Visual Plan Review Surface

## Purpose

Visual Plans turn implementation plans into interactive, human-optimized review surfaces. They are intended for plans too important to bury in chat or terminal Markdown.

Visual Plans are renderings, not authority. For executable agent work, the
source of truth must be a structured plan object with a canonical hash. The MDX
or HTML view is the review surface for that object.

This document defines when NodeRoom should use a Visual Plan and what a NodeRoom Visual Plan should contain.

## Source Reference

BuilderIO Visual Plan skill:

- https://github.com/BuilderIO/skills/blob/main/skills/visual-plan/README.md

The referenced skill describes `/visual-plan` as an MDX-based review document with custom components for diagrams, wireframes, prototypes, file maps, annotated code, API specs, schema maps, open questions, and comments.

## Problem

Plain Markdown plans are useful but limited. For complex AI-agent work they often become:

- too linear
- too text-heavy
- hard to scan
- hard to approve
- easy to misread
- disconnected from actual files, schemas, and UI states

NodeRoom work frequently spans Convex schema, agent runtime, UI surfaces, privacy, evidence, traces, and evals. Those plans need a better review medium.

## When To Use

Use a Visual Plan for work that is:

- multi-file
- architecture-heavy
- data-heavy
- UI-heavy
- privacy/security-sensitive
- risky to reverse
- ambiguous or approval-dependent
- likely to affect multiple product surfaces

Examples:

- Convex ProseMirror notebook migration
- Agent Artifact / Agent Work Plan approval flows
- public/private agent boundary changes
- passive classifier redesign
- Coach Mode / Review Readiness
- OKF/evidence pipeline changes
- agent workflow/runtime changes
- schema and permission changes

Skip Visual Plans for trivial fixes where the diff is easier to review than a plan.

## Required Sections

A NodeRoom Visual Plan should include:

1. Decision summary
2. Current-state map
3. Target-state architecture diagram
4. Data-flow diagram
5. File map
6. Schema/table map
7. API/query/mutation contract
8. UI states or wireframes when relevant
9. Privacy/security boundary
10. Test and verification plan
11. Rollout and feature-flag plan
12. Open questions requiring human approval
13. Structured source object or schema when the visual plan represents work that
    can be approved or executed
14. Planned-vs-actual review path for executable plans

## NodeRoom-Specific Components

### Agent Runtime Plans

Include:

- `agentJobs` lifecycle
- Workflow/Workpool continuation
- tool permissions
- approval/evidence policy
- traces and receipts
- model egress boundary

### Notebook Plans

Include:

- ProseMirror Sync boundary
- `notebookDocuments` wrapper
- snapshot adapter
- processed read model
- sidecar proposals
- human approval bridge

### Privacy Plans

Include:

- public vs private surfaces
- ownerId/visibility propagation
- output classification inheritance
- redaction map
- retrieval/vector-search filters
- privacy regression tests

### Coach Mode Plans

Include:

- artifact selection
- question generation
- answer capture
- evidence-backed evaluation
- feedback states
- mastery tags
- source/cell/trace links

## Storage Policy

For source-controlled local plans:

```text
plans/<slug>/plan.mdx
```

For sensitive or enterprise/security plans, prefer local-files mode so the plan content stays local.

Hosted/shareable mode is appropriate when the plan is safe to share and comment collaboration is desired.

## Approval Gate

For risky work, implementation should not begin until the Visual Plan is reviewed.

```text
Draft Visual Plan
  -> review diagrams/contracts/questions
  -> approve direction or structured plan hash
  -> implement code
  -> verify with tests/build/Playwright
```

For in-app Agent Work Plans, approval means approving the canonical structured
payload hash. It does not mean approving arbitrary MDX/HTML. Buttons rendered in
visual plans must call checked Convex mutations.

## Relationship to Existing Docs

Use dated root notes for exploratory thinking. Use formal docs for durable architecture. Use Visual Plans for review-before-build decisions that need diagrams, file maps, contracts, and explicit approvals.

## Final Rule

If a plan is too important to review as a wall of prose, make it a Visual Plan before changing code.
