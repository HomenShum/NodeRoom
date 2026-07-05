import "./benchmark/loadEnv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { model, priceRun } from "../src/nodeagent/models/adapter";
import { selectOpenRouterFreeModels } from "../src/nodeagent/models/openRouterFreeModels";

type GaugeRow = {
  modelId: string;
  name?: string;
  status: "passed" | "failed" | "skipped";
  resolvedModel?: string;
  supportsTools: boolean;
  contextLength: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  error?: string;
};

type GaugeReceipt = {
  schema: "proofloop-free-openrouter-nodeagent-gauge-v1";
  generatedAt: string;
  source: string;
  harnessVersion: "nodeagent-tool-loop-free-model-gauge-v1";
  officialBenchmarkScoreClaim: false;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    estimatedCostUsd: number;
  };
  rows: GaugeRow[];
};

const args = process.argv.slice(2);
const limit = numberOption("--limit", 4);
const timeoutMs = numberOption("--timeout-ms", 90_000);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-free-openrouter-nodeagent-gauge.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_FREE_OPENROUTER_NODEAGENT_GAUGE.md";
const skipLive = args.includes("--skip-live");
const generatedAt = new Date().toISOString();

const candidates = await selectOpenRouterFreeModels({
  mode: "agent",
  limit,
  forceRefresh: true,
});

const rows: GaugeRow[] = [];
for (const candidate of candidates) {
  const started = Date.now();
  const contextLength = candidate.context_length ?? candidate.top_provider?.context_length ?? 0;
  if (skipLive || !process.env.OPENROUTER_API_KEY) {
    rows.push({
      modelId: candidate.id,
      name: candidate.name,
      status: "skipped",
      supportsTools: candidate.supported_parameters?.includes("tools") === true,
      contextLength,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      durationMs: Date.now() - started,
      error: skipLive ? "skip-live flag set" : "missing OPENROUTER_API_KEY",
    });
    continue;
  }

  try {
    const route = model(candidate.id);
    const response = await route.next({
      system: "You are running inside the NodeAgent proof-loop harness. Use the provided tool exactly once. Do not answer in prose.",
      messages: [{
        role: "user",
        content: "Call record_proxy_capability with family spreadsheetbench-v1, answer nodeagent-tool-loop-ok, confidence 0.5, and nextStep browser-adapter-run.",
      }],
      signal: AbortSignal.timeout(timeoutMs),
      toolChoice: "required",
      tools: [{
        name: "record_proxy_capability",
        description: "Record a short proxy capability signal from a model running inside NodeAgent.",
        schema: z.object({
          family: z.string(),
          answer: z.string(),
          confidence: z.number(),
          nextStep: z.string(),
        }),
        execute: async () => ({ ok: true }),
      }],
    });
    const first = response.toolCalls[0];
    const passed =
      first?.tool === "record_proxy_capability" &&
      String(first.args.family) === "spreadsheetbench-v1" &&
      String(first.args.answer) === "nodeagent-tool-loop-ok";
    rows.push({
      modelId: candidate.id,
      name: candidate.name,
      status: passed ? "passed" : "failed",
      resolvedModel: route.name,
      supportsTools: candidate.supported_parameters?.includes("tools") === true,
      contextLength,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      estimatedCostUsd: Number(priceRun(candidate.id, response.usage?.inputTokens ?? 0, response.usage?.outputTokens ?? 0).toFixed(8)),
      durationMs: Date.now() - started,
      ...(passed ? {} : { error: `unexpected tool call ${first?.tool ?? "none"} ${JSON.stringify(first?.args ?? {})}` }),
    });
  } catch (error) {
    rows.push({
      modelId: candidate.id,
      name: candidate.name,
      status: "failed",
      supportsTools: candidate.supported_parameters?.includes("tools") === true,
      contextLength,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      durationMs: Date.now() - started,
      error: redact(String(error instanceof Error ? error.message : error)),
    });
  }
}

const receipt: GaugeReceipt = {
  schema: "proofloop-free-openrouter-nodeagent-gauge-v1",
  generatedAt,
  source: `${process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"}/models?output_modalities=text`,
  harnessVersion: "nodeagent-tool-loop-free-model-gauge-v1",
  officialBenchmarkScoreClaim: false,
  summary: {
    total: rows.length,
    passed: rows.filter((row) => row.status === "passed").length,
    failed: rows.filter((row) => row.status === "failed").length,
    skipped: rows.filter((row) => row.status === "skipped").length,
    estimatedCostUsd: Number(rows.reduce((sum, row) => sum + row.estimatedCostUsd, 0).toFixed(8)),
  },
  rows,
};

writeJson(jsonOut, receipt);
writeText(mdOut, renderMarkdown(receipt));

console.log(`proofloop free OpenRouter NodeAgent gauge: passed=${receipt.summary.passed}/${receipt.summary.total} failed=${receipt.summary.failed} skipped=${receipt.summary.skipped} cost=$${receipt.summary.estimatedCostUsd.toFixed(6)}`);
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);

if (receipt.summary.failed > 0 && args.includes("--strict")) process.exitCode = 1;

function renderMarkdown(receipt: GaugeReceipt): string {
  return `${[
    "# ProofLoop Free OpenRouter NodeAgent Gauge",
    "",
    `Generated: ${receipt.generatedAt}`,
    `Harness version: \`${receipt.harnessVersion}\``,
    `Official benchmark score claim: ${receipt.officialBenchmarkScoreClaim ? "yes" : "no"}`,
    "",
    "This is a zero-dollar capability gauge for current OpenRouter free tool-capable models running through NodeAgent's tool loop. It is not a SpreadsheetBench/BTB/Finch official score.",
    "",
    "## Summary",
    "",
    `- Total models: ${receipt.summary.total}`,
    `- Passed tool-loop gauge: ${receipt.summary.passed}`,
    `- Failed: ${receipt.summary.failed}`,
    `- Skipped: ${receipt.summary.skipped}`,
    `- Estimated cost: $${receipt.summary.estimatedCostUsd.toFixed(6)}`,
    "",
    "## Rows",
    "",
    "| Model | Status | Resolved | Context | In | Out | Cost | Duration | Error |",
    "|---|---:|---|---:|---:|---:|---:|---:|---|",
    ...receipt.rows.map((row) =>
      `| \`${row.modelId}\` | ${row.status} | \`${row.resolvedModel ?? ""}\` | ${row.contextLength} | ${row.inputTokens} | ${row.outputTokens} | $${row.estimatedCostUsd.toFixed(6)} | ${Math.round(row.durationMs / 1000)}s | ${escapePipes(row.error ?? "")} |`,
    ),
    "",
  ].join("\n")}\n`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function numberOption(name: string, fallback: number): number {
  const value = Number(optionValue(name) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function redact(value: string): string {
  let out = value;
  for (const secret of Object.values(process.env)) {
    if (secret && secret.length > 12) out = out.replaceAll(secret, "[redacted]");
  }
  return out.replace(/\s+/g, " ").slice(0, 300);
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}
