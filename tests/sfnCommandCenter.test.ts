import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initSoloLoop } from "../src/solo/ralphLoopLedger";
import {
  SOLO_EVENT_TYPES,
  appendSoloBusEvent,
  createSoloEvent,
  installSoloHookTemplates,
  readSoloBusEvents,
  renderAgentMatrix,
  validateSoloEvent,
} from "../src/solo/soloEventBus";
import {
  renderNodeRoomWatch,
  renderProofCaseSummary,
  renderSfnAgentMatrix,
  renderSfnDashboard,
} from "../src/solo/sfnCommandCenter";
import {
  buildSfnProofRunCommand,
  getSfnProofCase,
} from "../src/solo/proofCaseRegistry";
import { buildBtbFreshRoomMatrixPlan } from "../src/solo/btbFreshRoomMatrix";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-sfn-"));
  roots.push(root);
  return root;
}

describe("sfn command center", () => {
  it("defines a universal event vocabulary for agent hooks and wrappers", () => {
    expect(SOLO_EVENT_TYPES).toEqual(expect.arrayContaining([
      "session.start",
      "prompt.submit",
      "tool.pre",
      "tool.post",
      "command.run.post",
      "browser.proof.start",
      "receipt.write",
      "rework.recorded",
    ]));

    const event = createSoloEvent({
      id: "evt_test",
      event: "tool.post",
      agent: "codex",
      phase: "P",
      status: "ok",
      createdAt: "2026-06-24T00:00:00.000Z",
      command: "npm run test:product:live",
    });
    expect(validateSoloEvent(event)).toEqual({ ok: true, errors: [] });
  });

  it("records events into the shared .solo event log", async () => {
    const projectRoot = tempProject();
    initSoloLoop({ projectRoot, goal: "watch all agents", loopId: "loop_events" });
    await appendSoloBusEvent(projectRoot, createSoloEvent({
      event: "command.run.post",
      agent: "generic",
      phase: "P",
      status: "ok",
      command: "npm run fresh-room:proofs",
      createdAt: "2026-06-24T00:00:00.000Z",
    }));

    const events = readSoloBusEvents(projectRoot);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining(["session.start", "command.run.post"]));
    expect(events.find((event) => event.event === "command.run.post")?.command).toBe("npm run fresh-room:proofs");
  });

  it("renders the agent adapter matrix and dashboard surfaces", () => {
    const projectRoot = tempProject();
    initSoloLoop({ projectRoot, goal: "NodeRoom FR-010 proof", loopId: "loop_dashboard" });

    expect(renderAgentMatrix()).toContain("Claude Code");
    expect(renderAgentMatrix()).toContain("external_proof_only");
    expect(renderSfnAgentMatrix()).toContain("sfn agent matrix");

    const dashboard = renderSfnDashboard({ projectRoot, caseId: "FR-010" });
    expect(dashboard).toContain("Solo Founder Agent Builder");
    expect(dashboard).toContain("NodeRoom FR-010 proof");
    expect(dashboard).toContain("Active proof case: FR-010");

    expect(renderProofCaseSummary("FR-010")).toContain("FR-010 Proof Run");
    expect(renderNodeRoomWatch("FR-010")).toContain("NodeRoom Live Proof");
  });

  it("renders NodeRoom-specific live proof surfaces", () => {
    const cwd = process.cwd();
    const projectRoot = tempProject();
    process.chdir(projectRoot);
    try {
      const screenshotPath = join(projectRoot, "proof.png");
      const tracePath = join(projectRoot, "trace.json");
      const exportedPath = join(projectRoot, "package.xlsx");
      writeFileSync(screenshotPath, "png");
      writeFileSync(tracePath, "{}");
      writeFileSync(exportedPath, "xlsx");
      const proofPath = join(projectRoot, "docs", "eval", "fresh-room", "FR-020", "latest.json");
      mkdirSync(dirname(proofPath), { recursive: true });
      writeFileSync(proofPath, JSON.stringify({
        schema: 1,
        caseId: "FR-020",
        benchmark: "bankertoolbench",
        taskId: "btb-demo",
        generatedAt: "2026-06-24T00:00:00.000Z",
        baseUrl: "http://127.0.0.1:5273",
        roomId: "NRDEMO",
        roomUrl: "http://127.0.0.1:5273/?room=NRDEMO",
        command: "npx playwright test",
        model: {
          id: "z-ai/glm-5.2",
          resolved: "z-ai/glm-5.2",
          provider: "openrouter",
          routePolicy: "specific",
          role: "worker",
          runtimeProfile: "benchmark_completion",
          costUsd: 0.026,
          tokensIn: 1200,
          tokensOut: 300,
        },
        memoryMode: false,
        freshness: {
          roomCreatedAfterRunStart: true,
          forbiddenPreloadedArtifactsAbsent: true,
          artifactsCreatedFresh: ["btb-demo.xlsx"],
          uploadedFiles: ["source.xlsx"],
        },
        ui: {
          focusModeEnabled: true,
          attentionOverlayVisible: true,
          streamingVisible: true,
          jobDetailVisible: true,
          roomTraceVisible: true,
          screenshotPaths: [screenshotPath],
          tracePath,
        },
        artifacts: {
          uploadedFiles: ["source.xlsx"],
          exportedFiles: [{
            kind: "workbook",
            filename: "btb-demo.xlsx",
            path: exportedPath,
            extension: ".xlsx",
            downloaded: true,
            bytes: 4,
          }],
          reopenedFiles: [{
            kind: "workbook",
            filename: "btb-demo.xlsx",
            reopened: true,
            scorerResult: "pass",
          }],
        },
        scorer: {
          name: "BankerToolBench proof verifier",
          verdict: "pass",
        },
        visualJudge: {
          verdict: "not_run",
          reason: "GOOGLE_GENERATIVE_AI_API_KEY is not set",
        },
        telemetry: {
          costUsd: 0.026,
          modelCalls: 3,
          toolCalls: 4,
        },
        gatesProven: [
          "fresh_room_join",
          "official_fixture_upload",
          "public_nodeagent_invocation",
          "visible_streaming_progress",
          "trace_video_artifacts",
          "no_memory_mode_shortcut",
          "focus_mode_enabled",
          "focus_box_or_attention_overlay",
          "agent_live_loop",
          "room_trace_visible",
          "job_detail_visible",
          "deliverable_export_download",
          "artifact_reopen_validation",
          "official_scorer_handoff",
        ],
        passed: true,
      }, null, 2));
      const ledgerPath = join(projectRoot, "docs", "eval", "fresh-room", "FR-020", "matrix-ledger.json");
      writeFileSync(ledgerPath, JSON.stringify({
        selectedTaskCount: 100,
        provenTaskCount: 100,
        failedReceiptCount: 0,
        missingReceiptCount: 0,
        fullBenchmarkClaim: "ready",
      }, null, 2));

      const output = renderNodeRoomWatch("FR-020");

      expect(output).toContain("Real user path");
      expect(output).toContain("public @nodeagent ask in room chat");
      expect(output).toContain("NodeRoom surfaces");
      expect(output).toContain("Focus Mode on");
      expect(output).toContain("room trace visible");
      expect(output).toContain("exported/downloaded files: 1");
      expect(output).toContain("visual judge: not_run");
      expect(output).toContain("FR-020 BTB matrix");
      expect(output).toContain("tasks proven: 100/100");
    } finally {
      process.chdir(cwd);
    }
  });

  it("installs hook templates without requiring a specific native hook host", () => {
    const projectRoot = tempProject();
    const written = installSoloHookTemplates(projectRoot, "generic");

    expect(written).toEqual(expect.arrayContaining([
      ".solo/bin/record-event",
      ".codex/hooks.json",
      ".claude/settings.json",
      ".windsurf/hooks.json",
      ".devin/rules/solo-founder-loop.md",
    ]));
    expect(existsSync(join(projectRoot, ".solo", "bin", "record-event"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf8")).toContain("PostToolUse");
  });

  it("maps proof cases to real headed browser commands without claiming full BTB coverage", () => {
    const fr10 = buildSfnProofRunCommand("FR-010", { headed: true, baseUrl: "http://127.0.0.1:5273" });
    expect(fr10.command).toBe("npx");
    expect(fr10.args).toEqual(expect.arrayContaining(["playwright", "test", "e2e/benchmark-ui-spreadsheetbench.spec.ts", "--headed"]));
    expect(fr10.env.BENCH_BASE_URL).toBe("http://127.0.0.1:5273");

    const fr20 = buildSfnProofRunCommand("FR-020", { headed: true, taskId: "btb-707cba99" });
    expect(fr20.args).toEqual(expect.arrayContaining(["e2e/benchmark-ui-bankertoolbench.spec.ts", "--headed"]));
    expect(fr20.env.BTB_LIVE_ROOM_E2E).toBe("1");
    expect(fr20.env.BTB_UI_TASK_ID).toBe("btb-707cba99");
    expect(getSfnProofCase("FR-020")).toMatchObject({
      benchmark: "bankertoolbench",
      fullBenchmarkClaim: "single_case_only",
    });
  });

  it("builds shardable per-task BTB fresh-room commands and receipt paths", () => {
    const bundleRoot = makeBtbBundle([
      { id: "a-task", prompt: "Build package A" },
      { id: "b-task", prompt: "Build package B" },
      { id: "c-task", prompt: "Build package C" },
    ]);

    const plan = buildBtbFreshRoomMatrixPlan({
      bundleRoot,
      headed: true,
      shardIndex: 1,
      shardCount: 2,
      agentModelPolicy: "z-ai/glm-5.2",
      recoverRoomCode: "NR90A2X3NLB",
      recoverTracePath: "test-results/.playwright-artifacts-0/traces/recovered.trace",
    });

    expect(plan.totalTasks).toBe(3);
    expect(plan.selectedTaskCount).toBe(1);
    expect(plan.tasks[0]).toMatchObject({
      taskId: "b-task",
      harborTaskId: "btb-b",
      receiptPath: join("docs/eval/fresh-room/FR-020/tasks", "b-task", "latest.json"),
      legacyProofPath: join("docs/eval/bankertoolbench/live-room", "b-task.json"),
      packageManifestPath: join("test-results/bankertoolbench/matrix", "b-task", "package-manifest.json"),
    });
    expect(plan.tasks[0]?.args).toEqual(expect.arrayContaining([
      "e2e/benchmark-ui-bankertoolbench.spec.ts",
      "--headed",
      "--output",
      join("test-results/bankertoolbench/matrix", "b-task", "playwright-output"),
    ]));
    expect(plan.tasks[0]?.env).toMatchObject({
      BTB_UI_TASK_ID: "b-task",
      BTB_FRESH_ROOM_PROOF_PATH: join("docs/eval/fresh-room/FR-020/tasks", "b-task", "latest.json"),
      BTB_PACKAGE_MANIFEST_PATH: join("test-results/bankertoolbench/matrix", "b-task", "package-manifest.json"),
      BENCH_AGENT_MODEL_POLICY: "z-ai/glm-5.2",
      BTB_RECOVER_ROOM_CODE: "NR90A2X3NLB",
      BTB_RECOVER_TRACE_PATH: "test-results/.playwright-artifacts-0/traces/recovered.trace",
      BTB_RECOVER_FRESH_ROOM: "1",
    });
  });

  it("filters passing BTB receipts before applying missing-only limit", () => {
    const cwd = process.cwd();
    const projectRoot = tempProject();
    const bundleRoot = makeBtbBundle([
      { id: "a-task", prompt: "Build package A" },
      { id: "b-task", prompt: "Build package B" },
      { id: "c-task", prompt: "Build package C" },
    ]);
    process.chdir(projectRoot);
    try {
      const screenshotPath = join(projectRoot, "proof.png");
      const tracePath = join(projectRoot, "trace.json");
      writeFileSync(screenshotPath, "png");
      writeFileSync(tracePath, "{}");
      const receiptPath = join(projectRoot, "docs", "eval", "fresh-room", "FR-020", "tasks", "a-task", "latest.json");
      mkdirSync(dirname(receiptPath), { recursive: true });
      writeFileSync(receiptPath, JSON.stringify({
        schema: 1,
        caseId: "FR-020",
        benchmark: "bankertoolbench",
        taskId: "a-task",
        generatedAt: "2026-06-24T00:00:00.000Z",
        baseUrl: "http://127.0.0.1:5273",
        command: "npx playwright test",
        model: {
          id: "z-ai/glm-5.2",
          resolved: "z-ai/glm-5.2",
          provider: "openrouter",
          routePolicy: "specific",
          role: "worker",
          runtimeProfile: "benchmark_completion",
          costUsd: 0.026,
          tokensIn: 1200,
          tokensOut: 300,
        },
        memoryMode: false,
        freshness: {
          roomCreatedAfterRunStart: true,
          forbiddenPreloadedArtifactsAbsent: true,
          artifactsCreatedFresh: ["package.xlsx"],
        },
        ui: {
          focusModeEnabled: true,
          attentionOverlayVisible: true,
          streamingVisible: true,
          screenshotPaths: [screenshotPath],
          tracePath,
        },
        artifacts: {},
        scorer: {
          name: "BankerToolBench proof verifier",
          verdict: "pass",
          details: {
            taskCoverage: {
              ok: true,
              requiredTickers: [],
              missingTickers: [],
              detail: "no multi-entity ticker coverage gate required",
            },
          },
        },
        gatesProven: [
          "fresh_room_join",
          "public_nodeagent_invocation",
          "visible_streaming_progress",
          "trace_video_artifacts",
          "no_memory_mode_shortcut",
          "focus_mode_enabled",
          "focus_box_or_attention_overlay",
          "artifact_placeholder_scan",
          "agent_terminal_quality_gate",
        ],
        passed: true,
      }, null, 2));

      const plan = buildBtbFreshRoomMatrixPlan({ bundleRoot, missingOnly: true, limit: 1 });

      expect(plan.selectedTaskCount).toBe(1);
      expect(plan.tasks[0]?.taskId).toBe("b-task");
    } finally {
      process.chdir(cwd);
    }
  });

  it("does not skip old BTB receipts that predate task coverage proof", () => {
    const cwd = process.cwd();
    const projectRoot = tempProject();
    const bundleRoot = makeBtbBundle([
      { id: "a-task", prompt: "Build package A" },
      { id: "b-task", prompt: "Build package B" },
    ]);
    process.chdir(projectRoot);
    try {
      const screenshotPath = join(projectRoot, "proof.png");
      const tracePath = join(projectRoot, "trace.json");
      writeFileSync(screenshotPath, "png");
      writeFileSync(tracePath, "{}");
      const receiptPath = join(projectRoot, "docs", "eval", "fresh-room", "FR-020", "tasks", "a-task", "latest.json");
      mkdirSync(dirname(receiptPath), { recursive: true });
      writeFileSync(receiptPath, JSON.stringify({
        schema: 1,
        caseId: "FR-020",
        benchmark: "bankertoolbench",
        taskId: "a-task",
        generatedAt: "2026-06-24T00:00:00.000Z",
        baseUrl: "http://127.0.0.1:5273",
        command: "npx playwright test",
        model: {
          id: "z-ai/glm-5.2",
          resolved: "z-ai/glm-5.2",
          provider: "openrouter",
          routePolicy: "specific",
          role: "worker",
          runtimeProfile: "benchmark_completion",
          costUsd: 0.026,
          tokensIn: 1200,
          tokensOut: 300,
        },
        memoryMode: false,
        freshness: {
          roomCreatedAfterRunStart: true,
          forbiddenPreloadedArtifactsAbsent: true,
          artifactsCreatedFresh: ["package.xlsx"],
        },
        ui: {
          focusModeEnabled: true,
          attentionOverlayVisible: true,
          streamingVisible: true,
          screenshotPaths: [screenshotPath],
          tracePath,
        },
        artifacts: {},
        gatesProven: [
          "fresh_room_join",
          "public_nodeagent_invocation",
          "visible_streaming_progress",
          "trace_video_artifacts",
          "no_memory_mode_shortcut",
          "focus_mode_enabled",
          "focus_box_or_attention_overlay",
          "artifact_placeholder_scan",
          "agent_terminal_quality_gate",
        ],
        passed: true,
      }, null, 2));

      const plan = buildBtbFreshRoomMatrixPlan({ bundleRoot, missingOnly: true, limit: 1 });

      expect(plan.selectedTaskCount).toBe(1);
      expect(plan.tasks[0]?.taskId).toBe("a-task");
    } finally {
      process.chdir(cwd);
    }
  });
});

function makeBtbBundle(tasks: Array<{ id: string; prompt: string }>): string {
  const root = tempProject();
  mkdirSync(join(root, "task-data"), { recursive: true });
  mkdirSync(join(root, "golden-outputs"), { recursive: true });
  const rows = tasks.map((task) => JSON.stringify({
    task_id: task.id,
    final_prompt: task.prompt,
    product: "excel",
    workflow_cat: "finance",
    workflow_subcat: "modeling",
    aggregated_rubric_json: JSON.stringify([{ criterion: "complete package", weight: 1 }]),
  }));
  writeFileSync(join(root, "tasks.jsonl"), `${rows.join("\n")}\n`);
  for (const task of tasks) {
    const inputDir = join(root, "task-data", task.id, "input");
    const goldenDir = join(root, "golden-outputs", task.id);
    mkdirSync(inputDir, { recursive: true });
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(join(inputDir, "source.txt"), `input for ${task.id}`);
    writeFileSync(join(goldenDir, "answer.txt"), `gold for ${task.id}`);
  }
  return root;
}
