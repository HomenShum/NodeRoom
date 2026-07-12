# CLAUDE.md — Coding Agent Instructions

## What this repo is (read this first)

- **NodeRoom is the product**: a live diligence room where bankers, GTM operators, and
  AI agents work on the same artifacts without silent overwrites. The frozen product
  scope is `docs/WEDGE.md` — refuse scope expansion beyond it.
- **ProofLoop is the certification harness** that gates NodeRoom (also published
  separately as the `proofloop` npm package). It owns the generated block between the
  `proofloop-agent-friendly` markers below and most `benchmark:*` / `proofloop:*`
  npm scripts.
- Live status and current loops: `NODE-LOOPS.md`. Claim rules and status vocabulary
  ("proven" means an official score was imported, NOT that the benchmark was passed):
  `docs/eval/CERTIFICATION_GATES.md`. Repo jargon (OKF, HALO, FR-0xx, fresh-room,
  flipEligible): `docs/GLOSSARY.md`. Benchmark lane-to-command matrix:
  `docs/eval/BENCHMARK_RUNBOOK.md`.

## The two canonical gates

- `npm run floor` — fast per-change floor (root typecheck + convex typecheck +
  vitest). Run this INSTEAD of ad-hoc `tsc` / `vitest` invocations after every
  substantive change.
- `npm run prod:gate` — the full pre-ship gate. The script body in package.json is
  the authoritative step list; do not restate partial step lists in other docs.
- Claim "done / passed / fixed / live" only from a deterministic gate, official
  scorer, proof receipt, or live-DOM verification — never from chat, screenshots,
  build success, or a worker's assertion.

## Deploys — two targets, both required

- Convex prod is `zealous-goshawk-766` (the env string says `dev:` — it IS prod).
  Deploy with `npm run convex:deploy`; `npm run convex:deploy:guard` hard-fails if
  `.env.local` points anywhere else.
- The frontend deploys via Vercel from git main automatically. `git push` alone never
  updates Convex; `convex:deploy` alone never updates the frontend.
- `npm run ship:prod -- --signal "<dom-string>"` chains guard → convex deploy → live
  fetch of the prod URL asserting the DOM signal. Never say "shipped" or "live"
  unless that live-DOM leg passed.
- GOTCHA: `npx convex codegen` performs a network push (bundle upload + schema-change
  start) against the deployment pinned in `.env.local`. The post-edit hook skips
  auto-codegen while pinned to prod; when you need fresh `_generated/` types, run
  codegen deliberately against an isolated dev deployment.

## Self-Scaffolding Proof-Looping

When you see a scaffold handoff document (posted as a PR comment or generated at
`docs/eval/scaffold-handoff.md` — gitignored; regenerate with `npm run scaffold:check`),
apply the **Accepted Proposals** section to the scaffold files. These are safe changes
that passed all checks.

### What you MAY edit (scaffold)

- `AGENTS.md`
- `CLAUDE.md` (this file — outside the generated marker block)
- `proofloop/rubrics/*.yaml`
- `proofloop/accounting/scenarios/*.yaml` and `proofloop/accounting/rubrics/*.yaml`
- `proofloop/notion/scenarios/*.yaml` and `proofloop/notion/rubrics/*.yaml`
- `proofloop/adapters/*.mjs` and `proofloop/adapters/*.ts`
- `.proofloop/memory.jsonl` (gitignored, generated)
- `src/nodeagent/models/prompts/systemPrompt.ts`
- `proofloop.config.json` (legal scaffold target if present; absent today)

Note: `proofloop/scenarios/` holds Playwright `.spec.ts` harness files, not scaffold
YAML, and `proofloop/subagents/` does not exist — do not create files there.

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

`npm run proofloop:proximitty` runs the local/staging Proximitty underwriting Proof
Loop demo. It uses synthetic demo data only and must keep completion proof separate
from any official semantic benchmark score. If a policy fails, produce scaffold
suggestions in `.proofloop/runs/<run-id>/model-delta.md`; do not lower the verifier
or evidence gate.

Run contract — the command must create, under `.proofloop/runs/<run-id>/`:
`scorecard.md`, `live-user-contract.json`, `node-trace-v2.json`, `node-eval.json`,
`model-comparison.json`, `cost-ledger.json`, `verifier-receipt.json`, clips, the
legacy `.proofloop/memory.jsonl` receipt, and local-first recall memory in
`.proofloop/memory/` (SQLite/FTS). Do not weaken proof gates to make the suite pass,
and do not commit generated local memory stores.

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

Any change that touches UI (src/ui/**, src/app/styles.css) must ground itself in the
design system BEFORE editing — never guess tokens, class names, or chrome:

- `npm run design:manifest` — component roles, token rules, and UI invariants (read
  this first, like a component library index).
- `npm run design:audit` — the regression gate (row stretch, mid-word wrap,
  wrong-semantics colors, missing receipt chips, undismissable chrome). Run it after
  every UI edit; it is part of `prod:gate`.
- Visual authority order: `docs/design/UI_CONTRACT.md` plus the surface taste
  contracts it names. `docs/design/DESIGN_PARITY_PLAN.md` is HISTORICAL — do not
  work its queue.
- Tokens: the canonical bundle `design-reference/assets/colors_and_type.css` is
  GITIGNORED and may be absent (it is absent right now). When absent, the tokens in
  `src/app/styles.css` are the ONLY allowed source — never introduce a hex value,
  radius, shadow, or type size not defined there. Do NOT ground in `.design-ref/`
  (an older bundle with a different layout). Re-export via the Design connector only
  for specimen-parity work.
- When adopting from a design specimen, decide KEEP / REFINE / REJECT per property —
  do not lift exact CSS wholesale.
- Rules of the visual language: default state shows data, hover shows apparatus
  (desktop); what desktop reveals on hover, mobile reveals in a bottom sheet.
  Terracotta = agent provenance + selection; green = success semantics ONLY;
  amber = needs review.
- Visual claims require rendered proof (screenshot or DOM assertions against the
  built preview), never build-success alone. The reliable capture/verify recipe is
  `docs/qa/BROWSER_VERIFY.md`.

## Local harness (not on a fresh clone)

- `.claude/` (hooks, reviewer agents, most skills) and `.proofloop/` runtime state
  are GITIGNORED — they exist only on this machine. A fresh clone or CI run has none
  of that enforcement; do not assume a hook will catch you elsewhere.
- The block between the `proofloop-agent-friendly` markers in this file (and in
  AGENTS.md) is generator-owned by the ProofLoop CLI `init` command
  (src/eval/proofloopAgentFriendlyCli.ts). Hand edits inside the markers are lost on
  regeneration; edit outside them.

## Memory hygiene

- `npm run proofloop -- memory doctor` verifies the local-first recall layer;
  `npm run proofloop -- memory search "<query>"` inspects compacted proof episodes.
  Generated `.proofloop/memory/` stores stay local and uncommitted.
- Cross-session memories go stale. Before acting on a memory that names a file, flag,
  deployment, or command, verify it still exists — a stale deploy-topology memory
  once pointed deploys at a read-only standby.
