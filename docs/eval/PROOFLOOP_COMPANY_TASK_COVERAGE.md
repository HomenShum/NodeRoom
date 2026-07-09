# Proof Loop Company Task Coverage

Generated: 2026-07-08T21:36:22.754Z

This ledger answers whether NodeRoom covers the task types named in company comparisons, without pretending we tested closed third-party apps.

## Summary

- Company/task entries tracked: 7
- Own product or same-archetype entries: 6
- Prod browser proven entries: 2
- Prod runtime proven entries: 3
- Ready for prod browser proof: 5
- Partial entries: 0
- Permission/closed external targets: 1
- Distinct task types tracked: 38

## Policy

- Track company-named requests as task archetypes unless the third-party app is explicitly consented and reachable.
- Prod browser proof is a separate gate from local browser proof and production API/runtime proof.
- A same-task-archetype proof can show NodeRoom can do the work; it must not claim the third-party product was tested.
- Closed or permission-gated external apps are external target blockers, not NodeRoom capability blockers.
- Every covered archetype should name the command that reruns its prod UI live-browser proof.

## Coverage

| Entry | Target | NodeRoom coverage | Prod browser | External claim | Next blocker |
|---|---|---:|---:|---:|---|
| `proximitty-commercial-lending` | own_product | local_browser_proven | ready_for_prod_browser | not_applicable | Latest Proximitty live-user contract is not a noderoom.live prod-browser run. |
| `generic-ai-underwriting` | same_task_archetype | local_browser_proven | ready_for_prod_browser | not_applicable | Latest Proximitty live-user contract is not a noderoom.live prod-browser run. |
| `liveflow-accounting-fpa` | same_task_archetype | prod_runtime_proven | prod_browser_proven | not_applicable | Proof Loop covers the same task type; it does not test LiveFlow's production app without permission. |
| `rogo-finance-research-copilot` | same_task_archetype | prod_runtime_proven | ready_for_prod_browser | not_applicable | Rogo-style company research has production runtime proof, but no checked-in prod UI live-browser receipt for this exact task archetype. |
| `jpm-ask-david-research-agent` | closed_external | prod_runtime_proven | ready_for_prod_browser | blocked_external | Rogo-style company research has production runtime proof, but no checked-in prod UI live-browser receipt for this exact task archetype. |
| `notion-sdr-bdr-workflow` | own_product | ready_for_prod_browser | ready_for_prod_browser | not_applicable | No checked-in prod UI live-browser receipt is dedicated to the Notion SDR/BDR task set. |
| `external-finance-benchmark-adapters` | same_task_archetype | prod_browser_proven | prod_browser_proven | blocked_external | Official score receipts still need official-output artifacts and/or upstream scorer material; proxy judges can be used for Proof Loop product gates but not official leaderboard claims. |

## Task Detail

### Proximitty / commercial lending AI

- Entry id: `proximitty-commercial-lending`
- Product surface: Proximitty synthetic underwriting Proof Loop suite
- Task types: document ingestion; financial spreading; credit analysis; covenant and risk monitoring; underwriting packet generation; borrower servicing workplan
- NodeRoom command: `npm run proofloop:proximitty`
- Prod browser command: `PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 npm run proofloop:proximitty`
- Evidence: `.proofloop/runs/latest/run-result.json`, `.proofloop/runs/latest/live-user-contract.json`
- Blockers: Latest Proximitty live-user contract is not a noderoom.live prod-browser run.; Synthetic evaluation-only underwriting suite; do not claim a real lending, insurance, legal, or credit decision.
- Sources: https://www.proximitty.ai/, https://www.ycombinator.com/companies/proximitty
- Notes: This is our controlled product archetype for commercial-lending AI workflows.

### Generic AI underwriting platform

- Entry id: `generic-ai-underwriting`
- Product surface: NodeRoom underwriting task archetype via Proximitty suite
- Task types: submission intake; risk attribute extraction; guideline comparison; third-party summary; terms or memo drafting; human underwriter review packet
- NodeRoom command: `npm run proofloop:proximitty`
- Prod browser command: `PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 npm run proofloop:proximitty`
- Evidence: `.proofloop/runs/latest/run-result.json`, `.proofloop/runs/latest/live-user-contract.json`
- Blockers: Latest Proximitty live-user contract is not a noderoom.live prod-browser run.; A named third-party underwriting app requires permission/API/browser access before Proof Loop can test that app itself.
- Sources: https://www.intellectai.com/the-rise-of-ai-expert-agents-revolutionizing-insurance-underwriting/, https://www.automationanywhere.com/solutions/agentic-solutions/loan-underwriting
- Notes: The capability is covered as an archetype; specific vendor-app testing is permission-gated.

### LiveFlow-style accounting and FP&A automation

- Entry id: `liveflow-accounting-fpa`
- Product surface: NodeRoom accounting and live-accounting Proof Loop suites
- Task types: book close support; account reconciliation; AR follow-up; journal entry drafting; spreadsheet FP&A reporting; consolidation and budget updates
- NodeRoom command: `npm run proofloop:live:accounting`
- Prod browser command: `PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/accounting/live.accounting.config.json BENCH_BASE_URL=https://noderoom.live BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts`
- Evidence: `.proofloop/live/latest/run-result.json`, `proofloop/accounting/live.accounting.config.json`
- Browser evidence: `docs/eval/proofloop-live-room-proof.json`
- Blockers: Proof Loop covers the same task type; it does not test LiveFlow's production app without permission.
- Sources: https://liveflow.com/, https://liveflow.com/blog/modern-financial-planning-tools-streamlining-your-finance-workflow
- Notes: The production runtime proof records real Convex jobs, resolved models, durations, and pass patterns. The full serial prod UI suite has a passing receipt.

### Rogo-style finance research copilot

- Entry id: `rogo-finance-research-copilot`
- Product surface: NodeRoom professional GTM/company-research evals plus BankerToolBench finance tasks
- Task types: company research; market map enrichment; financial data synthesis; investment memo drafting; workflow orchestration over finance data sources
- NodeRoom command: `npm run eval:professional:proofs`
- Prod browser command: `PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/notion/live.notion.config.json BENCH_BASE_URL=https://noderoom.live BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts`
- Evidence: `docs/eval/professional-proof-ledger.json`, `docs/eval/professional-live-runtime.json`, `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`
- Blockers: Rogo-style company research has production runtime proof, but no checked-in prod UI live-browser receipt for this exact task archetype.; Testing Rogo's actual app requires Rogo-controlled access or explicit consent.
- Sources: https://rogo.ai/, https://rogo.ai/product, https://openai.com/index/rogo/
- Notes: This row is a task-type claim about NodeRoom, not a third-party app test claim.

### JPM Ask David-style investment research agent

- Entry id: `jpm-ask-david-research-agent`
- Product surface: NodeRoom finance research and multi-agent task archetypes
- Task types: multi-agent investment research; structured data query; document retrieval and synthesis; portfolio or market insight generation; human-in-the-loop review
- NodeRoom command: `npm run eval:professional:proofs`
- Prod browser command: `PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/notion/live.notion.config.json BENCH_BASE_URL=https://noderoom.live BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts`
- Evidence: `docs/eval/professional-proof-ledger.json`, `docs/eval/professional-live-runtime.json`, `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`
- Blockers: Rogo-style company research has production runtime proof, but no checked-in prod UI live-browser receipt for this exact task archetype.; Ask David is an internal/closed JPM system; Proof Loop cannot test that app without JPM-provided access and authorization.
- Sources: https://www.jpmorganchase.com/about/technology/research/ai, https://www.youtube.com/watch?v=yMalr0jiOAc
- Notes: NodeRoom can cover the research-agent task type; it cannot claim JPM internal app testing.

### Notion-style SDR/BDR workflow automation

- Entry id: `notion-sdr-bdr-workflow`
- Product surface: NodeRoom Notion SDR/BDR Proof Loop suite
- Task types: warm intro drafting; follow-up generation; pipeline automation; meeting prep; account workplan update
- NodeRoom command: `npm run proofloop:notion`
- Prod browser command: `PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/notion/live.notion.config.json BENCH_BASE_URL=https://noderoom.live BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts`
- Evidence: `proofloop/notion/proofloop.notion.config.json`, `proofloop/notion/live.notion.config.json`
- Blockers: No checked-in prod UI live-browser receipt is dedicated to the Notion SDR/BDR task set.; Product workflow suite, not a public official benchmark score.
- Sources: proofloop/notion/proofloop.notion.config.json
- Notes: Included because prior company-task discussion covered SDR/BDR automation as a Proof Loop lane.

### Finch, FinAuditing, and WorkstreamBench task archetypes

- Entry id: `external-finance-benchmark-adapters`
- Product surface: NodeRoom external finance benchmark adapters
- Task types: financial workflow execution; financial audit prediction; spreadsheet workstream representation; official-output artifact export; proxy judge or official scorer handoff
- NodeRoom command: `npm run benchmark:proofloop:external-adapter-live-room -- --prod --user-emulation strict`
- Prod browser command: `npm run benchmark:proofloop:external-adapter-live-room -- --prod --user-emulation strict`
- Evidence: `docs/eval/proofloop-external-adapter-live-room-runs/finch.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json`, `docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json`, `docs/eval/proofloop-external-adapter-runs/finch.json`, `docs/eval/proofloop-external-adapter-runs/finauditing.json`, `docs/eval/proofloop-external-adapter-runs/workstreambench.json`
- Browser evidence: `docs/eval/proofloop-external-adapter-live-room-runs/finch.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json`, `docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json`, `docs/eval/proofloop-external-adapter-runs/finch.json`, `docs/eval/proofloop-external-adapter-runs/finauditing.json`, `docs/eval/proofloop-external-adapter-runs/workstreambench.json`
- Blockers: Official score receipts still need official-output artifacts and/or upstream scorer material; proxy judges can be used for Proof Loop product gates but not official leaderboard claims.
- Sources: proofloop/benchmarks/finch/adapter.json, proofloop/benchmarks/finauditing/adapter.json, proofloop/benchmarks/workstreambench/adapter.json
- Notes: This row is where cheaper proxy judges can keep product Proof Loop moving while official scorer imports remain separate.
