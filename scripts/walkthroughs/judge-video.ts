/**
 * Video judge — Gemini video understanding watches the RENDERED episode and scores it against the
 * episode-eval rubric (clarity, pacing, caption/narration sync, audio, secrets, proof-vs-marketing
 * feel), returning timestamped defects. The render is no longer human-eyes-only.
 *
 * Run:  npx tsx scripts/walkthroughs/judge-video.ts noderoom-live-collab-v1 [renders/short.mp4]
 * Key:  GOOGLE_GENERATIVE_AI_API_KEY (env → .env.local). Model: gemini-3.5-flash (override via
 *       GEMINI_JUDGE_MODEL). Video sent inline (<20MB) — short verticals fit comfortably.
 * Out:  episodes/<id>/judge.md (+ raw judge.json)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const episodeId = process.argv[2] ?? "noderoom-live-collab-v1";
const rel = process.argv[3] ?? "renders/short.mp4";
const epDir = join(ROOT, "episodes", episodeId);
const videoPath = join(epDir, rel);

function key(): string {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const m = readFileSync(join(ROOT, ".env.local"), "utf8").match(/^GOOGLE_GENERATIVE_AI_API_KEY=(.+)$/m);
  if (!m) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not found");
  return m[1].trim();
}

const RUBRIC = `You are judging a 55-second vertical (1080x1920) software explainer video for an
engineering audience. It mixes REAL app screen-captures (a collaborative spreadsheet app with an
AI agent) with dark "claim cards" (title + bullets), a narrator voiceover, on-screen caption
boxes, a title header, and a progress bar.

Score each dimension 0-2 (0=fails, 1=acceptable, 2=strong) WITH specific evidence + timestamps:
1. state_clarity - can a viewer follow each scene's story (what's happening, what changed)?
2. caption_sync - do on-screen captions match the narration heard and the visuals shown?
3. pacing - any scene too fast to read or with dead air? Does the FIRST 5 seconds show the visual promise?
4. audio - narration clear, levels consistent, no clipping/overlap/gaps between scenes?
5. legibility - app footage and small text readable at phone size? captions large enough?
6. proof_feel - does it feel like evidence (real app, real states) rather than marketing gloss?
7. safety - any visible secrets, API keys, tokens, real personal data? (room codes like GIF-XXXX are fine)
8. restraint - tone is "quiet competence": no overclaiming, no hype language?

Then list DEFECTS: each with timestamp, severity (P0 blocks publishing / P1 fix soon / P2 polish),
what you observed, and a concrete fix. Finally an overall verdict: publish | fix-then-publish | rework.

Return STRICT JSON: {"scores":{"state_clarity":{"score":n,"evidence":"..."},...},
"defects":[{"ts":"m:ss","severity":"P0|P1|P2","observed":"...","fix":"..."}],
"verdict":"...","summary":"2-3 sentences"}`;

const run = async () => {
  if (!existsSync(videoPath)) throw new Error(`missing ${videoPath}`);
  const bytes = readFileSync(videoPath);
  console.log(`[judge] ${rel} — ${(bytes.length / 1048576).toFixed(1)}MB → gemini`);
  const model = process.env.GEMINI_JUDGE_MODEL ?? "gemini-3.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: "video/mp4", data: bytes.toString("base64") } },
        { text: RUBRIC },
      ] }],
      generationConfig: { temperature: 0.2, response_mime_type: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  // Gemini occasionally wraps the JSON in prose/code-fences or emits it twice — take the FIRST
  // balanced {...} object so the judge doesn't crash on otherwise-valid output.
  const extractJson = (s: string): string => {
    const a = s.indexOf("{"); if (a < 0) return s;
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return s.slice(a, i + 1);
    }
    return s.slice(a);
  };
  const judge = JSON.parse(extractJson(text));
  writeFileSync(join(epDir, "judge.json"), JSON.stringify(judge, null, 2));

  const scores = Object.entries(judge.scores as Record<string, { score: number; evidence: string }>);
  const total = scores.reduce((a, [, v]) => a + v.score, 0);
  const md = [
    `# Video judge — ${episodeId} / ${rel}`,
    ``,
    `**Judge:** ${model} (video understanding) · **Verdict:** ${judge.verdict} · **Score:** ${total}/${scores.length * 2}`,
    ``,
    `> ${judge.summary}`,
    ``,
    `| Dimension | Score | Evidence |`,
    `|---|---|---|`,
    ...scores.map(([k, v]) => `| ${k} | ${v.score}/2 | ${v.evidence} |`),
    ``,
    `## Defects`,
    ...(judge.defects?.length
      ? judge.defects.map((d: { ts: string; severity: string; observed: string; fix: string }) => `- **${d.severity} @ ${d.ts}** — ${d.observed} → *${d.fix}*`)
      : ["(none found)"]),
  ].join("\n");
  writeFileSync(join(epDir, "judge.md"), md + "\n");
  console.log(md);
};
void run().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
