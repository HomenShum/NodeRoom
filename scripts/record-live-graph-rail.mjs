/**
 * record-live-graph-rail.mjs — recorded proof clip for the README.
 *
 * Same drive as scripts/capture-live-graph-rail.mjs (the evidence gate), but
 * records the whole session with Playwright recordVideo: enter the keyless
 * memory-mode demo room, OPEN the live graph rail first, then run the real
 * collaboration scenario (window.__runCollab — locks, edits, drafts,
 * proposals through the engine) so the rail populates ON CAMERA. Requires
 * 13+ entities from real room events or exits nonzero, then converts the
 * .webm to the committed GIF + MP4 with local ffmpeg.
 *
 *   node scripts/record-live-graph-rail.mjs          # keyless memory-mode demo room
 *   node scripts/record-live-graph-rail.mjs --live   # LIVE Convex tier (needs VITE_CONVEX_URL in .env.local)
 *
 * --live records the real product against the Convex deployment: create a live
 * sample room (Convex mutations seed artifacts + refs-carrying traces), then run
 * the real keyless interactions (__runCollab starts a durable agentJob whose
 * intent traces flow back through Convex; __runConflictDrill files a real
 * proposal). Gate: entities AND edges must appear on the rail or exit nonzero.
 *
 * Outputs: docs/release/media/live-graph-rail.gif (README embed, <=8MB)
 *          docs/release/media/live-graph-rail.mp4
 *          (--live: live-graph-rail-live.gif / .mp4)
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const LIVE = process.argv.includes("--live");
const PORT = LIVE ? 5275 : 5273;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = "docs/release/media";
const GIF = `${OUT_DIR}/live-graph-rail${LIVE ? "-live" : ""}.gif`;
const MP4 = `${OUT_DIR}/live-graph-rail${LIVE ? "-live" : ""}.mp4`;
// Memory replays the full 34-event collab script (13+ entities). The keyless live
// scenario is smaller: seeded artifacts + agent intent + drill proposal — require
// a populated graph (entities AND edges) rather than the memory count.
const MIN_ENTITIES = LIVE ? 4 : 13;
const MIN_EDGES = LIVE ? 1 : 0;
const MAX_SECONDS = 30;

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite dev server did not answer at ${url}`);
}

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  shell: true,
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stopServer);

const videoDir = mkdtempSync(join(tmpdir(), "noderoom-rail-video-"));
let failed = null;
try {
  await waitForServer(BASE);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1600, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/${LIVE ? "?surface=desktop" : "?mode=memory&surface=desktop"}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });

  // Enter a room. Memory: demo room (same path as e2e/fixtures.ts enterDemoRoom).
  // Live: create a sample room — every artifact/trace it seeds is a Convex row.
  const inRoom = await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false);
  if (!inRoom && LIVE) {
    await page.getByTestId("try-sample-room").click({ timeout: 60_000 });
    await page.getByTestId("create-display-name").fill("Host");
    await page.getByTestId("sample-room-submit").click({ timeout: 30_000 });
    await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 120_000 });
  } else if (!inRoom) {
    await page.getByTestId("start-demo-room").click({ timeout: 60_000 });
    const nameInput = page.locator(".r-landing input").first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill("Host");
      await page.keyboard.press("Enter");
    }
    await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 60_000 });
  }

  // Open the rail FIRST so the graph populates on camera.
  await page.getByTestId("live-graph-rail-toggle").click({ timeout: 30_000 });
  await page.getByTestId("live-graph-rail").waitFor({ state: "visible", timeout: 30_000 });

  // Run the REAL collaboration scenario through the engine (locks, edits, drafts, proposals).
  await page.waitForFunction(() => typeof window.__runCollab === "function", undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__runCollab());
  if (LIVE) {
    // Keyless live interaction: a real proposal mutation through Convex.
    await page.evaluate(() => window.__runConflictDrill?.());
  }

  // Require entities (and, live, edges) that came from real room events.
  await page.waitForFunction(({ minEntities, minEdges }) => {
    const el = document.querySelector('[data-testid="live-graph-rail"]');
    return el !== null
      && Number(el.getAttribute("data-entities")) >= minEntities
      && Number(el.getAttribute("data-edges")) >= minEdges;
  }, { minEntities: MIN_ENTITIES, minEdges: MIN_EDGES }, { timeout: 60_000 });
  if (LIVE) await page.waitForTimeout(6_000); // let late Convex trace rows arrive on camera
  await page.waitForTimeout(4_000); // let the ForceAtlas2 layout settle on camera

  const rail = page.getByTestId("live-graph-rail");
  const entities = Number(await rail.getAttribute("data-entities"));
  const edges = Number(await rail.getAttribute("data-edges"));

  const video = page.video();
  await context.close(); // flushes the recording
  await browser.close();
  const webm = await video.path();

  console.log(`recorded${LIVE ? " (LIVE Convex tier)" : ""}: ${entities} entities, ${edges} edges from real room events`);
  if (!(entities >= MIN_ENTITIES)) throw new Error(`rail has ${entities} entities, need >= ${MIN_ENTITIES}`);
  if (!(edges >= MIN_EDGES)) throw new Error(`rail has ${edges} edges, need >= ${MIN_EDGES}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const trim = ["-t", String(MAX_SECONDS)];
  execFileSync("ffmpeg", [
    "-y", "-i", webm, ...trim,
    "-vf", "fps=6,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    GIF,
  ], { stdio: "inherit" });
  execFileSync("ffmpeg", [
    "-y", "-i", webm, ...trim,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", "28", "-an",
    MP4,
  ], { stdio: "inherit" });

  const gifMB = statSync(GIF).size / 1024 / 1024;
  console.log(`gif: ${GIF} (${gifMB.toFixed(2)} MB), mp4: ${MP4} (${(statSync(MP4).size / 1024 / 1024).toFixed(2)} MB)`);
  if (gifMB > 8) throw new Error(`GIF is ${gifMB.toFixed(2)} MB, README budget is 8 MB`);
} catch (err) {
  failed = err;
} finally {
  stopServer();
  rmSync(videoDir, { recursive: true, force: true });
}

if (failed) {
  console.error("record-live-graph-rail FAILED:", failed);
  process.exit(1);
}
