/**
 * Voiceover stage — TTS for an episode's scene narrations + the timing-reconciliation pass
 * (narration length vs planned scene duration; flag scenes to lengthen/split).
 *
 * Run:  npx tsx scripts/walkthroughs/voiceover.ts noderoom-live-collab-v1
 * Provider: ElevenLabs when ELEVENLABS_API_KEY is set, else OpenAI TTS when OPENAI_API_KEY is set.
 * Key resolution for each: env → ./.env.local → ../nodebench-ai/.env.local (shared secrets).
 * Keys are never printed or written anywhere.
 * Voice: ELEVENLABS_VOICE_ID (default George) / OPENAI_TTS_VOICE (default onyx) — calm narrator.
 * Outputs: episodes/<id>/voiceover/<scene>.mp3 + timings.json (real durations via ffprobe).
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const episodeId = process.argv[2];
if (!episodeId) { console.error("usage: voiceover.ts <episodeId>"); process.exit(1); }
const epDir = join(ROOT, "episodes", episodeId);

/** Resolve any secret from env → ./.env.local → ../nodebench-ai/.env.local. Never printed. */
function fromEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name]!.trim();
  for (const p of [join(ROOT, ".env.local"), join(ROOT, "..", "nodebench-ai", ".env.local")]) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) return m[1].trim();
  }
  return undefined;
}

type Tts = { provider: "elevenlabs" | "openai"; key: string } | { provider: "windows_sapi" };
/** ElevenLabs preferred; fall back to OpenAI TTS when only OPENAI_API_KEY is available. */
function resolveTts(): Tts {
  if (process.argv.includes("--local") || process.env.LOCAL_TTS === "1") {
    if (process.platform !== "win32") throw new Error("--local voiceover currently requires Windows SAPI");
    return { provider: "windows_sapi" };
  }
  const el = fromEnv("ELEVENLABS_API_KEY");
  if (el) return { provider: "elevenlabs", key: el };
  const oa = fromEnv("OPENAI_API_KEY");
  if (oa) return { provider: "openai", key: oa };
  throw new Error("No TTS key — set ELEVENLABS_API_KEY or OPENAI_API_KEY (env, .env.local, ../nodebench-ai/.env.local)");
}

/** One narration → mp3 bytes, via whichever provider resolved. Calm narrator voice both ways. */
async function synth(tts: Tts, text: string): Promise<Buffer> {
  if (tts.provider === "windows_sapi") return synthWindowsSapi(text);
  if (tts.provider === "elevenlabs") {
    const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"; // George — calm narrator
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": tts.key, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2 } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} ${(await res.text()).slice(0, 160)}`);
    return Buffer.from(await res.arrayBuffer());
  }
  // OpenAI TTS — gpt-4o-mini-tts honors delivery instructions; "onyx" = deep, calm narrator.
  const voice = process.env.OPENAI_TTS_VOICE ?? "onyx";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${tts.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voice, input: text, response_format: "mp3",
      instructions: "Calm, measured, confident product narrator. Quiet competence — unhurried, clear diction, warm but precise. No hype.",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status} ${(await res.text()).slice(0, 160)}`);
  return Buffer.from(await res.arrayBuffer());
}

function synthWindowsSapi(text: string): Buffer {
  const temp = mkdtempSync(join(tmpdir(), "noderoom-voiceover-"));
  const wav = join(temp, "voice.wav");
  const mp3 = join(temp, "voice.mp3");
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$speaker.SelectVoice($env:NODEROOM_TTS_VOICE)",
    "$speaker.Rate = [int]$env:NODEROOM_TTS_RATE",
    "$speaker.Volume = 100",
    "$speaker.SetOutputToWaveFile($env:NODEROOM_TTS_WAV)",
    "$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:NODEROOM_TTS_TEXT_B64))",
    "$speaker.Speak($text)",
    "$speaker.Dispose()",
  ].join("; ");
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODEROOM_TTS_VOICE: process.env.WINDOWS_TTS_VOICE ?? "Microsoft David Desktop",
        NODEROOM_TTS_RATE: process.env.WINDOWS_TTS_RATE ?? "-1",
        NODEROOM_TTS_WAV: wav,
        NODEROOM_TTS_TEXT_B64: Buffer.from(text, "utf8").toString("base64"),
      },
    });
    if ((result.status ?? 1) !== 0) throw new Error(`Windows SAPI failed: ${result.stderr.trim()}`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "3", mp3]);
    return readFileSync(mp3);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Minimal parser for OUR storyboard.yaml shape — scene id + narration + status lines. */
function parseScenes(yaml: string): Array<{ id: string; narration: string; status: string }> {
  const scenes: Array<{ id: string; narration: string; status: string }> = [];
  let cur: { id: string; narration: string; status: string } | null = null;
  for (const line of yaml.split(/\r?\n/)) {
    const id = line.match(/^\s+-\s+id:\s*(\S+)/);
    if (id) { cur = { id: id[1], narration: "", status: "ready" }; scenes.push(cur); continue; }
    if (!cur) continue;
    const nar = line.match(/^\s+narration:\s*"(.+)"\s*$/);
    if (nar) cur.narration = nar[1];
    const st = line.match(/^\s+status:\s*(\w+)/);
    if (st) cur.status = st[1];
  }
  return scenes.filter((s) => s.narration);
}

const run = async () => {
  const tts = resolveTts();
  const scenes = parseScenes(readFileSync(join(epDir, "storyboard.yaml"), "utf8"));
  const outDir = join(epDir, "voiceover");
  mkdirSync(outDir, { recursive: true });
  const timings: Record<string, { narrationSec: number; chars: number; status: string }> = {};
  console.log(`[voiceover] provider: ${tts.provider} · ${scenes.length} narrated scenes`);

  for (const s of scenes) {
    const mp3 = join(outDir, `${s.id}.mp3`);
    writeFileSync(mp3, await synth(tts, s.narration));
    const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${mp3}"`).toString().trim());
    timings[s.id] = { narrationSec: Math.round(dur * 10) / 10, chars: s.narration.length, status: s.status };
    console.log(`[voiceover] ${s.id} — ${timings[s.id].narrationSec}s (${s.status})`);
  }

  writeFileSync(join(outDir, "timings.json"), JSON.stringify(timings, null, 2));
  // Timing reconciliation: a scene's visual must outlast its narration (+0.5s breath); flag misfits.
  console.log("\n[reconcile] narration vs scene budget (visual must outlast narration):");
  for (const [id, t] of Object.entries(timings)) {
    const note = t.narrationSec > 12 ? "LONG — consider splitting the scene" : t.narrationSec < 2.5 ? "short — fine for a beat" : "ok";
    console.log(`  ${id.padEnd(20)} ${String(t.narrationSec).padStart(5)}s  ${note}`);
  }
  console.log(`\n[voiceover] done → ${outDir}`);
};
void run().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
