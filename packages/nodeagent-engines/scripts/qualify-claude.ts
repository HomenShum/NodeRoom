/**
 * Real, paid qualification of the Claude Agent SDK adapter (cap $2.00).
 *   npx tsx scripts/qualify-claude.ts
 * Run 1: plan + skill + deferred-tool search + two concurrent helpers + auto compaction + policy denial.
 * Run 2: interrupt via handle.interrupt(). Run 3: resume run 2 by native session id, then
 * activate a drafted skill through a Node tool (reloadSkills) and load it.
 * Run 4 (only if run 1 did not auto-compact): manual "/compact" on run 1's session.
 * Writes qualification/claude.json and test/fixtures/claude-native.jsonl.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeAdapter } from "../src/engines/claude.js";
import { loadProviderEnv } from "../src/env.js";
import { countEvents, createFakeHost } from "../src/testing/fakeHost.js";
import type { Capability, CapabilityStatus, EngineEventDraft, EngineRunOutcome, NodeToolDefinition, PolicyGate, RunSpec } from "../src/contract.js";

const CAP_USD = 2.0;
const MODEL = "claude-haiku-5-5";
const HELPER_MODEL = "claude-haiku-5-5";
/** Lowest value the CLI honours: getContextUsage() reports a 100000-token window (threshold 67000) for any lower setting. */
const AUTO_COMPACT_TOKENS = 100_000;

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = loadProviderEnv([resolve(pkgDir, "../../.env.local")]);
const root = join(os.tmpdir(), "nodeagent-qual", `claude-${Date.now()}`);
const ws = join(root, "ws");
const stateDir = join(root, "state");

// ---------------------------------------------------------------- workspace
const ALPHA = "Node owns the run record, the permissions and the budget. The engine owns only its turn loop. ".repeat(6).trim();
const BETA = "Helpers run concurrently and report back with concrete word counts and file paths. ".repeat(5).trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const CODEWORDS = ["HERON", "MAPLE", "COBALT", "QUARTZ"];
mkdirSync(join(ws, "docs"), { recursive: true });
mkdirSync(join(ws, "corpus"), { recursive: true });
mkdirSync(join(ws, ".claude", "skills", "word-stats"), { recursive: true });
mkdirSync(join(ws, "skill-drafts", "haiku-format"), { recursive: true });
writeFileSync(join(ws, "docs", "alpha.txt"), `${ALPHA}\n`);
writeFileSync(join(ws, "docs", "beta.txt"), `${BETA}\n`);
writeFileSync(join(root, "outside.txt"), "Not part of the workspace.\n");
CODEWORDS.forEach((cw, p) => {
  const lines = Array.from({ length: 700 }, (_, i) => `Part ${p + 1} line ${String(i + 1).padStart(4, "0")}: ledger entry ${(i * 7919 + p * 104729) % 100000} reconciled against batch ${(i * 31 + p) % 997} for audit section ${"ABCDEFGH"[i % 8]}.`);
  lines.push(`CODEWORD: ${cw}`);
  writeFileSync(join(ws, "corpus", `part-${p + 1}.txt`), `${lines.join("\n")}\n`);
});
writeFileSync(
  join(ws, ".claude", "skills", "word-stats", "SKILL.md"),
  [
    "---",
    "name: word-stats",
    "description: Count the words in a workspace file. Use when asked for word counts or text statistics.",
    "---",
    "# word-stats",
    "1. Never count words by hand or with Bash.",
    "2. Call the Node tool `mcp__node__word_count` with `{ \"path\": \"<workspace-relative path>\" }`. It is deferred: load it with ToolSearch (query `count words`) first.",
    "3. Report each result exactly as `<path>: <n> words`.",
    "",
  ].join("\n"),
);
writeFileSync(
  join(ws, "skill-drafts", "haiku-format", "SKILL.md"),
  ["---", "name: haiku-format", "description: Format a final answer as a three-line haiku. Use when asked for haiku format.", "---", "Answer as exactly three lines of 5, 7 and 5 syllables. End with the line `-- haiku-format`.", ""].join("\n"),
);

// ---------------------------------------------------------------- Node tools (inline)
function inside(p: string): string | null {
  const abs = resolve(ws, p);
  const rel = relative(ws, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? null : abs;
}
const def = <S extends z.ZodTypeAny>(t: NodeToolDefinition<S>) => t as unknown as NodeToolDefinition;
const tools: NodeToolDefinition[] = [
  def({
    name: "word_count",
    family: "workspace",
    risk: "read",
    description: "Count the words in a workspace text file (whitespace-separated tokens).",
    searchHint: "count words in a file, word count, text statistics",
    schema: z.object({ path: z.string().describe("Workspace-relative file path") }),
    async execute(args) {
      const abs = inside(args.path);
      if (!abs) return { ok: false, content: `Path ${args.path} is outside the workspace` };
      try {
        const n = words(readFileSync(abs, "utf8"));
        return { ok: true, content: `${args.path}: ${n} words`, data: { words: n } };
      } catch (err) {
        return { ok: false, content: `Cannot read ${args.path}: ${(err as Error).message}` };
      }
    },
  }),
  def({
    name: "list_workspace",
    family: "workspace",
    risk: "read",
    alwaysLoad: true,
    description: "List the top-level folders of the workspace.",
    schema: z.object({}),
    async execute() {
      return { ok: true, content: "docs/, corpus/, skill-drafts/, .claude/skills/" };
    },
  }),
  def({
    name: "activate_skill",
    family: "skills",
    risk: "write",
    alwaysLoad: true,
    description: "Activate a drafted skill: copy skill-drafts/<name>/SKILL.md to .claude/skills/<name>/ and refresh the engine's skill list.",
    schema: z.object({ name: z.string().regex(/^[a-z0-9-]+$/) }),
    async execute(args, ctx) {
      const from = join(ws, "skill-drafts", args.name, "SKILL.md");
      const to = join(ws, ".claude", "skills", args.name);
      try {
        mkdirSync(to, { recursive: true });
        cpSync(from, join(to, "SKILL.md"));
      } catch (err) {
        return { ok: false, content: `No draft ${args.name}: ${(err as Error).message}` };
      }
      if (!ctx.refreshSkills) return { ok: false, content: "Activated on disk, but the engine registered no skill refresher" };
      try {
        await ctx.refreshSkills();
        refreshCalls++;
      } catch (err) {
        refreshErrors.push((err as Error).message);
        return { ok: false, content: `Activated on disk; skill refresh failed: ${(err as Error).message}` };
      }
      return { ok: true, content: `Skill ${args.name} is active; load it with the Skill tool.` };
    },
  }),
];
let refreshCalls = 0;
const refreshErrors: string[] = [];

/** Qualification policy: Node-only .claude/, nothing outside the workspace. */
const deniedPaths: string[] = [];
const policy: PolicyGate = {
  checkNativeTool(name, input) {
    const a = (input ?? {}) as Record<string, unknown>;
    const p = typeof a.file_path === "string" ? a.file_path : typeof a.notebook_path === "string" ? a.notebook_path : typeof a.path === "string" ? a.path : undefined;
    if (p) {
      const abs = inside(p);
      if (!abs) {
        deniedPaths.push(relative(root, resolve(ws, p)).split("\\").join("/"));
        return { allow: false, reason: `${name}: path is outside the workspace` };
      }
      const rel = relative(ws, abs).split("\\").join("/");
      if (["Write", "Edit", "NotebookEdit"].includes(name) && (rel === ".claude" || rel.startsWith(".claude/"))) {
        deniedPaths.push(rel);
        return { allow: false, reason: `Only Node writes under .claude/ (${rel})` };
      }
    }
    if (name === "Bash" && /\b(curl|wget|rm)\b/.test(String(a.command ?? ""))) return { allow: false, reason: "Bash command not allowed in qualification" };
    return { allow: true, reason: `${name} allowed by qualification policy` };
  },
};

// ---------------------------------------------------------------- runner
const adapter = createClaudeAdapter({ onNative: (m) => natives.push({ run: currentRun, m }) });
const natives: Array<{ run: string; m: SDKMessage }> = [];
let currentRun = "";
/** Earlier attempts in this session count against the cap (attempt 1: $0.099314, TodoWrite unavailable; see notes). */
const PRIOR_SPEND = Number(process.env.QUAL_PRIOR_SPEND_USD ?? 0);
let spent = PRIOR_SPEND;

interface RunReceipt {
  label: string;
  outcome: EngineRunOutcome;
  events: EngineEventDraft[];
  wallMs: number;
  interruptMs?: number;
}

async function run(label: string, prompt: string, extra: Partial<RunSpec> & { maxUsd: number; maxWallMs: number }, onEvent?: (e: EngineEventDraft, interrupt: (r: string) => Promise<void>) => void): Promise<RunReceipt> {
  currentRun = label;
  const host = createFakeHost({ env, stateDir, workspaceDir: ws, tools, policy, echo: false, runId: label });
  const spec: RunSpec = {
    runId: label,
    projectId: "qual",
    workspaceDir: ws,
    prompt,
    model: MODEL,
    helperModel: HELPER_MODEL,
    budget: { maxUsd: extra.maxUsd, maxTurns: 40, maxWallMs: extra.maxWallMs },
    context: { autoCompactTokens: AUTO_COMPACT_TOKENS },
    resume: extra.resume,
  };
  const t0 = Date.now();
  let interruptAt: number | undefined;
  const emit = host.emit;
  const handle = adapter.start(spec, {
    ...host,
    emit(e) {
      emit(e);
      if (e.type === "usage" && e.totals.costUsd !== null && spent + e.totals.costUsd > CAP_USD) {
        console.log(`[cap] ${label} would exceed $${CAP_USD}; aborting`);
        host.controller.abort(new Error("qualification spend cap"));
      }
      if (e.type !== "message.delta" && e.type !== "engine.raw") console.log(`[${label}] ${e.type} ${JSON.stringify(e).slice(0, 200)}`);
      onEvent?.(e, async (r) => {
        interruptAt = Date.now();
        await handle.interrupt(r);
      });
    },
  });
  const wall = setTimeout(() => host.controller.abort(new Error(`wall cap ${extra.maxWallMs}ms`)), extra.maxWallMs);
  const outcome = await handle.done;
  clearTimeout(wall);
  const wallMs = Date.now() - t0;
  if (outcome.usage.costUsd !== null) spent += outcome.usage.costUsd;
  console.log(`[${label}] outcome ${outcome.status} cost=${outcome.usage.costUsd} (${outcome.usage.costSource}) session=${outcome.nativeSessionId} wall=${wallMs}ms ${outcome.error ?? ""}`);
  return { label, outcome, events: host.events, wallMs, interruptMs: interruptAt ? Date.now() - interruptAt : undefined };
}

const t0 = Date.now();
const availability = await adapter.availability(env);
if (!availability.ok) {
  console.error("Setup required:", availability.missing.join("; "));
  process.exit(1);
}

const PROMPT_1 = [
  "Qualification task. Do ALL of the following in order and do not skip any step.",
  "1. Create a TodoWrite plan with one item per step below; keep it updated and mark items completed as you go.",
  "2. Load the `word-stats` skill with the Skill tool and follow it.",
  "3. Use ToolSearch (query: \"count words\") to load the deferred Node tool, then call it yourself on docs/alpha.txt.",
  "4. In ONE assistant message, launch TWO `helper` agents in parallel with the Agent tool (subagent_type \"helper\"): helper A counts the words of docs/alpha.txt, helper B counts the words of docs/beta.txt. Each must use the Node word_count tool (loading it with ToolSearch if needed) and reply `<path>: <n> words`.",
  "5. While the helpers work, Read corpus/part-1.txt, corpus/part-2.txt, corpus/part-3.txt and corpus/part-4.txt yourself, one Read call per file, each in full (no offset or limit), and note the CODEWORD on the last line of each.",
  "6. Try exactly once to Read ../outside.txt (one level above the workspace). Node's policy denies it; that is expected. Do not retry or work around it.",
  "7. When both helpers have reported, write summary.md with both word counts and the four codewords, citing sources like [src:docs/alpha.txt#L1] and [src:corpus/part-1.txt#L701].",
  "8. End with a short final answer listing the word counts and codewords.",
].join("\n");

const r1 = await run("main", PROMPT_1, { maxUsd: 1.0, maxWallMs: 9 * 60_000 });

let r2: RunReceipt | undefined;
let r3: RunReceipt | undefined;
let r4: RunReceipt | undefined;
if (spent < CAP_USD - 0.3) {
  let fired = false;
  r2 = await run(
    "interrupt",
    "Remember this codeword for later: PELICAN-42. Now Read docs/alpha.txt and docs/beta.txt, then write essay.md: a 400-word essay about them.",
    { maxUsd: 0.25, maxWallMs: 3 * 60_000 },
    (e, interrupt) => {
      if (!fired && e.type === "tool.call") {
        fired = true;
        void interrupt("qualification: interrupt after first tool call");
      }
    },
  );
}
if (r2?.outcome.nativeSessionId && spent < CAP_USD - 0.3) {
  r3 = await run(
    "resume",
    [
      "1. What codeword did I ask you to remember earlier in this session? State it.",
      "2. Call mcp__node__activate_skill with name \"haiku-format\".",
      "3. Load the haiku-format skill with the Skill tool and give your final answer about the codeword in that format.",
    ].join("\n"),
    { maxUsd: 0.25, maxWallMs: 3 * 60_000, resume: { nativeSessionId: r2.outcome.nativeSessionId } },
  );
}
const autoCompactions = r1.events.filter((e) => e.type === "context.compacted").length;
if (autoCompactions === 0 && r1.outcome.nativeSessionId && spent < CAP_USD - 0.3) {
  r4 = await run("manual-compact", "/compact", { maxUsd: 0.3, maxWallMs: 3 * 60_000, resume: { nativeSessionId: r1.outcome.nativeSessionId } });
}

// ---------------------------------------------------------------- receipts
const all = [r1, r2, r3, r4].filter(Boolean) as RunReceipt[];
const ev = (r: RunReceipt | undefined, type: string) => (r ? r.events.filter((e) => e.type === type) : []);
const helperStarts = ev(r1, "helper.started") as Extract<EngineEventDraft, { type: "helper.started" }>[];
const helperIds = new Set(helperStarts.map((h) => h.helperId));
const helperDone = ev(r1, "helper.completed") as Extract<EngineEventDraft, { type: "helper.completed" }>[];
const idx = (pred: (e: EngineEventDraft) => boolean) => r1.events.findIndex(pred);
const secondStart = helperStarts.length >= 2 ? idx((e) => e === helperStarts[1]) : -1;
const firstDone = helperDone.length ? idx((e) => e === helperDone[0]) : -1;
const concurrent = secondStart >= 0 && firstDone >= 0 && secondStart < firstDone;
const childCalls = r1.events.filter((e) => e.type === "tool.call" && e.agentId && helperIds.has(e.agentId));
const searches = ev(r1, "tool.search") as Extract<EngineEventDraft, { type: "tool.search" }>[];
const loaded = (ev(r1, "tool.loaded") as Extract<EngineEventDraft, { type: "tool.loaded" }>[]).flatMap((e) => e.names);
const wordCalls = r1.events.filter((e) => e.type === "tool.call" && e.name === "word_count");
const firstSearch = idx((e) => e.type === "tool.search");
const callAfterSearch = wordCalls.some((c) => idx((e) => e === c) > firstSearch && firstSearch >= 0);
const skillLoads = all.flatMap((r) => ev(r, "skill.loaded")) as Extract<EngineEventDraft, { type: "skill.loaded" }>[];
const goals = ev(r1, "goals.updated");
const compacted = [...ev(r1, "context.compacted"), ...ev(r4, "context.compacted")] as Extract<EngineEventDraft, { type: "context.compacted" }>[];
const denials = all.flatMap((r) => ev(r, "permission.decision")).filter((e) => e.type === "permission.decision" && e.decision === "deny");
const deltas = ev(r1, "message.delta").length;
const ctxUsage = ev(r1, "context.usage") as Extract<EngineEventDraft, { type: "context.usage" }>[];
const started2 = ev(r2, "run.started")[0] as Extract<EngineEventDraft, { type: "run.started" }> | undefined;
const started3 = ev(r3, "run.started")[0] as Extract<EngineEventDraft, { type: "run.started" }> | undefined;
// Attempt 1 required /PELICAN-42/; the haiku-format skill made the model spell it "PELICAN dash forty-two", so match the word.
const resumeRecall = !!r3 && /PELICAN/i.test(r3.events.filter((e) => e.type === "message").map((e) => (e as { text: string }).text).join("\n") + r3.outcome.finalText);
const started1 = ev(r1, "run.started")[0] as Extract<EngineEventDraft, { type: "run.started" }> | undefined;

type Cap = { status: CapabilityStatus; evidence: string };
const yes = (ok: boolean, evidence: string, fail: string, failStatus: CapabilityStatus = "UNTESTED"): Cap => (ok ? { status: "NATIVE", evidence } : { status: failStatus, evidence: fail });
const capabilities: Record<Capability, Cap> = {
  start: yes(!!started1?.nativeSessionId, `run.started x${ev(r1, "run.started").length} nativeSessionId=${started1?.nativeSessionId}; tools=${started1?.tools.length} deferred=${JSON.stringify(started1?.deferredTools)} skills=${started1?.skills.length}`, `no run.started with session id; outcome=${r1.outcome.status} ${r1.outcome.error ?? ""}`),
  stream: yes(deltas > 0, `message.delta x${deltas} (main agent, includePartialMessages)`, "no message.delta observed"),
  interrupt: yes(r2?.outcome.status === "interrupted", `run 2 handle.interrupt() after first tool.call -> outcome ${r2?.outcome.status} in ${r2?.interruptMs}ms; session ${r2?.outcome.nativeSessionId}`, `run 2 outcome ${r2?.outcome.status ?? "not run"} ${r2?.outcome.error ?? ""}`),
  resume: yes(!!r3 && r3.outcome.status === "completed" && started3?.nativeSessionId === r2?.outcome.nativeSessionId && resumeRecall, `run 3 resume=${r2?.outcome.nativeSessionId}: run.started nativeSessionId=${started3?.nativeSessionId}, recalled PELICAN-42=${resumeRecall}, outcome ${r3?.outcome.status}`, `run 3 ${r3 ? `outcome ${r3.outcome.status}, same session=${started3?.nativeSessionId === r2?.outcome.nativeSessionId}, recalled=${resumeRecall} ${r3.outcome.error ?? ""}` : "not run"}`),
  subagents: yes(helperStarts.length >= 2 && helperDone.length >= 2 && concurrent, `helper.started x${helperStarts.length} (${helperStarts.map((h) => `${h.subagentType}/${h.model}/bg=${h.background}`).join(", ")}), helper.completed x${helperDone.length} (${helperDone.map((h) => h.status).join(",")}), concurrent=${concurrent}, helper.progress x${ev(r1, "helper.progress").length}`, `helper.started x${helperStarts.length}, helper.completed x${helperDone.length}, concurrent=${concurrent}`),
  childEventIdentity: yes(childCalls.length > 0, `${childCalls.length} child tool.call events carry agentId = helper task_id (${[...new Set(childCalls.map((c) => (c as { agentId?: string }).agentId))].join(", ")}); child tool.result x${r1.events.filter((e) => e.type === "tool.result" && !!e.agentId && helperIds.has(e.agentId)).length}`, `no tool.call carried a helper agentId (helpers: ${[...helperIds].join(",")})`),
  compaction: yes(compacted.length > 0, `context.compacted x${compacted.length}: ${compacted.map((c) => `${c.trigger} ${c.preTokens}->${c.postTokens ?? "?"} ref=${c.nativeRef}`).join("; ")} (${autoCompactions ? `auto, CLAUDE_CODE_AUTO_COMPACT_WINDOW=${AUTO_COMPACT_TOKENS}` : "manual /compact through the input stream"})`, `no compact_boundary; max context.usage ${Math.max(0, ...ctxUsage.map((c) => c.usedTokens))} tokens`),
  toolSearch: yes(searches.length > 0 && loaded.includes("word_count") && callAfterSearch, `tool.search x${searches.length} (${searches.map((s) => JSON.stringify(s.query)).join(", ")}), tool.loaded ${JSON.stringify([...new Set(loaded)])} via native-tool-search, word_count tool.call x${wordCalls.length} after search`, `tool.search x${searches.length}, loaded=${JSON.stringify(loaded)}, word_count calls=${wordCalls.length}, after search=${callAfterSearch}`),
  skillLoad: yes(skillLoads.some((s) => s.name === "word-stats" && !!s.sha256), `skill.loaded ${skillLoads.map((s) => `${s.name}${s.sha256 ? "#" + s.sha256.slice(0, 8) : ""}`).join(", ")} via native Skill tool`, `skill.loaded: ${JSON.stringify(skillLoads.map((s) => s.name))}`),
  skillRefresh: yes(refreshCalls > 0 && skillLoads.some((s) => s.name === "haiku-format"), `activate_skill -> Query.reloadSkills() ok x${refreshCalls}; then skill.loaded haiku-format in the same live session`, `refresh calls ${refreshCalls}, errors ${JSON.stringify(refreshErrors)}, haiku-format loaded=${skillLoads.some((s) => s.name === "haiku-format")}`),
  goals: yes(goals.length > 0, `goals.updated x${goals.length} from TodoWrite; last: ${JSON.stringify((goals.at(-1) as { goals: unknown[] } | undefined)?.goals?.length)} items`, "no TodoWrite observed"),
  permissions: yes(denials.length > 0, `permission.decision deny x${denials.length} (${[...new Set(deniedPaths)].join(", ")}); allow x${all.flatMap((r) => ev(r, "permission.decision")).length - denials.length}`, "no deny observed"),
  usage: yes(r1.outcome.usage.inputTokens + r1.outcome.usage.outputTokens > 0, `run 1 tokens in=${r1.outcome.usage.inputTokens} out=${r1.outcome.usage.outputTokens} cacheRead=${r1.outcome.usage.cacheReadTokens} cacheWrite=${r1.outcome.usage.cacheWriteTokens} modelTurns=${r1.outcome.usage.modelTurns}`, "no token usage"),
  costUsd: yes(r1.outcome.usage.costSource === "engine" && r1.outcome.usage.costUsd !== null, `result.total_cost_usd=${r1.outcome.usage.costUsd} (costSource engine)`, `costSource=${r1.outcome.usage.costSource} costUsd=${r1.outcome.usage.costUsd}`),
};

const receipt = {
  engine: "claude-agent-sdk",
  sdk: "@anthropic-ai/claude-agent-sdk",
  sdkVersion: adapter.descriptor().sdk.version,
  model: MODEL,
  helperModel: HELPER_MODEL,
  ranAt: new Date(t0).toISOString(),
  wallMs: Date.now() - t0,
  /** Known spend including earlier attempts; a lower bound when any run's cost is unknown. */
  costUsd: Math.round(spent * 1e6) / 1e6,
  costUsdIsLowerBound: all.some((r) => r.outcome.usage.costUsd === null),
  priorAttemptsUsd: PRIOR_SPEND,
  runs: all.map((r) => ({ label: r.label, status: r.outcome.status, wallMs: r.wallMs, costUsd: r.outcome.usage.costUsd, costSource: r.outcome.usage.costSource, nativeSessionId: r.outcome.nativeSessionId, error: r.outcome.error, finalText: r.outcome.finalText.slice(0, 400) })),
  eventCounts: Object.fromEntries(all.map((r) => [r.label, countEvents(r.events)])),
  capabilities,
  notes: [
    `Compaction knob: env CLAUDE_CODE_AUTO_COMPACT_WINDOW=${AUTO_COMPACT_TOKENS} (spec.context.autoCompactTokens). Probed before the run with getContextUsage(): values below 100000 are raised to a 100000 window (autoCompactThreshold 67000); CLAUDE_AUTOCOMPACT_PCT_OVERRIDE did not change the reported threshold. Run 1 reads four ~20k-token corpus files to cross it.${r4 ? " Run 1 did not auto-compact, so run 4 sent /compact (manual) on its session." : ""}`,
    "Isolation: before the fix, a workspace under the user's home loaded ~/.claude/CLAUDE.md as Project memory (3657 tokens, getContextUsage().memoryFiles). The adapter now passes settings.claudeMdExcludes for every ancestor directory; the probe after the fix showed memoryFiles=[]. User skills (~/.claude/skills) were not loaded; bundled CLI skills are listed in init.",
    "Resume requires the same host.stateDir (CLAUDE_CONFIG_DIR holds the transcript). modelUsage on a resumed session continues from the transcript's saved totals, so per-run costUsd after resume may include the earlier run; the total here is a conservative sum.",
    `Qualification policy denied ${deniedPaths.length} path(s) (outside the workspace or under .claude/). Spend cap $${CAP_USD}; spent (known run outcomes + prior attempts) $${Math.round(spent * 1e6) / 1e6}.`,
    "Attempt 1 findings fixed in the adapter before this run: (a) CLI 2.1.312 defaults to TaskCreate/TaskUpdate and removes TodoWrite from the tool set even when listed, so the model could not plan (ToolSearch select:TodoWrite returned nothing) -> env CLAUDE_CODE_ENABLE_TASKS=false; (b) the interrupted turn's result reported total_cost_usd 0 with empty modelUsage after a tool_use had streamed -> now costUsd null / costSource unknown; (c) background helper output files were written to the user's %TEMP%\\claude and the main agent tried to Read them (denied) -> env CLAUDE_CODE_TMPDIR=<stateDir>/claude-tmp plus a prompt rule that helper results arrive as notifications; (d) the binary package has no entry point, so availability() falsely reported it missing -> resolve <pkg>/package.json.",
    `Workspace: ${relative(os.tmpdir(), root)} under os.tmpdir(). Expected counts: docs/alpha.txt ${words(ALPHA)} words, docs/beta.txt ${words(BETA)} words.`,
  ],
};
mkdirSync(join(pkgDir, "qualification"), { recursive: true });
writeFileSync(join(pkgDir, "qualification", "claude.json"), `${JSON.stringify(receipt, null, 2)}\n`);

// ---------------------------------------------------------------- fixture (keys/PII stripped, payloads trimmed)
const home = os.homedir();
const user = os.userInfo().username;
const scrubStr = (s: string): string => {
  let out = s;
  for (const [from, to] of [[ws, "<ws>"], [ws.split("\\").join("/"), "<ws>"], [ws.split("\\").join("\\\\"), "<ws>"], [root, "<root>"], [home, "<home>"]] as const) out = out.split(from).join(to);
  out = out.split(user).join("<user>").replace(/sk-[A-Za-z0-9_-]{12,}/g, "<redacted>");
  for (const k of [env.anthropicApiKey, env.openaiApiKey, env.googleApiKey, env.openrouterApiKey]) if (k) out = out.split(k).join("<redacted>");
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
};
const scrub = (v: unknown): unknown => (typeof v === "string" ? scrubStr(v) : Array.isArray(v) ? v.slice(0, 40).map(scrub) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) : v);
// Stream events are ~90% of the volume: keep only the first 80 text deltas (enough to exercise message.delta).
let deltasKept = 0;
const isTextDelta = (m: SDKMessage) => m.type === "stream_event" && m.event.type === "content_block_delta" && m.event.delta.type === "text_delta";
const fixture = natives
  .filter((n) => n.run === "main" && (n.m.type !== "stream_event" || (isTextDelta(n.m) && deltasKept++ < 80)))
  .map((n) => JSON.stringify(scrub(n.m)));
mkdirSync(join(pkgDir, "test", "fixtures"), { recursive: true });
writeFileSync(join(pkgDir, "test", "fixtures", "claude-native.jsonl"), `${fixture.join("\n")}\n`);
writeFileSync(join(root, "all-native.jsonl"), natives.map((n) => JSON.stringify({ run: n.run, m: scrub(n.m) })).join("\n"));

console.log(JSON.stringify({ costUsd: receipt.costUsd, capabilities: Object.fromEntries(Object.entries(capabilities).map(([k, v]) => [k, v.status])) }, null, 2));
console.log(`fixture: ${fixture.length} native messages; workspace ${root}`);
