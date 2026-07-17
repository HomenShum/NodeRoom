# Design Quality Scorecard

Generated: 2026-07-12T13:40:48.385Z
Run: `20260712T134005Z`
Commit: `5f67d8e1+dirty`
Scenario: `live_room_collab`

> Product correctness remains pass/fail. This scorecard does not turn functional gates, media review, accessibility, responsiveness, references, and virality into one hidden claim.

## Verdict

- Verdict: `needs_functional_gate`
- UI/UX product quality: **71.2/100**
- Media proof score: **11.1/16**
- Functional gates: `not_run`
- Performance layer: `passed`
- Accessibility layer: `passed`

## Dimension Scores

| Dimension | Score |
|---|---:|
| workflowClarity | 8.7 |
| firstThirtySecondMagic | 7.5 |
| visualHierarchyDensity | 6.8 |
| professionalRelevance | 6.9 |
| responsivenessInteraction | 12 |
| artifactLegibility | 6.5 |
| evidenceTraceClarity | 8.4 |
| accessibility | 8 |
| agentCollaborationState | 0 |
| shareabilityViralityLoop | 6.4 |

## Blockers

- functional gate not run in this design-quality pass

## References

- **Google Sheets**: Cell-level collaboration presence should show ownership without blocking nearby work. -> Presence claims and short agent intent chips sit on cells as advisory state; final writes still use CAS.
- **Figma**: Multiplayer cursors and object-level activity are visible but do not freeze the canvas. -> Agent planning and commit leases are presence rows, while proposal cards appear only for meaning conflicts.
- **Linear**: Triage collects work that must be accepted, assigned, or dismissed. -> Noteworthy inbox, proposal chips, trace rows, and job cards keep next actions explicit.
- **Notion**: Empty writing surfaces should invite capture without saving placeholder text. -> Notebook ghost text appears only in the empty first paragraph and never persists to Convex.
- **Attio / Clay**: Records need identity, source chips, and dense relationship context. -> Company rows use initials, source chips, status, and evidence-bearing fields.
- **Claude Artifacts / assistant-ui**: Chat and generated work product should be adjacent, with reviewable output state. -> Copilot, Work Surface, Trace, and proposal chips keep chat, artifact, and proof connected.
