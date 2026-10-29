/**
 * The per-call pipeline every engine routes Node tools through: argument
 * validation, abort + timeout, size cap, and one NodeToolContext shape.
 * The gateway emits no tool.call/tool.result; adapters do (see contract).
 */
import { z } from "zod";
import type {
  EngineEventDraft,
  NodeToolDefinition,
  NodeToolGateway,
  TemplateConfig,
  ToolCallOutcome,
} from "../contract.js";
import { buildNodeToolCatalog, searchCatalog } from "./catalog.js";

export const TOOL_TIMEOUT_MS = 120_000;
export const MAX_TOOL_CONTENT = 20 * 1024;

export interface GatewayOptions {
  runId: string;
  workspaceDir: string;
  nodeStateDir: string;
  template: TemplateConfig;
  /** Engines with native Read/Write/shell get the catalog without Node's file duplicates. */
  nativeFileTools: boolean;
  signal: AbortSignal;
  emit(event: EngineEventDraft): void;
  /** Override the catalog (embedders with extra tools). */
  catalog?: NodeToolDefinition[];
  timeoutMs?: number;
}

function capContent(text: string): string {
  return text.length > MAX_TOOL_CONTENT ? `${text.slice(0, MAX_TOOL_CONTENT)}… [truncated ${text.length - MAX_TOOL_CONTENT} chars]` : text;
}

export function createGateway(opts: GatewayOptions): NodeToolGateway {
  const tools = opts.catalog ?? buildNodeToolCatalog({ nativeFileTools: opts.nativeFileTools });
  const byName = new Map(tools.map((t) => [t.name, t]));
  let refresher: (() => Promise<void>) | undefined;
  let n = 0;

  return {
    list: () => tools,
    get: (name) => byName.get(name),
    jsonSchema(name) {
      const t = byName.get(name);
      if (!t) throw new Error(`Unknown Node tool "${name}"`);
      return z.toJSONSchema(t.schema) as Record<string, unknown>;
    },
    async call(name, args, scope): Promise<ToolCallOutcome> {
      const callId = scope.callId ?? `node-${opts.runId}-${++n}`;
      const t0 = Date.now();
      const fail = (content: string): ToolCallOutcome => ({ callId, ok: false, content: capContent(content), ms: Date.now() - t0 });
      const tool = byName.get(name);
      if (!tool) return fail(`Unknown Node tool "${name}". Use tool search to find available tools.`);
      const parsed = tool.schema.safeParse(coerceArgs(tool.schema, args));
      if (!parsed.success) return fail(`Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`);
      if (opts.signal.aborted) return fail(`Run aborted before ${name} started`);

      const timeoutMs = opts.timeoutMs ?? TOOL_TIMEOUT_MS;
      const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]);
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(new Error(opts.signal.aborted ? `Run aborted during ${name}` : `${name} timed out after ${timeoutMs}ms`));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        const result = await Promise.race([
          tool.execute(parsed.data, {
            runId: opts.runId,
            workspaceDir: opts.workspaceDir,
            nodeStateDir: opts.nodeStateDir,
            template: opts.template,
            agentId: scope.agentId,
            signal,
            emit: opts.emit,
            refreshSkills: refresher,
          }),
          aborted,
        ]);
        return { ...result, content: capContent(String(result.content ?? "")), callId, ms: Date.now() - t0 };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    },
    search(query, limit = 5) {
      if (!/[a-z0-9]{2}/i.test(query)) return [];
      return searchCatalog(tools, query, limit).map((t) => ({ name: t.name, family: t.family, description: t.description }));
    },
    setSkillRefresher(fn) {
      refresher = fn;
    },
  };
}

/**
 * Models sometimes send a bare string (or a JSON string) where an object is expected
 * (observed: Codex helpers calling read_source "sources/x.md"). A JSON object string is
 * parsed; any other string fills the schema's first string field. Everything is still
 * validated by the zod schema afterwards.
 */
function coerceArgs(schema: z.ZodTypeAny, args: unknown): unknown {
  if (args === undefined || args === null) return {};
  if (typeof args !== "string") return args;
  const text = args.trim();
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (!shape) return args;
  const key = Object.keys(shape).find((k) => {
    const def = shape[k] as unknown as { unwrap?: () => z.ZodTypeAny };
    const inner = typeof def.unwrap === "function" ? def.unwrap() : shape[k];
    return inner instanceof z.ZodString;
  });
  return key ? { [key]: text } : args;
}
