import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

export interface ProofLoopArtifactStep {
  name: string;
  status: "pass" | "fail" | "skip" | "timeout";
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  required: boolean;
  softFail?: boolean;
}

export interface ProofLoopArtifactRun {
  schema: number;
  suite: string;
  runId: string;
  generatedAt: string;
  configPath: string;
  minScore: number;
  steps: ProofLoopArtifactStep[];
  passed: boolean;
  score: number;
  failReasons: string[];
  outputDir: string;
  model?: unknown;
  harnessVersion?: string;
}

export interface ProofLoopArtifactOptions {
  baseUrl?: string;
  /**
   * Optional code-graph blast-radius sections for repair-prompt.md (populated by
   * writeLoopArtifactsForMeta when .proofloop/codegraph/index.db exists). Absent →
   * output is byte-identical to a run without the code graph.
   */
  blastRadius?: RepairBlastRadiusSection[];
}

export interface RepairBlastRadiusFile {
  file: string;
  score: number;
  why: string[];
  recentlyChanged?: boolean;
  symbols?: string[];
}

export interface RepairBlastRadiusSection {
  seedKind: "selector" | "route";
  seed: string;
  files: RepairBlastRadiusFile[];
}

export interface ProofLoopArtifactPaths {
  nodeTracePath: string;
  nodeEvalPath: string;
  repairPromptPath: string;
  storybookPath: string;
}

type Reward = {
  taskCompletion: number;
  uiStateCorrectness: number;
  visualQuality: number;
  evidenceGrounding: number;
  costEfficiency: number;
  latencySmoothness: number;
  safety: number;
  total: number;
  failureCategories: string[];
};

const CANONICAL_OUTPUT_FILES = [
  "run-result.json",
  "trace.jsonl",
  "rl-trace.json",
  "scorecard.md",
  "visual-review.json",
  "visual-review.md",
  "accounting-results.json",
  "official-scorer-receipt.json",
];

export function writeProofLoopArtifacts(
  run: ProofLoopArtifactRun,
  outputDir: string,
  options: ProofLoopArtifactOptions = {},
): ProofLoopArtifactPaths {
  mkdirSync(outputDir, { recursive: true });

  const reward = buildReward(run, outputDir);
  const nodeTrace = buildNodeMergedTrajectory(run, outputDir, reward, options);
  const nodeEval = buildNodeEval(run, outputDir, reward);
  const repairPrompt = renderRepairPrompt(run, outputDir, nodeTrace.trajectoryId, reward, options.blastRadius);
  const storybook = renderTraceStorybook(nodeTrace, nodeEval);

  const nodeTracePath = join(outputDir, "node-trace-v2.json");
  const nodeEvalPath = join(outputDir, "node-eval.json");
  const repairPromptPath = join(outputDir, "repair-prompt.md");
  const storybookPath = join(outputDir, "trace-storybook.html");

  writeFileSync(nodeTracePath, JSON.stringify(nodeTrace, null, 2), "utf-8");
  writeFileSync(nodeEvalPath, JSON.stringify(nodeEval, null, 2), "utf-8");
  writeFileSync(repairPromptPath, repairPrompt, "utf-8");
  writeFileSync(storybookPath, storybook, "utf-8");

  return { nodeTracePath, nodeEvalPath, repairPromptPath, storybookPath };
}

function buildNodeMergedTrajectory(
  run: ProofLoopArtifactRun,
  outputDir: string,
  reward: Reward,
  options: ProofLoopArtifactOptions,
) {
  const screenshots = listScreenshotFiles(outputDir).map((path, index, all) => ({
    label: screenshotLabel(run, index, all.length),
    path: relativeOutputPath(outputDir, path),
    domSnapshotHash: undefined,
    visibleComponentIds: [] as string[],
  }));
  const artifactFiles = CANONICAL_OUTPUT_FILES
    .map((name) => join(outputDir, name))
    .filter((path) => existsSync(path));

  return {
    schema: 2,
    trajectoryId: `traj-${run.runId}`,
    runId: run.runId,
    userGoal: `Run proof-loop suite ${run.suite}`,
    outerTrace: {
      url: options.baseUrl ?? "",
      screenshots,
      videoPath: firstExistingPath(outputDir, ["video.webm", "run-video.webm"]),
      consoleErrors: extractVisualConsoleErrors(outputDir),
      networkErrors: [] as string[],
      uiAssertions: run.steps.map((step) => ({
        id: slug(step.name),
        expected: `Step ${step.name} passes`,
        observed: step.status,
        passed: step.status === "pass" || !!step.softFail,
      })),
    },
    innerTrace: {
      agentJobId: undefined,
      model: run.model,
      runtimeProfile: "proofloop-runner",
      harnessVersion: run.harnessVersion,
      contextPackHash: undefined,
      steps: run.steps.map((step, index) => ({
        stepIndex: index,
        phase: step.status === "pass" ? "verify" : "repair",
        action: step.name,
        observation: summarizeStep(step),
        toolName: commandToolName(step.name),
        artifactRefs: artifactFiles.map((path) => relativeOutputPath(outputDir, path)),
        evidenceRefs: screenshots.map((shot) => shot.path),
        costUsd: 0,
        latencyMs: step.durationMs,
        error: step.status === "pass" ? undefined : step.stderr || step.stdout || `Step ${step.status}`,
      })),
    },
    artifacts: artifactFiles.map((path) => ({
      artifactId: slug(basename(path)),
      kind: "trace",
      beforeHash: undefined,
      afterHash: hashFile(path),
      exportPath: relativeOutputPath(outputDir, path),
      reopenPassed: true,
    })),
    reward,
  };
}

function buildNodeEval(run: ProofLoopArtifactRun, outputDir: string, reward: Reward) {
  const failedSteps = run.steps.filter((step) => step.required && step.status !== "pass" && !step.softFail);
  return {
    schema: 1,
    runId: run.runId,
    suite: run.suite,
    generatedAt: new Date().toISOString(),
    model: run.model,
    harnessVersion: run.harnessVersion,
    verifier: {
      hardPass: run.passed,
      minScore: run.minScore,
      score: run.score,
      requiredSteps: run.steps.filter((step) => step.required).length,
      requiredPassed: run.steps.filter((step) => step.required && step.status === "pass").length,
      failReasons: run.failReasons,
    },
    judge: {
      diagnosticSummary: run.passed
        ? "All required proof-loop steps passed."
        : `Failed required steps: ${failedSteps.map((step) => step.name).join(", ") || "none recorded"}.`,
      failureCategories: reward.failureCategories,
      evidencePaths: [
        "node-trace-v2.json",
        "trace.jsonl",
        "scorecard.md",
        ...listScreenshotFiles(outputDir).map((path) => relativeOutputPath(outputDir, path)),
      ].filter((path) => existsSync(join(outputDir, path)) || path.includes("/")),
    },
    reward,
  };
}

function buildReward(run: ProofLoopArtifactRun, outputDir: string): Reward {
  const required = run.steps.filter((step) => step.required);
  const requiredPassed = required.filter((step) => step.status === "pass");
  const uiSteps = run.steps.filter((step) => /ui|browser|visual|playwright|scenario/i.test(step.name));
  const uiPassed = uiSteps.filter((step) => step.status === "pass");
  const screenshotCount = listScreenshotFiles(outputDir).length;
  const visualReview = readJsonIfExists(join(outputDir, "visual-review.json")) as { overall?: string } | null;
  const totalDuration = run.steps.reduce((sum, step) => sum + step.durationMs, 0);
  const latencyBudgetMs = Math.max(run.steps.length, 1) * 120_000;

  const taskCompletion = ratio(requiredPassed.length, required.length);
  const uiStateCorrectness = uiSteps.length ? ratio(uiPassed.length, uiSteps.length) : taskCompletion;
  const visualQuality = visualReview ? (visualReview.overall === "pass" ? 1 : 0) : uiStateCorrectness;
  const evidenceGrounding = screenshotCount > 0 || existsSync(join(outputDir, "trace.jsonl")) ? 1 : 0;
  const costEfficiency = run.failReasons.some((reason) => /cost|budget/i.test(reason)) ? 0 : 1;
  const latencySmoothness = clamp01(1 - totalDuration / latencyBudgetMs);
  const safety = run.failReasons.some((reason) => /safety|security|privacy/i.test(reason)) ? 0 : 1;
  const failureCategories = classifyFailures(run);
  const components = [taskCompletion, uiStateCorrectness, visualQuality, evidenceGrounding, costEfficiency, latencySmoothness, safety];

  return {
    taskCompletion: round3(taskCompletion),
    uiStateCorrectness: round3(uiStateCorrectness),
    visualQuality: round3(visualQuality),
    evidenceGrounding: round3(evidenceGrounding),
    costEfficiency: round3(costEfficiency),
    latencySmoothness: round3(latencySmoothness),
    safety: round3(safety),
    total: round3(components.reduce((sum, value) => sum + value, 0) / components.length),
    failureCategories,
  };
}

function renderRepairPrompt(
  run: ProofLoopArtifactRun,
  outputDir: string,
  trajectoryId: string,
  reward: Reward,
  blastRadius?: RepairBlastRadiusSection[],
): string {
  const failedSteps = run.steps.filter((step) => step.required && step.status !== "pass" && !step.softFail);
  const lines: string[] = [];
  lines.push(`# Repair Prompt - ${run.suite}`);
  lines.push("");
  lines.push(`Run: ${run.runId}`);
  lines.push(`Trajectory: ${trajectoryId}`);
  lines.push(`Score: ${run.score}/100`);
  lines.push(`Reward total: ${reward.total}`);
  lines.push("");

  if (failedSteps.length === 0) {
    lines.push("No repair required. Promote this run only if the suite is intended as a regression proof.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Exact Failure");
  lines.push("");
  for (const reason of run.failReasons) lines.push(`- ${reason}`);
  lines.push("");
  lines.push("## Evidence Paths");
  lines.push("");
  for (const path of ["node-trace-v2.json", "node-eval.json", "scorecard.md", "trace.jsonl"]) {
    if (existsSync(join(outputDir, path))) lines.push(`- ${path}`);
  }
  for (const shot of listScreenshotFiles(outputDir)) lines.push(`- ${relativeOutputPath(outputDir, shot)}`);
  lines.push("");
  lines.push("## Failing Steps");
  lines.push("");
  for (const step of failedSteps) {
    lines.push(`### ${step.name}`);
    lines.push(`- Status: ${step.status}`);
    lines.push(`- Exit: ${step.exitCode}`);
    lines.push(`- Duration: ${step.durationMs}ms`);
    lines.push(`- Observation: ${summarizeStep(step)}`);
    lines.push("");
  }
  if (blastRadius?.length) {
    lines.push("## Blast radius (code graph)");
    lines.push("");
    lines.push("Ranked files likely responsible, from the local code-graph index (retrieval hint only — it never changes what is verified).");
    lines.push("");
    for (const section of blastRadius) {
      lines.push(`### ${section.seedKind} "${section.seed}"`);
      lines.push("");
      section.files.forEach((entry, index) => {
        const recent = entry.recentlyChanged ? ", recently changed" : "";
        const symbols = entry.symbols?.length ? ` (symbols: ${entry.symbols.join(", ")})` : "";
        lines.push(`${index + 1}. ${entry.file} (score ${entry.score}${recent}) — ${entry.why.join("; ")}${symbols}`);
      });
      lines.push("");
    }
  }
  lines.push("## Suggested Smallest Fix");
  lines.push("");
  lines.push("Fix the first failing required step without weakening minScore, required checks, evidence capture, or CI gates.");
  lines.push("");
  lines.push("## Regression To Add");
  lines.push("");
  lines.push("Add or update a deterministic test that fails on the exact missing assertion before the fix.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderTraceStorybook(nodeTrace: unknown, nodeEval: unknown): string {
  const payload = escapeHtml(JSON.stringify({ nodeTrace, nodeEval }));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Trace Storybook</title>
  <style>
    body { margin: 0; font: 13px/1.4 system-ui, sans-serif; background: #111318; color: #f4f6fb; }
    header { padding: 16px 20px; border-bottom: 1px solid #2a2f3a; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 20px; }
    section { border: 1px solid #2a2f3a; border-radius: 8px; padding: 12px; background: #171a21; }
    h1, h2 { margin: 0 0 8px; }
    .atom { padding: 8px; border-top: 1px solid #2a2f3a; }
    .pass { color: #79d88b; }
    .fail { color: #ff8a8a; }
    code { color: #a8c7ff; }
  </style>
</head>
<body>
  <header><h1>Trace Storybook</h1><div id="verdict"></div></header>
  <main>
    <section><h2>RoomHeaderAtom</h2><div id="summary"></div></section>
    <section><h2>ChatMessageAtom</h2><div id="messages"></div></section>
    <section><h2>ArtifactTabAtom</h2><div id="artifact-tabs"></div></section>
    <section><h2>SpreadsheetCellAtom</h2><div id="spreadsheet-cells"></div></section>
    <section><h2>VerdictBadgeAtom</h2><div id="reward"></div></section>
    <section><h2>AgentToolAtom</h2><div id="steps"></div></section>
    <section><h2>EvidenceCardAtom</h2><div id="evidence"></div></section>
    <section><h2>SourceCaptureAtom</h2><div id="sources"></div></section>
    <section><h2>FocusBoxAtom</h2><div id="focus"></div></section>
    <section><h2>CostBadgeAtom</h2><div id="cost"></div></section>
  </main>
  <script type="application/json" id="trace-data">${payload}</script>
  <script>
    const data = JSON.parse(document.getElementById("trace-data").textContent);
    const trace = data.nodeTrace;
    const evalResult = data.nodeEval;
    const reward = trace.reward || evalResult.reward;
    const atomList = (items, fallback) => (items && items.length ? items : [fallback]).map((value) => "<div class='atom'>" + value + "</div>").join("");
    document.getElementById("verdict").textContent = evalResult.verifier.hardPass ? "PASS" : "FAIL";
    document.getElementById("summary").innerHTML = "<code>" + trace.runId + "</code><br/>" + trace.userGoal;
    document.getElementById("messages").innerHTML = atomList([trace.userGoal, evalResult.judge.diagnosticSummary], "No chat messages recorded.");
    document.getElementById("artifact-tabs").innerHTML = atomList(trace.artifacts.map((a) => "<code>" + a.artifactId + "</code><br/>" + a.exportPath), "No artifacts recorded.");
    document.getElementById("spreadsheet-cells").innerHTML = atomList(trace.outerTrace.uiAssertions.map((a) => "<code>" + a.id + "</code>: " + a.observed), "No cell assertions recorded.");
    document.getElementById("reward").innerHTML = Object.entries(reward).map(([k, v]) => "<div class='atom'><code>" + k + "</code>: " + JSON.stringify(v) + "</div>").join("");
    document.getElementById("steps").innerHTML = trace.innerTrace.steps.map((s) => "<div class='atom " + (s.error ? "fail" : "pass") + "'><code>" + s.action + "</code><br/>" + s.observation + "</div>").join("");
    document.getElementById("evidence").innerHTML = trace.outerTrace.screenshots.concat(trace.artifacts).map((e) => "<div class='atom'><code>" + (e.path || e.exportPath) + "</code></div>").join("");
    document.getElementById("sources").innerHTML = atomList((evalResult.judge.evidencePaths || []).map((p) => "<code>" + p + "</code>"), "No source captures recorded.");
    document.getElementById("focus").innerHTML = atomList(trace.outerTrace.uiAssertions.map((a) => (a.passed ? "pass" : "fail") + ": " + a.expected), "No focus boxes recorded.");
    document.getElementById("cost").innerHTML = atomList(trace.innerTrace.steps.map((s) => "<code>" + s.action + "</code>: $" + s.costUsd + ", " + s.latencyMs + "ms"), "No cost data recorded.");
  </script>
</body>
</html>
`;
}

function listScreenshotFiles(outputDir: string): string[] {
  const dir = join(outputDir, "screenshots");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

function screenshotLabel(run: ProofLoopArtifactRun, index: number, count: number): "before" | "during" | "after" | "failure" | "focus" {
  if (!run.passed && index === count - 1) return "failure";
  if (index === 0) return "before";
  if (index === count - 1) return "after";
  return "during";
}

function classifyFailures(run: ProofLoopArtifactRun): string[] {
  const categories = new Set<string>();
  for (const step of run.steps) {
    if (step.status === "pass" || step.softFail) continue;
    const text = `${step.name} ${step.stderr} ${step.stdout}`.toLowerCase();
    if (step.status === "timeout" || /timeout|latency/.test(text)) categories.add("latency_timeout");
    else if (/visual|ui|browser|playwright|screenshot/.test(text)) categories.add("ui_state_failure");
    else if (/evidence|source|citation|receipt/.test(text)) categories.add("evidence_grounding_failure");
    else if (/cost|budget/.test(text)) categories.add("cost_budget_failure");
    else categories.add("task_completion_failure");
  }
  if (run.score < run.minScore) categories.add("score_below_threshold");
  return [...categories].sort();
}

function summarizeStep(step: ProofLoopArtifactStep): string {
  const source = step.status === "pass"
    ? step.stdout || `Step ${step.name} passed`
    : step.stderr || step.stdout || `Step ${step.name} ${step.status}`;
  return compactWhitespace(source).slice(0, 500);
}

function commandToolName(stepName: string): string {
  if (/playwright|ui|scenario|browser|visual/i.test(stepName)) return "playwright";
  if (/seed/i.test(stepName)) return "seed";
  if (/benchmark/i.test(stepName)) return "benchmark";
  if (/build/i.test(stepName)) return "build";
  return "proofloop";
}

function extractVisualConsoleErrors(outputDir: string): string[] {
  const review = readJsonIfExists(join(outputDir, "visual-review.json")) as { checks?: Array<{ name: string; status: string; detail: string }> } | null;
  if (!review?.checks) return [];
  return review.checks
    .filter((check) => check.status === "fail" && /console/i.test(check.name + check.detail))
    .map((check) => check.detail);
}

function firstExistingPath(outputDir: string, names: string[]): string | undefined {
  for (const name of names) {
    const path = join(outputDir, name);
    if (existsSync(path)) return relativeOutputPath(outputDir, path);
  }
  return undefined;
}

function readJsonIfExists(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function hashFile(path: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

function relativeOutputPath(outputDir: string, path: string): string {
  return relative(outputDir, path).replace(/\\/g, "/");
}

function slug(value: string): string {
  const base = value.replace(extname(value), "");
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "artifact";
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 1 : clamp01(numerator / denominator);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
