/**
 * Design-QA rubric VLM panel (S4 of docs/design/DESIGN_QA_LADDER.md) -- the ONLY subjective stage,
 * and the replacement for the open-ended gemini-visual-polish.ts perpetual critic.
 *
 * Fixes baked in:
 *  - FIXED RUBRIC, not "find issues": each lens scores named dimensions 0-5 against a pass bar.
 *  - 3-QUESTION GATE as the product lens (what's happening / why trust / what next).
 *  - REFERENCE-GROUNDED + PAIRWISE: if --reference is given, judge "how far from THIS approved image"
 *    (reachable) instead of "is this polished" (unreachable) -- the convergence cure.
 *  - JURY of specialized lenses (reduces single-critic drift): product / hierarchy-type / layout-spacing /
 *    color-state, each scoped to its lane.
 *  - NN/G 0-4 severity -> P-level; bias controls (cap 5 findings/lens, temp 0.2).
 *  - DEFERS to the floor: must NOT re-flag contrast / overflow / token / reduced-motion (the floor owns those).
 *
 * Usage (run from the real node_modules):
 *   npx tsx scripts/design-qa/rubric-panel.ts --media=cand.png [--reference=baseline.png] [--floor=design-floor.json]
 * Advisory only (subjective): prints rubric + ship-advice; exit 0 always (CI keeps the VLM non-blocking).
 */
import "../benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateObject, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const args = process.argv.slice(2);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const mediaPath = opt("media");
const refPath = opt("reference");
const floorPath = opt("floor");
const model = process.env.GEMINI_UI_REVIEW_MODEL ?? "gemini-3.5-flash";
const outPath = opt("out") ?? join(process.cwd(), ".tmp-qa", "design-rubric.json");
if (!mediaPath) throw new Error("--media=<candidate png> required");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required");

const candidate = readFileSync(mediaPath);
const reference = refPath && existsSync(refPath) ? readFileSync(refPath) : null;
const floor = floorPath && existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, "utf8")) : null;
const floorPassedNote = floor
  ? `The deterministic floor already OWNS contrast, overflow, token-drift, reduced-motion, tabular-nums. Do NOT raise any of those. Floor counts: ${JSON.stringify(floor.counts)}.`
  : "A deterministic floor owns contrast/overflow/token/reduced-motion -- do NOT raise any of those here.";

const LENSES = [
  { key: "product", dims: ["whatIsHappening", "whyTrust", "whatNext"], brief: "The 3-question product gate. whatIsHappening: is the current state legible (active stage, who/what is working, what changed)? whyTrust: is provenance/evidence/review-state inspectable and status honest (no fake success)? whatNext: is the single most-useful next action obvious and everything else receded?" },
  { key: "hierarchy-typography", dims: ["hierarchy", "typography"], brief: "Does the work surface carry focus while chrome recedes? Is hierarchy by weight/placement (not oversized headings)? Sober type, no loud tracking." },
  { key: "layout-spacing", dims: ["spacingRhythm", "alignment", "density"], brief: "4/8/12/16/24 rhythm, aligned edges, stable control dimensions, calm-but-alive density (~12-14 controls at rest, not a dashboard)." },
  { key: "color-state", dims: ["colorDiscipline", "stateSignal"], brief: "Neutral at rest; ONE terracotta accent reserved for agent focus; state color only on real state. If everything is colorful, it failed." },
];

const lensSchema = (dims: string[]) => z.object({
  scores: z.object(Object.fromEntries(dims.map((d) => [d, z.number().min(0).max(5)]))),
  betterThanReference: z.enum(["better", "same", "worse", "no-reference"]),
  findings: z.array(z.object({
    severity: z.number().int().min(0).max(4).describe("NN/G: 4 catastrophe, 3 major, 2 minor, 1 cosmetic, 0 none"),
    element: z.string(),
    issue: z.string(),
    fix: z.string(),
  })).max(5),
});

async function judgeLens(lens: typeof LENSES[number]) {
  const content: ModelMessage["content"] = [
    { type: "text", text: [
      `You are the ${lens.key} critic in a design-QA jury for NodeRoom (a calm multiplayer finance-diligence room).`,
      `Judge ONLY your lens: ${lens.brief}`,
      reference
        ? "TWO images follow: [CANDIDATE] then [REFERENCE] (the approved target). Score how close the CANDIDATE is to the REFERENCE on your lens -- a reachable target. Set betterThanReference accordingly."
        : "One image follows: the CANDIDATE. Score it against the rubric. Set betterThanReference to 'no-reference'.",
      floorPassedNote,
      "Score each dimension 0-5 (5 = matches the bar). Report at most 5 findings, each with an NN/G severity 0-4 (only 3-4 are blockers). Be concrete: name the element and the exact fix. Do not invent nits to seem thorough; a clean lens returns zero findings.",
    ].join("\n") },
    { type: "file", data: candidate, filename: "candidate.png", mediaType: "image/png" },
  ];
  if (reference) content.push({ type: "file", data: reference, filename: "reference.png", mediaType: "image/png" });
  const { object } = await generateObject({ model: google(model), schema: lensSchema(lens.dims), messages: [{ role: "user", content }], temperature: 0.2 });
  return { lens: lens.key, ...object };
}

const results = await Promise.all(LENSES.map(judgeLens));

// aggregate
const allScores: number[] = [];
const minDim: { dim: string; score: number } = { dim: "", score: 99 };
const findings: { lens: string; severity: number; pLevel: string; element: string; issue: string; fix: string }[] = [];
for (const r of results) {
  for (const [dim, score] of Object.entries(r.scores)) {
    allScores.push(score as number);
    if ((score as number) < minDim.score) { minDim.dim = `${r.lens}.${dim}`; minDim.score = score as number; }
  }
  for (const f of r.findings) {
    if (f.severity < 2) continue; // 0-1 cosmetic -> ignore per NN/G
    findings.push({ lens: r.lens, severity: f.severity, pLevel: f.severity === 4 ? "P0" : f.severity === 3 ? "P1" : "P2", element: f.element, issue: f.issue, fix: f.fix });
  }
}
const mean = allScores.reduce((a, b) => a + b, 0) / allScores.length;
const p0 = findings.filter((f) => f.pLevel === "P0").length;
const p1 = findings.filter((f) => f.pLevel === "P1").length;
// S4 pass bar: rubric mean >= 4/5 AND no dim < 3/5 AND no open P0/P1
const passBar = mean >= 4 && minDim.score >= 3 && p0 === 0 && p1 === 0;

const report = {
  generatedAt: new Date().toISOString(), model, media: mediaPath, reference: refPath ?? null,
  rubricMean: Math.round(mean * 100) / 100, lowestDim: minDim,
  betterThanReference: results.map((r) => `${r.lens}:${r.betterThanReference}`),
  counts: { P0: p0, P1: p1, P2: findings.filter((f) => f.pLevel === "P2").length },
  passBar, lensScores: results.map((r) => ({ lens: r.lens, scores: r.scores })), findings,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`RUBRIC PANEL: mean=${report.rubricMean}/5 lowest=${minDim.dim} ${minDim.score} | P0=${p0} P1=${p1} P2=${report.counts.P2} | passBar=${passBar}`);
for (const f of findings.filter((f) => f.pLevel !== "P2")) console.log(`  [${f.pLevel}] ${f.lens} ${f.element}: ${f.fix}`);
console.log("(advisory: VLM stays non-blocking in CI until calibrated on a human-labeled golden set)");
