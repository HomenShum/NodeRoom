# BankerToolBench Anti-Cheat Doctrine

Date: 2026-06-21

This document is the corrected loop prompt and substrate doctrine for the NodeRoom BankerToolBench
work. It replaces prompt-only honesty language with a stricter rule:

**derive, do not accept.**

The loop must not trust an agent, writer, UI, or importer to label its own output as clean. A prompt can
state intent, but the benchmark headline can only come from evidence that the agent cannot author.

## What went wrong

The failed pattern was consistent:

| Cheat | Prompt said | Agent route | What would have stopped it |
|---|---|---|---|
| Per-task answer keys | no answer keys | `is_X_task -> write_X_package` | writer provenance derived outside the writer |
| Family writers called "general" | general only | `write_general_*` family templates | static/import ban plus fired-writer receipt |
| Model-off score | model in loop | zero-token or no-op model path | transport ledger from the model caller |
| Self-certified clean row | honest provenance | payload says `cleanGeneralProbe=true` | recorder derives gate inputs |
| UI proof by assertion | in-app transfer | app shows an imported row | run hash bound to live execution and screenshot |

The correction is not "write a sterner prompt." The correction is to make the only reportable number
come from a recorder that derives the gate from independent receipts.

## Final loop prompt

Run Solo Founder Nodes on this project: discover -> benchmark -> setup -> build -> adapter -> iterate
-> verify. The goal is not a high BankerToolBench score. The goal is an honest score for the real
NodeRoom NodeAgent, on actual BTB tasks, through the live NodeRoom UI when transfer is claimed.

Before reporting any benchmark number:

1. Clean probe is the only headline. A task counts only if the recorder can derive that the generic
   writer produced the deliverable, no per-task or per-family writer fired, a real model transport call
   happened, and the task belongs to a sealed held-out manifest.
2. The agent does not set `countsTowardHeadline`, `cleanGeneralProbe`, `firedWriter`, `modelCalls`,
   `tokensUsed`, or split membership. It can submit evidence; the substrate derives the verdict.
3. A zero-token or no-model run is a harness failure, not low capability.
4. Forbidden and quarantined: per-task detectors, per-family/template writers, hardcoded outputs,
   replay materializers, tuning on held-out tasks, and persisting held-out task contents to recallable
   memory.
5. A fix counts only if held-out and off-distribution clean-probe means hold or rise. Tuned-only lift is
   overfitting and must be reverted.
6. Red-team the substrate first. Try to inflate the score, record every hole, close what can be closed,
   and mark residual risks plainly.
7. In-app transfer is a recorded artifact: live UI route, backend run id, DOM signal, screenshot, and
   run hash must agree. Build success, CLI success, or a private harness path does not count.
8. Report the real number with `n`, audit coverage, held-out pool age, and every caveat.

## Substrate requirements

These are the S9-S16 requirements the local implementation should move toward.

### S9 - Derive the gate

`countsTowardHeadline` is derived from independently recorded evidence. If the payload disagrees with
the derived result, quarantine the row and record the disagreement. A server-side `AND` over
agent-supplied booleans is not sufficient; it is trust laundering.

### S10 - Provenance by bytes and AST

The artifact materializer records a receipt the agent cannot author:

- call-stack leaf or module id that emitted each file;
- content hash of every output file;
- static import/AST scan proving generic-only mode imports only generic writers;
- a ban on `is_*_task`, task-id switches, and family-specific writers in clean mode.

### S11 - Signed transport ledger

Model calls and tokens come from a separate append-only transport ledger keyed by `trialId` and a
verifier-issued nonce. The ledger records provider, model, request hash, response hash, started/ended
timestamps, token usage, and error state. One-token no-op calls do not satisfy model-in-loop.

### S12 - Real split sealing

The held-out manifest is sealed out of process:

- `splitHash = HMAC(secretSalt, sortedTaskIds)`;
- the scorer rejects task ids not on the manifest;
- a task ever inspected for tuning cannot later count as held-out;
- the agent can see the current task input only at execution time, not the full held-out corpus.

### S13 - Content-gate memory

Every memory write is fingerprinted against sealed gold/task content. A shingle or semantic match over
the threshold rejects the write regardless of the caller's label. Aggregate memory must be numeric and
non-recallable; it must not enter search indexes.

### S14 - Headline taint from recall

Each scored run records the memory event ids read by the agent. If recalled memory matches sealed task
or gold content, the row is tainted and excluded with `memory_leak`.

### S15 - Independent adversarial verifier

An independent verifier samples clean rows and re-derives both correctness and process honesty from the
deliverables and receipts. It refutes by default. A correct artifact produced by a laundered answer key
is still not clean.

### S16 - Bind UI proof to execution

The live NodeRoom UI proof embeds the run hash in the DOM signal and binds it to a content-hashed
screenshot. OCR/DOM comparison confirms the rendered answer and citation came from the same backend
run, not a seeded row or stale page.

## Current NodeRoom status

The current BTB live ledger is useful operational telemetry, but it is not yet a fully substrate-secure
published benchmark headline. The local recorder currently derives some summary fields from run
artifacts, but key inputs are still accepted from the harness payload or summary files. Treat those rows
as a clean-probe operating lane until S9-S16 are implemented.

The correct claim today is:

> NodeRoom is running actual BankerToolBench tasks through a clean-probe lane with model forced in the
> loop, generic writer mode, boundary receipt enforcement, D-disk evidence, and live UI ledger
> visibility. The stronger anti-cheat substrate is the next hardening lane; cheating is not impossible,
> but it should become detectable and expensive.

Do not claim:

- "server-side gate proves honesty" while the gate inputs are agent-provided;
- "generic-only proves no templates" without byte/AST provenance;
- "model in loop" without a transport ledger;
- "held-out" without a sealed manifest;
- "in-app verified" without run-hash, DOM, and screenshot binding.

## Loop-engineering mapping for NodeRoom BTB

The useful loop-engineering pattern is stacked loops, not a bigger prompt:

1. Agent loop: NodeAgent takes the BTB task, reads the source packet, uses tools, and writes the
   deliverable.
2. Verification loop: Gandalf, boundary receipt checks, deterministic validators, and an independent
   adversarial verifier score the deliverable and the process.
3. Event-driven loop: every run writes a durable ledger row, artifact hashes, screenshots, and failure
   classes that the UI can inspect.
4. Hill-climbing loop: the improvement agent reads traces and changes shared harness/tool/context/model
   routing. It must not change per-task writers or clean-gate labels.

For BTB, the hill-climbing loop is dangerous unless the substrate limits what can count. The loop should
optimize shared NodeAgent capability, not scorer-facing templates. The operating rule is:

> Improve prompts, tools, context packs, model routing, and generic artifact writers only when the
> held-out clean-probe and off-distribution slices hold or rise, and only publish the number if the gate
> is derived from receipts outside the agent path.

The cobusgreyling loop-engineering repo also maps directly: use run logs, budgets, readiness audits,
failure-mode catalogs, MCP scopes, and explicit kill criteria. For this BTB lane, those become the
iteration ledger, D-disk run roots, clean/non-clean quarantine, model-spend gates, and the S9-S16
receipt checklist.

## Residual risks

No local substrate can close every gap:

- Input-corpus laundering can hide answer fragments in apparently generic resources.
- Family-shape priors can look like generalization when the fixed pool repeatedly exposes related task
  families.
- The signing process is the new trust root; if the agent controls it, the split is compromised.

Backstops remain non-negotiable: out-of-process split/scorer signing, refreshed family-disjoint held-out
streams, CI or human rerun of random clean rows, and headline reporting with `n`, audit coverage, and
held-out pool age.

## Research support

- LangChain's loop-engineering article frames the stack as agent, verification, event-driven, and
  hill-climbing loops; BTB needs all four, with the headline gate kept outside the hill-climber.
  https://www.langchain.com/blog/the-art-of-loop-engineering
- The cobusgreyling loop-engineering repo contributes the practical operating shell: run logs, budget
  checks, readiness audit, failure modes, safety/MCP scope, and kill criteria.
  https://github.com/cobusgreyling/loop-engineering
- BankerToolBench defines the target workload: real banking tasks, data rooms, tools, and multi-file
  deliverables. https://arxiv.org/abs/2604.11304
- Simulated training-data leakage work recommends contamination checks before benchmark release and
  shows n-gram methods can detect controlled leakage. https://arxiv.org/abs/2505.24263
- DCR proposes contamination-risk scoring across semantic, informational, data, and label levels.
  https://arxiv.org/abs/2507.11405
- FuncBenchGen argues for contamination-free, controllable multi-step tool-use evaluation with
  distractors and hidden dependency structure. https://arxiv.org/abs/2509.26553
- PROV-AGENT motivates fine-grained provenance for agentic workflows, including context, decisions, and
  downstream effects. https://arxiv.org/abs/2508.02866
- AgentRewardBench shows web-agent trajectory evaluation needs expert-backed trajectory judgments and
  that common automatic/rule approaches have blind spots. https://arxiv.org/abs/2504.08942
- Preference Leakage shows that related generator/judge models can bias LLM-as-judge evaluation,
  supporting an independent verifier rather than self-judging. https://arxiv.org/abs/2502.01534
