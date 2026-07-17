# NodeRoom Mobile Taste Audit

Captured: 2026-07-09

This audit judges whether each reference deserves reproduction. Similarity is
not quality. Scores are 0-10 and were assigned before implementation.

## Reference Scores

| Dimension | Current local mobile | Terracotta export | Regular app | At Scale | Gap Pack | Capture prototype |
|---|---:|---:|---:|---:|---:|---:|
| Visual hierarchy | 6.4 | 6.8 | 4.8 | 7.3 | 7.0 | 6.6 |
| Semantic clarity | 5.2 | 5.4 | 5.0 | 7.4 | 7.5 | 6.8 |
| Geometry consistency | 5.8 | 6.0 | 4.5 | 7.0 | 6.8 | 6.5 |
| Typography | 7.0 | 7.4 | 4.8 | 7.1 | 7.0 | 6.9 |
| Color discipline | 7.2 | 7.5 | 4.2 | 7.0 | 7.1 | 6.7 |
| Density | 6.0 | 6.4 | 4.5 | 7.8 | 7.3 | 6.8 |
| Calmness | 5.4 | 5.8 | 3.8 | 6.8 | 6.7 | 6.3 |
| Mobile-native fit | 4.8 | 5.2 | 4.1 | 7.5 | 7.0 | 6.9 |
| Navigation predictability | 4.2 | 4.8 | 4.4 | 6.8 | 6.6 | 6.2 |
| Accessibility | 5.5 | 5.2 | 4.0 | 6.8 | 7.4 | 6.5 |
| First-two-second impression | 6.5 | 7.0 | 4.2 | 7.2 | 6.8 | 6.7 |
| First-ten-second comprehension | 6.6 | 6.8 | 5.0 | 7.6 | 7.4 | 7.2 |
| Product identity | 6.8 | 6.6 | 5.2 | 7.5 | 7.0 | 6.5 |
| Scale resilience | 4.7 | 4.5 | 3.8 | 8.1 | 7.8 | 6.6 |

The public `noderoom.live` landing scores 7.6 for first-two-second identity and
7.3 for first-ten-second proof, but it did not expose the deployed `.na-app`
mobile workroom on the inspected route and therefore is not scored as a shell
reference.

## Decisions

| Decision | Classification | Rationale and approved replacement |
|---|---|---|
| Cream/terracotta light default | KEEP | Distinctive, legible, and already proven by screenshots/tests. Use semantic tokens, not cascade order. |
| Serif artifact titles | KEEP | Gives durable artifacts identity; keep it away from compact operational controls. |
| Artifact-card home | REFINE | Strong first-ten-second proof, but reduce nested borders/pills and protect 320px height. |
| Governed deck sheet | KEEP | Best demonstration of plan -> preview -> scoped request -> proposal -> receipt. Preserve honest live limitations. |
| Boxed gradient N mark | REJECT | Reads as a decorative logo button and duplicates Home. Use a flat 29px mark inside room context. |
| Outlined room-selector pill | REJECT | Consumes width and makes context look like a filter. Use one transparent 44px room-context control. |
| Filled overflow/action button | REJECT | Overstates a secondary command and makes terracotta mean navigation. Use a neutral ghost icon action. |
| Badge on overflow | REJECT | The number has no stable object. Attach amber count only to Review. |
| Dynamic top-right semantics | REJECT | A button cannot become Jobs, Notifications, or Review based on unrelated state. Split stable Review from stable Overflow. |
| Persistent pulse strip | REJECT | Costs 40-82px, repeats room state, and pushes work below the fold. Move People/Activity/Usage/Jobs into secondary commands. |
| Mixed 11/12/16px compact radii | REFINE | Use approximately 8px for controls, 12px for sheets/individual repeated items, pill only for real compact state. |
| Synthetic status bar on phones | REJECT | Competes with browser/OS chrome and reserves 56px. Restrict all synthetic device chrome to explicit preview mode. |
| Bottom navigation | KEEP | Predictable primary destinations; do not duplicate it in overflow or the FAB. |
| Contextual quick-action FAB | REFINE | Useful for work actions; remove its duplicate navigation tier and keep labels stable. |
| Heavy card/border/shadow usage | REFINE | Cards remain for repeated artifacts and modal/sheet tools; structural sections become flat with spacing/hairlines. |
| Decorative gradients/orbs | REJECT | They weaken the work-focused product; use flat surfaces. |
| Theme selector | KEEP | Light is canonical; dark is explicit and overrides the same semantic names. |
| Theme chosen by late CSS block | REJECT | Design correctness must be structural and audited. |
| Global `letter-spacing: 0 !important` | REJECT | Erases intentional mono/eyebrow/type treatment and makes CSS harder to reason about. |
| Accent/density/nav/tone/motion matrix as primary settings | REJECT | These are design-iteration controls, not core product settings. Retain under Advanced/Labs if still useful. |
| Auto-allow and notification policy | KEEP | Product governance, not visual tweaking; keep direct and honest about backend status. |
| One quiet live dot | KEEP | Communicates room health without a telemetry dashboard in the header. |

## Original Topbar Critique

The current local header is 134px tall at every target phone width: 56px is
reserved for a fake status area, 38px for controls, and the remainder for a
multi-segment pulse strip. The room pill is only 34px tall, below the approved
touch target. The only right-side action is labeled `Agent jobs` in markup but
changes to Jobs, Review, or a notification toast. At 320px the content still
fits, but the fit is achieved through small targets and excessive apparatus,
not resilient geometry.

## Approved Direction

Adopt the measurable contract in `MOBILE_HEADER_CONTRACT.md`: a flat 52px row
plus real safe area, one transparent room-context control, stable Review and
Overflow actions, no telemetry strip, no production status simulation, and
semantic light/dark tokens. This is intentionally better than the source
export rather than a pixel match.

