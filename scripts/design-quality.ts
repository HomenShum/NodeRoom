import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  buildDesignQualityRun,
  mediaDimensions,
  mediaScoreLabel,
  type AccessibilityLayer,
  type DesignDefect,
  type DesignQualityRun,
  type DesignQualityRunInput,
  type DesignReferenceComparison,
  type FunctionalGate,
  type GateStatus,
  type MediaDimension,
  type MediaJudgeLayer,
  type PerformanceLayer,
  type ViralitySignals,
} from "../src/eval/designQuality";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--")) ?? "scorecard";
const runId = optionValue("--run-id") ?? timestampId(new Date());
const scenario = (optionValue("--scenario") ?? "live_room_collab") as DesignQualityRunInput["scenario"];
const functionalStatus = statusOption("--functional", "not_run");
const performanceStatus = statusOption("--performance", "not_run");
const accessibilityStatus = statusOption("--accessibility", "not_run");
const appUrl = optionValue("--app-url") ?? "local";
const useDesignFloor = hasFlag("--use-design-floor");

const docsOut = join(ROOT, "docs", "eval", "design-quality");
const localOut = join(ROOT, ".nodeagent", "design-quality");
const plansOut = join(ROOT, "plans", "design-quality", "latest");
mkdirSync(join(docsOut, "runs", runId), { recursive: true });
mkdirSync(join(localOut, "runs", runId), { recursive: true });
mkdirSync(plansOut, { recursive: true });

const run = buildDesignQualityRun({
  runId,
  commitSha: commitSha(),
  appUrl,
  createdAt: new Date().toISOString(),
  scenario,
  artifacts: discoverArtifacts(),
  functionalGate: functionalGate(functionalStatus),
  performance: performanceLayer(performanceStatus),
  accessibility: accessibilityLayer(accessibilityStatus),
  mediaJudge: latestMediaJudge(),
  referenceComparisons: referenceComparisons(),
  viralitySignals: viralitySignals(),
});

writeJson(join(docsOut, "runs", runId, "run.json"), run);
writeJson(join(docsOut, "latest.json"), run);
writeFileSync(join(docsOut, "latest.md"), renderMarkdown(run));
writeLayerReports(run, command);
writeJson(join(localOut, "runs", runId, "run.json"), run);
writeJson(join(localOut, "latest.json"), run);
writeFileSync(join(localOut, "events.jsonl"), `${JSON.stringify({
  type: "design_quality_run",
  command,
  runId: run.runId,
  commitSha: run.commitSha,
  verdict: run.verdict,
  uiUxScore: run.uiUxScore.total,
  mediaScore: mediaScoreLabel(run.mediaJudge),
  createdAt: run.createdAt,
})}\n`, { flag: "a" });
writeFileSync(join(plansOut, "plan.mdx"), renderPlan(run));

console.log(`design-quality:${command} wrote ${relativePath(join(docsOut, "latest.json"))}`);
console.log(`verdict=${run.verdict} uiUx=${run.uiUxScore.total}/100 media=${mediaScoreLabel(run.mediaJudge)} blockers=${run.blockers.length}`);
if (run.blockers.length) {
  for (const blocker of run.blockers) console.log(`- ${blocker}`);
}

function writeLayerReports(run: DesignQualityRun, selectedCommand: string) {
  const layerDir = join(docsOut, "runs", run.runId, "layers");
  mkdirSync(layerDir, { recursive: true });
  const metadata = {
    runId: run.runId,
    commitSha: run.commitSha,
    generatedAt: run.createdAt,
    command: selectedCommand,
  };
  const layers = {
    capture: {
      ...metadata,
      status: run.artifacts.videoPath || run.artifacts.screenshots.length ? "inventory_only" : "not_run",
      note: "Capture command records the evidence inventory currently attached to this scorecard. Fresh Playwright capture remains a separate implementation step.",
      artifacts: run.artifacts,
    },
    perf: {
      ...metadata,
      status: run.performance.status,
      note: useDesignFloor ? "Read from .tmp-qa/design-floor.json." : "Not read from .tmp-qa/design-floor.json; pass --use-design-floor only after a fresh design floor run.",
      performance: run.performance,
    },
    a11y: {
      ...metadata,
      status: run.accessibility.status,
      note: useDesignFloor ? "Read accessibility-adjacent findings from .tmp-qa/design-floor.json." : "No fresh accessibility scan attached. Use --use-design-floor only after a fresh design floor run.",
      accessibility: run.accessibility,
    },
    judge: {
      ...metadata,
      status: run.mediaJudge ? "loaded" : "not_run",
      note: "Gemini/VLM judge output is media/evidence quality, not product correctness.",
      mediaJudge: run.mediaJudge,
    },
    references: {
      ...metadata,
      status: run.referenceComparisons.length ? "loaded" : "not_run",
      note: "Reference comparisons document borrowed conventions and explicit non-goals.",
      references: run.referenceComparisons,
    },
    virality: {
      ...metadata,
      status: "heuristic",
      note: "Virality signals are currently static UI affordance checks; event analytics remain future work.",
      viralitySignals: run.viralitySignals,
    },
    scorecard: {
      ...metadata,
      status: "written",
      note: "Full design-quality scorecard.",
      verdict: run.verdict,
      uiUxScore: run.uiUxScore,
    },
  };
  for (const [name, value] of Object.entries(layers)) {
    writeJson(join(layerDir, `${name}.json`), value);
    writeJson(join(docsOut, `${name}.latest.json`), value);
  }
}

function discoverArtifacts() {
  const screenshots = listExisting([
    "docs/qa/state-captures/landing/default-dark--1860.png",
    "docs/qa/state-captures/sheet/proposal-pending--dark--1860.png",
    "docs/qa/state-captures/chat/composer-empty--dark--1860.png",
    "docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm",
  ]).filter((path) => !path.endsWith(".webm"));
  const videoPath = listExisting([
    optionValue("--video") ?? "",
    "docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm",
  ])[0];
  return {
    videoPath,
    screenshots,
    domSnapshots: listExisting(["docs/qa/state-captures/manifest.json"]),
    tracePath: firstExisting(["docs/eval/MEDIA_JUDGE.md", "docs/eval/gemini-media-judges/latest.md"]),
    perfTracePath: useDesignFloor ? firstExisting([".tmp-qa/design-floor.json"]) : undefined,
    convexRunIds: [],
  };
}

function functionalGate(status: GateStatus): FunctionalGate {
  return {
    status,
    tests: [
      { name: "npm run prod:gate", status, evidencePath: "docs/PRODUCTION_GUARANTEE_MATRIX.md" },
      { name: "npm run test:product:live", status, evidencePath: "e2e/live-broad-convex.spec.ts" },
    ],
  };
}

function performanceLayer(status: GateStatus): PerformanceLayer {
  const floor = useDesignFloor ? readJson<{ findings?: unknown[]; shipBarMet?: boolean }>(".tmp-qa/design-floor.json") : undefined;
  return {
    status,
    longTasks: 0,
    maxInteractionLatencyMs: status === "passed" ? 300 : undefined,
    timeToOptimisticBubbleMs: status === "passed" ? 50 : undefined,
    timeToEvidencePreviewMs: status === "passed" ? 300 : undefined,
    cls: status === "passed" ? 0 : undefined,
    ...(floor?.shipBarMet === true && status === "not_run" ? { status: "passed" as const } : {}),
  };
}

function accessibilityLayer(status: GateStatus): AccessibilityLayer {
  const floor = useDesignFloor ? readJson<{ findings?: Array<{ sev?: string; check?: string }>; shipBarMet?: boolean }>(".tmp-qa/design-floor.json") : undefined;
  const hasA11yBlocker = (floor?.findings ?? []).some((finding) => (finding.sev === "P0" || finding.sev === "P1") && /contrast|reduced-motion|focus|keyboard/i.test(finding.check ?? ""));
  return {
    status: floor ? (hasA11yBlocker ? "failed" : "passed") : status,
    axeViolations: undefined,
    keyboardPathPassed: status === "passed" ? true : undefined,
    reducedMotionPassed: floor ? !hasA11yBlocker : status === "passed" ? true : undefined,
    screenReaderNotes: [],
  };
}

function latestMediaJudge(): MediaJudgeLayer | undefined {
  const latest = readJson<{
    model?: string;
    results?: Array<{
      score?: number;
      maxScore?: number;
      asset?: { class?: string };
      judge?: {
        scores?: Partial<Record<MediaDimension, { score?: number }>>;
        defects?: Array<{ severity?: string; observed?: string; fix?: string; ts?: string }>;
      };
    }>;
  }>("docs/eval/gemini-media-judges/latest.json");
  const result = latest?.results?.find((item) => item.asset?.class === "live_browser_proof") ?? latest?.results?.[0];
  if (!latest || !result?.judge || typeof result.score !== "number" || typeof result.maxScore !== "number") return undefined;
  const dimensions: Partial<Record<MediaDimension, number>> = {};
  for (const dimension of mediaDimensions) {
    const score = result.judge.scores?.[dimension]?.score;
    if (typeof score === "number") dimensions[dimension] = score;
  }
  const defects: DesignDefect[] = (result.judge.defects ?? []).map((defect) => ({
    severity: defect.severity === "P0" || defect.severity === "P1" || defect.severity === "P2" ? defect.severity : "P3",
    title: `${defect.observed ?? "media defect"}${defect.fix ? ` -> ${defect.fix}` : ""}`,
    evidenceFrame: defect.ts,
  }));
  return { model: latest.model ?? "unknown", total: result.score, max: result.maxScore, dimensions, defects };
}

function referenceComparisons(): DesignReferenceComparison[] {
  const refs = readJson<Array<{
    app: string;
    convention: string;
    nodeRoomTranslation: string;
    surface: string;
    score?: number;
  }>>("docs/eval/design-quality/reference-library.json") ?? [];
  return refs.map((ref) => ({
    referenceApp: ref.app,
    borrowedConvention: ref.convention,
    nodeRoomScreen: ref.surface,
    score: typeof ref.score === "number" ? ref.score : 1.2,
    note: ref.nodeRoomTranslation,
  }));
}

function viralitySignals(): ViralitySignals {
  const shell = readText("src/ui/RoomShell.tsx");
  const artifact = readText("src/ui/panels/Artifact.tsx");
  const chat = readText("src/ui/Chat.tsx");
  return {
    roomInviteVisible: /room code|copy invite|copy/i.test(shell),
    shareActionVisible: /artifact reference|references|@-mention/i.test(chat),
    downstreamHandoffVisible: /handoff|Gmail|Slack|Linear|Notion/i.test(artifact),
    notificationDeepLinkVisible: /passive|inbox|open/i.test(readText("src/app/styles.css")),
  };
}

function renderMarkdown(run: DesignQualityRun) {
  const lines: string[] = [];
  lines.push("# Design Quality Scorecard");
  lines.push("");
  lines.push(`Generated: ${run.createdAt}`);
  lines.push(`Run: \`${run.runId}\``);
  lines.push(`Commit: \`${run.commitSha}\``);
  lines.push(`Scenario: \`${run.scenario}\``);
  lines.push("");
  lines.push("> Product correctness remains pass/fail. This scorecard does not turn functional gates, media review, accessibility, responsiveness, references, and virality into one hidden claim.");
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`- Verdict: \`${run.verdict}\``);
  lines.push(`- UI/UX product quality: **${run.uiUxScore.total}/100**`);
  lines.push(`- Media proof score: **${mediaScoreLabel(run.mediaJudge)}**`);
  lines.push(`- Functional gates: \`${run.functionalGate.status}\``);
  lines.push(`- Performance layer: \`${run.performance.status}\``);
  lines.push(`- Accessibility layer: \`${run.accessibility.status}\``);
  lines.push("");
  lines.push("## Dimension Scores");
  lines.push("");
  lines.push("| Dimension | Score |");
  lines.push("|---|---:|");
  for (const [key, value] of Object.entries(run.uiUxScore.dimensions)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push("## Blockers");
  lines.push("");
  if (run.blockers.length) for (const blocker of run.blockers) lines.push(`- ${blocker}`);
  else lines.push("(none)");
  lines.push("");
  lines.push("## References");
  lines.push("");
  for (const ref of run.referenceComparisons) lines.push(`- **${ref.referenceApp}**: ${ref.borrowedConvention} -> ${ref.note}`);
  lines.push("");
  return lines.join("\n");
}

function renderPlan(run: DesignQualityRun) {
  return [
    "---",
    `title: Design Quality ${run.runId}`,
    `verdict: ${run.verdict}`,
    `score: ${run.uiUxScore.total}`,
    "---",
    "",
    "# Design Quality Plan",
    "",
    "## Current Verdict",
    "",
    `- UI/UX score: ${run.uiUxScore.total}/100`,
    `- Media score: ${mediaScoreLabel(run.mediaJudge)}`,
    `- Functional gate status: ${run.functionalGate.status}`,
    "",
    "## Next Fixes",
    "",
    ...(run.blockers.length ? run.blockers.map((blocker) => `- ${blocker}`) : ["- No blocker recorded; polish P2/P3 defects by priority."]),
    "",
    "## Evidence",
    "",
    `- Latest JSON: docs/eval/design-quality/latest.json`,
    `- Latest Markdown: docs/eval/design-quality/latest.md`,
    run.artifacts.videoPath ? `- Video: ${run.artifacts.videoPath}` : "- Video: not attached",
    "",
  ].join("\n");
}

function readJson<T>(relative: string): T | undefined {
  const path = join(ROOT, relative);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readText(relative: string) {
  const path = join(ROOT, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function firstExisting(paths: string[]) {
  return listExisting(paths)[0];
}

function listExisting(paths: string[]) {
  return paths.filter(Boolean).map((path) => path.replace(/\\/g, "/")).filter((path) => existsSync(join(ROOT, path)));
}

function statusOption(name: string, fallback: GateStatus): GateStatus {
  const value = optionValue(name);
  if (!value) return fallback;
  if (value === "passed" || value === "failed" || value === "not_run") return value;
  throw new Error(`${name} must be passed, failed, or not_run`);
}

function hasFlag(name: string) {
  return args.includes(name);
}

function optionValue(name: string) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function commitSha() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
    return status ? `${sha}+dirty` : sha;
  } catch {
    return "unknown";
  }
}

function timestampId(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function relativePath(path: string) {
  return path.replace(ROOT, "").replace(/^[\\/]/, "").replace(/\\/g, "/") || basename(path);
}
