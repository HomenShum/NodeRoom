/**
 * Gemini GIF judge — every demo GIF must be JUDGED AND VISUALLY VERIFIED by gemini-3.6-flash
 * before "demo ready" can be claimed (standing rule, 2026-06-11).
 *
 * The judge decodes the SHIPPED .gif itself (ImageMagick `-coalesce` for composed frames +
 * `identify` for the real per-frame delays) — the model scores the exact pixels and pacing a
 * viewer gets, regardless of which pipeline produced the GIF (trace replayer, real-app e2e
 * recording, or screenshot slideshow). Sending the .gif bytes straight to the Gemini API is NOT
 * equivalent: the API reads only the first frame (probed 2026-06-11).
 *
 *   npx tsx scripts/judge-demo-gif.ts                      # judge every GIF in workflow-previews
 *   npx tsx scripts/judge-demo-gif.ts finance-model-solve  # judge one
 *
 * Verdicts: docs/eval/gif-judge/<id>.json (committed — scores + issues, no secrets).
 * Pass bar: average >= 7 AND no dimension < 5. A FAIL blocks the "demo ready" claim.
 */
import "./benchmark/loadEnv"; // .env.local -> process.env, must be first
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOWS } from "./workflow-preview/capture";

const JUDGE_MODEL = process.env.GEMINI_JUDGE_MODEL ?? "gemini-3.6-flash";
const GIF_DIR = "docs/eval/workflow-previews";
const OUT_DIR = "docs/eval/gif-judge";
const MAX_FRAMES = 12;
const DIMENSIONS = ["readability", "pacing", "narrative_completeness", "visual_polish", "honesty_no_artifacts"] as const;

type GifMeta = { title: string; subtitle: string };
type Verdict = {
  workflow: string;
  judgeModel: string;
  judgedAt: string;
  frameCount: number;
  sampledFrames: number;
  scores: Record<(typeof DIMENSIONS)[number], number>;
  average: number;
  pass: boolean;
  topIssues: string[];
  fixSuggestions: string[];
};

/** Title/subtitle so the judge knows what each demo CLAIMS to show. */
function metaFor(id: string): GifMeta {
  const wf = WORKFLOWS.find((w) => w.id === id);
  if (wf) return { title: wf.title, subtitle: wf.subtitle };
  const APP: Record<string, GifMeta> = {
    "app-variance-fill": { title: "Variance fill (real app)", subtitle: "The actual NodeRoom UI: agent locks the variance range, fills it with CAS writes, releases" },
    "app-research-enrich": { title: "Research enrichment (real app)", subtitle: "The actual NodeRoom UI: agent fetches sources and writes a sourced research row" },
    "app-ask-reconcile": { title: "/ask reconcile (real app)", subtitle: "The actual NodeRoom UI: the user types /ask in chat and the agent reconciles the sheet with CAS writes" },
    "app-proposals-review": { title: "Review mode proposals (real app)", subtitle: "The actual NodeRoom UI: auto-allow off, agent writes arrive as inline proposals, the host approves one" },
  };
  if (APP[id]) return APP[id];
  try {
    const manifest = JSON.parse(readFileSync(join(GIF_DIR, "manifest.json"), "utf8")) as { previews?: Array<{ id: string; title?: string; userWorkflow?: string }> };
    const entry = manifest.previews?.find((p) => p.id === id);
    if (entry) return { title: entry.title ?? id, subtitle: entry.userWorkflow ?? "" };
  } catch { /* fall through */ }
  return { title: id, subtitle: "" };
}

/** Decode the shipped GIF: coalesced PNG frames + real per-frame delays (centiseconds -> ms). */
function decodeGif(gifPath: string): { frames: Buffer[]; delaysMs: number[] } {
  const idn = spawnSync("magick", ["identify", "-format", "%T\n", gifPath], { encoding: "utf8" });
  if (idn.status !== 0) throw new Error(`magick identify failed for ${gifPath} — is ImageMagick 7 on PATH?\n${idn.stderr}`);
  const delaysMs = idn.stdout.trim().split(/\r?\n/).map((t) => Math.max(10, Number(t) * 10));
  const dir = mkdtempSync(join(tmpdir(), "gif-judge-"));
  try {
    const exp = spawnSync("magick", [gifPath, "-coalesce", join(dir, "%04d.png")], { encoding: "utf8" });
    if (exp.status !== 0) throw new Error(`magick coalesce failed for ${gifPath}\n${exp.stderr}`);
    const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    const frames = files.map((f) => readFileSync(join(dir, f)));
    if (frames.length !== delaysMs.length) throw new Error(`${gifPath}: ${frames.length} frames but ${delaysMs.length} delays — decode mismatch`);
    return { frames, delaysMs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Even sample that always keeps the first and last frame (goal + result). */
function sampleIndices(total: number, max: number): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const idx = new Set<number>([0, total - 1]);
  for (let i = 1; idx.size < max; i++) idx.add(Math.round((i * (total - 1)) / (max - 1)));
  return [...idx].sort((a, b) => a - b);
}

function rubric(meta: GifMeta, delays: number[], picked: number[], total: number): string {
  const pacing = picked.map((i, n) => `frame ${n + 1}: shown ${delays[i]}ms`).join(", ");
  return [
    `You are a strict UI/UX judge for product demo GIFs. This is the "${meta.title}" walkthrough:`,
    `${meta.subtitle}. You are given ${picked.length} frames sampled in order from a`,
    `${total}-frame animated GIF. Viewer pacing: ${pacing}.`,
    ``,
    `Score each dimension 0-10 (10 = ship-quality):`,
    `- readability: is ALL text legible at this size — labels, values, badges, progress text?`,
    `- pacing: given the per-frame display times, can a first-time viewer follow each change?`,
    `- narrative_completeness: do the frames tell goal -> actions -> verified result, no dead air?`,
    `- visual_polish: alignment, spacing, clipping, color contrast, no overlapping elements?`,
    `- honesty_no_artifacts: no rendering glitches, truncated text, ghost frames, or misleading UI?`,
    ``,
    `Be adversarial: name the WORST concrete problems, citing frame numbers. Respond with ONLY a`,
    `JSON object: {"scores": {"readability": n, "pacing": n, "narrative_completeness": n,`,
    `"visual_polish": n, "honesty_no_artifacts": n}, "topIssues": ["frame N: ..."],`,
    `"fixSuggestions": ["..."]}`,
  ].join("\n");
}

async function judge(id: string, gifPath: string): Promise<Verdict> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY missing — the judge cannot run (skipping would be a silent pass).");
  const meta = metaFor(id);
  const { frames, delaysMs } = decodeGif(gifPath);

  const picked = sampleIndices(frames.length, MAX_FRAMES);
  const parts: Array<Record<string, unknown>> = [
    { text: rubric(meta, delaysMs, picked, frames.length) },
    ...picked.map((i) => ({ inline_data: { mime_type: "image/png", data: frames[i].toString("base64") } })),
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let parsed: { scores?: Record<string, number>; topIssues?: string[]; fixSuggestions?: string[] };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json" } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
  } finally {
    clearTimeout(timer);
  }

  const scores = Object.fromEntries(
    DIMENSIONS.map((d) => [d, Math.max(0, Math.min(10, Number(parsed.scores?.[d] ?? 0)))]),
  ) as Verdict["scores"];
  const values = DIMENSIONS.map((d) => scores[d]);
  const average = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  const verdict: Verdict = {
    workflow: id,
    judgeModel: JUDGE_MODEL,
    judgedAt: new Date().toISOString(),
    frameCount: frames.length,
    sampledFrames: picked.length,
    scores,
    average,
    pass: average >= 7 && Math.min(...values) >= 5,
    topIssues: (parsed.topIssues ?? []).slice(0, 5).map(String),
    fixSuggestions: (parsed.fixSuggestions ?? []).slice(0, 5).map(String),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(verdict, null, 2) + "\n");
  return verdict;
}

const only = process.argv[2];
if (!existsSync(GIF_DIR)) { console.error(`no ${GIF_DIR}`); process.exit(1); }
const gifs = readdirSync(GIF_DIR).filter((f) => f.endsWith(".gif")).map((f) => f.replace(/\.gif$/, ""));
const targets = only ? gifs.filter((id) => id === only) : gifs;
if (!targets.length) { console.error(`no gif "${only}"; available: ${gifs.join(", ")}`); process.exit(1); }
const results: Verdict[] = [];
for (const id of targets) {
  const v = await judge(id, join(GIF_DIR, `${id}.gif`));
  results.push(v);
  console.log(`${v.pass ? "PASS" : "FAIL"} ${v.workflow.padEnd(24)} avg=${v.average} ${DIMENSIONS.map((d) => `${d.split("_")[0]}=${v.scores[d]}`).join(" ")}`);
  for (const issue of v.topIssues.slice(0, 2)) console.log(`     · ${issue}`);
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} shipped GIFs pass the gemini-3.6-flash judge -> ${OUT_DIR}/`);
if (failed.length) { console.log(`FAILING: ${failed.map((f) => f.workflow).join(", ")} — fix and re-judge before claiming demo-ready.`); process.exit(1); }
