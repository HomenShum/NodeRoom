/**
 * Real, paid qualification of the Google ADK adapter (cap $0.50).
 *   npx tsx scripts/qualify-adk.ts
 * Run 1 exercises goals, native skill load, Node tool search -> deferred tool call,
 * two concurrent helpers and token-based compaction (knob: RunSpec.context.autoCompactTokens
 * -> TokenBasedContextCompactor.tokenThreshold, set to COMPACT_TOKENS). Run 2 is interrupted
 * mid-stream; run 3 resumes its ADK session id and activates a skill mid-run (skill refresh).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EngineEventDraft, EngineRunOutcome, NodeToolDefinition, RunSpec } from "../src/contract.js";
import { loadProviderEnv } from "../src/env.js";
import { countEvents, createFakeHost } from "../src/testing/fakeHost.js";
import { createGoogleAdkAdapter } from "../src/engines/googleAdk.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "gemini-3.5-flash";
const HELPER_MODEL = "gemini-3.5-flash-lite";
const CAP_USD = 0.5;
const ABORT_AT_USD = 0.45;
// Measured 2026-10-29: main-run prompts are ~1.3k-2.8k tokens, so 3000 never fired; 1800 does.
const COMPACT_TOKENS = 1800;
/** gemini-3.5-flash has no verified price; bound spend with gemini-3.1-pro-preview's (higher) price. */
const BOUND = { input: 2, output: 12, cacheRead: 0.2 };

const env = loadProviderEnv([resolve(PKG, "../../.env.local")]);
const stamp = Date.now();
const root = join(tmpdir(), "nodeagent-qual", `google-adk-${stamp}`);
const ws = join(root, "workspace");
const stateDir = join(root, "state");
mkdirSync(join(ws, "notes"), { recursive: true });
mkdirSync(join(ws, ".claude", "skills", "word-stats"), { recursive: true });

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i % 7}`).join(" ");
writeFileSync(join(ws, "notes", "alpha.txt"), `${words(137, "alpha")}\n`);
writeFileSync(join(ws, "notes", "beta.txt"), `${words(89, "beta")}\n`);
writeFileSync(
  join(ws, ".claude", "skills", "word-stats", "SKILL.md"),
  [
    "---",
    "name: word-stats",
    "description: Count words in workspace text files with the word_count Node tool.",
    "---",
    "# Word stats",
    "1. word_count is a deferred Node tool: call search_tools with query \"word count\", then load_tool with names [\"word_count\"].",
    "2. Call word_count with the workspace-relative path of each file (helpers may do this concurrently).",
    "3. Report each file's count and the total.",
    "",
  ].join("\n"),
);

function inside(p: string): string | null {
  const abs = resolve(ws, p);
  return abs === ws || abs.startsWith(ws + sep) ? abs : null;
}

const tools: NodeToolDefinition[] = [];
const searchable = () => tools.filter((t) => t.family !== "tool-meta");
tools.push(
  {
    name: "search_tools",
    family: "tool-meta",
    risk: "read",
    alwaysLoad: true,
    description: "Search the Node tool catalog by keywords. Returns tool names; call load_tool to make them callable.",
    schema: z.object({ query: z.string().max(200) }),
    async execute({ query }, ctx) {
      const q = query.toLowerCase().split(/\W+/).filter(Boolean);
      const found = searchable().filter((t) => q.some((w: string) => `${t.name} ${t.description} ${t.searchHint ?? ""}`.toLowerCase().includes(w)));
      ctx.emit({ type: "tool.search", query, results: found.map((t) => t.name), via: "node", agentId: ctx.agentId });
      return { ok: true, content: found.map((t) => `${t.name}${t.alwaysLoad ? "" : " (deferred)"}: ${t.description}`).join("\n") || "no match", data: { results: found.map((t) => t.name) } };
    },
  },
  {
    name: "load_tool",
    family: "tool-meta",
    risk: "read",
    alwaysLoad: true,
    description: "Make deferred Node tools callable by exact name.",
    schema: z.object({ names: z.array(z.string()).min(1).max(10) }),
    async execute({ names }, ctx) {
      const found = searchable().filter((t) => names.includes(t.name));
      if (!found.length) return { ok: false, content: `unknown tools: ${names.join(", ")}` };
      ctx.emit({ type: "tool.loaded", names: found.map((t) => t.name), via: "node-load-tool", agentId: ctx.agentId });
      return { ok: true, content: `loaded: ${found.map((t) => t.name).join(", ")}`, data: { loaded: found.map((t) => t.name) } };
    },
  },
  {
    name: "update_goals",
    family: "goals",
    risk: "propose",
    alwaysLoad: true,
    description: "Replace the run's goal list. Status is one of pending, active, done, blocked.",
    schema: z.object({
      goals: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(["pending", "active", "done", "blocked"]) })).max(12),
    }),
    async execute({ goals }, ctx) {
      ctx.emit({ type: "goals.updated", goals: goals.map((g: { id: string; title: string; status: "pending" | "active" | "done" | "blocked" }) => ({ ...g, claimedBy: "engine" as const })), source: "node-goals", agentId: ctx.agentId });
      return { ok: true, content: `goals: ${goals.map((g: { id: string; status: string }) => `${g.id}=${g.status}`).join(", ")}` };
    },
  },
  {
    name: "word_count",
    family: "workspace",
    risk: "read",
    description: "Count whitespace-separated words in a workspace text file.",
    searchHint: "word count words text file statistics",
    schema: z.object({ path: z.string().min(1) }),
    async execute({ path }) {
      const abs = inside(path);
      if (!abs) return { ok: false, content: `${path} is outside the workspace` };
      try {
        const n = readFileSync(abs, "utf8").split(/\s+/).filter(Boolean).length;
        return { ok: true, content: `${relative(ws, abs).replace(/\\/g, "/")}: ${n} words` };
      } catch (e) {
        return { ok: false, content: `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  },
  {
    name: "activate_line_stats_skill",
    family: "skills",
    risk: "write",
    alwaysLoad: true,
    description: "Install the line-stats skill into the workspace and refresh the engine's skill list.",
    schema: z.object({}),
    async execute(_args, ctx) {
      const dir = join(ws, ".claude", "skills", "line-stats");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "---\nname: line-stats\ndescription: Count lines in workspace text files.\n---\nCount lines with the available tools.\n");
      if (!ctx.refreshSkills) return { ok: false, content: "engine registered no skill refresher" };
      await ctx.refreshSkills();
      return { ok: true, content: "line-stats activated and engine skills refreshed" };
    },
  },
);

// ---------------------------------------------------------------------------

interface Captured {
  run: string;
  agentId?: string;
  event: unknown;
}
const captured: Captured[] = [];
let currentRun = "";
const adapter = createGoogleAdkAdapter({ onNative: (event, agentId) => captured.push({ run: currentRun, agentId, event: JSON.parse(JSON.stringify(event)) }) });

let spentBound = 0;
function bound(u: { inputTokens: number; outputTokens: number; cacheReadTokens: number }): number {
  return (u.inputTokens * BOUND.input + u.outputTokens * BOUND.output + u.cacheReadTokens * BOUND.cacheRead) / 1e6;
}

interface RunResult {
  name: string;
  outcome: EngineRunOutcome;
  events: EngineEventDraft[];
  wallMs: number;
}

async function run(name: string, prompt: string, extra: Partial<RunSpec>, onEvent?: (e: EngineEventDraft, interrupt: (r: string) => void) => void): Promise<RunResult> {
  currentRun = name;
  const host = createFakeHost({ env, stateDir, workspaceDir: ws, tools, runId: name, echo: false });
  const before = spentBound;
  const spec: RunSpec = {
    runId: name,
    projectId: "qual-adk",
    workspaceDir: ws,
    prompt,
    model: MODEL,
    helperModel: HELPER_MODEL,
    budget: { maxTurns: 40 },
    context: { autoCompactTokens: COMPACT_TOKENS },
    ...extra,
  };
  const t0 = Date.now();
  let handle: ReturnType<typeof adapter.start> | undefined;
  const interrupt = (r: string) => void handle?.interrupt(r);
  const emit = host.emit;
  host.emit = (e) => {
    emit(e);
    if (e.type === "usage") {
      spentBound = before + bound(e.totals);
      if (spentBound > ABORT_AT_USD) interrupt(`spend bound ${spentBound.toFixed(3)} > ${ABORT_AT_USD}`);
    }
    onEvent?.(e, interrupt);
  };
  const wall = setTimeout(() => interrupt("qualification wall clock 240s"), 240_000);
  handle = adapter.start(spec, host);
  const outcome = await handle.done;
  clearTimeout(wall);
  const wallMs = Date.now() - t0;
  console.log(`${name}: ${outcome.status} in ${wallMs}ms, events ${JSON.stringify(countEvents(host.events))}, bound $${spentBound.toFixed(4)}${outcome.error ? `, error: ${outcome.error}` : ""}`);
  return { name, outcome, events: host.events, wallMs };
}

const availability = await adapter.availability(env);
if (!availability.ok) {
  console.error("not available:", availability.missing);
  process.exit(1);
}

const t0 = Date.now();
const r1 = await run(
  "main",
  [
    "Report the word counts of notes/alpha.txt and notes/beta.txt. Do these steps in order:",
    "1. Call update_goals with three goals (g1 load skill, g2 count with helpers, g3 report); g1 active, others pending.",
    "2. Call load_skill for the word-stats skill and follow it.",
    "3. Call search_tools with query \"word count\", then load_tool with the tool it finds.",
    "4. Call run_helpers ONCE with exactly two tasks: one helper counts notes/alpha.txt with word_count, the other counts notes/beta.txt with word_count.",
    "5. Call update_goals with all three goals done.",
    "6. Reply with both counts and their sum.",
  ].join("\n"),
  {},
);

let sawDelta = false;
const r2 = await run(
  "interrupt",
  "Write a detailed 800-word explanation of how word counting works in text editors, with headings. Do not call any tools.",
  { context: {} },
  (e, interrupt) => {
    if (e.type === "message.delta" && !sawDelta) {
      sawDelta = true;
      setTimeout(() => interrupt("qualification interrupt after first streamed text"), 1500);
    }
  },
);

const r3 = r2.outcome.nativeSessionId
  ? await run(
      "resume",
      "You were interrupted. First call activate_line_stats_skill, then call list_skills. Reply with one sentence naming the topic you were writing about and the skill names list_skills returned.",
      { resume: { nativeSessionId: r2.outcome.nativeSessionId }, context: {} },
    )
  : undefined;
const wallMs = Date.now() - t0;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

type Status = "NATIVE" | "APP-IMPLEMENTED" | "UNSUPPORTED" | "UNTESTED";
const all = [r1, r2, ...(r3 ? [r3] : [])];
const ev1 = r1.events;
const of = <T extends EngineEventDraft["type"]>(events: EngineEventDraft[], type: T) =>
  events.filter((e): e is Extract<EngineEventDraft, { type: T }> => e.type === type);
const cap = (ok: boolean, status: Status, evidence: string, failNote = "not observed") => ({ status: ok ? status : "UNTESTED", evidence: ok ? evidence : `${failNote}: ${evidence}` });

const started1 = of(ev1, "run.started")[0];
const helpersStarted = of(ev1, "helper.started");
const helpersDone = of(ev1, "helper.completed");
const firstDoneIdx = ev1.findIndex((e) => e.type === "helper.completed");
const startedBeforeFirstDone = ev1.slice(0, firstDoneIdx < 0 ? ev1.length : firstDoneIdx).filter((e) => e.type === "helper.started").length;
const helperIds = new Set(helpersStarted.map((h) => h.helperId));
const childCalls = of(ev1, "tool.call").filter((c) => c.agentId && helperIds.has(c.agentId));
const searches = of(ev1, "tool.search");
const loads = of(ev1, "tool.loaded");
const wcCalls = of(ev1, "tool.call").filter((c) => c.name === "word_count");
const firstLoad = ev1.findIndex((e) => e.type === "tool.loaded");
const wcAfterLoad = ev1.findIndex((e, i) => i > firstLoad && e.type === "tool.call" && e.name === "word_count") > 0;
const skillLoaded = of(ev1, "skill.loaded").filter((s) => s.via === "native");
const compacted = of(ev1, "context.compacted");
const goals = of(ev1, "goals.updated");
const r3Search = r3 ? of(r3.events, "skill.search") : [];
const r3Started = r3 ? of(r3.events, "run.started")[0] : undefined;
const refreshed = r3Search.some((s) => s.results.includes("line-stats")) && !(r3Started?.skills ?? []).includes("line-stats");
const usageLast = r1.outcome.usage;
const totalCost = all.every((r) => r.outcome.usage.costUsd !== null) ? all.reduce((s, r) => s + (r.outcome.usage.costUsd ?? 0), 0) : null;

const capabilities = {
  start: cap(Boolean(started1?.nativeSessionId), "NATIVE", `run.started nativeSessionId=${started1?.nativeSessionId}; main run ${r1.outcome.status}`),
  stream: cap(of(ev1, "message.delta").length + of(r2.events, "message.delta").length > 0, "NATIVE", `message.delta main=${of(ev1, "message.delta").length} interrupt-run=${of(r2.events, "message.delta").length}`),
  interrupt: cap(r2.outcome.status === "interrupted", "NATIVE", `second run status=${r2.outcome.status} (${r2.outcome.error ?? ""}) after ${of(r2.events, "message.delta").length} deltas`),
  resume: cap(
    r3?.outcome.status === "completed" && r3.outcome.nativeSessionId === r2.outcome.nativeSessionId,
    "APP-IMPLEMENTED",
    `resume run status=${r3?.outcome.status} sessionId same=${r3?.outcome.nativeSessionId === r2.outcome.nativeSessionId}; final="${(r3?.outcome.finalText ?? "").slice(0, 160)}"`,
  ),
  subagents: cap(
    helpersStarted.length >= 2 && startedBeforeFirstDone >= 2,
    "APP-IMPLEMENTED",
    `helper.started=${helpersStarted.length} helper.completed=${helpersDone.length} (${helpersDone.map((h) => h.status).join(",")}); ${startedBeforeFirstDone} helpers started before the first completed (concurrent)`,
  ),
  childEventIdentity: cap(childCalls.length >= 2, "APP-IMPLEMENTED", `${childCalls.length} tool.call events carry a helper agentId (${[...new Set(childCalls.map((c) => c.agentId))].join(", ")})`),
  compaction: cap(
    compacted.length > 0,
    "NATIVE",
    `context.compacted=${compacted.length} (preTokens ${compacted.map((c) => c.preTokens).join(",")}, threshold ${COMPACT_TOKENS} via TokenBasedContextCompactor.tokenThreshold)`,
  ),
  toolSearch: cap(
    searches.length > 0 && loads.length > 0 && wcAfterLoad,
    "APP-IMPLEMENTED",
    `tool.search=${searches.length} tool.loaded=${loads.length} (${loads.map((l) => l.names.join("+")).join(",")}); word_count tool.call=${wcCalls.length}, first after load=${wcAfterLoad}`,
  ),
  skillLoad: cap(skillLoaded.length > 0, "NATIVE", `skill.loaded via native: ${skillLoaded.map((s) => `${s.name} sha256=${s.sha256?.slice(0, 12)}`).join(", ")}`),
  skillRefresh: cap(refreshed, "APP-IMPLEMENTED", `resume run: run.started.skills=[${r3Started?.skills.join(",") ?? ""}], list_skills after refresh=[${r3Search.map((s) => s.results.join(",")).join(" | ")}]`),
  goals: cap(goals.length >= 2, "APP-IMPLEMENTED", `goals.updated=${goals.length}; last=${JSON.stringify(goals.at(-1)?.goals.map((g) => `${g.id}:${g.status}`))}`),
  permissions: {
    status: "UNTESTED" as Status,
    evidence: "no native side-effecting tool is exposed (only list_skills/load_skill/load_skill_resource/run_helpers + Node tools), so no permission.decision could occur in a real run",
  },
  usage: cap(usageLast.inputTokens > 0 && usageLast.outputTokens > 0, "NATIVE", `main run usage in=${usageLast.inputTokens} out=${usageLast.outputTokens} cacheRead=${usageLast.cacheReadTokens} modelTurns=${usageLast.modelTurns}; usage events=${of(ev1, "usage").length}`),
  costUsd: {
    status: "APP-IMPLEMENTED" as Status,
    evidence: `price-table only (ADK reports no USD). main run costUsd=${usageLast.costUsd} source=${usageLast.costSource}; null because pricing.ts has no verified price for ${MODEL}`,
  },
};

const eventCounts = Object.fromEntries(all.map((r) => [r.name, countEvents(r.events)]));
const receipt = {
  engine: "google-adk",
  sdk: "@google/adk",
  sdkVersion: adapter.descriptor().sdk.version,
  model: MODEL,
  helperModel: HELPER_MODEL,
  ranAt: new Date(stamp).toISOString(),
  wallMs,
  costUsd: totalCost,
  spendUpperBoundUsd: Math.round(spentBound * 1e4) / 1e4,
  spendCapUsd: CAP_USD,
  eventCounts,
  runs: all.map((r) => ({ name: r.name, status: r.outcome.status, error: r.outcome.error, wallMs: r.wallMs, nativeSessionId: r.outcome.nativeSessionId, usage: r.outcome.usage, finalText: r.outcome.finalText.slice(0, 400) })),
  capabilities,
  notes: [
    `Compaction knob: RunSpec.context.autoCompactTokens=${COMPACT_TOKENS} -> TokenBasedContextCompactor.tokenThreshold (eventRetentionSize 6, LlmSummarizer on ${HELPER_MODEL}).`,
    "Concurrency: ADK JS 2.4.0 agents/functions.js awaits each function call in a for-loop and AgentTool swallows child events, so helpers run as native ADK child Runners started together by the adapter's run_helpers tool.",
    "Spend bound uses gemini-3.1-pro-preview prices for every token (gemini-3.5-flash is unpriced in pricing.ts); it is an upper bound, not a cost.",
    "Sessions: InMemorySessionService + JSON snapshot under stateDir/adk-sessions (DatabaseSessionService needs @mikro-orm/sqlite, not installed).",
    "Earlier attempt (2026-10-29T12:38Z, same script with threshold 3000) spent an upper bound of $0.1151; compaction did not fire because prompts stayed under 3000 tokens.",
    `Workspace: ${root}`,
  ],
};
mkdirSync(join(PKG, "qualification"), { recursive: true });
writeFileSync(join(PKG, "qualification", "google-adk.json"), `${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(join(root, "native-events.json"), JSON.stringify(captured));
console.log(JSON.stringify(capabilities, null, 2));
console.log(`native events captured: ${captured.length} -> ${join(root, "native-events.json")}`);

// Deterministic-test fixture: real native events, trimmed (no thought signatures, temp paths masked).
const KEEP_PARTIALS = 2;
const partialsSeen = new Map<string, number>();
const trim = (v: unknown): unknown => {
  if (typeof v === "string") {
    const s = v.split(root).join("<qual>").split(root.replaceAll("\\", "/")).join("<qual>");
    return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  }
  if (Array.isArray(v)) return v.map(trim);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "thoughtSignature").map(([k, x]) => [k, trim(x)]));
  return v;
};
const lines = captured
  .filter((c) => {
    if (!(c.event as { partial?: boolean }).partial) return true;
    const n = (partialsSeen.get(c.run) ?? 0) + 1;
    partialsSeen.set(c.run, n);
    return n <= KEEP_PARTIALS;
  })
  .map((c) => JSON.stringify(trim(c)));
mkdirSync(join(PKG, "test", "fixtures"), { recursive: true });
writeFileSync(join(PKG, "test", "fixtures", "google-adk-native.jsonl"), `${lines.join("\n")}\n`);
console.log(`fixture: ${lines.length} native events -> test/fixtures/google-adk-native.jsonl`);
