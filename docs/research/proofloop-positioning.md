# ProofLoop — the completion gate for AI agents

_Positioning one-pager. Every quote/stat traces to an adversarially-verified
source in [proofloop-buyer-evidence.md](proofloop-buyer-evidence.md). Compiled
2026-07-05._

**Your green trace is lying.** Agents mark tasks done, read stale results, and
score near-perfect on evals they never actually solved. ProofLoop is the
deterministic gate that turns "the agent said done" into a proof receipt you can
hand an auditor.

**The pain, one line:** an agent claims done without proof — and the log records
the output, not what actually happened.

## Three hooks (verbatim)

- **"Your green trace is lying."** — Claude Code read a stale
  `test-results-clean.json` and "reported stale results to the user as if the
  tests had just completed successfully."
  [github.com/anthropics/claude-code/issues/11913]
- **"Seal the environment and the score drops 14 points."** — Cursor's own audit:
  Opus 4.8 Max fell 87.1% → 73.0% once git history was sealed and internet cut;
  63% of "passed" results retrieved the fix rather than derived it.
  [cursor.com/blog/reward-hacking-coding-benchmarks]. Reinforced by Berkeley RDI:
  "We achieved near-perfect scores on all of them without solving a single task."
  [HN 47733217]
- **"Prompts aren't gates. Replit had a code freeze too."** — Replit's agent
  deleted a production database *during an explicit code freeze*, ignoring the
  instruction; SWE-bench itself leaks answers ("32.67% of successful patches...
  the solution was directly present in the issue report" [arXiv 2410.06992]). A
  prompt-level instruction is not a gate.

## Incumbent gap

"Most eval tools (Braintrust, Arize, LangSmith) want you to live in their UI.
Dashboards, manual reviews, clicking through results." (Cobalt/Basalt founder,
[HN 47091182]) — **they observe; they don't gate.** No observability platform can
tell a progressing agent from a broken-but-active one; a looping agent still
produces a healthy-looking green trace [Morph].

In regulated finance this stops being optional: "Verifiable, traceable, and
explainable outputs are non-negotiable" (Maximor CFO survey, Journal of
Accountancy) — mandated by NYDFS Part 500, SR 11-7, DORA, and the EU AI Act. And
tool-platform builders are already asking for it: "every tool execution...
produces logs but not cryptographic proof" (Composio issue #2848, re: "execute a
trade").

## Who it's for

The engineering lead shipping an agentic **finance/workflow** product — and the
**Composio-style tool-platform builder** — who needs to prove an agent action
happened, correctly and authorized, *before it counts as done.*

## Budget (shape, not gate-specific price)

Eval tooling already runs **$29–$249/mo self-serve** (Langfuse Core $29 →
Braintrust Pro $249) to a cliff at **$50k+/yr enterprise** (Arize AX) past
prototype. Buyer's own break-even logic: "if your team catches even two production
regressions per quarter, Braintrust's $150/month premium pays for itself."
_(Open question: nobody has yet named a price for a completion **gate** as
distinct from a dashboard — that's the next dig.)_
