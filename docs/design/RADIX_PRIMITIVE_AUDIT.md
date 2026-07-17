# Radix Primitive Audit

Captured: 2026-07-16

Layering and motion ownership are defined in
`docs/design/FRONTEND_LAYER_POLICY.md`. Radix remains the behavioral base;
visual recipes and motion systems may decorate a control but may not replace
its accessibility mechanics.

Scope: interactive controls under `src/ui`, `src/app`, and shared component
layers. The rule is behavioral equivalence first: keep data flow, callbacks,
keyboard contracts, proof selectors, and visual tokens while moving generic
overlay/focus/selection mechanics to shadcn-generated Radix primitives.

## Migrated

| Surface | Handwritten behavior removed | Shared primitive | Files |
|---|---|---|---|
| Chat model route picker | Absolute positioning, outside-click listener, Escape listener, custom listbox navigation, ancestor-clipped scrolling | `Popover`, `Command`, `CommandInput`, `CommandList`, `CommandItem`, `Button` | `src/ui/Chat.tsx`, `src/components/ui/popover.tsx`, `src/app/styles.css` |
| Chat work-context picker | Absolute positioning, custom search field/listbox, manual dismissal | `Popover`, `Command`, `CommandInput`, `CommandList`, `CommandItem` | `src/ui/Chat.tsx`, `src/app/styles.css` |
| Chat `@` typeahead | Absolute positioning and handwritten option elements | controlled `Popover` + `Command` anchored to the composer | `src/ui/Chat.tsx`, `src/app/styles.css` |
| Notifications and passive intelligence | Outside-click and Escape listeners, clipped scrolling, duplicated dialog semantics | `Popover` + `ScrollArea` | `src/ui/NotificationsInbox.tsx`, `src/ui/insights/PassiveAgentChip.tsx`, `src/ui/insights/NoteworthyInbox.tsx` |
| People panel | Handwritten dismissal and viewport scrolling | non-modal `Dialog` + `ScrollArea` | `src/ui/PeoplePanel.tsx`, `src/ui/people-panel.css` |
| Landing create/join dialogs | Scrim dismissal, focus trap, Escape handling, focus restoration | shared `FocusTrapDialog` backed by shadcn `Dialog` | `src/ui/Landing.tsx`, `src/ui/primitives/FocusTrapDialog.tsx` |
| Command palette | Backdrop, focus trap, listbox keyboard loop, selected-row scrolling | `CommandDialog`, `CommandInput`, `CommandList`, `CommandItem` | `src/ui/CommandPalette.tsx`, `src/components/ui/command.tsx` |
| Shared modal layer | Handwritten tab loop and focus restoration | shadcn `Dialog`; the design-system `Modal` adapts through `FocusTrapDialog` | `src/ui/primitives/FocusTrapDialog.tsx`, `src/ui/primitives/designSystem.tsx`, `src/components/ui/dialog.tsx` |
| Mobile overflow and action menus | Absolute menus, manual open state, outside/Escape dismissal | `DropdownMenu` | `src/ui/mobile/shell/MobileHeader.tsx`, `src/ui/mobile/MobileApp.tsx` |
| Mobile bottom sheets and nested readers | Scrims, ARIA mutation, tab loop, Escape handling, focus restoration | container-scoped shadcn `Dialog` adapter | `src/ui/mobile/MobileApp.tsx`, `src/components/ui/dialog.tsx`, `src/ui/mobile/mobile.css` |
| Mobile tooltip | Handwritten hover/focus bubble placement | `Tooltip` with bounded long-press adapter | `src/ui/mobile/MobileTooltip.tsx`, `src/ui/mobile/mobileFrame.css` |
| Cell history | Outside/Escape dismissal and clipped scrolling | `Popover` + `ScrollArea` | `src/ui/panels/Artifact.tsx`, `src/ui/panels/artifact-receipts.css` |
| Notebook patch overlay | Manual viewport coordinates and fixed positioning | collision-aware `Popover` | `src/ui/panels/Artifact.tsx`, `src/ui/panels/notebook-paper.css` |
| Evidence citation preview | Manual viewport placement and hover/focus dismissal | `HoverCard` | `src/ui/panels/Artifact.tsx`, `src/app/styles.css` |

The picker content now renders in a Radix portal, uses collision-aware top/end
placement, and sizes from `--radix-popover-content-available-width` and
`--radix-popover-content-available-height`. Existing model-routing callbacks and
legacy proof controls remain unchanged.

The context surfaces use the same portal and collision contract. Context search
still covers artifacts, deck slides, proposals, and traces; the `@` path retains
its leading `@nodeagent` and artifact-reference behavior. The former slash-menu
component was unreachable because its option list was permanently empty, so its
handwritten overlay state was retired. `/ask` and `/free` remain parser-level
compatibility aliases and are intentionally not advertised as a second command UI.

## Replace Next

No P1 or P2 generic primitive migrations remain in this audit. New generic
dialogs, menus, listboxes, popovers, hover previews, tooltips, and scrollable
overlay regions must start from the shared shadcn-generated Radix layer.

The listeners that remain in audited owners are product behavior rather than
overlay plumbing: global command/watch shortcuts, camera-follow cancellation,
spreadsheet drag and scroll measurement, and notebook editor measurement.

## Keep Specialized

These are not generic primitive replacements:

- `GuidedTour` uses measured anchored coaching geometry and is non-modal.
- `TraceLensPanel` is a persistent application region, not a dialog despite its
  current ARIA role; fix semantics with the trace-region migration.
- Spreadsheet cells, graph nodes, notebook blocks, and deck objects retain
  their domain interaction engines. Radix may wrap menus and dialogs around
  them but must not replace editing, drag, selection, or realtime logic.
- Compatibility-only hidden model controls stay until dependent proof scripts
  migrate to visible semantic selectors.

## Completion Gate

For each migration: focused behavior tests, Escape/focus restoration, keyboard
selection, outside interaction, narrow desktop and phone screenshots, zero
horizontal overflow, and unchanged store/Convex callbacks.

## Verification

Verified 2026-07-16:

- Focused primitive suite: 122 tests passed across 10 files.
- Repository floor: TypeScript app + Convex projects passed; 2,216 tests passed
  across 328 files.
- `design:audit`: passed. Its existing token-drift inventory remains advisory.
- `ui:layer-audit`: passed across 577 source files.
- Live local browser: 390x844 mobile sheet and 900x800 command palette both had
  zero horizontal overflow, correct focus containment/restoration, working
  Escape dismissal, and zero console errors.
