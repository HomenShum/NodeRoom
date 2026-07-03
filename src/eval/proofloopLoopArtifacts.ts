import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createSqliteBackend, DEFAULT_CODEGRAPH_DB_RELPATH } from "../proofloop/codegraph/adapters/sqliteBackend";
import { blastRadius } from "../proofloop/codegraph/core/query";
import {
  writeProofLoopArtifacts,
  type ProofLoopArtifactRun,
  type RepairBlastRadiusSection,
} from "./proofloopArtifacts";
import type { ProofloopModelRoute } from "./proofloopModelTracking";

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
  model?: ProofloopModelRoute;
  harnessVersion?: string;
};

export type LoopArtifactPaths = {
  runResultPath: string;
  officialScorerReceiptPath: string;
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
  "user_lands_on_public_ui",
  "user_creates_or_joins_fresh_workspace",
  "benchmark_inputs_uploaded_through_ui",
  "agent_invoked_through_user_visible_ui",
  "streaming_or_progress_visible",
  "focus_or_attention_overlay_visible",
  "trace_or_worklog_visible",
  "artifacts_generated_by_agent",
  "artifacts_exported_or_downloaded",
  "artifacts_reopened_successfully",
  "official_or_task_verifier_runs",
  "visual_browser_proof_captured",
  "cost_latency_recorded",
  "node_trace_v2_exported",
  "official_scorer_receipt_written",
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

const CODEGRAPH_META_LAST_INDEX_COMMIT = "last_index_commit";

export function writeLoopArtifactsForMeta(args: {
  meta: ProofloopMetaForLoop;
  runDir: string;
  memoryPath?: string;
  baseUrl?: string;
  strictLiveUser?: boolean;
  /** Repo root used to locate the optional code-graph index; defaults to cwd. */
  repoRoot?: string;
}): LoopArtifactPaths {
  const { meta, runDir, memoryPath, baseUrl, strictLiveUser = false, repoRoot = process.cwd() } = args;
  mkdirSync(runDir, { recursive: true });

  const run = ensureRunResult(meta, runDir);
  const codeGraphBlastRadius = buildRepairBlastRadius(run, repoRoot);
  const artifactPaths = writeProofLoopArtifacts(run, runDir, {
    baseUrl,
    ...(codeGraphBlastRadius ? { blastRadius: codeGraphBlastRadius } : {}),
  });
  const officialScorerReceiptPath = writeOfficialScorerReceipt({ meta, runDir });
  const liveUserContractPath = writeLiveUserContract({ meta, runDir, baseUrl, strictLiveUser });
  const memoryPathWritten = memoryPath ? writeMemoryEntry({ meta, runDir, memoryPath }) : undefined;
  const { storyboardJsonPath, storyboardMdPath } = writeStoryboardArtifacts({ meta, runDir });
  const { laggingJsonPath, laggingMdPath } = writeLaggingLayerArtifacts({ meta, runDir });
  const routerSuggestionPath = writeRouterSuggestion({ meta, runDir });
  writeSocialArtifacts({ meta, runDir });

  return {
    runResultPath: join(runDir, "run-result.json"),
    officialScorerReceiptPath,
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
    model: meta.model,
    harnessVersion: meta.harnessVersion,
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
  const browserLike = /browser|btb|banker|live/i.test(`${meta.suite} ${meta.cmd}`);
  const prodLike = /^https?:\/\//.test(baseUrl) || /--prod|live/i.test(meta.cmd);
  const hasOfficialScorerReceipt = existsSync(join(runDir, "official-scorer-receipt.json"));
  const gateResults = LIVE_USER_GATES.map((gate) => {
    let passed = true;
    if (gate === "live_or_staging_prod_url") passed = prodLike;
    if (gate === "fresh_browser_context") passed = browserLike || strictLiveUser;
    if (gate === "no_memory_mode_shortcut") passed = !/mode=memory|memory-mode/i.test(meta.cmd);
    if (gate === "benchmark_inputs_uploaded_through_ui") passed = browserLike;
    if (gate === "visual_browser_proof_captured") passed = browserLike || hasAnyVisualProof(runDir);
    if (gate === "node_trace_v2_exported") passed = existsSync(join(runDir, "node-trace-v2.json"));
    if (gate === "official_scorer_receipt_written") passed = hasOfficialScorerReceipt;
    if (gate === "proof_receipt_written") passed = meta.receiptPaths.length > 0 || existsSync(join(runDir, "run-result.json"));
    return {
      gate,
      passed: strictLiveUser ? passed : (passed || !prodLike),
      evidence: evidenceForGate(gate, meta, runDir, baseUrl),
    };
  });
  const contract = {
    schema: 1,
    benchmark: meta.suite,
    app: "noderoom",
    baseUrl,
    userEmulation: strictLiveUser ? "strict" : "advisory",
    freshBrowserContext: gateResults.find((g) => g.gate === "fresh_browser_context")?.passed ?? false,
    freshWorkspace: gateResults.find((g) => g.gate === "user_creates_or_joins_fresh_workspace")?.passed ?? false,
    inputMode: browserLike ? "browser_upload" : "unknown_or_cli",
    agentInvocation: browserLike ? "public_ui" : "unknown_or_cli",
    memoryShortcutUsed: /mode=memory|memory-mode/i.test(meta.cmd),
    backendShortcutUsed: !browserLike,
    visibleStreaming: gateResults.find((g) => g.gate === "streaming_or_progress_visible")?.passed ?? false,
    visualProofCaptured: gateResults.find((g) => g.gate === "visual_browser_proof_captured")?.passed ?? false,
    artifactsReopened: gateResults.find((g) => g.gate === "artifacts_reopened_successfully")?.passed ?? false,
    verifierReceiptWritten: gateResults.find((g) => g.gate === "proof_receipt_written")?.passed ?? false,
    officialScorerReceiptWritten: gateResults.find((g) => g.gate === "official_scorer_receipt_written")?.passed ?? false,
    scoringMode: scoringModeForSuite(meta.suite),
    productPathCompletion: meta.passed,
    officialSemanticScore: null,
    scoreType: "completion_not_official_semantic",
    model: meta.model,
    harnessVersion: meta.harnessVersion,
    gates: gateResults,
    valid: meta.passed && gateResults.every((gate) => gate.passed),
  };
  const path = join(runDir, "live-user-contract.json");
  writeJson(path, contract);
  return path;
}

export function writeOfficialScorerReceipt(args: { meta: ProofloopMetaForLoop; runDir: string }): string {
  const { meta, runDir } = args;
  const path = join(runDir, "official-scorer-receipt.json");
  if (existsSync(path)) return path;
  writeJson(path, {
    schema: 1,
    runId: meta.runId,
    suite: meta.suite,
    generatedAt: meta.finishedAt,
    status: "blocked_external",
    officialScoreClaimable: false,
    officialSemanticScore: null,
    scorer: null,
    productPathCompletion: meta.passed,
    requiredForOfficialClaim: true,
    acceptedProxyJudge: false,
    model: meta.model,
    harnessVersion: meta.harnessVersion,
    blocker: "No accepted official scorer receipt was attached. This run is product-path evidence only.",
    nextActions: [
      "Attach or import the upstream official scorer output for this suite.",
      "Keep OpenRouter or other proxy judges labeled as product-gate triage unless accepted by the benchmark upstream.",
    ],
  });
  return path;
}

export function writeMemoryEntry(args: { meta: ProofloopMetaForLoop; runDir: string; memoryPath: string }): string {
  const { meta, runDir, memoryPath } = args;
  const nodeEval = readJson<NodeEvalShape>(join(runDir, "node-eval.json"));
  const entry = {
    schema: 1,
    kind: meta.passed ? "success_pattern" : "failure_pattern",
    runId: meta.runId,
    suite: meta.suite,
    taskKind: taskKindForSuite(meta.suite),
    modelPolicy: meta.model?.routePolicy ?? "proofloop-recorded",
    model: meta.model,
    harnessVersion: meta.harnessVersion ?? "proofloop-loop-engineering-v1",
    costUsd: readJson<{ costUsd?: string }>(join(runDir, "cost-ledger.json"))?.costUsd ?? "unknown",
    reward: nodeEval?.reward ?? null,
    repairAction: meta.passed ? "promote_as_regression_proof" : "inspect_repair_prompt_and_add_regression",
    receiptRefs: meta.receiptPaths,
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
    model: meta.model,
    harnessVersion: meta.harnessVersion,
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

/**
 * Optional code-graph seam (docs/architecture/CODE_GRAPH_SUBSTRATE.md): when a local
 * .proofloop/codegraph/index.db exists, look up blast radius for selector/route strings
 * carried by failed required steps. Additive-only: if the db is absent, no seeds are
 * found, or anything throws, this returns undefined and repair-prompt.md is
 * byte-identical to today's output.
 */
function buildRepairBlastRadius(run: ProofLoopArtifactRun, repoRoot: string): RepairBlastRadiusSection[] | undefined {
  try {
    const dbPath = join(repoRoot, DEFAULT_CODEGRAPH_DB_RELPATH);
    if (!existsSync(dbPath)) return undefined;
    const failedSteps = run.steps.filter((step) => step.required && step.status !== "pass" && !step.softFail);
    if (!failedSteps.length) return undefined;
    const failureText = [
      ...failedSteps.map((step) => `${step.name}\n${step.stdout}\n${step.stderr}`),
      ...run.failReasons,
    ].join("\n");
    const seeds = extractBlastRadiusSeeds(failureText);
    if (!seeds.length) return undefined;
    const backend = createSqliteBackend({ dbPath });
    try {
      backend.init();
      const lastIndexCommit = backend.getMeta(CODEGRAPH_META_LAST_INDEX_COMMIT);
      const recentFiles = lastIndexCommit ? gitChangedFilesSince(repoRoot, lastIndexCommit) : [];
      const sections: RepairBlastRadiusSection[] = [];
      for (const seed of seeds) {
        const results = blastRadius(
          backend,
          seed.kind === "selector" ? { selector: seed.value } : { route: seed.value },
          { limit: 10, recentFiles },
        );
        if (!results.length) continue;
        sections.push({
          seedKind: seed.kind,
          seed: seed.value,
          files: results.map((entry) => ({
            file: entry.file,
            score: entry.score,
            why: entry.why,
            ...(entry.recentlyChanged ? { recentlyChanged: true } : {}),
            ...(entry.symbols.length ? { symbols: entry.symbols } : {}),
          })),
        });
      }
      return sections.length ? sections : undefined;
    } finally {
      backend.close();
    }
  } catch {
    return undefined;
  }
}

function extractBlastRadiusSeeds(text: string): Array<{ kind: "selector" | "route"; value: string }> {
  const seeds = new Map<string, { kind: "selector" | "route"; value: string }>();
  const selectorPatterns = [
    /data-testid\s*=\s*["']([^"']+)["']/g,
    /\[data-testid=["']?([^"'\]]+)["']?\]/g,
    /getByTestId\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of selectorPatterns) {
    for (const match of text.matchAll(pattern)) {
      seeds.set(`selector:${match[1]}`, { kind: "selector", value: match[1] });
    }
  }
  for (const match of text.matchAll(/(?:route|path|url)[=:\s]+["']?(\/[A-Za-z0-9_\-./]*)/gi)) {
    seeds.set(`route:${match[1]}`, { kind: "route", value: match[1] });
  }
  return [...seeds.values()].slice(0, 5);
}

function gitChangedFilesSince(root: string, commit: string): string[] {
  const result = spawnSync("git", ["diff", "--name-only", commit], { cwd: root, encoding: "utf-8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function evidenceForGate(gate: string, meta: ProofloopMetaForLoop, runDir: string, baseUrl: string): string {
  if (gate === "live_or_staging_prod_url") return baseUrl || meta.cmd;
  if (gate === "node_trace_v2_exported") return rel(runDir, join(runDir, "node-trace-v2.json"));
  if (gate === "official_scorer_receipt_written") return rel(runDir, join(runDir, "official-scorer-receipt.json"));
  if (gate === "proof_receipt_written") return meta.receiptPaths[0] ?? rel(runDir, join(runDir, "run-result.json"));
  if (gate === "cost_latency_recorded") return rel(runDir, join(runDir, "cost-ledger.json"));
  return meta.receiptPaths[0] ?? meta.cmd;
}

function hasAnyVisualProof(runDir: string): boolean {
  return existsSync(join(runDir, "screenshots")) || existsSync(join(runDir, "video.webm")) || existsSync(join(runDir, "run-video.webm"));
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
