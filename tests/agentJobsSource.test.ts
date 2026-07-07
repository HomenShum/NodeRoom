import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("long-running agent job source invariants", () => {
  it("schedules continuation inside finishSlice, not after the action checkpoint returns", () => {
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");

    expect(jobs).toContain("export const finishSlice");
    expect(jobs).toContain("const delayMs = Math.max(0, Number(patch.nextRunAt) - now)");
    expect(jobs).toContain("ctx.scheduler.runAfter(delayMs, internal.agentJobRunner.runFreeAutoJobSlice");
    expect(runner).not.toContain("ctx.scheduler.runAfter(DEFAULT_RESUME_DELAY_MS");
    expect(runner).not.toContain("ctx.scheduler.runAfter(delayMs");
  });

  it("has user-operable cancel and retry states for the featured free-auto path", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");

    expect(schema).toContain('v.literal("cancelled")');
    expect(jobs).toContain("export const cancel");
    expect(jobs).toContain("export const retry");
    expect(jobs).toContain('status: "queued"');
  });

  it("starts free-auto through Convex Workflow while preserving scheduler fallback for old jobs", () => {
    const config = readFileSync("convex/convex.config.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const workflows = readFileSync("convex/agentWorkflows.ts", "utf8");

    expect(config).toContain("@convex-dev/workflow");
    expect(config).toContain("@convex-dev/workpool");
    expect(jobs).toContain('runtime: "workflow"');
    expect(jobs).toContain("startWorkflow(ctx, internal.agentWorkflows.freeAutoWorkflow");
    expect(jobs).toContain("workflow_start_failed");
    expect(jobs).toContain('job.runtime === "workflow"');
    expect(workflows).toContain("new WorkflowManager(components.workflow");
    expect(workflows).toContain("MAX_WORKFLOW_SLICES");
    expect(workflows).toContain("One workflow invocation owns one long-running slice");
    expect(jobs).toContain("agentWorkflows.freeAutoWorkflow.continue");
    expect(jobs).toContain('job.status === "paused" || job.status === "retrying"');
    expect(jobs).toContain('resultKind === "success" && job.status === "queued"');
    expect(jobs).toContain("agentJobs.finishSlice.workflowSchedulerFallback");
    expect(jobs).toContain('job.status === "running" && job.attempts > 1');
  });

  it("expands spreadsheet locks through formula dependency records", () => {
    const locks = readFileSync("convex/locks.ts", "utf8");
    const index = readFileSync("convex/spreadsheetIndexLib.ts", "utf8");

    expect(locks).toContain("expandElementIdsWithSpreadsheetDependencies");
    expect(locks).toContain("expanded to");
    expect(index).toContain("spreadsheetDependencies");
    expect(index).toContain("by_parent");
  });

  it("uses agentJobs as the durable root for interactive and free agent requests", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const runs = readFileSync("convex/agentRuns.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const schema = readFileSync("convex/schema.ts", "utf8");
    const store = readFileSync("src/app/store.tsx", "utf8");

    expect(agent).toContain('makeFunctionReference<"mutation">("agentJobs:createOrReuse")');
    expect(agent).toContain('makeFunctionReference<"mutation">("agentJobs:finishInteractive")');
    expect(agent).toContain("jobId, roomId");
    expect(runs).toContain('jobId: v.optional(v.id("agentJobs"))');
    expect(jobs).toContain("export const start = mutation");
    expect(jobs).toContain("startDurableAgentJob");
    expect(jobs).toContain("routePolicyV");
    expect(jobs).toContain("runtimePolicyV");
    expect(jobs).toContain('execution === "inline" ? "agentJobs.createOrReuse" : "agentJobs.start"');
    expect(store).toContain("useMutation(api.agentJobs.start)");
    expect(store).not.toContain("useMutation(api.agentJobs.startFreeAuto)");
    expect(store).toContain('routePolicy: "fast_default"');
    expect(store).toContain('routePolicy: "free_auto"');
    expect(jobs).toContain("export const createOrReuse");
    expect(jobs).toContain("idempotencyKey");
    expect(schema).toContain('entrypoint: v.optional(entrypointV)');
    expect(schema).toContain('scope: v.optional(agentScopeV)');
    expect(schema).toContain('routePolicy: v.optional(routePolicyV)');
    expect(schema).toContain('runtimePolicy: v.optional(runtimePolicyV)');
    expect(schema).toContain('runtimeProfile: v.optional(runtimeProfileV)');
  });

  it("supports benchmark-completion limits by explicit flag, focus mode, or benchmark goal inference", () => {
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const store = readFileSync("src/app/store.tsx", "utf8");
    const spec = readFileSync("e2e/benchmark-ui-spreadsheetbench.spec.ts", "utf8");

    expect(jobs).toContain('v.literal("benchmark_completion")');
    expect(jobs).toContain("function inferredRuntimeProfileForGoal");
    expect(jobs).toContain("runtimeProfile = a.runtimeProfile ?? inferredRuntimeProfileForGoal(a.goal)");
    expect(jobs).toContain("runtimeProfile: job.runtimeProfile");
    expect(jobs).toContain('defaultMaxAttempts = runtimeProfile === "benchmark_completion" ? 1000');
    expect(runner).toContain("function maxStepsForJob");
    expect(runner).toContain("BENCHMARK_AGENT_MAX_STEPS_PER_SLICE");
    expect(runner).toContain("FREE_AUTO_JOB_MAX_STEPS_PER_SLICE");
    expect(runner).toContain("defaultMaxStepsForEntrypoint(entrypoint), 1, 256");
    expect(runner).toContain("BENCHMARK_AGENT_MAX_TOKENS_PER_SLICE");
    expect(runner).toContain("BENCHMARK_AGENT_MAX_USD_PER_SLICE");
    expect(store).toContain("noderoom.nodeagentRuntimeProfile");
    expect(store).toContain('focusMode === "1" || focusMode === "true"');
    expect(store).toContain("maxAttemptsForRuntimeProfile");
    expect(spec).toContain('window.localStorage.setItem("noderoom.nodeagentRuntimeProfile", "benchmark_completion")');
  });

  it("keeps /ask model policy during workflow handoff while allowing /free overrides", () => {
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");

    expect(runner).toContain('modelPolicy === "openrouter/free-auto"');
    expect(runner).toContain("process.env.FREE_AUTO_JOB_MODEL ?? modelPolicy");
    expect(runner).toContain("const model = agentModel(resolvedModelPolicy, { entrypoint })");
    expect(runner).toContain("function runnerEntrypoint");
    expect(runner).toContain("defaultMaxStepsForEntrypoint(entrypoint)");
    expect(jobs).toContain("artifactMeta: art.meta");
  });

  it("enforces provider route receipts and private-stream egress gates", () => {
    const model = readFileSync("src/nodeagent/models/convexModel.ts", "utf8");
    const streaming = readFileSync("convex/streaming.ts", "utf8");
    const streamingModel = readFileSync("convex/streamingModel.ts", "utf8");
    const agent = readFileSync("convex/agent.ts", "utf8");

    expect(model).toContain("assertProviderRouteAllowed");
    expect(model).toContain("providerRoute");
    expect(agent).toContain('{ entrypoint: "public_ask" }');
    expect(agent).toContain('{ entrypoint: "private_agent" }');
    expect(streaming).toContain("assertProviderEgressAllowed");
    expect(streaming).toContain('entrypoint: "private_agent"');
    expect(streamingModel).toContain("private_stream_provider_unsupported");
  });

  it("preflights every readable room artifact before provider-backed public/free runs", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const artifacts = readFileSync("convex/artifacts.ts", "utf8");

    expect(agent).toContain("function providerEgressArtifactsFromRoomState");
    expect(agent).toContain("roomState.artifacts.map");
    expect(runner).toContain('makeFunctionReference<"query">("artifacts:listForRoom")');
    expect(runner).toContain("roomArtifacts.map");
    expect(artifacts).toContain("meta: a.meta");
  });

  it("blocks uploaded-file free jobs unless paid file-egress promotion is explicit", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const env = readFileSync(".env.example", "utf8");

    for (const source of [agent, jobs, runner]) {
      expect(source).toContain("FREE_FILE_EGRESS_BLOCK_REASON");
      expect(source).toContain("configuredFileEgressModel");
      expect(source).toContain("AGENT_FILE_EGRESS_MODEL");
      expect(source).toContain("providerEgressDecision");
    }
    expect(jobs).toContain("freeFileEgressPromotionAllowed(process.env)");
    expect(jobs).toContain("freeFileEgressPromotionBlocked");
    expect(jobs).toContain('blockedReason = `provider_egress_blocked:${FREE_FILE_EGRESS_BLOCK_REASON}`');
    expect(runner).toContain("freeFileEgressPromotionAllowed(process.env)");
    expect(runner).toContain("providerEgressBlock");
    for (const source of [jobs, runner]) expect(source).toContain('entrypoint = "public_ask"');
    expect(agent).toContain("modelNameForEgress");
    expect(jobs).toContain('routePolicy = "explicit"');
    expect(jobs).toContain("fileEgressPromoted");
    expect(jobs).toContain('room?.autoAllow === false ? "host_review" : "auto_commit_safe"');
    expect(runner).toContain("isProviderNonRetryableError");
    expect(runner).toContain("const retryable = !isProviderNonRetryableError(rootError)");
    expect(runner).toContain('title: canRetry ? "Agent slice failed; retry scheduled" : retryable ? "Agent job failed" : "Agent route blocked"');
    expect(env).toContain("AGENT_FILE_EGRESS_MODEL=z-ai/glm-4.7-flash");
    expect(env).toContain("FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION=0");
  });

  it("does not assume provider-produced batch tool args always carry an ops array", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");

    for (const source of [agent, runner]) {
      expect(source).toContain("const ops = (args as { ops?: unknown } | null)?.ops");
      expect(source).toContain("if (!Array.isArray(ops)) return []");
      expect(source).not.toContain(".ops ?? []).map");
    }
  });

  it("applies the server-side PlanPreview admission gate to public /ask before provider work", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");

    expect(agent).toContain("classifyIntakeMessage");
    expect(agent).toContain("buildPlanPreview");
    expect(agent).toContain("artifacts:listProposals");
    expect(agent).toContain('initialStatus: "blocked"');
    expect(agent).toContain('modelPolicy: "not_started"');
    expect(agent).toContain('stopReason: "plan_blocked"');
    expect(jobs).toContain("initialStatus: v.optional");
    expect(jobs).toContain("planPreview: v.optional(v.any())");
    expect(jobs).toContain('type: "plan_blocked"');
  });

  it("restricts long-running job controls to the requester or host", () => {
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");

    expect(jobs).toContain("actor.id !== job.requester.id && actor.id !== room.hostId");
    expect(jobs).toContain('reason: "forbidden"');
  });

  it("clamps action budgets below the Convex ceiling with reserve and safety margin", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");

    for (const source of [agent, runner]) {
      expect(source).toContain("const MIN_ACTION_RESERVE_MS = 10_000");
      expect(source).toContain("const ACTION_SAFETY_MARGIN_MS = 15_000");
      expect(source).toContain("function boundedActionBudgetMs");
      expect(source).toContain("CONVEX_ACTION_LIMIT_MS - reserveMs - ACTION_SAFETY_MARGIN_MS");
      expect(source).toContain("Math.max(MIN_ACTION_RESERVE_MS");
    }
    expect(agent).toContain("boundedActionBudgetMs(");
    expect(agent).toContain('"AGENT_ACTION_BUDGET_MS"');
    expect(runner).toContain("boundedActionBudgetMs(");
    expect(runner).toContain('"FREE_AUTO_JOB_SLICE_BUDGET_MS"');
    expect(runner).toContain("const DEFAULT_SLICE_BUDGET_MS = 7 * 60_000");
    expect(runner).toContain("const DEFAULT_RESERVE_MS = 60_000");
  });

  it("keeps production public job slices completion-oriented instead of capped at 8 steps", () => {
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");

    expect(runner).toContain('return entrypoint === "free" ? 32 : 128');
    expect(runner).toContain('envNumber("FREE_AUTO_JOB_MAX_STEPS_PER_SLICE", defaultMaxStepsForEntrypoint(entrypoint), 1, 256)');
    expect(runner).not.toContain('entrypoint === "free" ? 3 : 8');
  });

  it("registers the live starter room proof command", () => {
    const pkg = readFileSync("package.json", "utf8");
    const starter = readFileSync("scripts/live-starter-room-proof.ts", "utf8");

    expect(pkg).toContain('"proofloop:live:starter"');
    expect(starter).toContain("noderoom-live-starter-room-proof-v1");
    expect(starter).toContain("guidedTourCount");
    expect(starter).toContain("walkDockCount");
  });

  it("keeps browser-run receipts separate from canonical verifier receipts by default", () => {
    const proofloopBrowser = readFileSync("proofloop/live-browser-proof.spec.ts", "utf8");
    const btbBrowser = readFileSync("e2e/benchmark-ui-bankertoolbench.spec.ts", "utf8");
    const hmdaBrowser = readFileSync("e2e/underwriting-hmda-live.spec.ts", "utf8");

    expect(proofloopBrowser).toContain("docs/eval/browser-receipts/fresh-room");
    expect(proofloopBrowser).toContain("docs/eval/browser-receipts/proofloop-live-room-proof.json");
    expect(btbBrowser).toContain("docs/eval/browser-receipts/bankertoolbench-live-room-proof.json");
    expect(btbBrowser).toContain('"browser-receipts", "fresh-room"');
    expect(hmdaBrowser).toContain("docs/eval/underwriting-hmda-live-browser-proof.json");
  });
  it("round-trips Gemini tool-call thought signatures for resumed jobs", () => {
    const model = readFileSync("src/nodeagent/models/convexModel.ts", "utf8");
    const types = readFileSync("src/nodeagent/core/types.ts", "utf8");

    expect(types).toContain("providerMetadata?: Record<string, unknown>");
    expect(model).toContain("thoughtSignature?: string");
    expect(model).toContain("thought_signature?: string");
    expect(model).toContain("geminiThoughtSignature");
    expect(model).toContain("...(thoughtSignature ? { thoughtSignature } : {})");
  });

  it("persists provider-step journals for crash-safe model replay", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");
    const journalFns = readFileSync("convex/agentStepJournal.ts", "utf8");
    const journalClient = readFileSync("convex/agentStepJournalClient.ts", "utf8");
    const agent = readFileSync("convex/agent.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const journal = readFileSync("src/nodeagent/core/journal.ts", "utf8");

    expect(schema).toContain("agentModelStepJournal");
    expect(schema).toContain('index("by_job_slice_step", ["jobId", "sliceKey", "step"])');
    expect(journalFns).toContain("export const get = internalQuery");
    expect(journalFns).toContain("export const record = internalMutation");
    expect(journalClient).toContain("makeConvexStepJournal");
    expect(journal).toContain("journalSliceKey");
    expect(agent).toContain("journal: modelJournal");
    expect(runner).toContain("journal: modelJournal");
  });

  it("defines the operation ledger, receipts, draft operations, and first-class leases", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const artifacts = readFileSync("convex/artifacts.ts", "utf8");
    const roomTools = readFileSync("convex/convexRoomTools.ts", "utf8");
    const steps = readFileSync("convex/agentSteps.ts", "utf8");

    expect(schema).toContain("agentOperationEvents");
    expect(schema).toContain("agentStreamEvents");
    expect(schema).toContain("agentMutationReceipts");
    expect(schema).toContain("agentDraftOperations");
    expect(schema).toContain("agentLeases");
    expect(schema).toContain('kind: operationEventKindV');
    expect(schema).toContain('targetKind: graphObjectKindV');
    expect(jobs).toContain("recordOperationEvent");
    expect(jobs).toContain('ctx.db.insert("agentLeases"');
    expect(jobs).toContain('status: "released"');
    expect(artifacts).toContain('ctx.db.insert("agentMutationReceipts"');
    expect(artifacts).toContain('jobId: v.optional(v.id("agentJobs"))');
    expect(roomTools).toContain("private jobId?: Id<\"agentJobs\">");
    expect(roomTools).toContain("jobId: this.jobId");
    expect(steps).toContain("mutationReceiptIds");
    expect(steps).toContain('jobId: v.optional(v.id("agentJobs"))');
  });

  it("implements notebook graph mutations and an embedding queue/runner for the unified NodeAgent domain", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");
    const graph = readFileSync("convex/notebookGraph.ts", "utf8");
    const embeddings = readFileSync("convex/embeddings.ts", "utf8");
    const runner = readFileSync("convex/embeddingRunner.ts", "utf8");

    for (const table of ["wikiPages", "wikiRevisions", "notebooks", "nodes", "relations", "relationTypes", "embeddingJobs", "embeddings"]) {
      expect(schema).toContain(`${table}: defineTable`);
    }
    expect(schema).toContain("fromObjectKind: graphObjectKindV");
    expect(schema).toContain("toObjectKind: graphObjectKindV");
    expect(schema).toContain("positionKey: v.string()");
    expect(schema).toContain("contentHash: v.string()");
    expect(schema).toContain("vector: v.array(v.number())");
    for (const fn of ["createNotebook", "readContext", "createChildNode", "updateNodeContent", "createRelation", "reorderRelations"]) {
      expect(graph).toContain(`export const ${fn}`);
    }
    expect(graph).toContain("enqueueEmbeddingJob");
    expect(graph).toContain("agentMutationReceipts");
    for (const fn of ["enqueueForSource", "claimNext", "upsertForSource", "tombstoneForSource", "searchVisible"]) {
      expect(embeddings).toContain(`export const ${fn}`);
    }
    expect(runner).toContain("export const runOne");
    expect(runner).toContain('provider: "local"');
  });

  it("persists OKF retrieval through Convex tables, outbox, vector index, live room tool port, and Trace Lens UI", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");
    const okf = readFileSync("convex/okf.ts", "utf8");
    const indexer = readFileSync("convex/okfIndexer.ts", "utf8");
    const roomTools = readFileSync("convex/convexRoomTools.ts", "utf8");
    const store = readFileSync("src/app/store.tsx", "utf8");
    const coach = readFileSync("src/ui/artifacts/BankerCoachPanel.tsx", "utf8");

    for (const table of ["okfConcepts", "okfChunks", "okfEdges", "okfOutbox", "retrievalEvents"]) {
      expect(schema).toContain(`${table}: defineTable`);
    }
    expect(schema).toContain('.vectorIndex("by_embedding"');
    expect(okf).toContain("export const reindexRoom");
    expect(okf).toContain("export const traceLens");
    expect(okf).toContain("recordRetrievalEvent");
    expect(indexer).toContain("embedOkfText");
    expect(roomTools).toContain("this.okf = new ConvexOkfRetrievalPort");
    expect(roomTools).toContain("vectorSearch");
    expect(store).toContain("api.okf.traceLens");
    expect(coach).toContain("Trace Lens");
  });

  it("exposes a browser-readable job detail query linked to attempts, operations, reasoning frames, receipts, leases, and steps", () => {
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const store = readFileSync("src/app/store.tsx", "utf8");
    const chat = readFileSync("src/ui/Chat.tsx", "utf8");

    expect(jobs).toContain("export const detail");
    expect(jobs).toContain("agentOperationEvents");
    expect(jobs).toContain("agentReasoningFrames");
    expect(jobs).toContain("agentMutationReceipts");
    expect(jobs).toContain("agentSteps");
    expect(store).toContain("lastLongFreeJobDetail");
    expect(store).toContain("api.agentJobs.detail");
    expect(store).toContain("reasoningFrames:");
    expect(chat).toContain("r-job-detail");
    expect(chat).toContain("reasoning-frame-tree");
    expect(chat).toContain("Reasoning frames");
    expect(chat).toContain("Receipts");
  });

  it("streams workflow-sliced public agent progress through live operation rows", () => {
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const model = readFileSync("src/nodeagent/models/convexModel.ts", "utf8");
    const sdkAdapter = readFileSync("src/nodeagent/models/adapter.ts", "utf8");

    expect(runner).toContain("agentJobs:recordLiveOperation");
    expect(runner).toContain("agentJobRunner.runFreeAutoJobSlice");
    expect(runner).toContain("onTrace: (event)");
    expect(runner).toContain("liveOperationKind(event)");
    expect(model).toContain("AGENT_MODEL_MAX_OUTPUT_TOKENS");
    expect(model).toContain("chat_template_kwargs");
    expect(model).toContain("enable_thinking: false");
    expect(model).toContain("isOpenRouterHybridThinkingModel");
    expect(model).toContain("qwen\\/qwen3");
    expect(model).toContain("openAiCompatibleToolChoice");
    expect(model).toContain('choice === "required"');
    expect(sdkAdapter).toContain("sdkToolChoiceForModel");
    expect(sdkAdapter).toContain('choice === "required"');
  });

  it("streams actual public LLM text deltas through durable message streams", () => {
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const runtime = readFileSync("src/nodeagent/core/runtime.ts", "utf8");
    const frameRunner = readFileSync("src/nodeagent/core/frameRunner.ts", "utf8");
    const model = readFileSync("src/nodeagent/models/convexModel.ts", "utf8");
    const streaming = readFileSync("convex/streaming.ts", "utf8");

    expect(runtime).toContain("onTextDelta?: (text: string, step: number)");
    expect(runtime).toContain("onTextDelta: opts.onTextDelta");
    expect(frameRunner).toContain("onTextDelta: opts.onTextDelta");
    expect(model).toContain("OpenAiChatStreamChunk");
    expect(model).toContain("stream: true");
    expect(model).toContain("geminiStreamStep");
    expect(model).toContain("streamGenerateContent?alt=sse");
    expect(model).toContain("await args.onTextDelta(textDelta)");
    expect(model).toContain("await onTextDelta(delta)");
    expect(runner).toContain("streaming:ensurePublicAgentJobStream");
    expect(runner).toContain("streaming:appendPublicAgentJobStreamChunk");
    expect(runner).toContain("agentJobs:recordStreamEvent");
    expect(runner).toContain('kind: "text_delta"');
    expect(runner).toContain('kind: terminal ? "message_done" : "warning"');
    expect(runner).toContain("onPublicTextDelta");
    expect(runner).toContain("createdAt: claimed.createdAt");
    expect(streaming).toContain("createdAt: v.optional(v.number())");
    expect(streaming).toContain("existingMessage?.streamId && !existingMessage.text");
    expect(streaming).toContain("ensurePublicAgentJobStream");
    expect(streaming).toContain("appendPublicAgentJobStreamChunk");
    expect(streaming).toContain('ownerId: PUBLIC_STREAM_OWNER_ID');
    expect(streaming).toContain("components.persistentTextStreaming.lib.addChunk");
  });

  it("exposes a UIMessage-shaped unified stream beside durable job detail", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");
    const runtime = readFileSync("src/nodeagent/core/runtime.ts", "utf8");
    const frameRunner = readFileSync("src/nodeagent/core/frameRunner.ts", "utf8");
    const stream = readFileSync("src/nodeagent/core/stream.ts", "utf8");
    const store = readFileSync("src/app/store.tsx", "utf8");
    const chat = readFileSync("src/ui/Chat.tsx", "utf8");

    expect(schema).toContain("agentStreamEvents");
    expect(schema).toContain('v.literal("tool_call_start")');
    expect(schema).toContain('v.literal("message_done")');
    expect(jobs).toContain("export const recordStreamEvent");
    expect(jobs).toContain("streamEvents");
    expect(runtime).toContain("onStreamEvent?: (event: AgentStreamEventDraft)");
    expect(runtime).toContain('kind: "tool_call_start"');
    expect(runtime).toContain('kind: "tool_call_result"');
    expect(frameRunner).toContain("onStreamEvent: opts.onStreamEvent");
    expect(stream).toContain("buildUnifiedAgentStreamParts");
    expect(stream).toContain("tool-${string}");
    expect(store).toContain("streamParts: buildUnifiedAgentStreamParts");
    expect(chat).toContain("AgentUnifiedStream");
    expect(chat).toContain('data-testid="agent-unified-stream"');
  });

  it("dispatches public NodeAgent asks through server-side target resolution", () => {
    const store = readFileSync("src/app/store.tsx", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");

    expect(store).toContain("useMutation(api.agentJobs.startPublicAsk)");
    expect(store).toContain("contextArtifactId: input.contextArtifactId");
    expect(jobs).toContain("export const startPublicAsk = mutation");
    expect(jobs).toContain("resolvePublicAskArtifact");
    expect(jobs).toContain("createPublicAskScratchSheet");
    expect(jobs).toContain("blank_public_ask_fallback");
  });

  it("keeps NodeAgent execution server-side instead of relying on client_action as a production primitive", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const jobs = readFileSync("convex/agentJobs.ts", "utf8");

    expect(agent).not.toContain("client_action");
    expect(jobs).not.toContain("client_action");
    expect(agent).toContain("ConvexRoomTools");
    expect(jobs).toContain("requireActorProof");
    expect(jobs).toContain("requireArtifactInRoom");
  });

  it("classifies notebook tools and treats review-mode proposals as successful operations", () => {
    const agent = readFileSync("convex/agent.ts", "utf8");
    const runner = readFileSync("convex/agentJobRunner.ts", "utf8");
    const runtime = readFileSync("src/nodeagent/core/runtime.ts", "utf8");
    const reducer = readFileSync("src/nodeagent/core/frameReducer.ts", "utf8");
    const freshJudge = readFileSync("src/nodeagent/core/freshJudge.ts", "utf8");

    for (const source of [agent, runner]) {
      expect(source).toContain('"read_notebook"');
      expect(source).toContain('"append_notebook_outline"');
      expect(source).toContain("object.pendingApproval === true");
      expect(source).toContain("notebookAffectedIds");
      expect(source).toContain(': e.tool === "append_notebook_outline"');
    }
    expect(runtime).toContain("object.pendingApproval === true");
    expect(runtime).toContain('"append_notebook_outline"');
    expect(reducer).toContain('"append_notebook_outline"');
    expect(freshJudge).toContain('"append_notebook_outline"');
  });
});
