# NodeRoom Mobile Reference Inventory

Captured: 2026-07-09

## Authority

- Behavioral authority: current production/main implementation.
- Approved visual authority: `MOBILE_TASTE_AUDIT.md` and
  `MOBILE_HEADER_CONTRACT.md`.
- Reference-only evidence: standalone exports, Cloud Design captures, legacy
  prototypes, and prior screenshots.

The catalog/index is not treated as an implementation. The actual frozen
standalone exports were located and inspected. The smaller files under
`project/mobile/` are dependency-loading source entrypoints, not frozen
standalones.

## Located Frozen Standalone Exports

Source root:
`C:/Users/hshum/Downloads/NodeAgent-handoff_07062026/nodeagent/project/exports`

| Surface | Entry file | Bytes | SHA-256 | Use |
|---|---|---:|---|---|
| Terracotta app | `NodeRoom Mobile - App (Terracotta, standalone).html` | 1,851,265 | `03267F8C43E09097C17CAB71848E95782A06FB4ADF83146CE2321DBC68A65EB3` | Primary frozen visual and interaction reference. |
| Regular mobile app | `NodeRoom Mobile - App (standalone).html` | 1,849,792 | `2DE151AF67B8AB6CB86B216469DE3492AD8C2B7DAE246229559AB8335B12C76D` | Frozen dark predecessor comparison. |

## Located Source Entrypoints

Source root:
`C:/Users/hshum/Downloads/NodeAgent-handoff_07062026/nodeagent/project/mobile`

| Surface | Entry file | Bytes | SHA-256 | Use |
|---|---|---:|---|---|
| Terracotta source entry | `app-terracotta/app-terracotta.html` | 4,532 | `44C2E628F62F9B34B9B2017DFEDFA1BC40C8F7541AE34D5991D9C9A4718C8B23` | Loads component sources and injects a cross-document preview pill; not a production chrome target. |
| Regular source entry | `app/app.html` | 2,867 | `BC26AFCAB76E28959CFE2F26D6C85DC4FD9B64375EF922EDBD79E83A82B0DB65` | Loads the dark predecessor sources. |
| At Scale | `at-scale/at-scale.html` | 2,631 | `36014789861BA277FF47E0A9B6323F14E87D9F18DC6B366D13B172058FD3D10B` | Long-title, large-count, many-row, and touch-grammar stress reference. |
| Gap Pack | `gap-pack/gap-pack.html` | 2,875 | `21A8675CABF3FD58F886DC09503DD8E2C262C80F4607C95660AF39B67ADAFA8D` | Review, trace, people, share, settings, offline, and first-join coverage. |
| Capture prototype | `capture-prototype/capture-prototype.html` | 73,040 | `48E16B56A34BCAA2F4040028AE47CEF22B77763B7CE7B6436B37574C7DEA9C83` | Note capture and extraction behavior reference. |

Supporting source modules under the same root were also inspected, including
`app-terracotta/a-app.jsx`, `a.css`, `ios-frame.jsx`, `na-deck.jsx`, and the
Gap Pack/At Scale JSX and CSS files.

`project/NodeRoom - Index.html` is the catalog that links these entries and
exports. Its black cross-document preview pill is catalog chrome and is
explicitly rejected for the product shell.

## Repository Captures

- Broad source captures:
  `docs/design/ui-contract/20260707-design-source/`
- 2026-07-08 migration evidence:
  `docs/design/ui-contract/20260708-migration-proof/`
- Terracotta work-artifact parity evidence:
  `docs/design/ui-contract/20260709-mobile-terracotta-proof/`
- This migration baseline:
  `docs/design/mobile/artifacts/before/`

The 2026-07-09 source captures prove that cream `#FBF4E7` and terracotta
`#C56A3C` are intentional reference values. They do not approve the synthetic
status bar, boxed room pill, filled overflow control, or ambiguous count badge.

## Production Check

`https://noderoom.live/` was inspected in a clean 390x844 mobile browser
context on 2026-07-09. The deployed root rendered the public NodeRoom landing
with the NodeRoom identity, a primary create-room action, and a product proof
preview. The first inspection did not expose `.na-app` on the direct memory
route.

A fresh 2026-07-10 deployment recheck found a newer but still incomplete
state. Direct `#mobile` renders the live join form, and a phone-sized
`?demo=review&name=FirstTimeQA` intent normalizes to `#mobile` and renders the
review-every-edit consent dialog before any room mutation. Direct
`#mobile?mode=memory` now mounts the light terracotta `.na-app`, stable header,
zero horizontal overflow, and no synthetic status chrome. However, the
deployed build still has the obsolete duplicate `.na-fab-badge`, starts on the
Capture surface, and has no `mobile-bottom-nav`. The public landing's primary
Create link also contains `surface=desktop`. Production parity therefore still
cannot be claimed.

## Missing Or Limited Evidence

- Production serves an older partial mobile shell, not the locally proven
  final contract.
- No authenticated live-room production mutation was performed during the
  design inventory.
- The standalone files use synthetic iOS chrome by design; that chrome is
  preview evidence only, not a production requirement.
- Some source screenshots are catalog pages containing embedded phone mockups,
  so geometry scores are based on the actual linked exports where available.
