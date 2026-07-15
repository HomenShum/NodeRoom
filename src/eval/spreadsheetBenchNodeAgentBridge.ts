import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import { readSpreadsheetBenchWorkbookForMutation } from "./spreadsheetBenchScorer";
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
  PRODUCTION_ROOM_TOOLS,
} from "../nodeagent/skills/spreadsheet/cellMutator";
import {
  extractWorkbookTaskReferences,
  inspectWorkbookTask,
  normalizeAddress,
  normalizeFormula,
  selectWorkbookTaskCells,
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
const MUTATION_TOOL_NAMES = new Set<string>([...WRITE_TOOL_NAMES, EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME]);
const A1_RE = /^\$?[A-Z]{1,3}\$?[1-9][0-9]*$/i;
const DEFAULT_SNAPSHOT_MAX_CELLS = 1_200;
const DEFAULT_SCAN_MAX_CELLS = 50_000;

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
  now?: () => number;
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
  const frame = buildBridgeFrame(task.manifest, room.artifactIds(), traceId);
  const workflowController = new BridgeWorkbookWorkflowController(intelligenceInstruction, room.artifactIds()[0]);
  const tools = selectBridgeTools(
    [...PRODUCTION_ROOM_TOOLS, EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL],
    workflowController,
  );
  const frameReceipt = await runReasoningFrame({
    rt: room,
    frame,
    model: options.model,
    tools,
    maxSteps: Math.max(1, Math.trunc(options.maxSteps ?? 18)),
    deadlineAt: options.modelTimeoutMs === undefined ? undefined : startedAt + Math.max(1, options.modelTimeoutMs),
    reserveMs: 0,
    includeRoomContext: false,
    systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
    additionalInstructions: bridgeInstructions(task, room.artifactIds()),
    now: options.now,
  });

  const recalculation = room.recalculateChangedFormulas();
  mkdirSync(dirname(candidateWorkbookPath), { recursive: true });
  await workbook.xlsx.writeFile(candidateWorkbookPath);
  const candidateWorkbookSha256 = sha256File(candidateWorkbookPath);
  const stages = buildStageReceipts(traceId, frameReceipt);
  const mutatingTask = room.taskInspection().mutatingTask;
  const outcome = bridgeOutcome(
    frameReceipt,
    stages,
    mutatingTask,
    room.changedCellCount(),
    bridgeWorkbookRepairContract(room).requiredRepairs.length,
    workflowController.pendingVerificationCount(),
    recalculation.unresolvedFormulaCount,
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
      name: options.model.name,
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
    frame: frameReceipt,
    trace,
  };
}

class SpreadsheetBenchWorkbookRoomTools implements RoomTools {
  private readonly workbook: ExcelJS.Workbook;
  private readonly instruction: string;
  private readonly sourceWorkbookName: string;
  private readonly snapshotMaxCells: number;
  private readonly scanMaxCells: number;
  private readonly versions = new Map<string, number>();
  private readonly locks = new Map<string, ActiveLock>();
  private readonly changedTargets = new Map<string, { sheet: string; address: string }>();
  private readonly chat: string[] = [];
  private lockCounter = 0;
  private draftCounter = 0;
  private workbookVersion = 1;
  private mutations = 0;

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

  taskInspection() {
    this.recalculateChangedFormulas();
    return inspectWorkbookTask({
      instruction: this.instruction,
      sheetNames: this.artifactIds(),
      cells: this.observedCells(),
    });
  }

  async snapshot(artifactId?: string): Promise<RoomSnapshot> {
    this.recalculateChangedFormulas();
    const allCells = this.observedCells();
    const inspection = inspectWorkbookTask({
      instruction: this.instruction,
      sheetNames: this.artifactIds(),
      cells: allCells,
    });
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
      readHint: `Use artifactId ${JSON.stringify(sheet.name)} with A1 addresses.`,
    }));
  }

  async readRange(elementIds: string[], artifactId?: string): Promise<CellView[]> {
    this.recalculateChangedFormulas();
    const fallbackSheet = this.sheet(artifactId);
    const addresses = elementIds.length
      ? elementIds
      : this.observedCells().filter((cell) => cell.sheet === fallbackSheet.name).slice(0, 40).map((cell) => cell.address);
    return addresses.map((elementId) => {
      const target = this.target(elementId, fallbackSheet.name);
      const cell = target.sheet.getCell(target.address);
      return {
        id: target.address,
        value: roomCellValue(cell),
        version: this.version(target.sheet.name, target.address, cell),
        locked: this.isLocked(target.sheet.name, target.address)
          ? { by: "spreadsheetbench-nodeagent", reason: "managed workbook write" }
          : null,
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
    this.changedTargets.set(cellKey(target.sheet.name, target.address), {
      sheet: target.sheet.name,
      address: target.address,
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
    const selected = [...scores.entries()]
      .sort((left, right) => right[1] - left[1] || this.artifactIds().indexOf(left[0]) - this.artifactIds().indexOf(right[0]))[0];
    return selected && selected[1] > 0 ? this.sheet(selected[0]) : this.workbook.worksheets[0];
  }

  private target(elementId: string, fallbackSheet: string): { sheet: ExcelJS.Worksheet; address: string } {
    const qualified = elementId.match(/^(?:'([^']+)'|([^!]+))!\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)$/i);
    const sheet = qualified ? this.sheet((qualified[1] ?? qualified[2]).trim()) : this.sheet(fallbackSheet);
    const address = normalizeAddress(qualified ? qualified[3] : elementId);
    if (!A1_RE.test(address)) throw new Error(`Invalid SpreadsheetBench cell address: ${elementId}`);
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

function buildBridgeFrame(manifest: StagedAgentManifest, artifactIds: string[], traceId: string): ReasoningFrame {
  return {
    frameId: `rf_${traceId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 100)}`,
    goal: manifest.instruction,
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
    "Treat high-confidence target bands and value/formula suggestions from inspect_workbook as the target-selection contract. Do not replace them with unlabeled blank cells, and preflight every high-confidence target before writing.",
    "The first verify_workbook call for a proposed operation set is the durable plan/preflight boundary. Do not write a plan that returns needs_repair; submit a corrected replacement plan first.",
    "When inspect_workbook returns a complete high-confidence formula/value contract, prefer execute_verified_workbook_plan with the same task instruction and artifactId. It performs deterministic plan materialization, preflight, managed-lock writes, and post-write verification without requiring a large echoed operation array.",
    "For formula writes, pass write_locked_cell(s) direct formula, result, and optional numFmt fields; pass the same formula/result/numFmt operations to verify_workbook.",
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
    if (tool.name === "read_range" || tool.name === "search_sheet_context") {
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

function bridgeWorkbookInspection(rt: RoomTools): WorkbookTaskInspection | undefined {
  const provider = rt as RoomTools & { taskInspection?: () => WorkbookTaskInspection };
  return typeof provider.taskInspection === "function" ? provider.taskInspection() : undefined;
}

function bridgeWorkbookRepairContract(rt: RoomTools): { schema: 1; requiredRepairs: BridgeWorkbookRepair[] } {
  const inspection = bridgeWorkbookInspection(rt);
  if (!inspection) return { schema: 1, requiredRepairs: [] };
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
    const parsedTarget = bridgeElementTarget(operation.elementId, artifactId);
    const target = `${parsedTarget.sheet.toLowerCase()}!${parsedTarget.address}`;
    return [{
      target,
      ...(formula ? { formula } : {}),
      ...(!formula && (hasResult || hasValue) ? { value } : {}),
      ...(numFmtValue?.trim() ? { numFmt: numFmtValue.trim() } : {}),
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
    ...(operation.formula ? { formula: operation.formula } : { value: operation.value }),
    ...(operation.numFmt ? { numFmt: operation.numFmt } : {}),
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
  const composite = indexed.filter(({ event }) => event.tool === EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME);
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
    status: args.recalculation.unresolvedFormulaCount === 0 ? "verified" : "needs_review",
  }));
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
  if (record?.conflict === true) return "conflict";
  if (record?.skipped === true) return "skipped";
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
  const plan = asRecord(asRecord(resultRecord?.phases)?.plan);
  if (Array.isArray(plan?.targets)) {
    for (const target of plan.targets) if (typeof target === "string") targets.push(target);
  }
  return [...new Set(targets.map((target) => artifactId ? `${artifactId}!${target}` : target))];
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
  return event.tool === EXECUTE_VERIFIED_WORKBOOK_PLAN_TOOL_NAME
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
  return {
    sheet: sheet.name,
    address: normalizeAddress(cell.address),
    value: roomCellScalar(cell),
    ...(cellFormula(cell) ? { formula: cellFormula(cell) } : {}),
    ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
    version,
  };
}

function roomCellValue(cell: ExcelJS.Cell): unknown {
  const formula = cellFormula(cell);
  const numFmt = cell.numFmt && cell.numFmt !== "General" ? cell.numFmt : undefined;
  if (formula || numFmt) {
    return {
      value: roomCellScalar(cell),
      ...(formula ? { formula } : {}),
      ...(numFmt ? { numFmt } : {}),
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
  if (value instanceof Date) return (value.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000;
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
  if (formula) {
    const result = record && Object.prototype.hasOwnProperty.call(record, "result")
      ? record.result
      : record && Object.prototype.hasOwnProperty.call(record, "value") ? record.value : undefined;
    cell.value = { formula, ...(result === undefined ? {} : { result }) } as ExcelJS.CellValue;
  } else if (record && Object.prototype.hasOwnProperty.call(record, "value")) {
    cell.value = (record.value ?? null) as ExcelJS.CellValue;
  } else {
    cell.value = (value ?? null) as ExcelJS.CellValue;
  }
  if (typeof record?.numFmt === "string") cell.numFmt = record.numFmt;
}

function expandRange(startText: string, endText: string, limit: number): string[] {
  const start = parseAddress(startText);
  const end = parseAddress(endText);
  if (!start || !end) return A1_RE.test(startText) ? [normalizeAddress(startText)] : [];
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
  return {
    row: Number(match[2]),
    col: match[1].split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0),
  };
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
  if (value instanceof Date) return value.toISOString();
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
