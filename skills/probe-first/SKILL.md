---
name: probe-first
description: Research a person before writing to them, then open short — one verified recent detail and one open question. Refuses to draft outreach until a real research hook exists on that contact, because a template that invents a plausible opener is a fabrication in the one place a stranger reads. Use when drafting any outreach, reply, cold email, DM, recruiter response, sales or BD message, investor note, or when researching a person or company before contact.
trigger: when user says "draft a reply", "write to", "reach out", "cold email", "respond to this recruiter", "message them", "follow up with", "research this person", "who is", "what should I say to", or pastes an inbound message to answer
---

# probe-first

Two rules, and the second is enforced in code rather than trusted to judgement.

**1. Research the person before writing a word.** Not their job title — what they
*did recently*. A launch, a demo, a filing, a shipped PR, a post. One concrete,
dated, verifiable thing.

**2. Open short. One real detail, one open question. Then stop.** A first message
is a probe, not a pitch.

## Why, in one example

A CTO sent seven words: *"hey Homen, want to chat?"*

The agent drafted ~80 words: a positioning statement, a proof point, and two
availability slots. The human deleted it and sent this instead:

```
Hi Robert,

Happy to chat. I just saw your demo from a few days ago; I thought that was
pretty cool!

What are you looking for?
```

26 words. One researched detail the agent had never looked for. One open question.

The human's version wins for reasons that generalise:

- **A short inbound is opening a conversation, not requesting a pitch.** Answering
  seven words with eighty misreads the register.
- **Pitching first surrenders leverage.** It states what you want before you know
  what they want, so they screen you against a slot instead of getting curious
  about you.
- **One concrete recent detail proves attention** in a way no positioning can —
  precisely because it cannot be templated.
- **The open question makes them describe their real need** in their own words.
  That information is worth more than any opening pitch.

## The gate

Do not draft until a `hook` exists on the contact: one real, recent, verifiable
thing that person did, with a date and a source.

If there is no hook, the correct output is **not a message**. It is:

```
NO DRAFT — no research hook on this contact.
Look them up first. A generic opener is worse than a late reply.
```

Research is a lookup, not a language task. A model asked to write an opener
without research will produce something plausible and false — in the one artifact
a stranger actually reads. **An honest "no hook found, deprioritise" is a correct
answer.** Several contacts deserve exactly that.

## The message shape

```
Hi {first},

{one genuine reaction to the real, specific thing}

{one open question}
```

Do **not** add: the role, proof points, your background, availability slots,
attachments, or a second question. Those come after they answer. Match what they
actually say — which you cannot do before they say it.

**If the thread already has history, do not open cold.** Continuity beats novelty:
reference the last exchange and give them something new.

## Researching well

Go past the profile. A profile tells you their title; it does not tell you what
they are dealing with this month.

| Look at | Because |
| --- | --- |
| What shipped in the last 90 days | The hook usually lives here |
| Funding, with dates and investors | Explains *why they are hiring/buying now* |
| Primary filings and registries | Almost nobody checks these — highest-signal hooks |
| Their own posts, PRs, commits, talks | Their taste, in their words |
| What the company *stopped* doing | Pivots make old framing sound stale |
| Competitors' recent moves | The pressure they are actually under |

**Two failure modes to name explicitly.** First, *staleness*: a company's public
story can be two years out of date, and opening with it marks you as someone who
read one article. Second, *the wrong door*: the role in front of you may not be
the one that fits — check whether a better-matched opening exists before
committing to the visible one.

Full research contract: `references/DOSSIER.md`.

## Recording what you find

Every research finding is a durable asset. Store it against the contact so the
next session does not repeat the work, and so a claim can be traced to a source.

Minimum per contact: `hook` (the one line), `source` (URL), `date`, and
`verified` vs `inferred`. Never let an inference silently become a fact.

Store contract, portable across tools: `references/STORE.md`.

## What not to do

- Do not invent a hook. Do not generalise one ("saw your work in AI") — that is a
  fabrication with the specificity filed off.
- Do not send a first message longer than ~40 words without a specific reason.
- Do not name a role, a salary, or an ask in message one.
- Do not treat "no recent activity found" as "no recent activity" — say which
  sources you checked.
- Do not let an agency or intermediary submit you anywhere before they name the
  end company. That is a costly, common trap.

## Reference

- `references/DOSSIER.md` — the research schema an agent must fill, including
  when to return "no hook exists"
- `references/STORE.md` — the contact-store contract, honest staleness, and how
  any agent or app integrates with it
