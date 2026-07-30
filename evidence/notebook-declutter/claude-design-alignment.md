# Claude Design alignment

## Source

- Read-only project:
  `https://claude.ai/design/p/b436f60e-fe7d-45fa-8e8d-00ea8f95977e?file=NodeRoom+-+Workspace.html`
- Inspected live through the signed-in Chrome tab on 2026-07-30.
- No project content, comments, settings, or files were changed.

## Canonical web journey

- Keep one stable room shell with three persistent regions: binder, active work
  surface, and room chat.
- Put trace, graph, and version controls directly under the active artifact
  tabs. They are contextual tools, not a second dashboard.
- Keep file rows height-stable. Secondary metadata may fade in, but hover must
  not move neighboring rows.
- Render accepted changes and source receipts as quiet inline events in the
  conversation instead of large permanent proof cards.
- Keep the status strip passive. Usage belongs behind the top-right room
  controls, not in the permanent footer.

## Canonical terracotta mobile journey

- Mobile is a separate single-column product journey, not a compressed desktop
  workspace.
- Use a compact room switcher, a persistent capture composer, and one clear
  action per item.
- Use richer two-column cards only for the small Recents set. Favorites and
  briefings are flat 58px rows with stable metadata and an explicit open action.
- Keep proof detail reachable from evidence items, while the resting feed shows
  only the source count and gap state.
- Canonical inspected tokens:
  - app background `#FBF4E7`
  - card background `#F3E8D8`
  - primary text `#2B1D14`
  - secondary text `#5C4938`
  - accent `#C56A3C`
  - card radius `16px`
  - row radius `13px`
  - UI font `DM Sans`
  - editorial display font `DM Serif Display`

## Notebook decision

The notebook workbench stays inside the canonical dark web room shell. It uses
the same journey rules as the design without importing the mobile palette:

- Capture remains the single dominant action.
- The default view is a flat note stream.
- Reference chain remains immediately reachable.
- Operator-only execution, patch, section, and source detail stays inside one
  collapsed `Notebook tools` disclosure.
- Desktop retains binder / work / chat.
- Compact web uses one content column; the dedicated mobile app remains the
  terracotta implementation.

## Gap closed in this slice

The permanent credit chip is removed from the bottom status strip. The same
honest enforced balance is exposed in the top-right room controls under Usage,
preserving reachability while matching the canonical workspace hierarchy.
