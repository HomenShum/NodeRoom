# The dossier contract

What a research agent must produce before any message is drafted. Written so it
can be handed to a subagent verbatim, or used as a checklist by a human.

## Rules the researcher must follow

1. **Cite a URL for every factual claim.** A claim without a source is a draft
   note, not a finding.
2. **Mark anything unconfirmed as `unverified`.** Never fill a gap with a
   plausible guess. "I could not identify this person" is a complete, useful
   answer.
3. **"No hook exists" is an allowed — and sometimes correct — result.** For a
   volume recruiter or an unidentifiable sender, it is the right one.
4. **Separate verified from inferred.** Label inferences as inferences and say
   what they rest on.
5. **Say what you searched.** If you found nothing, the coverage is the finding:
   "searched X, Y, Z; blocked on W." Silence about scope reads as absence.

## The schema

```yaml
target:
  name:
  role:
  employer:
  agency_or_inhouse:      # for intermediaries — changes everything downstream
  identified: verified | unverified
  profile_urls: []

company:
  what_it_actually_does:  # precisely, not the tagline
  stage:
  funding:                # amounts WITH dates and lead investors
  headcount:              # note when sources disagree, and by how much
  recent_pivot:           # what they STOPPED doing — stale framing is a trap
  competitors:            # and what those competitors just did

recent_activity:          # last 90 days, dated
  - what:
    date:
    source:

why_now:                  # what changed that explains this outreach/req
  evidence:
  inference:              # labelled separately from evidence

hook:
  text:                   # the one line, in plain language
  date:
  source_url:
  exists: true | false    # false is a valid, respectable answer
  note_if_absent:         # what you checked, so absence is scoped

fit:
  genuine_matches: []     # their stated need -> your actual evidence
  genuine_gaps: []        # be blunt; the gaps get probed in the room anyway
  wrong_door:             # is a different opening a better match?

probes:                   # 3, ranked, open-ended
  - question:
    why_it_works:

red_flags:
  - flag:
    severity: gating | high | medium | low
    evidence:

could_not_verify: []      # explicit, not omitted
```

## Where the best hooks come from

Ranked by signal, because most researchers stop at the first row.

1. **Primary filings and registries.** Regulatory registrations, incorporations,
   patent grants, court records, procurement notices. Almost nobody checks these,
   so a hook from here proves genuine diligence rather than a search.
2. **The person's own code and posts.** A merged PR, a commit message, a README
   opinion. Engaging with something they *built* lands differently from
   commenting on something they announced.
3. **What shipped in the last 90 days.** Launches, changelogs, demos.
4. **Funding with a date and a lead** — it explains urgency, which explains why
   they are talking to you at all.
5. **Job postings.** They state the pain in the company's own words, and they are
   public.
6. **Conference talks, podcasts, long-form writing.** High value, but check the
   date — a two-year-old talk is not recency.

## Anti-patterns

| Anti-pattern | Why it fails |
| --- | --- |
| "I saw your work in AI" | Specificity filed off; reads as automated |
| Referencing the company's founding story | Often two years stale; signals one article read |
| A hook older than ~90 days presented as recent | They know when they posted it |
| Praise with no technical content | Unfalsifiable, so it carries no information |
| A hook that is really about you | The probe is about them |
| Citing a metric you cannot defend | The follow-up question ends the conversation |

## Calibration

A good dossier changes what you would have done. If the research confirms
everything you already assumed, either the target is genuinely simple or the
research was shallow.

Concrete markers of a dossier that earned its cost: it found a second entity, a
pivot, a better-matched opening, a comp claim that does not survive contact with
posted ranges, or a conflict that would have cost something. Any one of those
pays for the search.
