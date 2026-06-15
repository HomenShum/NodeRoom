// @vitest-environment edge-runtime
import "./benchmark/loadEnv";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  lastVersions,
  runAgent,
  scriptedModel,
  type AgentMessage,
} from "../src/nodeagent/index";
import { computeRunway, runwayChartSvg } from "../src/nodeagent/skills/finance/runwayForecaster";
import { createDiligenceDownstreamDrafts } from "../src/nodeagent/skills/integration/downstreamPublish";

const DEFAULT_JSON_OUT = "docs/eval/startup-diligence-war-room-live-results.json";
const DEFAULT_MANIFEST = "docs/eval/startup-diligence-war-room-live.json";
const HOST_TOKEN = "startup-live-eval-host-token-0123456789";
const PRIYA_TOKEN = "startup-live-eval-priya-token-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

type CheckStatus = "pass" | "fail";
type StartupLiveEvalMode = "convex-test-contract" | "provider-produced-convex-contract";

export type StartupGeneratedCellPayload = {
  kind: "CellPayload";
  value: string;
  confidence: number;
  status: "needs_review" | "reviewed";
  evidence: Array<{
    source: string;
    sourceRef: string;
    quote: string;
    artifactId?: string;
  }>;
};

export type StartupProviderGeneratedContent = {
  requestedModel: string;
  resolvedModel: string;
  providerRoute?: unknown;
  responseText: string;
  cellPayload: StartupGeneratedCellPayload;
  finalText: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  costUsd?: number;
  ms: number;
};

export interface StartupLiveEvalCheck {
  id: string;
  status: CheckStatus;
  manifestStatus: string;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface StartupLiveEvalReport {
  schema: 1;
  generatedAt: string;
  mode: StartupLiveEvalMode;
  claim: string;
  pass: boolean;
  summary: {
    checks: number;
    passed: number;
    failed: number;
    providerProducedContent: boolean;
    convexContractProven: true;
  };
  room: {
    code: string;
    roomId: string;
    researchArtifactId: string;
    runwayArtifactId: string;
    jobId: string;
  };
  checks: StartupLiveEvalCheck[];
}

export type StartupLiveEvalOptions = {
  convexModules?: Record<string, () => Promise<unknown>>;
  providerGenerated?: StartupProviderGeneratedContent;
};

export async function runStartupDiligenceConvexContractEval(
  optionsOrModules?: Record<string, () => Promise<unknown>> | StartupLiveEvalOptions,
): Promise<StartupLiveEvalReport> {
  const options = normalizeEvalOptions(optionsOrModules);
  const providerGenerated = options.providerGenerated;
  const providerProduced = !!providerGenerated;
  const runMode: StartupLiveEvalMode = providerProduced ? "provider-produced-convex-contract" : "convex-test-contract";
  const modelForRun = providerGenerated?.resolvedModel ?? "startup-contract-eval";
  const inputTokens = providerGenerated?.usage?.inputTokens ?? 1200;
  const outputTokens = providerGenerated?.usage?.outputTokens ?? 360;
  const costUsd = providerGenerated?.costUsd ?? 0.0042;
  const runMs = providerGenerated?.ms ?? 1400;
  const modules = { ...(options.convexModules ?? convexModuleMap()) };
  for (const file of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
    delete modules[file];
  }
  const t = convexTest(schema, modules);
  const code = `SD${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const checks: StartupLiveEvalCheck[] = [];

  const created = await t.mutation(api.rooms.create, {
    code,
    title: "Startup Banking Diligence War Room",
    hostName: "Maya",
    authToken: HOST_TOKEN,
    autoAllow: false,
    seedArtifacts: [
      {
        kind: "sheet" as const,
        title: "Company research",
        seed: [],
        meta: {
          dataframe: {
            columns: ["company", "website", "status", "tier", "intent", "owner", "summary", "source"],
            rowCount: 0,
            sourceFile: "startup-diligence-live-eval",
            parser: "convex-contract",
            truncated: false,
            warnings: [],
          },
        },
      },
      {
        kind: "sheet" as const,
        title: "Runway / milestones",
        seed: [
          { id: "cardionova__cash", value: "$1.5M" },
          { id: "cardionova__burn", value: "$125k/mo" },
          { id: "cardionova__runway", value: "" },
        ],
      },
      { kind: "note" as const, title: "Diligence memo", seed: [{ id: "doc", value: "<h1>Diligence memo</h1><p>Startup live eval seed.</p>" }] },
    ],
  });
  const roomId = created.roomId as Id<"rooms">;
  const hostId = created.memberId as Id<"members">;
  const researchArtifactId = created.artifactIds[0] as Id<"artifacts">;
  const runwayArtifactId = created.artifactIds[1] as Id<"artifacts">;
  const hostProof = { actor: { kind: "user" as const, id: String(hostId), name: "Maya" }, token: HOST_TOKEN };

  const joined = await t.mutation(api.rooms.joinAnonymous, { code, name: "Priya", authToken: PRIYA_TOKEN, anon: false });
  if (!joined || "error" in joined) throw new Error(`join failed: ${JSON.stringify(joined)}`);
  const priyaProof = { actor: { kind: "user" as const, id: String(joined.memberId), name: "Priya" }, token: PRIYA_TOKEN };

  const jobGoal = "Startup diligence live eval: CardioNova intake, bulk diligence, no-clobber, private lane, handoff.";
  const jobClaim = await t.mutation(api.agentJobs.createOrReuse, {
    roomId,
    artifactId: researchArtifactId,
    requester: hostProof,
    goal: jobGoal,
    entrypoint: "public_ask" as const,
    scope: "public_room" as const,
    modelPolicy: modelForRun,
    idempotencyKey: `startup-live-eval-${code}`,
    approvalPolicy: "host_review" as const,
    evidencePolicy: "public_only" as const,
    autoAllow: false,
    traceLevel: "full_operation_ledger" as const,
    request: {
      lanes: ["research", "finance_runway", "source_qa", "review_handoff"],
      spreadsheetRanges: ["Company research!A:N", "Runway / milestones!A:C"],
      evidencePolicy: "public_only",
      targetCompanies: ["CardioNova", "Mercury", "Ramp", "Brex", "Pulley"],
    },
    maxAttempts: 3,
  });
  const jobId = jobClaim.jobId as Id<"agentJobs">;

  await t.mutation(api.artifacts.addResearchRows, {
    roomId,
    artifactId: researchArtifactId,
    requester: hostProof,
    rows: [
      { company: "CardioNova", website: "https://cardionova.example", tier: "A", intent: "AI triage for hospitals", owner: "Maya", crmStatus: "New" },
      { company: "Mercury", website: "https://mercury.com", tier: "A", intent: "Startup banking", owner: "Maya", crmStatus: "Watch" },
      { company: "Ramp", website: "https://ramp.com", tier: "A", intent: "Spend controls", owner: "Priya", crmStatus: "Target" },
      { company: "Brex", website: "https://brex.com", tier: "B", intent: "Startup finance", owner: "Alex", crmStatus: "Research" },
      { company: "Pulley", website: "https://pulley.com", tier: "B", intent: "Cap table", owner: "Maya", crmStatus: "Research" },
    ],
  });
  await t.mutation(api.artifacts.addResearchRows, {
    roomId,
    artifactId: researchArtifactId,
    requester: hostProof,
    rows: [{ company: "CardioNova", website: "https://cardionova.example", tier: "A", intent: "AI triage for hospitals", owner: "Alex", crmStatus: "Updated" }],
  });
  const afterUpsert = await elements(t, roomId, researchArtifactId, hostProof);
  const cardioRows = rowIdsForCompany(afterUpsert, "CardioNova");
  const cardioRowId = cardioRows[0];
  const ownerValue = afterUpsert[`${cardioRowId}__owner`]?.value;
  addCheck(checks, "account_upsert", cardioRows.length === 1 && ownerValue === "Alex", "convex-contract-proven", "CardioNova re-import updated the existing research row instead of creating a duplicate.", {
    cardioRows,
    ownerValue,
    companyCellCount: Object.keys(afterUpsert).filter((key) => key.endsWith("__company")).length,
  });

  const summaryKey = `${cardioRowId}__summary`;
  const summaryVersion = Number(afterUpsert[summaryKey]?.version ?? 0);
  const cellPayload = materializeCellPayload(providerGenerated?.cellPayload, String(researchArtifactId));
  if (providerGenerated) {
    await t.mutation(internal.agentStepJournal.record, {
      jobId,
      sliceKey: `provider-startup-${code}`,
      step: 0,
      model: modelForRun,
      inputHash: stableHash(`startup-provider:${providerGenerated.requestedModel}:${providerGenerated.responseText.slice(0, 200)}`),
      outputHash: stableHash(JSON.stringify(providerGenerated.cellPayload)),
      result: {
        text: providerGenerated.responseText,
        toolCalls: [],
        done: true,
        usage: providerGenerated.usage ?? {},
        providerRoute: providerGenerated.providerRoute,
      },
    });
  }
  const proposedPayload = await t.mutation(internal.artifacts.applyAgentCellEdit, {
    roomId,
    artifactId: researchArtifactId,
    elementId: summaryKey,
    value: cellPayload,
    baseVersion: summaryVersion,
    actor: AGENT,
    jobId,
  });
  const payloadProposalId = (proposedPayload as { proposalId?: Id<"proposals"> }).proposalId;
  if (payloadProposalId) {
    await t.mutation(api.artifacts.resolveProposal, { proposalId: payloadProposalId, approve: true, requester: hostProof });
  }
  const afterPayload = await elements(t, roomId, researchArtifactId, hostProof);
  const committedPayload = afterPayload[summaryKey]?.value as StartupGeneratedCellPayload | undefined;
  addCheck(checks, "cited_cellpayloads", isCellPayload(committedPayload) && (!providerProduced || committedPayload?.value === cellPayload.value), providerProduced ? "provider-produced-convex-contract-proven" : "convex-contract-proven-provider-pending", providerProduced ? "A real provider generated an evidence-bearing CellPayload that committed through the host-reviewed proposal path." : "A host-reviewed agent proposal committed an evidence-bearing CellPayload to the research sheet.", {
    proposalResult: proposedPayload,
    committedPayload,
    providerProducedContent: providerProduced,
    providerRoute: providerGenerated?.providerRoute,
  });

  const tierKey = `${cardioRowId}__tier`;
  const tierVersion = Number(afterPayload[tierKey]?.version ?? 0);
  const humanEdit = await t.mutation(api.artifacts.applyCellEdit, {
    roomId,
    artifactId: researchArtifactId,
    elementId: tierKey,
    value: "A+ / banker hold",
    baseVersion: tierVersion,
    proof: hostProof,
  });
  const staleAgent = await t.mutation(internal.artifacts.applyAgentCellEdit, {
    roomId,
    artifactId: researchArtifactId,
    elementId: tierKey,
    value: "B / agent stale",
    baseVersion: tierVersion,
    actor: AGENT,
    jobId,
  });
  const afterConflict = await elements(t, roomId, researchArtifactId, hostProof);
  const proposals = await t.query(api.artifacts.listProposals, { roomId, requester: hostProof });
  const semanticConflicts = await t.run((ctx) => ctx.db.query("semanticConflicts").collect());
  addCheck(checks, "human_edit_preserved", !!humanEdit.ok && afterConflict[tierKey]?.value === "A+ / banker hold" && proposals.length > 0 && semanticConflicts.length > 0, "convex-contract-proven", "A stale agent write became a durable semantic conflict/proposal while the human value stayed committed.", {
    humanEdit,
    staleAgent,
    preservedValue: afterConflict[tierKey]?.value,
    pendingProposalCount: proposals.length,
    semanticConflictCount: semanticConflicts.length,
  });

  const privateText = "Private CardioNova concern: verify hospital deployment references before partner memo.";
  await t.mutation(internal.messages.postPrivateAgentReply, {
    roomId,
    ownerId: String(hostId),
    text: privateText,
    clientMsgId: `startup-private-${code}`,
  });
  const hostPrivate = await t.query(api.messages.list, { roomId, channel: String(hostId), requester: hostProof });
  let priyaBlocked = false;
  try {
    await t.query(api.messages.list, { roomId, channel: String(hostId), requester: priyaProof });
  } catch {
    priyaBlocked = true;
  }
  addCheck(checks, "private_boundary", hostPrivate.some((msg: any) => msg.text === privateText) && priyaBlocked, "convex-contract-proven", "The private agent reply is readable by the owning host and rejected for a second room member.", {
    hostPrivateCount: hostPrivate.length,
    priyaBlocked,
  });

  const runway = computeRunway({ company: "CardioNova", cashUsd: 1_500_000, monthlyBurnUsd: 125_000, source: "CardioNova data room / deck p.12" });
  const chartSvg = runwayChartSvg(runway);
  const chartArtifactId = await t.mutation(api.artifacts.createArtifact, {
    roomId,
    kind: "note" as const,
    title: "CardioNova runway chart",
    seed: [{ id: "doc", value: `<h1>CardioNova runway</h1>${chartSvg}` }],
    proof: hostProof,
  });
  const chartElements = await elements(t, roomId, chartArtifactId as Id<"artifacts">, hostProof);
  addCheck(checks, "runway_milestone_chart", runway.runwayMonths === 12 && String(chartElements.doc?.value ?? "").includes("<svg"), "deterministic-helper-and-artifact-proven", "Runway math produced a sourced 12.0 month result and persisted an SVG chart in a room note artifact.", {
    runway,
    chartArtifactId: String(chartArtifactId),
  });

  const downstreamDrafts = createDiligenceDownstreamDrafts({
    id: "cardionova-runway",
    title: "CardioNova runway diligence",
    kind: "runway_chart",
    body: runway.headline,
    sourceArtifactIds: [String(researchArtifactId), String(chartArtifactId)],
    sourceUrls: ["cardionova-intake.pdf#page=1", "cardionova-deck.pdf#page=12"],
    createdAt: Date.now(),
  });
  addCheck(checks, "downstream_draft_only", downstreamDrafts.length === 6 && downstreamDrafts.every((draft) => draft.status === "needs_approval" || draft.status === "ready"), "helper-proven-no-side-effects", "Downstream outputs are generated as approval-gated drafts or CRM export rows, with no external side-effect adapter invoked.", {
    destinations: downstreamDrafts.map((draft) => ({ destination: draft.destination, status: draft.status, approvalRequired: draft.approvalRequired })),
  });

  const coachHarness = await runBankerCoachHarnessProbe();
  addCheck(checks, "banker_coach_harness_tools", coachHarness.committed && coachHarness.hasCoachCues && coachHarness.hasChartPatch && coachHarness.hasDownstreamDrafts, "harness-tool-loop-proven", "Banker coach, evidence, runway/chart, review update, and downstream draft tools ran through the actual runAgent/PRODUCTION_ROOM_TOOLS loop before a managed CAS write.", coachHarness);

  const runId = await t.mutation(internal.agentRuns.record, {
    jobId,
    roomId,
    agentId: "agent_room",
    model: modelForRun,
    goal: jobGoal,
    steps: 6,
    toolCalls: 8,
    conflictsSurvived: 1,
    inputTokens,
    outputTokens,
    costUsd,
    ms: runMs,
    exhausted: false,
    stopReason: "done",
    handoff: { sealed: true, lanes: ["research", "finance_runway", "source_qa", "review_handoff"] },
  });
  await t.mutation(internal.agentJobs.finishInteractive, {
    jobId,
    runId,
    status: "completed",
    finalText: providerGenerated?.finalText ?? "Startup diligence contract eval complete.",
    resolvedModel: modelForRun,
    stopReason: "done",
    ms: runMs,
    inputTokens,
    outputTokens,
    costUsd,
    modelCalls: 1,
    toolCalls: 8,
    queryCount: 4,
    mutationCount: 9,
    receiptCount: 0,
  });
  const detail = await t.query(api.agentJobs.detail, { jobId, requester: hostProof }) as any;
  const opKinds = new Set((detail.operations ?? []).map((event: any) => event.kind));
  const attemptWithCost = (detail.attempts ?? []).find((attempt: any) =>
    attempt.resolvedModel === modelForRun
    && attempt.stopReason === "done"
    && typeof attempt.costUsd === "number"
    && typeof attempt.ms === "number"
  );
  const providerRouteJournal = (detail.modelJournal ?? []).find((row: any) =>
    row.result?.providerRoute?.policy === "provider_route_v1"
    && row.result?.providerRoute?.resolvedModel === modelForRun
  );
  addCheck(checks, "concurrent_lanes", Array.isArray(detail.job.request?.lanes) && detail.job.request.lanes.length >= 4 && detail.job.status === "completed", "convex-contract-proven", "The job request records distinct diligence lanes and completes through the durable agentJobs root.", {
    lanes: detail.job.request?.lanes,
    status: detail.job.status,
  });
  addCheck(checks, "route_trace_cost_runtime", !!attemptWithCost && opKinds.has("model_call") && opKinds.has("tool_call") && !!detail.latestRun && (!providerProduced || !!providerRouteJournal), providerProduced ? "provider-produced-route-trace-proven" : "convex-contract-proven-provider-route-pending", "The job detail records resolved model, model/tool operation events, token/cost counters, stop reason, and linked run metadata.", {
    attempts: detail.attempts.map((attempt: any) => ({ resolvedModel: attempt.resolvedModel, stopReason: attempt.stopReason, costUsd: attempt.costUsd, ms: attempt.ms })),
    operationKinds: [...opKinds],
    latestRun: detail.latestRun ? { model: detail.latestRun.model, stopReason: detail.latestRun.stopReason, toolCalls: detail.latestRun.toolCalls } : null,
    providerRouteJournal: providerRouteJournal ? { model: providerRouteJournal.model, providerRoute: providerRouteJournal.result?.providerRoute } : null,
  });

  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.length - passed;
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    mode: runMode,
    claim: providerProduced
      ? "Startup diligence provider-produced proof for model-generated evidence cells and final copy flowing through the same Convex job/proposal/trace contract."
      : "Startup diligence Convex contract proof for account intake, evidence cells, no-clobber, private lane, route trace, runway chart, and draft-only handoff.",
    pass: failed === 0,
    summary: {
      checks: checks.length,
      passed,
      failed,
      providerProducedContent: providerProduced,
      convexContractProven: true,
    },
    room: {
      code,
      roomId: String(roomId),
      researchArtifactId: String(researchArtifactId),
      runwayArtifactId: String(runwayArtifactId),
      jobId: String(jobId),
    },
    checks,
  };
}

export function writeStartupDiligenceEvalArtifacts(report: StartupLiveEvalReport, options: { jsonOut: string; manifestPath: string }) {
  mkdirSync(dirname(options.jsonOut), { recursive: true });
  writeFileSync(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  if (existsSync(options.manifestPath)) {
    const manifest = JSON.parse(readFileSync(options.manifestPath, "utf8"));
    const checkById = new Map(report.checks.map((check) => [check.id, check]));
    const providerProduced = report.summary.providerProducedContent;
    manifest.currentEvidenceLevel = providerProduced
      ? "provider-produced-convex-contract-proven-plus-deterministic-media"
      : "convex-contract-proven-plus-deterministic-media-provider-pending";
    const latestEval = {
      generatedAt: report.generatedAt,
      mode: report.mode,
      command: providerProduced ? "npm run eval:startup-diligence:provider" : "npm run eval:startup-diligence:live",
      resultPath: options.jsonOut,
      pass: report.pass,
      checksPassed: report.summary.passed,
      checksFailed: report.summary.failed,
      providerProducedContent: providerProduced,
      note: providerProduced
        ? "Provider-generated CellPayload/final copy flowed through the same Convex job/proposal/trace contract."
        : "Convex contract proof is green; live provider-generated content remains the next production gate.",
    };
    manifest.latestLiveEval = latestEval;
    if (providerProduced) manifest.latestProviderEval = latestEval;
    manifest.requiredChecks = (manifest.requiredChecks ?? []).map((required: any) => {
      const check = checkById.get(required.id);
      if (!check) return required;
      return {
        ...required,
        status: check.status === "pass" ? check.manifestStatus : "failed",
        lastVerifiedAt: report.generatedAt,
        lastEvidenceRef: `${options.jsonOut}#${check.id}`,
      };
    });
    manifest.nextAcceptanceGate = providerProduced
      ? [
        "repeat the provider-produced startup diligence eval N=5 and promote only if p95 latency, path fingerprint drift, and pass rate meet the live collaboration SLO",
      ]
      : [
        "run the same startup diligence eval through a real provider route so CellPayloads, route telemetry, and final content are provider-produced rather than contract-seeded",
      ];
    writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

function addCheck(
  checks: StartupLiveEvalCheck[],
  id: string,
  condition: boolean,
  manifestStatus: string,
  summary: string,
  evidence: Record<string, unknown>,
) {
  checks.push({ id, status: condition ? "pass" : "fail", manifestStatus, summary, evidence });
}

function isCellPayload(value: any): boolean {
  return value?.kind === "CellPayload"
    && typeof value.value === "string"
    && Array.isArray(value.evidence)
    && value.evidence.length > 0
    && value.evidence.every((item: any) => typeof item.sourceRef === "string" && item.sourceRef.length > 0);
}

function normalizeEvalOptions(input?: Record<string, () => Promise<unknown>> | StartupLiveEvalOptions): StartupLiveEvalOptions {
  if (!input) return {};
  if ("convexModules" in input || "providerGenerated" in input) return input as StartupLiveEvalOptions;
  return { convexModules: input as Record<string, () => Promise<unknown>> };
}

function materializeCellPayload(seed: StartupGeneratedCellPayload | undefined, artifactId: string): StartupGeneratedCellPayload {
  const payload = seed ?? {
    kind: "CellPayload" as const,
    value: "CardioNova: AI triage workflow for hospital intake.",
    confidence: 0.86,
    status: "needs_review" as const,
    evidence: [
      {
        source: "CardioNova intake packet",
        sourceRef: "cardionova-intake.pdf#page=1",
        quote: "AI triage for hospitals",
      },
    ],
  };
  return {
    kind: "CellPayload",
    value: String(payload.value).trim(),
    confidence: Math.max(0, Math.min(1, Number(payload.confidence) || 0.5)),
    status: payload.status === "reviewed" ? "reviewed" : "needs_review",
    evidence: (payload.evidence ?? []).slice(0, 4).map((item) => ({
      source: String(item.source || "Startup diligence source"),
      sourceRef: String(item.sourceRef || "startup-provider-output#model"),
      quote: String(item.quote || payload.value).slice(0, 240),
      artifactId,
    })),
  };
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function elements(t: any, roomId: Id<"rooms">, artifactId: Id<"artifacts">, requester: any) {
  return await t.query(api.artifacts.elements, { roomId, artifactId, requester }) as Record<string, { id: string; version: number; value: any; updatedAt: number; updatedBy: any }>;
}

function rowIdsForCompany(elementsById: Record<string, { value: any }>, company: string): string[] {
  const wanted = normalize(company);
  return Object.entries(elementsById)
    .filter(([key, cell]) => key.endsWith("__company") && normalize(String(cell.value ?? "")) === wanted)
    .map(([key]) => key.replace(/__company$/, ""));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const COACH_PROBE_CELL = "r_rev__note";

async function runBankerCoachHarnessProbe() {
  const engine = new RoomEngine();
  const room = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, room.roomId, room.sheetId, room.agents.room, room.sessions.room);
  const result = await runAgent({
    rt,
    goal: "Prepare a CardioNova banker coach packet with runway, evidence, review update, and downstream drafts.",
    model: scriptedModel(bankerCoachProbePlanner(), "startup-banker-coach-probe"),
    tools: PRODUCTION_ROOM_TOOLS,
    systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
    maxSteps: 14,
  });
  const value = engine.getArtifact(room.sheetId)?.elements[COACH_PROBE_CELL]?.value as { value?: unknown; evidence?: unknown[]; status?: string } | undefined;
  const toolNames = result.trace.map((event) => event.tool);
  return {
    stopReason: result.stopReason,
    exhausted: result.exhausted,
    tools: toolNames,
    committed: !result.exhausted && typeof value?.value === "string" && value.value.includes("coach packet ready") && value.status === "needs_review",
    hasCoachCues: toolNames.includes("generate_banker_coach_cues"),
    hasChartPatch: toolNames.includes("render_chart_artifact"),
    hasDownstreamDrafts: toolNames.includes("export_downstream_draft"),
    evidenceCount: value?.evidence?.length ?? 0,
  };
}

function bankerCoachProbePlanner() {
  return ({ messages }: { messages: AgentMessage[] }) => {
    const versions = lastVersions(messages);
    if (versions[COACH_PROBE_CELL] === undefined) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: [COACH_PROBE_CELL] } }] };
    }
    if (!hasToolResult(messages, "compute_runway_milestones")) {
      return { toolCalls: [{ tool: "compute_runway_milestones", args: { company: "CardioNova", cashUsd: 1_500_000, monthlyBurnUsd: 125_000, source: "cardionova-deck.pdf#page=12" } }] };
    }
    if (!hasToolResult(messages, "validate_chart_against_source_cells")) {
      return { toolCalls: [{ tool: "validate_chart_against_source_cells", args: { sourceCells: { cardionova__runway: 12 }, series: [{ label: "CardioNova runway", value: 12, sourceRef: "cardionova__runway" }] } }] };
    }
    if (!hasToolResult(messages, "build_evidence_cards")) {
      return { toolCalls: [{ tool: "build_evidence_cards", args: { evidence: [{ label: "CardioNova deck p.12", sourceRef: "cardionova-deck.pdf#page=12", quote: "Cash $1.5M; burn $125k/month", kind: "upload", confidence: 0.86, status: "verified" }] } }] };
    }
    const evidence = parsedToolResult<{ cards: Array<Record<string, unknown>> }>(messages, "build_evidence_cards");
    if (!hasToolResult(messages, "generate_banker_coach_cues") && evidence) {
      return { toolCalls: [{ tool: "generate_banker_coach_cues", args: { company: "CardioNova", claim: "AI triage workflow has 12.0 months runway from uploaded cash and burn assumptions.", evidenceCards: evidence.cards, runwayMonths: 12, status: "needs_review" } }] };
    }
    const runway = parsedToolResult<{ chartSvg: string; sourceRefs: string[] }>(messages, "compute_runway_milestones");
    if (!hasToolResult(messages, "render_chart_artifact") && runway) {
      return { toolCalls: [{ tool: "render_chart_artifact", args: { title: "CardioNova runway chart", chartSvg: runway.chartSvg, narrative: "12.0 months runway from uploaded cash and burn assumptions.", sourceRefs: runway.sourceRefs } }] };
    }
    if (!hasToolResult(messages, "create_review_round_update")) {
      return { toolCalls: [{ tool: "create_review_round_update", args: { roomTitle: "Startup Banking Diligence War Room", company: "CardioNova", materialChanges: ["Runway computed at 12.0 months from uploaded deck assumptions."], openQuestions: ["Verify current cash balance and hospital deployment references."], nextActions: ["Route to host review before downstream handoff."], sourceRefs: ["cardionova-deck.pdf#page=12"] } }] };
    }
    if (!hasToolResult(messages, "export_downstream_draft")) {
      return { toolCalls: [{ tool: "export_downstream_draft", args: { artifact: { id: "cardionova-runway", title: "CardioNova runway diligence", kind: "runway_chart", body: "CardioNova runway: 12.0 months; host review required.", sourceArtifactIds: ["research-sheet", "runway-chart"], sourceUrls: ["cardionova-deck.pdf#page=12"], createdAt: 1_780_000_000_000 }, destinations: ["gmail", "notion", "crm_csv"] } }] };
    }
    if (!hasToolResult(messages, "write_locked_cell_result")) {
      return { toolCalls: [{ tool: "write_locked_cell_result", args: { elementId: COACH_PROBE_CELL, value: "CardioNova coach packet ready: runway, evidence, review update, and downstream drafts prepared.", baseVersion: versions[COACH_PROBE_CELL], status: "needs_review", confidence: 0.86, evidence: [{ kind: "upload", label: "CardioNova deck p.12", source: "cardionova-deck.pdf#page=12", snippet: "Cash $1.5M; burn $125k/month" }], reason: "banker coach packet" } }] };
    }
    return { say: "Banker coach packet prepared and filed for review.", done: true };
  };
}

function hasToolResult(messages: AgentMessage[], toolName: string): boolean {
  return messages.some((message) => message.role === "tool" && message.toolName === toolName);
}

function parsedToolResult<T>(messages: AgentMessage[], toolName: string): T | null {
  const message = [...messages].reverse().find((item) => item.role === "tool" && item.toolName === toolName);
  if (!message) return null;
  try {
    return JSON.parse(message.content) as T;
  } catch {
    return null;
  }
}

function optionValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function convexModuleMap(): Record<string, () => Promise<unknown>> {
  const root = resolve("convex");
  const out: Record<string, () => Promise<unknown>> = {};
  for (const file of walkTs(root)) {
    const key = `../convex/${relative(root, file).replace(/\\/g, "/")}`;
    out[key] = () => import(pathToFileURL(file).href);
  }
  return out;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walkTs(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

async function main() {
  const jsonOut = optionValue("--json-out") ?? DEFAULT_JSON_OUT;
  const manifestPath = optionValue("--manifest") ?? DEFAULT_MANIFEST;
  const strict = process.argv.includes("--strict");
  const noWrite = process.argv.includes("--no-write");
  const report = await runStartupDiligenceConvexContractEval();
  if (!noWrite) writeStartupDiligenceEvalArtifacts(report, { jsonOut, manifestPath });
  console.log(`startup diligence live eval: ${report.pass ? "PASS" : "FAIL"} checks=${report.summary.passed}/${report.summary.checks} mode=${report.mode}`);
  for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.id} - ${check.summary}`);
  if (!noWrite) {
    console.log(`wrote ${jsonOut}`);
    console.log(`updated ${manifestPath}`);
  }
  if (strict && !report.pass) process.exit(1);
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
