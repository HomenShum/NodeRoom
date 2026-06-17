import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type CommandTemplate = string[];

export type WalkthroughReviewConfig = {
  schemaVersion: 1;
  defaultModel?: string;
  defaultBase?: string;
  envFile?: string;
  outputRoot?: string;
  dryRunOutputRoot?: string;
  mediaRoot?: string;
  captureManifest?: string;
  mediaJudgeSummary?: string;
  requiredReviewEnv?: string;
  env?: {
    model?: string;
    base?: string;
  };
  commands: {
    capture?: CommandTemplate;
    render?: CommandTemplate;
    mediaJudge?: CommandTemplate;
    uiReview?: CommandTemplate;
  };
};

export type WalkthroughRunInput = {
  configPath?: string;
  cwd?: string;
  features?: string[];
  model?: string;
  runId?: string;
  base?: string;
  skipCapture?: boolean;
  skipRender?: boolean;
  skipGemini?: boolean;
  uiReview?: boolean;
  media?: string;
  allowSkipped?: boolean;
  dryRun?: boolean;
  outRoot?: string;
  streamLogs?: boolean;
  logger?: (line: string) => void;
};

export type WalkthroughRunResult = {
  ok: boolean;
  generatedAt: string;
  runId: string;
  model: string;
  base: string;
  features: string[];
  media: string;
  outDir: string;
  manifestPath: string;
  readmePath: string;
  commands: string[];
  mediaJudge?: string;
  uiReview?: string;
};

type CommandVariables = {
  features: string[];
  model: string;
  runId: string;
  base: string;
  media: string;
  judgeSelector: string;
  uiReviewOut: string;
  outDir: string;
};

const DEFAULT_CONFIG = "walkthrough-review.config.json";
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_OUTPUT_ROOT = join("docs", "eval", "walkthrough-review");
const DEFAULT_DRY_OUTPUT_ROOT = join(".tmp-qa", "walkthrough-review");
const DEFAULT_MEDIA_ROOT = join("docs", "walkthroughs");
const DEFAULT_REVIEW_ENV = "GOOGLE_GENERATIVE_AI_API_KEY";

export async function runWalkthroughReview(input: WalkthroughRunInput = {}): Promise<WalkthroughRunResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const configPath = resolve(cwd, input.configPath ?? DEFAULT_CONFIG);
  const config = readConfig(configPath);
  if (config.envFile) loadEnvFile(resolve(cwd, config.envFile));
  const features = input.features ?? [];
  const generatedAt = new Date().toISOString();
  const runId = input.runId ?? timestampId(new Date());
  const model = input.model ?? envValue(config.env?.model) ?? config.defaultModel ?? DEFAULT_MODEL;
  const base = input.base ?? envValue(config.env?.base) ?? config.defaultBase ?? "";
  const outRoot = input.outRoot ?? (input.dryRun ? config.dryRunOutputRoot : config.outputRoot) ?? (input.dryRun ? DEFAULT_DRY_OUTPUT_ROOT : DEFAULT_OUTPUT_ROOT);
  const outDir = resolve(cwd, outRoot, runId);
  const mediaRoot = resolve(cwd, config.mediaRoot ?? DEFAULT_MEDIA_ROOT);
  const logger = input.logger ?? ((line: string) => console.log(line));
  const commands: string[] = [];
  const commandEnv = {
    ...process.env,
    ...(config.env?.model ? { [config.env.model]: model } : {}),
    ...(config.env?.base && base ? { [config.env.base]: base } : {}),
  };

  mkdirSync(outDir, { recursive: true });

  if (!input.media) {
    if (!input.skipCapture && config.commands.capture) {
      runCommand(config.commands.capture, commandEnv, commands, cwd, logger, input.streamLogs ?? true, vars({ features, model, runId, base, media: "", judgeSelector: "", uiReviewOut: "", outDir }), input.dryRun);
    }
    if (!input.skipCapture && config.captureManifest) {
      await assertRequestedCaptures(cwd, config.captureManifest, features, Boolean(input.allowSkipped), input.dryRun, logger);
    }
    if (!input.skipRender && config.commands.render) {
      runCommand(config.commands.render, commandEnv, commands, cwd, logger, input.streamLogs ?? true, vars({ features, model, runId, base, media: "", judgeSelector: "", uiReviewOut: "", outDir }), input.dryRun);
    }
  }

  const media = resolve(cwd, input.media ?? pickPrimaryMedia(mediaRoot, features));
  const selector = input.media ? stripExt(basename(media)) : judgeSelector(features, stripExt(basename(media)));
  const uiReviewOut = join(outDir, "gemini-ui-review.json");

  if (!input.skipGemini) {
    const requiredEnv = config.requiredReviewEnv ?? DEFAULT_REVIEW_ENV;
    if (!input.dryRun && requiredEnv && !process.env[requiredEnv]) {
      throw new Error(`${requiredEnv} is required for walkthrough review`);
    }
    if (config.commands.mediaJudge) {
      runCommand(
        config.commands.mediaJudge,
        commandEnv,
        commands,
        cwd,
        logger,
        input.streamLogs ?? true,
        vars({ features, model, runId, base, media: slash(relative(cwd, media)), judgeSelector: selector, uiReviewOut: slash(relative(cwd, uiReviewOut)), outDir: slash(relative(cwd, outDir)) }),
        input.dryRun,
      );
    }
    if (input.uiReview && config.commands.uiReview) {
      runCommand(
        config.commands.uiReview,
        commandEnv,
        commands,
        cwd,
        logger,
        input.streamLogs ?? true,
        vars({ features, model, runId, base, media: slash(relative(cwd, media)), judgeSelector: selector, uiReviewOut: slash(relative(cwd, uiReviewOut)), outDir: slash(relative(cwd, outDir)) }),
        input.dryRun,
      );
    }
  }

  const result: WalkthroughRunResult = {
    ok: true,
    generatedAt,
    runId,
    model,
    base: base || "not configured",
    features,
    media: slash(relative(cwd, media)),
    outDir: slash(relative(cwd, outDir)),
    manifestPath: slash(relative(cwd, join(outDir, "manifest.json"))),
    readmePath: slash(relative(cwd, join(outDir, "README.md"))),
    commands,
    mediaJudge: renderTemplate(config.mediaJudgeSummary ?? join("docs", "eval", "gemini-media-judges", "{{runId}}", "summary.md"), vars({ features, model, runId, base, media: slash(relative(cwd, media)), judgeSelector: selector, uiReviewOut: slash(relative(cwd, uiReviewOut)), outDir: slash(relative(cwd, outDir)) })),
    uiReview: input.uiReview ? slash(relative(cwd, uiReviewOut)) : undefined,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, "README.md"), renderReadme(result));
  logger(`wrote ${result.readmePath}`);
  return result;
}

function readConfig(configPath: string): WalkthroughReviewConfig {
  if (!existsSync(configPath)) throw new Error(`Walkthrough review config not found: ${configPath}`);
  const config = JSON.parse(readFileSync(configPath, "utf8")) as WalkthroughReviewConfig;
  if (config.schemaVersion !== 1) throw new Error(`Unsupported walkthrough review config schemaVersion: ${String(config.schemaVersion)}`);
  if (!config.commands || typeof config.commands !== "object") throw new Error("walkthrough review config requires commands");
  return config;
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripQuotes(rawValue);
  }
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function runCommand(
  template: CommandTemplate,
  commandEnv: NodeJS.ProcessEnv,
  commands: string[],
  cwd: string,
  logger: (line: string) => void,
  streamLogs: boolean,
  variables: CommandVariables,
  dryRun = false,
) {
  const [commandRaw, ...args] = renderCommand(template, variables);
  if (!commandRaw) throw new Error("empty command template");
  const command = commandForPlatform(commandRaw);
  const line = [command, ...args].map(quoteArg).join(" ");
  commands.push(line);
  logger(`[walkthrough-review] ${line}${dryRun ? " (dry-run)" : ""}`);
  if (dryRun) return;
  const result = execFileSync(command, args, {
    cwd,
    env: commandEnv,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: streamLogs ? "inherit" : "pipe",
  });
  if (!streamLogs && result) logger(result.trimEnd());
}

function renderCommand(template: CommandTemplate, variables: CommandVariables): string[] {
  const out: string[] = [];
  for (const part of template) {
    if (part === "{{features}}") {
      out.push(...variables.features);
      continue;
    }
    out.push(renderTemplate(part, variables));
  }
  return out;
}

function renderTemplate(value: string, variables: CommandVariables): string {
  return value
    .replaceAll("{{model}}", variables.model)
    .replaceAll("{{runId}}", variables.runId)
    .replaceAll("{{base}}", variables.base)
    .replaceAll("{{media}}", variables.media)
    .replaceAll("{{judgeSelector}}", variables.judgeSelector)
    .replaceAll("{{uiReviewOut}}", variables.uiReviewOut)
    .replaceAll("{{outDir}}", variables.outDir);
}

async function assertRequestedCaptures(
  cwd: string,
  manifestPath: string,
  ids: string[],
  allowSkipped: boolean,
  dryRun: boolean | undefined,
  logger: (line: string) => void,
) {
  if (dryRun || !ids.length) return;
  const dataPath = resolve(cwd, manifestPath);
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
    logger(`[walkthrough-review] WARNING: ${message}`);
    return;
  }
  throw new Error(`${message}\n\nUse --allow-skipped only when intentionally judging previously rendered media.`);
}

function pickPrimaryMedia(mediaRoot: string, ids: string[]): string {
  const candidates = ids.length ? ids : ["startup-diligence-war-room"];
  for (const id of candidates) {
    const mp4 = join(mediaRoot, `${id}.mp4`);
    if (existsSync(mp4)) return mp4;
    const gif = join(mediaRoot, `${id}.gif`);
    if (existsSync(gif)) return gif;
  }
  return join(mediaRoot, `${candidates[0]}.mp4`);
}

function renderReadme(result: WalkthroughRunResult): string {
  return [
    "# Walkthrough Review Run",
    "",
    `Generated: ${result.generatedAt}`,
    `Run id: \`${result.runId}\``,
    `Model: \`${result.model}\``,
    `Base: ${result.base}`,
    `Features: ${result.features.length ? result.features.map((id) => `\`${id}\``).join(", ") : "default walkthrough set"}`,
    `Primary media: \`${result.media}\``,
    "",
    "## Commands",
    "",
    "```bash",
    ...result.commands,
    "```",
    "",
    "## Evidence",
    "",
    result.mediaJudge ? `- Media judge: [summary](${relativeLink(result.outDir, result.mediaJudge)})` : "- Media judge: not configured",
    result.uiReview ? `- UI production rubric: [json](${basename(result.uiReview)})` : "- UI production rubric: not requested for this run",
    "",
    "> This is a demo-media and UX-review artifact. It does not replace backend typecheck, browser E2E, provider ladder, privacy, or load-test gates.",
    "",
  ].join("\n");
}

function relativeLink(fromDir: string, target: string): string {
  const fromAbs = resolve(process.cwd(), fromDir);
  const targetAbs = resolve(process.cwd(), target);
  return slash(relative(fromAbs, targetAbs));
}

function vars(value: CommandVariables): CommandVariables {
  return value;
}

function commandForPlatform(command: string): string {
  if (process.platform !== "win32") return command;
  if (command === "npm" || command === "npx") return `${command}.cmd`;
  return command;
}

function envValue(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const value = process.env[name];
  return value && value.length ? value : undefined;
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

export function isReviewConfigPath(path: string): boolean {
  return extname(path).toLowerCase() === ".json";
}
