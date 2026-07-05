# Always-On Rooms — Digest Bootstrap Runbook

The bootstrap lane sends the first real digests **through Gmail drafts under
human review**, before any email provider is wired up. It is deterministic
end to end: zero model calls, zero network calls from the scripts. The agent
may write copy and create draft files; a human owns every recipient decision
and every send.

## Flow

```
room daily brief (.md)                      ┌────────────────────────────┐
        │                                   │  human-only territory      │
        ▼                                   │                            │
enqueue-digest.mjs ──► outbox.jsonl ──► create-gmail-drafts.mjs           │
  (one row per active     (append-only     (.eml files, ≤20/day)         │
   subscriber, idempotent)  journal)             │                        │
                                                 ▼                        │
                                     import .eml into Gmail drafts        │
                                                 │                        │
                                        human reviews each draft ◄────────┘
                                                 │
                        preview-outbox.mjs --approve <key>      (draft_created → approved)
                                                 │
                             human sends the draft from Gmail
                                                 │
                        preview-outbox.mjs --mark-sent <key> <gmail_msg_ref>
                                                 │
                                                 ▼
                                    outbox.jsonl is the receipt
```

State machine (mirrored from `convex/alwaysOnCore.ts` in
`scripts/digest/outbox-shared.mjs`; drift-tested in `tests/digestRunner.test.ts`):

```
pending_draft → draft_created → [HUMAN REVIEW GATE] → approved → sent
      │
      └──► skipped (terminal — inactive subscriber / invalid email, reason recorded)

failed ──► pending_draft   (the retry transition: 1 retry, then capped)
```

`failed` is **not a transition target** in the state machine: per the core
contract, a failure is *recorded* on an in-flight row by whoever observed it
(the drafting script's error path, or a human via
`preview-outbox.mjs --mark-failed`). Terminal rows (`sent`, `skipped`) and
already-failed rows refuse failure records — a receipt can never be un-sent.
The only transition touching `failed` is the retry exit back to
`pending_draft`.

`approved` is the **only** state that may send, and only a human command can
produce it. Idempotency key = `room:brief:subscriber:cadence` — a crash never
double-sends; re-running any step converges.

## Commands

```bash
# 1. Enqueue one outbox row per ACTIVE subscriber (idempotent; re-runs are no-ops)
node scripts/digest/enqueue-digest.mjs \
  --room expositio-pulse \
  --brief data/digest/briefs/2026-07-04.md \
  --subscribers data/digest/subscribers.json \
  --brief-key b0704 --room-title "Expositio Pulse"

# 2. Render RFC-822 .eml drafts for pending rows (default 10, hard max 20/day)
node scripts/digest/create-gmail-drafts.mjs --limit 10

# 3. Inspect the outbox (counts by state + bounded table)
node scripts/digest/preview-outbox.mjs

# 4. Record human decisions (approve/sent/retry validated against the
#    transition table; mark-failed validated against the in-flight guard;
#    invalid ones exit 1 with the reason)
node scripts/digest/preview-outbox.mjs --approve   exp:b0704:s017:daily
node scripts/digest/preview-outbox.mjs --mark-sent exp:b0704:s017:daily "gmail_msg 18c4f2"
node scripts/digest/preview-outbox.mjs --mark-failed exp:b0704:s019:daily "gmail import rejected"
node scripts/digest/preview-outbox.mjs --retry     exp:b0704:s019:daily
```

Default paths: outbox journal `data/digest/outbox.jsonl`, drafts
`data/digest/drafts/` — both gitignored (`data/digest/` in `.gitignore`).
Override with `--outbox` / `--drafts-dir`.

Subscribers file shape (bootstrap-local; production reads Convex):

```json
[
  { "id": "s003", "email": "researcher@stanford.edu", "status": "active" },
  { "id": "s024", "email": "pending-user@ens.fr",     "status": "pending" }
]
```

## Policy (non-negotiable)

- **≤ 20 drafts per UTC day.** `--limit` above 20 is refused outright; a run
  that would push today's total past 20 is refused with the remaining budget.
  Never silently clamped.
- **Double opt-in.** Only subscribers with `status: "active"` (i.e. they
  confirmed via the Convex `confirmSubscription` flow) get a row in
  `pending_draft`. `pending` / `unsubscribed` subscribers are recorded as
  `skipped` rows with the reason — never silently dropped, never emailed.
- **One-click unsubscribe.** Every draft carries a `List-Unsubscribe` header
  and visible View room / Manage subscription / Unsubscribe footer links.
  Bootstrap uses placeholder links keyed by subscription id; the production
  lane substitutes Convex-minted tokenized links. Token hashes never appear
  in the outbox, the drafts, or any public function result.

## What the agent may do vs never

| Agent MAY (bootstrap)                          | Agent may NEVER                               |
| ---------------------------------------------- | --------------------------------------------- |
| Render the daily brief into email copy          | Choose or add recipients                      |
| Enqueue outbox rows for confirmed subscribers   | Send email (no network in these scripts)      |
| Create local `.eml` draft files                 | Move a row to `approved` or `sent`            |
| Report state counts and honest failures         | Lower the caps or bypass the transition table |

The Gmail connector may import/refresh drafts **only under explicit human
approval per batch**; approving and sending stay human actions recorded via
`preview-outbox.mjs`.

## Provider-lane swap (production)

The production lane (provider send, e.g. Resend) reuses the **same states,
the same idempotency keys, and the same journal semantics** — only two things
change: `providerRef` points at a provider message id instead of an `.eml`
filename, and the human-review gate becomes the policy check enforced in
`convex/alwaysOn.ts` (draft-first, approval-gated, still ≤ caps). Swapping
lanes never touches the state machine — that is the point of keeping the
outbox boring. The Ops panel (`src/alwayson/OpsPanel.tsx`) shows both lanes
with the same table.
