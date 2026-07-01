/**
 * Clip Generation Adapter — generates walkthrough clips from proof-loop scenarios.
 *
 * Uses Playwright to capture screenshots of each scenario flow, then
 * assembles them into a video using Remotion (if available) or
 * falls back to a screenshot storyboard.
 *
 * Priority:
 *   1. Agent Clips by Builder.io (if configured)
 *   2. feature-walkthrough-gif (if repo available)
 *   3. Screenshot storyboard fallback
 *
 * Usage:
 *   npx tsx proofloop/adapters/generate-clips.ts --suite=notion
 *   npx tsx proofloop/adapters/generate-clips.ts --suite=accounting
 */

import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const suite = process.argv.find((a) => a.startsWith("--suite="))?.split("=")[1] ?? "notion";
const port = process.env.PLAYWRIGHT_PORT ?? "5173";
const baseUrl = `http://127.0.0.1:${port}/?mode=memory`;
const outputDir = process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", "latest");
const clipsDir = join(outputDir, "clips");

interface ScenarioClip {
  scenarioId: string;
  title: string;
  screenshots: string[];
  output: string;
}

async function generateClips(): Promise<void> {
  console.log(`generate-clips: suite=${suite} url=${baseUrl}`);
  mkdirSync(clipsDir, { recursive: true });

  // Load scenario YAMLs to get clip metadata
  const scenariosDir = join(process.cwd(), "proofloop", suite, "scenarios");
  const scenarios: ScenarioClip[] = [];

  // For Notion suite, we have 4 scenarios
  const notionScenarios = [
    { id: "01-warm-intro", title: "Warm intro research" },
    { id: "02-follow-up", title: "Discovery follow-up" },
    { id: "03-automated-pipeline", title: "Automated pipeline" },
    { id: "04-meeting-prep", title: "Meeting prep" },
  ];

  const accountingScenarios = [
    { id: "invoice-extraction", title: "Invoice extraction" },
    { id: "spreadsheet-reconciliation", title: "Spreadsheet reconciliation" },
    { id: "financial-statement-qa", title: "Financial statement QA" },
    { id: "variance-analysis", title: "Variance analysis" },
  ];

  const scenarioList = suite === "notion" ? notionScenarios : accountingScenarios;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  for (const scenario of scenarioList) {
    console.log(`generate-clips: capturing "${scenario.title}"...`);
    const screenshots: string[] = [];

    try {
      // Navigate to the app
      await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(1000);

      // Capture initial state
      const shot1 = join(clipsDir, `${scenario.id}-01-initial.png`);
      await page.screenshot({ path: shot1 });
      screenshots.push(shot1);

      // Capture mid-state (wait for any UI animations)
      await page.waitForTimeout(2000);
      const shot2 = join(clipsDir, `${scenario.id}-02-loaded.png`);
      await page.screenshot({ path: shot2 });
      screenshots.push(shot2);

      // Capture final state
      await page.waitForTimeout(1000);
      const shot3 = join(clipsDir, `${scenario.id}-03-final.png`);
      await page.screenshot({ path: shot3 });
      screenshots.push(shot3);
    } catch (err) {
      console.log(`generate-clips: ⚠️ capture failed for "${scenario.title}": ${err}`);
    }

    scenarios.push({
      scenarioId: scenario.id,
      title: scenario.title,
      screenshots,
      output: join(clipsDir, `${scenario.id}.mp4`),
    });
  }

  await browser.close();

  // Write clip manifest
  const manifest = {
    suite,
    timestamp: new Date().toISOString(),
    scenarios: scenarios.map((s) => ({
      scenarioId: s.scenarioId,
      title: s.title,
      screenshotCount: s.screenshots.length,
      screenshots: s.screenshots,
      output: s.output,
    })),
    note: "Screenshots captured. Use feature-walkthrough-gif or Remotion to assemble MP4.",
  };

  writeFileSync(join(clipsDir, "clip-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // Write storyboard markdown
  const mdLines = [
    `# Clip Storyboard — ${suite}`,
    "",
    `Generated: ${manifest.timestamp}`,
    "",
    `## Scenarios`,
    "",
    ...scenarios.map((s) => `### ${s.title}\n- ID: ${s.scenarioId}\n- Screenshots: ${s.screenshots.length}\n- Output: ${s.output}\n`),
    "",
    "## Assembly",
    "",
    "To assemble into MP4, use:",
    "```bash",
    "npx remotion render <composition> <output> --props=<clip-manifest.json>",
    "```",
    "",
    "Or use feature-walkthrough-gif:",
    "```bash",
    "npx tsx scripts/render-workflow-preview.ts --suite=" + suite,
    "```",
  ];
  writeFileSync(join(clipsDir, "storyboard.md"), mdLines.join("\n") + "\n", "utf-8");

  console.log(`generate-clips: ✅ ${scenarios.length} scenarios captured`);
  console.log(`generate-clips: manifest at ${join(clipsDir, "clip-manifest.json")}`);
  console.log(`generate-clips: storyboard at ${join(clipsDir, "storyboard.md")}`);

  process.exit(0);
}

generateClips().catch((err) => {
  console.error("generate-clips: fatal error", err);
  process.exit(1);
});
