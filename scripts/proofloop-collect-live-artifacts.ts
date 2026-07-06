import { collectProofloopArtifactHandoff } from "../src/eval/proofloopArtifactHandoff";

const options = parseArgs(process.argv.slice(2));

try {
  const manifest = collectProofloopArtifactHandoff({
    root: process.cwd(),
    runId: required(options["run-id"], "--run-id"),
    suite: required(options.suite, "--suite"),
    ...(options["run-root"] ? { runRoot: options["run-root"] } : {}),
    ...(options["test-results"] ? { testResultsDir: options["test-results"] } : {}),
    ...(options.out ? { handoffDir: options.out } : {}),
    convertVideo: !options["no-convert"],
    requireVideo: Boolean(options["require-video"]),
    clean: !options["no-clean"],
  });
  console.log(`proofloop handoff: ${manifest.status}`);
  console.log(`proofloop handoff: ${manifest.handoffDir}`);
  console.log(`proofloop handoff: ${manifest.videos.length} video artifact(s), ${manifest.receipts.length} receipt(s), ${manifest.screenshots.length} screenshot(s)`);
  if (manifest.mp4Paths.length) {
    console.log(`proofloop handoff mp4: ${manifest.mp4Paths.join(", ")}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function required(value: string | boolean | undefined, label: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`${label} is required`);
}
