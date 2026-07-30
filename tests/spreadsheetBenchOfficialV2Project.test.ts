import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableTraceHash } from "../src/nodeagent/traces";

const tempRoots: string[] = [];
const MODEL_NAME = "example/free:free";
const MODEL_CALLS = 4;
const OFFICIAL_PROJECTION_TIMEOUT_MS = 60_000;
const categoryCounts = {
  Debugging: 100,
  Financial_Model: 100,
  Template: 97,
  Visualization: 24,
};

type FileEvidence = { path: string; sha256: string; bytes: number };

type ArtifactRef = {
  kind: string;
  refId: string;
  label: string;
  hash: string;
};

type FrameTraceEvent = {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  ms: number;
};

type StageReceipt = {
  traceId: string;
  stage: string;
  status: string;
  attempts: number;
  operationCount?: number;
  summary: string;
  events: Array<{
    traceId: string;
    eventIndex: number;
    step: number;
    tool: string;
    argsHash: string;
    resultHash: string;
  }>;
};

type MinimalNodeAgentTrace = {
  schema: string;
  traceId: string;
  createdAt: number;
  updatedAt: number;
  trigger: {
    kind: string;
    prompt: string;
    selectedArtifactIds: string[];
    openedSurface: string;
  };
  plan: {
    goal: string;
    plannedReads: ArtifactRef[];
    plannedWrites: ArtifactRef[];
    approvalRequired: boolean;
    riskFlags: string[];
  };
  contextPack: {
    worldModelHash: string;
    includedRefs: ArtifactRef[];
    excludedRefs: unknown[];
  };
  steps: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  mutations: Array<Record<string, unknown>>;
  approvals: unknown[];
  eval: {
    benchmarkCaseId: string;
    proofArtifacts: ArtifactRef[];
  };
  final: {
    outputArtifactRefs: ArtifactRef[];
    summary: string;
    status: string;
  };
};

type MinimalNodeAgentReceipt = {
  schema: string;
  traceId: string;
  taskId: string;
  track: string;
  category: string;
  candidateWorkbookPath: string;
  candidateWorkbookSha256: string;
  outcome: {
    status: string;
    mutatingTask: boolean;
    changedCellCount: number;
    finalVerificationStatus: string;
  };
  stages: Record<string, StageReceipt>;
  isolation: {
    boundary: string;
    agentRoot: string;
    openedAgentFiles: string[];
    evaluatorMetadataAccess: string;
    evaluatorFileReadCount: number;
    candidateEmittedBeforeEvaluatorAccess: boolean;
  };
  model: {
    name: string;
    calls: number;
    usage: { inputTokens: number; outputTokens: number };
  };
  recalculation: {
    engine: string;
    attemptedFormulaCount: number;
    refreshedFormulaCount: number;
    unresolvedFormulaCount: number;
    unresolved: unknown[];
  };
  frame: {
    status: string;
    agentResult: {
      stopReason: string;
      usage: {
        modelCalls: number;
        inputTokens: number;
        outputTokens: number;
      };
      trace: FrameTraceEvent[];
    };
  };
  trace: MinimalNodeAgentTrace;
};

type ProjectionResult = {
  taskId: string;
  category: string;
  mode: string;
  candidateWorkbook: string;
  model: { name: string; calls: number };
  sidecarEvidence: {
    nodeAgentReceipt: FileEvidence;
    nodeAgentTrace: FileEvidence;
  };
};

type ProjectionFixture = {
  root: string;
  runRoot: string;
  datasetRoot: string;
  upstream: string;
  outputs: string;
  reportPath: string;
  receiptPath: string;
  report: {
    schema: number;
    mode: string;
    taskCount: number;
    harness: { toolPolicy: string; evaluatorAccess: string };
    results: ProjectionResult[];
  };
};

afterEach(() => {
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench V2 official projection", () => {
  it("accepts authentic minimal NodeAgent receipts and traces bound to every candidate", () => {
    const fixture = createFixture();
    const wordingClassifiedNonmutating = fixture.report.results.find(
      (result) => result.taskId === "Debugging/001",
    )!;
    rewriteSidecars(
      fixture,
      wordingClassifiedNonmutating,
      (receipt) => {
        receipt.outcome.mutatingTask = false;
      },
    );
    const terminalAfterProof = fixture.report.results.find(
      (result) => result.taskId === "Debugging/002",
    )!;
    rewriteSidecars(fixture, terminalAfterProof, (receipt) => {
      receipt.frame.status = "blocked";
      receipt.frame.agentResult.stopReason = "step_budget";
    });
    const structuralRepair = fixture.report.results.find(
      (result) => result.taskId === "Debugging/003",
    )!;
    rewriteSidecars(fixture, structuralRepair, (receipt, trace) => {
      const frameTrace = structuralFrameTrace();
      const nextTrace = minimalTrace({
        taskId: receipt.taskId,
        traceId: receipt.traceId,
        candidatePath: receipt.candidateWorkbookPath,
        candidateSha256: receipt.candidateWorkbookSha256,
        frameTrace,
      });
      const nextReceipt = minimalReceipt({
        taskId: receipt.taskId,
        category: receipt.category,
        traceId: receipt.traceId,
        candidatePath: receipt.candidateWorkbookPath,
        candidateSha256: receipt.candidateWorkbookSha256,
        frameTrace,
        trace: nextTrace,
      });
      Object.assign(trace, nextTrace);
      Object.assign(receipt, nextReceipt);
    });
    writeJson(fixture.reportPath, fixture.report);
    const evaluatorBefore = readFileSync(
      join(fixture.upstream, "evaluation", "evaluation.py"),
      "utf8",
    );
    const visualEvaluatorBefore = readFileSync(
      join(fixture.upstream, "evaluation", "run_visual_vlm_checklist_eval.py"),
      "utf8",
    );

    const accepted = runProjection(fixture);

    expect(accepted.status, `${accepted.stdout}\n${accepted.stderr}`).toBe(0);
    const projection = readJson<{
      harnessMode: string;
      taskCount: number;
      projectedOutputCount: number;
      projectionErrorCount: number;
      cases: Array<{
        taskId: string;
        sourceSha256: string;
        outputSha256: string;
        nodeAgentReceipt: FileEvidence;
        nodeAgentTrace: FileEvidence;
      }>;
    }>(fixture.receiptPath);
    expect(projection).toMatchObject({
      harnessMode: "nodeagent-workbook",
      taskCount: 321,
      projectedOutputCount: 321,
      projectionErrorCount: 0,
    });
    expect(projection.cases[0]).toMatchObject({
      taskId: "Debugging/001",
      nodeAgentReceipt:
        fixture.report.results[0].sidecarEvidence.nodeAgentReceipt,
      nodeAgentTrace: fixture.report.results[0].sidecarEvidence.nodeAgentTrace,
    });
    expect(
      projection.cases.every((item) => item.sourceSha256 === item.outputSha256),
    ).toBe(true);
    expect(
      readFileSync(
        join(fixture.upstream, "evaluation", "evaluation.py"),
        "utf8",
      ),
    ).toBe(evaluatorBefore);
    expect(
      readFileSync(
        join(
          fixture.upstream,
          "evaluation",
          "run_visual_vlm_checklist_eval.py",
        ),
        "utf8",
      ),
    ).toBe(visualEvaluatorBefore);
  }, OFFICIAL_PROJECTION_TIMEOUT_MS);

  it("accepts a batch write that partially commits before reporting a conflict", () => {
    const fixture = createFixture();
    const result = fixture.report.results[0];
    rewriteSidecars(fixture, result, (receipt, trace) => {
      receipt.frame.agentResult.trace[1].result = {
        ok: false,
        results: [
          { ok: true, elementId: "A1", mutationReceiptId: "mutation-1" },
          { ok: false, conflict: true, elementId: "A2" },
        ],
        operationCount: 1,
        changedTargetCount: 1,
        phases: {
          plan: { status: "completed", targets: ["A1"] },
          preflight: { status: "passed" },
          write: { status: "completed" },
          verify: { status: "passed" },
        },
      };
      rebindFrameEvent(receipt, trace, 1);
    });
    writeJson(fixture.reportPath, fixture.report);

    const projected = runProjection(fixture);

    expect(projected.status, projected.stderr).toBe(0);
  }, OFFICIAL_PROJECTION_TIMEOUT_MS);

  it("accepts an already-satisfied mutation call as skipped when another call commits", () => {
    const fixture = createFixture();
    const result = fixture.report.results[0];
    rewriteSidecars(fixture, result, (receipt, trace) => {
      receipt.frame.agentResult.trace[1].result = {
        ok: true,
        status: "completed",
        operationCount: 1,
        changedTargetCount: 0,
        alreadySatisfied: true,
        phases: {
          plan: { status: "completed", targets: ["A1"] },
          preflight: { status: "passed" },
          write: { status: "completed" },
          verify: { status: "passed" },
        },
      };
      receipt.outcome.changedCellCount = 1;
      receipt.trace.mutations[0].status = "skipped";
      trace.mutations[0].status = "skipped";
      rebindFrameEvent(receipt, trace, 1);
    });
    writeJson(fixture.reportPath, fixture.report);

    const projected = runProjection(fixture);

    expect(projected.status, projected.stderr).toBe(0);
  }, OFFICIAL_PROJECTION_TIMEOUT_MS);

  it("rejects semantically forged sidecars even when their declared hashes are recomputed", () => {
    const fixture = createFixture();
    const mismatches: Array<{
      index: number;
      error: string;
      mutate: (
        receipt: MinimalNodeAgentReceipt,
        trace: MinimalNodeAgentTrace,
        result: ProjectionResult,
      ) => void;
    }> = [
      {
        index: 0,
        error: "NodeAgent receipt schema mismatch",
        mutate: (receipt) => {
          receipt.schema = "noderoom.spreadsheetbench.nodeagent_bridge.v0";
        },
      },
      {
        index: 1,
        error: "NodeAgent receipt taskId mismatch",
        mutate: (receipt) => {
          receipt.taskId = "Debugging/forged";
        },
      },
      {
        index: 2,
        error: "NodeAgent receipt traceId is missing",
        mutate: (receipt) => {
          receipt.traceId = "";
        },
      },
      {
        index: 3,
        error: "NodeAgent receipt candidate workbook hash mismatch",
        mutate: (receipt) => {
          receipt.candidateWorkbookSha256 = "0".repeat(64);
        },
      },
      {
        index: 4,
        error: "NodeAgent receipt isolation/evaluator-access contract mismatch",
        mutate: (receipt) => {
          receipt.isolation.evaluatorMetadataAccess = "opened_before_candidate";
        },
      },
      {
        index: 5,
        error: "NodeAgent receipt model name mismatch",
        mutate: (receipt) => {
          receipt.model.name = "forged/model";
        },
      },
      {
        index: 6,
        error: "NodeAgent receipt model calls mismatch",
        mutate: (receipt) => {
          receipt.model.calls += 1;
        },
      },
      {
        index: 7,
        error: "NodeAgent trace schema mismatch",
        mutate: (receipt, trace) => {
          receipt.trace.schema = "nodeagent.trace.v0";
          trace.schema = "nodeagent.trace.v0";
        },
      },
      {
        index: 8,
        error: "NodeAgent traceId mismatch",
        mutate: (receipt, trace) => {
          receipt.trace.traceId = "spreadsheetbench-nodeagent-forged";
          trace.traceId = "spreadsheetbench-nodeagent-forged";
        },
      },
      {
        index: 9,
        error: "NodeAgent trace benchmark case mismatch",
        mutate: (receipt, trace) => {
          receipt.trace.eval.benchmarkCaseId = "Debugging/forged";
          trace.eval.benchmarkCaseId = "Debugging/forged";
        },
      },
      {
        index: 10,
        error: "NodeAgent trace candidate proof hash mismatch",
        mutate: (receipt, trace) => {
          receipt.trace.eval.proofArtifacts[0].hash = "1".repeat(64);
          trace.eval.proofArtifacts[0].hash = "1".repeat(64);
        },
      },
      {
        index: 11,
        error: "NodeAgent trace final artifact hash mismatch",
        mutate: (receipt, trace) => {
          receipt.trace.final.outputArtifactRefs[0].hash = "2".repeat(64);
          trace.final.outputArtifactRefs[0].hash = "2".repeat(64);
        },
      },
      {
        index: 12,
        error: "NodeAgent receipt embedded trace does not match trace sidecar",
        mutate: (receipt) => {
          receipt.trace.final.summary = "forged embedded summary";
        },
      },
      {
        index: 13,
        error: "NodeAgent frame/model usage mismatch",
        mutate: (receipt) => {
          receipt.frame.agentResult.usage.modelCalls += 1;
        },
      },
      {
        index: 14,
        error: "NodeAgent frame execution receipt is invalid",
        mutate: (receipt) => {
          receipt.frame.agentResult.trace = [];
        },
      },
      {
        index: 15,
        error: "NodeAgent plan stage receipt is invalid",
        mutate: (receipt) => {
          receipt.stages.plan.attempts += 1;
        },
      },
      {
        index: 16,
        error: "NodeAgent verify stage event does not bind its frame event",
        mutate: (receipt) => {
          receipt.stages.verify.events[0].resultHash = "fnv1a:00000000";
        },
      },
      {
        index: 17,
        error: "NodeAgent trace evidence is missing",
        mutate: (receipt, trace) => {
          receipt.trace.evidence = [];
          trace.evidence = [];
        },
      },
      {
        index: 18,
        error: "NodeAgent trace mutations do not match frame writes",
        mutate: (receipt, trace) => {
          receipt.trace.mutations = [];
          trace.mutations = [];
        },
      },
      {
        index: 19,
        error: "NodeAgent verify stage status does not match frame events",
        mutate: (receipt) => {
          receipt.stages.verify.status = "needs_repair";
        },
      },
      {
        index: 20,
        error: "NodeAgent inspect stage events do not match frame semantics",
        mutate: (receipt) => {
          receipt.stages.inspect.events = structuredClone(
            receipt.stages.plan.events,
          );
          receipt.stages.inspect.attempts = receipt.stages.inspect.events.length;
        },
      },
      {
        index: 23,
        error: "NodeAgent changed cell count does not match committed mutations",
        mutate: (receipt) => {
          receipt.outcome.mutatingTask = false;
          receipt.outcome.changedCellCount = 0;
        },
      },
      {
        index: 24,
        error: "NodeAgent inspect stage status does not match frame events",
        mutate: (receipt, trace) => {
          receipt.frame.agentResult.trace[0].result = {
            ok: false,
            error: "inspection failed",
          };
          rebindFrameEvent(receipt, trace, 0);
        },
      },
      {
        index: 25,
        error: "NodeAgent verify stage status does not match frame events",
        mutate: (receipt, trace) => {
          const event = receipt.frame.agentResult.trace.at(-1)!;
          const phases = event.result.phases as Record<string, Record<string, unknown>>;
          phases.verify.status = "needs_repair";
          rebindFrameEvent(
            receipt,
            trace,
            receipt.frame.agentResult.trace.length - 1,
          );
        },
      },
      {
        index: 26,
        error: "NodeAgent write operation count does not match frame events",
        mutate: (receipt) => {
          receipt.stages.write.operationCount! += 1;
        },
      },
    ];
    const expectedErrors: string[] = [];
    for (const mismatch of mismatches) {
      const result = fixture.report.results[mismatch.index];
      rewriteSidecars(fixture, result, mismatch.mutate);
      expectedErrors.push(`${mismatch.error}: ${result.taskId}`);
    }
    const debugging = fixture.report.results.find(
      (result) => result.taskId === "Debugging/022",
    )!;
    const financialModel = fixture.report.results.find(
      (result) => result.taskId === "Financial_Model/022",
    )!;
    debugging.category = "Financial_Model";
    financialModel.category = "Debugging";
    expectedErrors.push(
      "task category conflicts with taskId: Debugging/022 declares Financial_Model",
      "task category conflicts with taskId: Financial_Model/022 declares Debugging",
    );
    const wrongDirectory = fixture.report.results.find(
      (result) => result.taskId === "Debugging/023",
    )!;
    const otherDirectory = fixture.report.results.find(
      (result) => result.taskId === "Financial_Model/023",
    )!;
    wrongDirectory.sidecarEvidence.nodeAgentReceipt = structuredClone(
      otherDirectory.sidecarEvidence.nodeAgentReceipt,
    );
    expectedErrors.push(
      "NodeAgent receipt path is not canonical for the candidate: Debugging/023",
    );
    writeJson(fixture.reportPath, fixture.report);

    const rejected = runProjection(fixture);

    expect(rejected.status, `${rejected.stdout}\n${rejected.stderr}`).toBe(1);
    const projection = readJson<{
      projectedOutputCount: number;
      errors: string[];
    }>(fixture.receiptPath);
    expect(projection.projectedOutputCount).toBe(
      321 - mismatches.length - 3,
    );
    for (const error of expectedErrors)
      expect(projection.errors).toContain(error);
  }, OFFICIAL_PROJECTION_TIMEOUT_MS);

  it("rejects a report that does not preserve evaluator-after-candidate access", () => {
    const fixture = createHarnessContractFixture();

    const rejected = runProjection(fixture);

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      "nodeagent-workbook report harness must declare toolPolicy=agent_dir_only_until_candidate and evaluatorAccess=after_candidate_emit_only",
    );
  }, OFFICIAL_PROJECTION_TIMEOUT_MS);
});

function createFixture(): ProjectionFixture {
  const root = mkdtempSync(join(tmpdir(), "spreadsheetbench-v2-project-"));
  tempRoots.push(root);
  const runRoot = join(root, "run");
  const datasetRoot = join(root, "dataset");
  const upstream = join(root, "upstream");
  const outputs = join(root, "official-outputs");
  const reportPath = join(root, "report.json");
  const receiptPath = join(root, "projection.json");
  const results: ProjectionResult[] = [];

  for (const [category, count] of Object.entries(categoryCounts)) {
    const tasks = Array.from({ length: count }, (_, index) => ({
      id: String(index + 1).padStart(3, "0"),
    }));
    writeJson(join(datasetRoot, category, "dataset.json"), tasks);
    for (const task of tasks) {
      const taskId = `${category}/${task.id}`;
      const taskDir = `${category}_${task.id}/attempt-01`;
      const candidateWorkbook = `${taskDir}/candidate-${task.id}_input.xlsx`;
      const candidatePath = join(runRoot, candidateWorkbook);
      writeFile(candidatePath, `candidate:${taskId}`);
      const candidateSha256 = sha256(readFileSync(candidatePath));
      const traceId = `spreadsheetbench-nodeagent-${sha256(taskId).slice(0, 12)}`;
      const frameTrace = minimalFrameTrace();
      const trace = minimalTrace({
        taskId,
        traceId,
        candidatePath,
        candidateSha256,
        frameTrace,
      });
      const receipt = minimalReceipt({
        taskId,
        category,
        traceId,
        candidatePath,
        candidateSha256,
        frameTrace,
        trace,
      });
      results.push({
        taskId,
        category,
        mode: "nodeagent-workbook",
        candidateWorkbook,
        model: { name: MODEL_NAME, calls: MODEL_CALLS },
        sidecarEvidence: {
          nodeAgentReceipt: writeJsonEvidence(
            runRoot,
            `${taskDir}/nodeagent-workbook-receipt.json`,
            receipt,
          ),
          nodeAgentTrace: writeJsonEvidence(
            runRoot,
            `${taskDir}/nodeagent-workbook-trace.json`,
            trace,
          ),
        },
      });
    }
  }

  writeFile(
    join(upstream, "evaluation", "evaluation.py"),
    "# immutable deterministic evaluator\n",
  );
  writeFile(
    join(upstream, "evaluation", "run_visual_vlm_checklist_eval.py"),
    "# immutable visual evaluator\n",
  );
  writeFile(
    join(upstream, ".git", "HEAD"),
    "0123456789abcdef0123456789abcdef01234567\n",
  );
  const report = {
    schema: 1,
    mode: "nodeagent-workbook",
    taskCount: 321,
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
    },
    results,
  };
  writeJson(reportPath, report);
  return {
    root,
    runRoot,
    datasetRoot,
    upstream,
    outputs,
    reportPath,
    receiptPath,
    report,
  };
}

function createHarnessContractFixture(): ProjectionFixture {
  const root = mkdtempSync(join(tmpdir(), "spreadsheetbench-v2-project-contract-"));
  tempRoots.push(root);
  const reportPath = join(root, "report.json");
  const report: ProjectionFixture["report"] = {
    schema: 1,
    mode: "nodeagent-workbook",
    taskCount: 321,
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "available_during_candidate_generation",
    },
    results: Array.from({ length: 321 }, () => ({}) as ProjectionResult),
  };
  writeJson(reportPath, report);
  return {
    root,
    runRoot: join(root, "run"),
    datasetRoot: join(root, "dataset"),
    upstream: join(root, "upstream"),
    outputs: join(root, "official-outputs"),
    reportPath,
    receiptPath: join(root, "projection.json"),
    report,
  };
}

function minimalFrameTrace(): FrameTraceEvent[] {
  return [
    {
      step: 0,
      tool: "inspect_workbook",
      args: { artifactId: "Sheet1", instruction: "Complete the workbook." },
      result: { ok: true, artifactId: "Sheet1", inspectedCellCount: 12 },
      ms: 4,
    },
    {
      step: 1,
      tool: "execute_verified_workbook_plan",
      args: { artifactId: "Sheet1", instruction: "Complete the workbook." },
      result: {
        ok: true,
        status: "completed",
        operationCount: 1,
        changedTargetCount: 1,
        phases: {
          plan: { status: "completed", targets: ["A1"] },
          preflight: { status: "passed" },
          write: { status: "completed" },
          verify: { status: "passed" },
        },
      },
      ms: 7,
    },
    {
      step: 2,
      tool: "execute_verified_workbook_plan",
      args: { artifactId: "Sheet1", instruction: "Repair the workbook." },
      result: {
        ok: true,
        status: "completed",
        operationCount: 1,
        changedTargetCount: 1,
        phases: {
          plan: { status: "completed", targets: ["A1"] },
          preflight: { status: "passed" },
          write: { status: "completed" },
          verify: { status: "passed" },
        },
      },
      ms: 5,
    },
  ];
}

function structuralFrameTrace(): FrameTraceEvent[] {
  return [
    {
      step: 0,
      tool: "inspect_workbook",
      args: { artifactId: "Sheet1", instruction: "Restore the deleted selector row." },
      result: { ok: true, artifactId: "Sheet1", inspectedCellCount: 12 },
      ms: 4,
    },
    {
      step: 1,
      tool: "execute_workbook_structure_repair",
      args: { artifactId: "Sheet1", instruction: "Restore the deleted selector row.", repairId: "selector-row" },
      result: {
        ok: true,
        status: "completed",
        operationCount: 4,
        targets: ["Sheet1!4:4", "Sheet1!B4", "Sheet1!C4", "Sheet1!D8"],
        phases: {
          preflight: { status: "passed" },
          write: { status: "completed" },
          verify: { status: "passed" },
        },
      },
      ms: 6,
    },
  ];
}

function minimalTrace(args: {
  taskId: string;
  traceId: string;
  candidatePath: string;
  candidateSha256: string;
  frameTrace: FrameTraceEvent[];
}): MinimalNodeAgentTrace {
  const candidateRef: ArtifactRef = {
    kind: "artifact",
    refId: args.candidatePath,
    label: `SpreadsheetBench candidate ${args.taskId}`,
    hash: args.candidateSha256,
  };
  return {
    schema: "nodeagent.trace.v1",
    traceId: args.traceId,
    createdAt: 1_000,
    updatedAt: 1_001,
    trigger: {
      kind: "benchmark",
      prompt: `Complete ${args.taskId}`,
      selectedArtifactIds: ["Sheet1"],
      openedSurface: "spreadsheetbench.nodeagent.bridge",
    },
    plan: {
      goal: `Complete ${args.taskId}`,
      plannedReads: [],
      plannedWrites: [structuredClone(candidateRef)],
      approvalRequired: false,
      riskFlags: [
        "evaluator_isolation",
        "workbook_mutation",
        "cas_managed_write",
      ],
    },
    contextPack: {
      worldModelHash: "fnv1a:test-world-model",
      includedRefs: [],
      excludedRefs: [],
    },
    steps: args.frameTrace.map((event, eventIndex) => {
      const argsHash = stableTraceHash(event.args);
      const resultHash = stableTraceHash(event.result);
      const stepId = `${args.traceId}:tool:${String(event.step).padStart(3, "0")}:${event.tool.replaceAll("_", "-")}`;
      return {
        stepId,
        traceId: args.traceId,
        phase: "tool_call",
        title: `Tool call: ${event.tool}`,
        summary: `Recorded frame event ${eventIndex}.`,
        inputRefs: [
          {
            kind: "tool_result",
            refId: `${stepId}:args`,
            hash: argsHash,
          },
        ],
        outputRefs: [
          {
            kind: "tool_result",
            refId: `${stepId}:result`,
            hash: resultHash,
          },
        ],
        tool: {
          name: event.tool,
          argsHash,
          resultHash,
          status: "ok",
          latencyMs: event.ms,
        },
        timings: {
          startedAt: 1_000 + eventIndex,
          endedAt: 1_000 + eventIndex + event.ms,
          latencyMs: event.ms,
        },
        verdict: { status: "ok" },
      };
    }),
    evidence: [
      {
        receiptId: `${args.traceId}:evidence:spreadsheetbench-inspect`,
        traceId: args.traceId,
        label: "SpreadsheetBench inspect",
        sourceRefs: [
          {
            kind: "tool_result",
            refId: `${args.traceId}:bridge:event:0`,
            hash: stableTraceHash(args.frameTrace[0].result),
          },
        ],
        artifactRefs: [structuredClone(candidateRef)],
        factHash: stableTraceHash({ status: "completed" }),
        verifier: "spreadsheetBenchNodeAgentBridge",
        status: "verified",
      },
      {
        receiptId: `${args.traceId}:evidence:spreadsheetbench-verify`,
        traceId: args.traceId,
        label: "SpreadsheetBench verify",
        sourceRefs: [
          {
            kind: "tool_result",
            refId: `${args.traceId}:bridge:event:${args.frameTrace.length - 1}`,
            hash: stableTraceHash(args.frameTrace.at(-1)!.result),
          },
        ],
        artifactRefs: [structuredClone(candidateRef)],
        factHash: stableTraceHash({ status: "completed" }),
        verifier: "verify_workbook",
        status: "verified",
      },
    ],
    mutations: args.frameTrace.slice(1).map((event) => {
      const resultTargets = Array.isArray(event.result.targets)
        ? event.result.targets.filter((target): target is string => typeof target === "string")
        : [];
      return {
        receiptId: `${args.traceId}:mutation:${stableTraceHash(event.args).slice(-8)}`,
        traceId: args.traceId,
        targetRefs: Array.from(
          { length: Number(event.result.operationCount ?? 1) },
          (_value, index) => ({
            kind: "cell",
            refId: resultTargets[index] ?? `Sheet1!A${index + 1}`,
            label: "SpreadsheetBench workbook target",
          }),
        ),
        payloadHash: stableTraceHash(event.args),
        status: "committed",
      };
    }),
    approvals: [],
    eval: {
      benchmarkCaseId: args.taskId,
      proofArtifacts: [structuredClone(candidateRef)],
    },
    final: {
      outputArtifactRefs: [structuredClone(candidateRef)],
      summary: "Workbook candidate emitted.",
      status: "completed",
    },
  };
}

function minimalReceipt(args: {
  taskId: string;
  category: string;
  traceId: string;
  candidatePath: string;
  candidateSha256: string;
  frameTrace: FrameTraceEvent[];
  trace: MinimalNodeAgentTrace;
}): MinimalNodeAgentReceipt {
  const eventRef = (eventIndex: number) => {
    const event = args.frameTrace[eventIndex];
    return {
      traceId: args.traceId,
      eventIndex,
      step: event.step,
      tool: event.tool,
      argsHash: stableTraceHash(event.args),
      resultHash: stableTraceHash(event.result),
    };
  };
  const stageReceipt = (
    stage: string,
    eventIndexes: number[] = [],
    operationCount?: number,
  ): StageReceipt => ({
    traceId: args.traceId,
    stage,
    status: eventIndexes.length === 0 ? "skipped" : "completed",
    attempts: eventIndexes.length,
    ...(operationCount === undefined ? {} : { operationCount }),
    summary: eventIndexes.length === 0 ? `${stage} skipped` : `${stage} complete`,
    events: eventIndexes.map(eventRef),
  });
  const stages: Record<string, StageReceipt> = {
    inspect: stageReceipt("inspect", [0]),
    plan: stageReceipt(
      "plan",
      args.frameTrace.slice(1).map((_event, index) => index + 1),
      Number(args.frameTrace.at(-1)?.result.operationCount ?? 0),
    ),
    preflight: stageReceipt(
      "preflight",
      args.frameTrace.slice(1).map((_event, index) => index + 1),
      Number(args.frameTrace.at(-1)?.result.operationCount ?? 0),
    ),
    write: stageReceipt(
      "write",
      args.frameTrace.slice(1).map((_event, index) => index + 1),
      args.frameTrace.slice(1).reduce((sum, event) => sum + Number(event.result.operationCount ?? 0), 0),
    ),
    verify: stageReceipt(
      "verify",
      args.frameTrace.slice(1).map((_event, index) => index + 1),
      Number(args.frameTrace.at(-1)?.result.operationCount ?? 0),
    ),
    repair: stageReceipt("repair"),
  };
  return {
    schema: "noderoom.spreadsheetbench.nodeagent_bridge.v1",
    traceId: args.traceId,
    taskId: args.taskId,
    track: "spreadsheetbench-v2",
    category: args.category,
    candidateWorkbookPath: args.candidatePath,
    candidateWorkbookSha256: args.candidateSha256,
    outcome: {
      status: "completed",
      mutatingTask: true,
      changedCellCount: args.frameTrace.slice(1).reduce(
        (sum, event) => sum + Number(event.result.operationCount ?? 0),
        0,
      ),
      finalVerificationStatus: "passed",
    },
    stages,
    isolation: {
      boundary: "agent_visible_files_only",
      agentRoot: join(dirname(args.candidatePath), "agent-workspace", "agent"),
      openedAgentFiles: ["task.json", "inputs/input.xlsx"],
      evaluatorMetadataAccess: "none",
      evaluatorFileReadCount: 0,
      candidateEmittedBeforeEvaluatorAccess: true,
    },
    model: {
      name: MODEL_NAME,
      calls: MODEL_CALLS,
      usage: { inputTokens: 120, outputTokens: 24 },
    },
    recalculation: {
      engine: "nodeagent-formula-engine",
      attemptedFormulaCount: 0,
      refreshedFormulaCount: 0,
      unresolvedFormulaCount: 0,
      unresolved: [],
    },
    frame: {
      status: "completed",
      agentResult: {
        stopReason: "done",
        usage: { modelCalls: MODEL_CALLS, inputTokens: 120, outputTokens: 24 },
        trace: structuredClone(args.frameTrace),
      },
    },
    trace: structuredClone(args.trace),
  };
}

function rewriteSidecars(
  fixture: ProjectionFixture,
  result: ProjectionResult,
  mutate: (
    receipt: MinimalNodeAgentReceipt,
    trace: MinimalNodeAgentTrace,
    result: ProjectionResult,
  ) => void,
): void {
  const receiptPath = join(
    fixture.runRoot,
    result.sidecarEvidence.nodeAgentReceipt.path,
  );
  const tracePath = join(
    fixture.runRoot,
    result.sidecarEvidence.nodeAgentTrace.path,
  );
  const receipt = readJson<MinimalNodeAgentReceipt>(receiptPath);
  const trace = readJson<MinimalNodeAgentTrace>(tracePath);
  mutate(receipt, trace, result);
  result.sidecarEvidence.nodeAgentReceipt = writeJsonEvidence(
    fixture.runRoot,
    result.sidecarEvidence.nodeAgentReceipt.path,
    receipt,
  );
  result.sidecarEvidence.nodeAgentTrace = writeJsonEvidence(
    fixture.runRoot,
    result.sidecarEvidence.nodeAgentTrace.path,
    trace,
  );
}

function rebindFrameEvent(
  receipt: MinimalNodeAgentReceipt,
  trace: MinimalNodeAgentTrace,
  eventIndex: number,
): void {
  const event = receipt.frame.agentResult.trace[eventIndex];
  const resultHash = stableTraceHash(event.result);
  for (const stage of Object.values(receipt.stages)) {
    for (const eventRef of stage.events) {
      if (eventRef.eventIndex === eventIndex) eventRef.resultHash = resultHash;
    }
  }
  const failed =
    event.result.ok === false || typeof event.result.error === "string";
  for (const target of [receipt.trace, trace]) {
    const step = target.steps[eventIndex];
    const tool = step.tool as Record<string, unknown>;
    tool.resultHash = resultHash;
    tool.status = failed ? "failed" : "ok";
    const outputRefs = step.outputRefs as Array<Record<string, unknown>>;
    for (const ref of outputRefs) ref.hash = resultHash;
    const verdict = step.verdict as Record<string, unknown>;
    verdict.status = failed ? "failed" : "ok";
    for (const evidence of target.evidence) {
      const sourceRefs = evidence.sourceRefs as Array<Record<string, unknown>>;
      for (const ref of sourceRefs) {
        if (ref.refId === `${receipt.traceId}:bridge:event:${eventIndex}`) {
          ref.hash = resultHash;
        }
      }
    }
  }
}

function runProjection(fixture: ProjectionFixture) {
  return spawnSync(
    process.execPath,
    [
      resolve("node_modules", "tsx", "dist", "cli.mjs"),
      resolve("scripts", "spreadsheetbench-official-v2-project.ts"),
      "--report",
      fixture.reportPath,
      "--run-root",
      fixture.runRoot,
      "--dataset-root",
      fixture.datasetRoot,
      "--upstream-repo",
      fixture.upstream,
      "--outputs-root",
      fixture.outputs,
      "--receipt-out",
      fixture.receiptPath,
      "--clean",
    ],
    { cwd: resolve("."), encoding: "utf8" },
  );
}

function writeJsonEvidence(
  root: string,
  relativePath: string,
  value: unknown,
): FileEvidence {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFile(join(root, relativePath), content);
  return {
    path: relativePath,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
