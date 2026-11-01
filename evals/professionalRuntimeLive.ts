import "../scripts/benchmark/loadEnv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  lastVersions,
  model as realModel,
  runAgent,
  scriptedModel,
  type AgentMessage,
  type AgentModel,
  type AgentTraceEvent,
  type Planner,
} from "../src/nodeagent/index";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor, CellEvidence, CellPayload, DataframeColumn } from "../src/engine/types";
import { appendEvalRuns, computeCaseSetHash, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
import { readGitIdentity } from "./gitIdentity";
import {
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalEvalCase,
  type ProfessionalHarnessRequirement,
  type ProfessionalOutputSurface,
} from "./professionalWorkflows";

const HARNESS_VERSION = "professional-live-runtime-v1-managed";
const DEFAULT_OUT = "docs/eval/professional-live-runtime.json";
const BUSINESS_RESULT_IDS = ["target__result", "target__evidence", "target__risk", "target__trace"] as const;
const STATUS_ID = "target__status";
const READ_IDS = [
  "request__case_id",
  "request__workflow",
  "request__source_a",
  "request__source_b",
  "request__requirements",
  ...BUSINESS_RESULT_IDS,
  STATUS_ID,
] as const;
const FORBIDDEN_MODEL_VISIBLE_WRITE_TOOLS = new Set(["propose_lock", "release_lock", "edit_cell", "write_cell_result", "create_draft"]);

type RuntimeSurface = ProfessionalOutputSurface | "sheet_row";

type RuntimeScenario = {
  evalCase: ProfessionalEvalCase;
  surface: RuntimeSurface;
  evidenceKind: CellEvidence["kind"];
  evidenceLabel: string;
  wikiRequired: boolean;
  privateRun: boolean;
  expectedTerms: string[];
  forbiddenPublicTerms: string[];
  protectedAnswerIds: string[];
};

export type ProfessionalRuntimeLiveReport = {
  caseId: string;
  model: string;
  status: "passed" | "failed";
  score: number;
  checks: Record<string, boolean>;
  ms: number;
  toolCalls: number;
  surface: RuntimeSurface;
  runtimeLockMode: "runtime_managed_lock";
  failureSummary?: string;
  finalText?: string;
  trace: AgentTraceEvent[];
};

export type ProfessionalRuntimeLiveAggregate = {
  generatedAt: string;
  harnessVersion: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  allPassed: boolean;
  rows: ProfessionalRuntimeLiveReport[];
};

type BuiltRoom = {
  engine: RoomEngine;
  roomId: string;
  hostId: string;
  sheetId: string;
  noteId: string;
  rt: InMemoryRoomTools;
  actor: Actor;
};

export async function runProfessionalRuntimeLive(options: {
  model?: string;
  cases?: ProfessionalEvalCase[];
  timeoutMs?: number;
  maxSteps?: number;
  retryFailed?: number;
} = {}): Promise<ProfessionalRuntimeLiveAggregate> {
  const modelName = options.model ?? "scripted";
  const rows: ProfessionalRuntimeLiveReport[] = [];
  for (const evalCase of options.cases ?? PROFESSIONAL_WORKFLOW_CASES) {
    let latest = await runProfessionalRuntimeLiveCase(evalCase, {
      modelName,
      timeoutMs: options.timeoutMs,
      maxSteps: options.maxSteps,
    });
    const retryFailed = Math.max(0, options.retryFailed ?? 0);
    for (let attempt = 0; latest.status !== "passed" && attempt < retryFailed; attempt++) {
      console.log(`RETRY ${evalCase.id}: ${latest.failureSummary ?? failedCheckSummary(latest.checks)}`);
      latest = await runProfessionalRuntimeLiveCase(evalCase, {
        modelName,
        timeoutMs: options.timeoutMs,
        maxSteps: options.maxSteps,
      });
    }
    rows.push(latest);
    console.log(`${latest.status === "passed" ? "PASS" : "FAIL"} ${latest.caseId} ${latest.score.toFixed(2)} ${(latest.ms / 1000).toFixed(1)}s ${latest.toolCalls} tools`);
  }
  const passed = rows.filter((row) => row.status === "passed").length;
  return {
    generatedAt: new Date().toISOString(),
    harnessVersion: HARNESS_VERSION,
    model: modelName,
    total: rows.length,
    passed,
    failed: rows.length - passed,
    passRate: rows.length ? passed / rows.length : 0,
    allPassed: passed === rows.length,
    rows,
  };
}

async function runProfessionalRuntimeLiveCase(
  evalCase: ProfessionalEvalCase,
  options: { modelName: string; timeoutMs?: number; maxSteps?: number },
): Promise<ProfessionalRuntimeLiveReport> {
  const scenario = scenarioFor(evalCase);
  const built = buildRuntimeRoom(scenario);
  const agent = options.modelName === "scripted"
    ? scriptedModel(runtimeSmokePlan(scenario, built.noteId), `scripted:${evalCase.id}`)
    : realModel(options.modelName, { operatorSelected: true });
  const started = Date.now();
  try {
    const result = await runAgent({
      rt: built.rt,
      goal: evalCase.agentGoal,
      model: agent,
      tools: PRODUCTION_ROOM_TOOLS,
      systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
      maxSteps: options.maxSteps ?? 8,
      deadlineAt: options.timeoutMs ? started + options.timeoutMs : undefined,
      reserveMs: options.timeoutMs ? 10_000 : 0,
      contextBuilder: () => Promise.resolve(runtimeContext(scenario, built.sheetId, built.noteId)),
    });
    const ms = Date.now() - started;
    return gradeRuntimeResult(scenario, built, agent, result.trace, result.finalText, ms, false);
  } catch (error) {
    const partial = error && typeof error === "object" && "partial" in error
      ? (error as { partial?: { trace?: AgentTraceEvent[]; finalText?: string } }).partial
      : undefined;
    const ms = Date.now() - started;
    const report = gradeRuntimeResult(scenario, built, agent, partial?.trace ?? [], partial?.finalText ?? "", ms, true);
    return {
      ...report,
      failureSummary: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    };
  }
}

function buildRuntimeRoom(scenario: RuntimeScenario): BuiltRoom {
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "Professional live runtime", hostName: "Host", autoAllow: true });
  const actor: Actor = scenario.privateRun
    ? { kind: "agent", id: `agent_${scenario.evalCase.id}`, name: "NodeAgent", scope: "private", ownerId: host.id }
    : { kind: "agent", id: `agent_${scenario.evalCase.id}`, name: "NodeAgent", scope: "public" };
  const sheet = engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: `${scenario.evalCase.id} runtime sheet`,
    by: { kind: "user", id: host.id, name: host.name },
    meta: { dataframe: { columns: dataframeColumns(), rowCount: 3, sourceFile: "professional-runtime-fixture.csv", sheetName: "Runtime" } },
    seed: [
      { id: "request__case_id", value: scenario.evalCase.id },
      { id: "request__workflow", value: scenario.evalCase.workflow },
      { id: "request__source_a", value: scenario.evalCase.sourcePatterns[0] ?? "source artifact A" },
      { id: "request__source_b", value: scenario.evalCase.fixtureStrategy },
      { id: "request__requirements", value: scenario.evalCase.requiredHarness.join(", ") },
      { id: "target__result", value: "" },
      { id: "target__evidence", value: "" },
      { id: "target__risk", value: "" },
      { id: "target__trace", value: "" },
      { id: "target__status", value: "" },
      ...scenario.protectedAnswerIds.map((id) => ({ id, value: "" })),
    ],
  });
  const note = engine.createArtifact({
    roomId: room.id,
    kind: "note",
    title: `${scenario.evalCase.id} runtime wiki`,
    by: { kind: "user", id: host.id, name: host.name },
    seed: [{ id: "doc", value: `<h1>${scenario.evalCase.id}</h1><p>Waiting for grounded update.</p>` }],
  });
  const session = engine.startSession({ roomId: room.id, agentId: actor.id, agentName: actor.name, scope: actor.scope ?? "public", ownerId: actor.ownerId });
  return {
    engine,
    roomId: room.id,
    hostId: host.id,
    sheetId: sheet.id,
    noteId: note.id,
    actor,
    rt: new InMemoryRoomTools(engine, room.id, sheet.id, actor, session.id),
  };
}

function runtimeContext(scenario: RuntimeScenario, sheetId: string, noteId: string): AgentMessage[] {
  const requirements = scenario.evalCase.requiredHarness.join(", ");
  const expectedTerms = scenario.expectedTerms.join(", ");
  return [{
    role: "user",
    content: [
      `LIVE RUNTIME CASE: ${scenario.evalCase.id}`,
      `Workflow: ${scenario.evalCase.workflow}`,
      `Persona: ${scenario.evalCase.persona}`,
      `Goal: ${scenario.evalCase.agentGoal}`,
      `Primary sheet artifactId: ${sheetId}`,
      `Runtime wiki artifactId: ${noteId}`,
      `Required harness signals: ${requirements}`,
      `Expected surface: ${scenario.surface}`,
      "",
      "You must execute the workflow through production-managed room tools. This is not a planning response.",
      "Do not call propose_lock, release_lock, edit_cell, write_cell_result, or create_draft.",
      `First call read_range on exactly these primary-sheet cells: ${READ_IDS.join(", ")}.`,
      "Then call write_locked_cell_results once for target__result, target__evidence, target__risk, and target__trace.",
      "Use baseVersion=1 for each target__* cell after reading it, kind='set', status='complete' or 'needs_review', confidence between 0 and 1.",
      `Every evidence item must use kind='${scenario.evidenceKind}', label='${scenario.evidenceLabel}', and a snippet from request__workflow, request__source_a, or request__source_b.`,
      "Then call write_locked_cells once to set target__status to complete or needs_review with baseVersion=1.",
      scenario.wikiRequired
        ? `Also read doc from artifactId ${noteId}, then call update_wiki on ${noteId} with citesArtifactIds ['${sheetId}'] and the doc baseVersion you read.`
        : "Do not update the wiki for this case unless needed to finish after the sheet writes.",
      scenario.protectedAnswerIds.length
        ? `Protected answer cells must stay untouched: ${scenario.protectedAnswerIds.join(", ")}. Write guidance/lease notes only in target__* cells.`
        : "Only write target__* cells for this runtime proof.",
      scenario.privateRun
        ? "This is private. The final say() must not include person names, account IDs, answer keys, or raw private data."
        : "The final say() must be one short status line.",
      `Make target__result and target__trace mention these case-specific terms when relevant: ${expectedTerms}.`,
      "Stop after the writes and one say() call.",
    ].join("\n"),
  }];
}

function runtimeSmokePlan(scenario: RuntimeScenario, noteId: string): Planner {
  return ({ messages }) => {
    const versions = lastVersions(messages);
    const wroteResults = toolResultSeen(messages, "write_locked_cell_results");
    const wroteStatus = toolResultSeen(messages, "write_locked_cells");
    const updatedWiki = toolResultSeen(messages, "update_wiki");
    const said = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((call) => call.tool === "say"));
    if (!READ_IDS.every((id) => versions[id] !== undefined)) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: [...READ_IDS] } }] };
    }
    if (!wroteResults) {
      return {
        toolCalls: [{
          tool: "write_locked_cell_results",
          args: {
            reason: `runtime proof ${scenario.evalCase.id}`,
            ops: BUSINESS_RESULT_IDS.map((elementId) => ({
              elementId,
              value: valueForTarget(scenario, elementId),
              baseVersion: versions[elementId] ?? 1,
              status: scenario.expectedTerms.includes("review") ? "needs_review" : "complete",
              confidence: 0.82,
              evidence: [evidenceFor(scenario, elementId)],
              kind: "set",
            })),
          },
        }],
      };
    }
    if (!wroteStatus) {
      return {
        toolCalls: [{
          tool: "write_locked_cells",
          args: {
            reason: `mark ${scenario.evalCase.id} runtime proof`,
            ops: [{ elementId: STATUS_ID, value: scenario.expectedTerms.includes("review") ? "needs_review" : "complete", baseVersion: versions[STATUS_ID] ?? 1, kind: "set" }],
          },
        }],
      };
    }
    if (scenario.wikiRequired && versions.doc === undefined) {
      return { toolCalls: [{ tool: "read_range", args: { artifactId: noteId, elementIds: ["doc"] } }] };
    }
    if (scenario.wikiRequired && !updatedWiki) {
      return {
        toolCalls: [{
          tool: "update_wiki",
          args: {
            artifactId: noteId,
            baseVersion: versions.doc ?? 1,
            citesArtifactIds: ["primary-runtime-sheet"],
            content: `## ${scenario.evalCase.id}\n\n${valueForTarget(scenario, "target__result")}`,
          },
        }],
      };
    }
    if (!said) return { toolCalls: [{ tool: "say", args: { text: `Runtime proof complete for ${scenario.evalCase.id}.` } }] };
    return { done: true };
  };
}

function gradeRuntimeResult(
  scenario: RuntimeScenario,
  built: BuiltRoom,
  agent: AgentModel,
  trace: AgentTraceEvent[],
  finalText: string,
  ms: number,
  errored: boolean,
): ProfessionalRuntimeLiveReport {
  const sheet = built.engine.getArtifact(built.sheetId)!;
  const note = built.engine.getArtifact(built.noteId)!;
  const changedTargets = BUSINESS_RESULT_IDS.map((id) => sheet.elements[id]).filter(Boolean);
  const payloads = changedTargets.map((el) => payloadOf(el.value));
  const publicMessages = built.engine.listMessages(built.roomId, "public");
  const firstRead = trace.findIndex((event) => event.tool === "read_range" || event.tool === "search_sheet_context" || event.tool === "list_artifacts");
  const firstWrite = trace.findIndex((event) => isRuntimeWriteTool(event.tool));
  const managedEvents = trace.filter((event) => isManagedRuntimeWrite(event.tool));
  const coordination = managedEvents.flatMap((event) => coordinationFrom(event.result));
  const joinedOutput = [
    finalText,
    ...trace
      .filter((event) => event.tool === "say")
      .map((event) => String((event.args as { text?: unknown }).text ?? "")),
    ...payloads.map((payload) => String(payload?.value ?? "")),
    String(sheet.elements[STATUS_ID]?.value ?? ""),
    String(note.elements.doc?.value ?? ""),
  ].join(" ").toLowerCase();
  const checks: Record<string, boolean> = {
    stoppedCleanly: !errored,
    readBeforeWrite: firstRead > -1 && firstWrite > firstRead,
    usedProductionManagedWrite: managedEvents.length > 0,
    noModelVisibleLockTools: trace.every((event) => !FORBIDDEN_MODEL_VISIBLE_WRITE_TOOLS.has(event.tool)),
    lockHeldDuringWrite: coordination.some((item) => item.acquired === true && item.released === true),
    releaseOrTtlFallback: built.engine.activeLocks(built.roomId).length === 0 && coordination.every((item) => item.released === true || item.drafted === true || item.acquired === false),
    noSilentClobber: trace.every((event) => !(event.result && typeof event.result === "object" && (event.result as { conflict?: boolean }).conflict === true)),
    statusWritten: sheet.elements[STATUS_ID]?.version > 1 && /complete|needs_review/.test(String(sheet.elements[STATUS_ID]?.value ?? "")),
    resultPayloadsWritten: payloads.length === BUSINESS_RESULT_IDS.length && payloads.every((payload) => payload && payload.status && (payload.evidence ?? []).length > 0),
    evidenceMatchesSourceStrength: payloads.every((payload) => (payload?.evidence ?? []).every((evidence) => evidence.kind === scenario.evidenceKind && evidence.label === scenario.evidenceLabel)),
    expectedTermsPresent: scenario.expectedTerms.length === 0 || scenario.expectedTerms.every((term) => joinedOutput.includes(term.toLowerCase())),
    wikiUpdatedIfRequired: !scenario.wikiRequired || (note.elements.doc?.version > 1 && /sources:/i.test(String(note.elements.doc?.value ?? ""))),
    protectedAnswerCellsUntouched: scenario.protectedAnswerIds.every((id) => sheet.elements[id]?.version === 1 && String(sheet.elements[id]?.value ?? "") === ""),
    privateBoundary: !scenario.privateRun || scenario.forbiddenPublicTerms.every((term) =>
      !publicMessages.some((message) => message.author.kind === "agent" && message.text.toLowerCase().includes(term.toLowerCase()))),
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    caseId: scenario.evalCase.id,
    model: agent.name,
    status: passed ? "passed" : "failed",
    score: scoreChecks(checks),
    checks,
    ms,
    toolCalls: trace.length,
    surface: scenario.surface,
    runtimeLockMode: "runtime_managed_lock",
    failureSummary: passed ? undefined : failedCheckSummary(checks),
    finalText,
    trace,
  };
}

function scenarioFor(evalCase: ProfessionalEvalCase): RuntimeScenario {
  const requirements = new Set<ProfessionalHarnessRequirement>(evalCase.requiredHarness);
  const surface = evalCase.outputContract?.defaultSurface ?? (requirements.has("wiki_grounded_update") ? "wiki_note" : "watchlist_row");
  const pasted = evalCase.intakeModes?.includes("pasted_content");
  const privateRun = Boolean(requirements.has("privacy_redaction") || requirements.has("private_gold_pack") || surface === "private_note" || evalCase.intakeModes?.includes("chat_only") || pasted);
  const expectedTerms = [
    ...termsForRequirements(evalCase.requiredHarness),
    ...termsForSurface(surface),
  ];
  return {
    evalCase,
    surface,
    evidenceKind: evidenceKindFor(evalCase),
    evidenceLabel: pasted ? "quoted third-party paste" : evalCase.intakeModes?.includes("chat_only") ? "user said in chat (unverified)" : "runtime fixture source",
    wikiRequired: surface === "wiki_note" || requirements.has("wiki_grounded_update"),
    privateRun,
    expectedTerms: [...new Set(expectedTerms)].slice(0, 8),
    forbiddenPublicTerms: ["Jordan Lee", "answer key", "account 8842", "Sarah Lin"],
    protectedAnswerIds: requirements.has("guide_mode_no_write") || requirements.has("private_gold_pack")
      ? ["answer_F7", "answer_F8", "answer_F16"]
      : [],
  };
}

function evidenceKindFor(evalCase: ProfessionalEvalCase): CellEvidence["kind"] {
  if (evalCase.intakeModes?.includes("chat_only") || evalCase.intakeModes?.includes("pasted_content")) return "manual";
  if (evalCase.requiredHarness.includes("formula_structure_equivalence")) return "computed";
  if (evalCase.intakeModes?.includes("external_retrieval")) return "source";
  return "upload";
}

function termsForRequirements(requirements: ProfessionalHarnessRequirement[]): string[] {
  const out: string[] = [];
  const has = (name: ProfessionalHarnessRequirement) => requirements.includes(name);
  if (has("schema_detection")) out.push("schema");
  if (has("cross_file_context")) out.push("cross-file");
  if (has("spreadsheet_semantic_index")) out.push("indexed");
  if (has("human_review")) out.push("review");
  if (has("privacy_redaction")) out.push("redacted");
  if (has("long_running_free_auto") || has("workflow_checkpoint_resume")) out.push("checkpoint");
  if (has("answer_key_formula_oracle") || has("formula_structure_equivalence")) out.push("formula");
  if (has("guide_mode_no_write")) out.push("guide");
  if (has("section_collaboration_locks")) out.push("section");
  if (has("wiki_grounded_update")) out.push("wiki");
  return out;
}

function termsForSurface(surface: RuntimeSurface): string[] {
  switch (surface) {
    case "background_job": return ["job", "checkpoint"];
    case "chat_reply_only": return ["reply"];
    case "private_note": return ["private", "redacted"];
    case "wiki_note": return ["wiki"];
    case "watchlist_row": return ["row"];
    default: return [];
  }
}

function valueForTarget(scenario: RuntimeScenario, elementId: string): string {
  const terms = scenario.expectedTerms.length ? scenario.expectedTerms.join(", ") : "managed runtime";
  switch (elementId) {
    case "target__result":
      return `${scenario.evalCase.id}: executed ${scenario.surface} workflow with ${terms}.`;
    case "target__evidence":
      return `Evidence comes from ${scenario.evalCase.sourcePatterns.slice(0, 2).join(" + ") || "runtime fixture"}; provenance is ${scenario.evidenceLabel}.`;
    case "target__risk":
      return `Controls: CAS, managed locks, ${terms}, and needs_review for ambiguity.`;
    case "target__trace":
      return `Trace must show read -> managed write -> receipt for ${scenario.evalCase.id}; ${terms}.`;
    default:
      return scenario.evalCase.id;
  }
}

function evidenceFor(scenario: RuntimeScenario, elementId: string): CellEvidence {
  return {
    id: `${scenario.evalCase.id}:${elementId}`,
    kind: scenario.evidenceKind,
    label: scenario.evidenceLabel,
    snippet: `${scenario.evalCase.workflow} | ${scenario.evalCase.fixtureStrategy}`.slice(0, 400),
    confidence: 0.82,
  };
}

function payloadOf(value: unknown): CellPayload | undefined {
  return value && typeof value === "object" && "value" in value ? value as CellPayload : undefined;
}

function isRuntimeWriteTool(tool: string): boolean {
  return isManagedRuntimeWrite(tool) || tool === "update_wiki" || tool === "reconcile_cell";
}

function isManagedRuntimeWrite(tool: string): boolean {
  return tool === "write_locked_cell" || tool === "write_locked_cell_result" || tool === "write_locked_cells" || tool === "write_locked_cell_results" || tool === "update_wiki" || tool === "reconcile_cell";
}

function coordinationFrom(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object") return [];
  const direct = (result as { coordination?: unknown }).coordination;
  if (direct && typeof direct === "object") return [direct as Record<string, unknown>];
  return [];
}

function toolResultSeen(messages: AgentMessage[], toolName: string): boolean {
  return messages.some((message) => message.role === "tool" && message.toolName === toolName);
}

function dataframeColumns(): DataframeColumn[] {
  return [
    { id: "case_id", label: "Case", order: 0, mode: "manual" },
    { id: "workflow", label: "Workflow", order: 1, mode: "manual" },
    { id: "source_a", label: "Source A", order: 2, mode: "manual" },
    { id: "source_b", label: "Source B", order: 3, mode: "manual" },
    { id: "requirements", label: "Requirements", order: 4, mode: "manual" },
    { id: "result", label: "Result", order: 5, mode: "enrich", agentWritable: true },
    { id: "evidence", label: "Evidence", order: 6, mode: "enrich", agentWritable: true },
    { id: "risk", label: "Risk", order: 7, mode: "classify", agentWritable: true },
    { id: "trace", label: "Trace", order: 8, mode: "enrich", agentWritable: true },
    { id: "status", label: "Status", order: 9, mode: "classify", agentWritable: true },
  ];
}

function scoreChecks(checks: Record<string, boolean>): number {
  const values = Object.values(checks);
  return values.length ? values.filter(Boolean).length / values.length : 0;
}

function failedCheckSummary(checks: Record<string, boolean>): string {
  return Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name).join(", ");
}

function selectedCases(): ProfessionalEvalCase[] {
  const raw = optionValue("--cases");
  if (!raw) return PROFESSIONAL_WORKFLOW_CASES;
  const wanted = new Set(raw.split(",").map((item) => item.trim()).filter(Boolean));
  return PROFESSIONAL_WORKFLOW_CASES.filter((evalCase) => wanted.has(evalCase.id));
}

function writeAggregate(path: string, aggregate: ProfessionalRuntimeLiveAggregate): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(aggregate, null, 2) + "\n");
}

export function readProfessionalRuntimeLive(path = DEFAULT_OUT): ProfessionalRuntimeLiveAggregate | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as ProfessionalRuntimeLiveAggregate;
}

function recordAggregate(aggregate: ProfessionalRuntimeLiveAggregate, path: string, store = DEFAULT_STORE): void {
  const identity = readGitIdentity();
  const ts = Date.now();
  const caseIds = aggregate.rows.map((row) => `professional-live-runtime:${row.caseId}:${aggregate.model}`);
  const records: EvalRunRecord[] = aggregate.rows.map((row) => ({
    ts,
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    caseSetHash: computeCaseSetHash(caseIds),
    suite: "professional-live-runtime",
    caseId: `professional-live-runtime:${row.caseId}:${aggregate.model}`,
    model: aggregate.model,
    status: row.status === "passed" ? "pass" : "fail",
    score: row.score,
    checks: row.checks,
    failureOwner: row.status === "passed" ? undefined : "model",
    failureSummary: row.status === "passed" ? undefined : row.failureSummary ?? failedCheckSummary(row.checks),
    traceRef: path.replace(/\\/g, "/"),
    harnessVersion: HARNESS_VERSION,
  }));
  appendEvalRuns(records, store);
  console.log(`recorded ${records.length} professional live runtime rows to ${store} (${runKey(records[0])})`);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function positiveIntOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const route = optionValue("--real");
  const out = optionValue("--json-out") ?? DEFAULT_OUT;
  const aggregate = await runProfessionalRuntimeLive({
    model: route ?? "scripted",
    cases: selectedCases(),
    timeoutMs: positiveIntOption("--timeout-ms") ?? (route ? 180_000 : undefined),
    maxSteps: positiveIntOption("--max-steps") ?? 8,
    retryFailed: positiveIntOption("--retry-failed") ?? 0,
  });
  writeAggregate(out, aggregate);
  if (process.argv.includes("--record")) recordAggregate(aggregate, out, optionValue("--eval-store") ?? DEFAULT_STORE);
  console.log(`professional live runtime ${aggregate.passed}/${aggregate.total} passed (${(aggregate.passRate * 100).toFixed(0)}%) -> ${out}`);
  if ((process.argv.includes("--require-full") || process.argv.includes("--strict")) && !aggregate.allPassed) process.exitCode = 1;
  if (!route && process.argv.includes("--record")) console.warn("recorded scripted runtime; use --real for provider proof");
}
