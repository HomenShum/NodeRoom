/**
 * Real, paid qualification of the OpenAI Agents SDK adapter (cap $1.00).
 *   npx tsx scripts/qualify-openai.ts
 * Run 1 exercises skills, goals, deferred-tool search, two concurrent helpers and
 * server-side compaction (modelSettings.contextManagement, threshold lowered via
 * spec.context.autoCompactTokens). Run 2 is interrupted at its first helper; run 3
 * resumes it by native session id. Writes qualification/openai-agents.json and the
 * trimmed native fixture test/fixtures/openai-agents-native.jsonl.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EngineEventDraft, EngineRunOutcome, NodeToolDefinition, RunSpec } from "../src/contract.js";
import { createOpenAIAgentsAdapter, type NativeRecord } from "../src/engines/openaiAgents.js";
import { loadProviderEnv } from "../src/env.js";
import { countEvents, createFakeHost } from "../src/testing/fakeHost.js";

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const MODEL = process.env.QUAL_MODEL ?? "gpt-5.4-mini";
const HELPER_MODEL = process.env.QUAL_HELPER_MODEL ?? "gpt-5.4-mini";
const COMPACT_TOKENS = Number(process.env.QUAL_COMPACT_TOKENS ?? 1000);
const CAP_USD = 1.0;
const env = loadProviderEnv([join(PKG, "..", "..", ".env.local")]);

const root = join(tmpdir(), "nodeagent-qual", `openai-agents-${Date.now()}`);
const ws = join(root, "ws");
mkdirSync(join(ws, "notes"), { recursive: true });
mkdirSync(join(ws, ".claude", "skills", "word-stats"), { recursive: true });
writeFileSync(join(ws, "notes", "alpha.txt"), "the quick brown fox jumps over the lazy dog\nand then the fox sleeps\n");
writeFileSync(join(ws, "notes", "beta.txt"), "agents run tools in a loop until the task is done\n");
writeFileSync(
  join(ws, ".claude", "skills", "word-stats", "SKILL.md"),
  [
    "---",
    "name: word-stats",
    "description: Count words in workspace text files and report per-file and total counts.",
    "---",
    "# Word stats",
    "1. Never count words by reading text yourself. Use the Node tool `word_count` with the workspace-relative path.",
    "2. `word_count` is deferred: find it with tool_search first.",
    "3. Report each file's count and the total, citing each file as [src:<path>#L1].",
    "",
  ].join("\n"),
);

function inside(p: string): string | null {
  const abs = resolve(ws, p);
  const rel = relative(ws, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? null : abs;
}

const tools: NodeToolDefinition[] = [
  {
    name: "word_count",
    family: "workspace",
    risk: "read",
    description: "Count the words in one workspace text file.",
    searchHint: "count words in a file",
    schema: z.object({ path: z.string().describe("workspace-relative path") }),
    async execute({ path }) {
      const abs = inside(path);
      if (!abs) return { ok: false, content: `path outside workspace: ${path}` };
      try {
        const n = readFileSync(abs, "utf8").split(/\s+/).filter(Boolean).length;
        return { ok: true, content: JSON.stringify({ path, words: n }) };
      } catch (e) {
        return { ok: false, content: `cannot read ${path}: ${(e as Error).message}` };
      }
    },
  },
  {
    name: "search_skills",
    family: "skills",
    risk: "read",
    alwaysLoad: true,
    description: "Search workspace skills by keyword. Returns names and descriptions.",
    schema: z.object({ query: z.string() }),
    async execute({ query }, ctx) {
      const dir = join(ctx.workspaceDir, ".claude", "skills");
      const words = query.toLowerCase().split(/\W+/).filter(Boolean);
      const hits = readdirSync(dir)
        .map((name) => ({ name, text: readFileSync(join(dir, name, "SKILL.md"), "utf8") }))
        .filter((s) => words.some((w: string) => s.text.toLowerCase().includes(w)))
        .map((s) => ({ name: s.name, description: /description:\s*(.*)/.exec(s.text)?.[1] ?? "" }));
      ctx.emit({ type: "skill.search", query, results: hits.map((h) => h.name), via: "node", ...(ctx.agentId ? { agentId: ctx.agentId } : {}) });
      return { ok: true, content: JSON.stringify(hits) };
    },
  },
  {
    name: "load_skill",
    family: "skills",
    risk: "read",
    alwaysLoad: true,
    description: "Load a workspace skill's SKILL.md instructions by name.",
    schema: z.object({ name: z.string() }),
    async execute({ name }, ctx) {
      if (!/^[a-z0-9-]+$/.test(name)) return { ok: false, content: `invalid skill name ${name}` };
      try {
        const text = readFileSync(join(ctx.workspaceDir, ".claude", "skills", name, "SKILL.md"), "utf8");
        const sha256 = createHash("sha256").update(text).digest("hex");
        ctx.emit({ type: "skill.loaded", name, sha256, via: "node", ...(ctx.agentId ? { agentId: ctx.agentId } : {}) });
        return { ok: true, content: text };
      } catch {
        return { ok: false, content: `skill ${name} not found` };
      }
    },
  },
  {
    name: "update_goals",
    family: "goals",
    risk: "propose",
    alwaysLoad: true,
    description: "Replace the run's goal list (the plan). Statuses: pending, active, done, blocked.",
    schema: z.object({
      goals: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(["pending", "active", "done", "blocked"]) })),
    }),
    async execute({ goals }, ctx) {
      ctx.emit({ type: "goals.updated", goals: goals.map((g: { id: string; title: string; status: "pending" | "active" | "done" | "blocked" }) => ({ ...g, claimedBy: "engine" as const })), source: "update_goals" });
      return { ok: true, content: `goals updated (${goals.length})` };
    },
  },
];

const adapterRecords: NativeRecord[] = [];
const adapter = createOpenAIAgentsAdapter({ onNative: (r) => adapterRecords.push(r) });
let spentUsd = 0;

function spec(id: string, prompt: string, extra: Partial<RunSpec> = {}): RunSpec {
  return {
    runId: id,
    projectId: "qual",
    workspaceDir: ws,
    prompt,
    model: MODEL,
    helperModel: HELPER_MODEL,
    budget: { maxTurns: 30 },
    context: {},
    ...extra,
  };
}

async function drive(id: string, s: RunSpec, onEvent?: (e: EngineEventDraft, interrupt: (r: string) => void) => void) {
  const host = createFakeHost({ env, stateDir: join(root, "state"), workspaceDir: ws, tools, runId: id, echo: false });
  const emit = host.emit;
  let handle: ReturnType<typeof adapter.start> | undefined;
  const interrupt = (r: string) => void handle?.interrupt(r);
  host.emit = (e) => {
    emit(e);
    if (e.type === "usage" && e.totals.costUsd !== null && spentUsd + e.totals.costUsd > CAP_USD) {
      console.error(`spend cap $${CAP_USD} exceeded, aborting ${id}`);
      host.controller.abort("spend cap exceeded");
    }
    onEvent?.(e, interrupt);
  };
  const t0 = Date.now();
  handle = adapter.start(s, host);
  const outcome: EngineRunOutcome = await handle.done;
  spentUsd += outcome.usage.costUsd ?? 0;
  console.log(`${id}: ${outcome.status} in ${Date.now() - t0}ms, cost ${outcome.usage.costUsd}, error=${outcome.error ?? "-"}`);
  console.log(`${id} counts`, JSON.stringify(countEvents(host.events)));
  return { outcome, events: host.events, ms: Date.now() - t0 };
}

const ranAt = new Date().toISOString();
const wall0 = Date.now();
const availability = await adapter.availability(env);
if (!availability.ok) {
  console.error("not available:", availability.missing);
  process.exit(1);
}

const TASK = [
  "Report word statistics for notes/alpha.txt and notes/beta.txt. Follow these steps exactly:",
  "1. Call search_skills with query 'word count', then load_skill for the matching skill, and follow it.",
  "2. Call update_goals with a 3-item plan (load skill, count both files, report).",
  "3. Your next response must contain exactly TWO spawn_helper function calls side by side (parallel tool calls in the same message):",
  "   one for notes/alpha.txt and one for notes/beta.txt. Do not wait for the first helper before starting the second.",
  "   Tell each helper: 'Do not search skills. Find the word counting tool with tool_search, call it on <file>, reply with the count.'",
  "4. When both helpers return, call update_goals marking every item done, then answer with both counts, the total, and citations.",
].join("\n");

const run1 = await drive("qual-main", spec("qual-main", TASK, { context: { autoCompactTokens: COMPACT_TOKENS } }));
const run1Records = adapterRecords.splice(0);

const run2 = await drive(
  "qual-interrupt",
  spec("qual-interrupt", "Call update_goals with a 2-item plan, then use spawn_helper to count the words in notes/alpha.txt, then report the count."),
  (e, interrupt) => {
    if (e.type === "helper.started") interrupt("qualification: interrupt at first helper");
  },
);
const run2Records = adapterRecords.splice(0);

const run3 = run2.outcome.nativeSessionId
  ? await drive(
      "qual-resume",
      spec("qual-resume", "You were interrupted. First say which file I asked you about, then finish the original task.", {
        resume: { nativeSessionId: run2.outcome.nativeSessionId },
      }),
    )
  : undefined;
adapterRecords.splice(0);

// ---- evidence ---------------------------------------------------------------
const ev1 = run1.events;
const of = <T extends EngineEventDraft["type"]>(evs: EngineEventDraft[], type: T) =>
  evs.filter((e): e is Extract<EngineEventDraft, { type: T }> => e.type === type);
const helperStarts = of(ev1, "helper.started");
const helperIds = new Set(helperStarts.map((h) => h.helperId));
const firstDone = ev1.findIndex((e) => e.type === "helper.completed");
const startsBeforeFirstDone = ev1.slice(0, firstDone < 0 ? ev1.length : firstDone).filter((e) => e.type === "helper.started").length;
const childCalls = of(ev1, "tool.call").filter((c) => c.agentId && helperIds.has(c.agentId));
const searches = of(ev1, "tool.search");
const searchIdx = ev1.findIndex((e) => e.type === "tool.search" && e.via === "native");
const wcAfterSearch = ev1.slice(searchIdx + 1).filter((e) => e.type === "tool.call" && e.name === "word_count");
const compactions = of(ev1, "context.compacted");
const usageTotals = run1.outcome.usage;
const nativeCalls = of(ev1, "tool.call").filter((c) => c.native).map((c) => c.name);

type Cap = { status: "NATIVE" | "APP-IMPLEMENTED" | "UNSUPPORTED" | "UNTESTED"; evidence: string };
const cap = (ok: boolean, status: Cap["status"], yes: string, no: string): Cap => (ok ? { status, evidence: yes } : { status: "UNTESTED", evidence: no });
const capabilities: Record<string, Cap> = {
  start: cap(of(ev1, "run.started").length === 1, "NATIVE", `run.started x1 with nativeSessionId ${run1.outcome.nativeSessionId}; run1 status ${run1.outcome.status}`, `run1: ${run1.outcome.status} ${run1.outcome.error ?? ""}`),
  stream: cap(of(ev1, "message.delta").length > 0, "NATIVE", `message.delta x${of(ev1, "message.delta").length} (main agent)`, "no message.delta observed"),
  interrupt: cap(run2.outcome.status === "interrupted", "NATIVE", `run2 interrupted at helper.started; status=${run2.outcome.status}; helper.completed status=${of(run2.events, "helper.completed").map((h) => h.status).join(",") || "none"}`, `run2 status ${run2.outcome.status} ${run2.outcome.error ?? ""}`),
  resume: cap(run3?.outcome.status === "completed" && /alpha/i.test(run3.outcome.finalText), "NATIVE", `run3 resumed session ${run2.outcome.nativeSessionId}: status=${run3?.outcome.status}, finalText mentions alpha.txt`, `run3: ${run3?.outcome.status ?? "not run"} ${run3?.outcome.error ?? ""} finalText=${(run3?.outcome.finalText ?? "").slice(0, 200)}`),
  subagents: cap(helperStarts.length >= 2 && startsBeforeFirstDone >= 2, "NATIVE", `helper.started x${helperStarts.length}, ${startsBeforeFirstDone} started before the first helper.completed (concurrent); helper.completed x${of(ev1, "helper.completed").length}`, `helper.started x${helperStarts.length}, concurrent=${startsBeforeFirstDone}`),
  childEventIdentity: cap(childCalls.length > 0, "NATIVE", `${childCalls.length} child tool.call events carry agentId = spawn_helper call id (${[...new Set(childCalls.map((c) => c.agentId))].join(", ")})`, "no child tool.call with helper agentId"),
  compaction: cap(compactions.length > 0, "NATIVE", `context.compacted x${compactions.length} (preTokens ${compactions.map((c) => c.preTokens).join(",")}, nativeRef ${compactions.map((c) => c.nativeRef).join(",")}) with contextManagement compactThreshold=${COMPACT_TOKENS}`, `no compaction item produced with contextManagement compactThreshold=${COMPACT_TOKENS}`),
  toolSearch: cap(searchIdx >= 0 && wcAfterSearch.length > 0, "NATIVE", `tool.search(native) x${searches.length} -> results ${[...new Set(searches.flatMap((s) => s.results))].join(",")}; tool.loaded x${of(ev1, "tool.loaded").length}; word_count called x${wcAfterSearch.length} after search`, `tool.search x${searches.length}, word_count after search x${wcAfterSearch.length}`),
  skillLoad: cap(of(ev1, "skill.loaded").length > 0, "APP-IMPLEMENTED", `skill.loaded(via node) x${of(ev1, "skill.loaded").length} for ${of(ev1, "skill.loaded").map((s) => s.name).join(",")}; skill.search x${of(ev1, "skill.search").length}. Native SDK local skills need the UnixLocal sandbox, which throws 'Required file I/O protection is supported only on Unix hosts.' on win32 (agents-core sandbox/sandboxes/shared/unixLocalFiles.mjs)`, "no skill.loaded observed"),
  skillRefresh: { status: "UNTESTED", evidence: "not exercised; no native skill cache (Node skill tools read disk per call)" },
  goals: cap(of(ev1, "goals.updated").length > 0, "APP-IMPLEMENTED", `goals.updated x${of(ev1, "goals.updated").length} via Node update_goals; last statuses ${of(ev1, "goals.updated").at(-1)?.goals.map((g) => g.status).join(",")}`, "no goals.updated observed"),
  permissions: cap(nativeCalls.every((n) => n === "spawn_helper" || n === "tool_search"), "APP-IMPLEMENTED", `native tool.calls observed only ${[...new Set(nativeCalls)].join(",") || "none"}; no shell/apply_patch exposed, so every side effect goes through the Node gateway (gateway denial itself not exercised by the fake host)`, `unexpected native tools ${nativeCalls.join(",")}`),
  usage: cap(usageTotals.inputTokens > 0 && of(ev1, "usage").length > 0, "NATIVE", `usage x${of(ev1, "usage").length}; run1 totals in=${usageTotals.inputTokens} cached=${usageTotals.cacheReadTokens} out=${usageTotals.outputTokens} turns=${usageTotals.modelTurns}`, "no usage observed"),
  costUsd: cap(usageTotals.costUsd !== null, "APP-IMPLEMENTED", `SDK reports tokens only; priceUsage(${MODEL}) -> $${usageTotals.costUsd} (${usageTotals.costSource})`, `costUsd null for ${MODEL}`),
};

const report = {
  engine: "openai-agents",
  sdk: "@openai/agents",
  sdkVersion: adapter.descriptor().sdk.version,
  model: MODEL,
  helperModel: HELPER_MODEL,
  ranAt,
  wallMs: Date.now() - wall0,
  costUsd: [run1, run2, run3].every((r) => !r || r.outcome.usage.costUsd !== null) ? Math.round(spentUsd * 1e6) / 1e6 : null,
  eventCounts: { run1: countEvents(run1.events), run2: countEvents(run2.events), run3: run3 ? countEvents(run3.events) : null },
  outcomes: [run1, run2, run3].map((r) => r && { status: r.outcome.status, error: r.outcome.error, ms: r.ms, costUsd: r.outcome.usage.costUsd, finalText: r.outcome.finalText.slice(0, 400) }),
  capabilities,
  notes: [
    `Compaction knob: server-side modelSettings.contextManagement [{type:'compaction', compactThreshold:${COMPACT_TOKENS}}] set from spec.context.autoCompactTokens (lowered for qualification); context.compacted only from compaction_item_created.`,
    "Helpers: Agent.asTool('spawn_helper'); child events via onStream (toolCall.callId = helperId); child tool executions get agentId via AsyncLocalStorage.",
    "Resume: file-backed SDK Session under host.stateDir/openai-sessions; nativeSessionId = session id.",
    "Tracing export disabled (Runner tracingDisabled, asTool runConfig tracingDisabled). API key passed per run via OpenAIProvider({ apiKey }); process.env untouched.",
    `Workspace: os.tmpdir()/nodeagent-qual/${basename(root)}`,
  ],
};
mkdirSync(join(PKG, "qualification"), { recursive: true });
writeFileSync(join(PKG, "qualification", "openai-agents.json"), `${JSON.stringify(report, null, 2)}\n`);

// ---- fixture: trimmed real native records --------------------------------------
function trim(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 12).map((x) => trim(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "providerData") continue;
      out[k] = k === "encrypted_content" ? "[stripped]" : depth > 6 ? "[deep]" : trim(x, depth + 1);
    }
    return out;
  }
  return v;
}
let deltas = 0;
const fixture = [
  ...run1Records.map((r) => ({ run: "main", ...r })),
  ...run2Records.map((r) => ({ run: "interrupt", ...r })),
].filter((r) => {
  if (r.type !== "raw_model_stream_event") return true;
  if (r.data?.type === "response_done") return true;
  return r.data?.type === "output_text_delta" && !r.agentId && deltas++ < 12;
});
mkdirSync(join(PKG, "test", "fixtures"), { recursive: true });
writeFileSync(join(PKG, "test", "fixtures", "openai-agents-native.jsonl"), fixture.map((r) => JSON.stringify(trim(r))).join("\n") + "\n");
console.log(`wrote qualification/openai-agents.json (spent $${spentUsd.toFixed(4)}), fixture ${fixture.length} records`);
for (const [k, v] of Object.entries(capabilities)) console.log(`${k.padEnd(20)} ${v.status.padEnd(16)} ${v.evidence.slice(0, 160)}`);
