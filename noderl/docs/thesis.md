# NodeRL — thesis

## The reframe

Most teams attempting agentic RL are missing the *environment* and the *reward*, not the model.
NodeRL is the substrate that supplies both, built from production agent runs.

```
Agentic product workflow   = environment
Coding / browser / tool agent = policy
Tool call, file edit, click, capture = action
Screenshot, test result, app state, trace frame = observation
Proof receipt, scorer, judge, cost, user verdict = reward
NodeTrace = trajectory recorder
NodeMem   = replay memory + context retrieval + failure memory
The loop  = curriculum + repair + stopping condition
```

Agentic RL does **not** have to start as "train a giant model with PPO." It starts as:

```
run real tasks → record every step → score every step + final output
→ store what worked and failed → (later) tune small policies from those rewards
```

## The improvement ladder (cheap → expensive)

- **L0 — trace-to-reward, no training.** Record trajectories, score outcomes, store rewards.
  Already valuable: you learn what fails and what it costs.
- **L1 — runtime nudging.** Retrieve similar failed trajectories from NodeMem; warn the next
  attempt off the known-bad path. The cheapest "self-improvement."
- **L2 — preference data.** Build chosen/rejected pairs (success > failure, grounded > unsupported,
  cheap-success > expensive-success) for DPO/IPO/ORPO or SFT.
- **L3 — RLVR/GRPO on *narrow* policies.** Tool-selection, context-selection, repair-strategy,
  evidence-capture, model-routing — small action spaces with verifiable rewards. Not the whole agent.
- **L4 — online improvement.** Only with sandboxing, budget caps, reward-hacking checks, held-out
  evals, canary deploy, rollback. RL optimizes whatever it can exploit — the sandbox and the
  reward definition matter as much as the model.

## Why this stack, specifically

The hard parts already exist in a real product: durable traces, a proof-receipt contract,
multimodal (video) judges, evidence/citation verification, cost telemetry, and an anti-cheat
doctrine where **held-out + in-app transfer is the gate, not a vibe**. NodeRL packages those so
someone else can point their agent at one repo and get the environment + reward + dataset
exporter — then run the narrow-policy experiment that's actually fundable.
