# Semantic Entity Graph Research

Date: 2026-07-08

## Goal

The entity graph must work as a semantic relationship explorer, not a decorative mind map. It should answer concrete room questions:

- Who researched this company or person?
- Which spreadsheet rows, notebook blocks, trace steps, proposals, and evidence support this claim?
- Which people connect to which companies, projects, achievements, sources, funding events, and agent actions?
- What should the user inspect next?

The production behavior source remains the existing room artifacts, traces, sessions, proposals, members, and evidence payloads. The graph must not introduce backend tables, Convex schema changes, auth changes, persistence changes, or static mock replacements.

## Renderer Decision

React Flow remains the production renderer for this pass.

Reasons:

- It is already in the application through `@xyflow/react`, so there is no new dependency or data-contract risk.
- It supports custom React nodes, edge labels, drag, pan, zoom, minimap, keyboard focus, and a side detail panel without fighting the existing UI system.
- The product needs evidence-aware interaction and room actions more than raw graph scale in this milestone.
- The pasted contract asks for a renderer spike only if cheap; the safer path is to separate semantic graph derivation from rendering so another renderer can be tested later without changing the data model.

Rejected or deferred renderers:

- Cytoscape.js: strong graph algorithms, compound nodes, and mature layouts, but a larger interaction rewrite for this React surface. Keep as the first candidate if clustered graph layout becomes the bottleneck.
- Sigma.js plus Graphology: strong WebGL path for thousands of nodes and graph algorithms, but less natural for rich React node/detail UI. Keep as a scale renderer candidate after the semantic contract is stable.
- Neo4j NVL: visually relevant for Neo4j-style entity networks, but npm metadata for `@neo4j-nvl/react@1.2.0` and `@neo4j-nvl/base@1.2.0` reports `SEE LICENSE IN 'LICENSE.txt'`. Do not add it until legal/license terms are reviewed.
- Neovis.js: Apache-2.0 and useful as Neo4j-backed inspiration, but this app does not use a Neo4j backend for room state. It should not drive this implementation.

## UI Principles

- The selected node becomes the story center. First-degree and second-degree connections stay readable; unrelated nodes dim.
- Every visible edge should describe a relationship with a verb such as `researched`, `cited`, `supported by`, `authored`, `updated`, `proposed`, `approved`, `blocked`, or `mentioned in`.
- Evidence-backed data should be visually distinct from manual, inferred, failed, and needs-review data.
- Dragging is local view state only. It must not persist to the backend or mutate artifact state.
- Search and filters should change visibility without destroying selection state.
- The detail panel is part of the graph, not a separate report. It should surface connected companies, people, evidence, sources, rows, notebook blocks, trace steps, proposals, and next actions.
- Escape closes the active detail/edge focus.
- Reduced-motion users should get the same information without animated emphasis.

## Data Contract

The renderer consumes a pure semantic graph view model:

- Nodes: person, company, artifact, spreadsheet row, notebook block, source, evidence fact, project, achievement, funding, event, trace step, proposal, open question, agent job.
- Edges: researched, authored, updated, mentioned in, cited, supported by, derived from, proposed, approved, rejected, blocked, reviewed, triggered, belongs to.
- Status: source-backed, manual, graph-inferred, needs-review, rejected, running, failed.
- References: artifact id, element id, row id, column id, trace id, proposal id, source url, evidence id.
- Clusters: person-centered clusters, company-centered clusters, evidence/source clusters, artifact/work-product clusters, and agent/runtime clusters.
- Stats: total nodes, total edges, backed facts, open questions, people, companies, traces, proposals, source count, and visible counts after filters.

## Performance Constraints

- Cap the initial render to the most relevant graph slice and keep a full view model for filtering and search.
- Keep derivation pure and deterministic so it can be unit tested and memoized.
- Avoid O(n^2) text matching over every cell when simple column heuristics and known references are available.
- Cap row-derived and evidence-derived nodes per artifact in the first pass.
- Use `onlyRenderVisibleElements`, React memoization, stable node types, and bounded detail lists.
- Preserve smooth pan, zoom, drag, fit-view, and minimap behavior for a 250-node browser fixture.

## Proof Plan

- Unit tests for graph derivation, selectors, filters, layout determinism, cluster formation, and no-mock behavior when real room data exists.
- Component/browser proof for graph tab load, search, filter, node click, Escape close, drag, minimap/control visibility, and a 250-node fixture.
- Screenshots for the semantic graph default, selected person/company/fact/trace states, and edge detail.
- Gemini visual judge loop only after deterministic tests pass, using the Cloud standalone as visual context and this contract as the semantic rubric.

## References

- React Flow performance guide: https://reactflow.dev/learn/advanced-use/performance
- React Flow layouting guide: https://reactflow.dev/learn/layouting/layouting
- Cytoscape.js documentation: https://js.cytoscape.org/
- Sigma.js documentation: https://www.sigmajs.org/
- Neo4j NVL documentation: https://neo4j.com/docs/api/nvl/current/
- Neovis.js repository: https://github.com/neo4j-contrib/neovis.js
- Miro mind map help: https://help.miro.com/hc/en-us/articles/360017730753-Mind-map
