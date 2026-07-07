import "./benchmark/loadEnv";
import { chromium, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type RectSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
  display: string;
  borderRadius: string;
  color: string;
  backgroundColor: string;
  className: string;
} | null;

type LiveChecks = {
  classCounts: Record<string, number>;
  surfaces: Record<string, RectSnapshot>;
  counts: Record<string, number>;
  textSignals: Record<string, boolean>;
  geometryFailures: string[];
};

type ComponentCheck = {
  id: string;
  contractClasses: string[];
  selectors: string[];
  required: boolean;
  present: boolean;
  classCounts: Record<string, number>;
};

const runId = process.env.PROOFLOOP_RUN_ID ?? `design-room-contract-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
const outDir = resolve(process.env.PROOFLOOP_DESIGN_ROOM_CONTRACT_ROOT ?? `.proofloop/runs/${runId}/browser-receipts/design-room-ui-contract`);
const contractPath = resolve(process.env.NODEAGENT_ROOM_UI_CONTRACT ?? "C:/Users/hshum/Downloads/NodeRoom Web - Room UI Contract (standalone).html");
const viewport = {
  width: Number(process.env.PROOFLOOP_DESIGN_ROOM_CONTRACT_WIDTH ?? 1456),
  height: Number(process.env.PROOFLOOP_DESIGN_ROOM_CONTRACT_HEIGHT ?? 940),
};
const baseUrls = (process.env.PROOFLOOP_DESIGN_ROOM_CONTRACT_BASE_URLS ?? process.env.BENCH_BASE_URL ?? "http://127.0.0.1:5177,https://noderoom.live")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const componentContract = [
  { id: "topbar", required: true, contractClasses: ["fx-top", "fx-mark", "fx-invite", "fx-avs", "fx-live", "fx-iconbtn"] },
  { id: "binder", required: true, contractClasses: ["fx-side", "sc-search", "fx-item", "sc-sec", "fx-folder", "sc-count"] },
  { id: "centerTabs", required: true, contractClasses: ["fx-tabs", "fx-tab", "fx-shared"] },
  { id: "dataframeGrid", required: true, contractClasses: ["fx-sheet", "fx-shtool", "fx-shfoot", "fx-sel", "rm-cellin"] },
  { id: "publicChat", required: true, contractClasses: ["fx-chat", "fx-msg", "rm-chatin", "send", "fx-seg"] },
  { id: "pipelineStatus", required: true, contractClasses: ["fx-status", "fx-step"] },
  { id: "peoplePanel", required: true, contractClasses: ["sc-ppanel", "sc-prow", "sc-pst"] },
  { id: "statefulRowAffordances", required: false, contractClasses: ["fx-st", "fx-src", "fx-lock", "fx-owner", "rm-wet"] },
  { id: "statefulAgentRun", required: false, contractClasses: ["fx-cmd", "sc-run", "r-activity"] },
  { id: "centerViewStates", required: false, contractClasses: ["trc-row", "mw-note", "mw-btn", "rm-vhead", "rm-vback"] },
] as const;

const allContractClasses = [...new Set(componentContract.flatMap((component) => component.contractClasses))];
const expectedContractCards = [
  "Brand mark",
  "Room code pill",
  "Presence facepile + live",
  "Icon button",
  "Binder search",
  "Binder item",
  "Section / folder header",
  "Tab strip",
  "Status chips",
  "Row affordances",
  "Cell states",
  "Sheet toolbar + footer",
  "Message · command",
  "Agent run + edit receipt",
  "Composer + segmented",
  "Run pipeline",
  "Trace span row",
  "Memory Wall note",
  "In-view header",
  "Person row",
];

if (!existsSync(contractPath)) throw new Error(`Room UI contract file does not exist: ${contractPath}`);
mkdirSync(outDir, { recursive: true });

const contract = extractContract(contractPath);
const browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADLESS !== "0" });
const startedAt = new Date().toISOString();
const failures: string[] = [];

try {
  const contractScreenshotPath = join(outDir, "contract-component-inventory.png");
  await captureContractScreenshot(contractScreenshotPath);
  const captures = [];
  for (const baseUrl of baseUrls) {
    try {
      captures.push(await captureLiveRoom(baseUrl));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${labelForBaseUrl(baseUrl)}: ${message}`);
      captures.push({
        label: labelForBaseUrl(baseUrl),
        baseUrl,
        passed: false,
        failures: [message],
        error: message,
      });
    }
  }
  for (const capture of captures) {
    if ("passed" in capture && !capture.passed) failures.push(`${capture.label}: contract proof failed`);
  }
  const receipt = {
    schema: "noderoom-design-room-ui-contract-proof-v1",
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    passed: failures.length === 0,
    failures,
    methodology: "Extract component/state primitives from the standalone HTML room UI contract, then verify the real live room DOM after the normal create-room landing flow. This is not a whole-page pixel overlay.",
    contractPath,
    contractScreenshotPath,
    contract,
    viewport,
    componentContract,
    captures,
  };
  const receiptPath = join(outDir, "receipt.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`wrote ${receiptPath}`);
  for (const capture of captures) {
    console.log(`${capture.label}: passed=${capture.passed} failures=${capture.failures?.length ?? 0}`);
  }
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await browser.close();
}

function extractContract(path: string) {
  const raw = readFileSync(path, "utf8");
  const normalized = raw
    .replace(/\\u002F/g, "/")
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n");
  const classSet = new Set<string>();
  for (const match of normalized.matchAll(/\bclass=(["'])(.*?)\1/g)) {
    for (const cls of match[2].split(/\s+/).map((value) => value.trim()).filter(Boolean)) classSet.add(cls);
  }
  const headings = [...normalized.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)]
    .map((match) => stripHtml(match[1]).trim())
    .filter(Boolean);
  const requiredHeadings = [
    "Top bar",
    "Room Binder",
    "Center tabs",
    "Dataframe grid",
    "Public chat",
    "Pipeline status bar",
    "Center views",
    "People panel",
  ];
  const missingHeadings = requiredHeadings.filter((heading) => !headings.some((actual) => actual.toLowerCase().includes(heading.toLowerCase())));
  const missingClasses = allContractClasses.filter((cls) => !hasToken(normalized, cls));
  const cards = extractContractCards(normalized);
  const missingCards = expectedContractCards.filter((card) => !cards.some((actual) => actual.name.toLowerCase() === card.toLowerCase()));
  return {
    title: extractTitle(normalized),
    headings,
    requiredHeadings,
    missingHeadings,
    cards,
    expectedCards: expectedContractCards,
    missingCards,
    classCount: classSet.size,
    requiredClassCount: allContractClasses.length,
    missingClasses,
    requiredClasses: allContractClasses,
  };
}

async function captureContractScreenshot(path: string): Promise<void> {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto(pathToFileURL(contractPath).href, { waitUntil: "load", timeout: 60_000 });
    await page.screenshot({ path, fullPage: false, timeout: 30_000 });
  } finally {
    await page.close();
  }
}

async function captureLiveRoom(baseUrl: string) {
  const label = labelForBaseUrl(baseUrl);
  const page = await browser.newPage({ viewport });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("create-room").click({ timeout: 60_000 });
    await page.getByTestId("create-room-submit").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("create-room-submit").click();
    await page.waitForURL(/room=/, { timeout: 80_000 });
    await expectRoomReady(page);
    const observedClassCounts = await driveContractStates(page);
    await page.waitForTimeout(1_000);
    const roomCode = new URL(page.url()).searchParams.get("room") ?? "";
    const screenshotPath = join(outDir, `${label}-live-room-contract-state.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 30_000 });
    const live = await collectLiveChecks(page);
    for (const [cls, count] of Object.entries(observedClassCounts)) {
      live.classCounts[cls] = Math.max(live.classCounts[cls] ?? 0, count);
    }
    const componentChecks = buildComponentChecks(live);
    const captureFailures = [
      ...contract.missingHeadings.map((heading) => `contract heading missing: ${heading}`),
      ...contract.missingClasses.map((cls) => `contract class missing from HTML: ${cls}`),
      ...contract.missingCards.map((card) => `contract component card missing: ${card}`),
      ...componentChecks.filter((check) => check.required && !check.present).map((check) => `${check.id}: missing ${check.selectors.filter((selector) => (live.classCounts[selector.slice(1)] ?? 0) === 0).join(", ")}`),
      ...noiseFailures(live),
      ...live.geometryFailures,
    ];
    if (consoleErrors.length) captureFailures.push(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
    if (pageErrors.length) captureFailures.push(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
    return {
      label,
      baseUrl,
      roomCode,
      roomUrl: page.url(),
      screenshotPath,
      passed: captureFailures.length === 0,
      failures: captureFailures,
      componentChecks,
      observedClassCounts,
      live,
      consoleErrors,
      pageErrors,
    };
  } finally {
    await page.close();
  }
}

async function expectRoomReady(page: Page): Promise<void> {
  await page.getByTestId("public-chat-panel").waitFor({ state: "visible", timeout: 80_000 });
  await page.getByTestId("left-rail").waitFor({ state: "visible", timeout: 80_000 });
  await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 80_000 });
  await page.getByTestId("sheet-grid").waitFor({ state: "visible", timeout: 80_000 });
  await page.locator(".fx-top").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".fx-sheet").waitFor({ state: "visible", timeout: 30_000 });
}

async function driveContractStates(page: Page): Promise<Record<string, number>> {
  const observed: Record<string, number> = {};
  const observe = async () => {
    const counts = await countContractClasses(page);
    for (const [cls, count] of Object.entries(counts)) observed[cls] = Math.max(observed[cls] ?? 0, count);
  };
  await observe();

  await page.getByTestId("people-trigger").click({ timeout: 20_000 });
  await page.getByTestId("people-panel").waitFor({ state: "visible", timeout: 20_000 });
  await observe();

  const composer = page.getByTestId("public-chat-panel").getByTestId("chat-composer");
  await composer.fill(`Design contract verification ${runId}`);
  await page.getByTestId("public-chat-panel").getByTestId("chat-send").click();
  await page.getByTestId("public-chat-panel").getByTestId("chat-message").filter({ hasText: runId }).waitFor({ state: "visible", timeout: 20_000 });
  await observe();

  const firstCell = page.locator('[data-testid="sheet-cell"]').first();
  await firstCell.click({ timeout: 20_000 });
  await page.locator(".fx-sel").first().waitFor({ state: "visible", timeout: 10_000 });
  await firstCell.dblclick({ timeout: 20_000 });
  await page.locator(".rm-cellin").first().waitFor({ state: "visible", timeout: 10_000 });
  await observe();
  return observed;
}

async function countContractClasses(page: Page): Promise<Record<string, number>> {
  await page.evaluate("globalThis.__name = (target) => target");
  return page.evaluate((classes) => {
    const visible = (el: Element): boolean => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el as HTMLElement);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    return Object.fromEntries(classes.map((cls) => [cls, Array.from(document.querySelectorAll(`.${CSS.escape(cls)}`)).filter(visible).length]));
  }, allContractClasses);
}

async function collectLiveChecks(page: Page): Promise<LiveChecks> {
  await page.evaluate("globalThis.__name = (target) => target");
  return page.evaluate((classes) => {
    const visible = (el: Element): boolean => {
      const html = el as HTMLElement;
      const rect = html.getBoundingClientRect();
      const style = getComputedStyle(html);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const count = (selector: string): number => Array.from(document.querySelectorAll(selector)).filter(visible).length;
    const rectOf = (selector: string): RectSnapshot => {
      const el = Array.from(document.querySelectorAll(selector)).find(visible) as HTMLElement | undefined;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        display: style.display,
        borderRadius: style.borderRadius,
        color: style.color,
        backgroundColor: style.backgroundColor,
        className: el.className.toString(),
      };
    };
    const classCounts = Object.fromEntries(classes.map((cls) => [cls, count(`.${CSS.escape(cls)}`)]));
    const surfaces = {
      topbar: rectOf(".fx-top"),
      mark: rectOf(".fx-mark"),
      invite: rectOf(".fx-invite"),
      iconButton: rectOf(".fx-iconbtn"),
      binder: rectOf(".fx-side"),
      tabs: rectOf(".fx-tabs"),
      sheet: rectOf(".fx-sheet"),
      selectedCell: rectOf(".fx-sel"),
      editor: rectOf(".rm-cellin"),
      chat: rectOf(".fx-chat"),
      composer: rectOf(".rm-chatin"),
      send: rectOf(".send"),
      status: rectOf(".fx-status"),
      peoplePanel: rectOf(".sc-ppanel"),
    };
    const counts = {
      binderGroups: count(".r-binder-groups"),
      sidebarChatPeek: count('[data-testid="sidebar-chat-peek"], .r-sidebar-chat'),
      nestedTreeRows: count('.r-tree-row[data-level="2"], .r-tree-row[data-level="3"]'),
      visibleTreeRows: count(".fx-item"),
      visibleSheetRows: count('[data-testid="sheet-grid"] tbody tr'),
      visibleSheetCells: count('[data-testid="sheet-cell"]'),
      publicMessages: count('[data-testid="public-chat-panel"] [data-testid="chat-message"]'),
      guidedTour: count('[data-testid="guided-tour"], .r-tour, .r-walkdock'),
    };
    const text = document.body.innerText;
    const textSignals = {
      hasRoomBinder: text.includes("Room Binder"),
      hasPublicChat: text.includes("Public chat"),
      hasNodeRoom: text.includes("NodeRoom"),
    };
    const geometryFailures: string[] = [];
    const range = (name: string, rect: RectSnapshot, min: number, max: number, dim: "width" | "height") => {
      if (!rect) {
        geometryFailures.push(`${name}: missing`);
        return;
      }
      if (rect[dim] < min || rect[dim] > max) geometryFailures.push(`${name}.${dim}: expected ${min}-${max}, got ${rect[dim]}`);
    };
    range("topbar", surfaces.topbar, 48, 58, "height");
    range("mark", surfaces.mark, 24, 34, "width");
    range("mark", surfaces.mark, 24, 34, "height");
    range("iconButton", surfaces.iconButton, 26, 38, "width");
    range("binder", surfaces.binder, 200, 340, "width");
    range("chat", surfaces.chat, 280, 440, "width");
    range("status", surfaces.status, 26, 52, "height");
    return { classCounts, surfaces, counts, textSignals, geometryFailures };
  }, allContractClasses);
}

function buildComponentChecks(live: LiveChecks): ComponentCheck[] {
  return componentContract.map((component) => {
    const selectors = component.contractClasses.map((cls) => `.${cls}`);
    const classCounts = Object.fromEntries(component.contractClasses.map((cls) => [cls, live.classCounts[cls] ?? 0]));
    return {
      id: component.id,
      contractClasses: [...component.contractClasses],
      selectors,
      required: component.required,
      present: component.required
        ? component.contractClasses.every((cls) => (live.classCounts[cls] ?? 0) > 0)
        : component.contractClasses.some((cls) => (live.classCounts[cls] ?? 0) > 0),
      classCounts,
    };
  });
}

function noiseFailures(live: LiveChecks): string[] {
  const failures: string[] = [];
  if (live.counts.binderGroups !== 0) failures.push(`binder summary groups should be absent, got ${live.counts.binderGroups}`);
  if (live.counts.sidebarChatPeek !== 0) failures.push(`left-rail chat peek should be absent, got ${live.counts.sidebarChatPeek}`);
  if (live.counts.guidedTour !== 0) failures.push(`tour/walkthrough chrome should be absent, got ${live.counts.guidedTour}`);
  if (live.counts.nestedTreeRows < 1) failures.push(`nested binder tree rows expected >= 1, got ${live.counts.nestedTreeRows}`);
  if (live.counts.visibleSheetRows < 5) failures.push(`visible sheet rows expected >= 5, got ${live.counts.visibleSheetRows}`);
  if (live.counts.visibleSheetCells < 20) failures.push(`visible sheet cells expected >= 20, got ${live.counts.visibleSheetCells}`);
  if (live.counts.publicMessages < 1) failures.push(`sent public message expected >= 1, got ${live.counts.publicMessages}`);
  for (const [key, present] of Object.entries(live.textSignals)) {
    if (!present) failures.push(`text signal missing: ${key}`);
  }
  return failures;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function extractTitle(raw: string): string {
  const match = raw.match(/<title[^>]*>(.*?)<\/title>/i);
  return match ? stripHtml(match[1]).trim() : "";
}

function extractContractCards(raw: string): Array<{ section: string; name: string; selector: string }> {
  const cards: Array<{ section: string; name: string; selector: string }> = [];
  for (const sectionMatch of raw.matchAll(/<section class="uic-sec">([\s\S]*?)<\/section>/g)) {
    const sectionHtml = sectionMatch[1];
    const section = stripHtml(sectionHtml.match(/<h2[^>]*>(.*?)<\/h2>/)?.[1] ?? "").trim();
    for (const cardMatch of sectionHtml.matchAll(/<div class="uic-card-h">([\s\S]*?)<\/div>/g)) {
      const header = cardMatch[1];
      const name = stripHtml(header.match(/<span class="nm">(.*?)<\/span>/)?.[1] ?? "").trim();
      const selector = stripHtml(header.match(/<span class="sel">(.*?)<\/span>/)?.[1] ?? "").trim();
      if (name) cards.push({ section, name, selector });
    }
  }
  return cards;
}

function hasToken(value: string, token: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(token)}([^A-Za-z0-9_-]|$)`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelForBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return `local-${url.port || "default"}`;
    return url.hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  } catch {
    return baseUrl.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "target";
  }
}
