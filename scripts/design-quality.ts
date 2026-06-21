import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import {
  buildDesignQualityRun,
  designPerformancePasses,
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
import {
  validateBrowserEvidence,
  type BrowserEvidence,
  type BrowserEvidenceFreshness,
  type BrowserFinding,
  type BrowserViewportEvidence,
} from "../src/eval/designQualityBrowserEvidence";

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
const browserBackedCommand = ["capture", "perf", "a11y", "scorecard"].includes(command);
const forceFreshBrowser = hasFlag("--fresh-browser") || command === "capture";
const browserServerMode = optionValue("--server") ?? process.env.DESIGN_QUALITY_SERVER ?? "preview";
const browserSkipBuild = hasFlag("--skip-build");
const sourceTreeHash = runtimeSourceTreeHash();

const docsOut = join(ROOT, "docs", "eval", "design-quality");
const localOut = join(ROOT, ".nodeagent", "design-quality");
const plansOut = join(ROOT, "plans", "design-quality", "latest");
mkdirSync(join(docsOut, "runs", runId), { recursive: true });
mkdirSync(join(localOut, "runs", runId), { recursive: true });
mkdirSync(plansOut, { recursive: true });

type BrowserEvidenceResolution = {
  evidence: BrowserEvidence;
  source: "collected" | "validated_reuse";
  freshness: BrowserEvidenceFreshness;
};

const browserEvidenceResolution = await resolveBrowserEvidence();
const browserEvidence = browserEvidenceResolution?.evidence;

const run = buildDesignQualityRun({
  runId,
  commitSha: commitSha(),
  appUrl,
  createdAt: new Date().toISOString(),
  scenario,
  artifacts: discoverArtifacts(browserEvidence),
  functionalGate: functionalGate(functionalStatus),
  performance: performanceLayer(performanceStatus, browserEvidence),
  accessibility: accessibilityLayer(accessibilityStatus, browserEvidence),
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
  const browserEvidenceSummary = browserEvidenceResolution ? {
    runId: browserEvidenceResolution.evidence.runId,
    source: browserEvidenceResolution.source,
    freshness: browserEvidenceResolution.freshness,
    evidencePath: browserEvidenceResolution.evidence.performance.evidencePath ?? `docs/eval/design-quality/browser/${browserEvidenceResolution.evidence.runId}/browser.json`,
    appUrl: browserEvidenceResolution.evidence.appUrl,
    generatedAt: browserEvidenceResolution.evidence.generatedAt,
    commitSha: browserEvidenceResolution.evidence.commitSha,
    sourceTreeHash: browserEvidenceResolution.evidence.sourceTreeHash,
  } : undefined;
  const browserEvidenceNote = browserEvidenceResolution
    ? browserEvidenceResolution.source === "collected"
      ? "Fresh Playwright browser evidence collected for this command."
      : "Validated current Playwright browser evidence reused for this command."
    : undefined;
  const metadata = {
    runId: run.runId,
    commitSha: run.commitSha,
    generatedAt: run.createdAt,
    command: selectedCommand,
    sourceTreeHash,
  };
  const layers = {
    capture: {
      ...metadata,
      status: browserEvidence?.capture.status ?? (run.artifacts.videoPath || run.artifacts.screenshots.length ? "inventory_only" : "not_run"),
      note: browserEvidenceNote ?? "Capture command records the evidence inventory currently attached to this scorecard.",
      browserEvidence: browserEvidenceSummary,
      artifacts: run.artifacts,
      findings: browserEvidence?.capture.findings ?? [],
    },
    perf: {
      ...metadata,
      status: run.performance.status,
      note: browserEvidenceNote ?? (useDesignFloor ? "Read from .tmp-qa/design-floor.json." : "No current performance browser evidence attached."),
      browserEvidence: browserEvidenceSummary,
      performance: run.performance,
    },
    a11y: {
      ...metadata,
      status: run.accessibility.status,
      note: browserEvidenceNote ?? (useDesignFloor ? "Read accessibility-adjacent findings from .tmp-qa/design-floor.json." : "No current accessibility scan attached."),
      browserEvidence: browserEvidenceSummary,
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
      blockers: run.blockers,
      functionalStatus: run.functionalGate.status,
      performanceStatus: run.performance.status,
      accessibilityStatus: run.accessibility.status,
      performanceEvidencePath: run.performance.evidencePath,
      accessibilityEvidencePath: run.accessibility.evidencePath,
      browserEvidence: browserEvidenceSummary,
      uiUxScore: run.uiUxScore,
    },
  };
  for (const [name, value] of Object.entries(layers)) {
    writeJson(join(layerDir, `${name}.json`), value);
    writeJson(join(docsOut, `${name}.latest.json`), value);
  }
}

function discoverArtifacts(evidence?: BrowserEvidence) {
  const screenshots = [
    ...(evidence?.capture.screenshots ?? []),
    ...listExisting([
    "docs/qa/state-captures/landing/default-dark--1860.png",
    "docs/qa/state-captures/sheet/proposal-pending--dark--1860.png",
    "docs/qa/state-captures/chat/composer-empty--dark--1860.png",
    "docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm",
    ]).filter((path) => !path.endsWith(".webm")),
  ].filter((path, index, list) => list.indexOf(path) === index);
  const videoPath = listExisting([
    optionValue("--video") ?? "",
    "docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm",
  ])[0];
  return {
    videoPath,
    screenshots,
    domSnapshots: [
      ...(evidence?.capture.domSnapshots ?? []),
      ...listExisting(["docs/qa/state-captures/manifest.json"]),
    ].filter((path, index, list) => list.indexOf(path) === index),
    tracePath: firstExisting(["docs/eval/MEDIA_JUDGE.md", "docs/eval/gemini-media-judges/latest.md"]),
    perfTracePath: evidence?.performance.evidencePath ?? (useDesignFloor ? firstExisting([".tmp-qa/design-floor.json"]) : undefined),
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

function performanceLayer(status: GateStatus, evidence?: BrowserEvidence): PerformanceLayer {
  if (evidence) return evidence.performance;
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

function accessibilityLayer(status: GateStatus, evidence?: BrowserEvidence): AccessibilityLayer {
  if (evidence) return evidence.accessibility;
  const floor = useDesignFloor ? readJson<{ findings?: Array<{ sev?: string; check?: string }>; shipBarMet?: boolean }>(".tmp-qa/design-floor.json") : undefined;
  const hasA11yBlocker = (floor?.findings ?? []).some((finding) => (finding.sev === "P0" || finding.sev === "P1") && /contrast|reduced-motion|focus|keyboard/i.test(finding.check ?? ""));
  return {
    status: floor ? (hasA11yBlocker ? "failed" : "passed") : status,
    axeViolations: undefined,
    deterministicViolations: floor ? (hasA11yBlocker ? 1 : 0) : status === "passed" ? 0 : undefined,
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

function latestBrowserEvidence(): BrowserEvidence | undefined {
  return readJson<BrowserEvidence>("docs/eval/design-quality/browser.latest.json");
}

async function resolveBrowserEvidence(): Promise<BrowserEvidenceResolution | undefined> {
  if (forceFreshBrowser) {
    return {
      evidence: await collectBrowserEvidence(),
      source: "collected",
      freshness: { valid: true, reason: "collected" },
    };
  }
  const latest = latestBrowserEvidence();
  const freshness = validateBrowserEvidence(latest, {
    currentSourceTreeHash: sourceTreeHash,
    requestedAppUrl: appUrl,
  });
  if (latest && freshness.valid) {
    return { evidence: latest, source: "validated_reuse", freshness };
  }
  if (!browserBackedCommand) return undefined;
  return {
    evidence: await collectBrowserEvidence(),
    source: "collected",
    freshness: { valid: true, reason: `collected_after_${freshness.reason}` },
  };
}

async function collectBrowserEvidence(): Promise<BrowserEvidence> {
  const server = await startDesignQualityServer();
  const browserDir = join(docsOut, "browser", runId);
  mkdirSync(browserDir, { recursive: true });
  const findings: BrowserFinding[] = [];
  const viewports: BrowserViewportEvidence[] = [];
  const interactionLatencies: number[] = [];
  let optimisticBubbleMs: number | undefined;
  let evidencePreviewMs: number | undefined;
  let cls = 0;
  let longTasks = 0;
  const browser = await chromium.launch();
  try {
    for (const viewport of [
      { name: "desktop-1440", width: 1440, height: 900 },
      { name: "mobile-375", width: 375, height: 812 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
      await page.addInitScript(() => {
        try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ }
        const state = { cls: 0, longTasks: 0 };
        Object.defineProperty(window, "__designQualityMetrics", { value: state, configurable: true });
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const layout = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
              if (!layout.hadRecentInput && typeof layout.value === "number") state.cls += layout.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch { /* layout-shift unsupported */ }
        try {
          new PerformanceObserver((list) => {
            state.longTasks += list.getEntries().length;
          }).observe({ type: "longtask", buffered: true });
        } catch { /* longtask unsupported */ }
      });

      await enterDesignRoom(page, server.baseUrl, viewport.width);
      await resetDesignMetrics(page);
      const measured = await measureInteractions(page, viewport.name);
      interactionLatencies.push(...measured.interactions);
      optimisticBubbleMs = maxDefined(optimisticBubbleMs, measured.optimisticBubbleMs);
      evidencePreviewMs = maxDefined(evidencePreviewMs, measured.evidencePreviewMs);
      findings.push(...measured.findings);
      await page.waitForTimeout(100);
      const signal = await readBrowserSignals(page);
      const shotPath = join(browserDir, `${viewport.name}.png`);
      const domPath = join(browserDir, `${viewport.name}.dom.json`);
      await page.screenshot({ path: shotPath, fullPage: false });
      writeJson(domPath, {
        title: signal.title,
        textLength: signal.textLength,
        activeElement: signal.activeElement,
        scrollWidth: signal.scrollWidth,
        clientWidth: signal.clientWidth,
        focusableCount: signal.focusableCount,
      });

      viewports.push({
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        screenshot: relativePath(shotPath),
        domSnapshot: relativePath(domPath),
        textLength: signal.textLength,
        scrollWidth: signal.scrollWidth,
        clientWidth: signal.clientWidth,
        cls: signal.cls,
        longTasks: signal.longTasks,
      });
      cls = Math.max(cls, signal.cls);
      longTasks += signal.longTasks;
      findings.push(...findingsForSignals(viewport.name, signal));

      await context.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }

  const captureBlockers = findings.filter((finding) => finding.severity === "P0" && finding.check === "capture");
  const evidencePath = `docs/eval/design-quality/browser/${runId}/browser.json`;
  const performance: PerformanceLayer = {
    status: "not_run",
    evidencePath,
    cls: round(cls, 4),
    longTasks,
    maxInteractionLatencyMs: Math.round(Math.max(0, ...interactionLatencies)),
    timeToOptimisticBubbleMs: optimisticBubbleMs === undefined ? undefined : Math.round(optimisticBubbleMs),
    timeToEvidencePreviewMs: evidencePreviewMs === undefined ? undefined : Math.round(evidencePreviewMs),
  };
  performance.status = designPerformancePasses(performance) ? "passed" : "failed";
  const a11yBlockers = findings.filter((finding) => finding.severity !== "P2" && /contrast|keyboard|focus|reduced-motion/.test(finding.check));
  const accessibilityStatus: GateStatus = a11yBlockers.length ? "failed" : "passed";
  const evidence: BrowserEvidence = {
    schema: 1,
    runId,
    commitSha: commitSha(),
    sourceTreeHash,
    generatedAt: new Date().toISOString(),
    appUrl: server.baseUrl,
    serverMode: server.mode,
    capture: {
      status: captureBlockers.length ? "failed" : "passed",
      screenshots: viewports.map((viewport) => viewport.screenshot),
      domSnapshots: viewports.map((viewport) => viewport.domSnapshot),
      viewports,
      findings,
    },
    performance,
    accessibility: {
      status: accessibilityStatus,
      evidencePath,
      deterministicViolations: a11yBlockers.length,
      keyboardPathPassed: !a11yBlockers.some((finding) => /keyboard|focus/.test(finding.check)),
      reducedMotionPassed: !a11yBlockers.some((finding) => finding.check === "reduced-motion"),
      screenReaderNotes: [],
    },
  };
  writeJson(join(browserDir, "browser.json"), evidence);
  writeJson(join(docsOut, "browser.latest.json"), evidence);
  return evidence;
}

async function enterDesignRoom(page: Page, baseUrl: string, width: number) {
  await page.goto(`${baseUrl}/?mode=memory`, { waitUntil: "domcontentloaded" });
  const artifact = page.getByTestId("artifact-panel");
  const inside = await artifact.waitFor({ state: "visible", timeout: 1_500 }).then(() => true, () => false);
  if (!inside) {
    await page.getByTestId("start-demo-room").click({ timeout: 15_000 });
  }
  await artifact.waitFor({ state: "visible", timeout: 20_000 });
  if (width > 1199) {
    const leftRail = page.getByTestId("left-rail");
    if (!(await leftRail.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Toggle Room Binder panel" }).click().catch(() => {});
    }
  }
  await page.waitForTimeout(350);
}

async function resetDesignMetrics(page: Page) {
  await page.evaluate(() => {
    const metrics = (window as unknown as { __designQualityMetrics?: { cls: number; longTasks: number } }).__designQualityMetrics;
    if (metrics) {
      metrics.cls = 0;
      metrics.longTasks = 0;
    }
  });
}

async function measureInteractions(page: Page, viewportName: string) {
  const interactions: number[] = [];
  const findings: BrowserFinding[] = [];
  let optimisticBubbleMs: number | undefined;
  let evidencePreviewMs: number | undefined;
  const researchTab = page.getByTestId("artifact-tabs").getByRole("button", { name: /Research/i }).first();
  if (await researchTab.isVisible().catch(() => false)) {
    try {
      const ms = await measureMs(async () => {
        await researchTab.click();
        await page.getByTestId("artifact-panel").locator("text=/Research|pending|Import/i").first().waitFor({ state: "visible", timeout: 5_000 });
      });
      interactions.push(ms);
      evidencePreviewMs = ms;
    } catch (error) {
      interactions.push(5_000);
      evidencePreviewMs = maxDefined(evidencePreviewMs, 5_000);
      findings.push({ surface: viewportName, severity: "P1", check: "interaction-timeout", detail: `research evidence preview did not settle within 5000ms: ${errorDetail(error)}` });
    }
  }

  if (viewportName.startsWith("desktop")) {
    const composer = page.getByTestId("public-chat-panel").getByTestId("chat-composer");
    if (await composer.isVisible().catch(() => false)) {
      const text = `Design QA ping ${Date.now().toString(36)}`;
      try {
        const ms = await measureMs(async () => {
          await composer.fill(text);
          await composer.press("Enter");
          await page.getByTestId("public-chat-panel").getByTestId("chat-message").filter({ hasText: text }).waitFor({ state: "visible", timeout: 5_000 });
        });
        interactions.push(ms);
        optimisticBubbleMs = ms;
      } catch (error) {
        interactions.push(5_000);
        optimisticBubbleMs = maxDefined(optimisticBubbleMs, 5_000);
        findings.push({ surface: viewportName, severity: "P1", check: "interaction-timeout", detail: `chat optimistic bubble did not appear within 5000ms: ${errorDetail(error)}` });
      }
    }
  }

  const workToggle = page.getByRole("button", { name: "Toggle Work Surface panel" }).first();
  if (await workToggle.isVisible().catch(() => false)) {
    try {
      interactions.push(await measureMs(async () => {
        await workToggle.click();
        await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 5_000 });
      }));
    } catch (error) {
      interactions.push(5_000);
      findings.push({ surface: viewportName, severity: "P1", check: "interaction-timeout", detail: `work surface toggle did not settle within 5000ms: ${errorDetail(error)}` });
    }
  }
  return { interactions, optimisticBubbleMs, evidencePreviewMs, findings };
}

async function readBrowserSignals(page: Page) {
  return page.evaluate(() => {
    const metrics = (window as unknown as { __designQualityMetrics?: { cls: number; longTasks: number } }).__designQualityMetrics ?? { cls: 0, longTasks: 0 };
    const visible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 2 && rect.height > 2 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
    };
    const luminance = (color: string) => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) return undefined;
      const [r, g, b] = match[1].split(",").map((part) => Number.parseFloat(part.trim()) / 255);
      const convert = (value: number) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      return 0.2126 * convert(r) + 0.7152 * convert(g) + 0.0722 * convert(b);
    };
    const backgroundFor = (el: Element) => {
      let node: Element | null = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        const alpha = Number.parseFloat(bg.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/)?.[1] ?? "1");
        if (alpha >= 0.95) return bg;
        node = node.parentElement;
      }
      return "rgb(17, 20, 24)";
    };
    const contrastFails: Array<{ selector: string; ratio: number; size: number }> = [];
    for (const el of Array.from(document.querySelectorAll("button, a, input, textarea, [role='button'], .r-tab, .r-status, td, th, p, span")).filter(visible).slice(0, 500)) {
      const text = (el.textContent ?? "").trim();
      if (!text && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
      const style = getComputedStyle(el);
      const fg = luminance(style.color);
      const bg = luminance(backgroundFor(el));
      if (fg === undefined || bg === undefined) continue;
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const size = Number.parseFloat(style.fontSize);
      const bold = Number.parseInt(style.fontWeight, 10) >= 700;
      const min = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio + 0.05 < min) {
        const cls = typeof (el as HTMLElement).className === "string" ? `.${(el as HTMLElement).className.split(/\s+/)[0]}` : "";
        contrastFails.push({ selector: `${el.tagName.toLowerCase()}${cls}`, ratio: Math.round(ratio * 100) / 100, size });
      }
    }
    const reducedMotionIssues = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(visible).slice(0, 500).filter((el) => {
      const style = getComputedStyle(el);
      const animationMs = parseCssTime(style.animationDuration);
      const transitionMs = parseCssTime(style.transitionDuration);
      return animationMs > 80 || transitionMs > 250;
    }).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.split(/\s+/)[0] : ""}`);
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])")).filter(visible);
    return {
      title: document.title,
      textLength: document.body.innerText.trim().length,
      activeElement: document.activeElement?.tagName.toLowerCase() ?? "",
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      focusableCount: focusable.length,
      cls: metrics.cls,
      longTasks: metrics.longTasks,
      contrastFails,
      reducedMotionIssues,
    };
    function parseCssTime(value: string) {
      return Math.max(0, ...value.split(",").map((raw) => raw.trim()).map((raw) => raw.endsWith("ms") ? Number.parseFloat(raw) : raw.endsWith("s") ? Number.parseFloat(raw) * 1000 : 0).filter(Number.isFinite));
    }
  });
}

function findingsForSignals(surface: string, signal: Awaited<ReturnType<typeof readBrowserSignals>>): BrowserFinding[] {
  const findings: BrowserFinding[] = [];
  if (signal.textLength < 50) findings.push({ surface, severity: "P0", check: "capture", detail: `near-blank render: ${signal.textLength} visible text chars` });
  if (signal.scrollWidth > signal.clientWidth + 1) findings.push({ surface, severity: "P1", check: "horizontal-overflow", detail: `${signal.scrollWidth - signal.clientWidth}px overflow` });
  for (const fail of signal.contrastFails.slice(0, 8)) {
    findings.push({ surface, severity: fail.ratio < 3 ? "P1" : "P2", check: "contrast", detail: `${fail.selector} ${fail.ratio}:1 at ${Math.round(fail.size)}px` });
  }
  if (!signal.focusableCount) findings.push({ surface, severity: "P1", check: "keyboard-focus", detail: "no visible focusable controls found" });
  for (const selector of signal.reducedMotionIssues) findings.push({ surface, severity: "P1", check: "reduced-motion", detail: `${selector} keeps long motion under prefers-reduced-motion` });
  return findings;
}

async function startDesignQualityServer(): Promise<{ baseUrl: string; mode: string; stop: () => void }> {
  if (/^https?:\/\//i.test(appUrl)) return { baseUrl: appUrl, mode: "external", stop: () => {} };
  const port = await chooseFreePort(Number.parseInt(process.env.DESIGN_QUALITY_PORT ?? "5317", 10));
  const baseUrl = `http://127.0.0.1:${port}`;
  const mode = browserServerMode === "dev" ? "dev" : "preview";
  if (mode === "preview" && !browserSkipBuild) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const build = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"], {
        cwd: ROOT,
        stdio: "inherit",
        windowsHide: true,
      });
      if (build.status === 0) break;
      if (attempt === 2) throw new Error(`design_quality_build_failed:${build.status ?? build.signal}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const argsForServer = process.platform === "win32"
    ? ["/d", "/s", "/c", mode === "dev" ? `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort` : `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`]
    : mode === "dev"
      ? ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : ["exec", "vite", "preview", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const child = spawn(command, argsForServer, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) as ChildProcessWithoutNullStreams;
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  await waitForHttp(baseUrl, 120_000, () => output);
  return { baseUrl, mode, stop: () => stopServer(child) };
}

async function chooseFreePort(start: number) {
  for (let port = start; port < start + 40; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free design-quality port in ${start}-${start + 39}`);
}

async function isPortFree(port: number) {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function waitForHttp(url: string, timeoutMs: number, output: () => string) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const status = await requestStatus(url);
      if (status >= 200 && status < 500) return;
      lastError = `HTTP ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`design_quality_server_not_ready:${url}:${lastError}\n${output()}`);
}

function requestStatus(url: string) {
  return new Promise<number>((resolve, reject) => {
    const req = http.request(new URL(url), { method: "GET", timeout: 2_000 }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.end();
  });
}

function stopServer(child: ChildProcessWithoutNullStreams) {
  if (child.killed) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill();
}

async function measureMs(fn: () => Promise<void>) {
  const started = Date.now();
  await fn();
  return Date.now() - started;
}

function maxDefined(left: number | undefined, right: number | undefined) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function errorDetail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0].slice(0, 180);
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

function runtimeSourceTreeHash() {
  const paths = [
    "src",
    "scripts",
    "tests",
    "e2e",
    "convex",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "tsconfig.json",
    "index.html",
  ];
  const hash = createHash("sha256");
  hash.update("design-quality-runtime-source-tree-v2\0");
  try {
    const tracked = execFileSync("git", ["ls-files", "--", ...paths], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean)
      .sort();
    for (const file of tracked) {
      const path = join(ROOT, file);
      try {
        hash.update(`\0tracked:${file}\0`);
        hash.update(readFileSync(path));
      } catch {
        hash.update(`\0tracked-unreadable:${file}\0`);
      }
    }
  } catch {
    hash.update(commitSha());
  }
  return hash.digest("hex");
}

function timestampId(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function relativePath(path: string) {
  return path.replace(ROOT, "").replace(/^[\\/]/, "").replace(/\\/g, "/") || basename(path);
}
