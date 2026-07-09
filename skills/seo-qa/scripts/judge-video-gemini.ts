import "../../../scripts/benchmark/loadEnv";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { generateObject, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const input = optionValue("--input");
const model = optionValue("--model") ?? process.env.GEMINI_SEO_VIDEO_JUDGE_MODEL ?? process.env.GEMINI_MEDIA_JUDGE_MODEL ?? "gemini-3.5-flash";
const scenario = optionValue("--scenario") ?? "landing";
const dryRun = hasFlag("--dry-run");
const outDir = optionValue("--out-dir") ?? join(ROOT, "docs", "seo", "journey-artifacts", "gemini-video-judges");

if (!input) throw new Error("Pass --input <video>");
const inputPath = joinOrAbsolute(input);
if (!existsSync(inputPath)) throw new Error(`Video not found: ${input}`);
if (!dryRun && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for Gemini video judging");

const schema = z.object({
  first_impression_score: z.number().min(0).max(10),
  value_proposition_clarity_score: z.number().min(0).max(10),
  cta_clarity_score: z.number().min(0).max(10),
  trust_score: z.number().min(0).max(10),
  visual_smoothness_score: z.number().min(0).max(10),
  mobile_usability_score: z.number().min(0).max(10),
  activation_flow_score: z.number().min(0).max(10),
  latency_perception_score: z.number().min(0).max(10),
  critical_issues: z.array(z.object({
    timestamp: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    issue: z.string(),
    recommendation: z.string(),
  })).default([]),
  regressions: z.array(z.string()).default([]),
  recommended_fixes: z.array(z.string()).default([]),
  summary: z.string(),
});

type Judge = z.infer<typeof schema>;

const runId = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${basename(inputPath, extname(inputPath)).replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
const result = dryRun ? dryResult() : await judgeVideo();
mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, `${runId}.json`);
const mdPath = join(outDir, `${runId}.md`);
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(mdPath, renderMarkdown(result));
console.log(`wrote ${slash(relative(ROOT, jsonPath))} and ${slash(relative(ROOT, mdPath))}`);

async function judgeVideo(): Promise<{ input: string; model: string; scenario: string; dryRun: boolean; judge: Judge }> {
  const bytes = readFileSync(inputPath);
  const messages: ModelMessage[] = [{
    role: "user",
    content: [
      { type: "text", text: prompt() },
      { type: "file", data: bytes, filename: basename(inputPath), mediaType: mediaTypeFor(inputPath) },
    ],
  }];
  const response = await generateObject({
    model: google(model),
    schema,
    messages,
    temperature: 0.2,
  });
  return {
    input: slash(relative(ROOT, inputPath)),
    model,
    scenario,
    dryRun: false,
    judge: response.object,
  };
}

function dryResult(): { input: string; model: string; scenario: string; dryRun: boolean; judge: Judge } {
  return {
    input: slash(relative(ROOT, inputPath)),
    model,
    scenario,
    dryRun: true,
    judge: {
      first_impression_score: 0,
      value_proposition_clarity_score: 0,
      cta_clarity_score: 0,
      trust_score: 0,
      visual_smoothness_score: 0,
      mobile_usability_score: 0,
      activation_flow_score: 0,
      latency_perception_score: 0,
      critical_issues: [],
      regressions: [],
      recommended_fixes: ["Dry run only. Re-run without --dry-run after setting GOOGLE_GENERATIVE_AI_API_KEY."],
      summary: "Dry run; no video was sent to Gemini.",
    },
  };
}

function prompt(): string {
  const lines = [
    "You are a strict visual QA judge for NodeRoom's SEO landing and activation journey.",
    "Judge only what is visible or audible in the video. Do not infer backend success from marketing copy.",
    "Return strict JSON matching the schema.",
    "",
    "Score 0-10:",
    "- first impression: professional, clear, and credible within the first 5-10 seconds.",
    "- value proposition clarity: viewer can tell what NodeRoom is for.",
    "- cta clarity: primary CTA is visible and not competing with secondary actions.",
    "- trust: source-backed work, receipts, and privacy/indexing boundaries are credible.",
    "- visual smoothness: no jank, layout shifts, blank states, or unreadable transitions.",
    "- mobile usability: if mobile is visible, judge tap targets and text fit; otherwise score based on observable responsive risk.",
    "- activation flow: landing to room to first useful agent/product state is understandable.",
    "- latency perception: waits have honest status and do not look stuck.",
    "",
    "Issues must include concrete timestamps such as 00:14 when possible.",
  ];
  if (scenario === "google-origin") {
    lines.push("");
    lines.push("Scenario-specific rule: this video may begin on Google Search or another search-results page.");
    lines.push("Do not penalize NodeRoom for Google's own white background, search UI, consent UI, or throttling page.");
    lines.push("Only flag a white flash or blank state if it happens after navigation has left Google and NodeRoom is loading.");
    lines.push("Do not penalize a normal hard navigation cut from the Google results page to NodeRoom if NodeRoom appears without a blank or error state.");
    lines.push("Judge whether the search-origin path makes the eventual NodeRoom landing or fallback route understandable.");
  }
  return lines.join("\n");
}

function renderMarkdown(result: { input: string; model: string; scenario: string; dryRun: boolean; judge: Judge }): string {
  const lines: string[] = [];
  lines.push("# Gemini SEO Video Judge");
  lines.push("");
  lines.push(`Input: \`${result.input}\``);
  lines.push(`Model: \`${result.model}\``);
  lines.push(`Scenario: \`${result.scenario}\``);
  lines.push(`Dry run: ${result.dryRun ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Scores");
  lines.push("");
  for (const [key, value] of Object.entries(result.judge)) {
    if (typeof value === "number") lines.push(`- ${key}: ${value}/10`);
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(result.judge.summary);
  lines.push("");
  lines.push("## Critical Issues");
  lines.push("");
  if (!result.judge.critical_issues.length) lines.push("(none)");
  for (const issue of result.judge.critical_issues) {
    lines.push(`- ${issue.severity} @ ${issue.timestamp}: ${issue.issue} Fix: ${issue.recommendation}`);
  }
  lines.push("");
  lines.push("## Recommended Fixes");
  lines.push("");
  if (!result.judge.recommended_fixes.length) lines.push("(none)");
  for (const fix of result.judge.recommended_fixes) lines.push(`- ${fix}`);
  lines.push("");
  return lines.join("\n");
}

function mediaTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  throw new Error(`Unsupported video extension: ${ext}`);
}

function joinOrAbsolute(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") ? path : join(ROOT, path);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function slash(path: string): string {
  return path.replace(/\\/g, "/");
}
