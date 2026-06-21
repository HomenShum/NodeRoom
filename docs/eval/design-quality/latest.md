# Design Quality Scorecard

Generated: 2026-06-21T08:49:26.120Z
Run: `20260621T084925Z`
Commit: `cde83160+dirty`
Scenario: `prod_gate_and_live_product_gate_2026-06-21`

> Product correctness remains pass/fail. This scorecard does not turn functional gates, media review, accessibility, responsiveness, references, and virality into one hidden claim.

## Verdict

- Verdict: `ship_but_media_needs_polish`
- UI/UX product quality: **57.8/100**
- Media proof score: **11.4/16**
- Functional gates: `passed`
- Performance layer: `not_run`
- Accessibility layer: `not_run`

## Dimension Scores

| Dimension | Score |
|---|---:|
| workflowClarity | 8.7 |
| firstThirtySecondMagic | 7.5 |
| visualHierarchyDensity | 7 |
| professionalRelevance | 7.2 |
| responsivenessInteraction | 0 |
| artifactLegibility | 6 |
| evidenceTraceClarity | 9 |
| accessibility | 0 |
| agentCollaborationState | 6 |
| shareabilityViralityLoop | 6.4 |

## Blockers

(none)

## References

- **Google Sheets**: Cell-level collaboration presence should show ownership without blocking nearby work. -> Presence claims and short agent intent chips sit on cells as advisory state; final writes still use CAS.
- **Figma**: Multiplayer cursors and object-level activity are visible but do not freeze the canvas. -> Agent planning and commit leases are presence rows, while proposal cards appear only for meaning conflicts.
- **Linear**: Triage collects work that must be accepted, assigned, or dismissed. -> Noteworthy inbox, proposal chips, trace rows, and job cards keep next actions explicit.
- **Notion**: Empty writing surfaces should invite capture without saving placeholder text. -> Notebook ghost text appears only in the empty first paragraph and never persists to Convex.
- **Attio / Clay**: Records need identity, source chips, and dense relationship context. -> Company rows use initials, source chips, status, and evidence-bearing fields.
- **Claude Artifacts / assistant-ui**: Chat and generated work product should be adjacent, with reviewable output state. -> Copilot, Work Surface, Trace, and proposal chips keep chat, artifact, and proof connected.
