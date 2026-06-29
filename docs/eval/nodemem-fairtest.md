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

## Head-to-head vs the cheap alternative (a bigger awareness window)

`awareness()` is hard-capped at 6 traces. The cheapest possible fix is to raise it (now env-configurable,
`AWARENESS_WINDOW`, default 6 — `convex/collab.ts`). Three-way, scaling noise (n=2):

| scale (noise items) | `bare-6` (today) | `bare-30` (cheap fix) | `+ NodeMem` |
|---|:---:|:---:|:---:|
| small (0)  | 1.00 | 1.00 | 1.00 |
| mid (12)   | 0.00 | **1.00** | 1.00 |
| big (50)   | 0.00 | **0.00** | **1.00** |

The crossover is exact:
- **A bigger window recovers recall up to ~N items, for zero engineering.** Raising 6→30 fully fixes the
  `mid` scale — NodeMem adds **nothing** there. Most accumulation is probably in this regime.
- **The window approach breaks past N, and can't be fixed by growing N.** It is *recency*-ordered, so a
  relevant-but-old fact buried under newer noise falls out no matter how large N is — until N is so large
  the raw activity blows the token budget (and cost grows linearly every run). At `big` (50 noise),
  `bare-30` is back to 0.00.
- **NodeMem is the only thing that survives `big`** — it is *relevance*-ranked and bounded, so it keeps the
  old relevant facts and drops the noise, at fixed token cost (held 1.00 at 200 facts / ~190 noise).

## Ship decision

NodeMem's marginal value over the cheap fix is real but appears **only at genuinely long, noisy histories**
(beyond what a reasonable window can hold). Decision rule:

- **Rooms accumulate ≲ a few dozen relevant activity events** → just raise `AWARENESS_WINDOW` (one env var,
  already built, default-safe). NodeMem is overkill.
- **Rooms accumulate heavy, noisy, cross-session history** (the long-running wedge) → NodeMem's
  relevance-retrieval is required; the window cannot keep up at any size without blowing cost.

Independent of the value call: land the `agentJobRunner` injection fix — memory never reached the chat
agent (a correctness bug, not a value bet).
