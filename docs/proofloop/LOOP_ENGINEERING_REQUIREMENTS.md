# Proofloop Loop Engineering Ledger

This ledger preserves the two pasted source texts and maps them to repo artifacts that can be checked repeatedly.

## Saved Sources

- `docs/proofloop/source-texts/noderl-loop-engineering-source.txt`
- `docs/proofloop/source-texts/accounting-profile-router-source.txt`

## Requirements And Proofs

| Requirement | Status | Repo Proof |
| --- | --- | --- |
| NodeTrace v2 merges inner trace, outer browser/user trace, artifact state, evidence, visual judge, verifier, cost, and latency into one trajectory. | Implemented | `src/eval/proofloopArtifacts.ts`, `src/eval/proofloopLoopArtifacts.ts`, `tests/proofloopArtifacts.test.ts` |
| NodeEval v1 scores task completion, UI state, visual quality, evidence grounding, cost, latency, safety, total, and failure categories. | Implemented | `src/eval/proofloopArtifacts.ts`, `tests/proofloopLoopArtifacts.test.ts` |
| CLI loop commands exist: `eval`, `mem write`, `storybook`, `repair`, `rerun`, `storyboard`, `clips`, `release-video`, `lagging`, and `router suggest`. | Implemented | `scripts/proofloop-cli.ts`, `tests/proofloopPipeline.test.ts` |
| Failed runs produce repair prompts with exact failure, evidence paths, screenshots, trace step, artifact state, smallest fix, and regression direction. | Implemented | `src/eval/proofloopArtifacts.ts`, `tests/proofloopArtifacts.test.ts` |
| Proofloop memory writes success/failure, task/model/harness, cost, reward, repair action, and receipt refs. | Implemented | `src/eval/proofloopLoopArtifacts.ts`, `scripts/proofloop-cli.ts`, `tests/proofloopLoopArtifacts.test.ts` |
| Trace Storybook renders from trace JSON only using compact atoms. | Implemented | `src/eval/proofloopArtifacts.ts`, `trace-storybook.html` output, `tests/proofloopArtifacts.test.ts` |
| Strict live-user contract blocks benchmark claims without live/staging URL, fresh browser/workspace, public UI path, visible agent progress, artifacts, reopen proof, official/task verifier, visual proof, cost/latency, trace, receipt, and clean console/page state. | Implemented | `src/eval/proofloopLoopArtifacts.ts`, `live-user-contract.json`, `tests/proofloopLoopArtifacts.test.ts` |
| Product path completion is tracked separately from official semantic score. | Implemented | `live-user-contract.json` uses `productPathCompletion`, `officialSemanticScore`, and `scoreType` |
| Benchmark adapter folders exist for BankertoolBench, Finch, FinAuditing, and WorkstreamBench. | Implemented | `proofloop/benchmarks/*/adapter.json`, `tests/proofloopPipeline.test.ts` |
| Media layer produces storyboard, lagging-layer report, clip manifest, release-video renderer, and social copy. | Implemented | `src/eval/proofloopLoopArtifacts.ts`, `scripts/proofloop-cli.ts`, `remotion/Episode.tsx` |
| Router suggestion separates planner, mechanical worker, visual judge, verifier, and escalation rules. | Implemented | `router-suggestion.json` output from `proofloop router suggest latest` |
| Accounting/product/collab gates cover fresh room, uploads, public chat, stream, focus/trace, spreadsheet/notebook blocks, no clobber, reviewable proposals, export reopen, and evidence links. | Implemented in proofloop gates | `proofloop/accounting`, `proofloop/notion`, `src/eval/proofloopLoopArtifacts.ts` |
| ProfileResearchPacket schema covers subject, ontology, dossier, evidence, spreadsheet rows, notebook blocks, and graph nodes. | Implemented | `src/noderl/loop/types.ts`, `tests/nodeLoopRuntime.test.ts` |
| Fusion router v0 supports routing features, route plans, bounded costs/attempts, escalation policy, and reward-aware follow-up. | Implemented | `src/noderl/loop/fusionRouter.ts`, `src/noderl/loop/rewardBuilder.ts`, `tests/nodeLoopRuntime.test.ts` |
| NodeLoopRuntime v1 has loop policy, registry, attempt ledger, failure taxonomy, evaluator, strategy delta, reward builder, memory writer, and fusion router modules. | Implemented | `src/noderl/loop/`, `tests/nodeLoopRuntime.test.ts` |
| The exact 20 loop patterns are machine-readable and mapped to NodeAgent, NodeMem, NodeTrace, NodeEval, NodeRL, and Fusion Router layers. | Implemented | `src/noderl/loop/types.ts`, `src/noderl/loop/loopRegistry.ts` |
| NodeRoom-specific Convex loop contracts exist for attempts, rewards, and policies. | Implemented | `convex/loopAttempts.ts`, `convex/loopRewards.ts`, `convex/loopPolicies.ts`, `tests/loopContractsAndPanels.test.tsx` |
| NodeRoom-specific React trace panels exist for Trace Storybook and Loop Reward Panel. | Implemented | `src/ui/trace/TraceStorybook.tsx`, `src/ui/trace/LoopRewardPanel.tsx`, `tests/loopContractsAndPanels.test.tsx` |

## External Research Anchors

- Higgsfield 2026 creator workflows: multi-model storyboard and iteration workflow for short-form proof clips.
- StoryAgent: multi-agent story design, storyboard generation, video creation, coordination, and evaluation pattern.
- Finch: spreadsheet-heavy finance workflow benchmark with 172 workflows, 384 tasks, and 1,710 spreadsheets.
- FinAuditing: XBRL-backed auditing benchmark with FinSM, FinRE, and FinMR subtasks.
- WorkstreamBench: end-to-end finance spreadsheet workstream benchmark.

## Hard Rule

No live-user proof, no benchmark claim.
