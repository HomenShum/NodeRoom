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

## Update (2026-07-03, later): slop detector + design:parity shipped

The "next deepening" queued above is now implemented.

### Token-drift slop detector (inside `npm run design:audit`)

`design:audit` still runs the hard regression gate first (unchanged pass/fail
semantics), then prints a **warning-only** token-drift section:

- **token-hex-drift** — literal hex colors (3/6/8-digit, case-insensitive,
  `#abc` normalized to `#aabbcc`) used outside variable definitions that are
  not in the allowed set. The allowed set = every hex in
  `design-reference/assets/colors_and_type.css` plus every custom-property hex
  declared in the `:root` / `[data-theme]` blocks of `src/app/styles.css`.
- **type-scale-drift** — `font-size` / `fontSize` px values off the canonical
  type scale (11/12/13/14/15/17/20/26/31/40px, exact match only).
- **radius-scale-drift** — `border-radius` / `borderRadius` px values off the
  radius scale (4/6/8/10/12/16/9999px; `0` and `50%` are ignored).

Scanned surfaces: `src/app/styles.css` + every `src/ui/**/*.tsx` (both CSS
syntax and TSX inline-style forms, including bare numbers like `fontSize: 9`).
Findings print as `WARN <code> file:line - message`, capped at 40 lines; the
full list is in `npm run design:audit -- --json` under the `drift` key.
Guidance over enforcement: drift never fails the audit — only the existing
hard-gate rules set a non-zero exit. If `design-reference/` is missing
(it is gitignored), the detector says so via a `token-canonical-missing`
warning instead of silently shrinking the allowed set.

Library entry points (pure, unit-tested in `tests/designSystemManifest.test.ts`):
`auditDesignTokenDrift`, `buildAllowedHexSet`, `designTypeScalePx`,
`designRadiusScalePx` in `src/design/designSystem.ts`.

### design:parity — paired specimen/product screenshots

```bash
npm run build          # precondition: design:parity never builds
npm run design:parity  # or: npm run design:parity -- --help
```

What it does:

1. Serves `design-reference/` on a free port with a plain node http server
   (no new deps; URL-decoded paths, traversal-guarded).
2. Starts `vite preview` over the existing `dist/` (if `dist/` is missing it
   prints the exact commands and exits 1 — it does not build for you; a stale
   `dist/` yields stale product screenshots).
3. Screenshots each `[design specimen, product route]` pair at 1512x812 and
   375x812 with Playwright and saves them to `.proofloop/parity-screenshots/`
   as `design-<id>-<WxH>.png` / `product-<id>-<WxH>.png`, then prints paths.

The pair list is a data structure (`PARITY_PAIRS` in
`scripts/design-parity.ts`); today it holds the States & Scale pair
(`/NodeRoom%20States%20%26%20Scale.html` vs
`/?mode=memory&demo=scale&name=Host`) — add new specimens as one entry each.
Diff the pairs visually or with the VLM rubric from
docs/design/DESIGN_QA_LADDER.md.
