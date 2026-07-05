import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopPreprodReadinessReceipt,
  collectLivePreprodProbe,
  renderProofloopPreprodReadinessMarkdown,
  type LiveStorySmoke,
} from "../src/eval/proofloopPreprodReadiness";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-preprod-readiness.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_PREPROD_READINESS.md";
const liveUrl = optionValue("--live-url");
const strict = args.includes("--strict");
const liveStory = args.includes("--live-story");
const generatedAt = new Date().toISOString();

let liveProbe = liveUrl ? await collectLivePreprodProbe({ liveUrl, generatedAt }) : undefined;
if (liveProbe && liveStory) {
  liveProbe = {
    ...liveProbe,
    storySmoke: runLiveStorySmoke(liveProbe.url),
  };
  liveProbe.ok = liveProbe.ok && liveProbe.storySmoke.ok;
}

const receipt = buildProofloopPreprodReadinessReceipt({ generatedAt, liveProbe });
writeJson(jsonOut, receipt);
writeText(mdOut, renderProofloopPreprodReadinessMarkdown(receipt));

console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `proofloop preprod: gate=${receipt.releaseGate.status}, ` +
  `checks=${receipt.summary.passed}/${receipt.summary.total} passed, ` +
  `blocking=${receipt.summary.blockingFindings}, ` +
  `manual=${receipt.summary.manual}, ` +
  `live=${receipt.summary.liveChecksPassed}`,
);

if (strict && receipt.releaseGate.status !== "passed") process.exitCode = 1;

function runLiveStorySmoke(url: string): LiveStorySmoke {
  const command = `node scripts/story-route-dogfood.mjs --base-url ${url}`;
  const result = spawnSync(process.execPath, ["scripts/story-route-dogfood.mjs", "--base-url", url], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdoutTail = tail(result.stdout ?? "");
  const stderrTail = tail(result.stderr ?? "");
  return {
    command,
    ok: result.status === 0,
    stdoutTail,
    stderrTail,
    parsed: parseLastJsonLine(stdoutTail),
  };
}

function parseLastJsonLine(output: string): unknown {
  const line = output.split(/\r?\n/).reverse().find((candidate) => candidate.trim().startsWith("{"));
  if (!line) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function tail(value: string, max = 4000): string {
  return value.length > max ? value.slice(-max) : value;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, content: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
