# NodeRoom Astryx Adoption Notes

Astryx is useful to NodeRoom as a workflow model: a design system should be
discoverable through a small CLI surface, not through a giant prompt dump. The
repo now has the same local pattern:

```bash
npm run design:manifest
npm run design:audit
```

`design:manifest` gives agents the local component roles, token rules, and
high-risk UI invariants before they edit. `design:audit` turns the worst recent
regressions into a gate: stretched grid rows, mid-word wrapping, green selection
rings, missing receipt chips, undismissable walkthrough chrome, and clipped
phone top-bar controls.

## What We Adopted

- Guidance over enforcement: the manifest explains how to compose NodeRoom UI,
  while the audit only blocks high-confidence regressions.
- CLI over MCP for design-system lookup: the command returns only the needed
  manifest/audit result, so it does not fill an agent context window with every
  component and example.
- Manifest first: agents can ask the repo what design primitives exist instead
  of guessing class names or inventing one-off chrome.
- Browser proof loop: visual changes still require rendered DOM checks; the
  manifest is a starting point, not a substitute for proof.

## What We Did Not Adopt

- No Astryx runtime dependency was added. NodeRoom already has a mature custom
  shell, grid, chat, trace, and mobile vocabulary; swapping in a beta component
  library would create churn without fixing the current parity risks.
- No StyleX migration. NodeRoom's current token CSS is already plain-CSS and
  product-specific.

## When To Reconsider Runtime Adoption

Use Astryx components only if a future surface is generic enough to benefit from
them directly, such as standalone settings pages, empty states, simple forms, or
documentation pages. Do not use it for the live diligence grid, receipts, locks,
or trace surfaces unless the component can preserve NodeRoom's provenance-first
interaction model.
