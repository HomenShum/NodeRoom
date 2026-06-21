// Capture slide-anim.html to a presentation MP4 + a looping GIF (two-pass palette, ffmpeg).
//   node scripts/inference-nodetrace/shoot-gif.mjs <dir>
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const dir = path.join(process.cwd(), process.argv[2] || 'scripts/inference-nodetrace/out');
const url = pathToFileURL(path.join(dir, 'slide-anim.html')).href;
const vdir = path.join(dir, 'video');
fs.rmSync(vdir, { recursive: true, force: true });
fs.mkdirSync(vdir, { recursive: true });

let browser; try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'msedge' }); }
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: vdir, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(12500); // one full reveal cycle
await ctx.close(); // flush video
await browser.close();

const webm = path.join(vdir, fs.readdirSync(vdir).find((f) => f.endsWith('.webm')));
const mp4 = path.join(dir, 'walkthrough.mp4');
const gif = path.join(dir, 'walkthrough.gif');
const pal = path.join(vdir, 'palette.png');
execFileSync('ffmpeg', ['-y', '-i', webm, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=1280:-2', mp4], { stdio: 'ignore' });
execFileSync('ffmpeg', ['-y', '-i', webm, '-vf', 'fps=15,scale=920:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff', pal], { stdio: 'ignore' });
execFileSync('ffmpeg', ['-y', '-i', webm, '-i', pal, '-lavfi', 'fps=15,scale=920:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', '-loop', '0', gif], { stdio: 'ignore' });
const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0);
console.log(`wrote walkthrough.mp4 (${kb(mp4)}KB) + walkthrough.gif (${kb(gif)}KB)`);
