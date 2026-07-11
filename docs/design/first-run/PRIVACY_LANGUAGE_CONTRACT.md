# NodeRoom First-Run Privacy Language Contract

Captured: 2026-07-10

Use only claims supported by the current access model.

| Concept | Approved language | Rejected language |
|---|---|---|
| Room access | `Anyone allowed by this deployment who has the room code or invite link can join as a member and edit shared content.` | `Private room`, `read-only guest`, or email allow-list claims without that enforcement. |
| Discoverability | `Room routes are unlisted from search engines.` | `noindex keeps the room private.` |
| Invite link | `Treat the invite link like an access code.` | `Only invited email addresses can enter.` |
| Public chat | `Everyone in this room can read this message.` | `Public on the internet.` |
| Private lane | `Only you can read this lane in NodeRoom. Requests and allowed room context are sent to the configured model provider.` | `End-to-end encrypted` or claims that no third-party model provider receives the request. |
| Review policy | `NodeAgent proposes edits for a host to approve.` | `NodeAgent cannot change anything` when auto-allow can be enabled. |
| Auto-approve | `NodeAgent may commit conflict-free edits; every write remains traced.` | `Fully autonomous` or `always safe`. |
| Sample room | `Synthetic sample data. Do not treat it as live company research.` | Any unlabeled fixture presented as real output. |
| Session | `This browser stores a room-scoped session so reload can restore your place.` | `Account-backed` when the user joined anonymously. |

SEO directives are never rendered as security proof points. UI copy must keep
discoverability, room membership, artifact visibility, and message audience as
separate concepts.
