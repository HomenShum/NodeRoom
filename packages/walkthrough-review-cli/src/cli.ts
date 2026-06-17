import { pathToFileURL } from "node:url";

import { runWalkthroughReview, type WalkthroughRunInput } from "./core.js";

export async function main(rawArgs = process.argv.slice(2)): Promise<void> {
  const args = [...rawArgs];
  const command = args[0] === "run" ? args.shift() : "run";
  if (command !== "run") {
    printHelp();
    process.exitCode = command === "--help" || command === "-h" ? 0 : 2;
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const input = parseRunArgs(args);
  try {
    const result = await runWalkthroughReview({ ...input, streamLogs: true });
    console.log(JSON.stringify({ ok: true, runId: result.runId, manifest: result.manifestPath, readme: result.readmePath, media: result.media }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function parseRunArgs(args: string[]): WalkthroughRunInput {
  const features = args.filter((arg, index) => !arg.startsWith("--") && !isOptionValue(args, index));
  return {
    features,
    configPath: optionValue(args, "--config"),
    model: optionValue(args, "--model"),
    runId: optionValue(args, "--run-id"),
    base: optionValue(args, "--base"),
    media: optionValue(args, "--media"),
    outRoot: optionValue(args, "--out-root"),
    skipCapture: hasFlag(args, "--skip-capture"),
    skipRender: hasFlag(args, "--skip-render"),
    skipGemini: hasFlag(args, "--skip-gemini"),
    uiReview: hasFlag(args, "--ui-review"),
    allowSkipped: hasFlag(args, "--allow-skipped"),
    dryRun: hasFlag(args, "--dry-run"),
  };
}

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function isOptionValue(args: string[], index: number): boolean {
  if (index === 0) return false;
  const previous = args[index - 1];
  return previous.startsWith("--") && !previous.includes("=");
}

function printHelp() {
  console.log([
    "walkthrough-review run [feature-id ...] [options]",
    "",
    "Options:",
    "  --config=<path>       Config file. Default: walkthrough-review.config.json",
    "  --base=<url>          App URL to pass to capture commands.",
    "  --model=<id>          Model judge id. Default comes from config/env.",
    "  --run-id=<id>         Stable output run id.",
    "  --media=<path>        Review existing media instead of capturing.",
    "  --ui-review           Run the optional production UI rubric command.",
    "  --skip-capture        Skip capture command.",
    "  --skip-render         Skip render command.",
    "  --skip-gemini         Skip model review commands.",
    "  --allow-skipped       Do not fail on skipped/empty capture manifest entries.",
    "  --dry-run             Render commands/manifests without executing child commands.",
  ].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
