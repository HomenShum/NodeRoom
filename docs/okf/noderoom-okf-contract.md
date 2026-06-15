# NodeRoom OKF Contract

## Concept Types

NodeRoom accepts unknown OKF `type` values, but its native taxonomy is:

- `Room`
- `Company`
- `Source`
- `Spreadsheet`
- `Spreadsheet Cell`
- `Metric`
- `Formula`
- `Chart`
- `Coach Cue`
- `Review Round`
- `Agent Trace`
- `Eval Result`
- `Downstream Draft`
- `Workflow`
- `Playbook`

## Frontmatter

Every concept requires:

```yaml
type: Spreadsheet Cell
```

Recommended fields:

```yaml
title: CardioNova runway estimate
description: Runway estimate generated from cash and burn assumptions.
resource: noderoom://rooms/demo/artifacts/company-research/elements/rc_cardionova__runway
tags: [runway, finance, needs-review]
timestamp: 2026-06-15T00:00:00Z
visibility: public
noderoom:
  roomId: demo
  artifactId: company-research
  elementId: rc_cardionova__runway
  status: needs_review
  confidence: 0.62
  sourceKind: computed
```

## Retrieval Policy

1. Search OKF concepts by meaning and exact text.
2. Filter by metadata.
3. Follow links/backlinks.
4. Open literal source evidence.
5. Search spreadsheet context.
6. Re-read current cell values and versions before writes.
7. Mark weak evidence as `needs_review`.

## Tool Surface

NodeAgent now exposes:

- `okf_list_concepts`
- `okf_read_concept`
- `okf_full_text_search`
- `okf_semantic_search`
- `okf_filter`
- `okf_glob`
- `okf_regex`
- `okf_backlinks`
- `okf_expand_neighbors`
- `source_resolve_citation`
- `source_open_literal`
- `source_compare_claim`

Rooms without an OKF adapter return `okf_retrieval_unavailable`; OKF-aware runs provide `RoomTools.okf`.

