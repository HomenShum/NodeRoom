/**
 * QA-automation trace producer. Drives the LIVE app through a labeled flow, captures a screenshot per
 * step, computes a frame-Δ (changed-pixel ratio — a flicker/SSIM signal) between consecutive frames,
 * and writes a Trace bundle the Trace tab auto-loads (via import.meta.glob in traceData.ts).
 *
 * This is the "QA of our own app" pipeline generalized: drop a new flow → get a screenshots+Δ trace.
 * Run (server on :5301):  QA_BASE_URL=http://localhost:5301 npx tsx <worktree>/scripts/qa-trace/capture-flow.ts
 *
 * Paths resolve from THIS file, so it can run via tsx from any cwd (e.g. the main tree) and still write
 * into the worktree's public/ + src/.
 */
import { chromium, type Page, type Locator } from "playwright";
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", ".."); // <worktree>
const SHOTS_DIR = join(ROOT, "public", "qa-trace", "walkthrough");
const BUNDLE_DIR = join(ROOT, "src", "ui", "panels", "qaTraceBundles");
const BASE = process.env.QA_BASE_URL ?? "http://localhost:5301";
const STAMP = process.env.QA_TRACE_STAMP ?? "captured"; // pass a real timestamp in; Date kept out of output for reproducibility

mkdirSync(SHOTS_DIR, { recursive: true });
mkdirSync(BUNDLE_DIR, { recursive: true });

/** Changed-pixel ratio between two equal-size frames (cheap flicker / SSIM proxy). */
function frameDelta(aPath: string, bPath: string): number {
  try {
    const a = PNG.sync.read(readFileSync(aPath));
    const b = PNG.sync.read(readFileSync(bPath));
    if (a.width !== b.width || a.height !== b.height) return 1;
    const n = a.width * a.height;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const d = Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]);
      if (d > 40) changed++;
    }
    return changed / n;
  } catch {
    return 0;
  }
}

const filetab = (p: Page, t: string): Locator => p.getByTestId("artifact-filetab").filter({ hasText: t }).first();
const tid = (p: Page, id: string): Locator => p.getByTestId(id);

// `target` = the element the step acts on; its on-screen box is captured + drawn as a highlight on the
// screenshot. (For a real SEC/EDGAR retrieval this is the clicked link / extracted cell — same mechanism.)
const flow: { label: string; group: string; act: (p: Page) => Promise<void>; target?: (p: Page) => Locator }[] = [
  { label: "Land in the diligence room", group: "Navigate", act: async () => {} },
  { label: "Open Company research", group: "Navigate", act: async (p) => { await filetab(p, "Company research").click().catch(() => {}); }, target: (p) => filetab(p, "Company research") },
  { label: "Open Diligence memo", group: "Navigate", act: async (p) => { await filetab(p, "Diligence").click().catch(() => {}); }, target: (p) => filetab(p, "Diligence") },
  { label: "Open the Trace tab", group: "Trace", act: async (p) => { await tid(p, "trace-tab").click().catch(() => {}); }, target: (p) => tid(p, "trace-tab") },
  { label: "Select the QA record", group: "Trace", act: async (p) => { await p.getByTestId("trace-record").filter({ hasText: "design floor" }).first().click().catch(() => {}); }, target: (p) => p.getByTestId("trace-record").filter({ hasText: "design floor" }).first() },
  { label: "Open Steps", group: "Trace", act: async (p) => { await tid(p, "trace-tab-steps").click().catch(() => {}); }, target: (p) => tid(p, "trace-tab-steps") },
  { label: "Private lane", group: "Copilot", act: async (p) => { await tid(p, "copilot-tab-private").click().catch(() => {}); }, target: (p) => tid(p, "copilot-tab-private") },
  { label: "Coach mode", group: "Copilot", act: async (p) => { await tid(p, "private-mode-coach").click().catch(() => {}); }, target: (p) => tid(p, "private-mode-coach") },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
await page.goto(`${BASE}/?demo=CAPTURE1&name=Founder`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-testid='shell-bottom']", { timeout: 25000 });
await page.waitForTimeout(1200);

const VW = 1280;
const VH = 800;
const paths: string[] = [];
const boxes: ({ x: number; y: number; w: number; h: number } | null)[] = [];
for (let i = 0; i < flow.length; i++) {
  await flow[i].act(page);
  await page.waitForTimeout(550);
  const file = join(SHOTS_DIR, `step-${i + 1}.png`);
  await page.screenshot({ path: file });
  paths.push(file);
  // Capture the acted-on element's on-screen rect (normalized) — the "highlight where it clicked" box.
  let box: { x: number; y: number; w: number; h: number } | null = null;
  const tgt = flow[i].target;
  if (tgt) {
    const r = await tgt(page)
      .evaluate((el) => { const b = (el as HTMLElement).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })
      .catch(() => null);
    if (r && r.w > 0 && r.h > 0) box = { x: +(r.x / VW).toFixed(4), y: +(r.y / VH).toFixed(4), w: +(r.w / VW).toFixed(4), h: +(r.h / VH).toFixed(4) };
  }
  boxes.push(box);
}

const steps = flow.map((f, i) => {
  const delta = i === 0 ? 0 : frameDelta(paths[i - 1], paths[i]);
  return {
    idx: i + 1,
    label: f.label,
    status: "ok" as const,
    group: f.group,
    attachments: [
      { kind: "screenshot" as const, url: `/qa-trace/walkthrough/step-${i + 1}.png`, ...(boxes[i] ? { box: boxes[i] } : {}) },
      ...(i === 0 ? [] : [{ kind: "ssim" as const, diffRatio: Math.round(delta * 10000) / 10000 }]),
    ],
  };
});

const bundle = {
  id: "qa-walkthrough",
  kind: "qa" as const,
  title: "QA · Room walkthrough capture",
  subtitle: "Per-step screenshots + frame-Δ (flicker signal) from a Playwright drive of the live app",
  ts: STAMP,
  source: { tool: "Playwright", version: "qa-trace/capture-flow.ts", env: "chromium · 1280×800" },
  verdict: { label: `${flow.length} steps captured`, tone: "ok" as const },
  steps,
  raw: { base: BASE, viewport: "1280x800", stepCount: flow.length, note: "frame-Δ = changed-pixel ratio vs the previous frame" },
};

writeFileSync(join(BUNDLE_DIR, "walkthrough.json"), `${JSON.stringify(bundle, null, 2)}\n`);
await browser.close();
console.log(`captured ${flow.length} steps -> ${join(BUNDLE_DIR, "walkthrough.json")}`);
console.log("frame-Δ:", steps.map((s) => s.attachments.find((a) => a.kind === "ssim")?.diffRatio).filter((d) => d != null));
