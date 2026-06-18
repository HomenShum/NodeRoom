# Notebook UI Inspiration and Motion

## Decision

Use inspirational references and React Bits-style motion as an experience layer, not as the editor architecture.

## Stack Boundary

- Editor substrate: Tiptap / ProseMirror
- Collaboration: Convex ProseMirror Sync
- Intelligence: NodeRoom read model and agent workflows
- Motion/delight: React Bits-style components and custom lightweight animations

## React Bits Usage

Good uses:

- passive chip entrance
- inbox card reveal
- empty-state polish
- action confirmations
- subtle loading shimmer
- background depth

Avoid using it for:

- editor mechanics
- cursor behavior
- persistence
- CRDT/conflict resolution
- collaboration semantics
- agent memory

## Reference Mapping

### Notion

Blank canvas, low-friction writing, blocks that can become structured artifacts.

### Granola

Capture now, structure later; AI waits until the user pauses.

### Linear

Triage, action states, accept/dismiss/route patterns.

### Coda / Airtable

Notes becoming structured table rows and operational records.

### Perplexity / Elicit

Evidence-backed findings, citations, freshness, and source cards.

### Apple Notes / Craft

Calm typography, speed, minimal chrome, and focused reading.

## First-Time Flow

```text
join room
open Capture Notebook
type messy notes
pause
passive chip appears
open inbox
Research / Add to sheet / Dismiss
```

## Principle

Motion should explain state and build trust. It should not distract from banker-readable work.
