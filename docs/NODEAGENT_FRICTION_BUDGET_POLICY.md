# NodeAgent Friction And Budget Policy

## Decision

Normal public `@nodeagent` prompts must stay conservative by default. High budgets are for explicit
benchmark/completion lanes or approved deep diligence, not every user prompt.

Source of truth:

- Policy code: `src/nodeagent/core/budgetProfiles.ts`
- Regression test: `tests/nodeAgentBudgetProfiles.test.ts`
- Workflow action map: `docs/nodeagent-action-map.json`
- Fresh-room proof receipts: `docs/eval/fresh-room/<case-id>/latest.json`

## Profiles

| Profile | Default? | Approval | Use |
|---|---:|---|---|
| `instant` | no | none | obvious safe read/classify/show tasks |
| `standard` | yes | one text submission | normal public room prompts |
| `background` | no | plan label, resumable | longer safe research in slices |
| `deep_diligence` | no | explicit approval | private context, downstream send, or material spend |
| `benchmark_completion` | no | explicit approval | capability/cost measurement with receipt-heavy proof |

Visible labels should come from `budgetProfileDisplay`, for example:

```text
Running as background · estimated 4-8 min · cap $1.50
```

## Low-Friction Rule

Run safe work automatically. Ask humans only when cost, privacy, evidence, or mutation risk crosses a
threshold.

| Work | Behavior |
|---|---|
| Read current room context | auto-read allowed context |
| Classify obvious note/entity | passive chip / inbox item |
| Search public source under small budget | auto-run if policy allows |
| Write new blank row/cell | auto-commit if clean and evidence-backed |
| Modify human-authored cell | proposal, not overwrite |
| Touch formula cell | preserve formula unless explicitly approved |
| Use private notes in public output | blocked or explicit approval |
| Send to Slack/Gmail/CRM | downstream draft first, explicit send |
| Run expensive deep diligence | plan + budget + background job |

## Product Rule

The user should say what they want once. NodeRoom starts safe work, shows progress, and asks the user
to review exceptions instead of every tiny step.
