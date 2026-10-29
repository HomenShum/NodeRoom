/**
 * Node run contract. One application-owned job, many native engines.
 *
 * Node (this package's worker) owns: run records, permissions, budgets, the
 * durable event log, the workspace boundary, the tool catalog, skill lifecycle
 * and independent verification. An engine adapter owns only its native turn
 * loop (subagents, compaction, tool search, sessions) and translates what it
 * natively emits into `EngineEventDraft`s. Adapters never write the store.
 */
import type { z } from "zod";

export const NODE_AGENT_EVENT_SCHEMA = "nodeagent.workspace-event/v1" as const;

export type EngineId =
  | "claude-agent-sdk"
  | "codex-app-server"
  | "openai-agents"
  | "google-adk"
  | "nodeagent-universal";

/** How a capability is provided on an engine. Proven per installed version. */
export type CapabilityStatus = "NATIVE" | "APP-IMPLEMENTED" | "UNSUPPORTED" | "UNTESTED";

export type Capability =
  | "start"
  | "stream"
  | "interrupt"
  | "resume"
  | "subagents"
  | "childEventIdentity"
  | "compaction"
  | "toolSearch"
  | "skillLoad"
  | "skillRefresh"
  | "goals"
  | "permissions"
  | "usage"
  | "costUsd";

export interface CapabilityEntry {
  status: CapabilityStatus;
  /** One line: which native API provides it, or what Node implements. */
  note: string;
}

export interface EngineDescriptor {
  id: EngineId;
  label: string;
  /** Installed SDK identity, read from the package at runtime. */
  sdk: { name: string; version: string };
  defaultModel: string;
  /** Cheaper model for helpers/subagents when the engine supports per-child models. */
  defaultHelperModel?: string;
  models: string[];
  capabilities: Record<Capability, CapabilityEntry>;
  /** Limits the engine applies when a run leaves them unset. Node resolves them onto the run record so they are disclosed. */
  defaults?: { maxTurns?: number; autoCompactTokens?: number };
}

export interface EngineAvailability {
  ok: boolean;
  /** Human-readable setup gaps, e.g. "ANTHROPIC_API_KEY is not set". Never secret values. */
  missing: string[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** `agentId` is undefined for the main agent, else the helper id (see helper.started). */
export interface EventScope {
  agentId?: string;
}

export interface GoalItem {
  id: string;
  title: string;
  status: "pending" | "active" | "done" | "blocked";
  /** Who asserted the status. Engine claims are never shown as verified. */
  claimedBy: "engine" | "node";
  dependsOn?: string[];
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** null when unknown; never 0 as a stand-in for unknown. */
  costUsd: number | null;
  costSource: "engine" | "price-table" | "unknown";
  modelTurns: number;
}

export interface HandoffPacket {
  schema: "nodeagent.handoff/v1";
  fromRunId: string;
  fromEngine: EngineId;
  originalPrompt: string;
  goals: GoalItem[];
  /** Workspace-relative paths with content hashes at handoff time. */
  artifacts: Array<{ path: string; sha256: string; bytes: number }>;
  checks: Array<{ checkId: string; command: string; ok: boolean; summary: string }>;
  /** Last assistant text from the prior engine, truncated. */
  lastSummary: string;
  /** Operations Node cannot prove completed. */
  unresolved: string[];
  createdAt: string;
}

export type EngineEventBody =
  | {
      type: "run.started";
      engine: EngineId;
      model: string;
      sdkVersion: string;
      nativeSessionId?: string;
      cwd: string;
      /** Tool names the engine reports as immediately callable. */
      tools: string[];
      /** Tool names reported as deferred behind search, when the engine says so. */
      deferredTools?: string[];
      skills: string[];
      helpers?: string[];
    }
  | { type: "run.status"; status: "running" | "compacting" | "waiting" | "requesting"; detail?: string }
  | ({ type: "message.delta"; text: string } & EventScope)
  | ({ type: "message"; role: "assistant" | "user"; text: string } & EventScope)
  | ({
      type: "tool.call";
      callId: string;
      name: string;
      /** Node catalog family when known ("workspace", "sources", "skills", ...), else "native". */
      family: string;
      /** Redacted, size-capped JSON preview. */
      inputPreview: string;
      native: boolean;
    } & EventScope)
  | ({ type: "tool.result"; callId: string; ok: boolean; preview: string; ms?: number } & EventScope)
  | ({ type: "tool.search"; callId?: string; query: string; results: string[]; via: "native" | "node" } & EventScope)
  | ({ type: "tool.loaded"; names: string[]; via: "native-tool-search" | "node-load-tool" } & EventScope)
  | ({ type: "skill.search"; query: string; results: string[]; via: "native" | "node" } & EventScope)
  | ({ type: "skill.loaded"; name: string; sha256?: string; via: "native" | "node" } & EventScope)
  | {
      type: "skill.lifecycle";
      name: string;
      stage: "drafted" | "validated" | "tested" | "activated" | "rejected";
      detail: string;
      path: string;
      sha256?: string;
    }
  | {
      type: "helper.started";
      helperId: string;
      parentId?: string;
      description: string;
      subagentType?: string;
      model?: string;
      background?: boolean;
    }
  | {
      type: "helper.progress";
      helperId: string;
      summary?: string;
      lastTool?: string;
      totalTokens?: number;
      toolUses?: number;
      durationMs?: number;
    }
  | {
      type: "helper.completed";
      helperId: string;
      status: "completed" | "failed" | "stopped";
      summary: string;
      totalTokens?: number;
      toolUses?: number;
      durationMs?: number;
    }
  | ({ type: "context.usage"; usedTokens: number; windowTokens?: number; estimated: boolean } & EventScope)
  | ({
      type: "context.compacted";
      trigger: "auto" | "manual";
      preTokens: number;
      postTokens?: number;
      durationMs?: number;
      /** Native identity of the compaction (boundary uuid, item id). */
      nativeRef?: string;
    } & EventScope)
  | ({ type: "goals.updated"; goals: GoalItem[]; source: string } & EventScope)
  | ({ type: "artifact.written"; path: string; kind: ArtifactKind; bytes: number; sha256: string; change: "created" | "modified" | "deleted" } & EventScope)
  | {
      type: "check.result";
      checkId: string;
      command: string;
      ok: boolean;
      passed: number;
      failed: number;
      durationMs: number;
      outputTail: string;
      /** true when Node ran it outside the worker's context (final verification). */
      independent: boolean;
    }
  | { type: "permission.decision"; tool: string; decision: "allow" | "deny"; reason: string; agentId?: string }
  | ({ type: "usage"; totals: UsageTotals } & EventScope)
  | { type: "handoff.packet"; packet: HandoffPacket }
  | { type: "run.completed"; finalText: string; usage: UsageTotals; nativeSessionId?: string }
  | { type: "run.failed"; error: string; usage?: UsageTotals; nativeSessionId?: string }
  | { type: "run.interrupted"; reason: string; usage?: UsageTotals; nativeSessionId?: string }
  /** Untranslated native message for the developer drawer. Truncated by the store. */
  | ({ type: "engine.raw"; nativeType: string; payload: string } & EventScope);

export type EngineEventType = EngineEventBody["type"];
export type EngineEventDraft = EngineEventBody;

export type ArtifactKind = "table" | "notebook" | "code" | "test" | "doc" | "skill" | "data" | "other";

/** Persisted form. `seq` is gap-free per run; `ts` is ISO wall clock. */
export type NodeAgentEvent = EngineEventBody & {
  schema: typeof NODE_AGENT_EVENT_SCHEMA;
  runId: string;
  seq: number;
  ts: string;
};

// ---------------------------------------------------------------------------
// Tools: the Node catalog every engine can reach
// ---------------------------------------------------------------------------

export type ToolRisk = "read" | "propose" | "write" | "exec";

export interface NodeToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  family: "workspace" | "sources" | "checks" | "skills" | "goals" | "tool-meta" | "notebook" | "citations";
  risk: ToolRisk;
  description: string;
  /** Short phrase used by native tool search hints. */
  searchHint?: string;
  /** Always callable without discovery. Everything else is deferred. */
  alwaysLoad?: boolean;
  schema: S;
  execute(args: z.infer<S>, ctx: NodeToolContext): Promise<NodeToolResult>;
}

export interface NodeToolResult {
  ok: boolean;
  /** Text returned to the model. Size-capped by the gateway. */
  content: string;
  /** Structured data for Node (e.g. check result id). Not sent to the model. */
  data?: Record<string, unknown>;
}

/**
 * A project template: starter workspace files plus Node-owned policy and checks.
 * Lives at fixtures/<id>/template.json; everything else in fixtures/<id>/ is copied
 * into a new project's workspace (template.json itself is not).
 */
export interface TemplateConfig {
  id: string;
  title: string;
  description: string;
  /** Workspace-relative globs Node refuses to expose to any engine (reads and writes). */
  restrictedGlobs: string[];
  /** Allowlisted check suites runnable via the run_checks tool. */
  checks: Record<string, { cwd: string; command: string[]; timeoutMs: number }>;
  /** Independent verifier path, relative to template.json. Runs outside the workspace and the worker's context. */
  verifier?: string;
  /**
   * verifierStage is passed to the verifier as --stage when a run (or the run it resumes)
   * was started from that task, so a task cannot be graded against an easier stage.
   */
  suggestedTasks?: Array<{ id: string; title: string; prompt: string; verifierStage?: string }>;
}

export interface NodeToolContext {
  runId: string;
  workspaceDir: string;
  /** Node-private per-project directory (skill ledger, check logs). Never inside the workspace. */
  nodeStateDir: string;
  template: TemplateConfig;
  agentId?: string;
  signal: AbortSignal;
  emit(event: EngineEventDraft): void;
  /** Set by the adapter when it can refresh native skill discovery (Claude reloadSkills, Codex skills/list). */
  refreshSkills?: () => Promise<void>;
}

export interface ToolCallOutcome extends NodeToolResult {
  callId: string;
  ms: number;
}

/**
 * The single per-call pipeline. Every engine routes Node tools through it, so
 * policy, events and size caps are identical across engines.
 */
export interface NodeToolGateway {
  /** All tools this run may see (already filtered by policy). */
  list(): NodeToolDefinition[];
  get(name: string): NodeToolDefinition | undefined;
  /** JSON Schema for a tool's input, generated from its zod schema. */
  jsonSchema(name: string): Record<string, unknown>;
  call(name: string, args: unknown, scope: { agentId?: string; callId?: string }): Promise<ToolCallOutcome>;
  /** App-implemented tool search over the catalog (engines without native search). */
  search(query: string, limit?: number): Array<{ name: string; family: string; description: string }>;
  /** Adapters register how to refresh native skill discovery after a skill is activated. */
  setSkillRefresher(refresh: () => Promise<void>): void;
}

export interface PolicyDecision {
  allow: boolean;
  reason: string;
}

/** Recheck at execution time, for native tools too (Bash, Write, shell, apply_patch...). */
export interface PolicyGate {
  checkNativeTool(name: string, input: unknown, scope: { agentId?: string }): PolicyDecision;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface RunSpec {
  runId: string;
  projectId: string;
  workspaceDir: string;
  prompt: string;
  model: string;
  helperModel?: string;
  budget: {
    maxUsd?: number;
    maxTurns?: number;
    /** Wall-clock cap enforced by Node via the abort signal. */
    maxWallMs?: number;
  };
  context: {
    /** Configured auto-compaction window in tokens (disclosed in the run manifest). */
    autoCompactTokens?: number;
  };
  /** Same-engine resume of a native session. */
  resume?: { nativeSessionId: string };
  /** Cross-engine transfer: the portable packet, never another engine's opaque state. */
  handoff?: HandoffPacket;
}

export interface EngineHost {
  emit(event: EngineEventDraft): void;
  tools: NodeToolGateway;
  policy: PolicyGate;
  /** Aborted on interrupt, wall-clock cap, or worker shutdown. */
  signal: AbortSignal;
  /** Provider credentials and settings, already normalized. Never logged. */
  env: ProviderEnv;
  /** Engine-private writable directory (sessions, CODEX_HOME, CLAUDE_CONFIG_DIR). */
  stateDir: string;
  log(message: string): void;
}

export interface ProviderEnv {
  anthropicApiKey?: string;
  /** Origin only, e.g. https://api.anthropic.com (a trailing /v1 is stripped). */
  anthropicBaseUrl?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  openrouterApiKey?: string;
}

export interface EngineRunOutcome {
  status: "completed" | "failed" | "interrupted";
  finalText: string;
  nativeSessionId?: string;
  usage: UsageTotals;
  error?: string;
}

export interface EngineRunHandle {
  done: Promise<EngineRunOutcome>;
  /** Cooperative interrupt; `done` resolves with status "interrupted". */
  interrupt(reason: string): Promise<void>;
  /** Steer a live run with a follow-up user message, when the engine supports mid-run input. */
  send?(text: string): Promise<void>;
}

export interface EngineAdapter {
  descriptor(): EngineDescriptor;
  availability(env: ProviderEnv): Promise<EngineAvailability>;
  start(spec: RunSpec, host: EngineHost): EngineRunHandle;
}

export function emptyUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    costSource: "unknown",
    modelTurns: 0,
  };
}

/** Size-capped JSON preview used for tool inputs/results in events. */
export function preview(value: unknown, max = 600): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = "";
  return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more chars]` : text;
}
