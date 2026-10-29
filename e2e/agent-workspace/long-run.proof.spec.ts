/**
 * Long-run product proof for the Node agent workspace.
 *
 * Starts in the real composer on the normal #workspace route, against a real
 * worker and a real engine. Nothing is preloaded: the spec creates a fresh
 * project from the template, sends the template's suggested task, and only
 * observes. It records raw video + a Playwright trace, takes a screenshot the
 * first time each milestone appears in the DOM, exercises reload recovery and
 * interrupt -> resume at a safe boundary, then runs the follow-up task that must
 * reuse the skill the first task created. Milestones that never happen are
 * written down as not observed; they are not faked and not asserted away.
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve(process.env.AGENT_PROOF_OUT?.trim() || "evidence/agent-workspace-20261029/run");
const ENGINE = process.env.AGENT_PROOF_ENGINE?.trim() || "claude-agent-sdk";
const MODEL = process.env.AGENT_PROOF_MODEL?.trim() || "";
const TEMPLATE = process.env.AGENT_PROOF_TEMPLATE?.trim() || "diligence-pack";
const FIRST_TASK = process.env.AGENT_PROOF_FIRST_TASK?.trim() || "full-diligence";
const SECOND_TASK = process.env.AGENT_PROOF_SECOND_TASK?.trim() || "inbox-update";
const MAX_MINUTES = Number(process.env.AGENT_PROOF_MAX_MIN || 120);
const DO_INTERRUPT = process.env.AGENT_PROOF_INTERRUPT !== "0";
const DO_SECOND = process.env.AGENT_PROOF_SECOND !== "0";
const API = "/agent-api/api";

type Milestone = { name: string; at: string; videoOffsetSec: number; runId?: string; detail: string; screenshot?: string };
type RunRecord = {
  id: string;
  status: string;
  projectId: string;
  relation?: string;
  parentRunId?: string;
  counters: Record<string, number>;
  verification?: { passed: number; failed: number };
  usage?: { costUsd: number | null };
};

const milestones: Milestone[] = [];
let recordingStartedAt = 0;
let shotIndex = 0;

function offset(): number {
  return Math.round((Date.now() - recordingStartedAt) / 100) / 10;
}

async function shot(page: Page, name: string): Promise<string> {
  const file = `${String(++shotIndex).padStart(2, "0")}-${name}.png`;
  mkdirSync(join(OUT, "screenshots"), { recursive: true });
  await page.screenshot({ path: join(OUT, "screenshots", file) });
  return `screenshots/${file}`;
}

async function milestone(page: Page, name: string, detail: string, runId?: string): Promise<void> {
  if (milestones.some((m) => m.name === name)) return;
  const at = new Date().toISOString();
  const videoOffsetSec = offset();
  const screenshot = await shot(page, name);
  milestones.push({ name, at, videoOffsetSec, runId, detail, screenshot });
  console.log(`[milestone ${videoOffsetSec}s] ${name}: ${detail}`);
}

async function api<T>(request: APIRequestContext, path: string, init?: { method?: string; data?: unknown }): Promise<T> {
  const res = init?.method === "POST" ? await request.post(`${API}${path}`, { data: init.data ?? {} }) : await request.get(`${API}${path}`);
  if (!res.ok()) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function count(page: Page, selector: string): Promise<number> {
  return page.locator(selector).count();
}

async function exportRun(request: APIRequestContext, runId: string): Promise<number> {
  mkdirSync(join(OUT, "events"), { recursive: true });
  mkdirSync(join(OUT, "runs"), { recursive: true });
  const lines: string[] = [];
  let after = 0;
  for (;;) {
    const page = await api<Array<{ seq: number }>>(request, `/runs/${runId}/events.json?after=${after}&limit=1000`);
    if (page.length === 0) break;
    for (const e of page) lines.push(JSON.stringify(e));
    after = page[page.length - 1].seq;
    if (page.length < 1000) break;
  }
  writeFileSync(join(OUT, "events", `${runId}.jsonl`), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "runs", `${runId}.json`), JSON.stringify(await api(request, `/runs/${runId}`), null, 2));
  return lines.length;
}

/** Drive one task from the composer to a terminal status, recording milestones. */
async function driveTask(page: Page, request: APIRequestContext, projectId: string, taskId: string, label: string, allowInterrupt: boolean): Promise<string[]> {
  const before = await api<RunRecord[]>(request, `/runs?projectId=${projectId}`);
  const chip = page.getByTestId("naw-suggested-task").filter({ hasText: new RegExp(taskId.replace(/-/g, "[- ]"), "i") });
  if ((await chip.count()) > 0) await chip.first().click();
  else await page.getByTestId("naw-suggested-task").nth(taskId === FIRST_TASK ? 0 : 1).click();
  await expect(page.getByTestId("naw-composer")).not.toHaveValue("");
  await milestone(page, `${label}-task-entered`, `suggested task "${taskId}" placed in the composer`);
  await page.getByTestId("naw-send").click();

  let runId = "";
  await expect
    .poll(async () => {
      const runs = await api<RunRecord[]>(request, `/runs?projectId=${projectId}`);
      const fresh = runs.find((r) => !before.some((b) => b.id === r.id));
      runId = fresh?.id ?? "";
      return runId;
    }, { timeout: 60_000 })
    .not.toBe("");
  const runIds = [runId];
  await milestone(page, `${label}-run-accepted`, `run ${runId} persisted by the worker`, runId);

  const deadline = Date.now() + MAX_MINUTES * 60_000;
  let reloaded = false;
  let interrupted = !allowInterrupt;
  let lastPeriodic = Date.now();
  for (;;) {
    const run = await api<RunRecord>(request, `/runs/${runId}`);
    const helpersRunning = await count(page, '[data-testid="naw-helper-item"][data-status="running"]');
    const helpersTotal = await count(page, '[data-testid="naw-helper-item"]');
    if (helpersTotal > 0) await milestone(page, `${label}-first-helper`, `${helpersTotal} helper(s) visible`, runId);
    if (helpersRunning >= 2) await milestone(page, `${label}-helpers-overlap`, `${helpersRunning} helpers running at once`, runId);
    if ((await count(page, '[data-testid="naw-tool-search-card"]')) > 0) await milestone(page, `${label}-tool-search`, "a tool was found by search", runId);
    if ((await count(page, '[data-testid="naw-tool-loaded"]')) > 0) await milestone(page, `${label}-tool-loaded`, "a searched tool became callable", runId);
    if ((await count(page, '[data-testid="naw-skill-card"]')) > 0) await milestone(page, `${label}-skill-used`, "a skill card appeared", runId);
    for (const stage of ["drafted", "validated", "tested", "activated"]) {
      if ((await count(page, `[data-testid="naw-skill-card"][data-stage="${stage}"]`)) > 0) await milestone(page, `${label}-skill-${stage}`, `skill lifecycle stage ${stage}`, runId);
    }
    if ((await count(page, '[data-testid="naw-skill-card"][data-skill="citation-validation"]')) > 0) await milestone(page, `${label}-citation-skill-card`, "citation-validation skill card visible", runId);
    if ((await count(page, '[data-testid="naw-compaction-marker"]')) > 0) await milestone(page, `${label}-compaction`, "context compaction marker visible", runId);
    if ((await count(page, '[data-testid="naw-goal-item"]')) > 0) await milestone(page, `${label}-goals`, "goal outline visible", runId);
    if ((await count(page, '[data-testid="naw-artifact-item"]')) > 0) await milestone(page, `${label}-first-artifact`, "first artifact listed", runId);
    if ((await count(page, '[data-testid="naw-check-item"]')) > 0) await milestone(page, `${label}-first-check`, "first check result visible", runId);
    if ((await count(page, '[data-testid="naw-permission-denial"]')) > 0) await milestone(page, `${label}-permission-denial`, "a native tool call was denied by Node policy", runId);

    // Reload recovery: the server job must not depend on this tab.
    if (!reloaded && (run.counters?.helpersStarted ?? 0) > 0 && (run.counters?.toolCalls ?? 0) >= 20) {
      const toolCallsBefore = run.counters.toolCalls;
      await milestone(page, `${label}-before-reload`, `reloading the tab at ${toolCallsBefore} tool calls`, runId);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("naw-root")).toBeVisible();
      const item = page.locator(`[data-testid="naw-run-item"][data-run-id="${runId}"]`);
      if (await item.count()) await item.first().click();
      await expect(page.getByTestId("naw-timeline")).toBeVisible({ timeout: 60_000 });
      const after = await api<RunRecord>(request, `/runs/${runId}`);
      expect(after.counters.toolCalls).toBeGreaterThanOrEqual(toolCallsBefore);
      await milestone(page, `${label}-after-reload`, `restored from the worker; run still ${after.status} with ${after.counters.toolCalls} tool calls`, runId);
      reloaded = true;
    }

    // Interrupt at a safe boundary (the comparison table exists), then resume natively.
    if (!interrupted && run.status === "running") {
      const files = await api<Array<{ path: string }>>(request, `/projects/${projectId}/files`).catch(() => []);
      if (files.some((f) => f.path === "analysis/comparison.json")) {
        await milestone(page, `${label}-before-interrupt`, "comparison.json exists; stopping the run", runId);
        await page.getByTestId("naw-stop").click();
        await expect.poll(async () => (await api<RunRecord>(request, `/runs/${runId}`)).status, { timeout: 120_000 }).toBe("interrupted");
        await milestone(page, `${label}-interrupted`, "run interrupted by the user", runId);
        const runsBefore = await api<RunRecord[]>(request, `/runs?projectId=${projectId}`);
        await page.getByTestId("naw-resume").click();
        let resumedId = "";
        await expect
          .poll(async () => {
            const runs = await api<RunRecord[]>(request, `/runs?projectId=${projectId}`);
            resumedId = runs.find((r) => !runsBefore.some((b) => b.id === r.id) && r.relation === "resume")?.id ?? "";
            return resumedId;
          }, { timeout: 60_000 })
          .not.toBe("");
        runId = resumedId;
        runIds.push(runId);
        await milestone(page, `${label}-resumed`, `resumed as ${runId} on the same native session`, runId);
        interrupted = true;
        continue;
      }
    }

    if (run.status === "completed" || run.status === "failed" || run.status === "interrupted") {
      await milestone(page, `${label}-terminal-${run.status}`, `run ${runId} ended ${run.status}`, runId);
      break;
    }
    if (Date.now() > deadline) {
      await milestone(page, `${label}-deadline`, `proof deadline of ${MAX_MINUTES} min reached; run still ${run.status}`, runId);
      break;
    }
    if (Date.now() - lastPeriodic > 180_000) {
      await shot(page, `${label}-progress-${Math.round(offset())}s`);
      lastPeriodic = Date.now();
    }
    await page.waitForTimeout(5_000);
  }

  // Independent verification runs after the engine stops; give it time.
  await expect
    .poll(async () => Boolean((await api<RunRecord>(request, `/runs/${runId}`)).verification), { timeout: 300_000 })
    .toBe(true)
    .catch(() => undefined);
  const final = await api<RunRecord>(request, `/runs/${runId}`);
  if (final.verification) {
    await page.getByTestId("naw-verification").scrollIntoViewIfNeeded().catch(() => undefined);
    await milestone(page, `${label}-verified`, `independent verifier: ${final.verification.passed} passed, ${final.verification.failed} failed`, runId);
  }
  return runIds;
}

test("agent workspace long-run proof", async ({ browser, request }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: join(OUT, "video-raw"), size: { width: 1440, height: 900 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: false, title: "agent workspace long-run proof" });
  const page = await context.newPage();
  recordingStartedAt = Date.now();
  const allRuns: string[] = [];
  try {
    await page.goto("/#workspace", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("naw-root")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("naw-unavailable")).toHaveCount(0);
    await milestone(page, "workspace-open", "normal #workspace route, worker reachable");

    const projectsBefore = await api<Array<{ id: string }>>(request, "/projects");
    await page.getByTestId("naw-template-select").selectOption(TEMPLATE).catch(async () => {
      await page.getByTestId("naw-template-select").click();
      await page.getByRole("option", { name: new RegExp(TEMPLATE, "i") }).click();
    });
    await page.getByTestId("naw-new-project").click();
    let projectId = "";
    await expect
      .poll(async () => {
        const projects = await api<Array<{ id: string }>>(request, "/projects");
        projectId = projects.find((p) => !projectsBefore.some((b) => b.id === p.id))?.id ?? "";
        return projectId;
      }, { timeout: 60_000 })
      .not.toBe("");
    await milestone(page, "project-created", `fresh project ${projectId} from template ${TEMPLATE}`);
    const project = (await api<Array<{ id: string }>>(request, "/projects")).find((p) => p.id === projectId);
    writeFileSync(join(OUT, "project.json"), JSON.stringify(project, null, 2));

    await page.getByTestId("naw-engine-select").selectOption(ENGINE);
    await expect(page.getByTestId("naw-setup-required")).toHaveCount(0);
    if (MODEL) await page.getByTestId("naw-model-input").fill(MODEL);

    allRuns.push(...(await driveTask(page, request, projectId, FIRST_TASK, "task1", DO_INTERRUPT)));

    // Final inspection screenshots of the finished first task.
    await shot(page, "task1-final-overview");
    const table = page.locator('[data-testid="naw-artifact-item"][data-path="analysis/comparison.md"]');
    if (await table.count()) {
      await table.first().click();
      await expect(page.getByTestId("naw-artifact-viewer")).toBeVisible();
      await shot(page, "task1-artifact-comparison-table");
    }
    const notebook = page.locator('[data-testid="naw-artifact-item"][data-kind="notebook"]');
    if (await notebook.count()) {
      await notebook.first().click();
      await shot(page, "task1-artifact-notebook");
    }
    await page.getByTestId("naw-dev-toggle").click();
    await expect(page.getByTestId("naw-dev-drawer")).toBeVisible();
    await shot(page, "task1-developer-drawer");
    await page.getByTestId("naw-dev-toggle").click();

    if (DO_SECOND) {
      allRuns.push(...(await driveTask(page, request, projectId, SECOND_TASK, "task2", false)));
      await shot(page, "task2-final-overview");
    }
  } finally {
    const exported: Record<string, number> = {};
    for (const runId of allRuns) exported[runId] = await exportRun(request, runId).catch(() => -1);
    await context.tracing.stop({ path: join(OUT, "trace.zip") });
    const video = page.video();
    await context.close();
    const videoPath = video ? await video.path() : null;
    if (videoPath) copyFileSync(videoPath, join(OUT, "raw-recording.webm"));
    writeFileSync(
      join(OUT, "recording.json"),
      JSON.stringify(
        {
          schema: "nodeagent.proof-recording/v1",
          recordingStartedAt: new Date(recordingStartedAt).toISOString(),
          endedAt: new Date().toISOString(),
          engine: ENGINE,
          model: MODEL || "(engine default)",
          template: TEMPLATE,
          tasks: [FIRST_TASK, DO_SECOND ? SECOND_TASK : null].filter(Boolean),
          runs: allRuns,
          exportedEventCounts: exported,
          video: "raw-recording.webm",
          trace: "trace.zip",
          speed: "original (unedited, 1x)",
          milestones,
        },
        null,
        2,
      ),
    );
  }
});
