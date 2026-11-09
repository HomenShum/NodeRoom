/**
 * Worker HTTP API shapes, shared by the worker and the NodeRoom workspace UI.
 * Type-only module: no runtime imports, so the UI can `import type` it.
 *
 * Routes (all JSON unless noted; the UI reaches them through the Vite proxy at /agent-api):
 *   GET  /api/health                         -> HealthResponse
 *   GET  /api/projects                       -> ProjectRecord[]
 *   POST /api/projects        CreateProjectRequest -> ProjectRecord
 *   GET  /api/projects/:id/files             -> FileEntry[]           (workspace tree, bounded)
 *   GET  /api/projects/:id/file?path=        -> FileContent           (bounded read)
 *   GET  /api/projects/:id/skills            -> SkillEntry[]
 *   GET  /api/tools                          -> ToolEntry[]           (Node catalog)
 *   GET  /api/runs?projectId=                -> RunRecord[]
 *   POST /api/runs            CreateRunRequest -> RunRecord           (persisted before 201)
 *   GET  /api/runs/:id                       -> RunRecord
 *   GET  /api/runs/:id/events?after=<seq>    -> text/event-stream; each SSE `id` is the event seq,
 *                                               `data` is a NodeAgentEvent; honours Last-Event-ID.
 *                                               A comment line `: heartbeat` every 15s.
 *   GET  /api/runs/:id/events.json?after=&limit= -> NodeAgentEvent[]  (paged, for tests/proof)
 *   POST /api/runs/:id/interrupt              -> RunRecord
 *   POST /api/runs/:id/resume  ResumeRequest  -> RunRecord           (same engine, native session)
 *   POST /api/runs/:id/message MessageRequest -> { accepted: boolean; reason?: string }
 *   POST /api/runs/:id/handoff HandoffRequest -> RunRecord           (new run on another engine)
 *   POST /api/runs/:id/verify                 -> VerificationReport   (independent checks)
 * Errors: non-2xx with { error: string }.
 */
import type {
  EngineAvailability,
  EngineDescriptor,
  EngineId,
  GoalItem,
  HandoffPacket,
  UsageTotals,
} from "./contract.js";

export interface HealthResponse {
  ok: true;
  worker: { version: string; startedAt: string; pid: number; home: string };
  engines: Array<{ descriptor: EngineDescriptor; availability: EngineAvailability }>;
  templates: Array<{ id: string; title: string; description: string; suggestedTasks?: Array<{ id: string; title: string; prompt: string }> }>;
}

export interface ProjectRecord {
  id: string;
  title: string;
  template: string;
  workspaceDir: string;
  createdAt: string;
}

export interface CreateProjectRequest {
  template: string;
  title?: string;
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export interface RunRecord {
  id: string;
  projectId: string;
  engine: EngineId;
  model: string;
  helperModel?: string;
  prompt: string;
  status: RunStatus;
  /** Runs this one continues (resume) or receives from (handoff). */
  parentRunId?: string;
  relation?: "resume" | "handoff";
  nativeSessionId?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  lastSeq: number;
  usage: UsageTotals;
  goals: GoalItem[];
  counters: RunCounters;
  finalText?: string;
  error?: string;
  budget: { maxUsd?: number; maxTurns?: number; maxWallMs?: number };
  context: { autoCompactTokens?: number };
  verification?: VerificationReport;
  handoff?: HandoffPacket;
}

/** Each counter has a unit; they are not interchangeable and not a quality score. */
export interface RunCounters {
  toolCalls: number;
  toolCallsOk: number;
  toolCallsFailed: number;
  nativeToolCalls: number;
  nodeToolCalls: number;
  toolSearches: number;
  toolsLoaded: number;
  skillsLoaded: number;
  skillLifecycleEvents: number;
  helpersStarted: number;
  helpersCompleted: number;
  compactions: number;
  artifactsWritten: number;
  uniqueFilesRead: number;
  checksRun: number;
  permissionDenials: number;
}

export interface CreateRunRequest {
  projectId: string;
  engine: EngineId;
  prompt: string;
  model?: string;
  helperModel?: string;
  budget?: { maxUsd?: number; maxTurns?: number; maxWallMs?: number };
  context?: { autoCompactTokens?: number };
}

export interface ResumeRequest {
  prompt?: string;
}

export interface MessageRequest {
  text: string;
}

export interface HandoffRequest {
  engine: EngineId;
  model?: string;
  prompt?: string;
}

export interface FileEntry {
  path: string;
  bytes: number;
  sha256: string;
  kind: string;
  modifiedAt: string;
}

export interface FileContent {
  path: string;
  bytes: number;
  truncated: boolean;
  text: string;
}

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  sha256: string;
  status: "active" | "draft";
  origin: "template" | "created";
}

export interface ToolEntry {
  name: string;
  family: string;
  risk: string;
  description: string;
  alwaysLoad: boolean;
}

export interface VerificationReport {
  ranAt: string;
  verifier: string;
  passed: number;
  failed: number;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
}
