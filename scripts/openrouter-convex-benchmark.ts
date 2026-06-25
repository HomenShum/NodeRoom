import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOpenRouterConvexBenchmarkReport, type OpenRouterConvexBenchmarkReport } from "../src/eval/openRouterConvexBenchmark";
import { allAgentLlmRoutes } from "./benchmark/modelEvalConfig";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/openrouter-convex-benchmark.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/OPENROUTER_CONVEX_BENCHMARK.md";
const strict = args.includes("--strict");

const report = buildOpenRouterConvexBenchmarkReport({
  routes: allAgentLlmRoutes(),
  generatedAt: new Date().toISOString(),
});

writeJson(jsonOut, report);
writeText(mdOut, renderMarkdown(report));
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `OpenRouter Convex benchmark: harness=${report.summary.harnessCasesPassing}/${report.summary.harnessCases} ` +
  `official=${report.summary.officialPromotionCasesPassing}/${report.summary.officialPromotionCases} ` +
  `routes=${report.summary.openRouterRouteCount}`,
);

if (strict && !report.summary.harnessReady) process.exitCode = 1;

function renderMarkdown(report: OpenRouterConvexBenchmarkReport): string {
  const lines: string[] = [];
  lines.push("# OpenRouter Convex Benchmark");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt ?? "unknown"}`);
  lines.push("");
  lines.push("This is NodeRoom's own benchmark contract for the product shape we actually ship: OpenRouter models running through Convex-owned jobs, leases, journals, mutation receipts, and artifact evidence. It is inspired by SpreadsheetBench, SpreadsheetBench 2, and BankerToolBench, but it is not an official score for those benchmarks.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- OpenRouter routes evaluated: ${report.summary.openRouterRouteCount}/${report.summary.routeCount}`);
  lines.push(`- Agent LLM routes in scorecard: ${report.summary.agentRouteCount}`);
  lines.push(`- OpenRouter-on-Convex harness cases: ${report.summary.harnessCasesPassing}/${report.summary.harnessCases} ${report.summary.harnessReady ? "PASS" : "BLOCKED"}`);
  lines.push(`- Official-style suites: ${report.summary.officialStyleSuitesPassing}/${report.summary.officialStyleSuites} ${report.summary.officialStyleSuitesReady ? "PASS" : "BLOCKED"}`);
  lines.push(`- Routes with live N=5/p95 managed-path evidence: ${report.summary.routesWithManagedN5P95}/${report.summary.agentRouteCount}`);
  lines.push(`- Routes with SpreadsheetBench-like N=5 evidence: ${report.summary.routesWithSpreadsheetN5}/${report.summary.agentRouteCount}`);
  lines.push(`- Latest-cheap OpenRouter routes in scorecard: ${report.summary.topPaidOpenRouterRoutes}`);
  lines.push(`- Latest-cheap OpenRouter routes with live N=5/p95 evidence: ${report.summary.topPaidRoutesWithManagedN5P95}/${report.summary.topPaidOpenRouterRoutes}`);
  lines.push(`- Official-promotion cases: ${report.summary.officialPromotionCasesPassing}/${report.summary.officialPromotionCases} ${report.summary.officialPromotionReady ? "PASS" : "BLOCKED"}`);
  lines.push("");
  lines.push("## Design Principles");
  lines.push("");
  for (const item of report.designPrinciples) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Benchmark Cases");
  lines.push("");
  lines.push("| Case | Scope | Status | Inspired by | Acceptance |");
  lines.push("|---|---|---:|---|---|");
  for (const item of report.cases) {
    lines.push(`| \`${item.id}\` | ${item.scope} | ${item.status} | ${item.inspiredBy.join(", ")} | ${item.acceptance} |`);
  }
  lines.push("");
  lines.push("## Official-Style Suite Scorecard");
  lines.push("");
  lines.push("| Suite | Status | Evidence | Key Metrics | Blockers |");
  lines.push("|---|---:|---|---|---|");
  for (const suite of report.officialStyleSuites) {
    const metrics = Object.entries(suite.metrics).map(([key, value]) => `${key}=${String(value)}`).join("; ");
    lines.push(`| \`${suite.id}\` | ${suite.status} | ${suite.evidence.map((item) => `\`${item}\``).join("<br>")} | ${metrics || "none"} | ${suite.blockers.join("; ") || "none"} |`);
  }
  lines.push("");
  lines.push("## Agent LLM Route Scorecard");
  lines.push("");
  lines.push("| Route | Provider | Role | Promotion | Research | Ladder | Managed N=5/p95 | Spreadsheet N=5 | Blockers |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---|");
  for (const route of report.routeScorecards) {
    lines.push(`| \`${route.route}\` | ${route.provider} | ${route.role} | ${route.promotionStatus} | ${route.evidence.research.status} | ${route.evidence.collaborationLadder.status} | ${route.evidence.managedPathN5P95.status} | ${route.evidence.spreadsheetBenchN5.status} | ${route.blockers.join("; ") || "none"} |`);
  }
  lines.push("");
  lines.push("## OpenRouter Route Plan");
  lines.push("");
  lines.push("| Route | Role | Adapter | Eligible | Blockers |");
  lines.push("|---|---|---|---:|---|");
  for (const route of report.routePlans) {
    lines.push(`| \`${route.route}\` | ${route.role} | ${route.adapter} | ${route.eligibleForConvexHarness ? "yes" : "no"} | ${route.blockers.join("; ") || "none"} |`);
  }
  lines.push("");
  lines.push("## Promotion Rule");
  lines.push("");
  lines.push("A route may be used for benchmark-shaped Convex work only through `agentJobs` and `convexModel`. Interactive write promotion still requires live N>=5/p95 ladder evidence for that route. `/free` and other demo-only free routes remain background/long-running until they clear that bar.");
  lines.push("");
  lines.push("Official benchmark promotion remains separate: BankerToolBench still requires the official Harbor/MCP/Gandalf verifier path before any official score claim.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, content: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
