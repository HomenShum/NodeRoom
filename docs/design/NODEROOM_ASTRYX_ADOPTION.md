# NodeRoom Astryx Adoption Notes

## Update (2026-07-03): design bundle + design-vs-product parity loop

The missing half of the Astryx pattern is now in place:

- **Design reference bundle** at `design-reference/` (gitignored): the full
  source of the Claude Design project — `assets/colors_and_type.css` (canonical
  tokens), `room/`, `fixes/`, `scale/`, `mobile-scale/`, `feature-map/`,
  `directions/`, `terra/`, plus the top-level specimen shells (`NodeRoom
  States & Scale.html` etc.). Exported through the Claude Design connector;
  re-export after design edits. This is what earlier parity sessions were
  missing when they reported "the downloaded HTML files are wrappers that
  reference missing folders".
- **Designed-version screenshots are now possible**: serve `design-reference/`
  with any static server and open a specimen shell — it renders the real
  design (React/Babel via CDN). Pair each specimen screenshot with the
  matching product route (`?mode=memory&demo=scale` for States & Scale) and
  diff visually or with the VLM rubric from docs/design/DESIGN_QA_LADDER.md.
  That closes the loop the Astryx Max skill demonstrates: manifest-grounded
  edits + headless-browser screenshot iteration against the actual design.
- **Agent grounding** (`astryx init` equivalent): CLAUDE.md now has a
  "Design System" section pointing every agent at `design:manifest`,
  `design:audit`, the token file, the specimen directories, and the visual-
  language rules before any UI edit.

Next deepening (queued): grow `design:audit` toward a slop detector by
deriving rules from `design-reference/assets/colors_and_type.css` — flag any
hex/radius/shadow/type-size not in the token set, spacing off the 4px grid,
and hover-apparatus violations — and add a `design:parity` command that
serves bundle + product and emits paired screenshots.

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
