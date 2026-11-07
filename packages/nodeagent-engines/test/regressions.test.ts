/**
 * Regressions for fixes found in real UI runs and by the adversarial gate. Each test is the
 * scenario that broke: a resumed Claude run that double counted its parent's spend, models
 * calling read_source with the docId list_sources gave them, engines offered Node's
 * search_tools/load_tool next to their native search, OpenAI Agents never compacting, and
 * Codex offered models its binary has no metadata for. No network, no paid model calls.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EngineEventDraft, RunSpec, TemplateConfig } from "../src/contract.js";
import { createClaudeAdapter } from "../src/engines/claude.js";
import { createCodexAdapter } from "../src/engines/codex.js";
import { resolveCodexBinary } from "../src/engines/codex/rpc.js";
import { createOpenAIAgentsAdapter } from "../src/engines/openaiAgents.js";
import { createFakeHost } from "../src/testing/fakeHost.js";
import { buildNodeToolCatalog } from "../src/tools/catalog.js";
import { createGateway } from "../src/tools/gateway.js";

type Ev<T extends EngineEventDraft["type"]> = Extract<EngineEventDraft, { type: T }>;
const of = <T extends EngineEventDraft["type"]>(events: EngineEventDraft[], type: T) => events.filter((e): e is Ev<T> => e.type === type);
const tmp = (name: string) => mkdtempSync(join(os.tmpdir(), `nodeagent-regress-${name}-`));
const DISCOVERY = ["search_tools", "load_tool"];

// ---------------------------------------------------------------------------
// Claude: a resumed run reports only its own spend
// ---------------------------------------------------------------------------

/** Field shape of the recorded qualification result (test/fixtures/claude-native.jsonl, last line). */
const usage = (inputTokens: number, outputTokens: number, cacheReadInputTokens: number, cacheCreationInputTokens: number, costUSD: number, model = "claude-sonnet-5-5") => ({
  inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests: 0, costUSD,
  contextWindow: 1000000, maxOutputTokens: 128000, cacheCreationEphemeral5mInputTokens: cacheCreationInputTokens,
  cacheCreationEphemeral1hInputTokens: 0, canonicalModel: model, provider: "firstParty", costBasis: "list",
});
const SESSION = "2c8070ea-e3d0-474e-bfe1-f57866b20fc0";
const init = { type: "system", subtype: "init", session_id: SESSION, model: "claude-sonnet-5-5", cwd: "<ws>", tools: [], skills: [], agents: ["helper"], uuid: "u0" };
const result = (cost: number, modelUsage: Record<string, unknown>, session = SESSION) =>
  ({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: cost, modelUsage, session_id: session, uuid: `u-${cost}` });

// Totals recorded by the deep proof (evidence/agent-workspace-20261029/run-deep-claude): parent
// b03ac263's last result, then resume a81e7cab's first and last results on the same session,
// split between the main model and the helper model.
const PARENT_END = result(0.85536647, { "claude-sonnet-5-5": usage(12000, 100000, 1800000, 200000, 0.7), "claude-haiku-5-5": usage(4958, 33764, 254488, 52365, 0.15536647, "claude-haiku-5-5") });
const RESUME_FIRST = result(1.442323255, { "claude-sonnet-5-5": usage(18000, 210000, 3300000, 450000, 1.15), "claude-haiku-5-5": usage(7926, 68610, 558223, 128274, 0.292323255, "claude-haiku-5-5") });
const RESUME_END = result(1.839112975, { "claude-sonnet-5-5": usage(25000, 265000, 4700000, 600000, 1.45), "claude-haiku-5-5": usage(11347, 89764, 850832, 171716, 0.389112975, "claude-haiku-5-5") });

function claudeRun(stateDir: string, messages: object[], spec: Partial<RunSpec> = {}, tools = buildNodeToolCatalog({ nativeFileTools: true })) {
  const ws = tmp("ws");
  const host = createFakeHost({ env: { anthropicApiKey: "test-key" }, stateDir, workspaceDir: ws, tools });
  let options: Options | undefined;
  const query = ({ options: o }: { options: Options }): Query => {
    options = o;
    const gen = (async function* () {
      yield* messages as SDKMessage[];
    })();
    return Object.assign(gen, { interrupt: async () => {}, reloadSkills: async () => ({}), getContextUsage: async () => ({ totalTokens: 1, maxTokens: 1000000 }), close() {} }) as unknown as Query;
  };
  const handle = createClaudeAdapter({ query }).start({ runId: "r", projectId: "p", workspaceDir: ws, prompt: "go", model: "claude-sonnet-5-5", budget: {}, context: {}, ...spec }, host);
  return { host, done: handle.done, options: () => options! };
}

test("claude resume: a resumed run reports its own tokens and cost, not the parent's carried-over totals", async () => {
  // Dana's deep run stops at $0.855; she resumes it and the resume spends $0.984 more.
  const state = tmp("claude-state");
  const parent = await claudeRun(state, [init, PARENT_END]).done;
  assert.equal(parent.status, "completed");
  assert.equal(parent.usage.costUsd, 0.85536647, "a root run's cumulative total is its own");

  const resumed = claudeRun(state, [init, RESUME_FIRST, RESUME_END], { resume: { nativeSessionId: SESSION } });
  const out = await resumed.done;
  const first = of(resumed.host.events, "usage")[0].totals;
  assert.equal(first.outputTokens, 278610 - 133764, "the first result after resuming already carries the parent's 133,764 output tokens");
  assert.equal(out.usage.outputTokens, 354764 - 133764);
  assert.equal(out.usage.inputTokens, 36347 - 16958);
  assert.equal(out.usage.cacheReadTokens, 5550832 - 2054488);
  assert.equal(out.usage.cacheWriteTokens, 771716 - 252365);
  assert.equal(out.usage.costSource, "engine");
  assert.ok(Math.abs(out.usage.costUsd! - (1.839112975 - 0.85536647)) < 1e-9, `resume cost ${out.usage.costUsd}`);
  assert.ok(parent.usage.costUsd! + out.usage.costUsd! < 1.839112975 + 1e-9, "the chain's runs sum to the session total, not more");

  // Resume of the resume: the baseline is now the first resume's last total.
  const again = await claudeRun(state, [init, result(2.0, { "claude-sonnet-5-5": usage(26000, 270000, 4800000, 610000, 1.6), "claude-haiku-5-5": usage(11347, 89764, 850832, 171716, 0.389112975, "claude-haiku-5-5") })], { resume: { nativeSessionId: SESSION } }).done;
  assert.ok(Math.abs(again.usage.costUsd! - (2.0 - 1.839112975)) < 1e-9);
  assert.equal(again.usage.outputTokens, 5000);
});

test("claude resume sad paths: no saved totals is unknown cost (never the cumulative figure); a result that did not carry totals over is taken as-is", async () => {
  const state = tmp("claude-state");
  // Session recorded before Node kept totals: the split is unknowable, so cost is null, not $1.44.
  const legacy = await claudeRun(state, [init, RESUME_FIRST], { resume: { nativeSessionId: SESSION } }).done;
  assert.deepEqual([legacy.usage.costUsd, legacy.usage.costSource], [null, "unknown"]);
  assert.equal(legacy.usage.outputTokens, 278610, "tokens are still reported");

  // The CLI resumed without its saved totals ("when it has them"): smaller than the baseline, so not cumulative.
  await claudeRun(state, [init, PARENT_END]).done;
  const fresh = await claudeRun(state, [init, result(0.05, { "claude-sonnet-5-5": usage(500, 2000, 10000, 3000, 0.05) })], { resume: { nativeSessionId: SESSION } }).done;
  assert.deepEqual([fresh.usage.costUsd, fresh.usage.outputTokens], [0.05, 2000], "never negative, never subtracted twice");

  // An interrupted turn's empty modelUsage must not reset the saved baseline.
  await claudeRun(state, [init, PARENT_END]).done;
  const interrupted = await claudeRun(state, [init, result(0, {})], { resume: { nativeSessionId: SESSION } }).done;
  assert.equal(interrupted.usage.costUsd, null);
  const after = await claudeRun(state, [init, RESUME_FIRST], { resume: { nativeSessionId: SESSION } }).done;
  assert.equal(after.usage.outputTokens, 278610 - 133764);
});

// ---------------------------------------------------------------------------
// One tool-discovery mechanism per engine
// ---------------------------------------------------------------------------

test("claude: Node's search_tools/load_tool are never offered next to native ToolSearch (main or helpers)", async () => {
  const catalog = buildNodeToolCatalog({ nativeFileTools: true });
  for (const n of DISCOVERY) assert.ok(catalog.some((t) => t.name === n), `precondition: the catalog has ${n}`);
  const run = claudeRun(tmp("claude-tools"), [init, PARENT_END], {}, catalog);
  await run.done;
  const started = of(run.host.events, "run.started")[0];
  for (const n of DISCOVERY) assert.ok(!started.deferredTools!.includes(n), `${n} deferred behind ToolSearch`);
  // The helper gets every Node tool the main agent's MCP server serves.
  const agents = run.options().agents!;
  assert.ok(["read_source", "update_goals", "draft_skill"].every((n) => agents.helper.tools!.includes(`mcp__node__${n}`)), agents.helper.tools!.join(","));
  for (const a of Object.values(agents)) for (const n of DISCOVERY) assert.ok(!a.tools!.includes(`mcp__node__${n}`), `${n} offered to Claude`);
  assert.ok(agents.helper.tools!.includes("ToolSearch"), "helpers keep the native search");
});

/** Runs the real OpenAI Agents adapter with fetch stubbed: captures the Responses request, answers 400. */
async function openaiRequest(spec: Partial<RunSpec> = {}) {
  const ws = tmp("oa-ws");
  const host = createFakeHost({ env: { openaiApiKey: "sk-test-not-real" }, stateDir: tmp("oa-state"), workspaceDir: ws, tools: buildNodeToolCatalog({ nativeFileTools: false }) });
  const bodies: Array<{ url: string; body: Record<string, any> }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    bodies.push({ url: String(url instanceof Request ? url.url : url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ error: { message: "stubbed", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const out = await createOpenAIAgentsAdapter().start({ runId: "r", projectId: "p", workspaceDir: ws, prompt: "go", model: "gpt-5.5", budget: {}, context: {}, ...spec }, host).done;
    return { out, host, bodies };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("openai agents: tool list has hosted tool_search only (no Node search_tools/load_tool); compaction is on by default", async () => {
  const { out, host, bodies } = await openaiRequest();
  assert.equal(out.status, "failed", "the stubbed 400 is an honest failure");
  assert.ok(bodies.length >= 1 && bodies.every((b) => b.url.startsWith("https://api.openai.com/")), "every request hit the stub, none the network");
  const req = bodies[0].body;
  const names = (req.tools as Array<{ type: string; name?: string }>).map((t) => t.name ?? t.type);
  assert.ok(names.includes("read_source") && names.includes("spawn_helper") && names.some((n) => /tool_search/.test(n)), names.join(","));
  for (const n of DISCOVERY) assert.ok(!names.includes(n), `${n} sent to OpenAI`);
  const started = of(host.events, "run.started")[0];
  for (const n of DISCOVERY) assert.ok(![...started.tools, ...(started.deferredTools ?? [])].includes(n));
  // Before: no context_management at all unless the run set a threshold, so long runs never compacted.
  assert.deepEqual(req.context_management, [{ type: "compaction", compact_threshold: 240_000 }]);
  assert.deepEqual(createOpenAIAgentsAdapter().descriptor().defaults, { maxTurns: 40, autoCompactTokens: 240_000 }, "the same fallbacks Node writes onto the run record");

  const set = await openaiRequest({ context: { autoCompactTokens: 100_000 } });
  assert.deepEqual(set.bodies[0].body.context_management, [{ type: "compaction", compact_threshold: 100_000 }], "a run's threshold wins");
});

// ---------------------------------------------------------------------------
// Codex: only models the pinned binary ships metadata for
// ---------------------------------------------------------------------------

const bin = resolveCodexBinary();

/** Model slugs in the binary's embedded catalog (`"slug": "<id>"`), scanned without decoding 350MB to a string. */
function binarySlugs(file: string): Set<string> {
  const buf = readFileSync(file);
  const key = Buffer.from('"slug": "');
  const out = new Set<string>();
  for (let i = buf.indexOf(key); i >= 0; i = buf.indexOf(key, i + 1)) {
    const end = buf.indexOf(0x22, i + key.length);
    if (end > 0 && end - i < 80) out.add(buf.toString("latin1", i + key.length, end));
  }
  return out;
}

test("codex: every offered model has metadata in the pinned binary (others run without apply_patch)", { skip: "error" in bin ? bin.error : false }, () => {
  const slugs = binarySlugs((bin as { path: string }).path);
  assert.ok(slugs.size >= 5, `catalog found in the binary: ${[...slugs].join(", ")}`);
  const d = createCodexAdapter().descriptor();
  for (const m of [...d.models, d.defaultModel, d.defaultHelperModel!]) assert.ok(slugs.has(m), `${m} has no binary metadata`);
  for (const m of ["gpt-5.4-mini", "gpt-5.3-codex"]) {
    assert.ok(!slugs.has(m), `precondition: ${m} is absent from the binary`);
    assert.ok(!d.models.includes(m), `${m} offered`);
  }
});

test("codex descriptor: goals are labelled by what worker runs showed; skill.loaded is labelled an inference", () => {
  const caps = createCodexAdapter().descriptor().capabilities;
  assert.equal(caps.goals.status, "APP-IMPLEMENTED");
  assert.match(caps.goals.note, /update_goals/);
  assert.match(caps.skillLoad.note, /inference/);
});

// ---------------------------------------------------------------------------
// read_source takes the docId list_sources returns
// ---------------------------------------------------------------------------

test("read_source: models pass back list_sources' docId (object, bare string or JSON string); restricted docs stay closed", async () => {
  const ws = tmp("sources");
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(ws, rel)), { recursive: true });
    writeFileSync(join(ws, rel), text);
  };
  write("sources/companies/acme-profile.md", "# Acme\nRevenue 12.4m\nEBITDA 2.1m\n");
  write("sources/restricted/deal.md", "TOP-SECRET-LINE\n");
  const template: TemplateConfig = { id: "t", title: "t", description: "", restrictedGlobs: ["sources/restricted/**"], checks: {} };
  const gw = createGateway({ runId: "r", workspaceDir: ws, nodeStateDir: tmp("ns"), template, nativeFileTools: false, signal: new AbortController().signal, emit: () => {} });
  const listed = await gw.call("list_sources", {}, {});
  assert.match(listed.content, /sources\/companies\/acme-profile\.md/, "list_sources hands out the docId");

  const doc = "sources/companies/acme-profile.md";
  for (const args of [{ docId: doc }, doc, JSON.stringify({ docId: doc }), { path: doc }]) {
    const r = await gw.call("read_source", args, {});
    assert.equal(r.ok, true, `${JSON.stringify(args)}: ${r.content}`);
    assert.match(r.content, /Revenue 12\.4m/);
  }
  const ranged = await gw.call("read_source", { docId: doc, startLine: 3 }, {});
  assert.ok(ranged.ok && /EBITDA/.test(ranged.content) && !/Revenue/.test(ranged.content));

  const denied = await gw.call("read_source", { docId: "sources/restricted/deal.md" }, {});
  assert.equal(denied.ok, false);
  assert.ok(!denied.content.includes("TOP-SECRET-LINE"));
  const none = await gw.call("read_source", {}, {});
  assert.ok(!none.ok && /docId/.test(none.content), "a missing id says which field to send");
});
