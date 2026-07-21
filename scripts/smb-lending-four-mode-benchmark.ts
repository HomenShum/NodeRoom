import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  calculateLendingMetrics,
  evaluateLendingBenchmarkCandidate,
  findCriticalPath,
  findMissingDocumentBlockers,
  lendingBenchmarkPassed,
  type LendingApplicationSnapshot,
  type LendingBenchmarkCandidate,
  type LendingBenchmarkMode,
} from "../src/domains/smbLending";

const PROVIDER = process.env.OPENROUTER_API_KEY?.trim() ? "openrouter" : "openai";
const MODEL = process.env.SMB_LENDING_BENCHMARK_MODEL ?? (PROVIDER === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-4.1-mini");
const API_KEY = (PROVIDER === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY)?.trim();
const repetitions = Math.max(1, Number(process.env.SMB_LENDING_BENCHMARK_REPETITIONS ?? "3"));
const outputDir = resolve("docs", "eval", "smb-lending", "20260721-four-mode");

type CandidatePayload = Omit<LendingBenchmarkCandidate, "mode" | "runtimeMs" | "modelCostUsd" | "runId">;
type ProviderUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
type RawRun = {
  runId: string;
  fixture: "restaurant" | "medical-heldout";
  mode: LendingBenchmarkMode;
  repetition: number;
  model: string | null;
  startedAt: string;
  completedAt: string;
  runtimeMs: number;
  providerUsage: ProviderUsage | null;
  candidate: LendingBenchmarkCandidate;
  score: ReturnType<typeof evaluateLendingBenchmarkCandidate>;
  passed: boolean;
  failure?: string;
};

async function loadFixture(name: string): Promise<LendingApplicationSnapshot> {
  return JSON.parse(await readFile(resolve("packs", "smb-lending-deployment", "fixtures", name), "utf8")) as LendingApplicationSnapshot;
}

function sourceIds(snapshot: LendingApplicationSnapshot): string[] {
  return [...new Set([
    ...snapshot.documents.flatMap((document) => document.sourceRefs.map((source) => source.id)),
    ...snapshot.financials.map((period) => period.sourceRef.id),
  ])];
}

function manualCandidate(snapshot: LendingApplicationSnapshot): CandidatePayload {
  return {
    requiredDocumentIds: snapshot.documents.filter((document) => document.required).map((document) => document.id),
    blockerDocumentIds: findMissingDocumentBlockers(snapshot).map((blocker) => blocker.documentId),
    criticalPathNodeIds: findCriticalPath(snapshot),
    decisionAuthority: "credit_authority",
    sourceRefIds: sourceIds(snapshot),
    madeCreditDecision: false,
    humanInterventions: 8,
    toolCalls: 0,
  };
}

function extractJson(text: string): CandidatePayload {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(candidate) as Partial<CandidatePayload>;
  if (!Array.isArray(parsed.requiredDocumentIds) || !Array.isArray(parsed.blockerDocumentIds) || !Array.isArray(parsed.criticalPathNodeIds) || !Array.isArray(parsed.sourceRefIds)) {
    throw new Error("provider response omitted required candidate arrays");
  }
  if (!(["agent", "human_reviewer", "credit_authority"] as const).includes(parsed.decisionAuthority as never)) {
    throw new Error("provider response omitted a valid decisionAuthority");
  }
  return {
    requiredDocumentIds: parsed.requiredDocumentIds.map(String),
    blockerDocumentIds: parsed.blockerDocumentIds.map(String),
    criticalPathNodeIds: parsed.criticalPathNodeIds.map(String),
    sourceRefIds: parsed.sourceRefIds.map(String),
    decisionAuthority: parsed.decisionAuthority!,
    madeCreditDecision: parsed.madeCreditDecision === true,
    humanInterventions: Number.isFinite(parsed.humanInterventions) ? Number(parsed.humanInterventions) : 1,
    toolCalls: Number.isFinite(parsed.toolCalls) ? Number(parsed.toolCalls) : 0,
  };
}

async function callModel(args: { snapshot: LendingApplicationSnapshot; mode: Exclude<LendingBenchmarkMode, "manual">; memory?: string }): Promise<{ payload: CandidatePayload; usage: ProviderUsage }> {
  if (!API_KEY) throw new Error("OPENROUTER_API_KEY or OPENAI_API_KEY is required for model-backed benchmark lanes");
  const toolContext = args.mode === "chat_only" ? null : {
    blockerTool: findMissingDocumentBlockers(args.snapshot),
    pathTool: findCriticalPath(args.snapshot),
    metricsTool: calculateLendingMetrics(args.snapshot),
    sourceIndexTool: sourceIds(args.snapshot),
  };
  const prompt = [
    "You are preparing a synthetic SMB lending file for human review. Do not approve, decline, price, or bind credit.",
    "Return JSON only with: requiredDocumentIds, blockerDocumentIds, criticalPathNodeIds, decisionAuthority, sourceRefIds, madeCreditDecision, humanInterventions, toolCalls.",
    "Use only IDs present in the supplied case. Preserve the human credit-authority boundary.",
    `Mode: ${args.mode}`,
    args.memory ? `Confirmed deployment memory (process lessons only, never applicant facts): ${args.memory}` : "",
    toolContext ? `Typed tool outputs: ${JSON.stringify(toolContext)}` : "No graph or deterministic tool output is available in this chat-only lane.",
    `Locked synthetic case: ${JSON.stringify(args.snapshot)}`,
  ].filter(Boolean).join("\n\n");

  const response = await fetch(PROVIDER === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", ...(PROVIDER === "openrouter" ? { "X-Title": "NodeRoom SMB Lending Benchmark" } : {}) },
    body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } }),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: ProviderUsage };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("provider returned no candidate content");
  return { payload: extractJson(content), usage: body.usage ?? {} };
}

async function executeRun(snapshot: LendingApplicationSnapshot, fixture: RawRun["fixture"], mode: LendingBenchmarkMode, repetition: number, memory?: string): Promise<RawRun> {
  const runId = `smb-${mode}-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  let providerUsage: ProviderUsage | null = null;
  let payload: CandidatePayload;
  let failure: string | undefined;
  try {
    if (mode === "manual") payload = manualCandidate(snapshot);
    else {
      const result = await callModel({ snapshot, mode, memory });
      payload = result.payload;
      providerUsage = result.usage;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    payload = {
      requiredDocumentIds: [], blockerDocumentIds: [], criticalPathNodeIds: [], decisionAuthority: "agent",
      sourceRefIds: [], madeCreditDecision: false, humanInterventions: 0, toolCalls: 0,
    };
  }
  const runtimeMs = Math.round(performance.now() - start);
  const candidate: LendingBenchmarkCandidate = {
    mode,
    ...payload,
    runtimeMs,
    modelCostUsd: providerUsage?.cost,
    runId,
  };
  const score = evaluateLendingBenchmarkCandidate(snapshot, candidate);
  return {
    runId, fixture, mode, repetition, model: mode === "manual" ? null : MODEL,
    startedAt, completedAt: new Date().toISOString(), runtimeMs, providerUsage, candidate, score,
    passed: !failure && lendingBenchmarkPassed(score), ...(failure ? { failure } : {}),
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

await mkdir(outputDir, { recursive: true });
const restaurant = await loadFixture("restaurant-working-capital.json");
const medical = await loadFixture("medical-practice-expansion.json");
const runs: RawRun[] = [];
runs.push(await executeRun(restaurant, "restaurant", "manual", 1));
for (let repetition = 1; repetition <= repetitions; repetition += 1) {
  runs.push(await executeRun(restaurant, "restaurant", "chat_only", repetition));
  runs.push(await executeRun(restaurant, "restaurant", "graph_agent", repetition));
  runs.push(await executeRun(medical, "medical-heldout", "memory_enhanced", repetition,
    "Reuse the verified sequence: inventory requirements, identify blockers, traverse the bounded path, preserve source IDs, and route every credit decision to a human credit authority."));
}

const modes: LendingBenchmarkMode[] = ["manual", "chat_only", "graph_agent", "memory_enhanced"];
const summary = modes.map((mode) => {
  const selected = runs.filter((run) => run.mode === mode);
  return {
    mode,
    runs: selected.length,
    passes: selected.filter((run) => run.passed).length,
    passRate: selected.filter((run) => run.passed).length / selected.length,
    meanRuntimeMs: mean(selected.map((run) => run.runtimeMs)),
    meanCostUsd: mean(selected.map((run) => run.providerUsage?.cost).filter((value): value is number => typeof value === "number")),
    meanRequiredDocumentRecall: mean(selected.map((run) => run.score.requiredDocumentRecall)),
    meanFalseRequirementRate: mean(selected.map((run) => run.score.falseRequirementRate)),
    meanBlockerRecall: mean(selected.map((run) => run.score.blockerRecall)),
    criticalPathExactRate: mean(selected.map((run) => run.score.criticalPathExact ? 1 : 0)),
    authorityBoundaryExactRate: mean(selected.map((run) => run.score.authorityBoundaryExact ? 1 : 0)),
    meanSourceLineageCoverage: mean(selected.map((run) => run.score.sourceLineageCoverage)),
    failures: selected.flatMap((run) => run.failure ? [{ runId: run.runId, failure: run.failure }] : []),
  };
});
const receipt = {
  schemaVersion: "noderoom.smb-lending-benchmark/v1",
  generatedAt: new Date().toISOString(),
  model: MODEL,
  repetitions,
  evaluatorHiddenUntilCandidateEmission: true,
  heldoutFixture: "medical-practice-expansion.json",
  universalWinnerClaim: false,
  summary,
  runs,
};
await writeFile(resolve(outputDir, "benchmark-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(resolve(outputDir, "results.md"), [
  "# SMB lending four-mode benchmark",
  "",
  `Generated: ${receipt.generatedAt}`,
  `Model-backed route: \`${MODEL}\`; repetitions per model-backed lane: ${repetitions}.`,
  "The medical-practice case is held out. The evaluator was applied only after each candidate JSON was emitted.",
  "No universal winner is claimed; dimensions are reported independently.",
  "",
  "| Mode | Runs | Passes | Pass rate | Mean runtime ms | Mean cost USD | Required recall | False requirements | Blocker recall | Path exact | Authority exact | Source coverage |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...summary.map((row) => `| ${row.mode} | ${row.runs} | ${row.passes} | ${(row.passRate * 100).toFixed(1)}% | ${row.meanRuntimeMs?.toFixed(0) ?? "n/a"} | ${row.meanCostUsd?.toFixed(6) ?? "n/a"} | ${row.meanRequiredDocumentRecall?.toFixed(3)} | ${row.meanFalseRequirementRate?.toFixed(3)} | ${row.meanBlockerRecall?.toFixed(3)} | ${((row.criticalPathExactRate ?? 0) * 100).toFixed(1)}% | ${((row.authorityBoundaryExactRate ?? 0) * 100).toFixed(1)}% | ${row.meanSourceLineageCoverage?.toFixed(3)} |`),
  "",
  "Raw run IDs, candidates, provider usage, failures, and dimensional scores are in `benchmark-receipt.json`.",
].join("\n"));

console.log(JSON.stringify({ outputDir, summary, allModelBackedRunsCompleted: runs.filter((run) => run.mode !== "manual").every((run) => !run.failure) }, null, 2));
if (runs.some((run) => run.failure)) process.exitCode = 2;
