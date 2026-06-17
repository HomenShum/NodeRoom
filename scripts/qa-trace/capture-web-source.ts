/**
 * Web-source capture producer — a browser-driven fetchSource. Navigates a live page, screenshots it,
 * locates the retrieved value, and records its on-screen box → a Trace bundle (screenshot + highlight).
 * This is the SEC/EDGAR mechanism: screenshot the source, box the extracted value.
 *
 * NOTE: sec.gov 403s undeclared automation (their fair-access wall), so from here we fall back to a
 * reliable public financial page to prove the mechanism. A production worker uses a declared UA from a
 * real server IP (SEC's stated policy) or SEC's data API; the bundle shape is identical either way.
 *
 * Run:  npx tsx <worktree>/scripts/qa-trace/capture-web-source.ts
 */
import { chromium, type Page, type Locator } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SHOTS_DIR = join(ROOT, "public", "qa-trace", "web-source");
const BUNDLE_DIR = join(ROOT, "src", "ui", "panels", "qaTraceBundles");
mkdirSync(SHOTS_DIR, { recursive: true });
mkdirSync(BUNDLE_DIR, { recursive: true });
const STAMP = process.env.QA_TRACE_STAMP ?? "captured";
const VW = 1280;
const VH = 900;

const SOURCES: { url: string; find: string; locator: (p: Page) => Locator }[] = [
  { url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K&count=10", find: "10-K", locator: (p) => p.getByText("10-K").first() },
  { url: "https://en.wikipedia.org/wiki/Apple_Inc.", find: "Revenue", locator: (p) => p.locator('table.infobox tr:has(th:has-text("Revenue"))').first() },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, userAgent: "NodeRoom research bot homen@example.com" });
const page = await ctx.newPage();

let cap: { url: string; find: string; box: { x: number; y: number; w: number; h: number } | null; snippet: string } | null = null;
for (const src of SOURCES) {
  try {
    const resp = await page.goto(src.url, { waitUntil: "domcontentloaded", timeout: 25000 });
    const status = resp?.status() ?? 0;
    if (status >= 400) { console.log(`skip ${new URL(src.url).hostname} (status ${status})`); continue; }
    await page.waitForTimeout(800);
    const loc = src.locator(page);
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const rect = await loc.evaluate((el) => { const b = (el as HTMLElement).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }).catch(() => null);
    const snippet = ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
    await page.screenshot({ path: join(SHOTS_DIR, "source.png") });
    const box = rect && rect.w > 0 && rect.h > 0
      ? { x: +(rect.x / VW).toFixed(4), y: +(Math.max(0, rect.y) / VH).toFixed(4), w: +(rect.w / VW).toFixed(4), h: +(Math.min(rect.h, VH) / VH).toFixed(4) }
      : null;
    cap = { url: src.url, find: src.find, box, snippet };
    console.log(`captured ${new URL(src.url).hostname} (status ${status}) box=${JSON.stringify(box)}`);
    break;
  } catch (e) { console.log(`fail ${new URL(src.url).hostname}: ${(e as Error).message.slice(0, 90)}`); }
}
await browser.close();

if (!cap) { console.log("no source captured"); process.exit(1); }

const host = new URL(cap.url).hostname.replace(/^www\./, "");
const bundle = {
  id: "web-source-retrieval",
  kind: "qa" as const,
  title: "Web retrieval · source screenshot + box",
  subtitle: `Live fetch of ${host} — the page is screenshotted and the retrieved value is boxed (the SEC/EDGAR mechanism)`,
  ts: STAMP,
  source: { tool: "Playwright fetchSource", version: "qa-trace/capture-web-source.ts", env: "chromium · declared UA" },
  verdict: { label: cap.box ? "value located + boxed" : "captured (value not boxed)", tone: "ok" as const },
  steps: [
    {
      idx: 1,
      label: `Retrieve "${cap.find}" from ${host}`,
      detail: cap.snippet,
      status: "ok" as const,
      group: "Web retrieval",
      attachments: [{ kind: "screenshot" as const, url: "/qa-trace/web-source/source.png", ...(cap.box ? { box: cap.box } : {}) }],
    },
  ],
  raw: { url: cap.url, find: cap.find, box: cap.box, snippet: cap.snippet, note: "sec.gov 403s undeclared automation; production uses a declared UA from a server IP or SEC's data API. Same bundle shape." },
};
writeFileSync(join(BUNDLE_DIR, "web-source.json"), `${JSON.stringify(bundle, null, 2)}\n`);
console.log("wrote web-source.json");
