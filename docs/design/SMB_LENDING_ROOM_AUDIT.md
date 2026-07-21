# SMB Lending Deployment Room design audit

## Product boundary

The route `#smb-lending` reuses the production NodeRoom shell. It does not create a second lending application shell. The room is a synthetic clean-room deployment proof inspired by the public Casca FDE role, with no affiliation claim and no proprietary Casca or JPMorgan data.

## Three-question gate

1. **What is happening?** The public agent message, artifact tabs, and trace state show that the application was inspected, metrics were calculated, a blocker was found, and a proposal is awaiting review.
2. **Why trust it?** Source locators remain in the workbook, the graph is labeled as a projection, the proposal exposes its base version, and the receipt states that no credit decision was made.
3. **What can I do next?** Review the document-request proposal. No canonical change is represented as complete before that decision.

## Reuse decisions

- Reuse `RoomShell`, artifact tabs, sheets, notebook rendering, chat, sessions, and trace.
- Reuse the existing proposal/CAS and proof vocabulary rather than inventing lending-specific state machines.
- Keep domain-only calculations, fixtures, blockers, and authority rules in `packs/smb-lending-deployment` and `src/domains/smbLending`.
- Defer bespoke graph visualization until the deterministic room journey and review transition are proven in the existing Graph surface.

## Required proof before baseline promotion

- TypeScript and Convex TypeScript pass.
- Domain tests and repository floor pass.
- Desktop, tablet, and mobile captures show no clipping or horizontal overflow.
- Pending proposal and no-credit-decision language remain visible.
- The restaurant fixture works end to end; the medical-practice fixture remains held out.

## 2026-07-21 rendered findings

- P1 fixed: the first-run walkthrough reopened the fixed-position binder in the 981-1199px tablet band, obscuring the work surface. `RoomShell` now preserves the mid-size overlay contract and leaves the binder behind its explicit Room toggle.
- P1 fixed: the agent message requested six months of statements while the canonical fixture required the three most recent operating-bank statements. Visible copy now follows the fixture.
- The native Review Center showed the proposal, rationale, base version, source affordance, Approve, and Reject. Browser approval removed the pending workpaper, wrote an approval trace, and changed the checklist cell from `missing` to `requested` through the final CAS path.
- Desktop, tablet, and mobile captures have UTF-8, zero detected mojibake, zero console errors, and no document-level horizontal overflow. Hashes are bound in the UI contract manifest and QA receipt.
