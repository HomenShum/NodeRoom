import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopFullProxyBenchmarkSweep,
  renderProofloopFullProxyBenchmarkSweepHtml,
  renderProofloopFullProxyBenchmarkSweepMarkdown,
} from "../src/eval/proofloopFullProxyBenchmarkSweep";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-full-proxy-benchmark-sweep.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_FULL_PROXY_BENCHMARK_SWEEP.md";
const htmlOut = optionValue("--html-out") ?? "docs/eval/proofloop-full-proxy-benchmark-sweep.html";
const baseUrl = optionValue("--base-url") ?? process.env.PROOFLOOP_PROD_URL ?? "https://noderoom.live";
const strict = args.includes("--strict");

const report = buildProofloopFullProxyBenchmarkSweep({
  generatedAt: new Date().toISOString(),
  baseUrl,
});

writeText(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
writeText(mdOut, renderProofloopFullProxyBenchmarkSweepMarkdown(report));
writeText(htmlOut, renderProofloopFullProxyBenchmarkSweepHtml(report));

console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(`wrote ${htmlOut}`);
console.log(
  `proofloop full proxy sweep: prod=${report.summary.prodLiveBrowserVerifiedTaskTargets}/${report.summary.uniqueProxyTaskTargets} ` +
  `staged=${report.summary.stagedTaskTargets} winner=${report.modelRecommendation.modelId ?? "none"}`,
);

if (strict && !report.summary.fullProdLiveBrowserCoverageReady) process.exitCode = 1;

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
