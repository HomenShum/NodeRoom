/**
 * Real, paid qualification of the Codex app-server adapter (pinned @openai/codex).
 *   npx tsx scripts/qualify-codex.ts
 * Writes qualification/codex.json and test/fixtures/codex-native.jsonl.
 *
 * Runs: (1) main task on gpt-5.4-mini: concurrent helpers, goals, skill load,
 * app-implemented deferred-tool search, a policy deny, auto-compaction via
 * thread config model_auto_compact_token_limit; plus a skill refresh driven by
 * the script through the registered refresher. (2) interrupt, then resume by
 * thread id. (3) native tool_search on gpt-5.5 (in Codex's model catalog).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Capability, CapabilityStatus, EngineEventDraft, EngineRunOutcome, NodeToolDefinition, RunSpec } from "../src/contract.js";
import { createCodexAdapter } from "../src/engines/codex.js";
import type { RpcMessage } from "../src/engines/codex/rpc.js";
import { loadProviderEnv } from "../src/env.js";
import { createPolicy } from "../src/policy.js";
import { countEvents, createFakeHost, type FakeHost } from "../src/testing/fakeHost.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "gpt-5.4-mini";
const SEARCH_MODEL = "gpt-5.5";
const CAP_USD = 1.5;
/**
 * Spent on this slice before this script's first run (exploration spikes and
 * probes), summed from their rawResponse usage / rollout totals at the price table:
 * spike 2026-10-29T01:26 ~$0.130, gpt-5.4-mini tool probe ~$0.013, gpt-5.5 tool probe ~$0.120,
 * first run of this script ~$0.145 (its helpers ran gpt-6.1-sol, unpriced; estimated at gpt-6-sol rates,
 * plus <$0.01 for an interrupted request that never reported usage), second run ~$0.12 (same helper
 * estimate), helper-model probes ~$0.07 (one adapter probe with an unpriced helper, seven tiny spawn probes).
 */
const PRIOR_SPEND_USD = 0.6;
/** Main-thread context starts near 7.7k tokens and compacts back to ~8.5k; children start near 9.1k. */
const COMPACT_AT = 11_000;

const t0 = Date.now();
const root = join(tmpdir(), "nodeagent-qual", `codex-${t0}`);
const ws = join(root, "ws");
const stateDir = join(root, "state");
mkdirSync(join(ws, ".claude", "skills", "word-stats"), { recursive: true });
writeFileSync(join(ws, "notes.txt"), "alpha beta gamma delta\nepsilon zeta eta\ntheta\n");
// The reference appendix makes the SKILL.md read large enough to push context past COMPACT_AT.
const appendix = Array.from({ length: 900 }, (_, i) => `- ref-${i}: token sample lorem ipsum dolor sit amet ${i * 7}`).join("\n");
writeFileSync(
  join(ws, ".claude", "skills", "word-stats", "SKILL.md"),
  `---\nname: word-stats\ndescription: Count words in a workspace file using the Node word_count tool.\n---\n\n# word-stats\n\nTo count words in a file, call the Node tool \`word_count\` with {"path": "<workspace-relative file>"} and report its number exactly. Do not count by hand.\n\n## Reference (do not summarize)\n${appendix}\n`,
);

const env = loadProviderEnv([join(PKG, "../../.env.local")]);
const template = { id: "qual", title: "qual", description: "", restrictedGlobs: ["secrets/**"], checks: {} };

const tools: NodeToolDefinition[] = [
  {
    name: "word_count",
    family: "workspace",
    risk: "read",
    description: "Count the words in a workspace text file.",
    searchHint: "count words in a file",
    schema: z.object({ path: z.string().min(1).max(200) }),
    async execute({ path }, ctx) {
      const { readFile } = await import("node:fs/promises");
      const { resolveInside } = await import("../src/tools/workspaceFs.js");
      const abs = resolveInside(ctx.workspaceDir, path);
      if (!abs) return { ok: false, content: `Path ${path} is outside the workspace.` };
      const text = await readFile(abs, "utf8").catch(() => undefined);
      if (text === undefined) return { ok: false, content: `Cannot read ${path}.` };
      const n = text.split(/\s+/).filter(Boolean).length;
      return { ok: true, content: `${path}: ${n} words`, data: { words: n } };
    },
  },
  {
    name: "list_files",
    family: "workspace",
    risk: "read",
    alwaysLoad: true,
    description: "List files at the workspace root.",
    schema: z.object({}),
    async execute(_args, ctx) {
      const { readdir } = await import("node:fs/promises");
      return { ok: true, content: (await readdir(ctx.workspaceDir)).join("\n") };
    },
  },
];

const recording: Array<{ run: string; dir: "in" | "out"; msg: RpcMessage }> = [];
const MAX_RECORDING = 20_000;

function hostFor(runId: string): FakeHost & { refresh?: () => Promise<void> } {
  const host = createFakeHost({
    env,
    stateDir,
    workspaceDir: ws,
    tools,
    runId,
    echo: false,
    template,
    policy: createPolicy({ workspaceDir: ws, template, nodeTools: tools.map((t) => t.name) }),
  }) as FakeHost & { refresh?: () => Promise<void> };
  const set = host.tools.setSkillRefresher.bind(host.tools);
  host.tools.setSkillRefresher = (fn) => {
    host.refresh = fn;
    set(fn);
  };
  return host;
}

function adapterFor(run: string) {
  return createCodexAdapter({
    onNative: (msg, dir) => {
      if (recording.length < MAX_RECORDING) recording.push({ run, dir, msg });
    },
  });
}

function spec(runId: string, prompt: string, model: string, extra: Partial<RunSpec> = {}): RunSpec {
  return { runId, projectId: "qual", workspaceDir: ws, prompt, model, helperModel: MODEL, budget: { maxUsd: 0.6, maxTurns: 60 }, context: { autoCompactTokens: COMPACT_AT }, ...extra };
}

const spent = () => PRIOR_SPEND_USD + runs.reduce((s, r) => s + (r.outcome.usage.costUsd ?? 0), 0);
const runs: Array<{ name: string; host: FakeHost; outcome: EngineRunOutcome; wallMs: number }> = [];

async function runOne(name: string, s: RunSpec, during?: (host: FakeHost & { refresh?: () => Promise<void> }, handle: { interrupt(r: string): Promise<void> }) => Promise<void>) {
  const left = CAP_USD - spent();
  if (left < 0.05) throw new Error(`spend cap: $${spent().toFixed(3)} of $${CAP_USD} used, not starting ${name}`);
  s.budget.maxUsd = Math.min(s.budget.maxUsd ?? left, left);
  const host = hostFor(s.runId);
  const started = Date.now();
  const handle = adapterFor(name).start(s, host);
  const side = during?.(host, handle).catch((err) => host.log(`side task failed: ${err}`));
  const outcome = await handle.done;
  await side;
  runs.push({ name, host, outcome, wallMs: Date.now() - started });
  console.log(`[${name}] ${outcome.status} $${outcome.usage.costUsd} ${outcome.error ?? ""}\n  final: ${outcome.finalText.slice(0, 300)}\n  events: ${JSON.stringify(countEvents(host.events))}`);
  return { host, outcome };
}

const waitFor = async (host: FakeHost, pred: (e: EngineEventDraft) => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (host.events.some(pred)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

const MAIN_PROMPT = `Complete this task in the workspace, in order:
1. Before anything else, create a goal for this task with your goal tool.
2. Spawn TWO helper sub-agents with spawn_agent, one right after the other without waiting in between: helper A runs \`ls\` and reports the file names; helper B runs \`cat notes.txt\` and reports the first line. Then collect both with wait_agent.
3. Use the word-stats skill: read .claude/skills/word-stats/SKILL.md with \`cat\` and follow it. The Node tool it needs is not loaded yet: find it with tool search, load it, then call it on notes.txt.
4. Try exactly once to create a file with the shell command \`echo hi > out.txt\`; if Node rejects it, note that and continue.
5. Mark your goal complete, then reply with: both helper results, the word count, and whether the shell write was rejected.`;

let refreshObserved = false;
try {
  // (1) main task + script-driven skill refresh
  await runOne("main", spec("qual-main", MAIN_PROMPT, MODEL), async (host) => {
    if (!(await waitFor(host, (e) => e.type === "run.started", 60_000)) || !host.refresh) return;
    mkdirSync(join(ws, ".claude", "skills", "line-stats"), { recursive: true });
    writeFileSync(join(ws, ".claude", "skills", "line-stats", "SKILL.md"), "---\nname: line-stats\ndescription: Count lines in a workspace file.\n---\nUse `wc -l`.\n");
    await host.refresh();
    refreshObserved = recording.some((r) => r.run === "main" && r.dir === "in" && JSON.stringify(r.msg.result ?? "").includes("line-stats"));
  });

  // (2) interrupt, then resume the same native thread
  const long = await runOne("interrupt", spec("qual-interrupt", "Write the numbers from 1 to 400 as English words, one per line. Do not use any tools.", MODEL), async (host, handle) => {
    await waitFor(host, (e) => e.type === "message.delta", 90_000);
    await handle.interrupt("qualification interrupt after first streamed text");
  });
  if (long.outcome.nativeSessionId)
    await runOne(
      "resume",
      spec("qual-resume", "Reply with exactly: RESUMED, then the first six words of my previous message in this thread, verbatim. Do not use any tools.", MODEL, { resume: { nativeSessionId: long.outcome.nativeSessionId } }),
    );

  // (3) native tool search on a catalog model
  await runOne(
    "native-search",
    spec("qual-native-search", "Use your tool search to find a Node tool that counts words, call it on notes.txt, and reply with only the count. Do not use shell commands.", SEARCH_MODEL, { budget: { maxUsd: 0.3, maxTurns: 12 } }),
  );
} catch (err) {
  console.error(`qualification stopped: ${err instanceof Error ? err.message : err}`);
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------
const by = (name: string) => runs.find((r) => r.name === name);
const evs = (name: string) => by(name)?.host.events ?? [];
const all = runs.flatMap((r) => r.host.events);
const count = (es: EngineEventDraft[], type: string, f: (e: any) => boolean = () => true) => es.filter((e) => e.type === type && f(e)).length;
const cap = (status: CapabilityStatus, evidence: string) => ({ status, evidence });
const main = evs("main");
const helpersStarted = main.filter((e) => e.type === "helper.started") as Array<Extract<EngineEventDraft, { type: "helper.started" }>>;
const helperIds = helpersStarted.map((h) => h.helperId);
const firstHelperDone = main.findIndex((e) => e.type === "helper.completed");
const startedBeforeAnyDone = main.filter((e, i) => e.type === "helper.started" && (firstHelperDone < 0 || i < firstHelperDone)).length;
const childToolCalls = main.filter((e) => e.type === "tool.call" && e.agentId && helperIds.includes(e.agentId)).length;
const interruptRun = by("interrupt");
const resumeRun = by("resume");
const searchRun = evs("native-search");
const rawSeen = (run: string) => recording.filter((r) => r.run === run && r.msg.method === "rawResponse/completed").length;
const helperModels = [...new Set(recording.filter((r) => r.run === "main" && r.msg.method === "item/completed" && r.msg.params?.item?.tool === "spawnAgent").map((r) => String(r.msg.params.item.model)))];
const wordCalls = (es: EngineEventDraft[]) => es.filter((e) => e.type === "tool.call" && e.name === "word_count").length;

const capabilities: Record<Capability, { status: CapabilityStatus; evidence: string }> = {
  start: count(main, "run.started", (e) => !!e.nativeSessionId) ? cap("NATIVE", `run.started with nativeSessionId (thread id); main outcome ${by("main")?.outcome.status}`) : cap("UNTESTED", "no run.started observed"),
  stream: count(all, "message.delta") ? cap("NATIVE", `${count(all, "message.delta")} message.delta events (coalesced item/agentMessage/delta)`) : cap("UNTESTED", "no message.delta observed"),
  interrupt:
    interruptRun?.outcome.status === "interrupted"
      ? cap("NATIVE", `turn/interrupt after first delta -> outcome interrupted in ${interruptRun.wallMs}ms (${count(interruptRun.host.events, "message.delta")} deltas before stop)`)
      : cap("UNTESTED", `interrupt run outcome: ${interruptRun?.outcome.status ?? "not run"} ${interruptRun?.outcome.error ?? ""}`),
  resume:
    resumeRun?.outcome.status === "completed" && resumeRun.outcome.nativeSessionId === interruptRun?.outcome.nativeSessionId
      ? cap(/Write the numbers from 1/i.test(resumeRun.outcome.finalText) ? "NATIVE" : "UNTESTED", `thread/resume ${resumeRun.outcome.nativeSessionId}: same thread id; asked to quote the interrupted turn's prompt, replied "${resumeRun.outcome.finalText.slice(0, 80)}"`)
      : cap("UNTESTED", `resume outcome: ${resumeRun?.outcome.status ?? "not run"} ${resumeRun?.outcome.error ?? ""}`),
  subagents:
    helpersStarted.length >= 2
      ? cap("NATIVE", `${helpersStarted.length} helper.started (spawn_agent, child model ${helperModels.join("/")}), ${startedBeforeAnyDone} started before the first helper.completed, ${count(main, "helper.completed")} helper.completed`)
      : cap("UNTESTED", `${helpersStarted.length} helper.started observed`),
  childEventIdentity: childToolCalls ? cap("NATIVE", `${childToolCalls} tool.call events carry agentId = child threadId (helperIds ${helperIds.join(", ")})`) : cap("UNTESTED", "no child tool calls observed"),
  compaction: count(all, "context.compacted")
    ? cap("NATIVE", `${count(all, "context.compacted")} context.compacted (auto; thread config model_auto_compact_token_limit=${COMPACT_AT}); preTokens ${(all.find((e) => e.type === "context.compacted") as any)?.preTokens} -> postTokens ${(all.find((e) => e.type === "context.compacted") as any)?.postTokens}`)
    : cap("UNTESTED", `no context.compacted at model_auto_compact_token_limit=${COMPACT_AT}`),
  toolSearch:
    count(searchRun, "tool.search", (e) => e.via === "native") && wordCalls(searchRun)
      ? cap("NATIVE", `${SEARCH_MODEL}: tool.search via native ${count(searchRun, "tool.search")}, tool.loaded native-tool-search ${count(searchRun, "tool.loaded")}, deferred word_count called ${wordCalls(searchRun)}x. ${MODEL} (not in Codex catalog): app-implemented search ${count(main, "tool.search", (e) => e.via === "node")}, load ${count(main, "tool.loaded")}, word_count calls ${wordCalls(main)}`)
      : count(main, "tool.search") && wordCalls(main)
        ? cap("APP-IMPLEMENTED", `${MODEL}: node search_tools/load_tool/call_tool: tool.search ${count(main, "tool.search")}, tool.loaded ${count(main, "tool.loaded")}, word_count ${wordCalls(main)}; native search run: ${by("native-search")?.outcome.status ?? "not run"}`)
        : cap("UNTESTED", "no search followed by a deferred tool call observed"),
  skillLoad: count(main, "skill.loaded") ? cap("NATIVE", `skill.loaded via native ${count(main, "skill.loaded")} (SKILL.md read by a completed shell command)`) : cap("UNTESTED", "the model never read a workspace SKILL.md successfully"),
  skillRefresh: refreshObserved ? cap("NATIVE", "registered refresher ran skills/list forceReload mid-run and the response listed the newly written line-stats skill") : cap("UNTESTED", "refresh not observed"),
  goals: count(all, "goals.updated") ? cap("NATIVE", `${count(all, "goals.updated")} goals.updated (sources ${[...new Set(all.filter((e) => e.type === "goals.updated").map((e: any) => e.source))].join(", ")})`) : cap("UNTESTED", "no goals.updated"),
  permissions: count(all, "permission.decision")
    ? cap("NATIVE", `permission.decision allow ${count(all, "permission.decision", (e) => e.decision === "allow")}, deny ${count(all, "permission.decision", (e) => e.decision === "deny")} (approval requests -> createPolicy)`)
    : cap("UNTESTED", "no approval request observed"),
  usage: by("main") && by("main")!.outcome.usage.inputTokens + by("main")!.outcome.usage.cacheReadTokens > 0
    ? cap("NATIVE", `${runs.map((r) => `${r.name}: in ${r.outcome.usage.inputTokens} cacheRead ${r.outcome.usage.cacheReadTokens} cacheWrite ${r.outcome.usage.cacheWriteTokens} out ${r.outcome.usage.outputTokens} requests ${r.outcome.usage.modelTurns} (rawResponse/completed seen: ${rawSeen(r.name)})`).join("; ")}. An interrupted in-flight request reports no usage.`)
    : cap("UNTESTED", runs.map((r) => `${r.name}: ${JSON.stringify(r.outcome.usage)}`).join("; ")),
  costUsd: by("main")?.outcome.usage.costUsd != null
    ? cap("APP-IMPLEMENTED", `price table (Codex reports no USD): ${runs.map((r) => `${r.name} $${r.outcome.usage.costUsd}`).join(", ")}`)
    : cap("UNTESTED", `main run usage unpriced: ${JSON.stringify(by("main")?.outcome.usage ?? null)}`),
};

const scriptCost = runs.reduce((s, r) => s + (r.outcome.usage.costUsd ?? 0), 0);
const receipt = {
  engine: "codex-app-server",
  sdk: "@openai/codex",
  sdkVersion: createCodexAdapter().descriptor().sdk.version,
  model: MODEL,
  helperModel: MODEL,
  ranAt: new Date(t0).toISOString(),
  wallMs: Date.now() - t0,
  costUsd: runs.length ? Math.round(scriptCost * 1e6) / 1e6 : null,
  priorExplorationSpendUsd: PRIOR_SPEND_USD,
  eventCounts: Object.fromEntries(runs.map((r) => [r.name, countEvents(r.host.events)])),
  runs: runs.map((r) => ({ name: r.name, status: r.outcome.status, error: r.outcome.error, wallMs: r.wallMs, costUsd: r.outcome.usage.costUsd, finalText: r.outcome.finalText.slice(0, 400) })),
  capabilities,
  notes: [
    "Isolation: CODEX_HOME=<stateDir>/codex-home with cli_auth_credentials_store=\"ephemeral\" (API key via account/login/start apiKey, no auth.json written).",
    "Codex 0.165.0 discovers the OS user's ~/.agents skills even with HOME/USERPROFILE overridden; the adapter disables every skill outside <workspace>/.claude/skills via skills/config/write.",
    `Compaction: automatic, via thread/start config model_auto_compact_token_limit=${COMPACT_AT}; a large SKILL.md appendix pushes context past it. Manual thread/compact/start is not used (no contract entry point).`,
    `${MODEL} is absent from Codex's model catalog (warning "Model metadata ... not found"): Codex then hides deferLoading tools and offers no tool_search, so the adapter falls back to app-implemented search_tools/load_tool/call_tool. ${SEARCH_MODEL} is in the catalog and gets native tool_search.`,
    "Usage: rawResponse/completed (experimentalRawEvents) gives per-response usage including compaction calls, which thread/tokenUsage totals omit. thread/resume has no experimentalRawEvents parameter; the per-run rawResponse counts are in capabilities.usage.",
    "Helper model: spawn_agent's model argument only offers Codex catalog models; on earlier runs gpt-5.4-mini passed model \"gpt-6.1-sol\" (unpriced, so costUsd was null). A child spawned without a model inherits the parent's model, so the adapter tells the model not to pass one when helperModel equals the run model. Config agents.default_subagent_model (thread config or -c) showed no effect.",
    "Policy ceiling: approvalPolicy untrusted auto-runs commands Codex classifies as known-safe reads without an approval request, so those reads skip host.policy; on this Windows host (sandbox notConfigured) every command observed asked for approval.",
  ],
};
mkdirSync(join(PKG, "qualification"), { recursive: true });
writeFileSync(join(PKG, "qualification", "codex.json"), `${JSON.stringify(receipt, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Fixture: real inbound messages, trimmed and stripped of local paths/ids.
// ---------------------------------------------------------------------------
const user = userInfo().username;
const scrub = (s: string) => s.split(root).join("<QUAL>").split(root.replace(/\\/g, "\\\\")).join("<QUAL>").split(user).join("<user>").replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-REDACTED");
const trim = (v: unknown, depth = 0): unknown => {
  if (typeof v === "string") return scrub(v.length > 400 ? `${v.slice(0, 400)}…` : v);
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => trim(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !["encrypted_content", "installationId", "serverName", "userAgent", "codexHome"].includes(k)).map(([k, x]) => [k, depth > 8 ? "…" : trim(x, depth + 1)]));
  return v;
};
const KEEP_RAW = new Set(["tool_search_call", "tool_search_output"]);
const deltas = new Map<string, number>();
const fixture = recording
  .filter(({ dir, msg, run }) => {
    if (dir !== "in") return false;
    if (msg.method === "item/agentMessage/delta") return deltas.set(run, (deltas.get(run) ?? 0) + 1).get(run)! <= 25;
    if (msg.method === "rawResponseItem/completed") return KEEP_RAW.has(msg.params?.item?.type);
    if (msg.method?.startsWith("account/") || msg.method === "remoteControl/status/changed" || msg.method === "item/commandExecution/outputDelta") return false;
    return msg.method !== undefined || msg.result?.thread !== undefined || msg.result?.turn !== undefined;
  })
  .map(({ run, msg }) => JSON.stringify({ run, ...(trim(msg) as object) }));
mkdirSync(join(PKG, "test", "fixtures"), { recursive: true });
writeFileSync(join(PKG, "test", "fixtures", "codex-native.jsonl"), `${fixture.join("\n")}\n`);
console.log(`qualification/codex.json written; fixture ${fixture.length} lines; script cost $${scriptCost.toFixed(4)}; total incl. prior $${spent().toFixed(4)}`);
