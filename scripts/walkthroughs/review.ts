import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import "../benchmark/loadEnv";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const features = args.filter((arg) => !arg.startsWith("--"));
const model = optionValue("--model") ?? process.env.GEMINI_MEDIA_JUDGE_MODEL ?? "gemini-3.5-flash";
const runId = optionValue("--run-id") ?? timestampId(new Date());
const base = optionValue("--base") ?? process.env.WALKTHROUGH_BASE;
const skipCapture = hasFlag("--skip-capture");
const skipRender = hasFlag("--skip-render");
const skipGemini = hasFlag("--skip-gemini");
const uiReview = hasFlag("--ui-review");
const mediaOnly = optionValue("--media");
const allowSkipped = hasFlag("--allow-skipped");

const outDir = join(ROOT, "docs", "eval", "walkthrough-review", runId);
mkdirSync(outDir, { recursive: true });

const commands: string[] = [];
const env = { ...process.env, GEMINI_MEDIA_JUDGE_MODEL: model };
if (base) env.WALKTHROUGH_BASE = base;

if (!mediaOnly) {
  if (!skipCapture) run(cmd("npx"), ["tsx", "scripts/walkthroughs/capture.ts", ...features], env, commands);
  if (!skipCapture) await assertRequestedCaptures(features, allowSkipped);
  if (!skipRender) run(cmd("npm"), ["run", "walkthroughs:render", "--", ...features], env, commands);
}

const media = mediaOnly ?? pickPrimaryMedia(features);
if (!skipGemini) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for walkthrough review");
  }
  const only = mediaOnly ? stripExt(basename(media)) : judgeSelector(features, stripExt(basename(media)));
  run(cmd("npm"), ["run", "media:gemini-judge", "--", "--only", only, "--include-ignored", "--run-id", runId, "--model", model], env, commands);
  if (uiReview) {
    const uiOut = join(outDir, "gemini-ui-review.json");
    run(cmd("npm"), ["run", "ui:gemini-review", "--", `--media=${slash(relative(ROOT, media))}`, `--out=${slash(relative(ROOT, uiOut))}`, `--model=${model}`], env, commands);
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  runId,
  model,
  base: base ?? process.env.WALKTHROUGH_BASE ?? "https://noderoom.live",
  features,
  media,
  commands,
  mediaJudge: join("docs", "eval", "gemini-media-judges", runId, "summary.md"),
  uiReview: uiReview ? join("docs", "eval", "walkthrough-review", runId, "gemini-ui-review.json") : undefined,
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "README.md"), renderReadme(manifest));
console.log(`wrote ${relative(ROOT, join(outDir, "README.md"))}`);

function run(command: string, commandArgs: string[], commandEnv: NodeJS.ProcessEnv, commands: string[]) {
  const line = [command, ...commandArgs].map(quoteArg).join(" ");
  commands.push(line);
  console.log(`[walkthrough-review] ${line}`);
  execFileSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", env: commandEnv, shell: process.platform === "win32" });
}

function cmd(name: "npm" | "npx"): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function pickPrimaryMedia(ids: string[]): string {
  const candidates = ids.length ? ids : ["startup-diligence-war-room"];
  for (const id of candidates) {
    const mp4 = join(ROOT, "docs", "walkthroughs", `${id}.mp4`);
    if (existsSync(mp4)) return mp4;
    const gif = join(ROOT, "docs", "walkthroughs", `${id}.gif`);
    if (existsSync(gif)) return gif;
  }
  return join(ROOT, "docs", "walkthroughs", `${candidates[0]}.mp4`);
}

async function assertRequestedCaptures(ids: string[], allowSkipped: boolean) {
  if (!ids.length) return;
  const dataPath = join(ROOT, "remotion", "walkthrough.data.js");
  const data = (await import(`${pathToFileURL(dataPath).href}?t=${Date.now()}`)).default as {
    features: Array<{ id: string; skipped?: boolean; error?: string; segments?: unknown[] }>;
  };
  const missing = ids.filter((id) => !data.features.some((feature) => feature.id === id));
  const skipped = data.features.filter((feature) => ids.includes(feature.id) && feature.skipped);
  const empty = data.features.filter((feature) => ids.includes(feature.id) && !feature.skipped && !feature.segments?.length);
  const failures = [
    ...missing.map((id) => `${id}: missing from capture manifest`),
    ...skipped.map((feature) => `${feature.id}: skipped${feature.error ? ` (${feature.error})` : ""}`),
    ...empty.map((feature) => `${feature.id}: captured with 0 segments`),
  ];
  if (!failures.length) return;
  const message = `walkthrough capture did not produce fresh usable evidence:\n- ${failures.join("\n- ")}`;
  if (allowSkipped) {
    console.warn(`[walkthrough-review] WARNING: ${message}`);
    return;
  }
  throw new Error(`${message}\n\nUse --allow-skipped only when intentionally judging previously rendered media.`);
}

function renderReadme(manifest: {
  generatedAt: string;
  runId: string;
  model: string;
  base: string;
  features: string[];
  media: string;
  commands: string[];
  mediaJudge: string;
  uiReview?: string;
}) {
  return [
    "# Walkthrough Review Run",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Run id: \`${manifest.runId}\``,
    `Model: \`${manifest.model}\``,
    `Base: ${manifest.base}`,
    `Features: ${manifest.features.length ? manifest.features.map((id) => `\`${id}\``).join(", ") : "default walkthrough set"}`,
    `Primary media: \`${slash(relative(ROOT, manifest.media))}\``,
    "",
    "## Commands",
    "",
    "```bash",
    ...manifest.commands,
    "```",
    "",
    "## Evidence",
    "",
    `- Media judge: [summary](../gemini-media-judges/${manifest.runId}/summary.md)`,
    manifest.uiReview ? `- UI production rubric: [json](${basename(manifest.uiReview)})` : "- UI production rubric: not requested for this run",
    "",
    "> This is a demo-media and UX-review artifact. It does not replace Convex typecheck, browser E2E, provider ladder, privacy, or load-test gates.",
    "",
  ].join("\n");
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const eq = args.find((arg) => arg.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

function timestampId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function stripExt(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}

function judgeSelector(ids: string[], fallback: string): string {
  if (ids.length === 0) return fallback;
  if (ids.length === 1) return ids[0];
  const first = ids[0].split("-");
  let count = first.length;
  for (const id of ids.slice(1)) {
    const parts = id.split("-");
    count = Math.min(count, first.findIndex((part, index) => parts[index] !== part));
    if (count < 0) count = Math.min(first.length, parts.length);
  }
  const prefix = first.slice(0, count).join("-");
  return prefix || ids[0].split("-")[0] || fallback;
}

function slash(value: string): string {
  return value.replace(/\\/g, "/");
}
