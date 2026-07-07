import "./benchmark/loadEnv";
import { chromium } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "../convex/_generated/api";

type LiveSession = {
  roomId: string;
  memberId: string;
  name: string;
  token: string;
};

type ElementsPayload =
  | Record<string, unknown>
  | { __transport: "entries"; entries: Array<[string, unknown]> };

const runId = process.env.PROOFLOOP_RUN_ID ?? `live-starter-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
const baseUrl = process.env.BENCH_BASE_URL ?? process.env.PROOFLOOP_LIVE_PROD_BASE_URL ?? "https://noderoom.live";
const convexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
const outDir = resolve(process.env.PROOFLOOP_LIVE_STARTER_RECEIPT_ROOT ?? `docs/eval/live-prod/${runId}/browser-receipts/live-starter-room`);
const screenshotPath = resolve(outDir, "live-starter-room.png");
const receiptPath = resolve(outDir, "receipt.json");

if (!convexUrl) throw new Error("Missing VITE_CONVEX_URL or CONVEX_URL for live starter proof.");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADLESS !== "0" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(err.message));

const startedAt = new Date().toISOString();
const client = new ConvexHttpClient(convexUrl);
const failures: string[] = [];

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  await page.getByTestId("create-room-submit").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("create-room-submit").click();
  await page.waitForURL(/room=/, { timeout: 80_000 });
  await page.getByTestId("public-chat-panel").waitFor({ state: "visible", timeout: 80_000 });
  await page.getByTestId("left-rail").waitFor({ state: "visible", timeout: 80_000 });
  await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 80_000 });
  await page.getByTestId("sheet-grid").waitFor({ state: "visible", timeout: 80_000 });
  await page.getByText("Company research", { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("CardioNova", { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1_500);

  const roomCode = new URL(page.url()).searchParams.get("room") ?? "";
  const session = await page.evaluate((code) => {
    const raw = localStorage.getItem(`noderoom:live:${code.toUpperCase()}`);
    return raw ? JSON.parse(raw) as LiveSession : null;
  }, roomCode);
  if (!session) throw new Error(`No live session persisted for room ${roomCode}`);
  const requester = { actor: { kind: "user" as const, id: session.memberId, name: session.name }, token: session.token };
  const meta = await client.query(api.rooms.meta, { roomId: session.roomId as any, requester });
  if (!meta) throw new Error(`rooms.meta returned null for ${roomCode}`);
  const research = meta.artifacts.find((artifact) => artifact.kind === "sheet" && artifact.title === "Company research");
  if (!research) failures.push("missing Company research artifact");
  const elements = research
    ? await client.query(api.artifacts.elements, { roomId: session.roomId as any, artifactId: research.id as any, requester })
    : {};
  const messages = await client.query(api.messages.list, { roomId: session.roomId as any, channel: "public", requester });
  const traces = await client.query(api.collab.traces, { roomId: session.roomId as any, requester });
  const dataframe = research?.meta && typeof research.meta === "object" && "dataframe" in research.meta
    ? (research.meta as { dataframe?: any }).dataframe
    : undefined;
  const elementCount = countElements(elements as ElementsPayload);
  const dom = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodySample: document.body.innerText.replace(/\s+/g, " ").slice(0, 2000),
    blankCtaCount: document.querySelectorAll('[data-testid="blank-cta-sheet"]').length,
    binderTitles: Array.from(document.querySelectorAll('[data-testid="binder-artifact"]')).map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()).slice(0, 20),
    visibleRows: document.querySelectorAll('[data-testid="sheet-grid"] tbody tr').length,
    visibleCells: document.querySelectorAll('[data-testid="sheet-cell"]').length,
    publicChatMessages: document.querySelectorAll('[data-testid="public-chat-panel"] [data-testid="chat-message"]').length,
    traceRows: document.querySelectorAll('[data-testid="room-trace"] [data-testid="trace-row"], [data-testid="room-trace"] .r-trace-row').length,
    guidedTourCount: document.querySelectorAll('[data-testid="guided-tour"]').length,
    walkDockCount: document.querySelectorAll(".r-walkdock").length,
  }));

  if (meta.room.title !== "Startup diligence") failures.push(`room title expected Startup diligence, got ${meta.room.title}`);
  if ((meta.artifacts.length ?? 0) < 6) failures.push(`expected at least 6 starter artifacts, got ${meta.artifacts.length}`);
  if (dataframe?.rowCount !== 1000) failures.push(`Company research rowCount expected 1000, got ${String(dataframe?.rowCount)}`);
  if (!Array.isArray(dataframe?.defaultHiddenColumnIds) || !dataframe.defaultHiddenColumnIds.includes("summary")) failures.push("Company research default hidden columns missing summary");
  if (dataframe?.semanticIndexDisabled !== true) failures.push("Company research semanticIndexDisabled should be true");
  if (elementCount < 7000) failures.push(`Company research element count expected >=7000, got ${elementCount}`);
  if (messages.length < 312) failures.push(`public messages expected >=312, got ${messages.length}`);
  if (traces.length < 400) failures.push(`trace feed expected >=400, got ${traces.length}`);
  if (dom.blankCtaCount !== 0) failures.push(`blank CTA should not be present in real starter room, got ${dom.blankCtaCount}`);
  if (dom.guidedTourCount !== 0) failures.push(`guided tour should not auto-open on real starter room, got ${dom.guidedTourCount}`);
  if (dom.walkDockCount !== 0) failures.push(`walkthrough dock should not auto-open on real starter room, got ${dom.walkDockCount}`);
  if (!dom.bodySample.includes("CardioNova")) failures.push("CardioNova not visible in starter sheet");
  if (!dom.bodySample.includes("Company research")) failures.push("Company research not visible in room UI");
  if (consoleErrors.length > 0) failures.push(`browser console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
  if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`);

  await page.screenshot({ path: screenshotPath, fullPage: false });
  const receipt = {
    schema: "noderoom-live-starter-room-proof-v1",
    runId,
    baseUrl,
    convexUrl,
    startedAt,
    completedAt: new Date().toISOString(),
    passed: failures.length === 0,
    failures,
    roomCode,
    roomId: session.roomId,
    screenshotPath,
    checks: {
      roomTitle: meta.room.title,
      artifactCount: meta.artifacts.length,
      artifactTitles: meta.artifacts.map((artifact) => artifact.title),
      companyResearch: {
        rowCount: dataframe?.rowCount,
        elementCount,
        hiddenColumns: dataframe?.defaultHiddenColumnIds,
        semanticIndexDisabled: dataframe?.semanticIndexDisabled,
        tags: research?.meta && typeof research.meta === "object" && "tags" in research.meta ? (research.meta as { tags?: unknown }).tags : undefined,
      },
      publicMessageCount: messages.length,
      traceCount: traces.length,
      dom,
      consoleErrors,
      pageErrors,
    },
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`wrote ${receiptPath}`);
  console.log(`screenshot ${screenshotPath}`);
  console.log(`live starter room ${roomCode} passed=${receipt.passed}`);
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await browser.close();
}

function countElements(payload: ElementsPayload): number {
  if ("__transport" in payload && payload.__transport === "entries") return payload.entries.length;
  return Object.keys(payload).length;
}
