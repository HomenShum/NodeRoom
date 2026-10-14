/**
 * Gemini multimodal workflow judge. Feeds fresh product screenshots as an ordered
 * frame sequence + the L1-L6 agent ladder trace + the benchmark summary to Gemini, and
 * asks it to rule — from the EVIDENCE ONLY — whether each ParselyFi-JPM / Sales-GTM pain
 * point is addressed. This is the independent "does the live workflow truly relieve the
 * pain" check, before the Remotion demo.
 *
 *   npx tsx scripts/eval/painJudge.ts            # gemini-3.6-flash
 *   JUDGE_MODEL=gemini-3.1-flash-lite npx tsx scripts/eval/painJudge.ts
 */
import "../benchmark/loadEnv";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const ROOT = process.cwd();
const MODEL = process.env.JUDGE_MODEL || "gemini-3.6-flash";
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });

const FRAMES: [string, string][] = [
  ["qa-room.png", "Four-panel room: left Room (files+people), Public chat with the Room NodeAgent + a /ask box, the shared Q3 variance spreadsheet, and the user's private NodeAgent."],
  ["live-research-before.png", "Fresh capture before enrichment: Research tab with account/GTM columns, tier/intent/owner/CRM status, structured research fields, two source slots, freshness badges, Add accounts, Requeue complete, CRM CSV, and Enrich pending."],
  ["live-research-after.png", "Fresh capture after the Room NodeAgent enriched pending rows: rows complete, structured fields filled, two clickable sources per row, and freshness badges set to fresh."],
  ["live-research-sources-freshness.png", "Fresh capture horizontally scrolled to the Sources/Freshness columns: two clickable source links and fresh badges are visible."],
  ["live-research-freshness.png", "Fresh capture of the freshness column with visible fresh badges next to source links."],
  ["live-research-byo-row.png", "Fresh capture after pasting a bring-your-own account: Databricks appears as a new pending row with GTM metadata from pasted input."],
  ["live-research-requeue.png", "Fresh capture after Requeue complete: completed rows are flipped back to pending and the Enrich button is enabled again."],
  ["live-proposals-buttons.png", "Fresh capture with Auto-allow off: agent edits appear as host-review proposals with Approve and Reject buttons."],
  ["live-room-after-agent.png", "The shared spreadsheet AFTER the Room NodeAgent filled the Variance column live (values now present)."],
  ["qa-real-llm-ask.png", "A real-LLM /ask typed in the public chat driving the Room NodeAgent end to end."],
  ["ui-trace-lifecycle.png", "The Room trace strip showing the agent's tool lifecycle (propose_lock -> read_range -> edit_cell -> release_lock)."],
  ["qa-telemetry.png", "A telemetry view: model name, tool-call count, tokens and a dollar cost."],
  ["lib-note.png", "The Note artifact (rich-text) inside the same room."],
  ["lib-wall.png", "The post-it Wall artifact inside the same room (multi-artifact room)."],
];

const rubric = JSON.parse(readFileSync(join(ROOT, "docs/eval/pain-rubric.json"), "utf8"));
const ladder = readFileSync(join(ROOT, "docs/eval/ladder-trace.txt"), "utf8");
const benchmark = [
  "L1-L6 task ladder (real harness, evals/ladder.ts): L1 read-only, L2 single CAS edit, L3 concurrent-edit no-clobber, L4 blocked-range must-draft, L5 large-sheet narrow-range (no full snapshot), L6 long-horizon compaction + repeated conflict recovery.",
  "Fresh scripted reference passes L1-L6 in docs/eval/ladder-trace.txt.",
  "Company-research harness now asserts all rows complete, source and source2 populated, structured fields populated, last_researched written, no conflicts, and two fetch_source calls per account.",
  "Benchmark script scoring has been updated to 9 checks: ALL_COMPLETE, EVERY_ROW_SOURCED, EVERY_ROW_MULTI_SOURCE, SOURCES_FETCHED, STRUCTURED_FIELDS, FRESHNESS_WRITTEN, COMPLETED_IN_BUDGET, NO_FABRICATION, RIGHT_ENTITY.",
  "Durable, hash-chained agentRuns + agentSteps audit (model, tool calls, tokens, $ cost, per-cell provenance).",
].join("\n");

const prompt = `You are an independent product evaluator. You are shown labeled SCREENSHOT FRAMES of a product called NodeRoom (a live room where humans + AI "NodeAgents" co-edit a shared spreadsheet / note / post-it wall via a lock -> draft -> smart-merge + per-cell version model), plus a textual L1-L6 agent task-ladder trace and a benchmark summary.

For each PAIN POINT below, judge whether it is addressed BY THE EVIDENCE SHOWN, using its "addressedIfShown" as the checklist. Be STRICT and HONEST:
- "shown": the addressedIfShown behavior is clearly visible in a frame OR evidenced by the ladder trace/benchmark.
- "partial": some but not all of it is evidenced.
- "not_shown": plausibly built but NOT visible in these frames/trace — do not assume.
- "gap_confirmed": the evidence confirms it is NOT addressed (matches an isGap pain).
Static frames cannot show dynamic behavior (e.g. live conflict recovery) — for those rely on the L1-L6 ladder trace + benchmark; if still not evidenced, say not_shown. Do not reward a pain just because the product looks polished.

L1-L6 LADDER TRACE:
${ladder}

BENCHMARK SUMMARY:
${benchmark}

PAIN POINTS (JSON, each with addressedIfShown + isGap + the claimed nodeRoom mapping):
${JSON.stringify(rubric)}

Return ONLY a JSON array, one object per pain. Use the exact "id" and "workflow" from each rubric object; do not substitute the workflow name for the id:
{"id": "...", "workflow": "parselyfi|sales_gtm", "verdict": "shown|partial|not_shown|gap_confirmed", "evidence": "which frame/trace and what you actually saw", "note": "one sentence"}`;

type Part = { type: "text"; text: string } | { type: "image"; image: Buffer };
const content: Part[] = [{ type: "text", text: prompt }];
for (const [file, label] of FRAMES) {
  content.push({ type: "text", text: `\nFRAME ${file}: ${label}` });
  content.push({ type: "image", image: readFileSync(join(ROOT, "docs/screenshots", file)) });
}

(async () => {
  console.log(`Gemini multimodal workflow judge · model=${MODEL} · ${FRAMES.length} frames · ${rubric.length} pains`);
  const res = await generateText({ model: google(MODEL), messages: [{ role: "user", content }] });
  let parsed: Array<{ id: string; workflow: string; verdict: string; evidence: string; note: string }>;
  try { parsed = JSON.parse(res.text.match(/\[[\s\S]*\]/)![0]); }
  catch { console.error("could not parse judge output:\n", res.text.slice(0, 1500)); process.exit(1); }
  writeFileSync(join(ROOT, "docs/eval/pain-verdicts.json"), JSON.stringify(parsed, null, 1));
  const icon = (v: string) => v === "shown" ? "PASS" : v === "partial" ? "PART" : v === "gap_confirmed" ? "GAP " : "MISS";
  const byWf: Record<string, typeof parsed> = {};
  for (const p of parsed) (byWf[p.workflow] ??= []).push(p);
  for (const [wf, ps] of Object.entries(byWf)) {
    console.log(`\n##### ${wf} #####`);
    for (const p of ps) console.log(`  [${icon(p.verdict)}] ${p.id}  ${p.note}`);
  }
  const n = (v: string) => parsed.filter((p) => p.verdict === v).length;
  console.log(`\nTOTAL: shown=${n("shown")} partial=${n("partial")} not_shown=${n("not_shown")} gap=${n("gap_confirmed")} / ${parsed.length}`);
  console.log("wrote docs/eval/pain-verdicts.json");
})();
