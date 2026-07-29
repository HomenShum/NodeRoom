# Investigation Mode

Investigation Mode is a room-native view over NodeRoom's existing NodeAgent harness. It does not introduce a second agent runtime. The pinned **Investigation** work-surface tab projects the live `Company research` sheet, room traces, agent sessions, and durable-job telemetry into deterministic analysis contracts.

## Contract flow

1. `AnalysisDatasetV1` snapshots the current research artifact version. Its identity includes canonical row values, per-cell versions/status, field-level confidence, collision-free row/entity identities, and immutable field-specific source receipts.
2. `ResearchPlanV1` compiles that dataset through `buildRoomWorkReasoningPlan`. Its five tasks are the existing intake, plan, execute, verify, and synthesize frames expressed as an explicit dependency DAG.
3. `AnalysisTaskRunV1` projects each task into `queued`, `running`, `cached`, `completed`, `blocked`, or `failed`. Every run carries dataset, dependency, cache, trace, frame, and correlated server-job provenance. `outputDigest` and `runDigest` bind the real status source and output receipt, so a cache projection cannot impersonate a server-completed job.
4. `ResearchPackV1` includes only populated research claims. A claim is `supported` only when its exact source cell carries an untampered source/upload receipt whose own `verifiedAt` remains fresh. Sourced-but-expired claims remain `stale`; manual, computed, literal-URL, legacy-unverified, and tampered evidence stays visible but cannot count as support.
5. The teaching-case view presents the same pack as a decision exercise. It never invents evidence or conclusions.

The public exports live in `src/nodeagent/investigation`.

## Validation and failure behavior

The compiler rejects duplicate dataset row/entity identities, duplicate top-level or child-frame IDs, duplicate child cache keys, unknown question or dataset references, missing dependencies, cyclic tasks, missing output schemas, dataset-version drift, plan-digest drift, empty inputs, missing entity identities, and truncated imports. Invalid inputs fail closed: no task runs or exportable research pack are produced.

Task transitions are explicit:

```text
queued -> running -> completed
queued -> cached
queued/running -> blocked -> queued
queued/running -> failed -> queued
```

Terminal `completed` and `cached` runs cannot silently restart. A retry must originate from a failed or blocked run.

## Runtime and egress

- Memory rooms call the existing deterministic `RoomStore.askResearch(intent)` harness.
- Live rooms call the existing durable `startAgentJob` research path through `RoomStore.askResearch(intent)`.
- Every launch intent binds the current plan ID/digest, dataset ID/version/content hash, artifact ID/version, and a fresh explicit public-source approval.
- The server recomputes the current dataset and plan, rejects drift/expired consent, derives the approving actor, replaces the intent with a server-attested receipt, canonicalizes the research goal/mode, and expands every authorized row into its eight intended research cell IDs. This includes sparse cells that do not exist yet, is capped at 8,192 IDs, and fails closed above that bound.
- Investigation writes remain limited to the existing RoomTools CAS/lock paths, but their executable mutation intersection contains only `write_locked_cell_result` and `write_locked_cell_results`. The scalar write tools are excluded, and the Convex mutation boundary independently requires a fresh, untampered source/upload evidence seal for every non-delete investigation write.
- Durable room activity is attributed to the current Investigation workspace only when its untampered receipt exactly matches the current plan and dataset. Artifact-title, goal-text, generic room-session, and room-wide telemetry heuristics are never treated as proof of investigation progress.
- A terminal `resultDigest` is persisted only when the terminal mutation can resolve a finalized `agentRuns` row belonging to the exact job and room. Its digest binds the authorization receipt, terminal state, execution telemetry, current artifact version, and latest mutation receipt. Read queries return that stored value verbatim and never synthesize missing terminal proof.

## Verification

Run:

```powershell
npx vitest run tests/investigationMode.test.ts tests/investigationSurface.test.tsx tests/artifactsPseudoTabPersistence.test.tsx tests/agentJobsRuntime.test.ts
npm run nodeagent:frame:smoke
npm run omnigent:nodeagent:smoke
npm run design:audit
npm run floor
npm run build
```

For UI-only browser proof, build first, serve the Vite preview on port `5260`, enter a memory demo room, open the pinned **Investigation** tab, and verify the dataset identity, plan validation, five task rows, research pack, teaching-case switch, and zero document overflow or console errors.

A memory preview is not durable-runtime proof. A terminal 5/5 live claim additionally requires a configured local frontend connected to a real durable Convex backend, a fresh consented launch, the exact persisted `request.investigation` receipt, correlated server job/run IDs, terminal server `resultDigest`, and the resulting output/pack receipts. If that backend is unavailable, the proof must remain blocked rather than substituting memory state.
