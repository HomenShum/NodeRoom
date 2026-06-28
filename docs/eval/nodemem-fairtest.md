# NodeMem fair value test — does NodeMem beat what the agent already has?

The recall benchmark (`nodemem-recall-benchmark.md`) proved NodeMem retrieves facts that live ONLY in
episodes — i.e. **NodeMem vs nothing**. This is the honest comparison: **NodeMem vs the existing
context**. The agent already sees `awareness()` = the **last 6 `traces`** ([collab.ts](../../convex/collab.ts)) +
the sheet snapshot + OKF/web tools. So we seed the SAME 5 facts into BOTH channels — the bounded
awareness channel (room `traces`) AND NodeMem episodes — and scale.

- Harness: `e2e/nodemem-fairtest.spec.ts` · graded on authoritative `agentJobs.finalText` **+ written sheet cells**
- Arms: `bare` (NODEMEM_MODE off — existing context only) vs `memory` (active_ab — + NodeMem)
- `small`: the 5 fact-traces are the most recent → fit in awareness's last-6 → bare can already see them
- `large`: the 5 fact-traces are old, buried under 16 newer noise traces → fall OUT of awareness's last-6;
  the facts are chat/notes (not sheet cells / OKF concepts), so the bare agent's other tools can't reach them

## Result (n=2, identical to n=1)

| scale | `bare` (existing context) | `memory` (+ NodeMem) | NodeMem marginal value |
|---|:---:|:---:|:---:|
| **small** (facts recent) | **1.00** | 1.00 | **0.00** — existing context already recalls |
| **large** (facts past the window) | **0.00** | **1.00** | **+1.00** — the entire difference |

## Interpretation — the honest answer to "what does NodeMem add"

**Exactly one thing: recall of accumulated history once it exceeds the agent's existing window.**

- **Short room:** the existing context (`awareness` last-6 + snapshot + OKF/web) already recalls every
  relevant fact. NodeMem adds **nothing** (`bare` = `memory` = 1.00).
- **Long room:** once relevant history scrolls past the 6-trace awareness window, the existing context
  **forgets** (`bare` → 0.00) and NodeMem's unbounded, relevance-ranked retrieval **remembers** (1.00).
  This is the entire value, and it is **conditional on context length**.

## Caveats (so the value isn't oversold)

- **Narrow scope: the activity/conversation long-tail.** Facts in **sheet cells** (snapshot) or **OKF
  concepts** are already retrievable at any scale — those channels aren't recency-bounded. NodeMem only
  earns its keep for chat / captures / prior reasoning that scroll out of awareness.
- **A cheaper 80% exists.** Raising awareness's `.take(6)` recovers moderate long-tail recall for ~zero
  engineering. NodeMem wins only when history is large enough that dumping raw recent activity blows the
  token budget — then its **compression + relevance ranking** is what scales (it held 1.00 at 200 facts
  with ~190 noise notes; a bigger raw window would not).
- Cheap model (`glm-5.2`) + local backend; the mechanism (window-bounded vs unbounded retrieval) is
  structural and holds regardless.

## Ship decision

NodeMem is worth it **iff the product is long-running, accumulating rooms** (the stated wedge). For
short rooms, bump the awareness window instead. Independent of the value call, land the `agentJobRunner`
injection fix — memory never reached the chat agent (a correctness bug, not a value bet).
