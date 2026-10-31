/**
 * Real, paid qualification of the universal engine (google:gemini-3.5-flash, cap $0.50).
 *   npx tsx scripts/qualify-universal.ts
 * Run 1 exercises helpers (2 concurrent delegates), deferred-tool discovery, skill load, goals and
 * auto-compaction (threshold lowered via spec.context.autoCompactTokens). Runs 2-3 interrupt a short
 * run and resume it by native session id. Writes qualification/nodeagent-universal.json and records
 * run 1's provider stream parts to test/fixtures/universal-native.jsonl for the replay test.
 * Exports the inline tools/workspace so test/universal.test.ts replays against the same Node tools.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { Capability, CapabilityStatus, EngineEventDraft, EngineRunOutcome, NodeToolDefinition, ProviderEnv, RunSpec } from "../src/contract.js";
import { countEvents, createFakeHost } from "../src/testing/fakeHost.js";
import { loadProviderEnv } from "../src/env.js";
import { createUniversalAdapter, resolveModel, type UniversalSession } from "../src/engines/universal.js";

export const MAIN_MODEL = "google:gemini-3.5-flash";
export const HELPER_MODEL = "google:gemini-3.5-flash-lite";
/** Priced model (pricing.ts) for runs 2-3, so costUsd is observed from a real run. */
export const SHORT_MODEL = "google:gemini-3.5-flash-lite";
export const COMPACT_TOKENS = 1200;
const CAP_USD = 0.5;
/** Upper-bound prices for the spend guard only (gemini-3.1-pro-preview list price, above any flash tier). Not a cost. */
const GUARD_PRICE = { input: 2, output: 12 };

const BRIEF = `# Reporting brief

This workspace holds short source texts that the editorial team audits before publication. Every audit
starts with a word count because the publication enforces length limits per section, and the limits are
checked mechanically by a script, not by a person reading the page.

## Why counts must come from the tool

Editors used to estimate length by eye. Estimates were wrong by ten to thirty percent, which caused late
cuts and, twice last year, a section that ran over its print column. Since then the rule is simple: a
count is only accepted if it was produced by the word counting tool on the exact file that will ship.
Counts copied from earlier reports, from memory, or from a draft in a chat window are rejected.

## How to split the work

When several files need counting, give each file to its own helper so the counts are produced
independently and in parallel. A helper should receive the file path and the name of the counting tool,
and should answer with the number only. The lead collects the helper answers and adds them up.

## Report format

Write one line per file in the form path: words, in the order the files were requested, then a final line
total: sum. Do not round. Do not add commentary after the total line. If a file is missing, write the path
followed by missing, and leave it out of the total, so the reviewer can see the gap instead of a silent zero.

## Glossary

Section: a block of text with its own length limit. Source text: the file in docs that will be printed.
Helper: an assistant that handles one file. Lead: the assistant that plans, delegates and reports.
`;

export const DOCS: Record<string, string> = {
  "docs/brief.md": BRIEF,
  "docs/alpha.txt":
    "The river bends twice before it reaches the old mill. Children fish from the stone bridge every summer, " +
    "and the miller's dog sleeps in the shade of the water wheel until the evening bell rings.",
  "docs/beta.txt":
    "Quarterly revenue grew because the team shipped the export feature early. Support tickets fell after " +
    "the onboarding guide was rewritten. Next quarter the team plans to localize the dashboard into four languages " +
    "and retire the legacy billing screen.",
};

export const WORD_STATS_SKILL = `---
name: word-stats
description: Count words in workspace text files with the word_count tool and report per-file and total counts.
allowed-tools: word_count
---
# Word stats

Use this skill whenever a task asks how many words a file or set of files contains.

1. Never estimate a count by reading or eyeballing text. Counts must come from the \`word_count\` tool,
   which splits on whitespace exactly the way the reviewer's checker does.
2. \`word_count\` is a deferred Node tool: find it with \`search_tools\` (query "count words") and enable it
   with \`load_tool\` before the first call.
3. Call \`word_count\` once per file with its workspace-relative path, e.g. \`{"path": "docs/alpha.txt"}\`.
4. Report each file's count on its own line as \`<path>: <words>\`, then a final line \`total: <sum>\`.
5. If a file is missing, say so explicitly instead of reporting zero.
`;

export const QUAL_TASK = [
  "Report the word counts of docs/alpha.txt and docs/beta.txt and their total. Follow these steps in order:",
  "1. In one step: read docs/brief.md with read_file, and record a plan of three goals with update_goals (find tool, count files, report).",
  "2. Load the word-stats skill with load_skill and follow it.",
  "3. Find the word counting tool with search_tools and enable it with load_tool.",
  "4. In ONE step, call delegate twice (one helper per file) so both run concurrently; pass the counting tool's name in each delegate's tools list and tell each helper which file to count.",
  "5. Mark all goals done with update_goals, then give the final answer in the skill's format.",
].join("\n");

export const INTERRUPT_TASK =
  "Record a two-goal plan with update_goals, then find the word counting tool with search_tools, load it with load_tool, " +
  "count the words in docs/beta.txt with it, and answer with the count.";

export function seedWorkspace(ws: string): void {
  for (const [rel, text] of Object.entries(DOCS)) {
    mkdirSync(dirname(join(ws, rel)), { recursive: true });
    writeFileSync(join(ws, rel), text);
  }
  mkdirSync(join(ws, ".claude", "skills", "word-stats"), { recursive: true });
  writeFileSync(join(ws, ".claude", "skills", "word-stats", "SKILL.md"), WORD_STATS_SKILL);
}

const def = <S extends z.ZodTypeAny>(d: NodeToolDefinition<S>): NodeToolDefinition => d as unknown as NodeToolDefinition;

function inside(ws: string, p: string): string | null {
  const abs = resolve(ws, p);
  const rel = relative(ws, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? null : abs;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 1);
}

/** Inline Node tools (the shared catalog is written concurrently; these mirror its contract). */
export function qualTools(): NodeToolDefinition[] {
  const tools: NodeToolDefinition[] = [];
  const deferred = () => tools.filter((t) => t.alwaysLoad !== true);
  tools.push(
    def({
      name: "search_tools",
      family: "tool-meta",
      risk: "read",
      alwaysLoad: true,
      description: "Search deferred tools by what they do. Returns tool names to pass to load_tool.",
      schema: z.object({ query: z.string().min(1) }),
      async execute({ query }, ctx) {
        const q = words(query);
        const hits = deferred()
          .map((t) => ({ t, score: q.filter((w) => `${t.name} ${t.description} ${t.searchHint ?? ""}`.toLowerCase().includes(w)).length }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        ctx.emit({ type: "tool.search", query, results: hits.map((h) => h.t.name), via: "node", agentId: ctx.agentId });
        return { ok: true, content: JSON.stringify(hits.map((h) => ({ name: h.t.name, description: h.t.description }))) };
      },
    }),
    def({
      name: "load_tool",
      family: "tool-meta",
      risk: "read",
      alwaysLoad: true,
      description: "Enable deferred tools by name so they are callable on your next step.",
      schema: z.object({ names: z.array(z.string()).min(1).max(10) }),
      async execute({ names }, ctx) {
        const known = names.filter((n) => deferred().some((t) => t.name === n));
        if (known.length === 0) return { ok: false, content: `No deferred tool named ${names.join(", ")}. Use search_tools.` };
        ctx.emit({ type: "tool.loaded", names: known, via: "node-load-tool", agentId: ctx.agentId });
        return { ok: true, content: `Loaded ${known.join(", ")}; callable on your next step.`, data: { names: known } };
      },
    }),
    def({
      name: "word_count",
      family: "workspace",
      risk: "read",
      searchHint: "count words in a text file",
      description: "Count whitespace-separated words in one workspace text file.",
      schema: z.object({ path: z.string().min(1) }),
      async execute({ path }, ctx) {
        const abs = inside(ctx.workspaceDir, path);
        if (!abs) return { ok: false, content: `Path escapes the workspace: ${path}` };
        if (!existsSync(abs)) return { ok: false, content: `No such file: ${path}` };
        const n = readFileSync(abs, "utf8").split(/\s+/).filter(Boolean).length;
        return { ok: true, content: JSON.stringify({ path, words: n }) };
      },
    }),
    def({
      name: "read_file",
      family: "workspace",
      risk: "read",
      alwaysLoad: true,
      description: "Read one workspace text file (first 16 KB).",
      schema: z.object({ path: z.string().min(1) }),
      async execute({ path }, ctx) {
        const abs = inside(ctx.workspaceDir, path);
        if (!abs) return { ok: false, content: `Path escapes the workspace: ${path}` };
        if (!existsSync(abs)) return { ok: false, content: `No such file: ${path}` };
        return { ok: true, content: readFileSync(abs, "utf8").slice(0, 16_384) };
      },
    }),
    def({
      name: "search_skills",
      family: "skills",
      risk: "read",
      alwaysLoad: true,
      description: "Search active workspace skills by name or description.",
      schema: z.object({ query: z.string().min(1) }),
      async execute({ query }, ctx) {
        const dir = join(ctx.workspaceDir, ".claude", "skills");
        const names = existsSync(dir) ? readdirSync(dir).filter((n) => existsSync(join(dir, n, "SKILL.md"))) : [];
        const q = words(query);
        const results = names.filter((n) => q.some((w) => `${n} ${readFileSync(join(dir, n, "SKILL.md"), "utf8").slice(0, 400)}`.toLowerCase().includes(w)));
        ctx.emit({ type: "skill.search", query, results, via: "node", agentId: ctx.agentId });
        return { ok: true, content: JSON.stringify(results) };
      },
    }),
    def({
      name: "load_skill",
      family: "skills",
      risk: "read",
      alwaysLoad: true,
      description: "Load an active skill's SKILL.md instructions by name.",
      schema: z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }),
      async execute({ name }, ctx) {
        const file = join(ctx.workspaceDir, ".claude", "skills", name, "SKILL.md");
        if (!existsSync(file)) return { ok: false, content: `No active skill "${name}"` };
        const text = readFileSync(file, "utf8");
        const sha256 = createHash("sha256").update(text).digest("hex");
        ctx.emit({ type: "skill.loaded", name, sha256, via: "node", agentId: ctx.agentId });
        return { ok: true, content: text };
      },
    }),
    def({
      name: "update_goals",
      family: "goals",
      risk: "propose",
      alwaysLoad: true,
      description: "Replace the run's goal list (id, title, status). Statuses are your claims; Node verifies separately.",
      schema: z.object({
        goals: z
          .array(z.object({ id: z.string().min(1), title: z.string().min(1), status: z.enum(["pending", "active", "done", "blocked"]) }))
          .min(1)
          .max(20),
      }),
      async execute({ goals }, ctx) {
        ctx.emit({ type: "goals.updated", goals: goals.map((g) => ({ ...g, claimedBy: "engine" as const })), source: "update_goals", agentId: ctx.agentId });
        return { ok: true, content: `Recorded ${goals.length} goals: ${goals.map((g) => `${g.id}=${g.status}`).join(", ")}` };
      },
    }),
  );
  return tools;
}

// ---------------------------------------------------------------------------
// Recording provider stream parts (fixture for the replay test)
// ---------------------------------------------------------------------------

export interface RecordedCall {
  seq: number;
  kind: "stream" | "generate";
  /** First user message prefix: identifies which agent made the request (main task or a helper prompt). */
  key: string;
  modelId: string;
  parts?: unknown[];
  result?: unknown;
}

export function promptKey(prompt: unknown): string {
  const msgs = Array.isArray(prompt) ? (prompt as Array<{ role: string; content: unknown }>) : [];
  const user = msgs.find((m) => m.role === "user");
  if (!user) return "";
  const text = Array.isArray(user.content)
    ? (user.content as Array<{ type: string; text?: string }>).filter((p) => p.type === "text").map((p) => p.text ?? "").join("")
    : String(user.content);
  return text.slice(0, 160);
}

function sanitize(value: unknown, ws: string): unknown {
  const home = homedir();
  const scrub = (s: string) =>
    [ws, ws.replace(/\\/g, "/"), home, home.replace(/\\/g, "/")].reduce((acc, p) => acc.split(p).join("<path>"), s).slice(0, 4000);
  const walk = (v: unknown, k?: string): unknown => {
    if (k === "thoughtSignature" && typeof v === "string") return "<trimmed>";
    if (typeof v === "string") return scrub(v);
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, walk(vv, kk)]));
    return v;
  };
  return walk(value);
}

function tap(model: LanguageModel, modelId: string, sink: RecordedCall[], ws: string): LanguageModel {
  const target = model as unknown as Record<string, unknown> & {
    doStream(o: { prompt: unknown }): Promise<{ stream: ReadableStream<unknown> }>;
    doGenerate(o: { prompt: unknown }): Promise<unknown>;
  };
  return new Proxy(target, {
    get(t, k) {
      if (k === "doStream")
        return async (opts: { prompt: unknown }) => {
          const res = await t.doStream(opts);
          const [a, b] = res.stream.tee();
          const entry: RecordedCall = { seq: sink.length, kind: "stream", key: promptKey(opts.prompt), modelId, parts: [] };
          sink.push(entry);
          void (async () => {
            const reader = b.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              entry.parts!.push(sanitize(value, ws));
            }
          })().catch(() => undefined);
          return { ...res, stream: a };
        };
      if (k === "doGenerate")
        return async (opts: { prompt: unknown }) => {
          const res = (await t.doGenerate(opts)) as Record<string, unknown>;
          const { request: _req, response: _resp, ...rest } = res;
          sink.push({ seq: sink.length, kind: "generate", key: promptKey(opts.prompt), modelId, result: sanitize(rest, ws) });
          return res;
        };
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as unknown as LanguageModel;
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

type Evidence = { status: CapabilityStatus; evidence: string };

function lastUsageCost(events: EngineEventDraft[]): { tokensIn: number; tokensOut: number; costUsd: number | null } {
  const u = [...events].reverse().find((e) => e.type === "usage");
  if (!u || u.type !== "usage") return { tokensIn: 0, tokensOut: 0, costUsd: null };
  const t = u.totals;
  return { tokensIn: t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens, tokensOut: t.outputTokens, costUsd: t.costUsd };
}

function guardUsd(events: EngineEventDraft[]): number {
  const u = lastUsageCost(events);
  return u.costUsd ?? (u.tokensIn * GUARD_PRICE.input + u.tokensOut * GUARD_PRICE.output) / 1e6;
}

function outcomeGuardUsd(o: EngineRunOutcome): number {
  return o.usage.costUsd ?? ((o.usage.inputTokens + o.usage.cacheReadTokens + o.usage.cacheWriteTokens) * GUARD_PRICE.input + o.usage.outputTokens * GUARD_PRICE.output) / 1e6;
}

async function main(): Promise<void> {
  const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const env: ProviderEnv = loadProviderEnv([resolve(pkgDir, "..", "..", ".env.local")]);
  const ranAt = new Date().toISOString();
  const t0 = Date.now();
  const stamp = Date.now();
  const base = join(tmpdir(), "nodeagent-qual", `universal-${stamp}`);
  const ws = join(base, "ws");
  const stateDir = join(base, "state");
  seedWorkspace(ws);
  const recorded: RecordedCall[] = [];
  let recording = true;
  const adapter = createUniversalAdapter({
    resolveModel: (id, e) => (recording ? tap(resolveModel(id, e), id, recorded, ws) : resolveModel(id, e)),
  });
  const notes: string[] = [];
  const receiptFile = join(pkgDir, "qualification", "nodeagent-universal.json");
  // Earlier invocations count against the same cap.
  const old = existsSync(receiptFile)
    ? (JSON.parse(readFileSync(receiptFile, "utf8")) as { cumulativeSpendUpperBoundUsd?: number; spendUpperBoundUsd?: number })
    : {};
  const prior = old.cumulativeSpendUpperBoundUsd ?? old.spendUpperBoundUsd ?? 0;
  if (prior >= CAP_USD) throw new Error(`Cumulative spend upper bound $${prior} already at the $${CAP_USD} cap`);
  let spent = 0;

  const runOnce = async (spec: RunSpec, label: string, onEvents?: (events: EngineEventDraft[], h: { interrupt(r: string): Promise<void> }) => void) => {
    const host = createFakeHost({ env, stateDir, workspaceDir: ws, tools: qualTools(), runId: spec.runId, echo: false });
    const started = Date.now();
    const handle = adapter.start(spec, host);
    const timer = setInterval(() => {
      if (prior + spent + guardUsd(host.events) > CAP_USD) host.controller.abort(new Error(`spend guard: upper-bound estimate exceeded $${CAP_USD}`));
      onEvents?.(host.events, handle);
    }, 200);
    const outcome = await handle.done;
    clearInterval(timer);
    spent += outcomeGuardUsd(outcome);
    console.log(`[${label}] ${outcome.status} in ${Date.now() - started}ms; events=${host.events.length}; ${outcome.error ?? ""}`);
    return { host, outcome, ms: Date.now() - started };
  };

  if (!env.googleApiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set in .env.local");

  // Run 1: helpers, tool search, skill, goals, compaction.
  const r1 = await runOnce(
    {
      runId: `qual-main-${stamp}`,
      projectId: "qual",
      workspaceDir: ws,
      prompt: QUAL_TASK,
      model: MAIN_MODEL,
      helperModel: HELPER_MODEL,
      budget: { maxTurns: 20 },
      context: { autoCompactTokens: COMPACT_TOKENS },
    },
    "main",
  );
  recording = false;
  await new Promise((r) => setTimeout(r, 50)); // let tee readers flush
  const fixtureDir = join(pkgDir, "test", "fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, "universal-native.jsonl"), recorded.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // Run 2: interrupt after the first completed tool call; Run 3: resume by native session id.
  let interruptAt = 0;
  const r2 = await runOnce(
    {
      runId: `qual-intr-${stamp}`,
      projectId: "qual",
      workspaceDir: ws,
      prompt: INTERRUPT_TASK,
      model: SHORT_MODEL,
      helperModel: SHORT_MODEL,
      budget: { maxTurns: 10 },
      context: {},
    },
    "interrupt",
    (events, h) => {
      if (!interruptAt && events.some((e) => e.type === "tool.result")) {
        interruptAt = Date.now();
        void h.interrupt("qualification interrupt after first tool result");
      }
    },
  );
  const interruptLatencyMs = interruptAt ? Date.now() - interruptAt : null;
  const sessionFile = join(stateDir, `${r2.outcome.nativeSessionId}.json`);
  const stepBefore = existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, "utf8")) as UniversalSession).step : null;
  const r3 = await runOnce(
    {
      runId: `qual-resume-${stamp}`,
      projectId: "qual",
      workspaceDir: ws,
      prompt: "You were interrupted. Continue where you left off and finish the task.",
      model: SHORT_MODEL,
      helperModel: SHORT_MODEL,
      budget: { maxTurns: 10 },
      context: {},
      resume: { nativeSessionId: r2.outcome.nativeSessionId ?? "missing" },
    },
    "resume",
  );
  const stepAfter = existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, "utf8")) as UniversalSession).step : null;

  // ---- Evidence ----
  const e1 = r1.host.events;
  const of = <T extends EngineEventDraft["type"]>(events: EngineEventDraft[], t: T) =>
    events.filter((e): e is Extract<EngineEventDraft, { type: T }> => e.type === t);
  const helpers = of(e1, "helper.started");
  const helperIds = new Set(helpers.map((h) => h.helperId));
  const firstDone = e1.findIndex((e) => e.type === "helper.completed");
  const startedBeforeFirstDone = e1.slice(0, firstDone < 0 ? e1.length : firstDone).filter((e) => e.type === "helper.started").length;
  const childCalls = of(e1, "tool.call").filter((c) => c.agentId && helperIds.has(c.agentId));
  const calls1 = of(e1, "tool.call");
  const loaded = of(e1, "tool.loaded");
  const loadedNames = new Set(loaded.flatMap((l) => l.names));
  const firstLoad = e1.findIndex((e) => e.type === "tool.loaded");
  const deferredCallsAfterLoad = calls1.filter((c) => loadedNames.has(c.name) && e1.indexOf(c) > firstLoad);
  const compacted = of(e1, "context.compacted");
  const started2 = of(r2.host.events, "run.started")[0];
  const started3 = of(r3.host.events, "run.started")[0];
  const completedHelpers = of(e1, "helper.completed");
  const pairOk = (events: EngineEventDraft[]) => {
    const c = new Set(of(events, "tool.call").map((x) => x.callId));
    const r = new Set(of(events, "tool.result").map((x) => x.callId));
    return c.size === r.size && [...c].every((id) => r.has(id));
  };

  const cap = (ok: boolean, status: CapabilityStatus, yes: string, no: string): Evidence => (ok ? { status, evidence: yes } : { status: "UNTESTED", evidence: no });
  const o1 = r1.outcome;
  const capabilities: Record<Capability, Evidence> = {
    start: cap(of(e1, "run.started").length === 1 && o1.status === "completed", "APP-IMPLEMENTED",
      `run 1 run.started x1 (nativeSessionId=${of(e1, "run.started")[0]?.nativeSessionId}), outcome completed, ${o1.usage.modelTurns} model requests`,
      `run 1 outcome ${o1.status}: ${o1.error ?? ""}`),
    stream: cap(of(e1, "message.delta").length > 0, "NATIVE", `run 1 message.delta x${of(e1, "message.delta").length} from ai streamText text-delta`, "no message.delta observed"),
    interrupt: cap(r2.outcome.status === "interrupted", "APP-IMPLEMENTED",
      `run 2 handle.interrupt() after first tool.result -> outcome interrupted (${r2.outcome.error}); resolved ${interruptLatencyMs}ms after the call`,
      `run 2 outcome ${r2.outcome.status}: ${r2.outcome.error ?? "no tool.result before completion"}`),
    resume: cap(r3.outcome.status === "completed" && started3?.nativeSessionId === r2.outcome.nativeSessionId && stepAfter !== null && stepBefore !== null && stepAfter > stepBefore, "APP-IMPLEMENTED",
      `run 3 resume.nativeSessionId=${r2.outcome.nativeSessionId} -> run.started.nativeSessionId=${started3?.nativeSessionId}, session step ${stepBefore} -> ${stepAfter}, outcome completed: "${(r3.outcome.finalText ?? "").slice(0, 120)}"`,
      `run 3 outcome ${r3.outcome.status}: ${r3.outcome.error ?? ""} (session step ${stepBefore} -> ${stepAfter})`),
    subagents: cap(helpers.length >= 2 && startedBeforeFirstDone >= 2 && completedHelpers.every((h) => h.status === "completed"), "APP-IMPLEMENTED",
      `run 1 helper.started x${helpers.length} (model ${helpers[0]?.model}), ${startedBeforeFirstDone} started before the first helper.completed (concurrent), helper.progress x${of(e1, "helper.progress").length}, helper.completed statuses: ${completedHelpers.map((h) => h.status).join(",")}`,
      `run 1 helper.started x${helpers.length}, concurrent=${startedBeforeFirstDone}, completed: ${completedHelpers.map((h) => `${h.status}:${h.summary.slice(0, 80)}`).join(" | ")}`),
    childEventIdentity: cap(childCalls.length > 0 && helpers.length > 0, "APP-IMPLEMENTED",
      `run 1 ${childCalls.length} tool.call events carry agentId = a helperId (${[...new Set(childCalls.map((c) => c.name))].join(",")})`,
      "no child tool calls observed"),
    compaction: cap(compacted.length > 0, "APP-IMPLEMENTED",
      `run 1 context.compacted x${compacted.length} trigger=auto, preTokens->postTokens ${compacted.map((c) => `${c.preTokens}->${c.postTokens}`).join(", ")} (chars/4 estimate; threshold lowered to ${COMPACT_TOKENS} via spec.context.autoCompactTokens)`,
      `no context.compacted observed with autoCompactTokens=${COMPACT_TOKENS}`),
    toolSearch: cap(of(e1, "tool.search").length > 0 && loaded.length > 0 && deferredCallsAfterLoad.length > 0, "APP-IMPLEMENTED",
      `run 1 tool.search(via node) x${of(e1, "tool.search").length}, tool.loaded x${loaded.length} [${[...loadedNames].join(",")}], ${deferredCallsAfterLoad.length} calls to loaded tools after the load`,
      `tool.search x${of(e1, "tool.search").length}, tool.loaded x${loaded.length}, calls after load x${deferredCallsAfterLoad.length}`),
    skillLoad: cap(of(e1, "skill.loaded").length > 0, "APP-IMPLEMENTED", `run 1 skill.loaded x${of(e1, "skill.loaded").length} (${of(e1, "skill.loaded").map((s) => s.name).join(",")}) via Node load_skill`, "no skill.loaded observed"),
    skillRefresh: { status: "UNTESTED", evidence: "not exercised: no skill was activated mid-run; the adapter re-lists the skills dir on every request instead of caching" },
    goals: cap(of(e1, "goals.updated").length > 0, "APP-IMPLEMENTED", `run 1 goals.updated x${of(e1, "goals.updated").length} via Node update_goals; final statuses ${of(e1, "goals.updated").at(-1)?.goals.map((g) => g.status).join(",")}`, "no goals.updated observed"),
    permissions: cap(calls1.length > 0 && calls1.every((c) => !c.native || c.name === "delegate"), "APP-IMPLEMENTED",
      `run 1 ${calls1.length} tool.call events: all Node gateway tools except ${calls1.filter((c) => c.native).length} adapter delegate calls; the engine has no native side-effecting tools to gate (permission.decision x${of(e1, "permission.decision").length})`,
      "unexpected native tool calls observed"),
    usage: cap(o1.usage.inputTokens + o1.usage.outputTokens > 0, "NATIVE", `run 1 provider usage: in=${o1.usage.inputTokens} out=${o1.usage.outputTokens} cacheRead=${o1.usage.cacheReadTokens} over ${o1.usage.modelTurns} requests; usage events x${of(e1, "usage").length}`, "no provider usage reported"),
    costUsd: cap(r3.outcome.usage.costUsd !== null || r2.outcome.usage.costUsd !== null, "APP-IMPLEMENTED",
      `runs 2-3 (${SHORT_MODEL}, priced) costUsd ${r2.outcome.usage.costUsd} + ${r3.outcome.usage.costUsd} from ${r3.outcome.usage.costSource}; run 1 costUsd ${o1.usage.costUsd} (${MAIN_MODEL} has no verified price, so null, not 0)`,
      `costUsd null in all runs (${r2.outcome.usage.costSource})`),
  };

  notes.push(
    `Compaction knob: spec.context.autoCompactTokens=${COMPACT_TOKENS} (default ${"120000"}); tokens are chars/4 estimates over system+messages, tool schemas excluded.`,
    `Run 1 model ${MAIN_MODEL}, helpers ${HELPER_MODEL}; runs 2-3 ${SHORT_MODEL} so a priced model exercises costUsd.`,
    `tool.call/tool.result paired by callId: run1=${pairOk(e1)} run2=${pairOk(r2.host.events)} run3=${pairOk(r3.host.events)}.`,
    `Run 1 final text: ${JSON.stringify((o1.finalText ?? "").slice(0, 300))}`,
    `Run 2 run.started nativeSessionId=${started2?.nativeSessionId}; interrupted with ${of(r2.host.events, "tool.call").length} tool calls.`,
    "ai@6.0.280 rejects the installed @ai-sdk/* 4.x providers (LanguageModelV4) with UnsupportedModelVersionError; the adapter bridges v4->v3 (asV3).",
    `Spend guard: upper-bound estimate $${spent.toFixed(4)} this invocation, $${(prior + spent).toFixed(4)} cumulative (unpriced tokens at $${GUARD_PRICE.input}/$${GUARD_PRICE.output} per M); cap $${CAP_USD}.`,
    `Workspace: ${base.replace(homedir(), "~")}`,
  );

  const priced = [r1, r2, r3].map((r) => r.outcome.usage.costUsd);
  const receipt = {
    engine: "nodeagent-universal",
    sdk: "ai",
    sdkVersion: (createRequireVersion("ai") ?? "unknown"),
    model: MAIN_MODEL,
    helperModel: HELPER_MODEL,
    ranAt,
    wallMs: Date.now() - t0,
    costUsd: priced.every((c) => c !== null) ? priced.reduce((a, b) => a! + b!, 0) : null,
    spendUpperBoundUsd: Math.round(spent * 1e4) / 1e4,
    cumulativeSpendUpperBoundUsd: Math.round((prior + spent) * 1e4) / 1e4,
    runs: [r1, r2, r3].map((r, i) => ({
      run: ["main", "interrupt", "resume"][i],
      status: r.outcome.status,
      error: r.outcome.error,
      ms: r.ms,
      usage: r.outcome.usage,
      nativeSessionId: r.outcome.nativeSessionId,
    })),
    eventCounts: { main: countEvents(e1), interrupt: countEvents(r2.host.events), resume: countEvents(r3.host.events) },
    capabilities,
    notes,
  };
  mkdirSync(join(pkgDir, "qualification"), { recursive: true });
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ capabilities: Object.fromEntries(Object.entries(capabilities).map(([k, v]) => [k, v.status])), costUsd: receipt.costUsd, spent: receipt.spendUpperBoundUsd }, null, 1));
}

function createRequireVersion(pkg: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(`${pkg}/package.json`)), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
