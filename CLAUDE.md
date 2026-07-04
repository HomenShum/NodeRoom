# CLAUDE.md — Coding Agent Instructions

## Self-Scaffolding Proof-Looping

When you see a scaffold handoff document (posted as a PR comment or at
`docs/eval/scaffold-handoff.md`), apply the **Accepted Proposals** section
to the scaffold files. These are safe changes that passed all checks.

### What you MAY edit (scaffold)

- `AGENTS.md`
- `proofloop/scenarios/*.yaml`
- `proofloop/rubrics/*.yaml`
- `proofloop/subagents/*.md`
- `proofloop/adapters/*.js`
- `.proofloop/memory.jsonl`
- `src/nodeagent/models/prompts/systemPrompt.ts`

### What you may NOT edit during scaffold repair

- `scripts/proofloop.mjs`
- `scripts/agent-improvement-loop.ts`
- `tests/harnessChangeEval.test.ts`
- `.github/workflows/`
- `src/eval/evalTrustPolicy.ts`
- `src/eval/architectureBudget.ts`
- `evals/evalStore.ts`

### Rules

1. Only apply proposals marked **accepted** in the handoff.
2. Never apply proposals marked **rejected** or **needs adversarial review**.
3. Never modify immutable files while applying scaffold proposals.
4. After applying scaffold changes, run `npm run scaffold:check -- --strict-immutability` to verify.
5. Commit scaffold changes separately from code changes for clarity.

### Commands

```bash
npm run agent:improve     # run the full improvement loop
npm run scaffold:check    # check current diff + generate handoff
npm run scaffold:check -- --strict-immutability  # hard gate for scaffold-repair PRs
```

## Proximitty Proof Loop

`npm run proofloop:proximitty` runs the local/staging Proximitty underwriting
Proof Loop demo. It uses synthetic demo data only and must keep completion proof
separate from any official semantic benchmark score. If a policy fails, produce
scaffold suggestions in `model-delta.md`; do not lower the verifier or evidence
gate.

Use `npm run proofloop -- memory doctor` to verify the local-first recall layer,
and `npm run proofloop -- memory search "<query>"` to inspect compacted proof
episodes. Generated `.proofloop/memory/` stores stay local and uncommitted.

<!-- proofloop-agent-friendly:start -->
## ProofLoop Agent-Friendly CLI

These instructions are generated for Claude Code. Keep ProofLoop usage on-demand: ask the CLI for the slice you need instead of loading broad MCP state or stale transcripts.

Discovery:
- `npm run proofloop -- manifest --json` - machine-readable command surface.
- `npm run proofloop -- manifest --dense` - compact repo status, commands, suites, and UI contracts.
- `npm run proofloop -- docs agents --dense` - compact agent workflow.
- `npm run proofloop -- doctor --json` - read-only setup proof before claiming installed.
- `npm run proofloop -- ui contract --dense` - stable selectors/actions/assertions before browser work.

Long-running loop:
- `npm run proofloop -- this-repo --live` starts repo dogfooding with a persisted goal ledger.
- `npm run proofloop -- supervise --goal <goal-id>` continues the loop until pass/fail/blocker.
- `npm run proofloop -- gate --goal <goal-id>` is the completion gate; do not replace it with a transcript summary.
- `npm run proofloop -- resume --goal <goal-id> --dense` prints the next action when the loop stops.
- `npm run proofloop -- repair latest` converts a failed run into the next focused repair prompt.
- `npm run proofloop -- memory search "<failure or fixture>"` recalls compacted prior failures without dragging full logs into context.

Rules:
- Treat the user goal as the contract. Keep referencing what is not done until the gate passes.
- Do not claim done from chat, screenshots, or worker assertions. Claim done only from a deterministic gate, official scorer, or proof receipt.
- Keep certification-loop assets locked. Exploration can propose scenarios and scaffold changes, but it cannot grade or promote itself.
- Track harness versions, model routes, costs, blocked lanes, and official-score artifacts in receipts.
- Cheaper model routing is allowed for exploration and shadow runs; official scores require the official scorer or an explicitly recorded equivalent judge contract.
- If a local dependency is missing, run `npm run proofloop -- doctor --json` and fix local safe failures before blocking.
- If official scoring is blocked, keep proxy/product-path proof moving and label it honestly in receipts.
- Use the code graph and UI contracts before guessing files, selectors, or routes.

<!-- proofloop-agent-friendly:end -->

## Design System — ground before you style

Any change that touches UI (src/ui/**, src/app/styles.css) must ground itself
in the design system BEFORE editing — never guess tokens, class names, or
chrome:

- `npm run design:manifest` — the component roles, token rules, and UI
  invariants (read this first, like a component library index).
- `npm run design:audit` — the regression gate (row stretch, mid-word wrap,
  wrong-semantics colors, missing receipt chips, undismissable chrome). Run it
  after every UI edit; it is part of `prod:gate`.
- Canonical tokens live in the design reference bundle at
  `design-reference/assets/colors_and_type.css` (exported from the Claude
  Design project; refresh via the Design connector). NEVER introduce a hex
  value, radius, shadow, or type size that is not in that file or
  src/app/styles.css tokens.
- Design source-of-truth specimens: `design-reference/<dir>/` (room, fixes,
  scale, mobile-scale, feature-map, directions, terra). When implementing a
  design item, lift the exact CSS from the corresponding specimen instead of
  approximating. The parity queue lives in
  `docs/design/DESIGN_PARITY_PLAN.md`.
- Rules of the visual language: default state shows data, hover shows
  apparatus (desktop); what desktop reveals on hover, mobile reveals in a
  bottom sheet. Terracotta = agent provenance + selection; green = success
  semantics ONLY; amber = needs review.
- Visual claims require rendered proof (screenshot or DOM assertions against
  the built preview), never build-success alone.
