import "./benchmark/loadEnv";

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { generateObject, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const invokedCommand = ["npm", "run", "media:gemini-judge", "--", ...args].map(quoteCommandArg).join(" ");
const model = optionValue("--model") ?? process.env.GEMINI_MEDIA_JUDGE_MODEL ?? "gemini-3.5-flash";
const runId = optionValue("--run-id") ?? timestampId(new Date());
const only = optionValue("--only")?.toLowerCase();
const inputPaths = optionValues("--input");
const limit = numberOption("--limit");
const all = hasFlag("--all");
const primaryOnly = hasFlag("--primary-only") || !all;
const dryRun = hasFlag("--dry-run");
const includeIgnored = hasFlag("--include-ignored");
const defaultOutRoot = join(ROOT, "docs", "eval", "gemini-media-judges");
const outRoot = optionValue("--out") ?? (dryRun ? join(ROOT, ".tmp-qa", "gemini-media-judge", "dry-run-output") : defaultOutRoot);
const runDir = join(outRoot, runId);
const tempDir = join(ROOT, ".tmp-qa", "gemini-media-judge", runId);
const writeStableDocs = !dryRun && outRoot === defaultOutRoot;
const tracked = trackedRelPaths();
const RETIRED_MEDIA = new Set([
  "episodes/private-investment-room-v1/renders/short.mp4",
]);

if (!dryRun && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for Gemini media judging");
}

const scoreSchema = z.object({
  score: z.number().min(0).max(2),
  evidence: z.string(),
});

const judgeSchema = z.object({
  verdict: z.enum(["publish", "fix-then-publish", "rework"]),
  summary: z.string(),
  scores: z.object({
    featureClarity: scoreSchema,
    workflowCompleteness: scoreSchema,
    visualDesign: scoreSchema,
    consistency: scoreSchema,
    evidenceQuality: scoreSchema,
    legibility: scoreSchema,
    professionalRelevance: scoreSchema,
    productionHonesty: scoreSchema,
  }),
  observedEvidence: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  defects: z.array(z.object({
    ts: z.string(),
    severity: z.enum(["P0", "P1", "P2"]),
    observed: z.string(),
    fix: z.string(),
  })).default([]),
  suggestedReadmeCaption: z.string().default(""),
});

type Judge = z.infer<typeof judgeSchema>;

type AssetClass = "readme_walkthrough" | "workflow_preview" | "episode" | "live_browser_proof";

type Asset = {
  id: string;
  class: AssetClass;
  title: string;
  path: string;
  relPath: string;
  purpose: string;
  duplicateGroup?: string;
};

type AssetResult = {
  asset: Asset;
  model: string;
  status: "judged" | "error" | "dry-run";
  mediaPath?: string;
  mediaType?: string;
  convertedFrom?: string;
  bytes?: number;
  judge?: Judge;
  score?: number;
  maxScore?: number;
  error?: string;
};

const assets = selectAssets(discoverAssets());

mkdirSync(runDir, { recursive: true });
mkdirSync(join(runDir, "results"), { recursive: true });
writeFileSync(join(runDir, "manifest.json"), JSON.stringify({
  runId,
  generatedAt: new Date().toISOString(),
  model,
  primaryOnly,
  all,
  includeIgnored,
  only,
  limit,
  assets,
}, null, 2));

console.log(`Gemini demo media judge: ${assets.length} asset(s), model=${model}, runId=${runId}`);

const results: AssetResult[] = [];
for (const asset of assets) {
  const result = dryRun ? dryResult(asset) : await judgeAsset(asset);
  results.push(result);
  writeFileSync(join(runDir, "results", `${asset.id}.json`), JSON.stringify(result, null, 2));
  const score = result.score === undefined ? "-" : `${result.score}/${result.maxScore}`;
  console.log(`${result.status} ${asset.relPath} ${result.judge?.verdict ?? result.error ?? ""} ${score}`);
}

const aggregate = buildAggregate(results);
const md = renderSummary(aggregate);
writeFileSync(join(runDir, "summary.md"), md);
writeFileSync(join(outRoot, "latest.json"), JSON.stringify(aggregate, null, 2));
writeFileSync(join(outRoot, "latest.md"), md);
if (writeStableDocs) {
  writeFileSync(join(ROOT, "docs", "eval", "MEDIA_JUDGE.md"), md);
  console.log(`wrote ${relative(ROOT, join(ROOT, "docs", "eval", "MEDIA_JUDGE.md"))}`);
} else {
  console.log(`wrote ${relative(ROOT, join(runDir, "summary.md"))}`);
}

function discoverAssets(): Asset[] {
  const assets: Asset[] = [];
  for (const input of inputPaths) {
    const path = isAbsolute(input) ? input : resolve(ROOT, input);
    if (!existsSync(path)) throw new Error(`--input media not found: ${input}`);
    assets.push({
      id: assetId(path),
      class: "live_browser_proof",
      title: titleize(basename(path, extname(path))),
      path,
      relPath: slash(relative(ROOT, path)),
      purpose: "Live Playwright browser proof clip. Judge only visible product evidence: multi-client sync, advisory presence, no-clobber behavior, proposals, job/privacy/wall surfaces, and production honesty.",
    });
  }
  for (const path of listMedia(join(ROOT, "docs", "walkthroughs"))) {
    const name = basename(path, extname(path));
    assets.push({
      id: assetId(path),
      class: "readme_walkthrough",
      title: titleize(name),
      path,
      relPath: slash(relative(ROOT, path)),
      purpose: "README live walkthrough clip. Judge whether the feature is obvious, visually consistent, and credible as evidence.",
      duplicateGroup: `walkthrough:${name}`,
    });
  }
  for (const path of listMedia(join(ROOT, "docs", "eval", "workflow-previews"))) {
    const name = basename(path, extname(path));
    assets.push({
      id: assetId(path),
      class: "workflow_preview",
      title: titleize(name),
      path,
      relPath: slash(relative(ROOT, path)),
      purpose: "Silent workflow preview generated from app captures or trace replays. Judge whether it communicates the workflow and gate clearly.",
    });
  }
  const episodesRoot = join(ROOT, "episodes");
  if (existsSync(episodesRoot)) {
    for (const entry of readdirSync(episodesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(episodesRoot, entry.name, "renders", "short.mp4");
      if (!existsSync(path)) continue;
      assets.push({
        id: assetId(path),
        class: "episode",
        title: titleize(entry.name),
        path,
        relPath: slash(relative(ROOT, path)),
        purpose: "Narrated explainer episode. Judge story clarity, visual design, proof quality, and whether it fits the README claim.",
      });
    }
  }
  return assets.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function selectAssets(input: Asset[]): Asset[] {
  let selected = inputPaths.length > 0 && !all
    ? input.filter((asset) => asset.class === "live_browser_proof")
    : includeIgnored ? input : input.filter((asset) => asset.class === "live_browser_proof" || (isTracked(asset.path) && !RETIRED_MEDIA.has(asset.relPath)));
  if (only) selected = selected.filter((asset) => `${asset.relPath} ${asset.title} ${asset.class}`.toLowerCase().includes(only));
  if (primaryOnly) selected = preferPrimaryWalkthroughs(selected);
  if (limit !== undefined) selected = selected.slice(0, limit);
  return selected;
}

function preferPrimaryWalkthroughs(input: Asset[]): Asset[] {
  const grouped = new Map<string, Asset[]>();
  const passthrough: Asset[] = [];
  for (const asset of input) {
    if (!asset.duplicateGroup) {
      passthrough.push(asset);
      continue;
    }
    const list = grouped.get(asset.duplicateGroup) ?? [];
    list.push(asset);
    grouped.set(asset.duplicateGroup, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => mediaPriority(a.path) - mediaPriority(b.path));
    passthrough.push(list[0]);
  }
  return passthrough.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function judgeAsset(asset: Asset): Promise<AssetResult> {
  try {
    const prepared = prepareMedia(asset);
    const bytes = readFileSync(prepared.path);
    const prompt = buildPrompt(asset);
    const messages: ModelMessage[] = [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "file", data: bytes, filename: basename(prepared.path), mediaType: prepared.mediaType },
      ],
    }];
    const result = await generateObject({
      model: google(model),
      schema: judgeSchema,
      messages,
      temperature: 0.2,
    });
    const judge = normalizeJudge(result.object);
    return {
      asset,
      model,
      status: "judged",
      mediaPath: slash(relative(ROOT, prepared.path)),
      mediaType: prepared.mediaType,
      convertedFrom: prepared.convertedFrom ? slash(relative(ROOT, prepared.convertedFrom)) : undefined,
      bytes: bytes.length,
      judge,
      score: totalScore(judge),
      maxScore: maxScore(judge),
    };
  } catch (error) {
    return {
      asset,
      model,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function dryResult(asset: Asset): AssetResult {
  return { asset, model, status: "dry-run" };
}

function prepareMedia(asset: Asset): { path: string; mediaType: string; convertedFrom?: string } {
  const ext = extname(asset.path).toLowerCase();
  if (ext !== ".gif") return { path: asset.path, mediaType: mediaTypeFor(asset.path) };
  mkdirSync(tempDir, { recursive: true });
  const out = join(tempDir, `${asset.id}.mp4`);
  convertGif(asset.path, out, false);
  if (statSync(out).size > 18 * 1024 * 1024) convertGif(asset.path, out, true);
  return { path: out, mediaType: "video/mp4", convertedFrom: asset.path };
}

function convertGif(input: string, output: string, compact: boolean) {
  rmSync(output, { force: true });
  const vf = compact ? "fps=6,scale=960:-2" : "fps=10,scale=trunc(iw/2)*2:trunc(ih/2)*2";
  execFileSync("ffmpeg", [
    "-y",
    "-i", input,
    "-movflags", "+faststart",
    "-pix_fmt", "yuv420p",
    "-vf", vf,
    output,
  ], { stdio: "ignore" });
}

function buildPrompt(asset: Asset): string {
  return [
    "You are Gemini 3.5 Flash acting as a strict media QA judge for NodeRoom's README/demo evidence.",
    "Judge only what is visible or audible in the attached GIF/video. Do not infer backend success from captions unless the UI, trace, status, or artifact state shows it.",
    "",
    `Asset path: ${asset.relPath}`,
    `Asset title: ${asset.title}`,
    `Asset class: ${asset.class}`,
    `Purpose: ${asset.purpose}`,
    "",
    "Score each dimension from 0 to 2:",
    "0 = fails or absent, 1 = acceptable but weak/unclear, 2 = strong and clearly visible.",
    "",
    "Dimensions:",
    "- featureClarity: viewer can tell what feature is being demonstrated.",
    "- workflowCompleteness: shows before/action/result rather than a static end state.",
    "- visualDesign: layout, spacing, focus, polish, and absence of distracting inconsistencies. Compare the bar to polished professional tools such as Notion's focused document blocks and Linear's quiet, high-density issue surfaces: calm hierarchy, obvious active state, strong keyboard/workflow affordances, and no decorative noise.",
    "- consistency: matches NodeRoom's story of files + spreadsheet/note/wall + public/private agents + trace.",
    "- evidenceQuality: feels like real product evidence, not a vague marketing shot.",
    "- legibility: readable at README/browser size, including captions/chips/cells.",
    "- professionalRelevance: useful for GTM sales, finance/banker, or harness-engineering readers.",
    "- productionHonesty: avoids overclaiming; makes limits, proposals, traces, or state changes clear when relevant.",
    "",
    "Defect severity rules:",
    "P0 blocks publishing or misleads about what works.",
    "P1 should be fixed before using this as primary README evidence.",
    "P2 is polish.",
    "",
    "Return strict JSON matching the schema. Keep timestamps concrete when video time is visible; use 'n/a' for static or unclear timing.",
  ].join("\n");
}

function buildAggregate(results: AssetResult[]) {
  const judged = results.filter((r) => r.status === "judged");
  const verdictCounts = countBy(judged, (r) => r.judge?.verdict ?? "unknown");
  const defectCounts = countBy(judged.flatMap((r) => r.judge?.defects ?? []), (d) => d.severity);
  return {
    runId,
    generatedAt: new Date().toISOString(),
    model,
    command: invokedCommand,
    notes: [
      "GIF assets are converted to temporary MP4 with ffmpeg before upload.",
      "This media judge is evidence-quality QA; it does not replace backend/browser production gates.",
    ],
    counts: {
      total: results.length,
      judged: judged.length,
      errors: results.filter((r) => r.status === "error").length,
      dryRun: results.filter((r) => r.status === "dry-run").length,
      verdicts: verdictCounts,
      defects: defectCounts,
    },
    results,
  };
}

function renderSummary(aggregate: ReturnType<typeof buildAggregate>): string {
  const lines: string[] = [];
  lines.push("# Gemini Media Judge");
  lines.push("");
  lines.push(`Generated: ${aggregate.generatedAt}`);
  lines.push(`Model: \`${aggregate.model}\``);
  lines.push(`Run id: \`${aggregate.runId}\``);
  lines.push("");
  lines.push("> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Assets: ${aggregate.counts.total}`);
  lines.push(`- Judged: ${aggregate.counts.judged}`);
  lines.push(`- Errors: ${aggregate.counts.errors}`);
  lines.push(`- Verdicts: ${formatCounts(aggregate.counts.verdicts)}`);
  lines.push(`- Defects: ${formatCounts(aggregate.counts.defects)}`);
  lines.push("");
  lines.push("## Asset Results");
  lines.push("");
  lines.push("| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |");
  lines.push("|---|---|---:|---:|---:|---|");
  for (const result of aggregate.results) {
    const defects = result.judge?.defects ?? [];
    const counts = ["P0", "P1", "P2"].map((severity) => defects.filter((d) => d.severity === severity).length).join("/");
    const score = result.score === undefined ? "-" : `${result.score}/${result.maxScore}`;
    const finding = escapeMd(result.judge?.summary ?? result.error ?? result.status);
    lines.push(`| \`${result.asset.relPath}\` | ${result.asset.class} | ${result.judge?.verdict ?? result.status} | ${score} | ${counts} | ${finding} |`);
  }
  lines.push("");
  lines.push("## Open Defects");
  lines.push("");
  const open = aggregate.results.flatMap((result) => (result.judge?.defects ?? []).map((defect) => ({ result, defect })));
  if (!open.length) {
    lines.push("(none reported)");
  } else {
    for (const { result, defect } of open) {
      lines.push(`- **${defect.severity}** \`${result.asset.relPath}\` @ ${defect.ts}: ${defect.observed} -> ${defect.fix}`);
    }
  }
  lines.push("");
  lines.push("## Re-run");
  lines.push("");
  lines.push("```bash");
  lines.push(aggregate.command);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function listMedia(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMedia(path));
    else if (isMedia(path) && !basename(path).startsWith(".")) out.push(path);
  }
  return out;
}

function isMedia(path: string): boolean {
  return [".gif", ".mp4", ".mov", ".webm"].includes(extname(path).toLowerCase());
}

function trackedRelPaths(): Set<string> {
  try {
    return new Set(execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map(slash));
  } catch {
    return new Set();
  }
}

function isTracked(path: string): boolean {
  return tracked.has(slash(relative(ROOT, path)));
}

function quoteCommandArg(arg: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(arg)) return arg;
  return JSON.stringify(arg);
}

function mediaTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  throw new Error(`Unsupported media extension: ${ext}`);
}

function normalizeJudge(judge: Judge): Judge {
  const scores = { ...judge.scores };
  for (const key of Object.keys(scores) as Array<keyof typeof scores>) {
    const score = scores[key].score;
    scores[key] = { ...scores[key], score: Number(Math.max(0, Math.min(2, score > 2 ? score / 5 : score)).toFixed(2)) };
  }
  return { ...judge, scores };
}

function totalScore(judge: Judge): number {
  return Number(Object.values(judge.scores).reduce((sum, item) => sum + item.score, 0).toFixed(2));
}

function maxScore(judge: Judge): number {
  return Object.values(judge.scores).length * 2;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[keyFn(item)] = (out[keyFn(item)] ?? 0) + 1;
  return out;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(", ") : "none";
}

function assetId(path: string): string {
  return slash(relative(ROOT, path)).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function titleize(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function mediaPriority(path: string): number {
  const ext = extname(path).toLowerCase();
  if (ext === ".mp4") return 0;
  if (ext === ".webm") return 1;
  if (ext === ".mov") return 2;
  if (ext === ".gif") return 3;
  return 99;
}

function slash(path: string): string {
  return path.replace(/\\/g, "/");
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function timestampId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
      continue;
    }
    if (arg === name) {
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        values.push(value);
        i++;
      }
    }
  }
  return values;
}

function numberOption(name: string): number | undefined {
  const value = optionValue(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}
