# probe-first

**Research the person before you write to them. Then open short — one verified
recent detail, one open question.**

A skill for Claude Code and a contract for any coding agent. It refuses to draft
outreach until a real research hook exists on that contact, because a template
that invents a plausible opener is a fabrication in the one artifact a stranger
actually reads.

---

## The 26 words that caused this

A CTO sent seven words: *"hey Homen, want to chat?"*

The agent drafted about eighty — a positioning statement, a proof point, two
availability slots. The human deleted it and sent:

> Hi Robert,
>
> Happy to chat. I just saw your demo from a few days ago; I thought that was
> pretty cool!
>
> What are you looking for?

One researched detail the agent had never looked for. One open question. That is
the whole method.

## Why it generalises

- **A short inbound is opening a conversation, not requesting a pitch.**
- **Pitching first surrenders leverage** — it says what you want before you know
  what they want, so they screen you against a slot instead of getting curious.
- **A concrete recent detail proves attention** precisely because it cannot be
  templated.
- **An open question makes them describe their real need,** which is worth more
  than any opener you could have written.

Job search, sales, BD, fundraising, recruiting, partnerships, user research — the
shape holds anywhere a first message is the artifact.

## The gate

```
NO DRAFT — no research hook on this contact.
Look them up first. A generic opener is worse than a late reply.
```

Research is a lookup, not a language task. Ask a model to write an opener without
research and it will produce something plausible and false.

**"No hook found, deprioritise" is a correct answer**, and a good research pass
returns it regularly.

## What deep research actually buys

From one real run across twelve contacts, all source-cited:

- **A second SEC-registered firm** a founder had stood up six weeks earlier —
  present in primary filings, absent from all press. No other candidate had it.
- **A pivot** that made the obvious opener two years stale.
- **A comp claim that did not survive posted ranges** — "up to $300k" was true at
  two companies out of eleven; the median was less than half that.
- **A conflict worth real money** — an intermediary refusing to name a client that
  was probably a company already being pursued directly, where one submission
  would have locked out the direct path for months.
- **A better-matched opening posted the same day**, whose bullets described the
  candidate's actual work better than the role being applied for.
- **Three contacts with no hook at all**, correctly reported as such rather than
  papered over.

Five of those six change what you do. That is the bar for research that earned
its cost.

## Install

**As a Claude Code skill**

```bash
git clone https://github.com/HomenShum/probe-first ~/.claude/skills/probe-first
```

It loads automatically and triggers on drafting or research requests.

**For any other coding agent**

Point it at `SKILL.md`, or copy `AGENTS.md` into your repo. `references/DOSSIER.md`
is a research schema you can hand to a subagent verbatim; `references/STORE.md` is
a storage contract you can implement against SQLite, Postgres, Convex, or a JSON
file.

## Contents

| File | What it is |
| --- | --- |
| `SKILL.md` | The skill — rules, message shape, research method |
| `AGENTS.md` | Drop-in instructions for non-Claude agents |
| `references/DOSSIER.md` | The research schema, and when to return "no hook" |
| `references/STORE.md` | Contact-store contract: honest staleness, provenance, ranking |

## The one design decision worth copying

**The gate lives on the write path, not in a prompt.**

A rule in a system prompt is a suggestion — it competes with everything else in
context and loses under pressure. A function that returns `NO DRAFT` is a gate.
The same applies to the store's other guarantees: unknown staleness sorts as
urgent *in the comparator*, and confidence is inherited *in the constructor*.

Put the doctrine in code, and it holds on the day you are in a hurry.

## Related

- [before-after-proof](https://github.com/HomenShum/before-after-proof) — capture
  evidence before a change, because a "before" cannot be reconstructed after
- [graph-hop](https://github.com/HomenShum/graph-hop) — consult reasoning that
  lives in ChatGPT threads
- [task-level-guide](https://github.com/HomenShum/task-level-guide) — classify
  work by engineering level

## Licence

MIT
