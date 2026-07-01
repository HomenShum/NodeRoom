import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { writeProofLoopArtifacts, type ProofLoopArtifactRun } from "./proofloopArtifacts";

export type ProofloopMetaForLoop = {
  runId: string;
  suite: string;
  cmd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  passed: boolean;
  score?: number;
  minScore?: number;
  failedGates?: string[];
  receiptPaths: string[];
};

export type LoopArtifactPaths = {
  runResultPath: string;
  liveUserContractPath: string;
  nodeTracePath: string;
  nodeEvalPath: string;
  repairPromptPath: string;
  storybookPath: string;
  storyboardJsonPath: string;
  storyboardMdPath: string;
  laggingJsonPath: string;
  laggingMdPath: string;
  routerSuggestionPath: string;
  memoryPath?: string;
};

type NodeEvalShape = {
  reward?: {
    taskCompletion?: number;
    uiStateCorrectness?: number;
    visualQuality?: number;
    evidenceGrounding?: number;
    costEfficiency?: number;
    latencySmoothness?: number;
    safety?: number;
    total?: number;
    failureCategories?: string[];
  };
  verifier?: {
    hardPass?: boolean;
    score?: number;
    minScore?: number;
    failReasons?: string[];
  };
};

const LIVE_USER_GATES = [
  "live_or_staging_prod_url",
  "fresh_browser_context",
  "no_seeded_replay_room",
  "no_memory_mode_shortcut",
  "no_preloaded_final_artifacts",
  "no_direct_db_artifact_injection",
  "no_backend_only_execution",
  "no_api_only_task_execution",
  "user_lands_on_public_ui",
  "user_creates_or_joins_fresh_workspace",
  "benchmark_inputs_uploaded_through_ui",
  "agent_invoked_through_user_visible_ui",
  "streaming_or_progress_visible",
  "trace_or_worklog_visible",
  "artifacts_generated_by_agent",
  "artifacts_exported_or_reopened",
  "verifier_or_judge_runs",
  "official_scorer_receipt_written",
  "visual_browser_proof_captured",
  "cost_latency_recorded",
  "node_trace_v2_exported",
  "proof_receipt_written",
  "no_unexpected_console_or_page_errors",
] as const;

const LAGGING_LAYER_BY_FAILURE: Record<string, string> = {
  latency_timeout: "latency",
  ui_state_failure: "ui_affordance",
  evidence_grounding_failure: "context_pack",
  cost_budget_failure: "cost_budget",
  task_completion_failure: "model_reasoning",
  score_below_threshold: "verifier_feedback",
};

const PRODUCT_IDENTITY = {
  name: "Proof Loop",
  statement: "Proof Loop proves real agent work on real app UI, stores the proof in memory, and uses it to improve the next run.",
  category: "production proof memory system",
};

const SCORE_CAVEAT = "Product-path completion is not an official semantic score unless an official scorer receipt is attached.";

export function writeLoopArtifactsForMeta(args: {
  meta: ProofloopMetaForLoop;
  runDir: string;
  memoryPath?: string;
  baseUrl?: string;
  strictLiveUser?: boolean;
}): LoopArtifactPaths {
  const { meta, runDir, memoryPath, baseUrl, strictLiveUser = false } = args;
  mkdirSync(runDir, { recursive: true });

  const run = ensureRunResult(meta, runDir);
  const artifactPaths = writeProofLoopArtifacts(run, runDir, { baseUrl });
  const liveUserContractPath = writeLiveUserContract({ meta, runDir, baseUrl, strictLiveUser });
  const memoryPathWritten = memoryPath ? writeMemoryEntry({ meta, runDir, memoryPath }) : undefined;
  const { storyboardJsonPath, storyboardMdPath } = writeStoryboardArtifacts({ meta, runDir });
  const { laggingJsonPath, laggingMdPath } = writeLaggingLayerArtifacts({ meta, runDir });
  const routerSuggestionPath = writeRouterSuggestion({ meta, runDir });
  writeSocialArtifacts({ meta, runDir });

  return {
    runResultPath: join(runDir, "run-result.json"),
    liveUserContractPath,
    nodeTracePath: artifactPaths.nodeTracePath,
    nodeEvalPath: artifactPaths.nodeEvalPath,
    repairPromptPath: artifactPaths.repairPromptPath,
    storybookPath: artifactPaths.storybookPath,
    storyboardJsonPath,
    storyboardMdPath,
    laggingJsonPath,
    laggingMdPath,
    routerSuggestionPath,
    memoryPath: memoryPathWritten,
  };
}

export function ensureRunResult(meta: ProofloopMetaForLoop, runDir: string): ProofLoopArtifactRun {
  const runResultPath = join(runDir, "run-result.json");
  if (existsSync(runResultPath)) {
    return JSON.parse(readFileSync(runResultPath, "utf-8")) as ProofLoopArtifactRun;
  }
  const score = meta.score ?? (meta.passed ? 100 : 0);
  const run: ProofLoopArtifactRun = {
    schema: 1,
    suite: meta.suite,
    runId: meta.runId,
    generatedAt: meta.finishedAt,
    configPath: ".proofloop/config.json",
    minScore: meta.minScore ?? 100,
    outputDir: runDir,
    passed: meta.passed,
    score,
    failReasons: meta.passed ? [] : (meta.failedGates?.length ? meta.failedGates.map((gate) => `Failed gate: ${gate}`) : [`Command exited ${meta.exitCode}`]),
    steps: [
      {
        name: "proofloop-run",
        status: meta.passed ? "pass" : "fail",
        durationMs: meta.durationMs,
        stdout: `Receipts: ${meta.receiptPaths.join(", ") || "none"}`,
        stderr: meta.passed ? "" : `Exit code: ${meta.exitCode}`,
        exitCode: meta.exitCode,
        required: true,
      },
    ],
  };
  writeJson(runResultPath, run);
  return run;
}

export function writeLiveUserContract(args: {
  meta: ProofloopMetaForLoop;
  runDir: string;
  baseUrl?: string;
  strictLiveUser?: boolean;
}): string {
  const { meta, runDir, baseUrl = "", strictLiveUser = false } = args;
  const browserLike = /browser|btb|banker|live|playwright|headed|ui/i.test(`${meta.suite} ${meta.cmd}`);
  const prodLike = /^https?:\/\//.test(baseUrl) || /--prod|live/i.test(meta.cmd);
  const shortcutText = `${meta.suite} ${meta.cmd} ${meta.failedGates?.join(" ") ?? ""}`.toLowerCase();
  const visualProofPaths = visualProofs(runDir);
  const hasCockpitEvents = fileHasBytes(join(runDir, "cockpit-events.jsonl")) || fileHasBytes(join(runDir, "events.jsonl"));
  const hasCockpitSnapshot = cockpitSnapshotHasEvents(runDir);
  const hasReopenProof = ["exported-files-reopen-proof.json", "artifact-reopen-proof.json", "package-manifest.json"].some((name) =>
    existsSync(join(runDir, name)),
  );
  const hasVerifierReceipt = meta.receiptPaths.length > 0 || existsSync(join(runDir, "verifier-receipt.json"));
  const hasTrace = hasVerifierReceipt || hasCockpitEvents;
  const hasArtifacts = hasAgentArtifactProof(runDir);
  const hasVerifier = hasVerifierReceipt || existsSync(join(runDir, "visual-review.json"));
  const hasOfficialScorerReceipt = existsSync(join(runDir, "official-scorer-receipt.json"));
  const hasCost = existsSync(join(runDir, "cost-ledger.json"));
  const hasConsoleErrors = readConsoleErrors(runDir).length > 0;
  const backendShortcut = !browserLike || /backend-only|api-only|direct db|direct-db|db injection|db-injection/.test(shortcutText);
  const apiShortcut = /api-only|backend-only|direct api|fixture api/.test(shortcutText);
  const gateResults = LIVE_USER_GATES.map((gate) => {
    let passed: boolean;
    if (gate === "live_or_staging_prod_url") passed = prodLike && /^https?:\/\//.test(baseUrl);
    else if (gate === "fresh_browser_context") passed = strictLiveUser && (hasCockpitEvents || hasCockpitSnapshot);
    else if (gate === "no_seeded_replay_room") passed = !/seeded replay|seeded final|replay room|fixture room|golden room/.test(shortcutText);
    else if (gate === "no_memory_mode_shortcut") passed = !/mode=memory|memory-mode|memory shortcut|cached final/.test(shortcutText);
    else if (gate === "no_preloaded_final_artifacts") passed = !/preloaded final|preload final|golden answer|golden artifact|fixture output/.test(shortcutText);
    else if (gate === "no_direct_db_artifact_injection") passed = !/direct db|direct-db|db injection|db-injection|artifact injection/.test(shortcutText);
    else if (gate === "no_backend_only_execution") passed = !backendShortcut;
    else if (gate === "no_api_only_task_execution") passed = !apiShortcut;
    else if (gate === "user_lands_on_public_ui") passed = browserLike && /^https?:\/\//.test(baseUrl) && (visualProofPaths.length > 0 || hasCockpitEvents || hasCockpitSnapshot);
    else if (gate === "user_creates_or_joins_fresh_workspace") passed = browserLike && (hasCockpitEvents || meta.receiptPaths.some((path) => /room|workspace|fresh/i.test(path)));
    else if (gate === "benchmark_inputs_uploaded_through_ui") passed = browserLike && !backendShortcut && hasVerifierReceipt;
    else if (gate === "agent_invoked_through_user_visible_ui") passed = browserLike && !backendShortcut && hasVerifierReceipt;
    else if (gate === "streaming_or_progress_visible") passed = hasCockpitEvents || hasCockpitSnapshot;
    else if (gate === "trace_or_worklog_visible") passed = hasTrace;
    else if (gate === "artifacts_generated_by_agent") passed = hasArtifacts;
    else if (gate === "artifacts_exported_or_reopened") passed = hasReopenProof;
    else if (gate === "verifier_or_judge_runs") passed = hasVerifier;
    else if (gate === "official_scorer_receipt_written") passed = hasOfficialScorerReceipt;
    else if (gate === "visual_browser_proof_captured") passed = visualProofPaths.length > 0;
    else if (gate === "cost_latency_recorded") passed = hasCost;
    else if (gate === "node_trace_v2_exported") passed = existsSync(join(runDir, "node-trace-v2.json"));
    else if (gate === "proof_receipt_written") passed = hasVerifierReceipt;
    else if (gate === "no_unexpected_console_or_page_errors") passed = !hasConsoleErrors;
    else passed = false;
    return {
      gate,
      passed: strictLiveUser ? passed : (passed || !prodLike),
      evidence: evidenceForGate(gate, meta, runDir, baseUrl),
    };
  });
  const contract = {
    schema: 1,
    productIdentity: PRODUCT_IDENTITY,
    benchmark: meta.suite,
    app: "noderoom",
    baseUrl,
    userEmulation: strictLiveUser ? "strict" : "advisory",
    freshBrowserContext: gateResults.find((g) => g.gate === "fresh_browser_context")?.passed ?? false,
    freshWorkspace: gateResults.find((g) => g.gate === "user_creates_or_joins_fresh_workspace")?.passed ?? false,
    inputMode: browserLike ? "browser_upload" : "unknown_or_cli",
    agentInvocation: browserLike ? "public_ui" : "unknown_or_cli",
    memoryShortcutUsed: /mode=memory|memory-mode/i.test(meta.cmd),
    backendShortcutUsed: backendShortcut,
    apiShortcutUsed: apiShortcut,
    visibleStreaming: gateResults.find((g) => g.gate === "streaming_or_progress_visible")?.passed ?? false,
    visualProofCaptured: gateResults.find((g) => g.gate === "visual_browser_proof_captured")?.passed ?? false,
    artifactsReopened: gateResults.find((g) => g.gate === "artifacts_exported_or_reopened")?.passed ?? false,
    verifierReceiptWritten: gateResults.find((g) => g.gate === "proof_receipt_written")?.passed ?? false,
    officialScorerReceiptWritten: gateResults.find((g) => g.gate === "official_scorer_receipt_written")?.passed ?? false,
    scoringMode: scoringModeForSuite(meta.suite),
    productPathCompletion: meta.passed,
    officialSemanticScore: null,
    scoreType: "completion_not_official_semantic",
    caveat: SCORE_CAVEAT,
    invalidIf: [
      "seeded final evidence room",
      "direct DB artifact injection as final proof",
      "preloaded final artifacts",
      "golden answer copy",
      "backend-only execution",
      "API-only task execution",
      "missing screenshot/video",
      "missing verifier receipt",
      "missing official scorer receipt",
    ],
    gates: gateResults,
    valid: meta.passed && gateResults.every((gate) => gate.passed),
  };
  const path = join(runDir, "live-user-contract.json");
  writeJson(path, contract);
  return path;
}

export function writeMemoryEntry(args: { meta: ProofloopMetaForLoop; runDir: string; memoryPath: string }): string {
  const { meta, runDir, memoryPath } = args;
  const nodeEval = readJson<NodeEvalShape>(join(runDir, "node-eval.json"));
  const entry = {
    schema: 1,
    kind: meta.passed ? "success_pattern" : "failure_pattern",
    runId: meta.runId,
    traceId: `traj-${meta.runId}`,
    sourceTracePath: rel(dirname(memoryPath), join(runDir, "node-trace-v2.json")),
    suite: meta.suite,
    taskKind: taskKindForSuite(meta.suite),
    modelPolicy: "proofloop-recorded",
    harnessVersion: "proofloop-loop-engineering-v1",
    costUsd: readJson<{ costUsd?: string }>(join(runDir, "cost-ledger.json"))?.costUsd ?? "unknown",
    reward: nodeEval?.reward ?? null,
    repairAction: meta.passed ? "promote_as_regression_proof" : "inspect_repair_prompt_and_add_regression",
    receiptRefs: meta.receiptPaths,
    retention: {
      rawTraceRetentionDays: 30,
      rawVideoRetentionDays: 7,
      storeRawTranscripts: false,
      screenshotsPathOnly: true,
      videosPathOnly: true,
      scrubSecrets: true,
      scrubPII: true,
      cloudSync: false,
    },
    writtenAt: new Date().toISOString(),
  };
  mkdirSync(dirname(memoryPath), { recursive: true });
  appendFileSync(memoryPath, `${JSON.stringify(entry)}\n`, "utf-8");
  return memoryPath;
}

export function writeStoryboardArtifacts(args: { meta: ProofloopMetaForLoop; runDir: string }): { storyboardJsonPath: string; storyboardMdPath: string } {
  const { meta, runDir } = args;
  const evalResult = readJson<NodeEvalShape>(join(runDir, "node-eval.json"));
  const claim = "We are comparing model behavior inside a real agent harness, not raw content generation.";
  const scenes = [
    {
      id: "setup",
      caption: "Same app. Same task. Same verifier.",
      evidence: ["node-trace-v2.json", "scorecard.md"].filter((name) => existsSync(join(runDir, name))),
    },
    {
      id: "run",
      caption: meta.passed ? "The run completed the product path." : "The run exposed a failing layer.",
      evidence: meta.receiptPaths,
    },
    {
      id: "delta",
      caption: `Reward total: ${evalResult?.reward?.total ?? "unknown"}.`,
      evidence: ["node-eval.json"],
    },
    {
      id: "lagging",
      caption: "Lagging layers are classified from verifier and reward failures.",
      evidence: ["lagging-layers.json"],
    },
  ];
  const storyboard = {
    schema: 1,
    title: `${meta.suite} proof story`,
    claim,
    runId: meta.runId,
    scenes,
  };
  const jsonPath = join(runDir, "storyboard.json");
  const mdPath = join(runDir, "storyboard.md");
  writeJson(jsonPath, storyboard);
  writeFileSync(mdPath, renderStoryboardMarkdown(storyboard), "utf-8");
  return { storyboardJsonPath: jsonPath, storyboardMdPath: mdPath };
}

export function writeLaggingLayerArtifacts(args: { meta: ProofloopMetaForLoop; runDir: string }): { laggingJsonPath: string; laggingMdPath: string } {
  const { meta, runDir } = args;
  const evalResult = readJson<NodeEvalShape>(join(runDir, "node-eval.json"));
  const failures = evalResult?.reward?.failureCategories ?? (meta.failedGates ?? []);
  const lagging = failures.length
    ? failures.map((failure) => ({
        layer: LAGGING_LAYER_BY_FAILURE[failure] ?? "verifier_feedback",
        symptom: failure,
        evidence: "node-eval.json",
        recommendedFix: recommendedFixForFailure(failure),
      }))
    : [];
  const report = {
    schema: 1,
    runId: meta.runId,
    suite: meta.suite,
    winner: meta.passed ? "current_route" : null,
    lagging,
  };
  const jsonPath = join(runDir, "lagging-layers.json");
  const mdPath = join(runDir, "lagging-layers.md");
  writeJson(jsonPath, report);
  writeFileSync(mdPath, renderLaggingMarkdown(report), "utf-8");
  return { laggingJsonPath: jsonPath, laggingMdPath: mdPath };
}

export function writeRouterSuggestion(args: { meta: ProofloopMetaForLoop; runDir: string }): string {
  const { meta, runDir } = args;
  const lagging = readJson<{ lagging?: Array<{ layer: string }> }>(join(runDir, "lagging-layers.json"))?.lagging ?? [];
  const escalationRules = new Set(["artifact_missing", "verifier_failed_twice", "ambiguous_business_judgment", "cost_overrun"]);
  for (const item of lagging) {
    if (item.layer === "cost_budget") escalationRules.add("cost_overrun");
    if (item.layer === "ui_affordance") escalationRules.add("visual_state_failed");
    if (item.layer === "context_pack") escalationRules.add("evidence_gap");
  }
  const suggestion = {
    schema: 1,
    runId: meta.runId,
    suite: meta.suite,
    routerPolicy: {
      planner: "strong-model",
      mechanicalWorker: "cheap-model",
      visualJudge: "vision-model",
      verifier: "deterministic",
      mode: meta.passed ? "shadow" : "assist",
      escalationRules: [...escalationRules].sort(),
    },
    rationale: meta.passed
      ? "Keep the current route as a successful sample and shadow cheaper alternatives."
      : "Use verifier failure evidence to escalate selectively before rerun.",
  };
  const path = join(runDir, "router-suggestion.json");
  writeJson(path, suggestion);
  return path;
}

export function writeSocialArtifacts(args: { meta: ProofloopMetaForLoop; runDir: string }): void {
  const { meta, runDir } = args;
  const socialDir = join(runDir, "social");
  mkdirSync(socialDir, { recursive: true });
  const verdict = meta.passed ? "passed" : "failed";
  writeFileSync(
    join(socialDir, "x-thread.md"),
    [
      `1/ Proof Loop run ${meta.runId} ${verdict} on ${meta.suite}.`,
      "2/ The claim is product-path behavior in a real harness, not raw model vibes.",
      "3/ Evidence: node-trace-v2.json, node-eval.json, live-user-contract.json, and lagging-layers.json.",
      "4/ Next: use router-suggestion.json to decide whether to keep, escalate, or repair.",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(join(socialDir, "reddit-post.md"), `Proof Loop ${verdict}: ${meta.suite}\n\nEvidence is in the generated trace, eval, live-user contract, and lagging-layer report.\n`, "utf-8");
  writeFileSync(join(socialDir, "hackernews-title.txt"), `Show HN: Proof Loop for live-user agent benchmarks (${meta.suite})\n`, "utf-8");
  writeFileSync(join(socialDir, "short-caption.txt"), `Same app. Same task. Same verifier. ${meta.suite} ${verdict} with receipts.\n`, "utf-8");

  const clipsDir = join(runDir, "clips");
  mkdirSync(clipsDir, { recursive: true });
  writeJson(join(clipsDir, "clip-manifest.json"), {
    schema: 1,
    provider: "feature-walkthrough",
    status: "storyboard_ready",
    note: "Render MP4/GIF with the feature-walkthrough adapter when visual captures are available.",
    clips: [
      "01-task-setup.mp4",
      "02-model-a-run.mp4",
      "03-model-b-run.mp4",
      "04-delta.mp4",
      "05-lagging-layer.mp4",
      "final-release-video.mp4",
    ].map((output) => ({ output, ready: false })),
  });
  writeFileSync(join(clipsDir, "README.md"), "Clip storyboard is ready. MP4 rendering requires captured screenshots or video from the live run.\n", "utf-8");
}

function evidenceForGate(gate: string, meta: ProofloopMetaForLoop, runDir: string, baseUrl: string): string {
  if (gate === "live_or_staging_prod_url") return baseUrl || meta.cmd;
  if (gate === "node_trace_v2_exported") return rel(runDir, join(runDir, "node-trace-v2.json"));
  if (gate === "proof_receipt_written") return meta.receiptPaths[0] ?? rel(runDir, join(runDir, "run-result.json"));
  if (gate === "cost_latency_recorded") return rel(runDir, join(runDir, "cost-ledger.json"));
  if (gate === "streaming_or_progress_visible") {
    return rel(runDir, firstExisting(runDir, ["cockpit-events.jsonl", "events.jsonl", "cockpit-snapshot.json"]) ?? join(runDir, "cockpit-events.jsonl"));
  }
  if (gate === "artifacts_exported_or_reopened") {
    return rel(runDir, firstExisting(runDir, ["exported-files-reopen-proof.json", "artifact-reopen-proof.json", "package-manifest.json"]) ?? join(runDir, "exported-files-reopen-proof.json"));
  }
  if (gate === "visual_browser_proof_captured") return visualProofs(runDir)[0] ?? rel(runDir, join(runDir, "screenshots"));
  if (gate === "verifier_or_judge_runs") {
    return rel(runDir, firstExisting(runDir, ["verifier-receipt.json", "node-eval.json", "visual-review.json"]) ?? join(runDir, "verifier-receipt.json"));
  }
  if (gate === "official_scorer_receipt_written") return rel(runDir, join(runDir, "official-scorer-receipt.json"));
  return meta.receiptPaths[0] ?? meta.cmd;
}

function visualProofs(runDir: string): string[] {
  const paths = ["video.webm", "run-video.webm"]
    .map((name) => join(runDir, name))
    .filter((path) => existsSync(path))
    .map((path) => rel(runDir, path));
  const screenshotDir = join(runDir, "screenshots");
  if (existsSync(screenshotDir)) paths.push(rel(runDir, screenshotDir));
  return paths;
}

function fileHasBytes(path: string): boolean {
  try {
    return existsSync(path) && readFileSync(path).byteLength > 0;
  } catch {
    return false;
  }
}

function cockpitSnapshotHasEvents(runDir: string): boolean {
  const snapshot = readJson<{ totalEvents?: number }>(join(runDir, "cockpit-snapshot.json"));
  return (snapshot?.totalEvents ?? 0) > 0;
}

function hasAgentArtifactProof(runDir: string): boolean {
  const receipt = readJson<{
    artifacts?: {
      created?: unknown[];
      exportedFiles?: unknown[];
      reopenedFiles?: unknown[];
    };
  }>(join(runDir, "verifier-receipt.json"));
  if ((receipt?.artifacts?.created?.length ?? 0) > 0) return true;
  if ((receipt?.artifacts?.exportedFiles?.length ?? 0) > 0) return true;
  if ((receipt?.artifacts?.reopenedFiles?.length ?? 0) > 0) return true;
  return ["accounting-results.json", "exported-files-reopen-proof.json", "artifact-reopen-proof.json", "package-manifest.json"].some((name) =>
    existsSync(join(runDir, name)),
  );
}

function firstExisting(runDir: string, names: string[]): string | undefined {
  return names.map((name) => join(runDir, name)).find((path) => existsSync(path));
}

function readConsoleErrors(runDir: string): string[] {
  const visualReview = readJson<{ checks?: Array<{ name?: string; status?: string; detail?: string }> }>(join(runDir, "visual-review.json"));
  const visualErrors = visualReview?.checks
    ?.filter((check) => check.status === "fail" && /console|page error|network/i.test(`${check.name ?? ""} ${check.detail ?? ""}`))
    .map((check) => check.detail ?? check.name ?? "visual error") ?? [];
  const nodeTrace = readJson<{ outerTrace?: { consoleErrors?: string[]; networkErrors?: string[] } }>(join(runDir, "node-trace-v2.json"));
  return [
    ...visualErrors,
    ...(nodeTrace?.outerTrace?.consoleErrors ?? []),
    ...(nodeTrace?.outerTrace?.networkErrors ?? []),
  ];
}

function scoringModeForSuite(suite: string): "completion" | "semantic" | "hybrid" {
  if (/finch|finauditing|workstream/i.test(suite)) return "hybrid";
  if (/spreadsheet|accounting|banker/i.test(suite)) return "hybrid";
  return "completion";
}

function taskKindForSuite(suite: string): string {
  if (/account|bank|finch|finauditing|workstream/i.test(suite)) return "finance_accounting";
  if (/notion|profile|research/i.test(suite)) return "profile_research_packet";
  return "proofloop_suite";
}

function recommendedFixForFailure(failure: string): string {
  if (/latency|timeout/.test(failure)) return "Add progress evaluation, lower retry budget, or split the workflow into smaller stages.";
  if (/ui|browser|visual/.test(failure)) return "Add browser-visible assertion or screenshot proof before finalizing.";
  if (/evidence|source|citation/.test(failure)) return "Capture source provenance before synthesis and mark unsupported facts needs_review.";
  if (/cost|budget/.test(failure)) return "Route mechanical work to a cheaper worker and escalate only on verifier failure.";
  if (/score|verifier/.test(failure)) return "Keep the verifier fixed and repair the first failing task-specific assertion.";
  return "Inspect repair-prompt.md and add a deterministic regression for the first failing step.";
}

function renderStoryboardMarkdown(storyboard: { title: string; claim: string; scenes: Array<{ id: string; caption: string; evidence: string[] }> }): string {
  const lines = [`# ${storyboard.title}`, "", storyboard.claim, "", "## Scenes", ""];
  for (const scene of storyboard.scenes) {
    lines.push(`### ${scene.id}`);
    lines.push(scene.caption);
    if (scene.evidence.length) {
      lines.push("");
      for (const evidence of scene.evidence) lines.push(`- ${evidence}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderLaggingMarkdown(report: { runId: string; suite: string; lagging: Array<{ layer: string; symptom: string; evidence: string; recommendedFix: string }> }): string {
  const lines = [`# Lagging Layers - ${report.suite}`, "", `Run: ${report.runId}`, ""];
  if (!report.lagging.length) {
    lines.push("No lagging layer above threshold.");
    lines.push("");
    return lines.join("\n");
  }
  for (const item of report.lagging) {
    lines.push(`## ${item.layer}`);
    lines.push(`- Symptom: ${item.symptom}`);
    lines.push(`- Evidence: ${item.evidence}`);
    lines.push(`- Recommended fix: ${item.recommendedFix}`);
    lines.push("");
  }
  return lines.join("\n");
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function rel(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}
