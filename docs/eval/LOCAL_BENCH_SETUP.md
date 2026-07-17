# Local Benchmark Setup Recipes

These recipes keep Finch, FinAuditing, and WorkstreamBench in the ProofLoop split:
local setup prepares fixtures and provider endpoints, while certification still runs
through the live-room adapter and writes immutable receipts.

## Shared Setup

1. Run read-only health checks:

   ```bash
   npm run proofloop -- doctor --json
   npm run proofloop -- manifest --dense
   ```

2. Configure provider receipts when a lane needs live services:

   ```bash
   npm run proofloop -- providers setup all --strict
   npm run proofloop -- providers setup nebius --strict
   ```

   Common env:

   ```bash
   NEBIUS_API_KEY=...
   NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
   BUTTERBASE_API_URL=...
   NEO4J_URI=bolt+s://...
   NEO4J_USERNAME=...
   NEO4J_PASSWORD=...
   ROCKETRIDE_API_KEY=...
   DAYTONA_API_KEY=...
   COGNEE_LOCAL_PATH=...
   ```

3. Optional Nebius smoke after credentials are present:

   ```bash
   npm run nebius:smoke-test
   ```

4. Keep generated setup/run state out of commits. Expected local output lives under
   `.proofloop/setup/`, `.proofloop/runs/`, and `.proofloop/memory/`.

## Finch

Adapter: `proofloop/benchmarks/finch/adapter.json`

```bash
npm run proofloop -- setup finch --allow-download
npm run benchmark:proofloop:adapter-blockers -- --id finch --strict
npm run benchmark:proofloop:external-adapter-live-room -- --id finch --prod --user-emulation strict --cockpit
```

The pinned full judge runner uses Finch's canonical `gpt-5-mini` judge, prompt,
request payload, and parser at commit
`95a8b8d135a528b325be003e54c55f886a22602d`. The ACL paper calibrates this judge
against human labels. Direct OpenAI is the preferred transport-equivalent path;
the released Azure transport remains supported. Free-router frontier judges are
useful disagreement evidence, but they do not replace the canonical score.

```bash
export OPENAI_API_KEY="<secret>"

# Bounded transport/parser probe. This receipt is intentionally not promotable.
npm run benchmark:finch:canonical-judge -- --limit 1 --max-calls 1 --allow-provider-spend --max-provider-cost-usd 1

# Resume the exact 172-row input after approving a provider-cost ceiling.
npm run benchmark:finch:canonical-judge -- --resume --max-calls 516 --allow-provider-spend --max-provider-cost-usd <approved-cap>

npm run benchmark:proofloop:promote-official-score -- --id finch --judge-receipt .tmp/official-benchmarks/finch-official/finch-judge-receipt.json
npm run benchmark:proofloop:adapter-blockers -- --id finch --strict
```

No Azure resource or deployment is required. The released Azure path is kept
only for upstream compatibility and can be selected with `--provider azure_openai` plus
`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`,
`AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY`.

For zero-cost disagreement analysis, run the multimodal-aware OpenRouter free
router into separate shadow artifacts. The router records the actual model used
for every response and its receipt is structurally non-promotable:

```bash
npm run benchmark:finch:shadow-judge -- --limit 1 --max-calls 3 --allow-provider-spend --max-provider-cost-usd 1 \
  --judge-output .tmp/official-benchmarks/finch-shadow/finch-judge-results.jsonl \
  --results-xlsx .tmp/official-benchmarks/finch-shadow/results.xlsx \
  --receipt-out .tmp/official-benchmarks/finch-shadow/finch-shadow-receipt.json
```

The free route is availability-dependent and remains subject to OpenRouter
daily quotas and the current pool of image-capable endpoints. Its completion
reserve is capped at 8,192 tokens so Finch's released 128k reserve does not
consume a free endpoint's entire context window.

The runner refuses calls without `--allow-provider-spend`, enforces both a
whole-run cap and a per-attempt reserve (including failed/retried calls), writes
raw JSONL plus `results.xlsx`, and resumes only when both task id and canonical
task-record SHA-256 match. Promotion
rejects free-router/frontier substitutions and accepts only the released Azure
path or the recorded direct-OpenAI transport-equivalent path using the canonical
GPT-5-mini model, pinned prompt/parser, zero parse errors, and `172/172` coverage.

Required certification artifacts:

- `live-user-contract.json`
- `node-trace-v2.json`
- `node-eval.json`
- `scorecard.md`
- `cost-ledger.json`
- `verifier-receipt.json`
- `official-scorer-receipt.json`
- `visual-proof`
- `exported-files-reopen-proof.json`

## FinAuditing

Adapter: `proofloop/benchmarks/finauditing/adapter.json`

```bash
npm run proofloop -- setup finauditing --allow-download
npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict
npm run benchmark:proofloop:external-adapter-live-room -- --id finauditing --prod --user-emulation strict --cockpit
```

Required certification artifacts:

- `live-user-contract.json`
- `node-trace-v2.json`
- `node-eval.json`
- `scorecard.md`
- `cost-ledger.json`
- `verifier-receipt.json`
- `official-scorer-receipt.json`
- `visual-proof`
- `exported-files-reopen-proof.json`

## WorkstreamBench / MBABench

Adapter: `proofloop/benchmarks/workstreambench/adapter.json`

Public artifact discovery is locked in
`docs/eval/proofloop-official-task-bundles/workstreambench.json`:

- arXiv: MBABench v4, `https://arxiv.org/abs/2605.22664`
- repository/scorer/rubric: `https://github.com/namkoong-lab/MBABench`
  at `c56319bea67fa5bfea8ed8010e93a88e1b8877e5`
- public ModelOff task dataset:
  `https://huggingface.co/datasets/namkoong-lab/mbabench-modeloff`
  at `867fb5395b8e3fc28606dc681ba5ea284340ddd2`
- no-provider scorer readiness smoke:
  `python judge/main_scripts/judge.py -f judge/scratch/test_cases/Bread_And_Butter --nocall`

The no-provider smoke only proves extraction/scorer wiring readiness. Do not claim
an official MBABench score until NodeRoom official-format case folders exist and
the upstream LLM judge has produced an accepted scored receipt.

```bash
npm run proofloop -- setup workstreambench --allow-download
npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict
npm run benchmark:proofloop:external-adapter-live-room -- --id workstreambench --prod --user-emulation strict --cockpit
```

Required certification artifacts:

- `live-user-contract.json`
- `node-trace-v2.json`
- `node-eval.json`
- `scorecard.md`
- `cost-ledger.json`
- `verifier-receipt.json`
- `official-scorer-receipt.json`
- `visual-proof`
- `exported-files-reopen-proof.json`

## Failure Handling

When a run fails, ProofLoop writes a Codex relaunch packet next to the run:

```bash
npm run proofloop -- codex reprompt latest
npm run proofloop -- codex-loop <suite> --max-attempts 3
```

Use the reprompt to repair the product or harness, then rerun the same adapter
gate. Do not lower verifier thresholds, weaken immutable receipts, or promote a
scaffold proposal without outside approval.
