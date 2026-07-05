import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopProdProxyBenchmarkMatrix,
  renderProofloopProdProxyBenchmarkMatrixHtml,
  renderProofloopProdProxyBenchmarkMatrixMarkdown,
} from "../src/eval/proofloopProdProxyBenchmarkMatrix";

const args = process.argv.slice(2);
const generatedAt = new Date().toISOString();
const baseUrl = optionValue("--base-url") ?? "https://noderoom.live";
const models = optionValues("--model")
  .flatMap((value) => value.split(","))
  .concat(optionValue("--models")?.split(",") ?? [])
  .map((value) => value.trim())
  .filter(Boolean);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-prod-proxy-benchmark-matrix.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_PROD_PROXY_BENCHMARK_MATRIX.md";
const htmlOut = optionValue("--html-out") ?? "docs/eval/proofloop-prod-proxy-benchmark-matrix.html";
const publicJsonOut = optionValue("--public-json-out") ?? "public/eval/proofloop-prod-proxy-benchmark-matrix.json";
const publicHtmlOut = optionValue("--public-html-out") ?? "public/eval/proofloop-prod-proxy-benchmark-matrix.html";

const report = buildProofloopProdProxyBenchmarkMatrix({
  generatedAt,
  baseUrl,
  models: models.length ? [...new Set(models)] : undefined,
});

writeJson(jsonOut, report);
writeText(mdOut, renderProofloopProdProxyBenchmarkMatrixMarkdown(report));
const html = renderProofloopProdProxyBenchmarkMatrixHtml(report);
writeText(htmlOut, html);
writeJson(publicJsonOut, report);
writeText(publicHtmlOut, html);

console.log([
  `prod proxy benchmark matrix: ${report.summary.prodLiveBrowserVerifiedTaskTargets}/${report.summary.uniqueTaskTargets} prod-verified task targets`,
  `model-task attempts required: ${report.summary.matrixAttemptTargets}`,
  `runnable now: ${report.summary.runnableProdBrowserTaskTargets}`,
  `blocked: ${report.summary.blockedTaskTargets}`,
  `all-task winner: ${report.recommendation.allTaskWinner ?? "none"}`,
  `current adapter-smoke winner: ${report.recommendation.currentProdAdapterSmokeWinner ?? "none"}`,
  `wrote ${jsonOut}, ${mdOut}, ${htmlOut}`,
  `published static copies ${publicJsonOut}, ${publicHtmlOut}`,
].join("\n"));

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        index += 1;
      }
    }
  }
  return values;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}
