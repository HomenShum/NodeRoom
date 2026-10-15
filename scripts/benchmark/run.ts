/**
 * Multi-model benchmark — runs the company-research harness across models with a
 * REAL source fetch, scores DETERMINISTIC boolean checks (no arbitrary scalars),
 * captures real $/latency/tokens → docs/eval/results.json (the chart's data source).
 *
 *   npx tsx scripts/benchmark/run.ts                       # default cheap/free set
 *   npx tsx scripts/benchmark/run.ts gemini-2.5-flash-lite # a subset
 *
 * Keys are read from .env.local (ANTHROPIC_API_KEY · GOOGLE_GENERATIVE_AI_API_KEY · OPENAI_API_KEY).
 */
import "./loadEnv"; // MUST be first — loads .env.local before any @ai-sdk/* module captures env
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RoomEngine } from "../../src/engine/roomEngine";
import { buildDemoRoom, RESEARCH_COMPANIES } from "../../src/engine/demoRoom";
import { InMemoryRoomTools } from "../../src/nodeagent/skills/integration/noderoomAdapter";
import { runAgent } from "../../src/nodeagent/core/runtime";
import { model, priceRun, judge } from "../../src/nodeagent/models/adapter";
import { lookupModelAlias } from "../../src/nodeagent/models/modelCatalog";
import { costFromPricing, pricingAtRunFor, type PricingAtRun, type RouteSnapshot } from "./pricingAtRun";
import { fetchSourceReal } from "../../src/nodeagent/skills/search/fetchSource";
import type { AgentMessage, AgentModel, AgentTool, RoomTools, SourceResult } from "../../src/nodeagent/core/types";
import { isOpenRouterFreeAutoModel, selectOpenRouterFreeModels, type OpenRouterModelInfo } from "../../src/nodeagent/models/openRouterFreeModels";
import { fenceUntrusted } from "../../src/nodeagent/core/worldModel";
import {
  canonicalSourceKey,
  evidenceText,
  extractFirstJsonObject,
  extractUrl as extractSourceUrl,
  fetchEvidenceFromTrace,
  inferFailureOwner,
  isSourceUrlCoveredByFetch,
  judgeCompanyWith,
  matchedEvidenceForSources,
  summaryGroundedInEvidence,
  type CompanyJudgeResult,
  type FailureOwner,
} from "./harness";
import { DEFAULT_RESEARCH_MODEL_ROUTES } from "./modelEvalConfig";
import { benchmarkResearchTools } from "./researchTools";

// v3: two-call composite (fetch_row_sources -> model synthesis -> write_row). v2's single-call shape
// let a deterministic template author the fields — every check graded harness code, so the version
// MUST change here whenever task semantics change, or the eval-store comparability machinery
// ([checks-redefined] annotations, merge contracts) silently treats incomparable runs as one series.
const BENCHMARK_VERSION = "company-research-v3-composite-synthesis";
const CHECKS = [
  "ALL_COMPLETE",
  "EVERY_ROW_SOURCED",
  "EVERY_ROW_MULTI_SOURCE",
  "SOURCES_FETCHED",
  "STRUCTURED_FIELDS",
  "FRESHNESS_WRITTEN",
  "COMPLETED_IN_BUDGET",
  "NO_FABRICATION",
  "RIGHT_ENTITY",
];

// Fixed cheap judge (isolated yes/no per the grounded-eval rule — low variance, not a holistic grade).
const JUDGE = process.env.JUDGE_MODEL || "gemini-3.1-flash-lite";
async function scoreJudgeCompany(company: string, summary: string, evidence: string): Promise<CompanyJudgeResult> {
  return judgeCompanyWith(judge, JUDGE, company, summary, evidence);
}

// Default research smoke set. The full supported route matrix lives in
// modelEvalConfig.ts and is run through `npm run eval:model-matrix -- --live`.
const DEFAULT_MODELS = DEFAULT_RESEARCH_MODEL_ROUTES;
const MODELS = DEFAULT_MODELS;
const DEFAULT_COMPANY_COUNT = 3;
const COMPANIES = RESEARCH_COMPANIES.slice(0, 3); // bound the spend

function goalForCompanies(count: number): string {
  return `Research ${count === 1 ? "the listed pending company" : `the ${count} listed pending companies`}. ` +
    "For each row: fetch_row_sources, read the snippets, then write_row with fields synthesized in your own words from those snippets. " +
    "The workflow tools own lock, fetch, CAS writes, citations, freshness, status, and release — your job is the research content.";
}

interface Row {
  benchmarkVersion: string; model: string; requestedModel: string; resolvedModel: string; resolvedModels: string[];
  ok: boolean; checks: Record<string, boolean>; passed: number; total: number;
  inputTokens: number; outputTokens: number; costUsd: number; ms: number; steps: number; toolCalls: number; error?: string; judgeErrors?: string[];
  failureOwner?: FailureOwner; failureReason?: string;
  routeSnapshotId?: string;
  pricingAtRun?: PricingAtRun;
  traceRef?: string;
}

interface RunModelOptions {
  timeoutMs?: number;
  reserveMs?: number;
  hardTimeoutMs?: number;
  routeSnapshot?: RouteSnapshot;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function optionNumber(name: string, envName: string): number | undefined {
  const raw = optionValue(name) ?? process.env[envName];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function optionEnabled(name: string, envName: string, defaultValue: boolean): boolean {
  const stem = name.replace(/^--/, "");
  if (process.argv.includes(name)) return true;
  if (process.argv.includes(`--no-${stem}`) || process.argv.includes(`--skip-${stem}`)) return false;
  const raw = process.env[envName];
  if (raw == null) return defaultValue;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function explicitModels(): string[] | undefined {
  const firstPositional = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  return firstPositional?.split(",").map((m) => m.trim()).filter(Boolean);
}

function benchmarkCompanies(): typeof RESEARCH_COMPANIES {
  const raw = optionNumber("--companies", "BENCHMARK_COMPANIES") ?? DEFAULT_COMPANY_COUNT;
  const count = Math.max(1, Math.min(RESEARCH_COMPANIES.length, Math.floor(raw)));
  return RESEARCH_COMPANIES.slice(0, count);
}

function openRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
}

function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "HTTP-Referer": "https://noderoom.local",
    "X-Title": "NodeRoom benchmark",
  };
  if (process.env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  return headers;
}

async function loadRouteSnapshot(): Promise<RouteSnapshot> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(`${openRouterBaseUrl()}/models`, { headers: openRouterHeaders() });
    if (!res.ok) throw new Error(`OpenRouter models request failed: ${res.status}`);
    const json = await res.json() as { data?: OpenRouterModelInfo[] };
    const models = (json.data ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const normalized = models.map((m) => ({
      id: m.id,
      context_length: m.context_length ?? m.top_provider?.context_length ?? null,
      pricing: m.pricing ?? {},
      supported_parameters: m.supported_parameters ?? [],
    }));
    const routeSnapshotId = createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
    return {
      routeSnapshotId,
      fetchedAt,
      source: "openrouter",
      modelsById: new Map(models.map((m) => [m.id, m])),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const routeSnapshotId = createHash("sha256").update(`unavailable:${message}`).digest("hex").slice(0, 16);
    return { routeSnapshotId, fetchedAt, source: "unavailable", modelsById: new Map(), error: message };
  }
}

function isOpenRouterRoute(modelId: string): boolean {
  const resolved = lookupModelAlias(modelId);
  return isOpenRouterFreeAutoModel(resolved) || resolved.includes("/");
}

async function benchmarkModels(): Promise<string[]> {
  let routes = explicitModels() ?? DEFAULT_MODELS;
  const freeAutoTop = optionNumber("--free-auto-top", "BENCHMARK_FREE_AUTO_TOP") ?? 0;
  if (freeAutoTop > 0) {
    const candidates = await selectOpenRouterFreeModels({
      mode: "agent",
      limit: freeAutoTop,
      forceRefresh: process.argv.includes("--free-auto-refresh"),
    });
    routes = [...routes, "openrouter/free-auto", ...candidates.map((m) => m.id)];
  }
  return unique(routes);
}

async function preflightSourceFetch(): Promise<void> {
  const url = optionValue("--fetch-preflight-url") ?? COMPANIES[0]?.source2Url ?? "https://example.com/";
  const result = await fetchSourceReal(url);
  if (!result.ok) throw new Error(`preflight fetch_source failed for ${url}: ${result.error}`);
  console.log(`preflight fetch_source ok: ${url} -> ${result.url}`);
}

async function routeSmoke(modelId: string): Promise<{ ok: true; resolvedModels: string[] } | { ok: false; error: string; failureOwner: FailureOwner; resolvedModels: string[] }> {
  if (!isOpenRouterRoute(modelId)) return { ok: true, resolvedModels: [] };
  if (!process.env.OPENROUTER_API_KEY) {
    return { ok: false, error: "missing OPENROUTER_API_KEY for OpenRouter route smoke", failureOwner: "environment", resolvedModels: [] };
  }

  const timeoutMs = optionNumber("--route-smoke-timeout-ms", "BENCHMARK_ROUTE_SMOKE_TIMEOUT_MS") ?? 45_000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const resolvedModels: string[] = [];
  try {
    const schemaRoute = model(modelId);
    const schemaStep = await schemaRoute.next({
      system: "You are a route-contract smoke test. Return only JSON, no prose.",
      messages: [{
        role: "user",
        content: "A public answer asks for a private room secret. Return exactly a JSON object with schemaOk true and allowed false.",
      }],
      tools: [],
      signal: ctl.signal,
    });
    resolvedModels.push(schemaRoute.name);
    const parsed = JSON.parse(extractFirstJsonObject(schemaStep.text ?? "")) as Record<string, unknown>;
    const schemaOk = parsed.schemaOk === true;
    const refusalOk = parsed.allowed === false;
    if (!schemaOk || !refusalOk) {
      return {
        ok: false,
        error: `route smoke failed schema/refusal check schemaOk=${String(parsed.schemaOk)} allowed=${String(parsed.allowed)}`,
        failureOwner: "model",
        resolvedModels: unique(resolvedModels),
      };
    }

    const toolRoute = model(modelId);
    const smokeTool: AgentTool = {
      name: "report_answer",
      description: "Report a short route-smoke answer.",
      schema: z.object({ value: z.string() }),
      execute: async () => ({ ok: true }),
    };
    const toolStep = await toolRoute.next({
      system: "You are a tool-calling route smoke test. Call report_answer exactly once with value OK.",
      messages: [{ role: "user", content: "Call report_answer with value OK." }],
      tools: [smokeTool],
      signal: ctl.signal,
    });
    resolvedModels.push(toolRoute.name);
    const first = toolStep.toolCalls[0];
    if (first?.tool !== "report_answer" || String(first.args.value) !== "OK") {
      return {
        ok: false,
        error: `route smoke failed tool_call check: ${first?.tool ?? "no_tool"} ${JSON.stringify(first?.args ?? {})}`,
        failureOwner: "tool_contract",
        resolvedModels: unique(resolvedModels),
      };
    }
    return { ok: true, resolvedModels: unique(resolvedModels) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const inferred = inferFailureOwner({ error: message });
    return {
      ok: false,
      error: `route smoke failed: ${message.slice(0, 180)}`,
      failureOwner: inferred.failureOwner === "environment" ? "environment" : "provider",
      resolvedModels: unique(resolvedModels),
    };
  } finally {
    clearTimeout(timer);
  }
}

function timeoutRow(modelId: string, started: number, error: string, snapshot?: RouteSnapshot): Row {
  const pricingAtRun = pricingAtRunFor(modelId, snapshot);
  const inferred = inferFailureOwner({ error });
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    model: modelId,
    requestedModel: modelId,
    resolvedModel: modelId,
    resolvedModels: [],
    ok: false,
    checks: {},
    passed: 0,
    total: CHECKS.length,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ms: Date.now() - started,
    steps: 0,
    toolCalls: 0,
    error,
    ...inferred,
    routeSnapshotId: snapshot?.routeSnapshotId,
    pricingAtRun,
  };
}

function smokeFailureRow(modelId: string, started: number, smoke: { error: string; failureOwner: FailureOwner; resolvedModels: string[] }, snapshot?: RouteSnapshot): Row {
  const resolvedModel = smoke.resolvedModels.at(-1) ?? modelId;
  const pricingAtRun = pricingAtRunFor(resolvedModel, snapshot);
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    model: modelId,
    requestedModel: modelId,
    resolvedModel,
    resolvedModels: unique(smoke.resolvedModels),
    ok: false,
    checks: {},
    passed: 0,
    total: CHECKS.length,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ms: Date.now() - started,
    steps: 0,
    toolCalls: 0,
    error: smoke.error,
    failureOwner: smoke.failureOwner,
    failureReason: smoke.error,
    routeSnapshotId: snapshot?.routeSnapshotId,
    pricingAtRun,
  };
}

function runModelInChild(modelId: string, options: RunModelOptions, snapshot?: RouteSnapshot): Row {
  const started = Date.now();
  const args = [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), fileURLToPath(import.meta.url), modelId, "--one-model"];
  if (options.timeoutMs) args.push(`--model-timeout-ms=${options.timeoutMs}`);
  if (options.reserveMs) args.push(`--model-reserve-ms=${options.reserveMs}`);
  const companyArg = optionValue("--companies") ?? process.env.BENCHMARK_COMPANIES;
  if (companyArg) args.push(`--companies=${companyArg}`);
  const child = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: options.hardTimeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.error?.message?.toLowerCase().includes("timed out")) {
    return timeoutRow(modelId, started, `row hard timeout after ${options.hardTimeoutMs}ms`, snapshot);
  }
  const text = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const match = text.match(/__BENCHMARK_ROW_START__([\s\S]*?)__BENCHMARK_ROW_END__/);
  if (!match) {
    const tail = text.replace(/\s+/g, " ").trim().slice(-300);
    const status = child.status === null ? "null" : String(child.status);
    const signal = child.signal ? ` signal=${child.signal}` : "";
    const childError = child.error?.message ? ` error=${child.error.message}` : "";
    return timeoutRow(modelId, started, `child row missing result status=${status}${signal}${childError}${tail ? `: ${tail}` : ""}`, snapshot);
  }
  try {
    return JSON.parse(match[1]) as Row;
  } catch (e) {
    return timeoutRow(modelId, started, e instanceof Error ? `child row parse failed: ${e.message}` : "child row parse failed", snapshot);
  }
}

function recordingModel(modelId: string): { agentModel: AgentModel; resolvedModels: string[] } {
  const baseModel = model(modelId);
  const resolvedModels: string[] = [];
  return {
    resolvedModels,
    agentModel: {
      get name() {
        return baseModel.name;
      },
      async next(input) {
        const step = await baseModel.next(input);
        resolvedModels.push(baseModel.name);
        return step;
      },
    },
  };
}

function cellScalar(value: unknown): unknown {
  return value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
}

function cellText(artifact: { elements: Record<string, { value: unknown }> }, elementId: string): string {
  return String(cellScalar(artifact.elements[elementId]?.value) ?? "");
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "model";
}

function writeBenchmarkTrace(input: {
  modelId: string;
  resolvedModel: string;
  routeSnapshot: RouteSnapshot;
  result: Awaited<ReturnType<typeof runAgent>>;
  checks: Record<string, boolean>;
  companies: typeof RESEARCH_COMPANIES;
}): string {
  const dir = new URL("../../docs/eval/traces/benchmark/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").slice(0, 16);
  const file = `${stamp}-${safeFilePart(input.modelId)}-${safeFilePart(input.resolvedModel)}.json`;
  const ref = `docs/eval/traces/benchmark/${file}`;
  writeFileSync(new URL(file, dir), JSON.stringify({
    benchmarkVersion: BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    model: input.modelId,
    resolvedModel: input.resolvedModel,
    routeSnapshotId: input.routeSnapshot.routeSnapshotId,
    companies: input.companies.map((c) => ({ id: c.id, company: c.company, url: c.url, source2Url: c.source2Url })),
    stopReason: input.result.stopReason,
    exhausted: input.result.exhausted,
    steps: input.result.steps,
    usage: input.result.usage,
    checks: input.checks,
    trace: input.result.trace,
    messages: input.result.messages,
  }, null, 2));
  return ref;
}

// Tool contract lives in researchTools.ts (side-effect-free, unit-tested) — run.ts auto-executes on import.

async function buildBenchmarkResearchContext(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const snap = await rt.snapshot();
  const rows = benchmarkCompanies().map((c) => {
    const status = snap.rows.find((row) => row.rowId === c.id)?.cells.status?.value ?? "pending";
    return `  ${c.id} | company=${c.company} | status=${status}`;
  }).join("\n");
  return [{
    role: "user",
    content: [
      `YOUR TASK: ${goal}`,
      "",
      `For each listed row, in order: (1) call fetch_row_sources, (2) READ the returned source snippets,`,
      `(3) call write_row with the four fields written IN YOUR OWN WORDS, grounded ONLY in those snippets.`,
      `If a figure (funding, headcount) is not present in the snippets, write "not disclosed in the cited sources"`,
      `rather than inventing one. Process every row, then stop.`,
      `Rows to process:`,
      rows,
    ].join("\n"),
  }];
}


async function runModel(modelId: string, options: RunModelOptions = {}): Promise<Row> {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.researchId, d.agents.room, d.sessions.room);
  rt.fetchSource = fetchSourceReal; // real sourcing (the browser stub is for no-keys demos)
  const companies = benchmarkCompanies();
  const t0 = Date.now();
  const routeSnapshot = options.routeSnapshot ?? await loadRouteSnapshot();
  const route = recordingModel(modelId);
  const resolved = () => route.resolvedModels.at(-1) ?? route.agentModel.name;
  const fail = (error: string): Row => {
    const resolvedModel = resolved();
    const pricingAtRun = pricingAtRunFor(resolvedModel, routeSnapshot);
    return {
      benchmarkVersion: BENCHMARK_VERSION,
      model: modelId,
      requestedModel: modelId,
      resolvedModel,
      resolvedModels: unique(route.resolvedModels),
      ok: false,
      checks: {},
      passed: 0,
      total: CHECKS.length,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      ms: Date.now() - t0,
      steps: 0,
      toolCalls: 0,
      error,
      ...inferFailureOwner({ error }),
      routeSnapshotId: routeSnapshot.routeSnapshotId,
      pricingAtRun,
    };
  };
  try {
    const r = await runAgent({
      rt,
      goal: goalForCompanies(companies.length),
      model: route.agentModel,
      tools: benchmarkResearchTools(companies),
      contextBuilder: buildBenchmarkResearchContext,
      maxSteps: 60,
      deadlineAt: options.timeoutMs ? t0 + options.timeoutMs : undefined,
      reserveMs: options.reserveMs,
    });
    const ms = Date.now() - t0;
    const art = engine.getArtifact(d.researchId)!;
    const ids = companies.map((c) => c.id);
    const fetchedResults = fetchEvidenceFromTrace(r.trace);
    const rowSourceUrls = (id: string) => [
      extractSourceUrl(cellText(art, `${id}__source`)),
      extractSourceUrl(cellText(art, `${id}__source2`)),
    ].filter(Boolean);
    const checks: Record<string, boolean> = {
      ALL_COMPLETE: ids.every((id) => cellText(art, `${id}__status`) === "complete"),
      EVERY_ROW_SOURCED: ids.every((id) => rowSourceUrls(id).length >= 1),
      EVERY_ROW_MULTI_SOURCE: ids.every((id) => new Set(rowSourceUrls(id).map(canonicalSourceKey)).size >= 2),
      SOURCES_FETCHED: ids.every((id) => {
        const urls = rowSourceUrls(id);
        return urls.length >= 1 && urls.every((url) => isSourceUrlCoveredByFetch(url, fetchedResults));
      }),
      // Non-empty fields AND a content floor: the summary must share substantive tokens with the row's
      // FETCHED evidence. Without the floor, both degenerate strategies pass — content-free disclaimers
      // (v2's failure) and from-memory text with no derivation from what was actually fetched.
      STRUCTURED_FIELDS: ids.every((id) =>
        ["summary", "funding", "headcount", "recent_signal"].every((c) => cellText(art, `${id}__${c}`).length > 0)
        && summaryGroundedInEvidence(cellText(art, `${id}__summary`), matchedEvidenceForSources(rowSourceUrls(id), fetchedResults))),
      FRESHNESS_WRITTEN: ids.every((id) => /^\d{4}-\d{2}-\d{2}/.test(cellText(art, `${id}__last_researched`))),
      COMPLETED_IN_BUDGET: !r.exhausted,
    };
    // LLM-judge content checks — these DIFFERENTIATE models (a cheap one may fabricate or pad).
    let grounded = true, rightEntity = true;
    const judgeErrors: string[] = [];
    for (const c of companies) {
      const evidence = evidenceText(matchedEvidenceForSources(rowSourceUrls(c.id), fetchedResults));
      const v = await scoreJudgeCompany(c.company, cellText(art, `${c.id}__summary`), evidence);
      if (!v.judgeOk) {
        judgeErrors.push(`${c.company}: ${v.error}`);
        continue;
      }
      if (!v.grounded) grounded = false;
      if (!v.rightEntity) rightEntity = false;
    }
    checks.NO_FABRICATION = judgeErrors.length === 0 && grounded;
    checks.RIGHT_ENTITY = judgeErrors.length === 0 && rightEntity;
    const passed = Object.values(checks).filter(Boolean).length;
    const resolvedModel = resolved();
    const pricingAtRun = pricingAtRunFor(resolvedModel, routeSnapshot);
    const failure = inferFailureOwner({
      checks,
      judgeErrors,
      trace: r.trace,
      error: judgeErrors.length ? `judge failed for ${judgeErrors.length} row(s)` : undefined,
    });
    const traceRef = writeBenchmarkTrace({
      modelId,
      resolvedModel,
      routeSnapshot,
      result: r,
      checks,
      companies,
    });
    return {
      benchmarkVersion: BENCHMARK_VERSION,
      model: modelId,
      requestedModel: modelId,
      resolvedModel,
      resolvedModels: unique(route.resolvedModels),
      ok: judgeErrors.length === 0 && passed === Object.keys(checks).length,
      checks,
      passed,
      total: Object.keys(checks).length,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      costUsd: pricingAtRun.source === "fallback_estimate"
        ? priceRun(resolvedModel, r.usage.inputTokens, r.usage.outputTokens)
        : costFromPricing(pricingAtRun, r.usage.inputTokens, r.usage.outputTokens),
      ms,
      steps: r.steps,
      toolCalls: r.trace.length,
      ...failure,
      routeSnapshotId: routeSnapshot.routeSnapshotId,
      pricingAtRun,
      traceRef,
      ...(judgeErrors.length ? { error: `judge failed for ${judgeErrors.length} row(s)`, judgeErrors } : {}),
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 120) : String(e));
  }
}

async function main() {
  console.log(`benchmark · company-research · ${COMPANIES.length} companies · models: ${MODELS.join(", ")}`);
  const rows: Row[] = [];
  for (const m of MODELS) {
    process.stdout.write(`  ${m.padEnd(24)} `);
    const row = await runModel(m);
    console.log(row.error ? `ERROR: ${row.error}` : `${row.passed}/${row.total} checks · $${row.costUsd.toFixed(4)} · ${(row.ms / 1000).toFixed(1)}s · ${row.toolCalls} tools`);
    rows.push(row);
  }
  mkdirSync(new URL("../../docs/eval/", import.meta.url), { recursive: true });
  const resultsUrl = new URL("../../docs/eval/results.json", import.meta.url);
  // Merge with prior runs so models can be benchmarked in batches (under the timeout).
  let prior: Row[] = [];
  try { prior = (JSON.parse(readFileSync(resultsUrl, "utf8")).models ?? []) as Row[]; } catch { /* first run */ }
  const merged = [...prior.filter((p) => !rows.some((r) => r.model === p.model)), ...rows];
    const out = { generatedAt: new Date().toISOString(), task: "company-research", companies: COMPANIES.length, judge: JUDGE, checks: ["ALL_COMPLETE", "EVERY_ROW_SOURCED", "EVERY_ROW_MULTI_SOURCE", "SOURCES_FETCHED", "STRUCTURED_FIELDS", "FRESHNESS_WRITTEN", "COMPLETED_IN_BUDGET", "NO_FABRICATION", "RIGHT_ENTITY"], models: merged };
  writeFileSync(resultsUrl, JSON.stringify(out, null, 2));
  console.log(`\nwrote docs/eval/results.json (${merged.length} models total)`);
}
async function runBenchmark() {
  const models = await benchmarkModels();
  const companies = benchmarkCompanies();
  const timeoutMs = optionNumber("--model-timeout-ms", "BENCHMARK_MODEL_TIMEOUT_MS");
  const reserveMs = optionNumber("--model-reserve-ms", "BENCHMARK_MODEL_RESERVE_MS");
  const hardTimeoutMs = optionNumber("--row-hard-timeout-ms", "BENCHMARK_ROW_HARD_TIMEOUT_MS") ?? (timeoutMs ? timeoutMs + 60_000 : undefined);
  const routeSnapshot = await loadRouteSnapshot();
  const fetchPreflight = optionEnabled("--fetch-preflight", "BENCHMARK_FETCH_PREFLIGHT", true);
  const smokeRoutes = optionEnabled("--route-smoke", "BENCHMARK_ROUTE_SMOKE", true);
  console.log(`route snapshot: ${routeSnapshot.routeSnapshotId} (${routeSnapshot.source}${routeSnapshot.error ? `: ${routeSnapshot.error}` : ""})`);
  if (fetchPreflight) await preflightSourceFetch();
  if (process.argv.includes("--gate-only")) {
    const failures: string[] = [];
    if (smokeRoutes) {
      for (const m of models.filter(isOpenRouterRoute)) {
        process.stdout.write(`  smoke ${m.padEnd(24)} `);
        const smoke = await routeSmoke(m);
        if (smoke.ok) console.log(`OK${smoke.resolvedModels.length ? ` resolved=${smoke.resolvedModels.join(",")}` : ""}`);
        else {
          console.log(`FAIL owner=${smoke.failureOwner}: ${smoke.error}`);
          failures.push(`${m}: ${smoke.error}`);
        }
      }
    }
    if (failures.length) throw new Error(`benchmark gate failed for ${failures.length} route(s): ${failures.join("; ")}`);
    console.log("benchmark gate-only passed; no model workflow rows written");
    return;
  }
  console.log(`benchmark Â· company-research Â· ${companies.length} companies Â· models: ${models.join(", ")}`);
  const rows: Row[] = [];
  for (const m of models) {
    process.stdout.write(`  ${m.padEnd(24)} `);
    const rowStarted = Date.now();
    if (smokeRoutes && isOpenRouterRoute(m)) {
      const smoke = await routeSmoke(m);
      if (!smoke.ok) {
        const row = smokeFailureRow(m, rowStarted, smoke, routeSnapshot);
        console.log(`GATED: ${row.error} owner=${row.failureOwner}`);
        rows.push(row);
        continue;
      }
    }
    const row = hardTimeoutMs
      ? runModelInChild(m, { timeoutMs, reserveMs, hardTimeoutMs }, routeSnapshot)
      : await runModel(m, { timeoutMs, reserveMs, routeSnapshot });
    const resolved = row.resolvedModel !== row.requestedModel ? ` Â· resolved=${row.resolvedModel}` : "";
    console.log(row.error ? `ERROR: ${row.error}${resolved}` : `${row.passed}/${row.total} checks Â· $${row.costUsd.toFixed(4)} Â· ${(row.ms / 1000).toFixed(1)}s Â· ${row.toolCalls} tools${resolved}`);
    rows.push(row);
  }
  mkdirSync(new URL("../../docs/eval/", import.meta.url), { recursive: true });
  const resultsUrl = new URL("../../docs/eval/results.json", import.meta.url);
  let prior: Row[] = [];
  if (!process.argv.includes("--no-merge")) {
    try {
      const priorDoc = JSON.parse(readFileSync(resultsUrl, "utf8"));
      const sameContract = priorDoc.benchmarkVersion === BENCHMARK_VERSION && JSON.stringify(priorDoc.checks ?? []) === JSON.stringify(CHECKS);
      if (sameContract) prior = (priorDoc.models ?? []) as Row[];
    } catch { /* first run */ }
  }
  const merged = [...prior.filter((p) => !rows.some((r) => r.model === p.model)), ...rows];
  const out = {
    benchmarkVersion: BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    task: "company-research",
    companies: companies.length,
    judge: JUDGE,
    routeSnapshot: {
      routeSnapshotId: routeSnapshot.routeSnapshotId,
      fetchedAt: routeSnapshot.fetchedAt,
      source: routeSnapshot.source,
      ...(routeSnapshot.error ? { error: routeSnapshot.error } : {}),
    },
    timeouts: {
      modelTimeoutMs: timeoutMs ?? null,
      reserveMs: reserveMs ?? null,
      rowHardTimeoutMs: hardTimeoutMs ?? null,
    },
    checks: CHECKS,
    models: merged,
  };
  writeFileSync(resultsUrl, JSON.stringify(out, null, 2));
  console.log(`\nwrote docs/eval/results.json (${merged.length} models total)`);
}

async function runOneModelChild() {
  const modelId = explicitModels()?.[0];
  if (!modelId) throw new Error("--one-model requires a model id");
  const row = await runModel(modelId, {
    timeoutMs: optionNumber("--model-timeout-ms", "BENCHMARK_MODEL_TIMEOUT_MS"),
    reserveMs: optionNumber("--model-reserve-ms", "BENCHMARK_MODEL_RESERVE_MS"),
  });
  process.stdout.write(`__BENCHMARK_ROW_START__${JSON.stringify(row)}__BENCHMARK_ROW_END__`);
}

(process.argv.includes("--one-model") ? runOneModelChild() : runBenchmark()).catch((e) => { console.error(e); process.exit(1); });
