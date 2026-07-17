# Radix primitive migration — before/after live capture

Captured: 2026-07-17

| | ref |
| --- | --- |
| **before** | `origin/main` @ `786eef64` |
| **after** | `feat/radix-primitives` @ `db34032c` (= `origin/main` + the migration) |

Both trees were built with `vite build` and served with `vite preview`
(`before` :5291, `after` :5292), then driven with Playwright against the built
preview per `docs/qa/BROWSER_VERIFY.md`. Browser-pane screenshots were NOT used —
preview tabs run with `document.visibilityState === "hidden"`, which pauses capture.

## Screenshots

| surface | before | after |
| --- | --- | --- |
| landing, 1280x860 | `before-01-landing-desktop.png` | `after-01-landing-desktop.png` |
| demo room, 1280x860 | `before-02-room-desktop.png` | `after-02-room-desktop.png` |
| command palette | `before-03-command-palette.png` | `after-03-command-palette.png` |
| landing, 390x844 | `before-04-mobile-390x844.png` | `after-04-mobile-390x844.png` |
| demo room, 390x844 | `before-05-mobile-room.png` | `after-05-mobile-room.png` |

`before-02` and `after-02` are byte-identical in size (167,469) — the room surface
is visually unchanged.

## What actually differs

A primitive migration is behavioural, not visual, so near-identical images are the
intended outcome. The only visible delta is in the command palette:

- Row height is slightly tighter (~36.6px vs ~39.4px) from shadcn's `CommandItem`
  padding, so one additional row ("Open Today's Brief") fits inside the same
  height-capped list. Same commands on both sides — `Today's Brief` is a demo-room
  fixture present in both trees, not new content.

## Behavioural probe (Playwright, both trees)

| check | before | after |
| --- | --- | --- |
| palette opens on Ctrl+K | yes | yes |
| focus starts inside dialog | yes | yes |
| focus stays inside after 12 Tabs | yes | yes |
| Escape dismisses | yes | yes |
| focus restored to trigger | yes | yes |
| outside click dismisses | yes | yes |
| horizontal overflow @1280x860 | 0px | 0px |
| horizontal overflow @390x844 | 0px | 0px |
| console errors | none | none |

**The palette was already correct before this migration.** Focus trapping, Escape
handling, outside dismissal and focus restoration all worked on `origin/main`. This
change does not fix them; it moves them onto a shared primitive so every surface
inherits one implementation instead of re-deriving it.

## Structural delta

- **before**: dialog renders inline inside `#root`; `aria-modal="true"`; custom
  `.r-cmdk-backdrop`.
- **after**: dialog is portaled to `document.body` (`#radix-_r_2_`) with Radix focus
  guards; `data-state="open"`; no `aria-modal`.

## Open a11y question (NOT fixed by this change)

Neither implementation marks `#root` `aria-hidden` while the modal is open, so
background content stays in the accessibility tree on both sides. `before` carried
`aria-modal="true"`; `after` does not (Radix drops it deliberately in favour of
`hideOthers`, but `hideOthers` is not marking `#root` here).

The aria snapshot shrinks 185 -> 49 lines on `after` vs 185 -> 202 on `before`, but
that is most plausibly Radix's scroll-lock unmounting virtualized binder rows — it is
**not** evidence of aria-hiding and is not claimed as an a11y win. Worth one focused
follow-up.
