/**
 * Walkthrough capturer — drives the LIVE app (real Convex backend, real LLM for agent features)
 * through each FeatureSpec, captures clean per-state frames + cursor click targets, and emits
 * `remotion/walkthrough.data.js` + frames under `remotion/public/frames/<feature>/`.
 *
 * Run:  npx tsx scripts/walkthroughs/capture.ts            (all features)
 *       npx tsx scripts/walkthroughs/capture.ts chat sheet-undo   (subset)
 *
 * Design: each click/type step emits TWO beats — the pre-frame the cursor glides over (with the
 * recorded target + ripple) and the post-frame outcome — so the rendered walkthrough always shows
 * empty state → where the cursor clicked → loading → result. LLM features retry in a FRESH room.
 */
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import ExcelJS from "exceljs";
import { api } from "../../convex/_generated/api.js";
import { FEATURES, type FeatureSpec, type Step, type After } from "./specs.js";

const BASE = process.env.WALKTHROUGH_BASE ?? "https://noderoom.live";
const VIEW = { width: 1280, height: 800 };
const ROOT = process.cwd();
const PUB = join(ROOT, "remotion", "public");
const onlyIds = process.argv.slice(2);
const DEMO_CHROME = [
  "*::-webkit-scrollbar{display:none!important}",
  ".r-tour{display:none!important}",
  "body{zoom:1.15}",
  ".r-file .fn{font-size:14px!important}",
  ".r-file .fm{font-size:12.5px!important}",
  ".r-trace{max-height:380px!important}",
  ".r-trace-list{gap:14px!important;padding-bottom:18px!important}",
  ".r-trace-row{padding:7px 8px!important;gap:11px!important}",
  ".r-trace-item .tt{font-size:18px!important;line-height:1.55!important}",
  ".r-trace-item .td{font-size:14.5px!important;line-height:1.5!important}",
  ".r-trace-detail{font-size:14.5px!important;line-height:1.75!important;gap:6px!important}",
  ".r-copilot-tabs button[data-on=\"true\"]{box-shadow:0 0 0 2px var(--accent-primary),0 0 0 6px var(--accent-tint)!important}",
  ".r-copilot-tabs button[data-on=\"true\"]::after{content:\"active\";margin-left:4px;font-size:9px;text-transform:uppercase;color:var(--accent-ink)}",
].join(" ");

type Segment = { frame: string; caption: string; cursor: { x: number; y: number } | null; click: boolean; kind: "state" | "action" | "typed" | "loading" | "result"; holdMs: number };
type FeatureOut = { id: string; title: string; skipped: boolean; error?: string; segments: Segment[] };

const VARS = ["r_rev", "r_cogs", "r_gp", "r_opex", "r_ni"].map((r) => `${r}__variance`);

function normalizeCaptureCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

async function settle(page: Page, ms = 420) { await page.waitForTimeout(ms); }

async function shoot(page: Page, dir: string, n: number): Promise<string> {
  const rel = `frames/${dir}/${String(n).padStart(2, "0")}.png`;
  await page.screenshot({ path: join(PUB, rel) });
  return rel;
}

async function center(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: "visible", timeout: 15_000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = (await loc.boundingBox())!;
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

async function setInputByTestId(page: Page, testId: string, value: string) {
  const loc = page.getByTestId(testId);
  await loc.waitFor({ state: "visible", timeout: 30_000 });
  await loc.evaluate((node, nextValue) => {
    const input = node as HTMLInputElement | HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function waitAfter(page: Page, a: After | undefined) {
  if (!a) return settle(page);
  if ("textSel" in a) {
    await page.waitForFunction(
      ({ sel, inc }) => ((document.querySelector(sel) as HTMLElement | null)?.innerText ?? "").includes(inc),
      { sel: a.textSel, inc: a.includes }, { timeout: a.timeoutMs ?? 20_000 });
  } else {
    await page.locator(a.sel).first().waitFor({ state: a.state ?? "visible", timeout: a.timeoutMs ?? 20_000 });
  }
  await settle(page);
}

async function createRoom(ctx: BrowserContext, code: string): Promise<Page> {
  const roomCode = normalizeCaptureCode(code);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?create=${roomCode}&name=Maya`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').waitFor({ timeout: 60_000 });
  await page.getByTestId("tour-skip").click({ timeout: 8000 }).catch(() => {});
  // The current app creates blank rooms — load the sample workspace if the blank state is showing.
  const blank = page.getByTestId("blank-room-state");
  if (await blank.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByTestId("blank-cta-demo").click({ timeout: 10_000 });
    await settle(page, 2_000);
  }
  // Click the Company research tab so the research sheet is visible.
  await page.locator('[data-testid="artifact-tabs"] button', { hasText: /Company research/i }).first().click({ timeout: 15_000 }).catch(() => {});
  await page.locator('[data-testid="sheet-grid"]').waitFor({ timeout: 15_000 }).catch(() => {});
  await settle(page, 500);
  await page.addStyleTag({ content: "*::-webkit-scrollbar{display:none!important} .r-tour{display:none!important} body{zoom:1.15}" });
  await settle(page, 800);
  return page;
}

const DEFAULT_SEED_COMPANIES = [
  { company: "OpenAI", website: "https://openai.com", tier: "A", owner: "Maya" },
  { company: "Stripe", website: "https://stripe.com", tier: "A", owner: "Maya" },
  { company: "Figma", website: "https://figma.com", tier: "B", owner: "Sam" },
];

async function walkthroughWorkbookFile(): Promise<string> {
  const dir = join(ROOT, ".tmp-qa", "walkthroughs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "style-toggle.xlsx");
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Model");
  ws.getColumn(2).width = 28;
  ws.getColumn(4).width = 16;
  ws.getCell("B2").value = "STYLE TOGGLE MODEL";
  ws.getCell("B2").font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  ws.mergeCells("B2:D2");
  ws.getCell("B4").value = "Gross margin %";
  ws.getCell("D4").value = 0.3374;
  ws.getCell("D4").numFmt = "0.0%";
  ws.getCell("B5").value = "EBIT";
  ws.getCell("D5").value = 65.8;
  ws.getCell("D5").numFmt = "#,##0.0";
  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(path, Buffer.from(buffer as ArrayBuffer));
  return path;
}

async function uploadWalkthroughWorkbook(page: Page) {
  const path = await walkthroughWorkbookFile();
  await page.locator(".r-file-input").setInputFiles(path);
  await page.getByRole("button", { name: /style-toggle\.xlsx/i }).click({ timeout: 30_000 });
  await page.getByTestId("excel-paper").waitFor({ timeout: 30_000 });
  await page.locator('[data-cell-key="D4"]').click();
}

async function seedResearch(page: Page, code: string, companies = DEFAULT_SEED_COMPANIES) {
  const roomCode = normalizeCaptureCode(code);
  // The room's OWN session token (from the browser) authorizes seeding a research artifact.
  const sess = JSON.parse(await page.evaluate((k) => localStorage.getItem(k) ?? "{}", `noderoom:live:${roomCode}`));
  if (!sess.token) throw new Error(`seedResearch: no session in localStorage for ${roomCode}`);
  const url = readFileSync(join(ROOT, ".env.local"), "utf8").match(/VITE_CONVEX_URL=(.+)/)![1].trim();
  const client = new ConvexHttpClient(url);
  const proof = { actor: { kind: "user" as const, id: String(sess.memberId), name: String(sess.name) }, token: String(sess.token) };
  const artId = await client.mutation(api.artifacts.createArtifact, { roomId: sess.roomId, kind: "sheet", title: "Company research", seed: [], proof });
  await client.mutation(api.artifacts.addResearchRows, {
    roomId: sess.roomId, artifactId: artId, requester: proof, rows: companies,
  });
  console.log(`  [seed] research artifact ${String(artId)} created in ${roomCode}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tour-skip").click({ timeout: 8000 }).catch(() => {});
  await page.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').waitFor({ timeout: 30_000 });
  // Open the research sheet: left-rail file entry first, artifact-tab fallback.
  const rail = page.getByTestId("left-rail").getByText("Company research").first();
  try {
    await rail.click({ timeout: 10_000 });
  } catch {
    await page.locator('[data-testid="artifact-tabs"] button', { hasText: /research/i }).first().click({ timeout: 10_000 });
  }
  await page.addStyleTag({ content: "*::-webkit-scrollbar{display:none!important} .r-tour{display:none!important} body{zoom:1.15}" });
  await page.locator(".r-research").waitFor({ timeout: 15_000 });
  await settle(page, 800);
}

async function ensureSampleDiligenceWorkspace(page: Page) {
  const blank = page.getByTestId("blank-room-state");
  if (await blank.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const load = page.getByTestId("blank-cta-demo");
    await load.click({ timeout: 10_000 });
  }
  await page.locator(".r-research").waitFor({ timeout: 30_000 });
}

async function captureStartupJoinRoom(
  ctx: BrowserContext,
  code: string,
  dir: string,
  segments: Segment[],
  nextFrame: () => number,
) {
  const roomCode = normalizeCaptureCode(code);
  const chrome = DEMO_CHROME;
  const host = await ctx.newPage();
  await host.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
  await host.addStyleTag({ content: chrome });
  await setInputByTestId(host, "display-name", "Maya");
  await settle(host, 500);
  segments.push({
    frame: await shoot(host, dir, nextFrame()),
    caption: "Maya starts a fresh startup-banking diligence room from the landing page",
    cursor: null,
    click: false,
    kind: "state",
    holdMs: 2600,
  });
  const startCur = await center(host, '[data-testid="start-demo-room"]');
  segments.push({
    frame: await shoot(host, dir, nextFrame()),
    caption: "Create a new room for the diligence batch",
    cursor: startCur,
    click: true,
    kind: "action",
    holdMs: 950,
  });
  await host.goto(`${BASE}/?create=${roomCode}&name=Maya`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await host.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').waitFor({ timeout: 60_000 });
  await host.getByTestId("tour-skip").click({ timeout: 8000 }).catch(() => {});
  await ensureSampleDiligenceWorkspace(host);
  await host.addStyleTag({ content: chrome }).catch(() => {});
  await settle(host, 900);
  segments.push({
    frame: await shoot(host, dir, nextFrame()),
    caption: "The host lands in a live war room with company research, memo, wall, runway sheet, and invite code",
    cursor: null,
    click: false,
    kind: "result",
    holdMs: 2400,
  });
  const copyCur = await center(host, ".r-roomcode");
  segments.push({
    frame: await shoot(host, dir, nextFrame()),
    caption: "The room code is the shareable join path for the team",
    cursor: copyCur,
    click: true,
    kind: "action",
    holdMs: 950,
  });
  await host.locator(".r-roomcode").click();
  await settle(host, 500);
  segments.push({
    frame: await shoot(host, dir, nextFrame()),
    caption: `Code ${roomCode} is ready to send to the diligence team`,
    cursor: null,
    click: false,
    kind: "result",
    holdMs: 1700,
  });

  const joiner = await ctx.newPage();
  await joiner.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await joiner.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
  await joiner.addStyleTag({ content: chrome });
  await setInputByTestId(joiner, "display-name", "Priya");
  await setInputByTestId(joiner, "join-room-code", roomCode);
  await settle(joiner, 500);
  segments.push({
    frame: await shoot(joiner, dir, nextFrame()),
    caption: "Switch to Priya's browser: she enters the shared room code from the landing page",
    cursor: null,
    click: false,
    kind: "state",
    holdMs: 2600,
  });
  const joinCur = await center(joiner, '[data-testid="join-room"]');
  segments.push({
    frame: await shoot(joiner, dir, nextFrame()),
    caption: "Join brings a second user into the same live room session",
    cursor: joinCur,
    click: true,
    kind: "action",
    holdMs: 950,
  });
  await joiner.evaluate((code) => {
    try { localStorage.removeItem(`noderoom:live:${code}`); } catch { /* ignore */ }
  }, roomCode);
  await joiner.goto(`${BASE}/?room=${roomCode}&name=Priya`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await joiner.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').waitFor({ timeout: 60_000 });
  await joiner.getByTestId("tour-skip").click({ timeout: 8000 }).catch(() => {});
  await ensureSampleDiligenceWorkspace(joiner);
  await joiner.addStyleTag({ content: chrome }).catch(() => {});
  await settle(joiner, 900);
  segments.push({
    frame: await shoot(joiner, dir, nextFrame()),
    caption: "The joiner sees the same diligence artifacts and live room state",
    cursor: null,
    click: false,
    kind: "result",
    holdMs: 2300,
  });
  const composer = joiner.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').first();
  const composerCur = await center(joiner, '[data-testid="public-chat-panel"] [data-testid="chat-composer"]');
  segments.push({
    frame: await shoot(joiner, dir, nextFrame()),
    caption: "Teammates can coordinate asks for multiple agents in room chat",
    cursor: composerCur,
    click: false,
    kind: "action",
    holdMs: 900,
  });
  await composer.click();
  await composer.fill("I'm in - bulk run CardioNova plus the five startup-banking companies.");
  await composer.press("Enter");
  await waitAfter(joiner, { textSel: '[data-testid="public-chat-panel"] [data-testid="chat-feed"]', includes: "CardioNova", timeoutMs: 20_000 });
  segments.push({
    frame: await shoot(joiner, dir, nextFrame()),
    caption: "Priya's bulk diligence ask lands in the shared room, next to the artifacts and trace",
    cursor: null,
    click: false,
    kind: "result",
    holdMs: 2400,
  });

  const banker = await ctx.newPage();
  await banker.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await banker.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
  await banker.addStyleTag({ content: chrome });
  await setInputByTestId(banker, "display-name", "Alex");
  await setInputByTestId(banker, "join-room-code", roomCode);
  await settle(banker, 500);
  segments.push({
    frame: await shoot(banker, dir, nextFrame()),
    caption: "Switch to Alex's browser: the banker joins to own runway and milestone questions",
    cursor: null,
    click: false,
    kind: "state",
    holdMs: 2800,
  });
  const bankerJoinCur = await center(banker, '[data-testid="join-room"]');
  segments.push({
    frame: await shoot(banker, dir, nextFrame()),
    caption: "A third user enters the same live diligence room by code",
    cursor: bankerJoinCur,
    click: true,
    kind: "action",
    holdMs: 950,
  });
  await banker.evaluate((code) => {
    try { localStorage.removeItem(`noderoom:live:${code}`); } catch { /* ignore */ }
  }, roomCode);
  await banker.goto(`${BASE}/?room=${roomCode}&name=Alex`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await banker.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').waitFor({ timeout: 60_000 });
  await banker.getByTestId("tour-skip").click({ timeout: 8000 }).catch(() => {});
  await ensureSampleDiligenceWorkspace(banker);
  await banker.addStyleTag({ content: chrome }).catch(() => {});
  await settle(banker, 900);
  const bankerComposer = banker.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').first();
  await bankerComposer.click();
  await bankerComposer.fill("I'll own runway and milestone questions for CardioNova and the top two companies.");
  await bankerComposer.press("Enter");
  await waitAfter(banker, { textSel: '[data-testid="public-chat-panel"] [data-testid="chat-feed"]', includes: "runway and milestone", timeoutMs: 20_000 });
  segments.push({
    frame: await shoot(banker, dir, nextFrame()),
    caption: "The live room now has three users, shared startup diligence asks, and one durable artifact set",
    cursor: null,
    click: false,
    kind: "result",
    holdMs: 2400,
  });
}

/** Deterministic in-browser demo engine at the SAME prod URL — same UI, scripted agent.
 *  A spec's demoQuery appends params (e.g. the scale room), which auto-enters the room. */
async function memoryDemo(ctx: BrowserContext, demoQuery?: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mode=memory${demoQuery ? `&${demoQuery}` : ""}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
  if (!demoQuery) await page.getByTestId("start-demo-room").click({ timeout: 30_000 });
  await page.locator('[data-testid="public-chat-panel"] [data-testid="chat-composer"]').waitFor({ timeout: 30_000 });
  await page.getByTestId("tour-skip").click({ timeout: 5000 }).catch(() => {});
  await page.addStyleTag({ content: DEMO_CHROME });
  await settle(page, 800);
  return page;
}

/** The landing seven-layer walkthrough's live grid (#story) — in-browser engine, no room. */
/** The scripted #room-tour landing walkthrough (Room.html port) — seed data, no Convex. */
async function roomTourPage(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#room-tour`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".rt-app").waitFor({ timeout: 30_000 });
  await settle(page, 700);
  return page;
}

async function storyPage(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#story`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByTestId("story-lab").waitFor({ state: "attached", timeout: 30_000 });
  await page.getByTestId("story-lab").scrollIntoViewIfNeeded({ timeout: 30_000 });
  await settle(page, 900);
  return page;
}

async function runFeature(spec: FeatureSpec, attempt: number): Promise<FeatureOut> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const code = normalizeCaptureCode(`GIF${spec.id.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
  const dir = spec.id;
  rmSync(join(PUB, "frames", dir), { recursive: true, force: true });
  mkdirSync(join(PUB, "frames", dir), { recursive: true });
  const segments: Segment[] = [];
  let n = 0;
  try {
    if (spec.setup === "startupJoinRoom") {
      await captureStartupJoinRoom(ctx, code, dir, segments, () => ++n);
      await browser.close();
      return { id: spec.id, title: spec.title, skipped: false, segments };
    }
    const page =
      spec.setup === "memoryDemo" ? await memoryDemo(ctx, spec.demoQuery)
        : spec.setup === "story" ? await storyPage(ctx)
        : spec.setup === "roomTour" ? await roomTourPage(ctx)
        : await createRoom(ctx, code);
    if (spec.setup === "seedResearchRoom") await seedResearch(page, code, spec.seedCompanies);
    // Close panels the story doesn't use — the remaining panels (and their text) render larger.
    // Top-bar toggle order matches RoomShell's show state: [Room Binder, Work Surface, Copilot].
    if (spec.closePanels?.length) {
      const idx = { left: 0, artifact: 1, priv: 2 } as const;
      for (const p of spec.closePanels) await page.locator(".r-toggle-group button").nth(idx[p]).click();
      await settle(page, 500);
    }

    for (const step of spec.steps) {
      if (step.kind === "state") {
        await settle(page, step.settleMs ?? 420);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "state", holdMs: step.holdMs ?? 1700 });
      } else if (step.kind === "click") {
        const cur = await center(page, step.sel);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: cur, click: true, kind: "action", holdMs: step.holdMs ?? 950 });
        await page.locator(step.sel).first().click();
        await waitAfter(page, step.after);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.afterCaption ?? step.caption, cursor: null, click: false, kind: "result", holdMs: step.afterHoldMs ?? (step.afterCaption ? 1700 : 950) });
      } else if (step.kind === "uploadWorkbook") {
        const cur = await center(page, ".r-file.r-upload");
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: cur, click: true, kind: "action", holdMs: step.holdMs ?? 950 });
        await uploadWalkthroughWorkbook(page);
        await settle(page, 700);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.afterCaption ?? step.caption, cursor: null, click: false, kind: "result", holdMs: step.afterHoldMs ?? (step.afterCaption ? 1900 : 1200) });
      } else if (step.kind === "type") {
        const cur = await center(page, step.sel);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: cur, click: false, kind: "action", holdMs: 800 });
        const loc = page.locator(step.sel).first();
        await loc.click();
        await loc.fill("");
        const typeDelay = step.text.length > 80 ? 4 : 10;
        const splitAt = step.text.length > 60 ? Math.min(72, Math.floor(step.text.length * 0.55)) : 0;
        if (splitAt) {
          await loc.pressSequentially(step.text.slice(0, splitAt), { delay: typeDelay });
          await settle(page, 140);
          segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "typed", holdMs: 520 });
          await loc.pressSequentially(step.text.slice(splitAt), { delay: typeDelay });
        } else {
          await loc.pressSequentially(step.text, { delay: typeDelay });
        }
        await settle(page, 250);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "typed", holdMs: 1300 });
        if (step.pressEnter) {
          await loc.press("Enter");
          await waitAfter(page, step.after);
          if (step.afterCaption) segments.push({ frame: await shoot(page, dir, ++n), caption: step.afterCaption, cursor: null, click: false, kind: "result", holdMs: step.afterHoldMs ?? 1700 });
        } else if (step.after) {
          await waitAfter(page, step.after);
        }
      } else if (step.kind === "key") {
        await page.keyboard.press(step.key);
        await waitAfter(page, step.after);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "result", holdMs: 1500 });
      } else if (step.kind === "loading") {
        await page.locator(step.sel).first().waitFor({ timeout: step.timeoutMs ?? 30_000 });
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "loading", holdMs: 1600 });
      } else if (step.kind === "waitResult") {
        const t0 = Date.now();
        const timeout = step.timeoutMs ?? 150_000;
        if (step.predicate === "cellsFilled") {
          const want = Number(step.arg ?? "2");
          await page.waitForFunction(({ keys, want }) => {
            const filled = keys.filter((k) => { const t = ((document.querySelector(`[data-cell-key="${k}"]`) as HTMLElement | null)?.innerText ?? "").trim(); return t.length > 0 && !/^add\b/i.test(t); });
            return filled.length >= want;
          }, { keys: VARS, want }, { timeout, polling: 1500 });
        } else if (step.predicate === "chipsVisible") {
          await page.locator('[data-testid="proposal-card"], [data-testid="proposal-inline"]').first().waitFor({ timeout });
        } else if (step.predicate === "textGone") {
          // presence first (the vacuous-negative lesson), then wait for the text to vanish
          await page.locator(step.sel!).first().waitFor({ state: "visible", timeout: 10_000 });
          await page.waitForFunction(
            ({ sel, inc }) => !(((document.querySelector(sel) as HTMLElement | null)?.innerText) ?? "").includes(inc),
            { sel: step.sel!, inc: step.arg! }, { timeout, polling: 500 });
        } else {
          await page.waitForFunction((inc) => document.body.innerText.includes(inc!), step.arg, { timeout });
        }
        await settle(page, 700);
        segments.push({ frame: await shoot(page, dir, ++n), caption: step.caption, cursor: null, click: false, kind: "result", holdMs: 2100 });
        console.log(`  [${spec.id}] result after ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    }
    await browser.close();
    return { id: spec.id, title: spec.title, skipped: false, segments };
  } catch (e) {
    // Failure forensics: freeze the exact UI state + where we were (kept out of walkthrough data).
    try {
      const pages = ctx.pages();
      const p = pages[pages.length - 1];
      if (p) {
        await p.screenshot({ path: join(PUB, "frames", dir, "zz-fail.png") }).catch(() => {});
        const rail = await p.getByTestId("left-rail").innerText().catch(() => "(no rail)");
        console.log(`  [${spec.id}] FAIL-STATE rail: ${rail.replace(/\s+/g, " | ").slice(0, 220)}`);
      }
    } catch { /* forensics are best-effort */ }
    await browser.close();
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    if (attempt < (spec.retries ?? 0)) {
      console.log(`  [${spec.id}] attempt ${attempt + 1} failed (${msg}) — retrying in a fresh room`);
      return runFeature(spec, attempt + 1);
    }
    return { id: spec.id, title: spec.title, skipped: true, error: msg, segments: [] };
  }
}

const run = async () => {
  mkdirSync(join(ROOT, "remotion"), { recursive: true });
  // optIn specs (special-server captures like the naive failure-replay) run only when named.
  const picked = onlyIds.length ? FEATURES.filter((f) => onlyIds.includes(f.id)) : FEATURES.filter((f) => !f.optIn);
  const out: FeatureOut[] = [];
  // keep previously-captured features when running a subset
  let prior: FeatureOut[] = [];
  try { prior = (await import("file://" + join(ROOT, "remotion", "walkthrough.data.js"))).default.features; } catch { /* first run */ }
  for (const spec of picked) {
    console.log(`[capture] ${spec.id} — ${spec.title}`);
    out.push(await runFeature(spec, 0));
  }
  const outputFeatures = FEATURES.filter((f) => !f.optIn || onlyIds.includes(f.id));
  const merged = [...outputFeatures.map((f) => out.find((o) => o.id === f.id) ?? prior.find((p) => p.id === f.id)).filter(Boolean)] as FeatureOut[];
  const data = { capturedAt: new Date().toISOString(), baseUrl: BASE, viewport: VIEW, features: merged };
  writeFileSync(join(ROOT, "remotion", "walkthrough.data.js"), `// AUTO-GENERATED by scripts/walkthroughs/capture.ts — live-captured walkthrough data.\nexport default ${JSON.stringify(data, null, 2)};\n`);
  console.log(JSON.stringify(merged.map((f) => ({ id: f.id, skipped: f.skipped, segments: f.segments.length, error: f.error })), null, 2));
};
void run();
