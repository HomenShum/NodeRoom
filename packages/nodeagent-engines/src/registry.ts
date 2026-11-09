/**
 * Engine registry. Adapters are imported lazily so a missing or broken SDK
 * only disables its own engine, and reports why, instead of the worker.
 */
import type { Capability, EngineAdapter, EngineAvailability, EngineDescriptor, EngineId, ProviderEnv } from "./contract.js";

export const ENGINE_FACTORIES: Record<EngineId, () => Promise<EngineAdapter>> = {
  "claude-agent-sdk": async () => (await import("./engines/claude.js")).createClaudeAdapter(),
  "codex-app-server": async () => (await import("./engines/codex.js")).createCodexAdapter(),
  "openai-agents": async () => (await import("./engines/openaiAgents.js")).createOpenAIAgentsAdapter(),
  "google-adk": async () => (await import("./engines/googleAdk.js")).createGoogleAdkAdapter(),
  "nodeagent-universal": async () => (await import("./engines/universal.js")).createUniversalAdapter(),
};

const CAPABILITIES: Capability[] = [
  "start", "stream", "interrupt", "resume", "subagents", "childEventIdentity", "compaction",
  "toolSearch", "skillLoad", "skillRefresh", "goals", "permissions", "usage", "costUsd",
];

export interface EngineHealth {
  descriptor: EngineDescriptor;
  availability: EngineAvailability;
}

export interface EngineRegistry {
  ids(): EngineId[];
  has(id: string): id is EngineId;
  /** Throws with the import error message when the module cannot load. */
  load(id: EngineId): Promise<EngineAdapter>;
  health(env: ProviderEnv): Promise<EngineHealth[]>;
}

function unloadedDescriptor(id: EngineId): EngineDescriptor {
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((c) => [c, { status: "UNTESTED", note: "engine module failed to load" }]),
  ) as EngineDescriptor["capabilities"];
  return { id, label: id, sdk: { name: "unknown", version: "unknown" }, defaultModel: "", models: [], capabilities };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `injected` replaces the whole engine set (tests and embedders that ship
 * their own adapters); otherwise every built-in engine is lazily available.
 */
export function createEngineRegistry(injected?: EngineAdapter[]): EngineRegistry {
  const factories = new Map<EngineId, () => Promise<EngineAdapter>>();
  if (injected) for (const a of injected) factories.set(a.descriptor().id, async () => a);
  else for (const [id, f] of Object.entries(ENGINE_FACTORIES) as Array<[EngineId, () => Promise<EngineAdapter>]>) factories.set(id, f);
  const loaded = new Map<EngineId, Promise<EngineAdapter>>();

  const load = (id: EngineId): Promise<EngineAdapter> => {
    const f = factories.get(id);
    if (!f) return Promise.reject(new Error(`Unknown engine "${id}"`));
    let p = loaded.get(id);
    if (!p) {
      p = f();
      loaded.set(id, p);
      // A failed import is retried on the next call (e.g. after the SDK is installed).
      p.catch(() => loaded.delete(id));
    }
    return p;
  };

  return {
    ids: () => [...factories.keys()],
    has: (id: string): id is EngineId => factories.has(id as EngineId),
    load,
    async health(env) {
      return Promise.all(
        [...factories.keys()].map(async (id): Promise<EngineHealth> => {
          let adapter: EngineAdapter;
          try {
            adapter = await load(id);
          } catch (err) {
            return { descriptor: unloadedDescriptor(id), availability: { ok: false, missing: [`engine module failed to load: ${message(err)}`] } };
          }
          const descriptor = adapter.descriptor();
          try {
            return { descriptor, availability: await adapter.availability(env) };
          } catch (err) {
            return { descriptor, availability: { ok: false, missing: [`availability check failed: ${message(err)}`] } };
          }
        }),
      );
    },
  };
}
