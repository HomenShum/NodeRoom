# Frontend Layer Policy

Captured: 2026-07-16

## NodeRoom Standard

```text
Convex Auth
  identity and production session enforcement

shadcn + Radix
  accessible interaction primitives

AI Elements
  agent interaction primitives

CSS
  ordinary state transitions

Reviewed visual recipes
  bounded public-page and empty-state treatments

Optional centralized motion engine
  only meaningful multi-step choreography

Convex + NodeAgent
  authoritative state, tools, jobs, policy, and proof
```

Radix owns control behavior. Product code composes those controls through
shadcn-generated wrappers. Visual and motion layers may change appearance and
timing but may not reimplement focus, keyboard, dismissal, selection, or ARIA
behavior.

## Adaptations From The Proposal

- NodeRoom uses Convex Auth today. WorkOS is not installed and is not an
  assumed dependency. A future identity-provider change must preserve the same
  fail-closed production boundary.
- The `motion` package is installed and currently owned by the AI Elements
  thinking-state shimmer. Keep CSS as the default elsewhere and do not add GSAP
  until a real sequence requires a timeline.
- React Bits, GSAP, Lenis, Vanta, and Three.js are not installed for this work.
  They remain approved categories with explicit boundaries, not default
  dependencies.
- The authenticated NodeRoom workspace, spreadsheet grid, notebook editor,
  graph inspectors, chat, and trace surfaces retain native scrolling. Lenis is
  limited to future public storytelling routes.
- Vanta is not approved for the application shell. Any future experiment must
  be lazy, isolated, reduced-motion aware, pointer inert, and backed by a static
  fallback.

## Import Ownership

| Dependency | Allowed owner |
|---|---|
| `radix-ui`, `@radix-ui/*` | `src/components/ui/**`; recorded AI Elements controllable-state exceptions only |
| AI Elements | `src/components/ai-elements/**`, consumed by product compositions |
| React Bits recipes | `src/components/effects/react-bits/**` |
| `motion` / future GSAP | `src/motion/**`; AI Elements and reviewed React Bits source may use `motion` |
| Lenis | route-scoped provider under `src/motion/**` |
| Vanta and Three.js | lazy wrapper under `src/components/backgrounds/vanta/**` |

Vendor UI and motion files may not import Convex, NodeAgent, or the Room store.
They receive consequential state and callbacks through props.

## Motion Ladder

1. No animation for deterministic capture or when motion adds no meaning.
2. CSS for hover, focus, open/close, opacity, and simple transforms.
3. A reviewed visual recipe for one bounded decorative treatment.
4. A centralized timeline engine for causal multi-element sequences.
5. Route-scoped smooth scrolling for public editorial pages only.
6. An isolated WebGL background only after performance and accessibility proof.

Do not stack multiple owners on the same transform or scroll behavior.

## Enforcement

- `npm run ui:primitive-audit` checks Radix ownership.
- `npm run ui:motion-audit` checks motion/effect ownership.
- `npm run ui:layer-audit` checks both plus the business-logic boundary.
- `npm run design:audit` includes the complete layer audit.

The raw-control migration remains tracked in
`docs/design/RADIX_PRIMITIVE_AUDIT.md`; the import gate does not pretend that
the region-by-region migration is already complete.
