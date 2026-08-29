# The contact store contract

A portable contract, not an implementation. Any agent, app, or script can satisfy
it — SQLite, Postgres, Convex, a JSON file, a Notion database. What matters is the
guarantees, because they are what make the store trustworthy enough to act on.

## Entities

```
contact    a person you may write to
org        a company or firm
thread     an inbound or outbound conversation
obligation something with a date attached
finding    a researched fact, with a source
```

## Guarantees — the part that matters

### 1. Unknown is a value, and it sorts as urgent

Never substitute a plausible number for a missing one.

An early version of this store computed "days waiting" from when the record was
*created*, so a contact who had been waiting nine days reported `0d` because the
row was written today. That is worse than no number: it demoted the most urgent
item on the board while looking authoritative.

```
stale(contact) -> integer | UNKNOWN
```

`UNKNOWN` renders as unknown and **sorts as urgent**, on the principle that if you
do not know how long someone has waited, the answer is probably "too long."

### 2. Findings carry provenance or they are not findings

```
finding: { text, source_url, date, confidence, verified | inferred }
```

`confidence` must be inherited, not stamped. An edge between two records cannot be
more certain than its weaker endpoint. A uniform `0.9` across every relationship
is decoration; it tells a reader nothing.

### 3. Append-only history

A `status` field tells you where something is. **An event log tells you whether it
is moving.** A contact sitting at `open` for nine days looks identical to a fresh
one until you read the log. Record what happened and when; never edit history in
place.

### 4. Read-only by default

Anything that reports on the store should open it read-only, enforced by the
connection rather than by convention. A reporting surface that *can* write will
eventually write.

### 5. Partial reads announce themselves

If a source could not be read, the output says so. A refresh that silently drops a
store and writes a fresh timestamp is the most dangerous failure available: the
data is stale and the artifact asserts it is current.

```
{ ok: false, reason: "...", count: 0 }   // never a bare false
```

## Ranking

Sort by **cost of delay**, not by interest.

```
0  hard deadlines, soonest first
1  inbound waiting on you, longest wait first   <- unknown sorts here, at the top
2  in-flight, needs a nudge
3  everything else
```

**Within inbound, wait time beats payoff speed.** A person who has been waiting is
not outranked by a faster payday. Getting this backwards is easy and consequential:
in the reference implementation, `cash` sorted before `stale` for one build, and
the longest-waiting contact on the board ranked seventh behind someone who had
written that morning.

Nothing you could *build* belongs on this list. Artifacts do not reply.

## Minimum operations

```
next                 what to do now, ranked
hook <id> "<text>"   record a research finding
draft <id>           refuses without a hook
log <id> "<note>"    append to history
waiting <id>         hand-off: staleness now measures THEIR silence
since <id> <date>    when this actually arrived
```

`draft` refusing is the load-bearing behaviour. Everything else is bookkeeping.

## Integrating with an existing app

The store is deliberately small so it can be a table in something bigger. Three
integration shapes, in increasing order of coupling:

**Read-only mirror.** Your app owns contacts; this store is a derived view rebuilt
on a schedule. Simplest, and it cannot corrupt anything.

**Shared table.** `contact`, `finding`, and `event` become tables in your schema.
The guarantees above become column constraints and a check on write.

**Adapter.** Implement the six operations against your own backend. Ranking and
the draft gate live in shared code; storage is yours.

Whatever the shape: **the draft gate must live on the write path, not in a prompt.**
A rule in a system prompt is a suggestion. A function that returns `NO DRAFT` is a
gate.
