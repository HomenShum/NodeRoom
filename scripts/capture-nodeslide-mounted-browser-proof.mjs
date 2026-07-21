import { chromium } from "@playwright/test";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.NODEROOM_PROOF_URL ?? "http://127.0.0.1:5317";
const outputRoot = resolve(process.argv[2] ?? "artifacts/nodeslide-mounted-browser-proof");
const docsRoot = resolve("docs/demo");
const screenshotPath = resolve(docsRoot, "nodeslide-i7-mounted-browser.png");
const videoPath = resolve(docsRoot, "nodeslide-i7-mounted-browser.webm");
const pptxPath = resolve(docsRoot, "nodeslide-i7-mounted-browser.pptx");
const receiptPath = resolve(docsRoot, "nodeslide-i7-mounted-browser.receipt.json");

await mkdir(outputRoot, { recursive: true });
await mkdir(docsRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1500, height: 960 },
  acceptDownloads: true,
  recordVideo: { dir: outputRoot, size: { width: 1500, height: 960 } },
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

const checks = {};
const recordedVideo = page.video();
let recordedVideoPath;

try {
  await page.addInitScript(() => {
    localStorage.setItem("noderoom:tour:v1", "done");
    localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: false, paused: false }));
  });
  await page.goto(`${baseUrl}/?mode=memory&surface=desktop`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByTestId("start-demo-room").click();
  await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("work-artifacts-tab").waitFor({ state: "visible" });
  await page.getByTestId("work-artifacts-tab").dispatchEvent("click");

  const panel = page.getByTestId("work-artifacts-panel");
  await panel.waitFor({ state: "visible" });
  const deckRow = panel.locator('[data-testid="work-artifact-row"][data-kind="deck"]').first();
  await deckRow.locator("button").first().click();

  const workbench = page.getByTestId("deck-storyboard-workbench");
  await workbench.waitFor({ state: "visible" });
  const title = workbench.getByTestId("deck-collaborative-editor").getByLabel("Title");
  await title.fill(`${await title.inputValue()} — I7 browser proof`);
  await workbench.getByTestId("deck-collaborative-save").click();

  const mount = page.getByLabel("NodeSlide studio mounted in NodeRoom");
  await mount.waitFor({ state: "visible" });
  checks.collaborativeDeckCreated = true;
  checks.mountVisible = true;
  checks.packageVersion = await mount.getAttribute("data-nodeslide-package-version");
  checks.authority = await mount.getAttribute("data-nodeslide-authority");
  checks.surface = await mount.getAttribute("data-nodeslide-surface");
  checks.versionBadge = await mount.getByText("NodeSlide 0.2.2 controlled boundary").isVisible();
  checks.patchActionEnabled = await mount.getByRole("button", { name: "Apply title through NodeSlide" }).isEnabled();
  checks.proposalActionEnabled = await mount.getByRole("button", { name: "Propose purpose for review" }).isEnabled();

  const titleCommand = mount.getByTestId("nodeslide-mounted-title");
  await titleCommand.focus();
  checks.keyboardFocusVisible = await titleCommand.evaluate((element) => document.activeElement === element);
  await page.keyboard.press("Tab");
  checks.keyboardReachesPatchAction = await mount.getByRole("button", { name: "Apply title through NodeSlide" }).evaluate(
    (element) => document.activeElement === element,
  );

  const accessibility = await mount.evaluate((root) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const name = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        if (text) return text;
      }
      const explicitLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
      const wrappingLabel = element.closest("label");
      return (
        element.getAttribute("aria-label")
        || explicitLabel?.textContent
        || wrappingLabel?.textContent
        || element.getAttribute("title")
        || element.textContent
        || ""
      ).trim();
    };
    const interactive = [...root.querySelectorAll("button, input, textarea, select, a[href]")].filter(visible);
    const unnamed = interactive.filter((element) => !name(element)).map((element) => element.outerHTML.slice(0, 180));
    const imagesWithoutAlt = [...root.querySelectorAll("img")].filter((image) => !image.hasAttribute("alt")).length;
    return { interactiveCount: interactive.length, unnamedInteractive: unnamed, imagesWithoutAlt };
  });
  checks.accessibility = accessibility;

  const cdp = await context.newCDPSession(page);
  const axTree = await cdp.send("Accessibility.getFullAXTree");
  checks.accessibilityTreeHasMount = axTree.nodes.some((node) => node.name?.value === "NodeSlide studio mounted in NodeRoom");

  const downloadPromise = page.waitForEvent("download");
  await workbench.getByTestId("deck-preview-export-pptx").click();
  const download = await downloadPromise;
  await download.saveAs(pptxPath);
  const pptx = await readFile(pptxPath);
  checks.pptxZipSignature = pptx.subarray(0, 2).toString() === "PK";
  checks.pptxBytes = pptx.byteLength;

  await mount.getByTestId("nodeslide-mounted-actions").scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  checks.consoleErrors = consoleErrors;
  checks.pageErrors = pageErrors;

  const failures = [
    checks.packageVersion !== "0.2.2" && "mounted package version is not 0.2.2",
    checks.authority !== "noderoom-artifact-cas" && "mounted authority is not NodeRoom CAS",
    !checks.versionBadge && "visible mounted version badge is absent",
    !checks.patchActionEnabled && "host patch action is disabled",
    !checks.proposalActionEnabled && "proposal action is disabled",
    !checks.keyboardFocusVisible && "mounted title command cannot receive keyboard focus",
    !checks.keyboardReachesPatchAction && "tab order does not reach the mounted patch action",
    accessibility.unnamedInteractive.length > 0 && "mounted surface has unnamed interactive controls",
    accessibility.imagesWithoutAlt > 0 && "mounted surface has images without alt text",
    !checks.accessibilityTreeHasMount && "browser accessibility tree omits the mounted studio label",
    !checks.pptxZipSignature && "PPTX export is not a ZIP package",
    consoleErrors.length > 0 && "browser console emitted errors",
    pageErrors.length > 0 && "page emitted uncaught errors",
  ].filter(Boolean);

  const receipt = {
    schemaVersion: "noderoom.nodeslide-mounted-browser-proof/v1",
    capturedAt: new Date().toISOString(),
    source: { baseUrl, mode: "memory", browser: "chromium" },
    journey: ["enter demo room", "open work artifacts", "open deck", "make collaborative deck live", "observe literal NodeSlide mount", "keyboard/a11y observation", "export PPTX"],
    checks,
    artifacts: {
      screenshot: "docs/demo/nodeslide-i7-mounted-browser.png",
      video: "docs/demo/nodeslide-i7-mounted-browser.webm",
      pptx: "docs/demo/nodeslide-i7-mounted-browser.pptx",
    },
    status: failures.length === 0 ? "passed" : "failed",
    failures,
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (failures.length > 0) throw new Error(`Mounted browser proof failed: ${failures.join("; ")}`);
} finally {
  await context.close();
  recordedVideoPath = await recordedVideo?.path().catch(() => undefined);
  await browser.close();
}

if (recordedVideoPath) {
  await rm(videoPath, { force: true });
  try {
    await rename(recordedVideoPath, videoPath);
  } catch {
    await copyFile(recordedVideoPath, videoPath);
  }
}

const [screenshot, video, pptx] = await Promise.all([stat(screenshotPath), stat(videoPath), stat(pptxPath)]);
console.log(JSON.stringify({ status: "passed", receiptPath, screenshotBytes: screenshot.size, videoBytes: video.size, pptxBytes: pptx.size }, null, 2));
