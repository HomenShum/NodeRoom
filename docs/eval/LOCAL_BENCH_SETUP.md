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

## WorkstreamBench

Adapter: `proofloop/benchmarks/workstreambench/adapter.json`

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
