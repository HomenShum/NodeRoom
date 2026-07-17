/**
 * State-set vision judge — gemini-3.5-flash scores each SURFACE's full set of state captures
 * (default/hover/focus/disabled/error/empty/locked/proposal/...) against the same adversarial
 * discipline as the GIF judge. The manifest's `mustBeTrue` line per capture tells the model what
 * each state is supposed to demonstrate, so the judge measures intent-vs-pixels, not vibes.
 *
 *   npx tsx scripts/judge-state-captures.ts            # judge every surface
 *   npx tsx scripts/judge-state-captures.ts sheet      # judge one surface
 *
 * Verdicts: docs/qa/state-judge/<surface>.json (committed — scores + issues, no secrets).
 * Pass bar: average >= 7 AND no dimension < 5. A FAIL exits 1.
 */
import "./benchmark/loadEnv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const JUDGE_MODEL = "gemini-3.5-flash";
const CAP_DIR = "docs/qa/state-captures";
const OUT_DIR = "docs/qa/state-judge";
const MANIFEST = join(CAP_DIR, "manifest.json");
const MAX_IMAGES = 12;
const DIMENSIONS = ["state_legibility", "affordance_honesty", "consistency", "contrast", "polish"] as const;

type Capture = { surface: string; state: string; theme: string; width: number; file: string; mustBeTrue: string };
type Verdict = {
  surface: string;
  judgeModel: string;
  judgedAt: string;
  stateCount: number;
  scores: Record<(typeof DIMENSIONS)[number], number>;
  average: number;
  pass: boolean;
  topIssues: string[];
  fixSuggestions: string[];
};

function rubric(surface: string, caps: Capture[]): string {
  const states = caps.map((c, i) => `image ${i + 1} — state "${c.state}" (${c.theme}, ${c.width}px): MUST be true — ${c.mustBeTrue}`).join("\n");
  return [
    `You are a strict UI/UX judge auditing the "${surface}" surface of a dark-themed collaborative app`,
    `(terracotta accent, JetBrains Mono for data). You are given ${caps.length} screenshots, each a`,
    `distinct UI STATE. For each image, the state and what it MUST demonstrate:`,
    ``,
    states,
    ``,
    `Score each dimension 0-10 (10 = ship-quality), judging the SET as a whole:`,
    `- state_legibility: is each state visually distinct and self-explanatory at this size?`,
    `- affordance_honesty: does each "MUST be true" hold? Clickable looks clickable, inert looks inert,`,
    `  disabled explains itself, the suggested-value/accept-reject grammar is followed?`,
    `- consistency: do controls share one grammar across states (button heights, accent discipline,`,
    `  one filled primary, semantic green=confirm/red=decline)?`,
    `- contrast: is all text/icon legible in the theme shown (no gray-on-dark fails, no invisible icons)?`,
    `- polish: alignment, spacing, no overlap, no clipped text, no element dwarfing its neighbors.`,
    ``,
    `Be adversarial: name the WORST concrete problems, citing the image number + state. If a "MUST be`,
    `true" is violated, that is a major affordance_honesty deduction. Respond with ONLY JSON:`,
    `{"scores":{"state_legibility":n,"affordance_honesty":n,"consistency":n,"contrast":n,"polish":n},`,
    `"topIssues":["image N (state): ..."],"fixSuggestions":["..."]}`,
  ].join("\n");
}

/** Evenly sample if a surface has more than MAX_IMAGES states (keep first + last). */
function sample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out = new Set<number>([0, arr.length - 1]);
  for (let i = 1; out.size < max; i++) out.add(Math.round((i * (arr.length - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b).map((i) => arr[i]);
}

async function judge(surface: string, caps: Capture[]): Promise<Verdict> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY missing — the judge cannot run (skipping would be a silent pass).");
  const picked = sample(caps, MAX_IMAGES);
  const parts: Array<Record<string, unknown>> = [
    { text: rubric(surface, picked) },
    ...picked.map((c) => ({ inline_data: { mime_type: "image/png", data: readFileSync(join(CAP_DIR, c.file)).toString("base64") } })),
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let parsed: { scores?: Record<string, number>; topIssues?: string[]; fixSuggestions?: string[] };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const raw = text.replace(/^```json\s*|\s*```$/g, "").trim();
    try {
      parsed = JSON.parse(raw);
    } catch {
      const repair = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Repair the following malformed response into strict JSON matching {"scores":{"state_legibility":number,"affordance_honesty":number,"consistency":number,"contrast":number,"polish":number},"topIssues":string[],"fixSuggestions":string[]}. Return JSON only.\n\n${raw}` }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
        signal: controller.signal,
      });
      if (!repair.ok) throw new Error(`judge repair HTTP ${repair.status}: ${(await repair.text()).slice(0, 200)}`);
      const repairBody = (await repair.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const repairedText = repairBody.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      parsed = JSON.parse(repairedText.replace(/^```json\s*|\s*```$/g, "").trim());
    }
  } finally {
    clearTimeout(timer);
  }
  const scores = Object.fromEntries(DIMENSIONS.map((d) => [d, Math.max(0, Math.min(10, Number(parsed.scores?.[d] ?? 0)))])) as Verdict["scores"];
  const values = DIMENSIONS.map((d) => scores[d]);
  const average = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  const verdict: Verdict = {
    surface, judgeModel: JUDGE_MODEL, judgedAt: new Date().toISOString(), stateCount: caps.length, scores, average,
    pass: average >= 7 && Math.min(...values) >= 5,
    topIssues: (parsed.topIssues ?? []).slice(0, 6).map(String),
    fixSuggestions: (parsed.fixSuggestions ?? []).slice(0, 6).map(String),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${surface}.json`), JSON.stringify(verdict, null, 2) + "\n");
  return verdict;
}

if (!existsSync(MANIFEST)) { console.error(`no ${MANIFEST} — run \`npm run qa:states\` first`); process.exit(1); }
const all = (JSON.parse(readFileSync(MANIFEST, "utf8")).captures as Capture[]) ?? [];
const bySurface = new Map<string, Capture[]>();
for (const c of all) { const list = bySurface.get(c.surface) ?? []; list.push(c); bySurface.set(c.surface, list); }
const only = process.argv[2];
const surfaces = only ? [only] : [...bySurface.keys()];
const results: Verdict[] = [];
for (const s of surfaces) {
  const caps = bySurface.get(s);
  if (!caps?.length) { console.log(`SKIP ${s}: no captures`); continue; }
  const v = await judge(s, caps);
  results.push(v);
  console.log(`${v.pass ? "PASS" : "FAIL"} ${s.padEnd(12)} avg=${v.average} ${DIMENSIONS.map((d) => `${d.split("_")[0]}=${v.scores[d]}`).join(" ")}`);
  for (const issue of v.topIssues.slice(0, 2)) console.log(`     · ${issue}`);
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} surfaces pass the gemini-3.5-flash state judge -> ${OUT_DIR}/`);
if (failed.length) { console.log(`FAILING: ${failed.map((f) => f.surface).join(", ")} — fix and re-judge.`); process.exit(1); }
