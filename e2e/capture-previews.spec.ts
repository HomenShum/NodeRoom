/**
 * REAL-APP workflow previews. Unlike the trace-replay previews (scripts/render-workflow-preview.ts,
 * which draw a synthetic sheet from trace JSON), these screenshot the ACTUAL NodeRoom 4-panel UI as
 * the real agent runtime drives a workflow, and encode the real DOM frames into a looping GIF.
 *
 * Memory mode (/?mode=memory) runs the same UI + the same agent runtime/tools against the in-memory
 * engine — real pixels, no backend, reproducible. Output: docs/eval/workflow-previews/app-*.gif.
 *
 * Encoding discipline (gemini GIF-judge findings, 2026-06-11): consecutive IDENTICAL frames are
 * deduped into one held frame (no dead-air loops), and every kept frame displays >= 600ms so a
 * burst of agent steps stays readable. The judge (`npm run qa:gif`) scores the shipped .gif.
 *
 *   npx playwright test capture-previews
 */
import { createHash } from "node:crypto";
import { test, expect } from "./fixtures";
import { enterDemoRoom } from "./fixtures";
import gifenc from "gifenc";
import pngjs from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page, Locator } from "@playwright/test";
const { GIFEncoder, quantize, applyPalette } = gifenc as unknown as typeof import("gifenc");
const { PNG } = pngjs as unknown as typeof import("pngjs");

const OUT = "docs/eval/workflow-previews";
const MIN_FRAME_MS = 900;
/** Frames differing in <0.35% of pixels are "the same moment" — the live activity ticker churns a
 *  few pixels every tick, which defeats exact-hash dedupe and ships dead-air near-duplicates. */
const SAME_FRAME_PIXEL_RATIO = 0.012;

type Frame = { buf: Buffer; delay: number };

function pixelDiffRatio(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return 1;
  let diff = 0;
  const total = pa.width * pa.height;
  for (let i = 0; i < pa.data.length; i += 4) {
    if (Math.abs(pa.data[i] - pb.data[i]) > 8 || Math.abs(pa.data[i + 1] - pb.data[i + 1]) > 8 || Math.abs(pa.data[i + 2] - pb.data[i + 2]) > 8) diff++;
  }
  return diff / total;
}

/** Dedupe consecutive same-moment frames (extend the hold instead) + floor per-frame display time. */
function dedupe(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  let lastHash = "";
  for (const f of frames) {
    const h = createHash("sha1").update(f.buf).digest("hex");
    const sameExact = h === lastHash;
    const sameFuzzy = !sameExact && out.length > 0 && pixelDiffRatio(out[out.length - 1].buf, f.buf) < SAME_FRAME_PIXEL_RATIO;
    if ((sameExact || sameFuzzy) && out.length) { out[out.length - 1].delay += f.delay; lastHash = h; continue; }
    lastHash = h;
    out.push({ buf: f.buf, delay: Math.max(f.delay, MIN_FRAME_MS) });
  }
  return out;
}

function encodeGif(rawFrames: Frame[], file: string): number {
  const frames = dedupe(rawFrames);
  const enc = GIFEncoder();
  for (const f of frames) {
    const png = PNG.sync.read(f.buf);
    const data = new Uint8Array(png.data);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    enc.writeFrame(index, png.width, png.height, { palette, delay: f.delay });
  }
  enc.finish();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${file}`, enc.bytes());
  return frames.length;
}

function shooter(target: Locator) {
  const frames: Frame[] = [];
  return {
    frames,
    shoot: async (delay: number) => { frames.push({ buf: await target.screenshot({ type: "png" }), delay }); },
    /** Burst capture during an agent run: real-time cadence; dedupe collapses idle stretches. */
    burst: async (page: Page, shots: number, cadenceMs = 130) => {
      for (let i = 0; i < shots; i++) {
        await page.waitForTimeout(cadenceMs);
        frames.push({ buf: await target.screenshot({ type: "png" }), delay: cadenceMs });
      }
    },
  };
}

test.use({ viewport: { width: 1860, height: 900 } });

test("real-app preview — Room NodeAgent fills the variance column (lock → CAS → release)", async ({ page }) => {
  await enterDemoRoom(page);
  const panel = page.getByTestId("artifact-panel");
  await expect(panel).toBeVisible();

  const cam = shooter(panel);
  await cam.shoot(1500);                    // before: empty variance cells
  await page.evaluate(() => (window as any).__runCollab()); // the real agent runtime starts (scripted model, in-memory engine)
  await cam.burst(page, 24);                // during: lock → read → CAS-edit per cell, trace growing
  await page.waitForTimeout(700);
  await cam.shoot(2000);                    // settled: cells filled, trace receipts, collab "done"

  const kept = encodeGif(cam.frames, "app-variance-fill.gif");
  expect(kept).toBeGreaterThan(3);
  console.log(`captured ${kept} deduped real-app frames -> ${OUT}/app-variance-fill.gif`);
});

test("real-app preview — GTM research enrichment (source-backed CellPayload)", async ({ page }) => {
  await enterDemoRoom(page);
  await page.locator(".r-tab", { hasText: /Research/i }).first().click();
  const panel = page.getByTestId("artifact-panel");
  await expect(panel).toBeVisible();
  const enrich = page.getByTestId("research-enrich");
  await expect(enrich).toBeVisible();

  const cam = shooter(panel);
  await cam.shoot(1500);                    // before: pending accounts, "Enrich N pending"
  if (await enrich.isEnabled()) {
    await enrich.click();                   // scripted research agent enriches pending rows
    await cam.burst(page, 30, 110);
  }
  await page.waitForTimeout(700);
  await cam.shoot(2000);
  const kept = encodeGif(cam.frames, "app-research-enrich.gif");
  expect(kept).toBeGreaterThan(2);
  console.log(`captured ${kept} deduped real-app frames -> ${OUT}/app-research-enrich.gif`);
});

test("real-app preview — @nodeagent reconcile drives the sheet through chat (chat + sheet framing)", async ({ page }) => {
  await enterDemoRoom(page);
  const chatPanel = page.getByTestId("public-chat-panel");
  const artifact = page.getByTestId("artifact-panel");
  await expect(artifact).toBeVisible();

  // Frame the union of the chat and artifact panels — the @nodeagent story lives in BOTH.
  const a = await chatPanel.boundingBox();
  const b = await artifact.boundingBox();
  if (!a || !b) throw new Error("panel bounding boxes unavailable");
  const clip = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
    height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
  };
  const frames: Frame[] = [];
  const shoot = async (delay: number) => { frames.push({ buf: await page.screenshot({ type: "png", clip }), delay }); };

  await shoot(1500);                        // before: composer empty, variance cells empty
  const composer = chatPanel.getByTestId("chat-composer");
  await composer.fill("@nodeagent diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps");
  await shoot(1200);                        // the typed @nodeagent request visible
  await composer.press("Enter");            // the real agent runtime picks it up
  for (let i = 0; i < 26; i++) { await page.waitForTimeout(130); frames.push({ buf: await page.screenshot({ type: "png", clip }), delay: 130 }); }
  await page.waitForTimeout(800);
  await shoot(2200);                        // settled: agent reply in chat + filled cells in sheet
  const kept = encodeGif(frames, "app-ask-reconcile.gif");
  expect(kept).toBeGreaterThan(3);
  console.log(`captured ${kept} deduped real-app frames -> ${OUT}/app-ask-reconcile.gif`);
});

test("real-app preview — review mode: agent edits arrive as proposals, host approves", async ({ page }) => {
  await enterDemoRoom(page);
  const panel = page.getByTestId("artifact-panel");
  await expect(panel).toBeVisible();

  // Turn auto-allow OFF -> every agent write becomes an inline proposal needing approval.
  // (agent-commits moved into the settings panel for design-target parity — open it to toggle.)
  await page.getByTestId("room-settings-btn").click();
  await page.getByTestId("auto-allow-switch").click();
  await page.getByTestId("room-settings-btn").click();

  // Sheet area only — proposal chips, approve buttons, and the committed value all live here;
  // the ticker below churns pixels that defeat dedupe and judge as frozen dead air.
  const cam = shooter(panel.locator(".r-art-body"));
  await cam.shoot(1500);                    // before: auto-allow off, cells empty
  await page.evaluate(() => (window as any).__runCollab());
  await cam.burst(page, 14);                // agent works; writes land as pending proposals
  await expect(panel.locator('[data-testid="proposal-inline"]').first()).toBeVisible({ timeout: 15_000 });
  await cam.shoot(1800);                    // proposals visible inline
  await panel.locator('[data-testid="proposal-inline-approve"]').first().click();
  await cam.burst(page, 3, 200);            // the approved value commits through CAS
  await cam.shoot(2200);                    // one approved + committed, others still pending
  const kept = encodeGif(cam.frames, "app-proposals-review.gif");
  expect(kept).toBeGreaterThan(3);
  console.log(`captured ${kept} deduped real-app frames -> ${OUT}/app-proposals-review.gif`);
});
