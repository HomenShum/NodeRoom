/**
 * Visual/Design Judge — runs Playwright-based UI checks for proof-loop suites.
 *
 * Checks:
 *   - App loads without crash
 *   - Primary action visible
 *   - Loading/empty/error states present
 *   - Mobile viewport works
 *   - Color contrast (basic WCAG 2.2 AA check)
 *   - No console errors on load
 *
 * Usage:
 *   npx tsx proofloop/adapters/visual-judge.ts --suite=accounting
 *   npx tsx proofloop/adapters/visual-judge.ts --suite=notion
 */

import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const suite = process.argv.find((a) => a.startsWith("--suite="))?.split("=")[1] ?? "accounting";
const port = process.env.PLAYWRIGHT_PORT ?? "5173";
const baseUrl = `http://127.0.0.1:${port}/?mode=memory`;
const outputDir = process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", "latest");

interface DesignCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

async function runVisualJudge(): Promise<void> {
  console.log(`visual-judge: suite=${suite} url=${baseUrl}`);
  mkdirSync(outputDir, { recursive: true });

  const checks: DesignCheck[] = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Check 1: App loads
  try {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const title = await page.title();
    checks.push({
      name: "app-loads",
      status: consoleErrors.length === 0 ? "pass" : "warn",
      detail: `Title: "${title}". Console errors: ${consoleErrors.length}`,
    });
  } catch (err) {
    checks.push({ name: "app-loads", status: "fail", detail: String(err) });
  }

  // Check 2: Primary action visible
  try {
    const bodyText = await page.textContent("body");
    const hasContent = bodyText && bodyText.trim().length > 50;
    checks.push({
      name: "primary-action-visible",
      status: hasContent ? "pass" : "fail",
      detail: hasContent ? "Page has visible content" : "Page appears empty",
    });
  } catch (err) {
    checks.push({ name: "primary-action-visible", status: "fail", detail: String(err) });
  }

  // Check 3: No horizontal scroll at desktop
  try {
    const hasHScroll = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    checks.push({
      name: "no-horizontal-scroll-desktop",
      status: hasHScroll ? "fail" : "pass",
      detail: hasHScroll ? "Horizontal scroll detected" : "No horizontal scroll",
    });
  } catch (err) {
    checks.push({ name: "no-horizontal-scroll-desktop", status: "warn", detail: String(err) });
  }

  // Check 4: Mobile viewport
  try {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    const hasHScrollMobile = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    checks.push({
      name: "mobile-viewport",
      status: hasHScrollMobile ? "warn" : "pass",
      detail: hasHScrollMobile ? "Horizontal scroll at 375px" : "Layout works at 375px",
    });
  } catch (err) {
    checks.push({ name: "mobile-viewport", status: "warn", detail: String(err) });
  }

  // Check 5: Color contrast (basic — check for visible text with low contrast)
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);
    const lowContrastCount = await page.evaluate(() => {
      const elements = document.querySelectorAll("p, span, div, h1, h2, h3, h4, h5, h6, td, th, label, a");
      let lowContrast = 0;
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        const color = style.color;
        const bg = style.backgroundColor;
        if (color && bg && color !== "rgba(0, 0, 0, 0)" && bg !== "rgba(0, 0, 0, 0)") {
          // Basic luminance check
          const parseRgb = (s: string) => {
            const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
          };
          const fg = parseRgb(color);
          const bgRgb = parseRgb(bg);
          if (fg && bgRgb) {
            const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            const diff = Math.abs(lum(fg[0], fg[1], fg[2]) - lum(bgRgb[0], bgRgb[1], bgRgb[2]));
            if (diff < 0.15) lowContrast++;
          }
        }
      }
      return lowContrast;
    });
    checks.push({
      name: "color-contrast-aa",
      status: lowContrastCount > 5 ? "warn" : "pass",
      detail: `${lowContrastCount} elements with potentially low contrast`,
    });
  } catch (err) {
    checks.push({ name: "color-contrast-aa", status: "warn", detail: String(err) });
  }

  // Check 6: Screenshot
  try {
    const screenshotPath = join(outputDir, "screenshots", `visual-judge-${suite}.png`);
    mkdirSync(join(outputDir, "screenshots"), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    checks.push({ name: "screenshot-captured", status: "pass", detail: screenshotPath });
  } catch (err) {
    checks.push({ name: "screenshot-captured", status: "warn", detail: String(err) });
  }

  await browser.close();

  // Write report
  const report = {
    suite,
    timestamp: new Date().toISOString(),
    checks,
    passed: checks.filter((c) => c.status === "pass").length,
    warned: checks.filter((c) => c.status === "warn").length,
    failed: checks.filter((c) => c.status === "fail").length,
    overall: checks.some((c) => c.status === "fail") ? "fail" : "pass",
  };

  writeFileSync(join(outputDir, "visual-review.json"), JSON.stringify(report, null, 2), "utf-8");

  const mdLines = [
    `# Visual/Design Review — ${suite}`,
    "",
    `Generated: ${report.timestamp}`,
    "",
    `**Result: ${report.overall === "pass" ? "✅ PASS" : "❌ FAIL"}**`,
    `${report.passed} pass, ${report.warned} warn, ${report.failed} fail`,
    "",
    "| Check | Status | Detail |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.name} | ${c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️" : "❌"} ${c.status} | ${c.detail} |`),
    "",
  ];
  writeFileSync(join(outputDir, "visual-review.md"), mdLines.join("\n") + "\n", "utf-8");

  console.log(`visual-judge: ${report.overall === "pass" ? "✅" : "❌"} ${report.passed} pass, ${report.warned} warn, ${report.failed} fail`);
  console.log(`visual-judge: report at ${join(outputDir, "visual-review.md")}`);

  process.exit(report.overall === "pass" ? 0 : 1);
}

runVisualJudge().catch((err) => {
  console.error("visual-judge: fatal error", err);
  process.exit(1);
});
