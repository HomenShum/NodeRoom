import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import {
  normalizeSpreadsheetFontColor,
  resolveSpreadsheetFontColor,
  spreadsheetThemeIndexForColor,
  type SpreadsheetFontColorSource,
} from "../shared/spreadsheetFontColor";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import { readSpreadsheetBenchWorkbookForMutation } from "./spreadsheetBenchScorer";
import {
  emitSpreadsheetBenchWorkbookCandidate,
  type SpreadsheetBenchWorkbookCellPatch,
} from "./spreadsheetBenchWorkbookEmitter";
import {
  evaluateFormula,
  FormulaEvalError,
  type CellValue as FormulaEngineCellValue,
  type FormulaResult,
} from "../nodeagent/core/formulaEngine";
import { runReasoningFrame, type ReasoningFrameRunReceipt } from "../nodeagent/core/frameRunner";
import type { ReasoningFrame } from "../nodeagent/core/reasoningFrames";
import type {
  AgentModel,
  AgentTool,
  ArtifactRef,
  AwarenessView,
  CellView,
  EditOutcome,
  RoomSnapshot,
  RoomTools,
  SourceResult,
  SpreadsheetContextHit,
  TokenUsage,
} from "../nodeagent/core/types";
import { MANAGED_LOCK_SYSTEM_PROMPT } from "../nodeagent/models/prompts/systemPrompt";
import {
  EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL,
  EXECUTE_WORKBOOK_STRUCTURE_REPAIR_TOOL_NAME,
  PRODUCTION_ROOM_TOOLS,
} from "../nodeagent/skills/spreadsheet/cellMutator";
import {
  applySpreadsheetBenchStructuralRepairs,
  detectSpreadsheetBenchStructuralRepair,
  type SpreadsheetBenchStructuralRepairPlan,
  type SpreadsheetBenchStructuralRepairReceipt,
} from "./spreadsheetBenchStructuralRepair";
import {
  buildWorkbookSuggestedPlan,
  extractWorkbookTaskReferences,
  inspectWorkbookTask,
  normalizeAddress,
  normalizeFormula,
  selectWorkbookTaskCells,
  workbookCellKey,
  type WorkbookObservedCell,
  type WorkbookTaskInspection,
} from "../nodeagent/skills/spreadsheet/workbookTaskIntelligence";
import {
  buildNodeAgentTrace,
  defaultTracePlan,
  makeEvidenceReceipt,
  makeMutationReceipt,
  stableTraceHash,
  traceContextPackFromFrame,
  traceIdForRun,
  traceRef,
  type MutationReceipt,
  type NodeAgentTrace,
  type TraceRef,
} from "../nodeagent/traces";

export const SPREADSHEETBENCH_NODEAGENT_BRIDGE_SCHEMA = "noderoom.spreadsheetbench.nodeagent_bridge.v1" as const;

const BRIDGE_TOOL_NAMES = [
  "inspect_workbook",
  "execute_workbook_structure_repair",
  "execute_verified_workbook_plan",
  "verify_workbook",
  "list_artifacts",
  "read_range",
  "search_sheet_context",
  "write_locked_cell",
  "write_locked_cells",
  "say",
] as const;

const EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME = "execute_verified_workbook_plan";
const WRITE_TOOL_NAMES = new Set<string>(["write_locked_cell", "write_locked_cells"]);
const COMPOSITE_WORKBOOK_TOOL_NAMES = new Set<string>([
  EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME,
  EXECUTE_WORKBOOK_STRUCTURE_REPAIR_TOOL_NAME,
]);
const MUTATION_TOOL_NAMES = new Set<string>([...WRITE_TOOL_NAMES, ...COMPOSITE_WORKBOOK_TOOL_NAMES]);
const READ_REFERENCE_RE = /^(?:(?:'((?:[^']|'')+)'|([^!]+))!\s*)?(\$?[A-Z]{1,3}\$?[1-9][0-9]*)(?:\s*:\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*))?$/i;
const EXCEL_MAX_ROW = 1_048_576;
const EXCEL_MAX_COLUMN = 16_384;
const DEFAULT_SNAPSHOT_MAX_CELLS = 1_200;
const DEFAULT_SCAN_MAX_CELLS = 50_000;

class SpreadsheetBenchReadReferenceError extends Error {}

type StagedAgentManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  instruction: string;
  instructionType?: string;
  inputFiles: string[];
  promptFiles: string[];
};

export type SpreadsheetBenchNodeAgentBridgeStage =
  | "inspect"
  | "plan"
  | "preflight"
  | "write"
  | "verify"
  | "repair";

export type SpreadsheetBenchNodeAgentBridgeStageStatus =
  | "completed"
  | "needs_repair"
  | "blocked"
  | "failed"
  | "skipped";

export type SpreadsheetBenchNodeAgentBridgeEventRef = {
  traceId: string;
  eventIndex: number;
  step: number;
  tool: string;
  argsHash: string;
  resultHash: string;
};

export type SpreadsheetBenchNodeAgentBridgeStageReceipt = {
  traceId: string;
  stage: SpreadsheetBenchNodeAgentBridgeStage;
  status: SpreadsheetBenchNodeAgentBridgeStageStatus;
  attempts: number;
  operationCount?: number;
  summary: string;
  events: SpreadsheetBenchNodeAgentBridgeEventRef[];
};

export type SpreadsheetBenchNodeAgentRecalculationReceipt = {
  engine: "nodeagent-formula-engine";
  attemptedFormulaCount: number;
  refreshedFormulaCount: number;
  unresolvedFormulaCount: number;
  unresolved: Array<{
    sheet: string;
    address: string;
    formula: string;
    error: string;
  }>;
};

export type SpreadsheetBenchCandidateFinalizationReceipt = {
  engine: string;
  status?:
    | "completed"
    | "completed_stable_pending"
    | "not_required"
    | "preserved_pending"
    | "preserved_unsupported"
    | "preserved_error";
  beforeSha256: string;
  afterSha256: string;
  changed: boolean;
  formulaCellCount?: number;
  cacheWriteMode?: string;
  receipt: {
    path: string;
    sha256: string;
    bytes: number;
  };
};

export type SpreadsheetBenchNodeAgentBridgeReceipt = {
  schema: typeof SPREADSHEETBENCH_NODEAGENT_BRIDGE_SCHEMA;
  traceId: string;
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  candidateWorkbookPath: string;
  candidateWorkbookSha256: string;
  outcome: {
    status: "completed" | "needs_repair" | "blocked" | "failed";
    mutatingTask: boolean;
    changedCellCount: number;
    finalVerificationStatus: "passed" | "needs_repair" | "missing";
  };
  stages: Record<SpreadsheetBenchNodeAgentBridgeStage, SpreadsheetBenchNodeAgentBridgeStageReceipt>;
  isolation: {
    boundary: "agent_visible_files_only";
    agentRoot: string;
    openedAgentFiles: string[];
    evaluatorMetadataAccess: "none";
    evaluatorFileReadCount: 0;
    candidateEmittedBeforeEvaluatorAccess: true;
  };
  model: {
    name: string;
    calls: number;
    usage: TokenUsage;
  };
  recalculation: SpreadsheetBenchNodeAgentRecalculationReceipt;
  structuralRepair?: SpreadsheetBenchStructuralRepairReceipt;
  candidateFinalization?: SpreadsheetBenchCandidateFinalizationReceipt;
  frame: ReasoningFrameRunReceipt;
  trace: NodeAgentTrace;
};

export type RunSpreadsheetBenchNodeAgentBridgeOptions = {
  /** Path to the staged agent/task.json or the runner's copied agent-workspace manifest. */
  agentManifestPath: string;
  /** Candidate path consumed by SpreadsheetBench scoring after this function returns. */
  candidateWorkbookPath: string;
  model: AgentModel;
  traceId?: string;
  maxSteps?: number;
  modelTimeoutMs?: number;
  snapshotMaxCells?: number;
  scanMaxCells?: number;
  /**
   * Keep ambiguous audit tasks evidence-bounded: inspect once, then stop without
   * provider spend when the visible workbook exposes no safe write contract.
   */
  boundedAuditPlanning?: boolean;
  now?: () => number;
  applyStructuralRepairs?: (args: {
    workbookPath: string;
    repairs: SpreadsheetBenchStructuralRepairPlan[];
  }) => SpreadsheetBenchStructuralRepairReceipt | undefined | Promise<SpreadsheetBenchStructuralRepairReceipt | undefined>;
  finalizeCandidate?: (args: {
    taskId: string;
    track: SpreadsheetBenchTrack;
    category?: string;
    sourceWorkbookPath: string;
    candidateWorkbookPath: string;
    beforeSha256: string;
  }) => SpreadsheetBenchCandidateFinalizationReceipt | Promise<SpreadsheetBenchCandidateFinalizationReceipt>;
};

type OpenedAgentTask = {
  manifest: StagedAgentManifest;
  agentRoot: string;
  sourceWorkbookPath: string;
  openedAgentFiles: string[];
  promptFiles: Array<{ path: string; text: string }>;
};

type ActiveLock = {
  lockId: string;
  sheet: string;
  addresses: string[];
  reason: string;
};

/**
 * Executes one already-staged SpreadsheetBench task through the canonical
 * frameRunner -> runAgent loop. The function accepts no evaluator path and its
 * RoomTools port has no filesystem capability, so hidden manifests and gold
 * workbooks cannot enter model context or tool execution.
 */
export async function runSpreadsheetBenchNodeAgentBridge(
  options: RunSpreadsheetBenchNodeAgentBridgeOptions,
): Promise<SpreadsheetBenchNodeAgentBridgeReceipt> {
  const startedAt = (options.now ?? Date.now)();
  const task = openAgentTask(options.agentManifestPath);
  const candidateWorkbookPath = resolve(options.candidateWorkbookPath);
  assertCandidateDoesNotOverwriteAgentInput(candidateWorkbookPath, task);

  const workbook = await readSpreadsheetBenchWorkbookForMutation(task.sourceWorkbookPath);
  if (!workbook.worksheets.length) throw new Error(`SpreadsheetBench input workbook has no worksheets: ${task.sourceWorkbookPath}`);
  const intelligenceInstruction = [
    task.manifest.instruction,
    `Agent-visible input workbook name: ${basename(task.sourceWorkbookPath)}`,
  ].join("\n");

  const room = new SpreadsheetBenchWorkbookRoomTools({
    workbook,
    instruction: intelligenceInstruction,
    sourceWorkbookName: basename(task.sourceWorkbookPath),
    snapshotMaxCells: boundedPositive(options.snapshotMaxCells, DEFAULT_SNAPSHOT_MAX_CELLS),
    scanMaxCells: boundedPositive(options.scanMaxCells, DEFAULT_SCAN_MAX_CELLS),
  });
  const sourceHash = sha256File(task.sourceWorkbookPath);
  const traceId = options.traceId ?? traceIdForRun("spreadsheetbench-nodeagent", {
    taskId: task.manifest.taskId,
    sourceHash,
    startedAt,
  });
  const boundedAuditPlanning = options.boundedAuditPlanning !== false;
  const initialInspection = room.taskInspection();
  const boundedNoEvidenceAudit = boundedAuditPlanning
    && bridgeInspectionNeedsBoundedNoEvidenceCompletion(initialInspection);
  const frame = buildBridgeFrame(
    task.manifest,
    room.artifactIds(),
    traceId,
    boundedNoEvidenceAudit
      ? "Inspect visible workbook evidence and report only whether a safe mutation contract is available; do not create, edit, write, update, fill, set, delete, commit, or apply cells when none is present."
      : undefined,
  );
  const workflowController = new BridgeWorkbookWorkflowController(intelligenceInstruction, room.artifactIds()[0]);
  const effectiveModel = contractFirstBridgeModel(
    options.model,
    room,
    intelligenceInstruction,
    boundedAuditPlanning,
  );
  const tools = selectBridgeTools(
    [...PRODUCTION_ROOM_TOOLS, EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL],
    workflowController,
  );
  const frameReceipt = await runReasoningFrame({
    rt: room,
    frame,
    model: effectiveModel,
    tools,
    maxSteps: Math.max(1, Math.trunc(options.maxSteps ?? 18)),
    deadlineAt: options.modelTimeoutMs === undefined ? undefined : startedAt + Math.max(1, options.modelTimeoutMs),
    reserveMs: 0,
    compaction: {
      maxChars: 60_000,
      keepRecent: 8,
      staleTools: ["read_range", "inspect_workbook"],
    },
    includeRoomContext: false,
    systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
    additionalInstructions: bridgeInstructions(task, room.artifactIds()),
    now: options.now,
  });

  const recalculation = room.recalculateChangedFormulas();
  mkdirSync(dirname(candidateWorkbookPath), { recursive: true });
  await emitSpreadsheetBenchWorkbookCandidate({
    sourceWorkbookPath: task.sourceWorkbookPath,
    candidateWorkbookPath,
    patches: room.packageMutations(),
  });
  const structuralPlans = room.packageStructuralRepairs();
  const structuralRepair = structuralPlans.length > 0
    ? await (options.applyStructuralRepairs ?? applySpreadsheetBenchStructuralRepairs)({
        workbookPath: candidateWorkbookPath,
        repairs: structuralPlans,
      })
    : undefined;
  const emittedCandidateSha256 = sha256File(candidateWorkbookPath);
  const candidateFinalization = options.finalizeCandidate
    ? await options.finalizeCandidate({
        taskId: task.manifest.taskId,
        track: task.manifest.track,
        ...(task.manifest.category ? { category: task.manifest.category } : {}),
        sourceWorkbookPath: task.sourceWorkbookPath,
        candidateWorkbookPath,
        beforeSha256: emittedCandidateSha256,
      })
    : undefined;
  const candidateWorkbookSha256 = sha256File(candidateWorkbookPath);
  if (candidateFinalization) {
    if (candidateFinalization.beforeSha256 !== emittedCandidateSha256) {
      throw new Error("SpreadsheetBench candidate finalizer beforeSha256 does not match the emitted workbook");
    }
    if (candidateFinalization.afterSha256 !== candidateWorkbookSha256) {
      throw new Error("SpreadsheetBench candidate finalizer afterSha256 does not match the finalized workbook");
    }
    if (candidateFinalization.changed !== (emittedCandidateSha256 !== candidateWorkbookSha256)) {
      throw new Error("SpreadsheetBench candidate finalizer changed flag does not match the workbook hashes");
    }
  }
  const stages = buildStageReceipts(traceId, frameReceipt);
  const mutatingTask = room.taskInspection().mutatingTask;
  const outcome = bridgeOutcome(
    frameReceipt,
    stages,
    mutatingTask,
    room.changedCellCount(),
    bridgeWorkbookRepairContract(room).requiredRepairs.length,
    workflowController.pendingVerificationCount(),
    candidateFinalization?.status === "completed" ? 0 : recalculation.unresolvedFormulaCount,
  );
  const trace = buildBridgeTrace({
    traceId,
    startedAt,
    manifest: task.manifest,
    frame,
    frameReceipt,
    stages,
    candidateWorkbookPath,
    candidateWorkbookSha256,
    artifactIds: room.artifactIds(),
    outcomeStatus: outcome.status,
    recalculation,
    structuralRepair,
    candidateFinalization,
  });

  return {
    schema: SPREADSHEETBENCH_NODEAGENT_BRIDGE_SCHEMA,
    traceId,
    taskId: task.manifest.taskId,
    track: task.manifest.track,
    ...(task.manifest.category ? { category: task.manifest.category } : {}),
    candidateWorkbookPath,
    candidateWorkbookSha256,
    outcome,
    stages,
    isolation: {
      boundary: "agent_visible_files_only",
      agentRoot: task.agentRoot,
      openedAgentFiles: task.openedAgentFiles,
      evaluatorMetadataAccess: "none",
      evaluatorFileReadCount: 0,
      candidateEmittedBeforeEvaluatorAccess: true,
    },
    model: {
      name: effectiveModel.name,
      calls: frameReceipt.agentResult.usage.modelCalls,
      usage: {
        inputTokens: frameReceipt.agentResult.usage.inputTokens,
        outputTokens: frameReceipt.agentResult.usage.outputTokens,
        ...(frameReceipt.agentResult.usage.cachedInputTokens === undefined
          ? {}
          : { cachedInputTokens: frameReceipt.agentResult.usage.cachedInputTokens }),
      },
    },
    recalculation,
    ...(structuralRepair ? { structuralRepair } : {}),
    ...(candidateFinalization ? { candidateFinalization } : {}),
    frame: frameReceipt,
    trace,
  };
}

type BridgeDeterministicContract = {
  complete: boolean;
  plans: Array<{
    sheet: string;
    operations: ReturnType<typeof buildWorkbookSuggestedPlan>["operations"];
    planHash: string;
  }>;
};

/**
 * A complete workbook-invariant contract should not spend hundreds of
 * thousands of provider tokens asking an LLM to copy an already proven plan.
 * This policy still runs through frameRunner and the production tools. It only
 * handles explicitly complete contracts; all ambiguous work delegates to the
 * configured model with the same message/tool history.
 */
function contractFirstBridgeModel(
  delegate: AgentModel,
  room: SpreadsheetBenchWorkbookRoomTools,
  instruction: string,
  boundedAuditPlanning: boolean,
): AgentModel {
  let delegated = false;
  let deterministicStarted = false;
  let phase: "idle"
    | "inspect_requested"
    | "evidence_inspect_requested"
    | "unresolved_inspect_requested"
    | "execute_requested"
    | "structure_execute_requested" = "idle";
  let activePlan: BridgeDeterministicContract["plans"][number] | undefined;
  let activeStructuralPlan: SpreadsheetBenchStructuralRepairPlan | undefined;
  let callCounter = 0;
  const completedPlanHashes = new Set<string>();
  const completedStructuralRepairIds = new Set<string>();

  return {
    get name() {
      return delegated ? delegate.name : "nodeagent/workbook-contract";
    },
    ...(delegate.routeState ? { routeState: () => delegate.routeState!() } : {}),
    async next(input) {
      if (delegated) return boundedBridgeDelegateNext(delegate, input);

      const latest = latestBridgeToolResult(input.messages);
      if (phase === "unresolved_inspect_requested") {
        return {
          text: latest?.tool === "inspect_workbook" && asRecord(latest.result)?.ok === true
            ? "The visible workbook inspection found no high-confidence write contract. The audit remains unresolved without mutation."
            : "The bounded workbook inspection did not produce executable evidence. The audit remains unresolved without mutation.",
          toolCalls: [],
          done: true,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
      if (phase === "evidence_inspect_requested") {
        if (latest?.tool !== "inspect_workbook" || asRecord(latest.result)?.ok !== true) {
          return {
            text: "The bounded workbook inspection failed, so no provider-authored mutation was attempted.",
            toolCalls: [],
            done: true,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        delegated = true;
        return boundedBridgeDelegateNext(delegate, input);
      }
      if (phase === "inspect_requested") {
        const inspectionSucceeded = asRecord(latest?.result)?.ok === true
          || isCompactedBridgeToolResult(latest?.result);
        if (latest?.tool !== "inspect_workbook" || !inspectionSucceeded || (!activePlan && !activeStructuralPlan)) {
          delegated = true;
          return boundedBridgeDelegateNext(delegate, input);
        }
        if (activeStructuralPlan) {
          phase = "structure_execute_requested";
          return {
            text: `Executing the complete visible structural workbook contract for ${activeStructuralPlan.sheet}.`,
            toolCalls: [{
              id: `workbook-contract-${++callCounter}`,
              tool: EXECUTE_WORKBOOK_STRUCTURE_REPAIR_TOOL_NAME,
              args: {
                instruction,
                artifactId: activeStructuralPlan.sheet,
                repairId: activeStructuralPlan.repairId,
              },
            }],
            done: false,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        const plan = activePlan;
        if (!plan) {
          delegated = true;
          return boundedBridgeDelegateNext(delegate, input);
        }
        phase = "execute_requested";
        return {
          text: `Executing the complete visible workbook contract for ${plan.sheet}.`,
          toolCalls: [{
            id: `workbook-contract-${++callCounter}`,
            tool: EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME,
            args: {
              instruction,
              artifactId: plan.sheet,
              maxCells: 200,
              reason: "complete visible workbook invariant contract",
            },
          }],
          done: false,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }

      if (phase === "structure_execute_requested") {
        const result = asRecord(latest?.result);
        if (latest?.tool !== EXECUTE_WORKBOOK_STRUCTURE_REPAIR_TOOL_NAME
          || result?.status !== "completed"
          || !activeStructuralPlan) {
          delegated = true;
          return boundedBridgeDelegateNext(delegate, input);
        }
        completedStructuralRepairIds.add(activeStructuralPlan.repairId);
        activeStructuralPlan = undefined;
        phase = "idle";
      }

      if (phase === "execute_requested") {
        const result = asRecord(latest?.result);
        if (latest?.tool !== EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME || !activePlan) {
          delegated = true;
          return boundedBridgeDelegateNext(delegate, input);
        }
        if (result?.status !== "completed") {
          if (completedPlanHashes.size > 0) {
            return {
              text: "The verified deterministic workbook repairs are complete; a stale follow-on contract did not pass current preflight and was not applied.",
              toolCalls: [],
              done: true,
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
          delegated = true;
          return boundedBridgeDelegateNext(delegate, input);
        }
        completedPlanHashes.add(activePlan.planHash);
        activePlan = undefined;
        phase = "idle";
      }

      const structuralContract = room.workbookStructureRepairContract({ instruction });
      if (structuralContract && !completedStructuralRepairIds.has(structuralContract.repairId)) {
        deterministicStarted = true;
        activeStructuralPlan = structuralContract;
        phase = "inspect_requested";
        return {
          text: `Inspecting ${structuralContract.sheet} before a governed structural workbook repair.`,
          toolCalls: [{
            id: `workbook-contract-${++callCounter}`,
            tool: "inspect_workbook",
            args: { instruction, artifactId: structuralContract.sheet, maxCells: 200 },
          }],
          done: false,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }

      const contract = bridgeDeterministicContract(room);
      if (!deterministicStarted) {
        if (!contract.complete || contract.plans.length === 0) {
          const inspection = room.taskInspection();
          if (boundedAuditPlanning && inspection.mutatingTask && inspection.auditFocus) {
            const evidenceArtifact = bridgeInspectionEvidenceArtifact(inspection) ?? room.artifactIds()[0];
            phase = bridgeInspectionHasWriteEvidence(inspection)
              ? "evidence_inspect_requested"
              : "unresolved_inspect_requested";
            deterministicStarted = true;
            return {
              text: bridgeInspectionHasWriteEvidence(inspection)
                ? "Inspecting the highest-confidence visible audit evidence before bounded model planning."
                : "Inspecting the workbook once before recording an evidence-bounded unresolved audit.",
              toolCalls: [{
                id: `workbook-contract-${++callCounter}`,
                tool: "inspect_workbook",
                args: {
                  instruction,
                  ...(evidenceArtifact ? { artifactId: evidenceArtifact } : {}),
                  maxCells: 200,
                },
              }],
              done: false,
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
          delegated = true;
          return boundedBridgeDelegateNext(delegate, input);
        }
        deterministicStarted = true;
      }

      const nextPlan = contract.plans.find((plan) => !completedPlanHashes.has(plan.planHash));
      if (nextPlan) {
        activePlan = nextPlan;
        phase = "inspect_requested";
        return {
          text: `Inspecting ${nextPlan.sheet} before a bounded deterministic workbook repair.`,
          toolCalls: [{
            id: `workbook-contract-${++callCounter}`,
            tool: "inspect_workbook",
            args: { instruction, artifactId: nextPlan.sheet, maxCells: 200 },
          }],
          done: false,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }

      if (completedPlanHashes.size === 0 && completedStructuralRepairIds.size === 0) {
        delegated = true;
        return boundedBridgeDelegateNext(delegate, input);
      }
      return {
        text: "The complete visible workbook contract passed bounded preflight, managed writes, and post-write verification.",
        toolCalls: [],
        done: true,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

const MAX_CONSECUTIVE_FAILED_PREFLIGHTS = 3;

async function boundedBridgeDelegateNext(
  delegate: AgentModel,
  input: Parameters<AgentModel["next"]>[0],
): ReturnType<AgentModel["next"]> {
  const failedPreflights = consecutiveFailedBridgePreflights(input.messages);
  if (failedPreflights >= MAX_CONSECUTIVE_FAILED_PREFLIGHTS) {
    return {
      text: `The bounded workbook repair budget ended after ${failedPreflights} consecutive failed preflights. No unverified mutation was applied.`,
      toolCalls: [],
      done: true,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  return delegate.next(input);
}

function consecutiveFailedBridgePreflights(
  messages: Parameters<AgentModel["next"]>[0]["messages"],
): number {
  let failures = 0;
  for (const message of messages) {
    if (message.role !== "tool" || message.toolName !== "verify_workbook") continue;
    const result = parseBridgeToolResult(message.content);
    if (result?.phase !== "preflight") continue;
    failures = result.status === "passed" && result.ok !== false ? 0 : failures + 1;
  }
  return failures;
}

function bridgeInspectionHasWriteEvidence(inspection: WorkbookTaskInspection): boolean {
  return inspection.formulaRepairSuggestions.length > 0
    || inspection.valueSuggestions.length > 0
    || inspection.styleSuggestions.length > 0
    || inspection.formulaFillSuggestions.some((suggestion) => suggestion.operations.length > 0);
}

function bridgeInspectionNeedsBoundedNoEvidenceCompletion(inspection: WorkbookTaskInspection): boolean {
  return inspection.mutatingTask
    && !!inspection.auditFocus
    && inspection.deterministicPlan?.status !== "complete"
    && !bridgeInspectionHasWriteEvidence(inspection);
}

function bridgeInspectionEvidenceArtifact(inspection: WorkbookTaskInspection): string | undefined {
  return inspection.formulaRepairSuggestions[0]?.sheet
    ?? inspection.valueSuggestions[0]?.sheet
    ?? inspection.styleSuggestions[0]?.sheet
    ?? inspection.formulaFillSuggestions[0]?.sheet
    ?? inspection.recommendedReads[0]?.sheet
    ?? inspection.referencedSheets[0];
}

function parseBridgeToolResult(content: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(content));
  } catch {
    return undefined;
  }
}

function isCompactedBridgeToolResult(result: unknown): boolean {
  return typeof result === "string"
    && result.startsWith("[")
    && result.includes("payload compacted to save context");
}

function bridgeDeterministicContract(room: SpreadsheetBenchWorkbookRoomTools): BridgeDeterministicContract {
  const inspection = room.taskInspection();
  if (inspection.deterministicPlan?.status !== "complete") return { complete: false, plans: [] };
  const plans = inspection.deterministicPlan.sheets.map((sheet) => {
    const suggested = buildWorkbookSuggestedPlan(inspection, sheet);
    return {
      sheet,
      operations: suggested.operations,
      conflicts: suggested.conflicts,
      planHash: stableTraceHash({ sheet, operations: suggested.operations }),
    };
  });
  const operationCount = plans.reduce((total, plan) => total + plan.operations.length, 0);
  const complete = plans.every((plan) => plan.conflicts.length === 0 && plan.operations.length > 0)
    && operationCount === inspection.deterministicPlan.operationCount;
  return {
    complete,
    plans: complete
      ? plans.map(({ sheet, operations, planHash }) => ({ sheet, operations, planHash }))
      : [],
  };
}

function latestBridgeToolResult(messages: Parameters<AgentModel["next"]>[0]["messages"]): {
  tool: string;
  result: unknown;
} | undefined {
  const message = [...messages].reverse().find((candidate) =>
    candidate.role === "tool"
    && candidate.toolName
    && candidate.toolName !== "compaction");
  if (!message?.toolName) return undefined;
  try {
    return { tool: message.toolName, result: JSON.parse(message.content) as unknown };
  } catch {
    return { tool: message.toolName, result: message.content };
  }
}

class SpreadsheetBenchWorkbookRoomTools implements RoomTools {
  private readonly workbook: ExcelJS.Workbook;
  private readonly instruction: string;
  private readonly sourceWorkbookName: string;
  private readonly snapshotMaxCells: number;
  private readonly scanMaxCells: number;
  private readonly versions = new Map<string, number>();
  private readonly locks = new Map<string, ActiveLock>();
  private readonly changedTargets = new Map<string, {
    sheet: string;
    address: string;
    numFmtTouched: boolean;
    fontColorTouched: boolean;
    originalState: WorkbookCellSemanticState;
  }>();
  private readonly structuralRepairs: SpreadsheetBenchStructuralRepairPlan[] = [];
  private readonly chat: string[] = [];
  private lockCounter = 0;
  private draftCounter = 0;
  private workbookVersion = 1;
  private mutations = 0;
  private initialDeterministicInspection?: WorkbookTaskInspection;
  private inspectionCache?: { workbookVersion: number; inspection: WorkbookTaskInspection };

  constructor(args: {
    workbook: ExcelJS.Workbook;
    instruction: string;
    sourceWorkbookName: string;
    snapshotMaxCells: number;
    scanMaxCells: number;
  }) {
    this.workbook = args.workbook;
    this.instruction = args.instruction;
    this.sourceWorkbookName = args.sourceWorkbookName;
    this.snapshotMaxCells = args.snapshotMaxCells;
    this.scanMaxCells = args.scanMaxCells;
  }

  artifactIds(): string[] {
    return this.workbook.worksheets.map((sheet) => sheet.name);
  }

  changedCellCount(): number {
    return this.mutations;
  }

  packageMutations(): SpreadsheetBenchWorkbookCellPatch[] {
    return [...this.changedTargets.values()]
      .sort((left, right) => left.sheet.localeCompare(right.sheet) || left.address.localeCompare(right.address))
      .flatMap((target) => {
        const cell = this.sheet(target.sheet).getCell(target.address);
        const currentState = workbookCellSemanticState(cell);
        if (sameWorkbookCellSemanticState(
          target.originalState,
          currentState,
          target.numFmtTouched,
          target.fontColorTouched,
        )) return [];
        return [workbookCellPatch(
          target.sheet,
          target.address,
          cell,
          target.originalState,
          target.numFmtTouched,
          target.fontColorTouched,
        )];
      });
  }

  packageStructuralRepairs(): SpreadsheetBenchStructuralRepairPlan[] {
    return this.structuralRepairs.map((repair) => ({
      ...repair,
      formulaRepairs: repair.formulaRepairs.map((formula) => ({ ...formula })),
      evidence: [...repair.evidence],
    }));
  }

  workbookStructureRepairContract(args: {
    instruction: string;
    artifactId?: string;
  }): SpreadsheetBenchStructuralRepairPlan | undefined {
    if (args.instruction.trim() !== this.instruction.trim()) return undefined;
    const plan = detectSpreadsheetBenchStructuralRepair({
      instruction: this.instruction,
      sheetNames: this.artifactIds(),
      cells: this.observedCells(),
    });
    if (args.artifactId && plan?.sheet.toLowerCase() !== args.artifactId.toLowerCase()) return undefined;
    return plan;
  }

  executeWorkbookStructureRepair(args: {
    instruction: string;
    artifactId?: string;
    repairId: string;
  }): Record<string, unknown> {
    const plan = this.workbookStructureRepairContract(args);
    if (!plan || plan.repairId !== args.repairId) {
      return {
        ok: false,
        status: "needs_repair",
        operationCount: 0,
        phases: {
          preflight: { status: "needs_repair", issues: ["stale_or_missing_structural_contract"] },
          write: { status: "skipped" },
          verify: { status: "skipped" },
        },
      };
    }

    const worksheet = this.sheet(plan.sheet);
    worksheet.spliceRows(plan.insertRow, 0, []);
    worksheet.getCell(plan.labelCell).value = plan.label;
    worksheet.getCell(plan.selectorCell).value = plan.selectorValue;
    let formulaReplacementCount = 0;
    const formulaReplacementTargets: string[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cellFormula(cell);
        if (!formula || !formula.includes(plan.formulaSearch)) return;
        cell.value = {
          formula: formula.replaceAll(plan.formulaSearch, plan.formulaReplace),
          result: 0,
        } as ExcelJS.CellValue;
        formulaReplacementCount += 1;
        formulaReplacementTargets.push(`${worksheet.name}!${cell.address}`);
      });
    });
    if (formulaReplacementCount !== plan.expectedFormulaReplacementCount) {
      throw new Error(
        `Structural repair ${plan.repairId} expected ${plan.expectedFormulaReplacementCount} formula replacements but applied ${formulaReplacementCount}`,
      );
    }
    for (const formulaRepair of plan.formulaRepairs) {
      this.sheet(formulaRepair.sheet).getCell(formulaRepair.cell).value = {
        formula: formulaRepair.formula.replace(/^=/, ""),
        result: 0,
      } as ExcelJS.CellValue;
    }
    this.structuralRepairs.push(plan);
    this.workbookVersion += 1;
    this.mutations += plan.operationCount;
    const targets = [
      `${worksheet.name}!${plan.insertRow}:${plan.insertRow}`,
      `${worksheet.name}!${plan.labelCell}`,
      `${worksheet.name}!${plan.selectorCell}`,
      ...formulaReplacementTargets,
      ...plan.formulaRepairs.map((repair) => `${repair.sheet}!${repair.cell}`),
    ];
    if (targets.length !== plan.operationCount) {
      throw new Error(
        `Structural repair ${plan.repairId} expected ${plan.operationCount} mutation targets but recorded ${targets.length}`,
      );
    }

    const remaining = detectSpreadsheetBenchStructuralRepair({
      instruction: this.instruction,
      sheetNames: this.artifactIds(),
      cells: this.observedCells(),
    });
    const verified = !remaining;
    return {
      ok: verified,
      status: verified ? "completed" : "needs_repair",
      repairId: plan.repairId,
      operationCount: plan.operationCount,
      targets,
      formulaReplacementCount,
      explicitFormulaRepairCount: plan.formulaRepairs.length,
      phases: {
        preflight: {
          status: "passed",
          basis: plan.basis,
          evidence: plan.evidence,
        },
        write: {
          status: "completed",
          insertedRowCount: 1,
          formulaReplacementCount,
          explicitFormulaRepairCount: plan.formulaRepairs.length,
        },
        verify: {
          status: verified ? "passed" : "needs_repair",
          remainingRepairId: remaining?.repairId,
        },
      },
    };
  }

  taskInspection() {
    this.recalculateChangedFormulas();
    if (this.inspectionCache?.workbookVersion === this.workbookVersion) {
      return this.inspectionCache.inspection;
    }
    const cells = this.observedCells();
    const current = inspectWorkbookTask({
      instruction: this.instruction,
      sheetNames: this.artifactIds(),
      cells,
    });
    if (!this.initialDeterministicInspection && current.deterministicPlan?.status === "complete") {
      this.initialDeterministicInspection = current;
    }
    const inspection = this.initialDeterministicInspection
      ? remainingDeterministicInspection(this.initialDeterministicInspection, current, cells)
      : current;
    this.inspectionCache = { workbookVersion: this.workbookVersion, inspection };
    return inspection;
  }

  verifiedWorkbookInspection(args: { instruction: string; artifactId: string }): WorkbookTaskInspection | undefined {
    if (args.instruction.trim() !== this.instruction.trim()) return undefined;
    const inspection = this.taskInspection();
    if (inspection.deterministicPlan?.status !== "complete") return undefined;
    return focusDeterministicInspection(inspection, args.artifactId);
  }

  async snapshot(artifactId?: string): Promise<RoomSnapshot> {
    this.recalculateChangedFormulas();
    const allCells = this.observedCells();
    const inspection = this.taskInspection();
    const sheet = artifactId ? this.sheet(artifactId) : this.preferredInspectionSheet(allCells, inspection);
    const selected = selectWorkbookTaskCells({
      inspection,
      cells: allCells.filter((cell) => cell.sheet === sheet.name),
      maxCells: this.snapshotMaxCells,
    });
    return {
      artifactId: sheet.name,
      version: this.workbookVersion,
      kind: "sheet",
      rows: [],
      elements: selected.map((observed) => {
        const cell = sheet.getCell(observed.address);
        return {
          id: observed.address,
          value: roomCellValue(cell),
          version: this.version(sheet.name, observed.address, cell),
          locked: this.isLocked(sheet.name, observed.address),
        };
      }),
    };
  }

  async awareness(): Promise<AwarenessView> {
    return {
      activeLocks: [...this.locks.values()].map((lock) => ({
        lockId: lock.lockId,
        elementIds: lock.addresses,
        holder: "spreadsheetbench-nodeagent",
        reason: lock.reason,
      })),
      agents: [{ name: "SpreadsheetBench NodeAgent", scope: "candidate workbook", status: "active" }],
      recentTrace: [...this.chat],
      autoAllow: true,
    };
  }

  async listArtifacts(): Promise<ArtifactRef[]> {
    return this.workbook.worksheets.map((sheet) => ({
      id: sheet.name,
      title: sheet.name,
      kind: "sheet",
      readHint: `Use artifactId ${JSON.stringify(sheet.name)} with A1 cells or bounded ranges such as B2:F20.`,
    }));
  }

  async readRange(elementIds: string[], artifactId?: string): Promise<CellView[]> {
    this.recalculateChangedFormulas();
    const fallbackSheet = this.sheet(artifactId);
    const requested = elementIds.length
      ? elementIds
      : this.observedCells().filter((cell) => cell.sheet === fallbackSheet.name).slice(0, 40).map((cell) => cell.address);
    const targets: Array<{ sheet: ExcelJS.Worksheet; address: string; hint?: string }> = [];
    const seen = new Set<string>();
    for (let requestedIndex = 0; requestedIndex < requested.length; requestedIndex += 1) {
      if (targets.length >= this.snapshotMaxCells) {
        if (targets[0]) targets[0].hint = appendReadHint(targets[0].hint, "Additional requested ranges were omitted at the bounded read limit; request smaller subranges.");
        break;
      }
      const elementId = requested[requestedIndex];
      const reference = parseReadReference(elementId);
      if (!reference) throw new SpreadsheetBenchReadReferenceError(`Invalid SpreadsheetBench cell address or range: ${elementId}`);
      let sheet: ExcelJS.Worksheet;
      try {
        sheet = this.sheet(reference.sheetName ?? fallbackSheet.name);
      } catch (error) {
        throw new SpreadsheetBenchReadReferenceError(error instanceof Error ? error.message : String(error));
      }
      const remaining = this.snapshotMaxCells - targets.length;
      const expansion = expandReadRange(reference.start, reference.end, remaining);
      const firstTargetIndex = targets.length;
      for (const address of expansion.addresses) {
        const key = cellKey(sheet.name, address);
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ sheet, address });
        if (targets.length >= this.snapshotMaxCells) break;
      }
      if (expansion.truncated && targets[firstTargetIndex]) {
        targets[firstTargetIndex].hint = `Requested ${sheet.name}!${reference.start}:${reference.end} contains ${expansion.totalCells} cells; read_range returned the first ${expansion.addresses.length} in row-major order. Request smaller subranges for the remainder.`;
      }
      if (targets.length >= this.snapshotMaxCells) {
        if (requestedIndex < requested.length - 1 && targets[0]) {
          targets[0].hint = appendReadHint(targets[0].hint, "Additional requested ranges were omitted at the bounded read limit; request smaller subranges.");
        }
        break;
      }
    }
    return targets.map((target) => {
      const cell = target.sheet.getCell(target.address);
      return {
        id: target.address,
        value: roomCellValue(cell),
        version: this.version(target.sheet.name, target.address, cell),
        locked: this.isLocked(target.sheet.name, target.address)
          ? { by: "spreadsheetbench-nodeagent", reason: "managed workbook write" }
          : null,
        ...(target.hint ? { hint: target.hint } : {}),
      };
    });
  }

  async searchSheetContext(query: string, artifactId?: string, limit = 20): Promise<SpreadsheetContextHit[]> {
    const sheet = this.sheet(artifactId);
    const allCells = this.observedCells();
    const inspection = inspectWorkbookTask({
      instruction: query,
      sheetNames: this.artifactIds(),
      cells: allCells,
    });
    const selected = selectWorkbookTaskCells({
      inspection,
      cells: allCells.filter((cell) => cell.sheet === sheet.name),
      maxCells: Math.max(1, Math.min(20, Math.trunc(limit))),
    });
    return selected.map((observed, index) => ({
      kind: "cell" as const,
      elementId: observed.address,
      coordinate: observed.address,
      rowHeader: this.rowHeader(sheet, observed.address),
      columnHeader: this.columnHeader(sheet, observed.address),
      rawValue: displayValue(observed.value),
      semanticSummary: observed.formula
        ? `${sheet.name}!${observed.address} formula ${observed.formula}`
        : `${sheet.name}!${observed.address} ${displayValue(observed.value)}`,
      score: Number((1 - index / Math.max(1, selected.length + 1)).toFixed(6)),
    }));
  }

  async proposeLock(elementIds: string[], reason: string, artifactId?: string) {
    const sheet = this.sheet(artifactId);
    const addresses = elementIds.map((elementId) => this.target(elementId, sheet.name).address);
    const blocking = [...this.locks.values()].find((lock) =>
      lock.sheet.toLowerCase() === sheet.name.toLowerCase() && lock.addresses.some((address) => addresses.includes(address)));
    if (blocking) return { ok: false as const, reason: blocking.reason, lockId: blocking.lockId };
    const lockId = `sbench-lock-${++this.lockCounter}`;
    this.locks.set(lockId, { lockId, sheet: sheet.name, addresses, reason });
    return { ok: true as const, lockId };
  }

  async releaseLock(lockId: string) {
    if (!this.locks.delete(lockId)) return { ok: false, reason: `unknown lock ${lockId}`, merged: [] };
    return { ok: true, merged: [] };
  }

  async editCell(
    elementId: string,
    value: unknown,
    baseVersion: number,
    artifactId?: string,
    kind: "set" | "create" | "delete" = "set",
  ): Promise<EditOutcome> {
    const target = this.target(elementId, this.sheet(artifactId).name);
    const cell = target.sheet.getCell(target.address);
    const originalState = workbookCellSemanticState(cell);
    const currentVersion = this.version(target.sheet.name, target.address, cell);
    if (kind === "create" && currentVersion !== 0) {
      return { ok: false, conflict: true, expected: baseVersion, actual: currentVersion };
    }
    if (baseVersion !== currentVersion) {
      return { ok: false, conflict: true, expected: baseVersion, actual: currentVersion };
    }

    if (kind === "delete") {
      cell.value = null;
    } else {
      applyRoomValue(cell, value);
    }
    const nextVersion = currentVersion + 1;
    this.versions.set(cellKey(target.sheet.name, target.address), nextVersion);
    const targetKey = cellKey(target.sheet.name, target.address);
    const priorTarget = this.changedTargets.get(targetKey);
    this.changedTargets.set(targetKey, {
      sheet: target.sheet.name,
      address: target.address,
      numFmtTouched: priorTarget?.numFmtTouched === true || typeof asRecord(value)?.numFmt === "string",
      fontColorTouched: priorTarget?.fontColorTouched === true || normalizeSpreadsheetFontColor(asRecord(value)?.fontColor) !== undefined,
      originalState: priorTarget?.originalState ?? originalState,
    });
    this.workbookVersion += 1;
    this.mutations += 1;
    return { ok: true, version: nextVersion, mutationReceiptId: `sbench-mutation-${this.mutations}` };
  }

  recalculateChangedFormulas(): SpreadsheetBenchNodeAgentRecalculationReceipt {
    const unresolved: SpreadsheetBenchNodeAgentRecalculationReceipt["unresolved"] = [];
    const cache = new Map<string, FormulaResult>();
    const evaluating = new Set<string>();
    let attemptedFormulaCount = 0;
    let refreshedFormulaCount = 0;

    const evaluateCell = (sheet: ExcelJS.Worksheet, address: string): FormulaResult => {
      const key = cellKey(sheet.name, address);
      const cached = cache.get(key);
      if (cached) return cached;
      if (evaluating.has(key)) return { error: "#CYCLE!" };

      const cell = sheet.getCell(normalizeAddress(address));
      const formula = cellFormula(cell);
      if (!formula) {
        const scalar = formulaEngineScalar(cell);
        const result: FormulaResult = scalar === undefined ? { error: "#VALUE!" } : { value: scalar };
        cache.set(key, result);
        return result;
      }
      if (formula.includes("!")) {
        const scalar = formulaCachedScalar(cell);
        const result: FormulaResult = scalar === undefined ? { error: "#REF!" } : { value: scalar };
        cache.set(key, result);
        return result;
      }

      evaluating.add(key);
      const result = evaluateFormula(formula, {
        getCell: (reference) => {
          const dependency = evaluateCell(sheet, reference);
          if ("error" in dependency) throw new FormulaEvalError(dependency.error);
          return dependency.value;
        },
      });
      evaluating.delete(key);
      cache.set(key, result);
      return result;
    };

    for (const target of [...this.changedTargets.values()].sort((left, right) =>
      left.sheet.localeCompare(right.sheet) || left.address.localeCompare(right.address))) {
      const sheet = this.sheet(target.sheet);
      const cell = sheet.getCell(target.address);
      const currentState = workbookCellSemanticState(cell);
      const contentUnchanged = target.originalState.kind === currentState.kind
        && target.originalState.formula === currentState.formula
        && target.originalState.valueKey === currentState.valueKey;
      if (contentUnchanged) continue;
      const formula = cellFormula(cell);
      if (!formula) continue;
      attemptedFormulaCount += 1;
      if (formula.includes("!")) {
        unresolved.push({
          sheet: sheet.name,
          address: target.address,
          formula,
          error: "cross_sheet_reference_unsupported",
        });
        continue;
      }
      const result = evaluateCell(sheet, target.address);
      if ("error" in result) {
        unresolved.push({
          sheet: sheet.name,
          address: target.address,
          formula,
          error: result.error,
        });
        continue;
      }
      setFormulaCachedResult(cell, result.value);
      refreshedFormulaCount += 1;
    }

    return {
      engine: "nodeagent-formula-engine",
      attemptedFormulaCount,
      refreshedFormulaCount,
      unresolvedFormulaCount: unresolved.length,
      unresolved,
    };
  }

  async createDraft() {
    return { draftId: `sbench-draft-${++this.draftCounter}` };
  }

  async say(text: string): Promise<void> {
    this.chat.push(text);
  }

  async fetchSource(): Promise<SourceResult> {
    return { ok: false, error: "network access is not available inside the SpreadsheetBench candidate boundary" };
  }

  private observedCells(): WorkbookObservedCell[] {
    const cells: WorkbookObservedCell[] = [];
    let scanned = 0;
    for (const sheet of this.workbook.worksheets) {
      sheet.eachRow({ includeEmpty: false }, (row) => {
        if (scanned >= this.scanMaxCells) return;
        row.eachCell({ includeEmpty: true }, (cell) => {
          if (scanned >= this.scanMaxCells) return;
          cells.push(observedCell(sheet, cell, this.version(sheet.name, cell.address, cell)));
          scanned += 1;
        });
      });
    }

    const byKey = new Map(cells.map((cell) => [cellKey(cell.sheet, cell.address), cell]));
    const references = extractWorkbookTaskReferences(this.instruction, this.artifactIds());
    for (const reference of references) {
      const candidateSheets = reference.sheet
        ? this.workbook.worksheets.filter((sheet) => sheet.name.toLowerCase() === reference.sheet!.toLowerCase())
        : this.workbook.worksheets;
      for (const sheet of candidateSheets) {
        for (const address of expandRange(reference.start, reference.end, 256)) {
          const cell = sheet.getCell(address);
          const observed = observedCell(sheet, cell, this.version(sheet.name, address, cell));
          byKey.set(cellKey(sheet.name, address), observed);
        }
      }
    }
    return [...byKey.values()];
  }

  private sheet(artifactId?: string): ExcelJS.Worksheet {
    if (!artifactId) return this.workbook.worksheets[0];
    const sheet = this.workbook.worksheets.find((candidate) => candidate.name.toLowerCase() === artifactId.toLowerCase());
    if (!sheet) throw new Error(`Unknown workbook artifact ${JSON.stringify(artifactId)}; visible sheets: ${this.artifactIds().join(", ")}`);
    return sheet;
  }

  private preferredInspectionSheet(
    cells: WorkbookObservedCell[],
    inspection: ReturnType<typeof inspectWorkbookTask>,
  ): ExcelJS.Worksheet {
    const sourceTerms = basename(this.sourceWorkbookName, ".xlsx")
      .replace(/^\d+[-_ ]*/, "")
      .replace(/[_-]?input$/i, "")
      .toLowerCase()
      .match(/[a-z][a-z0-9]{3,}/g)
      ?.filter((term) => !new Set(["file", "input", "incorrect", "inconsistent", "coding", "workbook"]).has(term)) ?? [];
    const scores = new Map(this.workbook.worksheets.map((sheet) => [sheet.name, 0]));
    for (const cell of cells) {
      const haystack = `${displayValue(cell.value)} ${cell.formula ?? ""}`.toLowerCase();
      const termMatches = sourceTerms.filter((term) => haystack.includes(term) || haystack.includes(`${term}s`)).length;
      if (termMatches > 0) scores.set(cell.sheet, (scores.get(cell.sheet) ?? 0) + termMatches * (cell.formula ? 12 : 4));
    }
    for (const finding of inspection.findings) {
      const weight = finding.severity === "error" ? 30 : finding.severity === "warning" ? 8 : 2;
      scores.set(finding.sheet, (scores.get(finding.sheet) ?? 0) + weight);
    }
    for (const suggestion of inspection.formulaRepairSuggestions) {
      scores.set(suggestion.sheet, (scores.get(suggestion.sheet) ?? 0) + (suggestion.confidence === "high" ? 24 : 8));
    }
    for (const suggestion of inspection.styleSuggestions) {
      scores.set(suggestion.sheet, (scores.get(suggestion.sheet) ?? 0) + 24);
    }
    const selected = [...scores.entries()]
      .sort((left, right) => right[1] - left[1] || this.artifactIds().indexOf(left[0]) - this.artifactIds().indexOf(right[0]))[0];
    return selected && selected[1] > 0 ? this.sheet(selected[0]) : this.workbook.worksheets[0];
  }

  private target(elementId: string, fallbackSheet: string): { sheet: ExcelJS.Worksheet; address: string } {
    const qualified = elementId.match(/^(?:'([^']+)'|([^!]+))!\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)$/i);
    const sheet = qualified ? this.sheet((qualified[1] ?? qualified[2]).trim()) : this.sheet(fallbackSheet);
    const address = normalizeAddress(qualified ? qualified[3] : elementId);
    if (!parseAddress(address)) throw new Error(`Invalid SpreadsheetBench cell address: ${elementId}`);
    return { sheet, address };
  }

  private version(sheet: string, address: string, cell?: ExcelJS.Cell): number {
    const key = cellKey(sheet, address);
    const recorded = this.versions.get(key);
    if (recorded !== undefined) return recorded;
    return (cell ?? this.sheet(sheet).getCell(address)).value === null ? 0 : 1;
  }

  private isLocked(sheet: string, address: string): boolean {
    return [...this.locks.values()].some((lock) =>
      lock.sheet.toLowerCase() === sheet.toLowerCase() && lock.addresses.includes(normalizeAddress(address)));
  }

  private rowHeader(sheet: ExcelJS.Worksheet, address: string): string {
    const position = parseAddress(address)!;
    for (let column = 1; column < position.col; column += 1) {
      const value = displayValue(roomCellScalar(sheet.getCell(position.row, column)));
      if (value) return value.slice(0, 120);
    }
    return "";
  }

  private columnHeader(sheet: ExcelJS.Worksheet, address: string): string {
    const position = parseAddress(address)!;
    for (let row = Math.min(position.row - 1, 12); row >= 1; row -= 1) {
      const value = displayValue(roomCellScalar(sheet.getCell(row, position.col)));
      if (value) return value.slice(0, 120);
    }
    return "";
  }
}

function openAgentTask(agentManifestPath: string): OpenedAgentTask {
  const manifestPath = resolve(agentManifestPath);
  if (!existsSync(manifestPath)) throw new Error(`SpreadsheetBench agent manifest does not exist: ${agentManifestPath}`);
  const realManifestPath = realpathSync(manifestPath);
  const agentRoot = dirname(realManifestPath);
  if (basename(realManifestPath).toLowerCase() !== "task.json" || basename(agentRoot).toLowerCase() !== "agent") {
    throw new Error(`SpreadsheetBench bridge requires an agent/task.json boundary: ${agentManifestPath}`);
  }
  const manifest = parseAgentManifest(readFileSync(realManifestPath, "utf8"), realManifestPath);
  const sourceWorkbookPath = resolveAgentFile(agentRoot, manifest.inputFiles[0], "input workbook");
  const promptFiles = manifest.promptFiles.slice(0, 4).map((path) => {
    const resolvedPath = resolveAgentFile(agentRoot, path, "prompt file");
    return { path: normalizeRelative(path), text: readFileSync(resolvedPath, "utf8").slice(0, 5_000) };
  });
  return {
    manifest,
    agentRoot,
    sourceWorkbookPath,
    openedAgentFiles: [
      normalizeRelative(relative(agentRoot, realManifestPath)),
      normalizeRelative(relative(agentRoot, sourceWorkbookPath)),
      ...promptFiles.map((file) => file.path),
    ],
    promptFiles,
  };
}

function parseAgentManifest(text: string, path: string): StagedAgentManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid SpreadsheetBench agent manifest JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = asRecord(value);
  if (!record) throw new Error(`SpreadsheetBench agent manifest must be an object: ${path}`);
  const allowedKeys = new Set(["schema", "taskId", "track", "category", "instruction", "instructionType", "inputFiles", "promptFiles"]);
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) throw new Error(`SpreadsheetBench agent manifest contains non-agent field(s): ${unexpected.join(", ")}`);
  if (record.schema !== 1) throw new Error(`SpreadsheetBench agent manifest schema must be 1: ${path}`);
  if (typeof record.taskId !== "string" || !record.taskId.trim()) throw new Error(`SpreadsheetBench agent manifest taskId is missing: ${path}`);
  if (record.track !== "spreadsheetbench-v1" && record.track !== "spreadsheetbench-v2") {
    throw new Error(`SpreadsheetBench agent manifest track is invalid: ${String(record.track)}`);
  }
  if (typeof record.instruction !== "string" || !record.instruction.trim()) {
    throw new Error(`SpreadsheetBench agent manifest instruction is missing: ${path}`);
  }
  const inputFiles = stringArray(record.inputFiles, "inputFiles", path);
  if (!inputFiles.length) throw new Error(`SpreadsheetBench agent manifest has no input workbook: ${path}`);
  return {
    schema: 1,
    taskId: record.taskId,
    track: record.track,
    ...(typeof record.category === "string" ? { category: record.category } : {}),
    instruction: record.instruction,
    ...(typeof record.instructionType === "string" ? { instructionType: record.instructionType } : {}),
    inputFiles,
    promptFiles: stringArray(record.promptFiles ?? [], "promptFiles", path),
  };
}

function resolveAgentFile(agentRoot: string, manifestPath: string | undefined, role: string): string {
  if (!manifestPath) throw new Error(`SpreadsheetBench agent manifest ${role} path is missing`);
  if (isAbsolute(manifestPath)) throw new Error(`SpreadsheetBench ${role} path must be relative to the agent directory: ${manifestPath}`);
  const candidate = resolve(agentRoot, manifestPath.replace(/\\/g, "/"));
  if (!isPathWithin(agentRoot, candidate)) throw new Error(`SpreadsheetBench ${role} path escapes agent workspace: ${manifestPath}`);
  if (!existsSync(candidate)) throw new Error(`SpreadsheetBench ${role} does not exist: ${manifestPath}`);
  const realCandidate = realpathSync(candidate);
  if (!isPathWithin(agentRoot, realCandidate)) throw new Error(`SpreadsheetBench ${role} symlink escapes agent workspace: ${manifestPath}`);
  return realCandidate;
}

function assertCandidateDoesNotOverwriteAgentInput(candidatePath: string, task: OpenedAgentTask): void {
  const protectedPaths = new Set([
    resolve(optionsPath(task.agentRoot, "task.json")).toLowerCase(),
    resolve(task.sourceWorkbookPath).toLowerCase(),
    ...task.promptFiles.map((file) => resolve(task.agentRoot, file.path).toLowerCase()),
  ]);
  if (protectedPaths.has(resolve(candidatePath).toLowerCase())) {
    throw new Error(`SpreadsheetBench candidate path must not overwrite an agent-visible input: ${candidatePath}`);
  }
}

function buildBridgeFrame(
  manifest: StagedAgentManifest,
  artifactIds: string[],
  traceId: string,
  goalOverride?: string,
): ReasoningFrame {
  return {
    frameId: `rf_${traceId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 100)}`,
    goal: goalOverride ?? manifest.instruction,
    phase: "execute",
    status: "pending",
    contextPack: {
      globalGoal: manifest.instruction,
      parentSummary: `SpreadsheetBench staged task ${manifest.taskId}; evaluator metadata remains outside this frame.`,
      currentArtifactDigest: `task:${manifest.taskId}; track:${manifest.track}; sheets:${artifactIds.join(",")}`,
      relevantOkfConceptIds: [],
      relevantCacheKeys: [],
      openQuestions: [],
      constraints: [
        "Use only the staged agent manifest, agent input workbook, and agent prompt files.",
        "Never request or infer evaluator metadata, answer positions, scorer settings, or gold workbooks.",
        "Inspect, preflight, use managed RoomTools writes, and verify every changed target.",
        "Treat a failed preflight or post-write verification as repair guidance, not permission to weaken verification.",
      ],
      expectedOutputSchema: SPREADSHEETBENCH_NODEAGENT_BRIDGE_SCHEMA,
    },
    toolAllowlist: [...BRIDGE_TOOL_NAMES],
    evidenceState: {
      required: ["workbook inspection", "edit-plan preflight", "managed write receipt", "post-write verification"],
      availableRefs: [],
      missingRefs: [],
      staleRefs: [],
    },
  };
}

function bridgeInstructions(task: OpenedAgentTask, artifactIds: string[]): string[] {
  return [
    `Staged SpreadsheetBench task ID: ${task.manifest.taskId}.`,
    `Agent-visible input workbook name: ${basename(task.sourceWorkbookPath)}. Use descriptive filename terms as audit clues, then confirm them against workbook evidence.`,
    `Visible worksheet artifact IDs: ${artifactIds.map((id) => JSON.stringify(id)).join(", ")}.`,
    `Complete task instruction: ${task.manifest.instruction}`,
    "Treat the agent-visible filename only as an audit-class hypothesis. Confirm every edit against local workbook evidence, make the smallest verified change, and do not treat unrelated blanks or inferred anomalies as mandatory targets.",
    "Treat explicit target bands and locally confirmed value/formula/style suggestions from inspect_workbook as the target-selection contract. Preserve content during style-only writes, and preflight every proposed target before writing.",
    "The first verify_workbook call for a proposed operation set is the durable plan/preflight boundary. Do not write a plan that returns needs_repair; submit a corrected replacement plan first.",
    "When inspect_workbook returns a complete high-confidence formula/value contract, prefer execute_verified_workbook_plan with the same task instruction and artifactId. It performs deterministic plan materialization, preflight, managed-lock writes, and post-write verification without requiring a large echoed operation array.",
    "For writes, pass write_locked_cell(s) direct formula/result, value, numFmt, and/or fontColor fields; pass the same touched fields to verify_workbook. A fontColor-only operation must preserve the existing value or formula.",
    "When inspect_workbook returns workbookWideRepairContract, complete every listed repair one worksheet at a time: inspect that artifact, preflight its complete repair set, write it, and post-verify it before moving to the next artifact.",
    "After every managed write, call verify_workbook with afterWrite=true for all changed targets. Use repairPrompt for at most one focused repair before reporting unresolved work.",
    "No evaluator manifest, gold workbook, answer position, or scorer metadata exists in this frame or in any available tool.",
    ...task.promptFiles.map((file) => `Agent-visible prompt file ${file.path}:\n${file.text}`),
  ];
}

type BridgePlanState = {
  artifactId: string;
  hash: string;
  targets: string[];
  operations: NormalizedBridgeOperation[];
};

class BridgeWorkbookWorkflowController {
  private inspected = false;
  private readonly approvedPlans = new Map<string, BridgePlanState>();
  private readonly pendingVerifications = new Map<string, BridgePlanState>();
  private readonly verifiedPlans = new Map<string, BridgePlanState>();

  private activeArtifactId: string;

  constructor(
    private readonly taskInstruction: string,
    defaultArtifactId: string,
  ) {
    this.activeArtifactId = defaultArtifactId;
  }

  pendingVerificationCount(): number {
    return this.pendingVerifications.size;
  }

  wrap(tool: AgentTool): AgentTool {
    if (tool.name === "inspect_workbook") {
      return this.withExecution(tool, async (args, rt) => {
        const requested = asRecord(args) ?? {};
        const repairContract = bridgeWorkbookRepairContract(rt);
        const preferredArtifactId = bridgePreferredRepairArtifact(repairContract, requested.artifactId);
        const artifactId = preferredArtifactId
          ? await bridgeResolvedArtifactId(rt, preferredArtifactId, this.activeArtifactId)
          : undefined;
        const result = await tool.execute({
          ...requested,
          instruction: this.taskInstruction,
          ...(artifactId ? { artifactId } : {}),
        }, rt);
        if (eventSucceeded(result)) {
          this.inspected = true;
          const artifactId = asRecord(result)?.artifactId;
          if (typeof artifactId === "string" && artifactId.trim()) this.activeArtifactId = artifactId;
        }
        const record = asRecord(result);
        return record && repairContract.requiredRepairs.length > 0
          ? {
              ...focusBridgeInspectionResult(record, repairContract, bridgeWorkbookInspection(rt), this.activeArtifactId),
              workbookWideRepairContract: repairContract,
            }
          : result;
      });
    }
    if (tool.name === "verify_workbook") {
      return this.withExecution(tool, async (args, rt) => {
        const record = asRecord(args) ?? {};
        const requestedArtifactId = await bridgeResolvedArtifactId(rt, record.artifactId, this.activeArtifactId);
        const preliminaryPlan = normalizedBridgeOperations(args, "verify", requestedArtifactId);
        this.activeArtifactId = await bridgeArtifactIdForPlan(rt, preliminaryPlan, requestedArtifactId);
        const artifactKey = this.activeArtifactId.toLowerCase();
        const phase = asRecord(args)?.afterWrite === false ? "preflight" : "post_write";
        const plan = normalizedBridgeOperations(args, "verify", this.activeArtifactId);
        const planHash = stableTraceHash(plan);
        if (phase === "preflight" && !this.inspected) {
          return bridgeStageBlock("inspection_required", "Call inspect_workbook before proposing a workbook edit plan.");
        }
        const pendingVerification = this.pendingVerifications.get(artifactKey);
        const verifiedPlan = this.verifiedPlans.get(artifactKey);
        const idempotentVerification = !pendingVerification && verifiedPlan?.hash === planHash;
        if (phase === "post_write" && pendingVerification?.hash !== planHash && !idempotentVerification) {
          return {
            ...bridgeStageBlock(
            "post_write_plan_mismatch",
            "Post-write verification must cover exactly the operations from the most recent managed write.",
            ),
            ...(pendingVerification ? { verificationRequired: bridgeVerificationContract(pendingVerification) } : {}),
            pendingArtifacts: [...this.pendingVerifications.values()].map((state) => state.artifactId),
          };
        }
        if (phase === "preflight") {
          const contractIssue = bridgeRepairContractIssue(rt, this.activeArtifactId, plan);
          if (contractIssue) {
            this.approvedPlans.delete(artifactKey);
            return contractIssue;
          }
        }
        const result = await tool.execute(stripBridgeElementQualifiers({
          ...(asRecord(args) ?? {}),
          instruction: this.taskInstruction,
          artifactId: asRecord(args)?.artifactId ?? this.activeArtifactId,
        }, this.activeArtifactId), rt);
        if (phase === "preflight") {
          if (verificationStatus(result) === "passed") {
            this.approvedPlans.set(artifactKey, bridgePlanState(this.activeArtifactId, planHash, plan));
          } else {
            this.approvedPlans.delete(artifactKey);
          }
        } else {
          this.pendingVerifications.delete(artifactKey);
          if (verificationStatus(result) === "passed") {
            this.verifiedPlans.set(
              artifactKey,
              pendingVerification ?? verifiedPlan ?? bridgePlanState(this.activeArtifactId, planHash, plan),
            );
          }
        }
        if (phase === "post_write" && verificationStatus(result) === "passed") {
          const pending = [...this.pendingVerifications.values()];
          if (pending.length > 0) {
            const next = pending[0];
            return {
              ...(asRecord(result) ?? {}),
              status: "needs_repair",
              issueCount: pending.length,
              issues: pending.map((state) => ({
                kind: "pending_workbook_verification",
                severity: "error",
                sheet: state.artifactId,
                detail: `${state.targets.join(", ")} changed but have not passed post-write verification.`,
                repair: `Run the exact post-write verification contract for ${state.artifactId}.`,
              })),
              repairPrompt: `Post-write verification is still required for ${pending.map((state) => state.artifactId).join(", ")}.`,
              pendingArtifacts: pending.map((state) => state.artifactId),
              verificationRequired: bridgeVerificationContract(next),
            };
          }
          const remaining = bridgeWorkbookRepairContract(rt);
          if (remaining.requiredRepairs.length > 0) {
            return {
              ...(asRecord(result) ?? {}),
              status: "needs_repair",
              issueCount: remaining.requiredRepairs.length,
              issues: remaining.requiredRepairs.map((repair) => ({
                kind: "remaining_workbook_repair",
                severity: "error",
                sheet: repair.sheet,
                address: repair.cell,
                detail: repair.evidence.join("; "),
                repair: `Inspect ${repair.sheet}, then preflight and write ${repair.cell} with =${repair.formula}.`,
              })),
              repairPrompt: `Workbook-wide verification found ${remaining.requiredRepairs.length} remaining repair(s). Continue with ${remaining.requiredRepairs.map((repair) => `${repair.sheet}!${repair.cell}`).join(", ")}.`,
              workbookWideRepairContract: remaining,
            };
          }
          const resultRecord = asRecord(result);
          return resultRecord
            ? {
                ...resultRecord,
                workflowComplete: true,
                nextAction: "Return the final answer. Do not call another workbook tool.",
              }
            : result;
        }
        const resultRecord = asRecord(result);
        const approvedPlan = this.approvedPlans.get(artifactKey);
        return phase === "preflight" && approvedPlan && resultRecord
          ? { ...resultRecord, approvedWrite: bridgeWriteContract(approvedPlan) }
          : result;
      });
    }
    if (tool.name === EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME) {
      return this.withExecution(tool, async (args, rt) => {
        if (!this.inspected) {
          return bridgeStageBlock(
            "inspection_required",
            "Call inspect_workbook before executing its high-confidence workbook plan.",
          );
        }
        const record = asRecord(args) ?? {};
        const artifactId = await bridgeResolvedArtifactId(rt, record.artifactId, this.activeArtifactId);
        this.activeArtifactId = artifactId;
        return tool.execute({
          ...record,
          instruction: this.taskInstruction,
          artifactId,
        }, rt);
      });
    }
    if (WRITE_TOOL_NAMES.has(tool.name)) {
      return this.withExecution(tool, async (args, rt) => {
        const record = asRecord(args) ?? {};
        const requestedArtifactId = await bridgeResolvedArtifactId(rt, record.artifactId, this.activeArtifactId);
        const preliminaryPlan = normalizedBridgeOperations(args, "write", requestedArtifactId);
        this.activeArtifactId = await bridgeArtifactIdForPlan(rt, preliminaryPlan, requestedArtifactId);
        const artifactKey = this.activeArtifactId.toLowerCase();
        const plan = normalizedBridgeOperations(args, "write", this.activeArtifactId);
        const planHash = stableTraceHash(plan);
        const approvedPlan = this.approvedPlans.get(artifactKey);
        if (!approvedPlan) {
          return bridgeStageBlock(
            "preflight_required",
            "Call verify_workbook with afterWrite=false and a passing operation plan before any managed write.",
          );
        }
        if (approvedPlan.hash !== planHash) {
          return {
            ...bridgeStageBlock(
              "write_plan_mismatch",
              "The managed write must match the most recent passing preflight plan exactly.",
            ),
            approvedTargets: approvedPlan.targets,
            requestedTargets: plan.map((operation) => operation.target),
            approvedWrite: bridgeWriteContract(approvedPlan),
          };
        }
        const result = await tool.execute(stripBridgeElementQualifiers({
          ...(asRecord(args) ?? {}),
          artifactId: asRecord(args)?.artifactId ?? this.activeArtifactId,
        }, this.activeArtifactId), rt);
        if (eventSucceeded(result)) {
          const pending = bridgePlanState(this.activeArtifactId, planHash, plan);
          this.pendingVerifications.set(artifactKey, pending);
          this.approvedPlans.delete(artifactKey);
          const resultRecord = asRecord(result);
          if (resultRecord) return { ...resultRecord, verificationRequired: bridgeVerificationContract(pending) };
        }
        return result;
      });
    }
    if (tool.name === "read_range") {
      const adapted = this.withExecution(tool, async (args, rt) => {
        const record = asRecord(args) ?? {};
        const artifactId = await bridgeResolvedArtifactId(rt, record.artifactId, this.activeArtifactId);
        try {
          return await tool.execute({ ...record, artifactId }, rt);
        } catch (error) {
          if (!(error instanceof SpreadsheetBenchReadReferenceError)) throw error;
          return {
            ok: false,
            error: "invalid_read_reference",
            detail: error.message,
            recovery: {
              action: "retry_tool_call",
              instruction: "Use a visible worksheet and Excel A1 cells within A1:XFD1048576; split large reads into smaller ranges.",
            },
          };
        }
      });
      return {
        ...adapted,
        description: `${adapted.description} In this workbook bridge, elementIds also accepts bounded A1 ranges such as B2:F20 and quoted sheet-qualified ranges such as 'Financial Overview'!B2:F20.`,
      };
    }
    if (tool.name === "search_sheet_context") {
      return this.withExecution(tool, async (args, rt) => {
        const record = asRecord(args) ?? {};
        const artifactId = await bridgeResolvedArtifactId(rt, record.artifactId, this.activeArtifactId);
        return tool.execute({ ...record, artifactId }, rt);
      });
    }
    return tool;
  }

  private withExecution(
    tool: AgentTool,
    execute: (args: unknown, rt: RoomTools) => Promise<unknown>,
  ): AgentTool {
    return { ...tool, execute };
  }
}

type BridgeWorkbookRepair = {
  sheet: string;
  cell: string;
  formula: string;
  evidence: string[];
};

function remainingDeterministicInspection(
  initial: WorkbookTaskInspection,
  current: WorkbookTaskInspection,
  cells: WorkbookObservedCell[],
): WorkbookTaskInspection {
  const initialContract = initial.deterministicPlan;
  if (!initialContract) return current;
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const remainingPlans = initialContract.sheets.flatMap((sheet) => {
    const suggested = buildWorkbookSuggestedPlan(initial, sheet);
    if (suggested.conflicts.length > 0) return [];
    const operations = suggested.operations.filter((operation) => !bridgeSuggestedOperationSatisfied(
      operation,
      cellsByKey.get(workbookCellKey(sheet, operation.elementId)),
    ));
    return operations.length > 0 ? [{ sheet, operations }] : [];
  });
  const remainingKeys = new Set(remainingPlans.flatMap((plan) =>
    plan.operations.map((operation) => workbookCellKey(plan.sheet, operation.elementId))));
  const { deterministicPlan: _currentPlan, ...currentWithoutDeterministicPlan } = current;
  if (remainingKeys.size === 0) {
    if (current.deterministicPlan?.status === "complete") return current;
    return {
      ...currentWithoutDeterministicPlan,
      formulaFillSuggestions: [],
      formulaRepairSuggestions: [],
      valueSuggestions: [],
      styleSuggestions: [],
    };
  }
  const keep = (sheet: string, cell: string) => remainingKeys.has(workbookCellKey(sheet, cell));
  return {
    ...currentWithoutDeterministicPlan,
    ...(initial.auditFocus ? { auditFocus: initial.auditFocus } : {}),
    deterministicPlan: {
      ...initialContract,
      operationCount: remainingKeys.size,
      sheets: remainingPlans.map((plan) => plan.sheet),
    },
    targetCandidates: initial.targetCandidates.filter((target) => keep(target.sheet, target.address)),
    blockedTargets: [],
    findings: initial.findings.filter((finding) => keep(finding.sheet, finding.address)),
    formulaFillSuggestions: initial.formulaFillSuggestions.flatMap((suggestion) => {
      const operations = suggestion.operations.filter((operation) => keep(operation.sheet, operation.cell));
      return operations.length > 0 ? [{ ...suggestion, operations }] : [];
    }),
    formulaRepairSuggestions: initial.formulaRepairSuggestions.filter((suggestion) => keep(suggestion.sheet, suggestion.cell)),
    valueSuggestions: initial.valueSuggestions.filter((suggestion) => keep(suggestion.sheet, suggestion.cell)),
    styleSuggestions: initial.styleSuggestions.filter((suggestion) => keep(suggestion.sheet, suggestion.cell)),
    rankedCellKeys: initial.rankedCellKeys.filter((key) => remainingKeys.has(key)),
    recommendedReads: remainingPlans.map((plan) => ({
      sheet: plan.sheet,
      addresses: plan.operations.map((operation) => operation.elementId),
      reason: "durable complete visible-workbook contract",
    })),
  };
}

function focusDeterministicInspection(
  inspection: WorkbookTaskInspection,
  artifactId: string,
): WorkbookTaskInspection | undefined {
  const sheet = inspection.deterministicPlan?.sheets.find((candidate) => candidate.toLowerCase() === artifactId.toLowerCase());
  if (!sheet || !inspection.deterministicPlan) return undefined;
  const keepSheet = (candidate: string) => candidate.toLowerCase() === sheet.toLowerCase();
  const suggested = buildWorkbookSuggestedPlan(inspection, sheet);
  if (suggested.operations.length === 0 || suggested.conflicts.length > 0) return undefined;
  return {
    ...inspection,
    deterministicPlan: {
      ...inspection.deterministicPlan,
      operationCount: suggested.operations.length,
      sheets: [sheet],
    },
    referencedSheets: [sheet],
    targetCandidates: inspection.targetCandidates.filter((target) => keepSheet(target.sheet)),
    blockedTargets: inspection.blockedTargets.filter((target) => keepSheet(target.sheet)),
    targetBands: inspection.targetBands.filter((band) => keepSheet(band.sheet)),
    dependencyCandidates: inspection.dependencyCandidates.filter((target) => keepSheet(target.sheet)),
    findings: inspection.findings.filter((finding) => keepSheet(finding.sheet)),
    formulaFillSuggestions: inspection.formulaFillSuggestions.flatMap((suggestion) => {
      if (!keepSheet(suggestion.sheet)) return [];
      const operations = suggestion.operations.filter((operation) => keepSheet(operation.sheet));
      return operations.length > 0 ? [{ ...suggestion, operations }] : [];
    }),
    formulaRepairSuggestions: inspection.formulaRepairSuggestions.filter((suggestion) => keepSheet(suggestion.sheet)),
    valueSuggestions: inspection.valueSuggestions.filter((suggestion) => keepSheet(suggestion.sheet)),
    styleSuggestions: inspection.styleSuggestions.filter((suggestion) => keepSheet(suggestion.sheet)),
    rankedCellKeys: inspection.rankedCellKeys.filter((key) => key.startsWith(`${sheet.toLowerCase()}!`)),
    recommendedReads: inspection.recommendedReads.filter((read) => keepSheet(read.sheet)),
  };
}

function bridgeSuggestedOperationSatisfied(
  operation: ReturnType<typeof buildWorkbookSuggestedPlan>["operations"][number],
  cell: WorkbookObservedCell | undefined,
): boolean {
  if (!cell) return false;
  if (operation.formula && normalizeFormula(cell.formula) !== normalizeFormula(operation.formula)) return false;
  if (Object.prototype.hasOwnProperty.call(operation, "value")
    && stableTraceHash(cell.value) !== stableTraceHash(operation.value)) return false;
  if (operation.numFmt && cell.numFmt !== operation.numFmt) return false;
  if (operation.fontColor
    && normalizeSpreadsheetFontColor(cell.fontColor) !== normalizeSpreadsheetFontColor(operation.fontColor)) return false;
  return true;
}

function bridgeWorkbookInspection(rt: RoomTools): WorkbookTaskInspection | undefined {
  const provider = rt as RoomTools & { taskInspection?: () => WorkbookTaskInspection };
  return typeof provider.taskInspection === "function" ? provider.taskInspection() : undefined;
}

function bridgeWorkbookRepairContract(rt: RoomTools): { schema: 1; requiredRepairs: BridgeWorkbookRepair[] } {
  const inspection = bridgeWorkbookInspection(rt);
  if (!inspection) return { schema: 1, requiredRepairs: [] };
  if (inspection.auditFocus) return { schema: 1, requiredRepairs: [] };
  const rangeTargets = new Set(inspection.findings
    .filter((finding) => finding.kind === "formula_range_anomaly")
    .map((finding) => `${finding.sheet.toLowerCase()}!${normalizeAddress(finding.address)}`));
  return {
    schema: 1,
    requiredRepairs: inspection.formulaRepairSuggestions
      .filter((suggestion) => rangeTargets.has(`${suggestion.sheet.toLowerCase()}!${normalizeAddress(suggestion.cell)}`))
      .map((suggestion) => ({
        sheet: suggestion.sheet,
        cell: normalizeAddress(suggestion.cell),
        formula: suggestion.formula,
        evidence: suggestion.evidence,
      })),
  };
}

function bridgePreferredRepairArtifact(
  contract: { requiredRepairs: BridgeWorkbookRepair[] },
  requestedArtifactId: unknown,
): string | undefined {
  if (contract.requiredRepairs.length === 0) {
    return typeof requestedArtifactId === "string" && requestedArtifactId.trim() ? requestedArtifactId : undefined;
  }
  const requested = typeof requestedArtifactId === "string" ? requestedArtifactId.trim() : "";
  const repairSheets = new Map<string, { sheet: string; count: number }>();
  for (const repair of contract.requiredRepairs) {
    const key = repair.sheet.toLowerCase();
    const current = repairSheets.get(key) ?? { sheet: repair.sheet, count: 0 };
    current.count += 1;
    repairSheets.set(key, current);
  }
  if (requested && repairSheets.has(requested.toLowerCase())) return repairSheets.get(requested.toLowerCase())!.sheet;
  return [...repairSheets.values()].sort((left, right) => right.count - left.count || left.sheet.localeCompare(right.sheet))[0]?.sheet;
}

async function bridgeResolvedArtifactId(
  rt: RoomTools,
  requestedArtifactId: unknown,
  fallbackArtifactId: string,
): Promise<string> {
  const requested = typeof requestedArtifactId === "string" ? requestedArtifactId.trim() : "";
  if (!requested) return fallbackArtifactId;
  const artifacts = await rt.listArtifacts();
  return artifacts.some((artifact) => artifact.id.toLowerCase() === requested.toLowerCase())
    ? artifacts.find((artifact) => artifact.id.toLowerCase() === requested.toLowerCase())!.id
    : fallbackArtifactId;
}

async function bridgeArtifactIdForPlan(
  rt: RoomTools,
  plan: NormalizedBridgeOperation[],
  fallbackArtifactId: string,
): Promise<string> {
  const planSheets = [...new Set(plan.map((operation) => operation.target.slice(0, operation.target.indexOf("!"))))];
  const artifacts = await rt.listArtifacts();
  if (planSheets.length === 1) {
    const explicit = artifacts.find((artifact) => artifact.id.toLowerCase() === planSheets[0].toLowerCase())?.id;
    if (explicit && explicit.toLowerCase() !== fallbackArtifactId.toLowerCase()) return explicit;
  }

  const repairs = bridgeWorkbookRepairContract(rt).requiredRepairs;
  const inferredSheets = plan.flatMap((operation) => {
    const address = normalizeAddress(operation.target.slice(operation.target.lastIndexOf("!") + 1));
    const matches = repairs.filter((repair) =>
      normalizeAddress(repair.cell) === address
      && normalizeFormula(repair.formula) === normalizeFormula(operation.formula));
    return matches.length === 1 ? [matches[0].sheet.toLowerCase()] : [];
  });
  if (inferredSheets.length === plan.length && new Set(inferredSheets).size === 1) {
    return artifacts.find((artifact) => artifact.id.toLowerCase() === inferredSheets[0])?.id ?? fallbackArtifactId;
  }
  return planSheets.length === 1
    ? artifacts.find((artifact) => artifact.id.toLowerCase() === planSheets[0].toLowerCase())?.id ?? fallbackArtifactId
    : fallbackArtifactId;
}

function bridgeRepairContractIssue(
  rt: RoomTools,
  artifactId: string,
  plan: NormalizedBridgeOperation[],
): Record<string, unknown> | undefined {
  const required = bridgeWorkbookRepairContract(rt).requiredRepairs
    .filter((repair) => repair.sheet.toLowerCase() === artifactId.toLowerCase());
  if (required.length === 0) return undefined;
  const completeContract = bridgeWorkbookRepairContract(rt).requiredRepairs;
  const requiredCells = new Set(required.map((repair) => normalizeAddress(repair.cell)));
  const foreignRepairByCell = new Map(completeContract
    .filter((repair) => repair.sheet.toLowerCase() !== artifactId.toLowerCase())
    .map((repair) => [normalizeAddress(repair.cell), repair]));
  const planByTarget = new Map(plan.map((operation) => [operation.target, operation]));
  const issues: Array<Record<string, unknown>> = [];
  for (const operation of plan) {
    const address = normalizeAddress(operation.target.slice(operation.target.lastIndexOf("!") + 1));
    const foreignRepair = foreignRepairByCell.get(address);
    if (foreignRepair && !requiredCells.has(address)) {
      issues.push({
        kind: "cross_sheet_plan",
        severity: "error",
        sheet: artifactId,
        address,
        detail: `${address} belongs to the remaining ${foreignRepair.sheet} repair, not the active ${artifactId} worksheet.`,
        repair: `Remove ${address} from this plan. Finish ${artifactId}, then inspect ${foreignRepair.sheet} and repair ${foreignRepair.cell} there.`,
      });
    }
  }
  issues.push(...required.flatMap((repair) => {
    const target = `${repair.sheet.toLowerCase()}!${normalizeAddress(repair.cell)}`;
    const operation = planByTarget.get(target);
    if (!operation) {
      return [{
        kind: "missing_target_coverage",
        severity: "error",
        sheet: repair.sheet,
        address: repair.cell,
        detail: `The workbook-wide repair contract requires ${repair.sheet}!${repair.cell}.`,
        repair: `Add ${repair.cell} with =${repair.formula} to this worksheet's preflight plan.`,
      }];
    }
    if (normalizeFormula(operation.formula) !== normalizeFormula(repair.formula)) {
      return [{
        kind: "formula_semantic_mismatch",
        severity: "error",
        sheet: repair.sheet,
        address: repair.cell,
        detail: `${repair.sheet}!${repair.cell} does not match the visible workbook-wide range invariant.`,
        repair: `Use =${repair.formula}.`,
      }];
    }
    return [];
  }));
  return issues.length === 0 ? undefined : {
    ok: true,
    phase: "preflight",
    status: "needs_repair",
    issueCount: issues.length,
    issues,
    repairPrompt: `Correct the complete ${artifactId} repair plan before writing.`,
  };
}

function bridgeStageBlock(stageError: string, instruction: string) {
  return {
    ok: false as const,
    error: "workbook_stage_guard",
    stageError,
    recovery: { action: "retry_tool_call", instruction },
  };
}

type NormalizedBridgeOperation = {
  target: string;
  formula?: string;
  value?: unknown;
  numFmt?: string;
  fontColor?: string;
};

function normalizedBridgeOperations(args: unknown, source: "verify" | "write", defaultArtifactId = ""): NormalizedBridgeOperation[] {
  const record = asRecord(args) ?? {};
  const artifactId = typeof record.artifactId === "string" ? record.artifactId : defaultArtifactId;
  const rawOperations = source === "verify"
    ? Array.isArray(record.operations) ? record.operations : []
    : Array.isArray(record.ops) ? record.ops
      : Array.isArray(record.cells) ? record.cells
        : [record];
  return rawOperations.flatMap((rawOperation) => {
    const operation = asRecord(rawOperation);
    if (!operation || typeof operation.elementId !== "string") return [];
    const nested = asRecord(operation.value);
    const formulaValue = typeof operation.formula === "string"
      ? operation.formula
      : typeof nested?.formula === "string" ? nested.formula : undefined;
    const formula = formulaValue?.trim().replace(/^=/, "").trim();
    const hasResult = Object.prototype.hasOwnProperty.call(operation, "result")
      || !!nested && Object.prototype.hasOwnProperty.call(nested, "result");
    const hasValue = Object.prototype.hasOwnProperty.call(operation, "value")
      || !!nested && Object.prototype.hasOwnProperty.call(nested, "value");
    const value = Object.prototype.hasOwnProperty.call(operation, "result")
      ? operation.result
      : nested && Object.prototype.hasOwnProperty.call(nested, "result")
        ? nested.result
        : nested && Object.prototype.hasOwnProperty.call(nested, "value")
          ? nested.value
          : operation.value;
    const numFmtValue = typeof operation.numFmt === "string"
      ? operation.numFmt
      : typeof nested?.numFmt === "string" ? nested.numFmt : undefined;
    const fontColor = normalizeSpreadsheetFontColor(operation.fontColor ?? nested?.fontColor);
    const parsedTarget = bridgeElementTarget(operation.elementId, artifactId);
    const target = `${parsedTarget.sheet.toLowerCase()}!${parsedTarget.address}`;
    return [{
      target,
      ...(formula ? { formula } : {}),
      ...(!formula && (hasResult || hasValue) ? { value } : {}),
      ...(numFmtValue?.trim() ? { numFmt: numFmtValue.trim() } : {}),
      ...(fontColor ? { fontColor } : {}),
    }];
  }).sort((left, right) => left.target.localeCompare(right.target));
}

function bridgePlanState(
  artifactId: string,
  hash: string,
  operations: NormalizedBridgeOperation[],
): BridgePlanState {
  return {
    artifactId,
    hash,
    targets: operations.map((operation) => operation.target),
    operations,
  };
}

function bridgeOperationArgs(operation: NormalizedBridgeOperation): Record<string, unknown> {
  return {
    elementId: operation.target.slice(operation.target.lastIndexOf("!") + 1),
    ...(operation.formula
      ? { formula: operation.formula }
      : Object.prototype.hasOwnProperty.call(operation, "value") ? { value: operation.value } : {}),
    ...(operation.numFmt ? { numFmt: operation.numFmt } : {}),
    ...(operation.fontColor ? { fontColor: operation.fontColor } : {}),
  };
}

function bridgeWriteContract(state: BridgePlanState): Record<string, unknown> {
  const operations = state.operations.map(bridgeOperationArgs);
  return operations.length === 1
    ? { tool: "write_locked_cell", args: { artifactId: state.artifactId, ...operations[0] } }
    : { tool: "write_locked_cells", args: { artifactId: state.artifactId, ops: operations } };
}

function bridgeVerificationContract(state: BridgePlanState): Record<string, unknown> {
  return {
    tool: "verify_workbook",
    args: {
      artifactId: state.artifactId,
      operations: state.operations.map(bridgeOperationArgs),
      afterWrite: true,
    },
  };
}

function bridgeElementTarget(elementId: string, fallbackArtifactId: string): { sheet: string; address: string } {
  const qualified = elementId.match(/^(?:'([^']+)'|([^!]+))!\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)$/i);
  return {
    sheet: qualified ? (qualified[1] ?? qualified[2]).trim() : fallbackArtifactId,
    address: normalizeAddress(qualified ? qualified[3] : elementId),
  };
}

function stripBridgeElementQualifiers(args: Record<string, unknown>, artifactId: string): Record<string, unknown> {
  const stripOperation = (value: unknown): unknown => {
    const operation = asRecord(value);
    if (!operation || typeof operation.elementId !== "string") return value;
    const target = bridgeElementTarget(operation.elementId, artifactId);
    return target.sheet.toLowerCase() === artifactId.toLowerCase()
      ? { ...operation, elementId: target.address }
      : operation;
  };
  const operations = Array.isArray(args.operations) ? args.operations.map(stripOperation) : args.operations;
  const ops = Array.isArray(args.ops) ? args.ops.map(stripOperation) : args.ops;
  const cells = Array.isArray(args.cells) ? args.cells.map(stripOperation) : args.cells;
  const single = typeof args.elementId === "string" ? stripOperation(args) : undefined;
  return single && asRecord(single)
    ? { ...asRecord(single)!, artifactId }
    : {
        ...args,
        artifactId,
        ...(Array.isArray(args.operations) ? { operations } : {}),
        ...(Array.isArray(args.ops) ? { ops } : {}),
        ...(Array.isArray(args.cells) ? { cells } : {}),
      };
}

function focusBridgeInspectionResult(
  result: Record<string, unknown>,
  contract: { requiredRepairs: BridgeWorkbookRepair[] },
  workbookInspection: WorkbookTaskInspection | undefined,
  artifactId: string,
): Record<string, unknown> {
  const repairs = contract.requiredRepairs.filter((repair) => repair.sheet.toLowerCase() === artifactId.toLowerCase());
  if (repairs.length === 0) return result;
  const repairAddresses = new Set(repairs.map((repair) => normalizeAddress(repair.cell)));
  const repairPositions = [...repairAddresses].flatMap((address) => {
    const position = parseAddress(address);
    return position ? [position] : [];
  });
  const cells = Array.isArray(result.cells)
    ? result.cells.filter((rawCell) => {
        const cell = asRecord(rawCell);
        if (!cell || typeof cell.elementId !== "string") return false;
        const address = normalizeAddress(cell.elementId);
        if (repairAddresses.has(address)) return true;
        const position = parseAddress(address);
        return !!position && repairPositions.some((target) =>
          Math.abs(position.row - target.row) <= 1 && Math.abs(position.col - target.col) <= 1);
      })
    : result.cells;
  const findings = workbookInspection?.findings.filter((finding) =>
    finding.kind === "formula_range_anomaly"
    && finding.sheet.toLowerCase() === artifactId.toLowerCase()
    && repairAddresses.has(normalizeAddress(finding.address))) ?? [];
  const focusedInspection: WorkbookTaskInspection | undefined = workbookInspection ? {
    ...workbookInspection,
    referencedSheets: [artifactId],
    explicitReferences: [],
    targetCandidates: repairs.map((repair) => ({
      sheet: repair.sheet,
      address: repair.cell,
      reason: repair.evidence.join("; "),
    })),
    targetBands: [],
    dependencyCandidates: [],
    findings,
    formulaFillSuggestions: [],
    formulaRepairSuggestions: repairs.map((repair) => ({
      kind: "replace_outlier",
      confidence: "high",
      sheet: repair.sheet,
      cell: repair.cell,
      formula: repair.formula,
      evidence: repair.evidence,
    })),
    valueSuggestions: [],
    styleSuggestions: [],
    rankedCellKeys: repairs.map((repair) => `${repair.sheet.toLowerCase()}!${normalizeAddress(repair.cell)}`),
    recommendedReads: [{
      sheet: artifactId,
      addresses: repairs.map((repair) => normalizeAddress(repair.cell)),
      reason: "workbook-wide high-confidence formula range repair contract",
    }],
  } : undefined;
  return {
    ...result,
    ...(Array.isArray(cells) ? { cells } : {}),
    ...(focusedInspection ? { inspection: focusedInspection } : {}),
  };
}

function selectBridgeTools(tools: AgentTool[], controller: BridgeWorkbookWorkflowController): AgentTool[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const selected = BRIDGE_TOOL_NAMES.flatMap((name) => {
    const tool = byName.get(name);
    return tool ? [controller.wrap(tool)] : [];
  });
  const missing = BRIDGE_TOOL_NAMES.filter((name) => !byName.has(name));
  if (missing.length) throw new Error(`SpreadsheetBench NodeAgent bridge is missing canonical tool(s): ${missing.join(", ")}`);
  return selected;
}

function buildStageReceipts(
  traceId: string,
  frameReceipt: ReasoningFrameRunReceipt,
): Record<SpreadsheetBenchNodeAgentBridgeStage, SpreadsheetBenchNodeAgentBridgeStageReceipt> {
  const indexed = frameReceipt.agentResult.trace.map((event, eventIndex) => ({ event, eventIndex }));
  const inspect = indexed.filter(({ event }) => event.tool === "inspect_workbook");
  const composite = indexed.filter(({ event }) => COMPOSITE_WORKBOOK_TOOL_NAMES.has(event.tool));
  const verifications = indexed.filter(({ event }) => event.tool === "verify_workbook");
  const explicitPreflights = verifications.filter(({ event }) => verificationPhase(event.args, event.result) === "preflight");
  const explicitPostWrites = verifications.filter(({ event }) => verificationPhase(event.args, event.result) === "post_write");
  const compositePreflights = composite.filter(({ event }) => compositePhaseStatus(event.result, "preflight") !== "missing");
  const compositePostWrites = composite.filter(({ event }) => compositePhaseStatus(event.result, "verify") !== "missing");
  const preflights = [...explicitPreflights, ...compositePreflights].sort((left, right) => left.eventIndex - right.eventIndex);
  const postWrites = [...explicitPostWrites, ...compositePostWrites].sort((left, right) => left.eventIndex - right.eventIndex);
  const writes = indexed.filter(({ event }) => MUTATION_TOOL_NAMES.has(event.tool));
  const failedVerifications = [
    ...explicitPreflights.filter(({ event }) => verificationStatus(event.result) !== "passed"),
    ...explicitPostWrites.filter(({ event }) => verificationStatus(event.result) !== "passed"),
    ...compositePreflights.filter(({ event }) => compositePhaseStatus(event.result, "preflight") !== "passed"),
    ...compositePostWrites.filter(({ event }) => compositePhaseStatus(event.result, "verify") !== "passed"),
  ].sort((left, right) => left.eventIndex - right.eventIndex);
  const latestPreflight = preflights.at(-1)?.event;
  const latestPostWrite = postWrites.at(-1)?.event;
  const planOperationCount = operationCount(latestPreflight?.args) || compositeOperationCount(latestPreflight?.result);
  const repairResolved = failedVerifications.length > 0
    && bridgeEventVerificationStatus(latestPostWrite, "verify") === "passed"
    && failedVerifications.some(({ eventIndex }) => indexed.some((entry) =>
      entry.eventIndex > eventIndex && (entry.event.tool === "verify_workbook" || MUTATION_TOOL_NAMES.has(entry.event.tool))));

  const inspectStatus = inspect.length === 0
    ? "skipped" as const
    : inspect.some(({ event }) => eventSucceeded(event.result)) ? "completed" as const : "failed" as const;
  const preflightStatus = latestPreflight
    ? bridgeEventVerificationStatus(latestPreflight, "preflight") === "passed" ? "completed" as const : "needs_repair" as const
    : "skipped" as const;
  const writeStatus = writes.length === 0
    ? "skipped" as const
    : eventSucceeded(writes.at(-1)!.event.result) ? "completed" as const : "blocked" as const;
  const verifyStatus = latestPostWrite
    ? bridgeEventVerificationStatus(latestPostWrite, "verify") === "passed" ? "completed" as const : "needs_repair" as const
    : "skipped" as const;

  return {
    inspect: stageReceipt(traceId, "inspect", inspectStatus, inspect, `Workbook inspection ${inspectStatus}.`),
    plan: stageReceipt(
      traceId,
      "plan",
      preflights.length ? preflightStatus : "skipped",
      preflights,
      preflights.length ? `Plan captured by ${preflights.length} preflight attempt(s); ${planOperationCount} final operation(s).` : "No explicit operation plan reached preflight.",
      planOperationCount,
    ),
    preflight: stageReceipt(
      traceId,
      "preflight",
      preflightStatus,
      preflights,
      latestPreflight ? `Final plan preflight ${bridgeEventVerificationStatus(latestPreflight, "preflight")}.` : "No plan preflight receipt was produced.",
      planOperationCount,
    ),
    write: stageReceipt(
      traceId,
      "write",
      writeStatus,
      writes,
      writes.length ? `${writes.length} managed write call(s); final write ${writeStatus}.` : "No managed workbook write was attempted.",
      writes.reduce((sum, { event }) => sum + (operationCount(event.args) || compositeOperationCount(event.result)), 0),
    ),
    verify: stageReceipt(
      traceId,
      "verify",
      verifyStatus,
      postWrites,
      latestPostWrite ? `Final post-write verification ${bridgeEventVerificationStatus(latestPostWrite, "verify")}.` : "No post-write verification receipt was produced.",
      operationCount(latestPostWrite?.args) || compositeOperationCount(latestPostWrite?.result),
    ),
    repair: stageReceipt(
      traceId,
      "repair",
      failedVerifications.length === 0 ? "skipped" : repairResolved ? "completed" : "needs_repair",
      failedVerifications,
      failedVerifications.length === 0
        ? "No repair was required."
        : repairResolved
          ? `${failedVerifications.length} failed verification finding set(s) were followed by a passing repaired plan and post-write verification.`
          : `${failedVerifications.length} failed verification finding set(s) remain unresolved.`,
    ),
  };
}

function stageReceipt(
  traceId: string,
  stage: SpreadsheetBenchNodeAgentBridgeStage,
  status: SpreadsheetBenchNodeAgentBridgeStageStatus,
  entries: Array<{ event: ReasoningFrameRunReceipt["agentResult"]["trace"][number]; eventIndex: number }>,
  summary: string,
  operationCountValue?: number,
): SpreadsheetBenchNodeAgentBridgeStageReceipt {
  return {
    traceId,
    stage,
    status,
    attempts: entries.length,
    ...(operationCountValue === undefined ? {} : { operationCount: operationCountValue }),
    summary,
    events: entries.map(({ event, eventIndex }) => ({
      traceId,
      eventIndex,
      step: event.step,
      tool: event.tool,
      argsHash: stableTraceHash(event.args),
      resultHash: stableTraceHash(event.result),
    })),
  };
}

function bridgeOutcome(
  frameReceipt: ReasoningFrameRunReceipt,
  stages: SpreadsheetBenchNodeAgentBridgeReceipt["stages"],
  mutatingTask: boolean,
  changedCellCount: number,
  remainingHighConfidenceRepairs: number,
  pendingVerificationCount: number,
  unresolvedFormulaCount: number,
): SpreadsheetBenchNodeAgentBridgeReceipt["outcome"] {
  const finalVerificationStatus = unresolvedFormulaCount > 0
    ? "needs_repair" as const
    : pendingVerificationCount > 0
    ? "missing" as const
    : stages.verify.status === "completed"
    ? "passed" as const
    : stages.verify.status === "needs_repair" ? "needs_repair" as const : "missing" as const;
  let status: SpreadsheetBenchNodeAgentBridgeReceipt["outcome"]["status"];
  const observedMutation = mutatingTask || changedCellCount > 0;
  const deterministicProofComplete = unresolvedFormulaCount === 0
    && stages.inspect.status === "completed"
    && (!observedMutation || (
      changedCellCount > 0
      && stages.plan.status === "completed"
      && stages.preflight.status === "completed"
      && stages.write.status === "completed"
      && stages.verify.status === "completed"
      && remainingHighConfidenceRepairs === 0
      && pendingVerificationCount === 0
    ));
  if (deterministicProofComplete) status = "completed";
  else if (frameReceipt.runtimeError || frameReceipt.agentResult.stopReason === "error") status = "failed";
  else if (unresolvedFormulaCount > 0) status = "needs_repair";
  else if (stages.preflight.status === "needs_repair"
    || stages.verify.status === "needs_repair"
    || remainingHighConfidenceRepairs > 0
    || pendingVerificationCount > 0) status = "needs_repair";
  else if (frameReceipt.status === "blocked" || frameReceipt.agentResult.stopReason !== "done") status = "blocked";
  else if (stages.inspect.status !== "completed") status = "needs_repair";
  else if (observedMutation && (
    stages.plan.status !== "completed"
    || stages.preflight.status !== "completed"
    || stages.write.status !== "completed"
    || stages.verify.status !== "completed"
    || remainingHighConfidenceRepairs > 0
    || pendingVerificationCount > 0
    || unresolvedFormulaCount > 0
  )) status = "needs_repair";
  else status = "completed";
  return { status, mutatingTask, changedCellCount, finalVerificationStatus };
}

function buildBridgeTrace(args: {
  traceId: string;
  startedAt: number;
  manifest: StagedAgentManifest;
  frame: ReasoningFrame;
  frameReceipt: ReasoningFrameRunReceipt;
  stages: SpreadsheetBenchNodeAgentBridgeReceipt["stages"];
  candidateWorkbookPath: string;
  candidateWorkbookSha256: string;
  artifactIds: string[];
  outcomeStatus: SpreadsheetBenchNodeAgentBridgeReceipt["outcome"]["status"];
  recalculation: SpreadsheetBenchNodeAgentRecalculationReceipt;
  structuralRepair?: SpreadsheetBenchStructuralRepairReceipt;
  candidateFinalization?: SpreadsheetBenchCandidateFinalizationReceipt;
}): NodeAgentTrace {
  const candidateRef = traceRef("artifact", args.candidateWorkbookPath, {
    label: `SpreadsheetBench candidate ${basename(args.candidateWorkbookPath)}`,
    hash: args.candidateWorkbookSha256,
  });
  const trace = buildNodeAgentTrace({
    traceId: args.traceId,
    startedAt: args.startedAt,
    trigger: {
      kind: "benchmark",
      prompt: args.manifest.instruction,
      selectedArtifactIds: args.artifactIds,
      openedSurface: "spreadsheetbench.nodeagent.bridge",
    },
    plan: defaultTracePlan(args.manifest.instruction, {
      reads: args.artifactIds.map((artifactId) => traceRef("artifact", artifactId, { label: "Agent-visible worksheet" })),
      writes: [candidateRef],
      riskFlags: ["evaluator_isolation", "workbook_mutation", "cas_managed_write"],
    }),
    contextPack: traceContextPackFromFrame(args.frame),
    agentResult: args.frameReceipt.agentResult,
    outputArtifactRefs: [candidateRef],
    proofArtifacts: [candidateRef],
  });
  trace.eval.benchmarkCaseId = args.manifest.taskId;
  trace.final.status = args.outcomeStatus === "completed"
    ? "completed"
    : args.outcomeStatus === "failed" ? "failed" : "needs_review";
  trace.evidence = (["inspect", "preflight", "verify", "repair"] as const).map((stage) => {
    const receipt = args.stages[stage];
    return makeEvidenceReceipt({
      traceId: args.traceId,
      label: `SpreadsheetBench ${stage}`,
      sourceRefs: receipt.events.map(eventTraceRef),
      artifactRefs: [candidateRef],
      fact: { status: receipt.status, summary: receipt.summary },
      verifier: stage === "verify" || stage === "preflight" ? "verify_workbook" : "spreadsheetBenchNodeAgentBridge",
      status: receipt.status === "completed" || receipt.status === "skipped" ? "verified" : "needs_review",
    });
  });
  trace.evidence.push(makeEvidenceReceipt({
    traceId: args.traceId,
    label: "SpreadsheetBench formula recalculation",
    sourceRefs: [traceRef("tool_result", `${args.traceId}:formula-recalculation`, {
      label: "NodeAgent formula recalculation receipt",
      hash: stableTraceHash(args.recalculation),
    })],
    artifactRefs: [candidateRef],
    fact: args.recalculation,
    verifier: args.recalculation.engine,
    status: args.recalculation.unresolvedFormulaCount === 0 || args.candidateFinalization?.status === "completed"
      ? "verified"
      : "needs_review",
  }));
  if (args.structuralRepair) {
    trace.evidence.push(makeEvidenceReceipt({
      traceId: args.traceId,
      label: "SpreadsheetBench structural workbook repair",
      sourceRefs: [traceRef("tool_result", `${args.traceId}:structural-repair`, {
        label: args.structuralRepair.backend,
        hash: stableTraceHash(args.structuralRepair),
      })],
      artifactRefs: [candidateRef],
      fact: args.structuralRepair,
      verifier: args.structuralRepair.backend,
      status: "verified",
    }));
  }
  if (args.candidateFinalization) {
    trace.evidence.push(makeEvidenceReceipt({
      traceId: args.traceId,
      label: "SpreadsheetBench candidate finalization",
      sourceRefs: [traceRef("tool_result", `${args.traceId}:candidate-finalization`, {
        label: args.candidateFinalization.engine,
        hash: stableTraceHash(args.candidateFinalization),
      })],
      artifactRefs: [candidateRef],
      fact: args.candidateFinalization,
      verifier: args.candidateFinalization.engine,
      status: "verified",
    }));
  }
  trace.mutations = args.frameReceipt.agentResult.trace.flatMap((event): MutationReceipt[] => {
    if (!MUTATION_TOOL_NAMES.has(event.tool)) return [];
    const targets = writeTargets(event.args, event.result).map((target) => traceRef("cell", target, { label: "SpreadsheetBench workbook target" }));
    return [makeMutationReceipt({
      traceId: args.traceId,
      targetRefs: targets,
      payload: event.args,
      status: mutationStatus(event.result),
    })];
  });
  return trace;
}

function eventTraceRef(event: SpreadsheetBenchNodeAgentBridgeEventRef): TraceRef {
  return traceRef("tool_result", `${event.traceId}:bridge:event:${event.eventIndex}`, {
    label: event.tool,
    hash: event.resultHash,
  });
}

function mutationStatus(result: unknown): MutationReceipt["status"] {
  const record = asRecord(result);
  if (record?.pendingApproval === true) return "pending_approval";
  const resultItems = Array.isArray(record?.results)
    ? record.results.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const hasCommittedResult = resultItems.some((item) => item.ok === true && item.skipped !== true);
  if (hasCommittedResult || (typeof record?.changedTargetCount === "number" && record.changedTargetCount > 0)) {
    return "committed";
  }
  if (record?.alreadySatisfied === true) return "skipped";
  if (record?.conflict === true) return "conflict";
  if (record?.skipped === true) return "skipped";
  if (resultItems.length > 0 && resultItems.every((item) => item.skipped === true)) return "skipped";
  if (record?.ok === true) return "committed";
  return "conflict";
}

function writeTargets(args: unknown, result?: unknown): string[] {
  const record = asRecord(args);
  if (!record) return [];
  const artifactId = typeof record.artifactId === "string" ? record.artifactId : undefined;
  const ops = Array.isArray(record.ops) ? record.ops : Array.isArray(record.cells) ? record.cells : [];
  const targets = ops.flatMap((op) => {
    const item = asRecord(op);
    return typeof item?.elementId === "string" ? [item.elementId] : [];
  });
  if (typeof record.elementId === "string") targets.push(record.elementId);
  const resultRecord = asRecord(result);
  if (Array.isArray(resultRecord?.targets)) {
    for (const target of resultRecord.targets) {
      if (typeof target === "string") targets.push(target);
    }
  }
  const plan = asRecord(asRecord(resultRecord?.phases)?.plan);
  if (Array.isArray(plan?.targets)) {
    for (const target of plan.targets) if (typeof target === "string") targets.push(target);
  }
  return [...new Set(targets.map((target) =>
    artifactId && !target.includes("!") ? `${artifactId}!${target}` : target))];
}

function verificationPhase(args: unknown, result: unknown): "preflight" | "post_write" {
  const resultRecord = asRecord(result);
  if (resultRecord?.phase === "preflight") return "preflight";
  if (resultRecord?.phase === "post_write") return "post_write";
  return asRecord(args)?.afterWrite === false ? "preflight" : "post_write";
}

function verificationStatus(result: unknown): "passed" | "needs_repair" | "missing" {
  const status = asRecord(result)?.status;
  return status === "passed" ? "passed" : status === "needs_repair" ? "needs_repair" : "missing";
}

function compositePhaseStatus(
  result: unknown,
  phase: "preflight" | "verify",
): "passed" | "needs_repair" | "missing" {
  const phases = asRecord(asRecord(result)?.phases);
  const receipt = asRecord(phases?.[phase]);
  const status = receipt?.status;
  if (status === "passed" || status === "completed") return "passed";
  if (typeof status === "string" && status !== "skipped") return "needs_repair";
  return "missing";
}

function bridgeEventVerificationStatus(
  event: ReasoningFrameRunReceipt["agentResult"]["trace"][number] | undefined,
  phase: "preflight" | "verify",
): "passed" | "needs_repair" | "missing" {
  if (!event) return "missing";
  return COMPOSITE_WORKBOOK_TOOL_NAMES.has(event.tool)
    ? compositePhaseStatus(event.result, phase)
    : verificationStatus(event.result);
}

function compositeOperationCount(result: unknown): number {
  const count = asRecord(result)?.operationCount;
  return typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function eventSucceeded(result: unknown): boolean {
  const record = asRecord(result);
  if (!record) return true;
  if (record.pendingApproval === true || record.drafted === true) return true;
  return record.ok !== false && typeof record.error !== "string";
}

function operationCount(args: unknown): number {
  const record = asRecord(args);
  if (!record) return 0;
  if (Array.isArray(record.operations)) return record.operations.length;
  if (Array.isArray(record.ops)) return record.ops.length;
  if (Array.isArray(record.cells)) return record.cells.length;
  return typeof record.elementId === "string" ? 1 : 0;
}

function observedCell(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell, version: number): WorkbookObservedCell {
  const fontColor = cellFontColor(cell);
  return {
    sheet: sheet.name,
    address: normalizeAddress(cell.address),
    value: roomCellScalar(cell),
    ...(cellFormula(cell) ? { formula: cellFormula(cell) } : {}),
    ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
    ...(fontColor ? { fontColor } : {}),
    version,
  };
}

function roomCellValue(cell: ExcelJS.Cell): unknown {
  const formula = cellFormula(cell);
  const numFmt = cell.numFmt && cell.numFmt !== "General" ? cell.numFmt : undefined;
  const fontColor = cellFontColor(cell);
  if (formula || numFmt || fontColor) {
    return {
      value: roomCellScalar(cell),
      ...(formula ? { formula } : {}),
      ...(numFmt ? { numFmt } : {}),
      ...(fontColor ? { fontColor } : {}),
    };
  }
  return cell.value;
}

function roomCellScalar(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return value.result ?? "";
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return value;
}

type WorkbookCellSemanticState = {
  kind: "clear" | "formula" | "value";
  formula?: string;
  valueKey?: string;
  numFmt: string;
  fontColor?: string;
};

function workbookCellSemanticState(cell: ExcelJS.Cell): WorkbookCellSemanticState {
  const formula = cellFormula(cell);
  const fontColor = cellFontColor(cell);
  if (formula) return { kind: "formula", formula, numFmt: cell.numFmt, ...(fontColor ? { fontColor } : {}) };
  if (cell.value === null || cell.value === undefined) return { kind: "clear", numFmt: cell.numFmt, ...(fontColor ? { fontColor } : {}) };
  return { kind: "value", valueKey: stableWorkbookValue(cell.value), numFmt: cell.numFmt, ...(fontColor ? { fontColor } : {}) };
}

function sameWorkbookCellSemanticState(
  left: WorkbookCellSemanticState,
  right: WorkbookCellSemanticState,
  compareNumberFormat: boolean,
  compareFontColor: boolean,
): boolean {
  return left.kind === right.kind
    && left.formula === right.formula
    && left.valueKey === right.valueKey
    && (!compareNumberFormat || left.numFmt === right.numFmt)
    && (!compareFontColor || left.fontColor === right.fontColor);
}

function stableWorkbookValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Date) return `date:${Number.isFinite(value.getTime()) ? value.getTime() : "invalid"}`;
  if (Array.isArray(value)) return `[${value.map(stableWorkbookValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableWorkbookValue(nested)}`)
      .join(",")}}`;
  }
  return `${typeof value}:${String(value)}`;
}

function workbookCellPatch(
  sheet: string,
  address: string,
  cell: ExcelJS.Cell,
  originalState: WorkbookCellSemanticState,
  numFmtTouched: boolean,
  fontColorTouched: boolean,
): SpreadsheetBenchWorkbookCellPatch {
  const formula = cellFormula(cell);
  const valueRecord = asRecord(cell.value);
  const numFmt = numFmtTouched ? cell.numFmt : undefined;
  const fontColorStyle = fontColorTouched ? cellFontColorStyle(cell) : {};
  const currentState = workbookCellSemanticState(cell);
  const contentUnchanged = originalState.kind === currentState.kind
    && originalState.formula === currentState.formula
    && originalState.valueKey === currentState.valueKey;
  if (contentUnchanged && (numFmtTouched || fontColorTouched)) {
    return {
      sheet,
      address,
      kind: "style",
      ...(numFmt === undefined ? {} : { numFmt }),
      ...fontColorStyle,
    };
  }
  if (formula) {
    const hasCachedResult = Boolean(valueRecord && Object.prototype.hasOwnProperty.call(valueRecord, "result"));
    return {
      sheet,
      address,
      kind: "formula",
      formula,
      hasCachedResult,
      ...(hasCachedResult ? { cachedResult: valueRecord?.result } : {}),
      ...(numFmt === undefined ? {} : { numFmt }),
      ...fontColorStyle,
    };
  }
  if (cell.value === null || cell.value === undefined) {
    return {
      sheet,
      address,
      kind: "clear",
      ...(numFmt === undefined ? {} : { numFmt }),
      ...fontColorStyle,
    };
  }
  return {
    sheet,
    address,
    kind: "value",
    value: cell.value,
    ...(numFmt === undefined ? {} : { numFmt }),
    ...fontColorStyle,
  };
}

function formulaCachedScalar(cell: ExcelJS.Cell): FormulaEngineCellValue | undefined {
  const value = cell.value;
  if (!value || typeof value !== "object" || !("result" in value)) return undefined;
  return formulaEnginePrimitive(value.result);
}

function formulaEngineScalar(cell: ExcelJS.Cell): FormulaEngineCellValue | undefined {
  return formulaEnginePrimitive(roomCellScalar(cell));
}

function formulaEnginePrimitive(value: unknown): FormulaEngineCellValue | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? (time - Date.UTC(1899, 11, 30)) / 86_400_000 : undefined;
  }
  return undefined;
}

function setFormulaCachedResult(cell: ExcelJS.Cell, value: FormulaEngineCellValue): void {
  const result = value === null ? "" : value;
  const current = cell.value;
  if (current && typeof current === "object" && ("formula" in current || "sharedFormula" in current)) {
    cell.value = { ...current, result } as ExcelJS.CellValue;
    return;
  }
  const formula = cellFormula(cell);
  if (formula) cell.value = { formula, result } as ExcelJS.CellValue;
}

function cellFormula(cell: ExcelJS.Cell): string | undefined {
  return typeof cell.formula === "string" ? cell.formula.replace(/^=/, "") : undefined;
}

function applyRoomValue(cell: ExcelJS.Cell, value: unknown): void {
  const record = asRecord(value);
  const formula = typeof record?.formula === "string"
    ? record.formula.trim().replace(/^=/, "")
    : typeof value === "string" && value.trim().startsWith("=")
      ? value.trim().slice(1)
      : undefined;
  const styleOnly = !!record
    && !formula
    && !Object.prototype.hasOwnProperty.call(record, "value")
    && (typeof record.numFmt === "string" || normalizeSpreadsheetFontColor(record.fontColor) !== undefined);
  if (formula) {
    const result = record && Object.prototype.hasOwnProperty.call(record, "result")
      ? record.result
      : record && Object.prototype.hasOwnProperty.call(record, "value") ? record.value : undefined;
    cell.value = { formula, ...(result === undefined ? {} : { result }) } as ExcelJS.CellValue;
  } else if (record && Object.prototype.hasOwnProperty.call(record, "value")) {
    cell.value = (record.value ?? null) as ExcelJS.CellValue;
  } else if (!styleOnly) {
    cell.value = (value ?? null) as ExcelJS.CellValue;
  }
  if (typeof record?.numFmt === "string" || normalizeSpreadsheetFontColor(record?.fontColor)) {
    // ExcelJS reuses style objects across cells loaded from the same xf. Its
    // font/numFmt setters mutate that object in place, which can silently alter
    // untouched peers. Detach the complete style before changing one cell.
    cell.style = cloneWorkbookCellStyle(cell.style);
  }
  if (typeof record?.numFmt === "string") cell.numFmt = record.numFmt;
  const fontColor = normalizeSpreadsheetFontColor(record?.fontColor);
  if (fontColor) {
    const workbook = cell.worksheet.workbook as ExcelJS.Workbook & { _themes?: Record<string, string> };
    const theme = spreadsheetThemeIndexForColor(fontColor, workbook._themes?.theme1);
    cell.font = {
      ...cell.font,
      color: theme === undefined ? { argb: fontColor } : { theme },
    };
  }
}

function cloneWorkbookCellStyle(style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> {
  return {
    ...style,
    ...(style.font ? { font: cloneWorkbookStyleValue(style.font) } : {}),
    ...(style.alignment ? { alignment: cloneWorkbookStyleValue(style.alignment) } : {}),
    ...(style.border ? { border: cloneWorkbookStyleValue(style.border) } : {}),
    ...(style.fill ? { fill: cloneWorkbookStyleValue(style.fill) } : {}),
    ...(style.protection ? { protection: cloneWorkbookStyleValue(style.protection) } : {}),
  };
}

function cloneWorkbookStyleValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cellFontColor(cell: ExcelJS.Cell): string | undefined {
  const workbook = cell.worksheet.workbook as ExcelJS.Workbook & {
    _themes?: Record<string, string>;
  };
  return resolveSpreadsheetFontColor(
    cell.font?.color as SpreadsheetFontColorSource | undefined,
    workbook._themes?.theme1,
  );
}

function cellFontColorStyle(cell: ExcelJS.Cell): Pick<
  SpreadsheetBenchWorkbookCellPatch,
  "fontColor" | "fontColorTheme" | "fontColorTint"
> {
  const fontColor = cellFontColor(cell);
  if (!fontColor) return {};
  const source = cell.font?.color as SpreadsheetFontColorSource | undefined;
  const theme = typeof source?.theme === "number" && Number.isInteger(source.theme) && source.theme >= 0
    ? source.theme
    : undefined;
  const tint = typeof source?.tint === "number" && Number.isFinite(source.tint) ? source.tint : undefined;
  return {
    fontColor,
    ...(theme === undefined ? {} : { fontColorTheme: theme }),
    ...(theme === undefined || tint === undefined ? {} : { fontColorTint: tint }),
  };
}

function parseReadReference(value: string): {
  sheetName?: string;
  start: string;
  end: string;
} | undefined {
  const cleaned = value.trim().replace(/[,;]+$/, "").trim();
  const match = cleaned.match(READ_REFERENCE_RE);
  if (!match) return undefined;
  const quotedSheet = match[1]?.replace(/''/g, "'");
  const unquotedSheet = match[2]?.trim();
  const start = normalizeAddress(match[3]);
  const end = normalizeAddress(match[4] ?? match[3]);
  if (!parseAddress(start) || !parseAddress(end)) return undefined;
  return {
    ...(quotedSheet || unquotedSheet ? { sheetName: quotedSheet ?? unquotedSheet } : {}),
    start,
    end,
  };
}

function expandReadRange(startText: string, endText: string, limit: number): {
  addresses: string[];
  totalCells: number;
  truncated: boolean;
} {
  const start = parseAddress(startText);
  const end = parseAddress(endText);
  if (!start || !end) return { addresses: [], totalCells: 0, truncated: false };
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const totalCells = (maxRow - minRow + 1) * (maxCol - minCol + 1);
  const boundedLimit = Math.max(0, Math.trunc(limit));
  const addresses: string[] = [];
  for (let row = minRow; row <= maxRow && addresses.length < boundedLimit; row += 1) {
    for (let col = minCol; col <= maxCol && addresses.length < boundedLimit; col += 1) {
      addresses.push(addressFromPosition(row, col));
    }
  }
  return { addresses, totalCells, truncated: addresses.length < totalCells };
}

function appendReadHint(existing: string | undefined, addition: string): string {
  return existing ? `${existing} ${addition}` : addition;
}

function expandRange(startText: string, endText: string, limit: number): string[] {
  const start = parseAddress(startText);
  const end = parseAddress(endText);
  if (!start || !end) return [];
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  if ((maxRow - minRow + 1) * (maxCol - minCol + 1) > limit) {
    return [...new Set([
      addressFromPosition(minRow, minCol),
      addressFromPosition(minRow, maxCol),
      addressFromPosition(maxRow, minCol),
      addressFromPosition(maxRow, maxCol),
    ])];
  }
  const addresses: string[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) addresses.push(addressFromPosition(row, col));
  }
  return addresses;
}

function parseAddress(value: string): { row: number; col: number } | undefined {
  const match = normalizeAddress(value).match(/^([A-Z]{1,3})([1-9][0-9]*)$/);
  if (!match) return undefined;
  const row = Number(match[2]);
  const col = match[1].split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  if (row > EXCEL_MAX_ROW || col > EXCEL_MAX_COLUMN) return undefined;
  return { row, col };
}

function addressFromPosition(row: number, col: number): string {
  let name = "";
  let remaining = col;
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    name = String.fromCharCode(65 + index) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return `${name}${row}`;
}

function cellKey(sheet: string, address: string): string {
  return `${sheet.toLowerCase()}!${normalizeAddress(address)}`;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function stringArray(value: unknown, field: string, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`SpreadsheetBench agent manifest ${field} must be a string array: ${path}`);
  }
  return value as string[];
}

function isPathWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, "/");
}

function optionsPath(root: string, path: string): string {
  return resolve(root, path);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.trunc(value ?? fallback));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
