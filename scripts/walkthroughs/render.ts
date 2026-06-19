/**
 * Render every captured (non-skipped) walkthrough to docs/walkthroughs/<id>.mp4
 * and docs/walkthroughs/<id>.gif.
 *
 * Two-stage encode (ported from HomenShum/feature-walkthrough-gif): Remotion renders lossless-ish
 * H.264 at full comp res, then ffmpeg (system binary when available) does a two-pass palette
 * GIF — fps=12, lanczos scale to 896w, palettegen stats_mode=diff + paletteuse bayer dither with
 * diff_mode=rectangle (static panels don't re-dither → dramatically smaller files than direct
 * --codec=gif). Target small GIFs, but large walkthroughs may exceed 10MB; the MP4 is the
 * preferred compact asset.
 *
 * Run:  npx tsx scripts/walkthroughs/render.ts [featureIds…]
 */
import { execSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const only = process.argv.slice(2);
const REMOTION_RENDER_PORT = process.env.REMOTION_RENDER_PORT ?? "3997";
const FILTER = "fps=12,scale=896:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle";

// SYSTEM ffmpeg required for the palette pass — Remotion's bundled ffmpeg is a minimal build
// without fps/palettegen filters. Without a system ffmpeg we fall back to direct --codec=gif
// (bigger files, still correct).
function hasSystemFfmpeg(): boolean {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); return true; } catch { return false; }
}

const run = async () => {
  const data = (await import("file://" + join(ROOT, "remotion", "walkthrough.data.js"))).default as {
    features: Array<{ id: string; skipped: boolean; segments: unknown[] }>;
  };
  mkdirSync(join(ROOT, "docs", "walkthroughs"), { recursive: true });
  const targets = data.features.filter((f) => !f.skipped && f.segments.length && (!only.length || only.includes(f.id)));
  const ffmpeg = hasSystemFfmpeg();
  if (!ffmpeg) console.log("[render] no system ffmpeg — falling back to direct --codec=gif (larger files)");
  for (const f of targets) {
    const gif = join("docs", "walkthroughs", `${f.id}.gif`);
    console.log(`[render] ${f.id} → ${gif}`);
    if (ffmpeg) {
      // The MP4 is a first-class output (episode/social cuts, 60–90% smaller than the GIF),
      // not a temp file — kept beside the GIF, gitignored (regenerable).
      const mp4 = join("docs", "walkthroughs", `${f.id}.mp4`);
      execSync(`npx remotion render remotion/index.ts ${f.id} ${mp4} --codec=h264 --crf=16 --port=${REMOTION_RENDER_PORT}`, { stdio: "inherit" });
      execSync(`ffmpeg -y -i ${mp4} -vf "${FILTER}" -loop 0 ${gif}`, { stdio: "inherit" });
    } else {
      execSync(`npx remotion render remotion/index.ts ${f.id} ${gif} --codec=gif --every-nth-frame=2 --scale=0.7 --port=${REMOTION_RENDER_PORT}`, { stdio: "inherit" });
    }
    console.log(`[render] ${f.id} done — ${(statSync(join(ROOT, gif)).size / 1024 / 1024).toFixed(2)} MB`);
  }
  const skipped = data.features.filter((f) => f.skipped);
  if (skipped.length) console.log(`[render] SKIPPED (recapture needed): ${skipped.map((f) => f.id).join(", ")}`);
};
void run();
