/**
 * Pure translation of `codex app-server` notifications (pinned 0.165.0, v2
 * protocol, experimentalRawEvents on) into contract events. No I/O except the
 * injected hash function, so tests replay recorded JSONL deterministically.
 *
 * Identity: the main agent is the thread from thread/start|resume (agentId
 * undefined); every other thread is a sub-agent spawned by the collab tools and
 * its helperId/agentId is the child threadId Codex reports in receiverThreadIds.
 */
import type { EngineEventDraft, GoalItem, UsageTotals } from "../../contract.js";
import { emptyUsage, preview } from "../../contract.js";
import { priceUsage } from "../../pricing.js";
import type { RpcMessage } from "./rpc.js";

const RAW_CAP = 4000;
const MAX_TRACKED = 2000;
const MAX_THREADS = 200;

/** Collab tool names as the model calls them (CollabAgentTool -> function name). */
const COLLAB_NAMES: Record<string, string> = {
  spawnAgent: "spawn_agent",
  sendInput: "send_input",
  resumeAgent: "resume_agent",
  wait: "wait_agent",
  closeAgent: "close_agent",
};

/** Notifications that carry nothing the contract models (or are mirrored elsewhere). */
const IGNORED = new Set([
  "thread/status/changed",
  "thread/readState/changed",
  "thread/settings/updated",
  "thread/started",
  "turn/started",
  "turn/diff/updated",
  "serverRequest/resolved",
  "skills/changed",
  "account/updated",
  "account/login/completed",
  "account/rateLimits/updated",
  "remoteControl/status/changed",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "item/plan/delta",
  "item/mcpToolCall/progress",
  "thread/compacted", // deprecated twin of the contextCompaction item
  "mcpServer/startupStatus/updated",
]);

export interface TranslatorOptions {
  /** Node catalog family for a Node tool name, undefined when it is not a Node tool. */
  familyOf(name: string): string | undefined;
  /** Active skills Node knows about (absolute SKILL.md paths), for skill.loaded detection. */
  skills(): Array<{ name: string; path: string }>;
  hashFile?(absPath: string): string | undefined;
  /** Main model; helpers use the model their spawn reported. */
  model: string;
}

interface ThreadUsage {
  model: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  responses: number;
  /**
   * Increments of thread/tokenUsage totals during this run, used only when no
   * rawResponse/completed was seen (resumed threads). Totals are cumulative over
   * the thread's whole history, so only deltas count; the first update counts `last`.
   */
  fallback: Tokens & { requests: number };
  prevTotal?: Tokens;
}

interface Tokens {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

function tokens(b: Record<string, unknown> | undefined): Tokens {
  return { input: num(b?.inputTokens), cached: num(b?.cachedInputTokens), cacheWrite: num(b?.cacheWriteInputTokens), output: num(b?.outputTokens) };
}

interface ItemInfo {
  name: string;
  threadId: string;
  callId: string;
  /** Proxy call_tool resolves to the real Node tool name. */
  node: boolean;
}

interface HelperInfo {
  done: boolean;
  toolUses: number;
  lastText: string;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_TRACKED): void {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as K);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function contentText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items.map((c: { type?: string; text?: string }) => (c?.type === "inputText" ? c.text ?? "" : `[${c?.type}]`)).join("\n");
}

const GOAL_STATUS: Record<string, GoalItem["status"]> = {
  active: "active",
  paused: "pending",
  blocked: "blocked",
  usageLimited: "blocked",
  budgetLimited: "blocked",
  complete: "done",
};

const PLAN_STATUS: Record<string, GoalItem["status"]> = { pending: "pending", inProgress: "active", completed: "done" };

export function createTranslator(opts: TranslatorOptions) {
  let mainThreadId: string | undefined;
  let mainTurnId: string | undefined;
  const items = new Map<string, ItemInfo>();
  const helpers = new Map<string, HelperInfo>();
  const usage = new Map<string, ThreadUsage>();
  const searches = new Map<string, string>();
  const goalKeys = new Map<string, string>();
  const lastContext = new Map<string, number>();
  const compacting = new Map<string, { itemId: string; t0: number; pre: number; post?: number }>();
  const skillsLoaded = new Set<string>();
  let finalText = "";
  let lastText = "";
  let lastError: string | undefined;
  let mainTurn: { status: string; error?: string } | undefined;

  const agentOf = (threadId: unknown): string | undefined =>
    typeof threadId === "string" && threadId !== mainThreadId ? threadId : undefined;

  function threadUsage(threadId: string): ThreadUsage {
    let u = usage.get(threadId);
    if (!u) {
      u = { model: opts.model, input: 0, cached: 0, cacheWrite: 0, output: 0, responses: 0, fallback: { input: 0, cached: 0, cacheWrite: 0, output: 0, requests: 0 } };
      remember(usage, threadId, u, MAX_THREADS);
    }
    return u;
  }

  function totals(filter?: (threadId: string) => boolean): UsageTotals {
    const t = emptyUsage();
    let cost = 0;
    let priced = true;
    for (const [id, u] of usage) {
      if (filter && !filter(id)) continue;
      const src = u.responses > 0 ? u : u.fallback;
      // OpenAI input includes cache reads and writes (observed: input 9120, cacheWrite 9117); the contract counts them separately.
      const part = { inputTokens: Math.max(0, src.input - src.cached - src.cacheWrite), outputTokens: src.output, cacheReadTokens: src.cached, cacheWriteTokens: src.cacheWrite };
      t.inputTokens += part.inputTokens;
      t.outputTokens += part.outputTokens;
      t.cacheReadTokens += part.cacheReadTokens;
      t.cacheWriteTokens += part.cacheWriteTokens;
      t.modelTurns += u.responses > 0 ? u.responses : u.fallback.requests;
      const p = priceUsage(u.model, part);
      if (p.costUsd === null) priced = false;
      else cost += p.costUsd;
    }
    if (usage.size > 0 && priced) {
      t.costUsd = Math.round(cost * 1e6) / 1e6;
      t.costSource = "price-table";
    }
    return t;
  }

  function raw(nativeType: string, payload: unknown, agentId?: string): EngineEventDraft {
    return { type: "engine.raw", nativeType, payload: preview(payload, RAW_CAP), agentId };
  }

  function helperStarted(out: EngineEventDraft[], childId: string, item: Record<string, unknown>, sender: string | undefined) {
    if (helpers.has(childId) || childId === mainThreadId) return;
    remember(helpers, childId, { done: false, toolUses: 0, lastText: "" }, MAX_THREADS);
    const model = str(item.model) || undefined;
    if (model) threadUsage(childId).model = model;
    out.push({
      type: "helper.started",
      helperId: childId,
      parentId: agentOf(sender),
      description: (str(item.prompt) ?? "sub-agent").slice(0, 500),
      subagentType: "codex-collab",
      model,
      background: true,
    });
  }

  function toolName(item: Record<string, unknown>): { name: string; node: boolean; input: unknown } {
    switch (item.type) {
      case "commandExecution":
        return { name: "shell", node: false, input: { command: item.command, cwd: item.cwd } };
      case "fileChange":
        return { name: "apply_patch", node: false, input: { changes: (Array.isArray(item.changes) ? item.changes : []).map((c: { path?: string; kind?: unknown }) => ({ path: c?.path, kind: c?.kind })) } };
      case "mcpToolCall":
        return { name: `${item.server}.${item.tool}`, node: false, input: item.arguments };
      case "dynamicToolCall": {
        const args = item.arguments as { name?: unknown; arguments?: unknown } | undefined;
        if (item.tool === "call_tool" && typeof args?.name === "string") return { name: args.name, node: true, input: args.arguments };
        return { name: String(item.tool), node: opts.familyOf(String(item.tool)) !== undefined, input: item.arguments };
      }
      case "collabAgentToolCall":
        return { name: COLLAB_NAMES[String(item.tool)] ?? String(item.tool), node: false, input: { prompt: item.prompt, receivers: item.receiverThreadIds, model: item.model } };
      case "webSearch":
        return { name: "web_search", node: false, input: item.query ?? item.action };
      case "imageView":
        return { name: "view_image", node: false, input: { path: item.path } };
      default:
        return { name: String(item.type), node: false, input: item };
    }
  }

  function toolResult(item: Record<string, unknown>): { ok: boolean; preview: string; ms?: number } {
    const ms = typeof item.durationMs === "number" ? item.durationMs : undefined;
    switch (item.type) {
      case "commandExecution": {
        const ok = item.status === "completed" && item.exitCode === 0;
        const out = str(item.aggregatedOutput) ?? "";
        return { ok, preview: preview(item.status === "declined" ? "declined by Node policy" : `exit ${item.exitCode ?? "?"}: ${out}`), ms };
      }
      case "dynamicToolCall":
        return { ok: item.success === true, preview: preview(contentText(item.contentItems)), ms };
      case "mcpToolCall":
        return { ok: item.status === "completed" && !item.error, preview: preview(item.error ?? item.result), ms };
      case "collabAgentToolCall":
        return { ok: item.status === "completed", preview: preview(item.agentsStates), ms };
      default:
        return { ok: item.status === undefined || item.status === "completed", preview: preview(item.status ?? "done"), ms };
    }
  }

  /** A successful read of a known SKILL.md is the native skill load. */
  function skillLoads(item: Record<string, unknown>): string[] {
    if (item.type !== "commandExecution" || item.status !== "completed" || item.exitCode !== 0) return [];
    const actions = Array.isArray(item.commandActions) ? (item.commandActions as Array<{ type?: string; path?: string }>) : [];
    const haystack = `${str(item.command) ?? ""}\n${actions.map((a) => a?.path ?? "").join("\n")}`.replace(/\\\\/g, "\\").toLowerCase().replace(/\\/g, "/");
    return opts
      .skills()
      .filter((s) => {
        const p = s.path.toLowerCase().replace(/\\/g, "/");
        const tail = p.split("/").slice(-3).join("/"); // <skills-root>/<name>/SKILL.md suffix
        return haystack.includes(p) || haystack.includes(tail);
      })
      .map((s) => s.name);
  }

  function itemStarted(out: EngineEventDraft[], p: Record<string, any>) {
    const item = p.item as Record<string, unknown>;
    const agentId = agentOf(p.threadId);
    if (item.type === "contextCompaction") {
      remember(compacting, String(p.threadId), { itemId: String(item.id), t0: num(p.startedAtMs) || Date.now(), pre: lastContext.get(String(p.threadId)) ?? 0 }, MAX_THREADS);
      if (!agentId) out.push({ type: "run.status", status: "compacting", detail: "codex auto-compaction" });
      return;
    }
    if (["agentMessage", "userMessage", "reasoning", "plan", "hookPrompt", "enteredReviewMode", "exitedReviewMode", "subAgentActivity", "sleep"].includes(String(item.type))) return;
    const t = toolName(item);
    const callId = String(item.id);
    remember(items, callId, { name: t.name, threadId: String(p.threadId), callId, node: t.node });
    out.push({
      type: "tool.call",
      callId,
      name: t.name,
      family: t.node ? opts.familyOf(t.name) ?? "native" : "native",
      inputPreview: preview(t.input),
      native: !t.node,
      agentId,
    });
  }

  function itemCompleted(out: EngineEventDraft[], p: Record<string, any>) {
    const item = p.item as Record<string, unknown>;
    const threadId = String(p.threadId);
    const agentId = agentOf(threadId);
    switch (item.type) {
      case "agentMessage": {
        const text = str(item.text) ?? "";
        if (!text) return;
        out.push({ type: "message", role: "assistant", text, agentId });
        if (agentId) {
          const h = helpers.get(agentId);
          if (h) h.lastText = text;
        } else {
          lastText = text;
          if (item.phase === "final_answer") finalText = text;
        }
        return;
      }
      case "contextCompaction": {
        const c = compacting.get(threadId);
        compacting.delete(threadId);
        out.push({
          type: "context.compacted",
          trigger: "auto",
          preTokens: c?.pre ?? 0,
          postTokens: c?.post,
          durationMs: c ? Math.max(0, (num(p.completedAtMs) || Date.now()) - c.t0) : undefined,
          nativeRef: String(item.id),
          agentId,
        });
        if (!agentId) out.push({ type: "run.status", status: "running", detail: "compaction finished" });
        return;
      }
      case "userMessage":
      case "reasoning":
      case "hookPrompt":
        return;
      case "plan":
      case "subAgentActivity":
      case "enteredReviewMode":
      case "exitedReviewMode":
      case "sleep":
        out.push(raw(`item/${item.type}`, item, agentId));
        return;
    }
    const callId = String(item.id);
    if (!items.has(callId)) itemStarted(out, p); // completed without a started (resume replay)
    const r = toolResult(item);
    out.push({ type: "tool.result", callId, ok: r.ok, preview: r.preview, ms: r.ms, agentId });
    items.delete(callId);
    if (agentId) {
      const h = helpers.get(agentId);
      if (h) {
        h.toolUses++;
        out.push({ type: "helper.progress", helperId: agentId, lastTool: toolName(item).name, toolUses: h.toolUses });
      }
    }
    if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent" && item.status === "completed") {
      for (const child of Array.isArray(item.receiverThreadIds) ? (item.receiverThreadIds as string[]) : []) helperStarted(out, child, item, str(item.senderThreadId));
    }
    for (const name of skillLoads(item)) {
      const key = `${threadId}:${name}`;
      if (skillsLoaded.has(key)) continue;
      skillsLoaded.add(key);
      const s = opts.skills().find((x) => x.name === name);
      out.push({ type: "skill.loaded", name, sha256: s && opts.hashFile ? opts.hashFile(s.path) : undefined, via: "native", agentId });
    }
  }

  function rawItem(out: EngineEventDraft[], p: Record<string, any>) {
    const item = p.item as Record<string, any> | undefined;
    const agentId = agentOf(p.threadId);
    if (!item) return;
    if (item.type === "tool_search_call") {
      const callId = String(item.call_id ?? item.id);
      const query = String(item.arguments?.query ?? "");
      remember(searches, callId, query);
      out.push({ type: "tool.call", callId, name: "tool_search", family: "native", inputPreview: preview(item.arguments), native: true, agentId });
    } else if (item.type === "tool_search_output") {
      const callId = String(item.call_id ?? item.id);
      const names: string[] = [];
      for (const t of Array.isArray(item.tools) ? item.tools : []) {
        if (t?.type === "namespace" && Array.isArray(t.tools)) for (const x of t.tools) names.push(String(x?.name));
        else if (t?.name) names.push(String(t.name));
      }
      out.push({ type: "tool.result", callId, ok: item.status === "completed", preview: preview(names), agentId });
      out.push({ type: "tool.search", callId, query: searches.get(callId) ?? "", results: names, via: "native", agentId });
      if (names.length) out.push({ type: "tool.loaded", names, via: "native-tool-search", agentId });
      searches.delete(callId);
    }
  }

  function tokenUsage(p: Record<string, any>): EngineEventDraft[] {
    const threadId = String(p.threadId);
    const tu = p.tokenUsage ?? {};
    const last = tu.last ?? {};
    const total = tu.total ?? {};
    const u = threadUsage(threadId);
    const cur = tokens(total);
    const inc = u.prevTotal
      ? { input: cur.input - u.prevTotal.input, cached: cur.cached - u.prevTotal.cached, cacheWrite: cur.cacheWrite - u.prevTotal.cacheWrite, output: cur.output - u.prevTotal.output }
      : tokens(last);
    u.prevTotal = cur;
    if (inc.input > 0 || inc.output > 0) {
      u.fallback.input += Math.max(0, inc.input);
      u.fallback.cached += Math.max(0, inc.cached);
      u.fallback.cacheWrite += Math.max(0, inc.cacheWrite);
      u.fallback.output += Math.max(0, inc.output);
      u.fallback.requests++;
    }
    const used = num(last.totalTokens);
    const c = compacting.get(threadId);
    if (c) c.post = used;
    else lastContext.set(threadId, used);
    if (lastContext.size > MAX_THREADS) lastContext.delete(lastContext.keys().next().value as string);
    return [
      {
        type: "context.usage",
        usedTokens: used,
        windowTokens: typeof tu.modelContextWindow === "number" ? tu.modelContextWindow : undefined,
        // After compaction Codex reports the rebuilt context with zero request tokens: its own estimate.
        estimated: num(last.inputTokens) === 0,
        agentId: agentOf(threadId),
      },
    ];
  }

  function goals(p: Record<string, any>, list: GoalItem[], source: string): EngineEventDraft[] {
    const threadId = String(p.threadId);
    const key = `${source}:${JSON.stringify(list.map((g) => [g.title, g.status]))}`;
    if (goalKeys.get(threadId) === key) return []; // goal/updated also fires on every token tick
    remember(goalKeys, threadId, key, MAX_THREADS);
    return [{ type: "goals.updated", goals: list, source, agentId: agentOf(threadId) }];
  }

  function turnCompleted(out: EngineEventDraft[], p: Record<string, any>) {
    const threadId = String(p.threadId);
    const turn = p.turn ?? {};
    const agentId = agentOf(threadId);
    if (!agentId) {
      if (mainTurnId && turn.id !== mainTurnId) return; // a turn we did not start (e.g. manual compaction)
      const err = turn.error?.message ? String(turn.error.message) : undefined;
      mainTurn = { status: String(turn.status), error: err ?? (turn.status === "failed" ? lastError ?? "turn failed" : undefined) };
      if (!finalText) {
        const msgs = Array.isArray(turn.items) ? turn.items.filter((i: { type?: string }) => i?.type === "agentMessage") : [];
        finalText = str(msgs[msgs.length - 1]?.text) ?? lastText;
      }
      return;
    }
    const h = helpers.get(agentId);
    if (!h || h.done) return;
    h.done = true;
    const items = Array.isArray(turn.items) ? turn.items : [];
    const last = items.filter((i: { type?: string }) => i?.type === "agentMessage").pop();
    const sub = totals((id) => id === agentId);
    out.push({
      type: "helper.completed",
      helperId: agentId,
      status: turn.status === "completed" ? "completed" : turn.status === "interrupted" ? "stopped" : "failed",
      summary: (str(last?.text) ?? h.lastText ?? (turn.error?.message ? String(turn.error.message) : "")).slice(0, 2000),
      totalTokens: sub.inputTokens + sub.outputTokens + sub.cacheReadTokens + sub.cacheWriteTokens,
      toolUses: h.toolUses,
      durationMs: typeof turn.durationMs === "number" ? turn.durationMs : undefined,
    });
    out.push({ type: "usage", totals: sub, agentId });
  }

  return {
    setMainThread(threadId: string) {
      mainThreadId = threadId;
    },
    setMainTurn(turnId: string) {
      mainTurnId = turnId;
      mainTurn = undefined;
      finalText = "";
    },
    get mainThreadId() {
      return mainThreadId;
    },
    get mainTurnId() {
      return mainTurnId;
    },
    /** Set once the main turn reached turn/completed. */
    get mainTurn() {
      return mainTurn;
    },
    get finalText() {
      return finalText || lastText;
    },
    get lastError() {
      return lastError;
    },
    agentOf,
    usage: () => totals(),
    /** Helpers still running when the run ends are reported as stopped, never as completed. */
    stopUnfinishedHelpers(reason: string): EngineEventDraft[] {
      const out: EngineEventDraft[] = [];
      for (const [helperId, h] of helpers) {
        if (h.done) continue;
        h.done = true;
        out.push({ type: "helper.completed", helperId, status: "stopped", summary: `${reason}${h.lastText ? `: ${h.lastText.slice(0, 1500)}` : ""}`, toolUses: h.toolUses });
      }
      return out;
    },

    handle(msg: RpcMessage): EngineEventDraft[] {
      const out: EngineEventDraft[] = [];
      const method = msg.method;
      const p = (msg.params ?? {}) as Record<string, any>;
      if (!method || IGNORED.has(method)) return out;
      switch (method) {
        case "item/started":
          if (p.item) itemStarted(out, p);
          return out;
        case "item/completed":
          if (p.item) itemCompleted(out, p);
          return out;
        case "item/agentMessage/delta":
          if (!agentOf(p.threadId) && typeof p.delta === "string" && p.delta) out.push({ type: "message.delta", text: p.delta });
          return out;
        case "rawResponseItem/completed":
          rawItem(out, p);
          return out;
        case "rawResponse/completed": {
          const u = threadUsage(String(p.threadId));
          const x = p.usage ?? {};
          u.input += num(x.inputTokens);
          u.cached += num(x.cachedInputTokens);
          u.cacheWrite += num(x.cacheWriteInputTokens);
          u.output += num(x.outputTokens);
          u.responses++;
          return out;
        }
        case "thread/tokenUsage/updated":
          return tokenUsage(p);
        case "turn/plan/updated":
          return goals(
            p,
            (Array.isArray(p.plan) ? p.plan : []).slice(0, 200).map((s: { step?: string; status?: string }, i: number) => ({
              id: `plan-${i + 1}`,
              title: String(s?.step ?? ""),
              status: PLAN_STATUS[String(s?.status)] ?? "pending",
              claimedBy: "engine" as const,
            })),
            "codex:plan",
          );
        case "thread/goal/updated": {
          const g = p.goal ?? {};
          return goals(p, [{ id: "thread-goal", title: String(g.objective ?? ""), status: GOAL_STATUS[String(g.status)] ?? "pending", claimedBy: "engine" }], "codex:goal");
        }
        case "thread/goal/cleared":
          return goals(p, [], "codex:goal");
        case "turn/completed":
          turnCompleted(out, p);
          return out;
        case "error": {
          const text = String(p.error?.message ?? "codex error");
          if (!agentOf(p.threadId) && !p.willRetry) lastError = text;
          out.push(raw("error", p, agentOf(p.threadId)));
          return out;
        }
        default:
          // warning, configWarning, model/rerouted, unknown methods: kept for the developer drawer.
          out.push(raw(method, p, helpers.has(String(p.threadId)) ? String(p.threadId) : undefined));
          return out;
      }
    },
  };
}

export type CodexTranslator = ReturnType<typeof createTranslator>;
