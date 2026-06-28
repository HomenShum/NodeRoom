/**
 * One-command episode build: voiceover → assemble → render → judge for <episodeId>.
 *
 * Run:  npx tsx scripts/walkthroughs/episode-cli.ts <episodeId> [--skip-voiceover] [--skip-judge]
 *   or: npm run episode -- <episodeId> [--skip-voiceover] [--skip-judge]
 *
 * --skip-voiceover : reuse existing episodes/<id>/voiceover/*.mp3 (no TTS spend / no key needed).
 * --skip-judge     : skip the Gemini video judge (no GEMINI key needed).
 * Capture footage for app_capture scenes is refreshed separately (npm run walkthroughs <id> + :render).
 */
import { execSync } from "node:child_process";

const id = process.argv[2];
const flags = process.argv.slice(3);
if (!id) { console.error("usage: episode-cli.ts <episodeId> [--skip-voiceover] [--skip-judge]"); process.exit(1); }

const run = (cmd: string) => { console.log(`\n$ ${cmd}`); execSync(cmd, { stdio: "inherit" }); };

if (!flags.includes("--skip-voiceover")) run(`npx tsx scripts/walkthroughs/voiceover.ts ${id}`);
run(`npx tsx scripts/walkthroughs/episode.ts ${id}`);
run(`npx tsx scripts/walkthroughs/render-episode.ts ${id}`);
if (!flags.includes("--skip-judge")) run(`npx tsx scripts/walkthroughs/judge-video.ts ${id}`);
console.log(`\n[episode] ${id} done — episodes/${id}/renders/short.mp4`);
