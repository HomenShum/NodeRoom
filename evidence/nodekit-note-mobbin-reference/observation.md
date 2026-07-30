# Mobbin reference observation — NodeRoom note surface

Observed 2026-07-29 through the authenticated Mobbin connector. This packet
stores only canonical Mobbin screen links and human-readable observations. It
does not cache pixels, screenshots, OCR, embeddings, or training data, and it
is not a signed NodeProof receipt.

## Rapid note capture

- [Notion empty document editor](https://mobbin.com/screens/a7c67122-92ad-48b5-aae6-38c53b3edf8b)
  leads with one strong page title, keeps creation actions lightweight, and
  leaves the navigation hierarchy visible.
- [Notion populated document editor](https://mobbin.com/screens/6b0f5671-9acd-45c2-bb56-22261949ddbf)
  keeps the document body central while comments and verification metadata stay
  adjacent to, rather than inside, the writing stream.

NodeRoom application: quick capture stays above the notebook stream, uses one
textarea and one primary action, and does not force classification before the
thought is safe.

## Review and provenance disclosure

- [Slite document verification](https://mobbin.com/screens/96db9a69-2eb2-4bea-8b6b-762d1b5228d9)
  uses a compact disclosure anchored to the document. Owner, verification,
  staleness, and request actions appear only when inspected.
- [Fibery version history](https://mobbin.com/screens/714aa790-1b39-4ef7-ab48-9402ebeb7aea)
  separates the document from a narrow history rail with current version,
  actor, timestamp, and explicit restore action.
- [Linear document history](https://mobbin.com/screens/6c14e085-9ff5-4e61-9a21-b04f1b0a3433)
  makes history an inspection mode: changed text is highlighted and the
  version/actor rail remains distinct from normal editing.

NodeRoom application: the immutable reference chain is collapsed by default,
expands in a dedicated side card, and disarms capture during provenance review.
The review state cannot silently write or imply authority.

## Narrow-screen behavior

- [Notion mobile page editing](https://mobbin.com/screens/bbf8caf9-a3ed-42e3-aad9-0b1d489d6014)
  preserves a single-column title/body hierarchy and keeps editing utilities in
  one compact row near the active input.
- [Notion mobile inline capture](https://mobbin.com/screens/58478632-42e4-4545-b49e-fd9177431940)
  prioritizes the writing surface while secondary controls remain compact and
  reachable.

NodeRoom application: the 390 px and 320 px states keep quick capture first,
stack notebook blocks beneath it, expose review state through exact copy, and
avoid horizontal document overflow.

## Deliberate divergence

NodeRoom retains its dark operator workspace, artifact receipts, evidence
counts, and NodeAgent trace vocabulary. Mobbin references informed hierarchy
and disclosure behavior only; they are not visual templates or design
authority. Canonical NodeRoom rules and NodeKit records remain authoritative.
