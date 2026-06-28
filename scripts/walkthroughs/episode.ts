/**
 * Episode assembler — turns an episode's storyboard + voiceover timings + ready-scene MP4s into
 * `remotion/episode.data.js` (consumed by remotion/Episode.tsx) and stages the assets into
 * remotion/public/{audio,video}. Staged scenes (no captures yet) render as styled cards — honest
 * interim treatment: real narration over real claims, no fake app footage.
 *
 * Run:  npx tsx scripts/walkthroughs/episode.ts noderoom-live-collab-v1
 * Then: npx remotion render remotion/index.ts episode-short episodes/<id>/renders/short.mp4 --codec=h264
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FPS = 30;
const episodeId = process.argv[2] ?? "noderoom-live-collab-v1";
const epDir = join(ROOT, "episodes", episodeId);

type SceneIn = {
  id: string; type: string; status: string; narration: string; source?: string;
  render?: string; codeFile?: string; codeStart?: string; codeEnd?: string; codeTitle?: string; callouts: string[];
};
function parseScenes(yaml: string): SceneIn[] {
  const out: SceneIn[] = [];
  let cur: SceneIn | null = null;
  for (const line of yaml.split(/\r?\n/)) {
    const id = line.match(/^\s+-\s+id:\s*(\S+)/);
    if (id) { cur = { id: id[1], type: "", status: "ready", narration: "", callouts: [] }; out.push(cur); continue; }
    if (!cur) continue;
    const t = line.match(/^\s+type:\s*(\S+)/); if (t) cur.type = t[1];
    const st = line.match(/^\s+status:\s*(\w+)/); if (st) cur.status = st[1];
    const n = line.match(/^\s+narration:\s*"(.+)"\s*$/); if (n) cur.narration = n[1];
    const s = line.match(/^\s+source:\s*(\S+)/); if (s) cur.source = s[1];
    const r = line.match(/^\s+render:\s*(\S+)/); if (r) cur.render = r[1];
    const cf = line.match(/^\s+codeFile:\s*(\S+)/); if (cf) cur.codeFile = cf[1];
    const cs = line.match(/^\s+codeStart:\s*"(.+)"/); if (cs) cur.codeStart = cs[1];
    const ce = line.match(/^\s+codeEnd:\s*"(.+)"/); if (ce) cur.codeEnd = ce[1];
    const ct = line.match(/^\s+codeTitle:\s*"(.+)"/); if (ct) cur.codeTitle = ct[1];
    const co = line.match(/^\s+callout:\s*"(.+)"/); if (co) cur.callouts.push(co[1]);
  }
  return out;
}

/** Pull the REAL lines from the repo between two anchor strings — the video shows what's in the
 *  codebase at render time, so the code scene can never drift from reality. */
function extractCode(file: string, startAnchor: string, endAnchor: string, maxLines = 22): string[] {
  const lines = readFileSync(join(ROOT, file), "utf8").split(/\r?\n/);
  const s = lines.findIndex((l) => l.includes(startAnchor));
  if (s < 0) { console.warn(`[episode] code anchor not found: ${startAnchor}`); return []; }
  let e = lines.findIndex((l, i) => i > s && l.includes(endAnchor));
  if (e < 0) e = s + maxLines;
  return lines.slice(s, Math.min(e + 1, s + maxLines)).map((l) => l.replace(/\t/g, "  "));
}

// Card content for staged scenes — the honest interim treatment (claims, not fake footage).
const CARDS: Record<string, { title: string; bullets: string[] }> = {
  "naive-problem": { title: "The naive demo breaks", bullets: ["Human edits a cell", "Agent writes a stale value", "Silent overwrite — nobody sees it"] },
  "code-before-after": { title: "convex/artifacts.ts — applyCellEditCore", bullets: ["affected-range LOCK gate", "per-element VERSION check (CAS)", "draft / proposal on conflict — never clobber"] },
  "mental-model": { title: "The room is the product", bullets: ["lock → draft → smart merge", "proposal review at the cell", "every edit traced + versioned"] },
  "closing-thesis": { title: "Agents are leaving the chatbox", bullets: ["Shared work surfaces need versions, locks, review", "This video was rendered from the repo that proves it"] },
};

const run = () => {
  const scenes = parseScenes(readFileSync(join(epDir, "storyboard.yaml"), "utf8"));
  const timings = JSON.parse(readFileSync(join(epDir, "voiceover", "timings.json"), "utf8")) as Record<string, { narrationSec: number }>;
  mkdirSync(join(ROOT, "remotion", "public", "audio"), { recursive: true });
  mkdirSync(join(ROOT, "remotion", "public", "video"), { recursive: true });

  const out = [];
  for (const s of scenes) {
    if (!s.narration) continue;
    const nar = timings[s.id]?.narrationSec ?? 4;
    // visual must outlast narration (+1.2s breath); video scenes get a bit more room to read
    const durSec = Math.max(nar + 1.2, s.source ? Math.min(nar + 4.5, 11) : nar + 1.6);
    const mp3 = join(epDir, "voiceover", `${s.id}.mp3`);
    let audio: string | null = null;
    if (existsSync(mp3)) { copyFileSync(mp3, join(ROOT, "remotion", "public", "audio", `${s.id}.mp3`)); audio = `audio/${s.id}.mp3`; }
    let video: string | null = null;
    if (s.source && s.status === "ready") {
      const src = join(ROOT, s.source);
      if (existsSync(src)) { copyFileSync(src, join(ROOT, "remotion", "public", "video", `${s.id}.mp4`)); video = `video/${s.id}.mp4`; }
      else console.warn(`[episode] MISSING source for ready scene ${s.id}: ${s.source}`);
    }
    // Scene kind: live video when footage exists; otherwise a real-code panel, an animated
    // diagram, or a claim card — whichever the storyboard asks for.
    const kind = video ? "video" : s.render === "code" ? "code" : s.render === "diagram" ? "diagram" : "card";
    const code = kind === "code" && s.codeFile && s.codeStart && s.codeEnd
      ? { title: s.codeTitle ?? s.codeFile, lines: extractCode(s.codeFile, s.codeStart, s.codeEnd) }
      : null;
    out.push({
      id: s.id, kind, video, audio, code,
      durationInFrames: Math.round(durSec * FPS),
      narration: s.narration,
      card: s.callouts.length ? { title: s.codeTitle ?? CARDS[s.id]?.title ?? s.id, bullets: s.callouts } : (CARDS[s.id] ?? { title: s.id, bullets: [] }),
    });
  }
  // Background music bed: per-episode override (episodes/<id>/music.mp3) wins, else the shared ambient
  // pad (assets/audio/episode-bed.mp3, an original ffmpeg-generated track — no licensing risk).
  let music: string | null = null;
  const bedSrc = existsSync(join(epDir, "music.mp3")) ? join(epDir, "music.mp3") : join(ROOT, "assets", "audio", "episode-bed.mp3");
  if (existsSync(bedSrc)) { copyFileSync(bedSrc, join(ROOT, "remotion", "public", "audio", "bed.mp3")); music = "audio/bed.mp3"; }
  else console.warn("[episode] no music bed (assets/audio/episode-bed.mp3) — rendering without music");

  const total = out.reduce((a, s) => a + s.durationInFrames, 0);
  const titleMatch = readFileSync(join(epDir, "storyboard.yaml"), "utf8").match(/^\s+title:\s*"(.+)"/m);
  const data = { episodeId, fps: FPS, title: titleMatch?.[1] ?? episodeId, scenes: out, totalFrames: total, music };
  writeFileSync(join(ROOT, "remotion", "episode.data.js"), `// AUTO-GENERATED by scripts/walkthroughs/episode.ts\nexport default ${JSON.stringify(data, null, 2)};\n`);
  console.log(`[episode] ${out.length} scenes · ${(total / FPS).toFixed(1)}s total${music ? " · music bed ✓" : " · no music"} → remotion/episode.data.js`);
};
run();
