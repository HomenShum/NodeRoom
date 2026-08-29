# AGENTS.md — probe-first

Drop-in instructions for any coding agent (Codex, Cursor, Aider, Copilot
Workspace, Devin, or a custom harness). Copy this file into a repo, or paste this
section into a system prompt.

## The rule

Before drafting **any** message to a person — cold email, DM, recruiter reply,
sales outreach, investor note, partnership ask — you must have a **research
hook**: one concrete, recent, verifiable thing that person or company did, with a
date and a source URL.

**No hook, no draft.** Output this instead:

```
NO DRAFT — no research hook on this contact.
Searched: <list what you checked>
A generic opener is worse than a late reply.
```

Reporting that no hook exists is a **success**, not a failure. For volume
recruiters and unidentifiable senders it is the correct output.

## The message shape

```
Hi {first},

{one genuine reaction to the specific real thing}

{one open question}
```

Under ~40 words. Do not include the role, your background, proof points,
availability, or a second question. Those come after they answer.

If the thread has prior history, open with continuity rather than novelty — never
answer a warm thread as though it were cold.

## Research checklist

Fill this before drafting. Cite a URL per claim; mark gaps `unverified`.

- [ ] Who they are — person, employer, and whether they are an intermediary
- [ ] What the company **actually** does today (not its tagline, not its founding story)
- [ ] Funding: amount, **date**, lead investor
- [ ] What shipped in the last 90 days
- [ ] Why now — what changed that explains this contact
- [ ] The hook: text, date, source URL — or an explicit "none exists"
- [ ] Genuine fit **and** genuine gaps
- [ ] 3 ranked open probe questions
- [ ] Red flags, with severity

Highest-signal sources, in order: primary filings and registries; the person's own
code and posts; last-90-day launches; funding with dates; job postings; recent
talks. Most researchers stop at the profile page, which is why the hooks found
below it are worth so much.

## Hard constraints

1. **Never invent or generalise a hook.** "Saw your work in AI" is a fabrication
   with the specificity removed.
2. **Never present an inference as a fact.** Label it.
3. **Never report absence without scope.** Say what you searched. A probe that
   could not have found the answer is not evidence of absence.
4. **Never let an intermediary submit you anywhere before they name the end
   company.** One submission can lock out a direct path for months.
5. **Never fabricate a number** — dates, staleness, confidence. Unknown is a
   value, and it should sort as urgent.

## Storage

If you persist contacts, honour these guarantees:

- `stale` may return `UNKNOWN`, and `UNKNOWN` sorts **as urgent**
- findings carry `source_url`, `date`, and `verified | inferred`
- confidence is **inherited from the weakest endpoint**, never stamped uniformly
- history is append-only
- reporting surfaces open the store **read-only**
- a partial read announces itself — return `{ ok, reason, count }`, never a bare
  `false`

Ranking is by cost of delay: deadlines, then longest-waiting inbound, then
in-flight, then everything else. Within inbound, **wait time beats payoff speed**
— a person who has been waiting is not outranked by a faster payday.

## Implementation note

**Put the gate on the write path, not in the prompt.** A system-prompt rule is a
suggestion that competes with everything else in context and loses under time
pressure. A function that returns `NO DRAFT` is a gate that holds.

Full detail: `SKILL.md`, `references/DOSSIER.md`, `references/STORE.md`.
