/**
 * Render an assembled episode's `episode-short` Remotion composition to episodes/<id>/renders/short.mp4.
 *
 * Run:  npx tsx scripts/walkthroughs/render-episode.ts <episodeId>
 * Precondition: run voiceover.ts (narration) then episode.ts (assemble) first — they stage audio/video
 * into remotion/public/ and write remotion/episode.data.js (which the composition imports). This script
 * asserts the staged episode.data.js matches <episodeId> so you never render the wrong episode by mistake.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const id = process.argv[2];
if (!id) { console.error("usage: render-episode.ts <episodeId>"); process.exit(1); }

const run = async () => {
  const data = (await import("file://" + join(ROOT, "remotion", "episode.data.js"))).default as { episodeId: string; music?: string | null };
  if (data.episodeId !== id) {
    throw new Error(`staged episode.data.js is "${data.episodeId}", not "${id}" — run: npx tsx scripts/walkthroughs/episode.ts ${id}`);
  }
  const out = join("episodes", id, "renders", "short.mp4");
  mkdirSync(join(ROOT, "episodes", id, "renders"), { recursive: true });
  const port = process.env.REMOTION_RENDER_PORT ?? "3998";
  execSync(`npx remotion render remotion/index.ts episode-short "${out}" --codec=h264 --crf=18 --port=${port}`, { stdio: "inherit" });
  console.log(`[render-episode] ${id} → ${out}${data.music ? " (music bed muxed)" : " (no music)"}`);
};
void run().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
