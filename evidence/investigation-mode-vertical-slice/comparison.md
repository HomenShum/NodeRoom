# Before/after comparison

Observable: the live-room work surface had no Investigation report and the source tree had no `ResearchPlanV1` lifecycle contract.

| Check | Before | After |
| --- | --- | --- |
| Pinned Investigation surface | `investigationCount: 0` | Exactly one `investigation-tab` and one `investigation-report` |
| Analysis identity | No versioned analysis dataset | `AnalysisDatasetV1` version id and content hash rendered from the live `Company research` artifact |
| Execution model | No visible investigation lifecycle | Five validated NodeAgent phase tasks with queued/running/cached/completed/blocked/failed states |
| Evidence output | No research pack | Downloaded JSON contains dataset, plan, five task runs, research pack, and teaching case |
| Freshness honesty | No investigation freshness view | Sourced-but-expired claims render as `stale`, remain in Review, and create explicit refresh questions |
| Runtime proof | Not applicable | Clicking the real memory-room action produced an observed `running` state and advanced the dataset from `v1-3496c89a` to `v37-5b44f6f4` |
| Sparse write scope | Only a partial row scope could reach the durable runner | Every row expands to the eight authorized research fields, with an 8,192-write admission cap |
| Write authorization | Element scoping did not seal the evidence payload contract | Only evidence-bearing result tools are allowed and Convex revalidates `sealed_cell_payload_v1` |
| Terminal attestation | Read paths could derive a result identity without a persisted terminal receipt | `resultDigest` is persisted from the exact finalized run and never synthesized by queries |
| Horizontal overflow | 0 px | 0 px |
| Console/page errors | 0 | 0 |

Final post-rebase verification:

- Focused scenario suite: 6 files, 111 tests passed
- Repository floor: 374 files, 2,589 tests passed
- Product-memory browser gate: 29 scenarios passed
- Root and Convex typechecks, design audit, production build, and dist security gate passed
- `npm audit` remains blocked by the unchanged origin/main lockfile baseline (9 high, 1 critical); this branch has no dependency-manifest or lockfile delta

Artifacts:

- `before-room.png`
- `after-room.png`
- `after-teaching-case.png`
- `after-room-complete.png`
- `after-research-pack.json`
- `mobbin-reference-trace.md`
- `before-ui.txt`
- `after-ui.txt`
