import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SPREADSHEETBENCH_NODEAGENT_BRIDGE_SCHEMA } from "../src/eval/spreadsheetBenchNodeAgentBridge";
import { stableTraceHash } from "../src/nodeagent/traces";

type RunReport = {
  schema?: number;
  mode?: string;
  outputRoot?: string;
  taskCount?: number;
  harness?: {
    toolPolicy?: string;
    evaluatorAccess?: string;
  };
  results?: Array<{
    taskId?: string;
    category?: string;
    mode?: string;
    candidateWorkbook?: string;
    model?: { name?: string; calls?: number };
    sidecarEvidence?: {
      nodeAgentReceipt?: FileEvidence;
      nodeAgentTrace?: FileEvidence;
    };
  }>;
};

type FileEvidence = { path?: string; sha256?: string; bytes?: number };

type JsonObject = Record<string, unknown>;

type LoadedJsonEvidence =
  | { ok: true; evidence: Required<FileEvidence>; value: JsonObject }
  | { ok: false; error: string };

type ValidatedNodeAgentEvidence = {
  receiptEvidence: Required<FileEvidence>;
  traceEvidence: Required<FileEvidence>;
};

type DatasetTask = { id?: string | number };

const CATEGORIES = [
  "Debugging",
  "Financial_Model",
  "Template",
  "Visualization",
] as const;
const EXPECTED_COUNTS: Record<(typeof CATEGORIES)[number], number> = {
  Debugging: 100,
  Financial_Model: 100,
  Template: 97,
  Visualization: 24,
};
const NODEAGENT_RECEIPT_SCHEMA = SPREADSHEETBENCH_NODEAGENT_BRIDGE_SCHEMA;
const NODEAGENT_TRACE_SCHEMA = "nodeagent.trace.v1";
const NODEAGENT_RECEIPT_FILE = "nodeagent-workbook-receipt.json";
const NODEAGENT_TRACE_FILE = "nodeagent-workbook-trace.json";
const NODEAGENT_TOOL_POLICY = "agent_dir_only_until_candidate";
const NODEAGENT_EVALUATOR_ACCESS = "after_candidate_emit_only";
const NODEAGENT_STAGES = [
  "inspect",
  "plan",
  "preflight",
  "write",
  "verify",
  "repair",
] as const;
const NODEAGENT_STAGE_STATUSES = new Set([
  "completed",
  "needs_repair",
  "blocked",
  "failed",
  "skipped",
]);
const NODEAGENT_OUTCOME_STATUSES = new Set([
  "completed",
  "needs_repair",
  "blocked",
  "failed",
]);
const NODEAGENT_STOP_REASONS = new Set([
  "done",
  "step_budget",
  "time_budget",
  "spend_budget",
  "error",
]);
const NODEAGENT_FRAME_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "blocked",
  "skipped",
  "failed",
]);
const NODEAGENT_TRACE_FINAL_STATUSES = new Set([
  "completed",
  "failed",
  "needs_review",
  "cancelled",
]);
const NODEAGENT_MUTATION_TOOLS = new Set([
  "write_locked_cell",
  "write_locked_cells",
  "execute_verified_workbook_plan",
]);

const args = process.argv.slice(2);
const reportPath = resolve(requiredOption("--report"));
const runRoot = resolve(requiredOption("--run-root"));
const datasetRoot = resolve(requiredOption("--dataset-root"));
const upstreamRepo = resolve(requiredOption("--upstream-repo"));
const outputsRoot = resolve(requiredOption("--outputs-root"));
const receiptOut = resolve(requiredOption("--receipt-out"));
const clean = args.includes("--clean");
const report = readJson<RunReport>(reportPath);
const allowedModes = new Set(["model-edit-plan", "nodeagent-workbook"]);

if (report.schema !== 1)
  throw new Error(`run report schema must be 1, got ${String(report.schema)}`);
if (!report.mode || !allowedModes.has(report.mode)) {
  throw new Error(
    `V2 official projection requires model-edit-plan or nodeagent-workbook, got ${String(report.mode)}`,
  );
}
if (report.taskCount !== 321 || report.results?.length !== 321) {
  throw new Error(
    `V2 official projection requires 321 results, got taskCount=${String(report.taskCount)} results=${report.results?.length ?? 0}`,
  );
}
if (
  report.mode === "nodeagent-workbook" &&
  (report.harness?.toolPolicy !== NODEAGENT_TOOL_POLICY ||
    report.harness.evaluatorAccess !== NODEAGENT_EVALUATOR_ACCESS)
) {
  throw new Error(
    `nodeagent-workbook report harness must declare toolPolicy=${NODEAGENT_TOOL_POLICY} and evaluatorAccess=${NODEAGENT_EVALUATOR_ACCESS}`,
  );
}

const upstreamDataRoot = join(upstreamRepo, "data");
if (clean) {
  for (const category of CATEGORIES) {
    rmSync(join(upstreamDataRoot, category), { recursive: true, force: true });
    rmSync(join(outputsRoot, category), { recursive: true, force: true });
  }
}

const datasetIds = new Map<string, Set<string>>();
for (const category of CATEGORIES) {
  const sourceCategory = join(datasetRoot, category);
  const datasetPath = join(sourceCategory, "dataset.json");
  if (!existsSync(datasetPath))
    throw new Error(`dataset is missing: ${datasetPath}`);
  const tasks = readJson<DatasetTask[]>(datasetPath);
  const ids = new Set(tasks.map((task) => String(task.id ?? "")));
  if (ids.has("") || ids.size !== EXPECTED_COUNTS[category]) {
    throw new Error(
      `${category} dataset must contain ${EXPECTED_COUNTS[category]} unique IDs, got ${ids.size}`,
    );
  }
  datasetIds.set(category, ids);
  mkdirSync(upstreamDataRoot, { recursive: true });
  cpSync(sourceCategory, join(upstreamDataRoot, category), {
    recursive: true,
    force: true,
  });
}

const seen = new Set<string>();
const categoryCounts = Object.fromEntries(
  CATEGORIES.map((category) => [category, 0]),
) as Record<string, number>;
const cases: Array<{
  taskId: string;
  category: string;
  id: string;
  model: string;
  modelCalls: number;
  source: string;
  sourceSha256: string;
  output: string;
  outputSha256: string;
  nodeAgentReceipt?: FileEvidence;
  nodeAgentTrace?: FileEvidence;
}> = [];
const errors: string[] = [];

for (const result of report.results) {
  const taskId = result.taskId ?? "";
  const slash = taskId.indexOf("/");
  const category = taskId.slice(0, slash) as (typeof CATEGORIES)[number];
  const id = slash >= 0 ? taskId.slice(slash + 1) : "";
  if (!CATEGORIES.includes(category) || !id) {
    errors.push(`invalid task identity: ${taskId}`);
    continue;
  }
  if (result.category !== undefined && result.category !== category) {
    errors.push(
      `task category conflicts with taskId: ${taskId} declares ${result.category}`,
    );
    continue;
  }
  if (seen.has(taskId)) {
    errors.push(`duplicate task: ${taskId}`);
    continue;
  }
  seen.add(taskId);
  if (!datasetIds.get(category)?.has(id)) {
    errors.push(`task is absent from upstream dataset: ${taskId}`);
    continue;
  }
  if ((result.mode ?? report.mode) !== report.mode) {
    errors.push(`task mode does not match report mode: ${taskId}`);
    continue;
  }
  const candidateWorkbook = result.candidateWorkbook;
  if (!candidateWorkbook) {
    errors.push(`candidate workbook missing from report: ${taskId}`);
    continue;
  }
  const source = resolve(runRoot, candidateWorkbook);
  if (!isExistingFileWithin(runRoot, source)) {
    errors.push(`candidate workbook missing on disk: ${taskId} -> ${source}`);
    continue;
  }
  const sourceSha256 = sha256File(source);
  let nodeAgentEvidence: ValidatedNodeAgentEvidence | undefined;
  if (report.mode === "nodeagent-workbook") {
    const validation = validateNodeAgentEvidence({
      runRoot,
      taskId,
      category,
      candidatePath: source,
      candidateSha256: sourceSha256,
      reportModel: result.model,
      receiptEvidence: result.sidecarEvidence?.nodeAgentReceipt,
      traceEvidence: result.sidecarEvidence?.nodeAgentTrace,
    });
    if (!validation.ok) {
      errors.push(`${validation.error}: ${taskId}`);
      continue;
    }
    nodeAgentEvidence = validation.value;
  }
  const output = join(outputsRoot, category, `${id}_output.xlsx`);
  mkdirSync(dirname(output), { recursive: true });
  cpSync(source, output, { force: true });
  const outputSha256 = sha256File(output);
  if (sourceSha256 !== outputSha256)
    errors.push(`copy hash mismatch: ${taskId}`);
  categoryCounts[category] += 1;
  cases.push({
    taskId,
    category,
    id,
    model: result.model?.name ?? "unknown",
    modelCalls: result.model?.calls ?? 0,
    source: rel(source),
    sourceSha256,
    output: rel(output),
    outputSha256,
    ...(nodeAgentEvidence
      ? {
          nodeAgentReceipt: nodeAgentEvidence.receiptEvidence,
          nodeAgentTrace: nodeAgentEvidence.traceEvidence,
        }
      : {}),
  });
}

for (const category of CATEGORIES) {
  if (categoryCounts[category] !== EXPECTED_COUNTS[category]) {
    errors.push(
      `${category} projection expected ${EXPECTED_COUNTS[category]} outputs, got ${categoryCounts[category]}`,
    );
  }
}
if (seen.size !== 321)
  errors.push(`projection expected 321 unique tasks, got ${seen.size}`);

const evaluatorPath = join(upstreamRepo, "evaluation", "evaluation.py");
const visualEvaluatorPath = join(
  upstreamRepo,
  "evaluation",
  "run_visual_vlm_checklist_eval.py",
);
if (!existsSync(evaluatorPath) || !existsSync(visualEvaluatorPath))
  throw new Error("upstream V2 evaluators are missing");
cases.sort((a, b) => a.taskId.localeCompare(b.taskId));
const caseManifestSha256 = sha256(JSON.stringify(cases));
writeJson(receiptOut, {
  schema: 1,
  track: "spreadsheetbench-v2",
  harnessMode: report.mode,
  generatedAt: new Date().toISOString(),
  report: rel(reportPath),
  reportSha256: sha256File(reportPath),
  taskCount: seen.size,
  projectedOutputCount: cases.length,
  projectionErrorCount: errors.length,
  categoryCounts,
  caseManifestSha256,
  outputsRoot: rel(outputsRoot),
  upstream: {
    repository: "https://github.com/RUCKBReasoning/SpreadsheetBench-2",
    commit: gitCommit(upstreamRepo),
    evaluator: rel(evaluatorPath),
    evaluatorSha256: sha256File(evaluatorPath),
    visualEvaluator: rel(visualEvaluatorPath),
    visualEvaluatorSha256: sha256File(visualEvaluatorPath),
  },
  errors,
  cases,
});
console.log(
  `projected ${cases.length}/321 V2 ${report.mode} outputs (${errors.length} errors)`,
);
console.log(`wrote ${rel(receiptOut)}`);
if (errors.length) process.exitCode = 1;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateNodeAgentEvidence(args: {
  runRoot: string;
  taskId: string;
  category: (typeof CATEGORIES)[number];
  candidatePath: string;
  candidateSha256: string;
  reportModel?: { name?: string; calls?: number };
  receiptEvidence?: FileEvidence;
  traceEvidence?: FileEvidence;
}):
  | { ok: true; value: ValidatedNodeAgentEvidence }
  | { ok: false; error: string } {
  const receiptFile = loadJsonEvidence({
    root: args.runRoot,
    candidatePath: args.candidatePath,
    expectedBasename: NODEAGENT_RECEIPT_FILE,
    label: "NodeAgent receipt",
    evidence: args.receiptEvidence,
  });
  if (!receiptFile.ok) return receiptFile;
  const traceFile = loadJsonEvidence({
    root: args.runRoot,
    candidatePath: args.candidatePath,
    expectedBasename: NODEAGENT_TRACE_FILE,
    label: "NodeAgent trace",
    evidence: args.traceEvidence,
  });
  if (!traceFile.ok) return traceFile;

  const receipt = receiptFile.value;
  if (receipt.schema !== NODEAGENT_RECEIPT_SCHEMA)
    return invalid("NodeAgent receipt schema mismatch");
  if (receipt.taskId !== args.taskId)
    return invalid("NodeAgent receipt taskId mismatch");
  if (receipt.track !== "spreadsheetbench-v2")
    return invalid("NodeAgent receipt track mismatch");
  if (receipt.category !== undefined && receipt.category !== args.category)
    return invalid("NodeAgent receipt category mismatch");
  const traceId = nonemptyString(receipt.traceId);
  if (!traceId) return invalid("NodeAgent receipt traceId is missing");
  if (!nonemptyString(receipt.candidateWorkbookPath))
    return invalid("NodeAgent receipt candidate path is missing");
  if (resolve(receipt.candidateWorkbookPath as string) !== resolve(args.candidatePath))
    return invalid("NodeAgent receipt candidate path mismatch");
  if (
    !isSha256(receipt.candidateWorkbookSha256) ||
    receipt.candidateWorkbookSha256.toLowerCase() !== args.candidateSha256
  ) {
    return invalid("NodeAgent receipt candidate workbook hash mismatch");
  }

  const isolation = asObject(receipt.isolation);
  if (
    isolation?.boundary !== "agent_visible_files_only" ||
    !nonemptyString(isolation.agentRoot) ||
    !nonemptyStringArray(isolation.openedAgentFiles) ||
    isolation.evaluatorMetadataAccess !== "none" ||
    isolation.evaluatorFileReadCount !== 0 ||
    isolation.candidateEmittedBeforeEvaluatorAccess !== true
  ) {
    return invalid(
      "NodeAgent receipt isolation/evaluator-access contract mismatch",
    );
  }

  const reportModelName = nonemptyString(args.reportModel?.name);
  const reportModelCalls = args.reportModel?.calls;
  if (
    !reportModelName ||
    !Number.isInteger(reportModelCalls) ||
    (reportModelCalls ?? 0) < 1
  ) {
    return invalid("NodeAgent report model identity is invalid");
  }
  const receiptModel = asObject(receipt.model);
  const receiptModelName = nonemptyString(receiptModel?.name);
  const receiptModelCalls = receiptModel?.calls;
  if (!receiptModelName || receiptModelName !== reportModelName)
    return invalid("NodeAgent receipt model name mismatch");
  if (
    !Number.isInteger(receiptModelCalls) ||
    receiptModelCalls !== reportModelCalls ||
    (receiptModelCalls as number) < 1
  ) {
    return invalid("NodeAgent receipt model calls mismatch");
  }

  const traceError = validateNodeAgentTrace(traceFile.value, {
    taskId: args.taskId,
    traceId,
    candidatePath: receipt.candidateWorkbookPath as string,
    candidateSha256: args.candidateSha256,
  });
  if (traceError) return invalid(traceError);
  const embeddedTrace = asObject(receipt.trace);
  if (!embeddedTrace)
    return invalid("NodeAgent receipt embedded trace is missing");
  if (!isDeepStrictEqual(embeddedTrace, traceFile.value)) {
    return invalid(
      "NodeAgent receipt embedded trace does not match trace sidecar",
    );
  }
  const consistencyError = validateNodeAgentExecutionConsistency(
    receipt,
    traceFile.value,
    traceId,
  );
  if (consistencyError) return invalid(consistencyError);

  return {
    ok: true,
    value: {
      receiptEvidence: receiptFile.evidence,
      traceEvidence: traceFile.evidence,
    },
  };
}

function isPathWithin(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    Boolean(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function isExistingFileWithin(root: string, path: string): boolean {
  try {
    return (
      existsSync(path) &&
      statSync(path).isFile() &&
      isPathWithin(realpathSync(root), realpathSync(path))
    );
  } catch {
    return false;
  }
}

function loadJsonEvidence(args: {
  root: string;
  candidatePath: string;
  expectedBasename: string;
  label: string;
  evidence?: FileEvidence;
}): LoadedJsonEvidence {
  const evidencePath = args.evidence?.path;
  const declaredSha256 = args.evidence?.sha256;
  const declaredBytes = args.evidence?.bytes;
  if (
    !nonemptyString(evidencePath) ||
    isAbsolute(evidencePath) ||
    !isSha256(declaredSha256) ||
    !Number.isInteger(declaredBytes) ||
    (declaredBytes ?? 0) <= 0
  ) {
    return invalid(`${args.label} evidence metadata is invalid`);
  }
  const path = resolve(args.root, evidencePath);
  const expectedPath = join(dirname(args.candidatePath), args.expectedBasename);
  if (relative(path, expectedPath) !== "")
    return invalid(`${args.label} path is not canonical for the candidate`);
  if (!isExistingFileWithin(args.root, path))
    return invalid(`${args.label} file is missing or outside the run root`);

  const content = readFileSync(path);
  const actualSha256 = createHash("sha256").update(content).digest("hex");
  if (
    content.byteLength !== declaredBytes ||
    actualSha256 !== declaredSha256.toLowerCase()
  ) {
    return invalid(`${args.label} evidence hash or byte count mismatch`);
  }
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8"));
  } catch {
    return invalid(`${args.label} is not valid JSON`);
  }
  const object = asObject(value);
  if (!object) return invalid(`${args.label} JSON root must be an object`);
  return {
    ok: true,
    evidence: {
      path: evidencePath,
      sha256: declaredSha256,
      bytes: declaredBytes as number,
    },
    value: object,
  };
}

function validateNodeAgentTrace(
  trace: JsonObject,
  expected: {
    taskId: string;
    traceId: string;
    candidatePath: string;
    candidateSha256: string;
  },
): string | undefined {
  if (trace.schema !== NODEAGENT_TRACE_SCHEMA)
    return "NodeAgent trace schema mismatch";
  if (trace.traceId !== expected.traceId) return "NodeAgent traceId mismatch";
  if (asObject(trace.trigger)?.kind !== "benchmark")
    return "NodeAgent trace trigger mismatch";

  const evalReceipt = asObject(trace.eval);
  if (evalReceipt?.benchmarkCaseId !== expected.taskId)
    return "NodeAgent trace benchmark case mismatch";
  const proofRefError = candidateArtifactRefError(
    evalReceipt?.proofArtifacts,
    expected,
    "NodeAgent trace candidate proof hash mismatch",
  );
  if (proofRefError) return proofRefError;

  const finalReceipt = asObject(trace.final);
  if (
    !finalReceipt ||
    !["completed", "failed", "needs_review", "cancelled"].includes(
      String(finalReceipt.status),
    )
  ) {
    return "NodeAgent trace final receipt is invalid";
  }
  return candidateArtifactRefError(
    finalReceipt.outputArtifactRefs,
    expected,
    "NodeAgent trace final artifact hash mismatch",
  );
}

function validateNodeAgentExecutionConsistency(
  receipt: JsonObject,
  trace: JsonObject,
  traceId: string,
): string | undefined {
  const outcome = asObject(receipt.outcome);
  const outcomeStatus = outcome?.status;
  const mutatingTask = outcome?.mutatingTask;
  const changedCellCount = outcome?.changedCellCount;
  const finalVerificationStatus = outcome?.finalVerificationStatus;
  if (
    !outcome ||
    !NODEAGENT_OUTCOME_STATUSES.has(String(outcomeStatus)) ||
    typeof mutatingTask !== "boolean" ||
    !isNonnegativeInteger(changedCellCount) ||
    !["passed", "needs_repair", "missing"].includes(
      String(finalVerificationStatus),
    )
  ) {
    return "NodeAgent receipt outcome is invalid";
  }
  const frame = asObject(receipt.frame);
  const frameStatus = frame?.status;
  const agentResult = asObject(frame?.agentResult);
  const stopReason = agentResult?.stopReason;
  const frameUsage = asObject(agentResult?.usage);
  const frameTrace = agentResult?.trace;
  if (
    !frame ||
    !NODEAGENT_FRAME_STATUSES.has(String(frameStatus)) ||
    !agentResult ||
    !NODEAGENT_STOP_REASONS.has(String(stopReason)) ||
    !frameUsage ||
    !Array.isArray(frameTrace) ||
    frameTrace.length === 0
  ) {
    return "NodeAgent frame execution receipt is invalid";
  }

  const receiptModel = asObject(receipt.model);
  const receiptUsage = asObject(receiptModel?.usage);
  if (
    !receiptUsage ||
    !sameNonnegativeInteger(receiptModel?.calls, frameUsage.modelCalls) ||
    !sameNonnegativeInteger(receiptUsage.inputTokens, frameUsage.inputTokens) ||
    !sameNonnegativeInteger(receiptUsage.outputTokens, frameUsage.outputTokens) ||
    (receiptUsage.cachedInputTokens !== undefined &&
      !sameNonnegativeInteger(
        receiptUsage.cachedInputTokens,
        frameUsage.cachedInputTokens,
      ))
  ) {
    return "NodeAgent frame/model usage mismatch";
  }

  const frameEvents: JsonObject[] = [];
  for (const value of frameTrace) {
    const event = asObject(value);
    if (
      !event ||
      !isNonnegativeInteger(event.step) ||
      !nonemptyString(event.tool) ||
      typeof event.ms !== "number" ||
      !Number.isFinite(event.ms) ||
      event.ms < 0
    ) {
      return "NodeAgent frame trace event is invalid";
    }
    frameEvents.push(event);
  }

  const traceSteps = trace.steps;
  if (!Array.isArray(traceSteps) || traceSteps.length !== frameEvents.length) {
    return "NodeAgent trace steps do not match frame trace";
  }
  for (let index = 0; index < frameEvents.length; index += 1) {
    const event = frameEvents[index];
    const step = asObject(traceSteps[index]);
    const tool = asObject(step?.tool);
    const argsHash = stableTraceHash(event.args);
    const resultHash = stableTraceHash(event.result);
    const expectedToolStatus = traceEventFailed(event.result) ? "failed" : "ok";
    if (
      !step ||
      step.traceId !== traceId ||
      !nonemptyString(step.stepId) ||
      !tool ||
      tool.name !== event.tool ||
      tool.argsHash !== argsHash ||
      tool.resultHash !== resultHash ||
      tool.status !== expectedToolStatus ||
      !traceRefArrayContainsHash(step.inputRefs, argsHash) ||
      !traceRefArrayContainsHash(step.outputRefs, resultHash)
    ) {
      return "NodeAgent trace step does not bind its frame event";
    }
  }

  const stages = asObject(receipt.stages);
  if (!stages) return "NodeAgent stage receipts are missing";
  const stageReceipts = new Map<string, JsonObject>();
  for (const stageName of NODEAGENT_STAGES) {
    const stage = asObject(stages[stageName]);
    const events = stage?.events;
    if (
      !stage ||
      stage.traceId !== traceId ||
      stage.stage !== stageName ||
      !NODEAGENT_STAGE_STATUSES.has(String(stage.status)) ||
      !isNonnegativeInteger(stage.attempts) ||
      !Array.isArray(events) ||
      stage.attempts !== events.length ||
      (stage.operationCount !== undefined &&
        !isNonnegativeInteger(stage.operationCount)) ||
      !nonemptyString(stage.summary)
    ) {
      return `NodeAgent ${stageName} stage receipt is invalid`;
    }
    if (stage.status === "completed" && events.length === 0) {
      return `NodeAgent completed ${stageName} stage has no events`;
    }
    if (stage.status === "skipped" && events.length !== 0) {
      return `NodeAgent skipped ${stageName} stage has events`;
    }
    for (const value of events) {
      const eventRef = asObject(value);
      const eventIndex = eventRef?.eventIndex;
      if (
        !eventRef ||
        eventRef.traceId !== traceId ||
        !isNonnegativeInteger(eventIndex) ||
        (eventIndex as number) >= frameEvents.length
      ) {
        return `NodeAgent ${stageName} stage event reference is invalid`;
      }
      const frameEvent = frameEvents[eventIndex as number];
      if (
        eventRef.step !== frameEvent.step ||
        eventRef.tool !== frameEvent.tool ||
        eventRef.argsHash !== stableTraceHash(frameEvent.args) ||
        eventRef.resultHash !== stableTraceHash(frameEvent.result)
      ) {
        return `NodeAgent ${stageName} stage event does not bind its frame event`;
      }
    }
    stageReceipts.set(stageName, stage);
  }
  const derivedStages = deriveNodeAgentStages(frameEvents);
  for (const stageName of NODEAGENT_STAGES) {
    const stage = stageReceipts.get(stageName)!;
    const events = stage.events as unknown[];
    const actualEventIndexes = events.map(
      (value) => asObject(value)!.eventIndex as number,
    );
    const expected = derivedStages[stageName];
    if (!isDeepStrictEqual(actualEventIndexes, expected.eventIndexes)) {
      return `NodeAgent ${stageName} stage events do not match frame semantics`;
    }
    if (stage.status !== expected.status) {
      return `NodeAgent ${stageName} stage status does not match frame events`;
    }
    if (stage.operationCount !== expected.operationCount) {
      return `NodeAgent ${stageName} operation count does not match frame events`;
    }
  }

  const traceEvidence = trace.evidence;
  if (!Array.isArray(traceEvidence) || traceEvidence.length === 0) {
    return "NodeAgent trace evidence is missing";
  }
  for (const value of traceEvidence) {
    const evidence = asObject(value);
    if (
      !evidence ||
      evidence.traceId !== traceId ||
      !nonemptyString(evidence.receiptId) ||
      !nonemptyString(evidence.label) ||
      !["verified", "needs_review", "rejected"].includes(
        String(evidence.status),
      ) ||
      !Array.isArray(evidence.sourceRefs) ||
      !Array.isArray(evidence.artifactRefs)
    ) {
      return "NodeAgent trace evidence receipt is invalid";
    }
  }

  const mutationEvents = frameEvents.filter((event) =>
    NODEAGENT_MUTATION_TOOLS.has(String(event.tool)),
  );
  const mutations = trace.mutations;
  if (!Array.isArray(mutations) || mutations.length !== mutationEvents.length) {
    return "NodeAgent trace mutations do not match frame writes";
  }
  let committedMutationCount = 0;
  let committedTargetOccurrences = 0;
  for (let index = 0; index < mutationEvents.length; index += 1) {
    const event = mutationEvents[index];
    const mutation = asObject(mutations[index]);
    const targets = mutation?.targetRefs;
    const expectedStatus = traceMutationStatus(event.result);
    if (
      !mutation ||
      mutation.traceId !== traceId ||
      !nonemptyString(mutation.receiptId) ||
      mutation.payloadHash !== stableTraceHash(event.args) ||
      mutation.status !== expectedStatus ||
      !Array.isArray(targets)
    ) {
      return "NodeAgent mutation receipt does not bind its frame write";
    }
    if (mutation.status === "committed" && targets.length === 0) {
      return "NodeAgent committed mutation has no targets";
    }
    if (mutation.status === "committed") {
      committedMutationCount += 1;
      committedTargetOccurrences += targets.length;
    }
    for (const value of targets) {
      const target = asObject(value);
      if (!target || !nonemptyString(target.refId) || !nonemptyString(target.kind)) {
        return "NodeAgent mutation target is invalid";
      }
    }
  }
  const observedCommittedMutation = committedMutationCount > 0;
  if (observedCommittedMutation !== ((changedCellCount as number) > 0)) {
    return "NodeAgent changed cell count does not match committed mutations";
  }

  const traceFinal = asObject(trace.final);
  const expectedFinalStatus = outcomeStatus === "completed"
    ? "completed"
    : outcomeStatus === "failed"
      ? "failed"
      : "needs_review";
  if (
    !traceFinal ||
    !NODEAGENT_TRACE_FINAL_STATUSES.has(String(traceFinal.status)) ||
    traceFinal.status !== expectedFinalStatus
  ) {
    return "NodeAgent trace final status does not match outcome";
  }
  if (frameStatus === "completed" && stopReason !== "done") {
    return "NodeAgent frame completion does not match stop reason";
  }
  if (stopReason !== "done" && frameStatus !== "blocked") {
    return "NodeAgent terminal frame stop is not blocked";
  }
  if (
    outcomeStatus === "completed" &&
    stageReceipts.get("inspect")?.status !== "completed"
  ) {
    return "NodeAgent completed outcome lacks completed inspect stage";
  }
  if (
    outcomeStatus === "failed" &&
    stopReason !== "error" &&
    !nonemptyString(frame.runtimeError)
  ) {
    return "NodeAgent failed outcome does not match frame failure";
  }
  if (
    outcomeStatus === "blocked" &&
    frameStatus !== "blocked" &&
    stopReason === "done"
  ) {
    return "NodeAgent blocked outcome does not match frame stop";
  }

  const completedMutation = outcomeStatus === "completed";
  if (completedMutation) {
    if (
      !observedCommittedMutation ||
      (changedCellCount as number) < 1 ||
      finalVerificationStatus !== "passed"
    ) {
      return "NodeAgent completed mutation lacks changed cells or verification";
    }
    for (const stageName of [
      "inspect",
      "plan",
      "preflight",
      "write",
      "verify",
    ] as const) {
      if (stageReceipts.get(stageName)?.status !== "completed") {
        return `NodeAgent completed mutation lacks completed ${stageName} stage`;
      }
    }
    for (const stageName of ["plan", "preflight", "write", "verify"] as const) {
      const operationCount = stageReceipts.get(stageName)?.operationCount;
      if (!isPositiveInteger(operationCount)) {
        return `NodeAgent completed mutation lacks ${stageName} operations`;
      }
    }
    if (
      (stageReceipts.get("write")?.operationCount as number) <
      (changedCellCount as number)
    ) {
      return "NodeAgent write operation count is below changed cell count";
    }
    if (committedTargetOccurrences < (changedCellCount as number)) {
      return "NodeAgent committed mutation targets are below changed cell count";
    }
  }
  if (
    finalVerificationStatus === "passed" &&
    stageReceipts.get("verify")?.status !== "completed"
  ) {
    return "NodeAgent passed verification lacks completed verify stage";
  }

  const recalculation = asObject(receipt.recalculation);
  if (
    !recalculation ||
    recalculation.engine !== "nodeagent-formula-engine" ||
    !isNonnegativeInteger(recalculation.attemptedFormulaCount) ||
    !isNonnegativeInteger(recalculation.refreshedFormulaCount) ||
    !isNonnegativeInteger(recalculation.unresolvedFormulaCount) ||
    !Array.isArray(recalculation.unresolved) ||
    recalculation.unresolvedFormulaCount !== recalculation.unresolved.length
  ) {
    return "NodeAgent recalculation receipt is invalid";
  }
  if (
    outcomeStatus === "completed" &&
    recalculation.unresolvedFormulaCount !== 0
  ) {
    return "NodeAgent completed outcome has unresolved formulas";
  }
  return undefined;
}

function candidateArtifactRefError(
  value: unknown,
  expected: { candidatePath: string; candidateSha256: string },
  message: string,
): string | undefined {
  if (!Array.isArray(value) || value.length !== 1) return message;
  const ref = asObject(value[0]);
  return ref?.kind === "artifact" &&
    ref.refId === expected.candidatePath &&
    isSha256(ref.hash) &&
    ref.hash.toLowerCase() === expected.candidateSha256
    ? undefined
    : message;
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function sameNonnegativeInteger(left: unknown, right: unknown): boolean {
  return (
    isNonnegativeInteger(left) &&
    isNonnegativeInteger(right) &&
    left === right
  );
}

function traceRefArrayContainsHash(value: unknown, hash: string): boolean {
  return (
    Array.isArray(value) &&
    value.some((entry) => asObject(entry)?.hash === hash)
  );
}

function traceEventFailed(result: unknown): boolean {
  const record = asObject(result);
  return Boolean(record && (record.ok === false || typeof record.error === "string"));
}

function traceMutationStatus(
  result: unknown,
): "proposed" | "committed" | "skipped" | "conflict" | "pending_approval" {
  const record = asObject(result);
  if (record?.pendingApproval === true) return "pending_approval";
  if (record?.conflict === true) return "conflict";
  if (record?.skipped === true) return "skipped";
  if (record?.ok === true) return "committed";
  return "conflict";
}

type DerivedNodeAgentStage = {
  status: string;
  eventIndexes: number[];
  operationCount?: number;
};

function deriveNodeAgentStages(
  frameEvents: JsonObject[],
): Record<(typeof NODEAGENT_STAGES)[number], DerivedNodeAgentStage> {
  const indexed = frameEvents.map((event, eventIndex) => ({ event, eventIndex }));
  const inspect = indexed.filter(({ event }) => event.tool === "inspect_workbook");
  const composite = indexed.filter(
    ({ event }) => event.tool === "execute_verified_workbook_plan",
  );
  const verifications = indexed.filter(
    ({ event }) => event.tool === "verify_workbook",
  );
  const explicitPreflights = verifications.filter(
    ({ event }) => nodeAgentVerificationPhase(event) === "preflight",
  );
  const explicitPostWrites = verifications.filter(
    ({ event }) => nodeAgentVerificationPhase(event) === "post_write",
  );
  const compositePreflights = composite.filter(
    ({ event }) =>
      nodeAgentCompositePhaseStatus(event.result, "preflight") !== "missing",
  );
  const compositePostWrites = composite.filter(
    ({ event }) =>
      nodeAgentCompositePhaseStatus(event.result, "verify") !== "missing",
  );
  const preflights = [...explicitPreflights, ...compositePreflights].sort(
    (left, right) => left.eventIndex - right.eventIndex,
  );
  const postWrites = [...explicitPostWrites, ...compositePostWrites].sort(
    (left, right) => left.eventIndex - right.eventIndex,
  );
  const writes = indexed.filter(({ event }) =>
    NODEAGENT_MUTATION_TOOLS.has(String(event.tool)),
  );
  const failedVerifications = [
    ...explicitPreflights.filter(
      ({ event }) => nodeAgentVerificationStatus(event.result) !== "passed",
    ),
    ...explicitPostWrites.filter(
      ({ event }) => nodeAgentVerificationStatus(event.result) !== "passed",
    ),
    ...compositePreflights.filter(
      ({ event }) =>
        nodeAgentCompositePhaseStatus(event.result, "preflight") !== "passed",
    ),
    ...compositePostWrites.filter(
      ({ event }) =>
        nodeAgentCompositePhaseStatus(event.result, "verify") !== "passed",
    ),
  ].sort((left, right) => left.eventIndex - right.eventIndex);
  const latestPreflight = preflights.at(-1)?.event;
  const latestPostWrite = postWrites.at(-1)?.event;
  const planOperationCount =
    nodeAgentOperationCount(latestPreflight?.args) ||
    nodeAgentCompositeOperationCount(latestPreflight?.result);
  const repairResolved =
    failedVerifications.length > 0 &&
    nodeAgentEventVerificationStatus(latestPostWrite, "verify") === "passed" &&
    failedVerifications.some(({ eventIndex }) =>
      indexed.some(
        (entry) =>
          entry.eventIndex > eventIndex &&
          (entry.event.tool === "verify_workbook" ||
            NODEAGENT_MUTATION_TOOLS.has(String(entry.event.tool))),
      ),
    );
  const inspectStatus =
    inspect.length === 0
      ? "skipped"
      : inspect.some(({ event }) => nodeAgentEventSucceeded(event.result))
        ? "completed"
        : "failed";
  const preflightStatus = latestPreflight
    ? nodeAgentEventVerificationStatus(latestPreflight, "preflight") === "passed"
      ? "completed"
      : "needs_repair"
    : "skipped";
  const writeStatus =
    writes.length === 0
      ? "skipped"
      : nodeAgentEventSucceeded(writes.at(-1)!.event.result)
        ? "completed"
        : "blocked";
  const verifyStatus = latestPostWrite
    ? nodeAgentEventVerificationStatus(latestPostWrite, "verify") === "passed"
      ? "completed"
      : "needs_repair"
    : "skipped";
  return {
    inspect: {
      status: inspectStatus,
      eventIndexes: inspect.map(({ eventIndex }) => eventIndex),
    },
    plan: {
      status: preflights.length ? preflightStatus : "skipped",
      eventIndexes: preflights.map(({ eventIndex }) => eventIndex),
      operationCount: planOperationCount,
    },
    preflight: {
      status: preflightStatus,
      eventIndexes: preflights.map(({ eventIndex }) => eventIndex),
      operationCount: planOperationCount,
    },
    write: {
      status: writeStatus,
      eventIndexes: writes.map(({ eventIndex }) => eventIndex),
      operationCount: writes.reduce(
        (sum, { event }) =>
          sum +
          (nodeAgentOperationCount(event.args) ||
            nodeAgentCompositeOperationCount(event.result)),
        0,
      ),
    },
    verify: {
      status: verifyStatus,
      eventIndexes: postWrites.map(({ eventIndex }) => eventIndex),
      operationCount:
        nodeAgentOperationCount(latestPostWrite?.args) ||
        nodeAgentCompositeOperationCount(latestPostWrite?.result),
    },
    repair: {
      status:
        failedVerifications.length === 0
          ? "skipped"
          : repairResolved
            ? "completed"
            : "needs_repair",
      eventIndexes: failedVerifications.map(({ eventIndex }) => eventIndex),
    },
  };
}

function nodeAgentVerificationPhase(
  event: JsonObject,
): "preflight" | "post_write" {
  const result = asObject(event.result);
  if (result?.phase === "preflight") return "preflight";
  if (result?.phase === "post_write") return "post_write";
  return asObject(event.args)?.afterWrite === false ? "preflight" : "post_write";
}

function nodeAgentVerificationStatus(
  result: unknown,
): "passed" | "needs_repair" | "missing" {
  const status = asObject(result)?.status;
  return status === "passed"
    ? "passed"
    : status === "needs_repair"
      ? "needs_repair"
      : "missing";
}

function nodeAgentCompositePhaseStatus(
  result: unknown,
  phase: "preflight" | "verify",
): "passed" | "needs_repair" | "missing" {
  const receipt = asObject(asObject(asObject(result)?.phases)?.[phase]);
  const status = receipt?.status;
  if (status === "passed" || status === "completed") return "passed";
  if (typeof status === "string" && status !== "skipped") return "needs_repair";
  return "missing";
}

function nodeAgentEventVerificationStatus(
  event: JsonObject | undefined,
  phase: "preflight" | "verify",
): "passed" | "needs_repair" | "missing" {
  if (!event) return "missing";
  return event.tool === "execute_verified_workbook_plan"
    ? nodeAgentCompositePhaseStatus(event.result, phase)
    : nodeAgentVerificationStatus(event.result);
}

function nodeAgentEventSucceeded(result: unknown): boolean {
  const record = asObject(result);
  if (!record) return true;
  if (record.pendingApproval === true || record.drafted === true) return true;
  return record.ok !== false && typeof record.error !== "string";
}

function nodeAgentOperationCount(args: unknown): number {
  const record = asObject(args);
  if (!record) return 0;
  if (Array.isArray(record.operations)) return record.operations.length;
  if (Array.isArray(record.ops)) return record.ops.length;
  if (Array.isArray(record.cells)) return record.cells.length;
  return typeof record.elementId === "string" ? 1 : 0;
}

function nodeAgentCompositeOperationCount(result: unknown): number {
  const count = asObject(result)?.operationCount;
  return typeof count === "number" && Number.isFinite(count)
    ? Math.max(0, Math.trunc(count))
    : 0;
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() === value && value.length > 0
    ? value
    : undefined;
}

function nonemptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => Boolean(nonemptyString(item)))
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function gitCommit(repo: string): string {
  const head = readFileSync(join(repo, ".git", "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  return readFileSync(join(repo, ".git", head.slice(5)), "utf8").trim();
}

function requiredOption(name: string): string {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
