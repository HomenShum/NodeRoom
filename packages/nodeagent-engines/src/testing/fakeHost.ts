/**
 * Test host for adapter qualification without the worker. Real provider env,
 * real tool execution for the definitions passed in, permissive-but-recorded
 * policy, events kept in memory. Not used by the product path.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type {
  EngineEventDraft,
  EngineHost,
  NodeToolDefinition,
  NodeToolGateway,
  PolicyGate,
  ProviderEnv,
  TemplateConfig,
} from "../contract.js";
import { preview } from "../contract.js";

export interface FakeHost extends EngineHost {
  events: EngineEventDraft[];
  controller: AbortController;
}

export function createFakeHost(opts: {
  env: ProviderEnv;
  stateDir: string;
  workspaceDir: string;
  tools?: NodeToolDefinition[];
  runId?: string;
  policy?: PolicyGate;
  echo?: boolean;
  template?: TemplateConfig;
}): FakeHost {
  mkdirSync(opts.stateDir, { recursive: true });
  const events: EngineEventDraft[] = [];
  const controller = new AbortController();
  const tools = opts.tools ?? [];
  let refresher: (() => Promise<void>) | undefined;
  let n = 0;
  const emit = (e: EngineEventDraft) => {
    events.push(e);
    if (opts.echo) console.log(`[${e.type}]`, preview(e, 240));
  };
  const gateway: NodeToolGateway = {
    list: () => tools,
    get: (name) => tools.find((t) => t.name === name),
    jsonSchema: (name) => {
      const t = tools.find((x) => x.name === name);
      return t ? (z.toJSONSchema(t.schema) as Record<string, unknown>) : { type: "object", properties: {} };
    },
    async call(name, args, scope) {
      const callId = scope.callId ?? `fake-${++n}`;
      const t0 = Date.now();
      const tool = tools.find((x) => x.name === name);
      if (!tool) return { callId, ok: false, content: `Unknown tool ${name}`, ms: 0 };
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) return { callId, ok: false, content: `Invalid arguments: ${parsed.error.message}`, ms: 0 };
      const result = await tool.execute(parsed.data, {
        runId: opts.runId ?? "fake-run",
        workspaceDir: opts.workspaceDir,
        nodeStateDir: join(opts.stateDir, "node-state"),
        template: opts.template ?? { id: "fake", title: "fake", description: "", restrictedGlobs: [], checks: {} },
        agentId: scope.agentId,
        signal: controller.signal,
        emit,
        refreshSkills: refresher,
      });
      return { ...result, callId, ms: Date.now() - t0 };
    },
    search(query, limit = 5) {
      const q = query.toLowerCase().split(/\W+/).filter(Boolean);
      return tools
        .map((t) => ({ t, score: q.filter((w) => `${t.name} ${t.description} ${t.searchHint ?? ""}`.toLowerCase().includes(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ t }) => ({ name: t.name, family: t.family, description: t.description }));
    },
    setSkillRefresher(fn) {
      refresher = fn;
    },
  };
  const policy: PolicyGate = opts.policy ?? {
    checkNativeTool: (name) => ({ allow: true, reason: `fake host allows ${name}` }),
  };
  return {
    events,
    controller,
    emit,
    tools: gateway,
    policy,
    signal: controller.signal,
    env: opts.env,
    stateDir: opts.stateDir,
    log: (m) => {
      if (opts.echo) console.log(`[log] ${m}`);
    },
  };
}

/** Count events by type, for qualification receipts. */
export function countEvents(events: EngineEventDraft[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

export function workspaceFor(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
