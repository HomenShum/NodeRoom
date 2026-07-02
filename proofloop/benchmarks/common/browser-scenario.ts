import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExternalBenchmarkAdapterId, ExternalBenchmarkLocalTask } from "./local-tasks";

type BrowserProblem = {
  type: string;
  text?: string;
  url?: string;
  status?: number;
};

export function defineExternalBenchmarkBrowserScenario(
  adapterId: ExternalBenchmarkAdapterId,
  tasks: ExternalBenchmarkLocalTask[],
): void {
  test.describe(`${adapterId} Proof Loop local adapter`, () => {
    test("runs app-agnostic local product-path proof without claiming official score", async ({ page }, testInfo) => {
      expect(tasks.length, `${adapterId} must expose at least one local task`).toBeGreaterThan(0);
      for (const task of tasks) {
        for (const inputRef of task.inputRefs) {
          expect(existsSync(inputRef), `${adapterId} input ref exists: ${inputRef}`).toBe(true);
        }
        expect(task.officialScoreClaim).toBe(false);
      }

      const pageErrors: BrowserProblem[] = [];
      const consoleProblems: BrowserProblem[] = [];
      const requestFailures: BrowserProblem[] = [];
      const badResponses: BrowserProblem[] = [];

      page.on("pageerror", (error) => pageErrors.push({ type: "pageerror", text: error.message }));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type())) {
          consoleProblems.push({ type: message.type(), text: message.text() });
        }
      });
      page.on("requestfailed", (request) => {
        requestFailures.push({ type: "requestfailed", url: request.url(), text: request.failure()?.errorText ?? "unknown" });
      });
      page.on("response", (response) => {
        if (response.status() >= 400) badResponses.push({ type: "response", url: response.url(), status: response.status() });
      });

      const task = tasks[0];
      await driveStoryRoute(page, task.userPrompt);

      const outputDir = proofOutputDir(adapterId);
      const visualProofPath = join(outputDir, "visual-proof.png");
      await page.screenshot({ path: visualProofPath, fullPage: false });
      await testInfo.attach(`${adapterId}-visual-proof`, { path: visualProofPath, contentType: "image/png" });

      const proof = {
        schema: "proofloop-external-browser-proof-v1",
        adapterId,
        taskId: task.taskId,
        generatedAt: new Date().toISOString(),
        url: page.url(),
        title: await page.title(),
        localAdapterOnly: true,
        officialScoreClaim: false,
        visibleSignals: {
          variance: await page.getByTestId("story-variance-cell").textContent(),
          demoVisible: await page.getByLabel("Interactive story demo").isVisible(),
          computedVisible: await page.getByText("Computed D2 = C2 - B2 = 3,250.").isVisible(),
          finalVisible: await page.getByText(/kept the human C2 edit/i).isVisible(),
        },
        pageErrors,
        consoleProblems,
        requestFailures,
        badResponses,
        evidence: {
          visualProofPath,
          taskManifestPath: join(outputDir, "local-task-manifest.json"),
        },
      };

      writeJson(join(outputDir, "local-task-manifest.json"), { adapterId, tasks });
      writeJson(join(outputDir, "browser-proof.json"), proof);

      expect(proof.visibleSignals).toEqual({
        variance: "3,250",
        demoVisible: true,
        computedVisible: true,
        finalVisible: true,
      });
      expect(pageErrors).toEqual([]);
      expect(consoleProblems).toEqual([]);
      expect(requestFailures).toEqual([]);
      expect(badResponses).toEqual([]);
    });
  });
}

async function driveStoryRoute(page: Page, prompt: string): Promise<void> {
  await page.goto("/#story", { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.getByLabel("Q3 revenue cell C2").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel("Q3 revenue cell C2").fill("13,250");
  await page.getByLabel("Story agent prompt").fill(prompt);
  await page.getByTestId("story-agent-send").click();
  await page.getByText("Computed D2 = C2 - B2 = 3,250.").waitFor({ state: "visible", timeout: 15_000 });
}

function proofOutputDir(adapterId: ExternalBenchmarkAdapterId): string {
  const runId = process.env.PROOFLOOP_RUN_ID ?? "latest";
  const dir = process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", runId, "external-adapter", adapterId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
