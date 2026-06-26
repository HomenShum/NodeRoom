/** Public/private Copilot chat surfaces. Reads via useStore(). */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Lock, MessageCircle, Globe, Send, Sparkles, Copy, Check, ArrowUpRight, Pencil, Paperclip, X, Timer, RefreshCw, ChevronDown, ChevronUp, ListChecks, GitBranch, ShieldCheck, Database, FileText, StickyNote, Table2 } from "lucide-react";
import { useQuery } from "convex/react";
import { useStore, CONVEX_SITE_URL, type AgentJobDetailTelemetry, type AgentModelSelection, type PrivateStreamAccess, type RoomStore } from "../app/store";
import { abortable, parseUploadedFiles, UPLOAD_TIMEOUT_MS } from "../app/uploadedArtifact";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { api } from "../../convex/_generated/api";
import type { Actor, Artifact, CellPayload, Channel, Message } from "../engine/types";
import { llmModelCatalog, resolveModelAlias, type LlmProvider } from "../nodeagent/models/modelCatalog";
import {
  displayArtifactRefMessage,
  encodeArtifactRefLine,
  hasDraggedArtifactRef,
  parseArtifactRefMessage,
  readDraggedArtifactRef,
  type ArtifactRef,
} from "./artifactRefs";
import { IntakePlanPreview } from "./IntakePlanPreview";
import { MarkdownBody } from "./MarkdownBody";

const AGENT_AVATAR_COLOR = "#8F3F27";
const COLORS = ["#8F3F27", "#315DA8", "#2F6B44", "#6D3FB2", "#80631F", "#A34B2E"];
function colorFor(store: RoomStore, roomId: string, a: Actor): string {
  if (a.kind === "agent") {
    // A personal agent (acting for a member) wears that member's color; the shared Room agent stays orange.
    if (a.ownerId) return store.listMembers(roomId).find((m) => m.id === a.ownerId)?.color ?? AGENT_AVATAR_COLOR;
    return AGENT_AVATAR_COLOR;
  }
  return store.listMembers(roomId).find((m) => m.id === a.id)?.color ?? COLORS[0];
}
function initials(name: string): string {
  return name.replace(/[^A-Za-z ]/g, "").split(/[ ]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}
const clock = (ts: number) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

type StreamStatus = "pending" | "streaming" | "done" | "error" | "timeout";
type StreamBody = { text: string; status: StreamStatus };
type PrivateStreamDriver = StreamBody & { started: boolean; listeners: Set<() => void> };

// BOUND (C1): the driver registry is a module-level singleton — it survives every component unmount
// AND room navigation, and each private agent reply mints a fresh streamId. Without a cap it grows
// for the life of the tab (memory leak under sustained agent use). We evict the oldest drivers that
// are FINISHED (terminal status) with no live listeners; active/streaming drivers and any with a
// mounted reader are never touched. The Map iterates in insertion order, so this is FIFO over idle.
const MAX_PRIVATE_STREAM_DRIVERS = 64;
const MAX_FAILED_SENDS = 50; // bound the per-room failed-send backlog (FIFO); see setFailedSends below
const STREAM_IDLE_MS = 60_000; // TIMEOUT gate: abort a private-reply stream that goes this long with no chunk
export const privateStreamDrivers = new Map<string, PrivateStreamDriver>();

function evictIdlePrivateStreamDrivers(): void {
  for (const [id, d] of privateStreamDrivers) {
    if (privateStreamDrivers.size <= MAX_PRIVATE_STREAM_DRIVERS) break;
    const terminal = d.status === "done" || d.status === "error" || d.status === "timeout";
    if (terminal && d.listeners.size === 0) privateStreamDrivers.delete(id);
  }
}

export function driverFor(streamId: string): PrivateStreamDriver {
  let driver = privateStreamDrivers.get(streamId);
  if (!driver) {
    driver = { text: "", status: "pending", started: false, listeners: new Set() };
    privateStreamDrivers.set(streamId, driver);
    if (privateStreamDrivers.size > MAX_PRIVATE_STREAM_DRIVERS) evictIdlePrivateStreamDrivers();
  }
  return driver;
}

function agentErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg && msg !== "[object Object]" ? `Agent request failed — ${msg}` : "Agent request failed. Try again.";
}

function notifyDriver(driver: PrivateStreamDriver, patch: Partial<StreamBody>) {
  Object.assign(driver, patch);
  for (const listener of driver.listeners) listener();
}

function startPrivateStreamDriver(streamUrl: URL | null, streamId: string, access: PrivateStreamAccess) {
  const driver = driverFor(streamId);
  if (driver.started) return;
  driver.started = true;
  if (!streamUrl) {
    notifyDriver(driver, { status: "error" });
    return;
  }
  void (async () => {
    // TIMEOUT gate: bound the spinner. An idle watchdog aborts the fetch if no chunk arrives within
    // STREAM_IDLE_MS (a stalled stream that never returns), surfacing the existing "timeout" status
    // instead of spinning forever. Re-armed on every read so an actively-streaming reply is never killed.
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
    };
    try {
      armWatchdog();
      const response = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId, requester: access.requester }),
        signal: controller.signal,
      });
      if (response.status === 205) {
        notifyDriver(driver, { status: "error" });
        return;
      }
      if (!response.ok || !response.body) {
        notifyDriver(driver, { status: "error" });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        armWatchdog();
        const text = decoder.decode(value, { stream: !done });
        if (text) notifyDriver(driver, { text: driver.text + text, status: "streaming" });
        if (done) {
          notifyDriver(driver, { status: "done" });
          return;
        }
      }
    } catch (e) {
      // A watchdog abort → honest "timeout" (wires the StreamedBody timeout branch); anything else → "error".
      const aborted = controller.signal.aborted || (e instanceof Error && e.name === "AbortError");
      notifyDriver(driver, { status: aborted ? "timeout" : "error" });
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  })();
}

function usePrivateReplyStream(streamId: string, access: PrivateStreamAccess | null): StreamBody {
  const streamUrl = useMemo(() => CONVEX_SITE_URL ? new URL(`${CONVEX_SITE_URL}/stream-private-reply`) : null, []);
  const [localBody, setLocalBody] = useState<StreamBody>({ text: "", status: "pending" });
  const driven = access?.driven ?? false;
  const requester = access?.requester;

  useEffect(() => {
    if (!driven || !requester) return;
    const driver = driverFor(streamId);
    const sync = () => setLocalBody({ text: driver.text, status: driver.status });
    driver.listeners.add(sync);
    sync();
    startPrivateStreamDriver(streamUrl, streamId, { requester, driven });
    return () => { driver.listeners.delete(sync); };
  }, [driven, requester?.actor.id, requester?.token, streamId, streamUrl]);

  const persistentBody = useQuery(
    api.streaming.getStreamBody,
    access && (!access.driven || localBody.status === "error")
      ? { streamId: streamId as StreamId, requester: access.requester }
      : "skip",
  );

  if (!access) return { text: "", status: "error" };
  if (localBody.status === "error" && persistentBody?.status === "pending") return localBody;
  return persistentBody ?? localBody;
}

/** Live body of a persistent-text-streaming message. The creating tab follows the component's
 * HTTP streaming path and drains the response; other tabs use the persisted chunk query. */
function StreamedBody({ streamId }: { streamId: string }) {
  const store = useStore();
  const { text, status } = usePrivateReplyStream(streamId, store.privateStreamAccess(streamId));
  const live = status === "pending" || status === "streaming";
  return (
    <MarkdownBody
      text={text}
      data-testid="stream-body"
      data-stream-status={status}
      cursor={live ? <span className="r-stream-cursor" aria-hidden>|</span> : null}
    >
      {status === "error" && <span className="tiny" style={{ color: "var(--danger-ink)" }}> - stream error (partial reply kept)</span>}
      {status === "timeout" && <span className="tiny" style={{ color: "var(--danger-ink)" }}> - stream timed out</span>}
    </MarkdownBody>
  );
}
const shortMs = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 6000) / 10}m` : `${Math.round(ms / 100) / 10}s`;
type OperationStreamRow = { sequence: number; kind: string; name: string; status: string; countDelta?: number; affectedIds?: string[] };
type AgentStreamPart = AgentJobDetailTelemetry["streamParts"][number];
function operationStreamText(op: OperationStreamRow): string {
  const affected = op.affectedIds?.length ? ` - ${op.affectedIds.slice(0, 3).join(", ")}` : "";
  const count = op.countDelta && op.countDelta > 1 ? ` x${op.countDelta}` : "";
  return `${op.kind}: ${op.name}${count}${affected}`;
}
function showInAgentOperationStream(op: OperationStreamRow): boolean {
  if (op.sequence >= 1_000) return true;
  return op.name === "agentJobs.start"
    || op.name === "agentJobs.createOrReuse"
    || op.name === "agentJobs.claimSlice"
    || op.name === "agentWorkflows.freeAutoWorkflow"
    || op.name === "agentJobRunner.runFreeAutoJobSlice"
    || op.name === "derive_room_intent"
    || op.name === "derive_free_auto_route"
    || op.name === "patch_bundle_cas";
}
function previewStreamValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const friendly = friendlyStreamPreview(value);
  if (friendly) return friendly;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const cleaned = text
    .replace(/\\"/g, "\"")
    .replace(/[{}[\]"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 96 ? `${cleaned.slice(0, 96)}...` : cleaned;
}

function friendlyStreamPreview(value: unknown): string {
  const parsed = parseStreamPreviewJson(value);
  if (Array.isArray(parsed)) {
    const artifactCount = parsed.filter((item) => item && typeof item === "object" && ("artifactId" in item || "id" in item)).length;
    if (artifactCount) return `${artifactCount} room artifact${artifactCount === 1 ? "" : "s"} returned`;
  }
  if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    const artifacts = Array.isArray(object.artifacts) ? object.artifacts : undefined;
    if (artifacts?.length) {
      const labels = Array.from(new Set(artifacts.map((artifact) => {
        const title = artifact && typeof artifact === "object" ? String((artifact as Record<string, unknown>).title ?? "") : "";
        return deliverableStreamLabel(title);
      }).filter(Boolean)));
      return `${artifacts.length} deliverable${artifacts.length === 1 ? "" : "s"} created${labels.length ? `: ${labels.join(", ")}` : ""}`;
    }
    if (typeof object.preview === "string") {
      const nested = parseStreamPreviewJson(object.preview);
      if (Array.isArray(nested)) return `${nested.length} row${nested.length === 1 ? "" : "s"} returned`;
      return object.kind === "string" ? "text result returned" : "tool result returned";
    }
    if (object.ok === true) return "completed";
    if (typeof object.error === "string") return object.error;
  }
  return "";
}

function parseStreamPreviewJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function deliverableStreamLabel(title: string): string {
  const lower = title.toLowerCase();
  if (lower.endsWith(".xlsx")) return "model";
  if (lower.endsWith(".xlsm")) return "macro workbook";
  if (lower.endsWith(".pptx")) return "deck";
  if (lower.endsWith(".docx")) return "memo";
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".json")) return "manifest";
  return "";
}
function toolStateLabel(part: Extract<AgentStreamPart, { type: `tool-${string}` }>): string {
  if (part.state === "call") return "running";
  if (part.status === "failed" || part.state === "output-denied") return "failed";
  return "done";
}
function isToolStreamPart(part: AgentStreamPart): part is Extract<AgentStreamPart, { type: `tool-${string}` }> {
  return part.type.startsWith("tool-");
}

function titleCaseToolName(toolName: string): string {
  return toolName
    .replace(/^tool-/, "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.length <= 3 ? word.toUpperCase() : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function agentActionLabel(toolName: string): string {
  switch (toolName) {
    case "list_artifacts": return "Gathered room files";
    case "read_range": return "Read source data";
    case "write_locked_cells": return "Updated Sheet 1";
    case "create_btb_deliverable_package": return "Created deliverables";
    case "search_sheet_context": return "Searched workbook context";
    case "fetch_source": return "Fetched source";
    case "capture_source_firecrawl": return "Captured source";
    case "load_skill": return "Loaded skill";
    case "say": return "Reported answer";
    case "create_artifact": return "Created artifact";
    case "update_artifact": return "Updated artifact";
    case "append_research_note": return "Added research note";
    default: return titleCaseToolName(toolName);
  }
}

function agentPartState(part: Exclude<AgentStreamPart, { type: "text" }>): string {
  if (isToolStreamPart(part)) return toolStateLabel(part);
  if (part.state === "failed") return "failed";
  if (part.state === "started" || part.state === "streaming") return "running";
  if (part.state === "skipped") return "skipped";
  return "done";
}

function agentPartLabel(part: Exclude<AgentStreamPart, { type: "text" }>): string {
  if (part.type === "step-start") return part.title;
  if (isToolStreamPart(part)) return agentActionLabel(part.toolName);
  if (part.type === "data-artifact") return "Published artifact";
  return part.title;
}

function agentPartPreview(part: Exclude<AgentStreamPart, { type: "text" }>): string {
  if (part.type === "step-start") return "";
  if (isToolStreamPart(part)) return previewStreamValue(part.output ?? part.input ?? part.error);
  if (part.type === "data-artifact") return part.title;
  return part.text || part.error || "";
}

function renderRawAgentPart(part: Exclude<AgentStreamPart, { type: "text" }>, index: number): ReactNode {
  if (part.type === "step-start") {
    return (
      <div className="r-agent-part step" key={`step-${part.step}-${index}`} data-part="step" data-status={part.state}>
        <ListChecks size={12} /><b>step {part.step + 1}</b><span>{part.title}</span>
      </div>
    );
  }
  if (isToolStreamPart(part)) {
    const state = toolStateLabel(part);
    const preview = previewStreamValue(part.output ?? part.input ?? part.error);
    return (
      <div className="r-agent-part tool" key={`${part.toolCallId}-${index}`} data-part="tool" data-status={state}>
        <Database size={12} /><b>{state}</b><span>{part.toolName}</span>{preview && <em>{preview}</em>}
      </div>
    );
  }
  if (part.type === "data-artifact") {
    return (
      <div className="r-agent-part artifact" key={`artifact-${index}`} data-part="artifact" data-status={part.state}>
        <Paperclip size={12} /><b>{part.state}</b><span>{part.title}</span>
      </div>
    );
  }
  return (
    <div className="r-agent-part notice" key={`notice-${index}`} data-part="notice" data-status={part.state}>
      <ShieldCheck size={12} /><b>{part.state}</b><span>{part.title}</span>{(part.text || part.error) && <em>{part.text || part.error}</em>}
    </div>
  );
}

type AgentProgressRow = {
  key: string;
  state: string;
  label: string;
  preview: string;
  count: number;
};

function compactAgentProgressRows(parts: Exclude<AgentStreamPart, { type: "text" }>[]): AgentProgressRow[] {
  const rows: AgentProgressRow[] = [];
  const seen = new Map<string, AgentProgressRow>();
  for (const part of parts) {
    if (part.type === "step-start") continue;
    const state = agentPartState(part);
    const label = agentPartLabel(part);
    const preview = agentPartPreview(part);
    const key = `${state}\u0000${label}\u0000${preview}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const row = { key, state, label, preview, count: 1 };
    rows.push(row);
    seen.set(key, row);
  }
  return rows;
}

function AgentProgressCard({ parts, live, terminalSuccessful }: { parts: Exclude<AgentStreamPart, { type: "text" }>[]; live?: boolean; terminalSuccessful?: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(() => parts.some((part) => agentPartState(part) === "failed"));
  const stepCount = parts.filter((part) => part.type === "step-start").length;
  const compactRows = compactAgentProgressRows(parts);
  const hiddenCount = Math.max(0, compactRows.length - 5);
  const rows = compactRows.slice(Math.max(0, compactRows.length - 5));
  const hasRecoveredFailure = !!terminalSuccessful && parts.some((part) => agentPartState(part) === "failed");
  const hasFailure = !terminalSuccessful && parts.some((part) => agentPartState(part) === "failed");
  const hasRunning = live || parts.some((part) => part.type !== "step-start" && agentPartState(part) === "running");
  const toolCount = parts.filter(isToolStreamPart).length;
  const title = hasFailure ? "NodeAgent needs attention" : hasRunning ? "NodeAgent is working" : hasRecoveredFailure ? "NodeAgent completed with recovered steps" : "NodeAgent completed the run";
  const metaBits = [
    stepCount ? `${stepCount} model turn${stepCount === 1 ? "" : "s"}` : undefined,
    toolCount ? `${toolCount} tool action${toolCount === 1 ? "" : "s"}` : undefined,
    hiddenCount ? `${hiddenCount} earlier` : undefined,
  ].filter(Boolean);
  return (
    <section className="r-agent-workflow-progress" data-testid="agent-progress-card" data-status={hasFailure ? "failed" : hasRunning ? "running" : "done"}>
      <div className="r-agent-workflow-progress-head">
        <span className="r-agent-workflow-progress-icon" aria-hidden>{hasFailure ? <X size={13} /> : hasRunning ? <RefreshCw size={13} /> : <Check size={13} />}</span>
        <div className="r-agent-workflow-progress-copy">
          <strong>{title}</strong>
          <span>{metaBits.join(" - ") || "Activity trace recorded"}</span>
        </div>
        <button
          type="button"
          className="r-agent-workflow-progress-toggle"
          data-testid="agent-progress-details-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          Trace details {detailsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      {rows.length ? (
        <div className="r-agent-workflow-progress-list">
          {rows.map((row, index) => {
            return (
              <div className="r-agent-workflow-progress-row" data-status={row.state} key={`${row.key}-${index}`}>
                <span className="r-agent-workflow-progress-dot" aria-hidden>{row.state === "done" ? <Check size={11} /> : row.state === "failed" ? <X size={11} /> : <RefreshCw size={11} />}</span>
                <span className="r-agent-workflow-progress-label">{row.label}{row.count > 1 ? <em>x{row.count}</em> : null}</span>
                {row.preview && <span className="r-agent-workflow-progress-preview">{row.preview}</span>}
              </div>
            );
          })}
        </div>
      ) : null}
      {detailsOpen ? (
        <div className="r-agent-workflow-progress-details" data-testid="agent-progress-details">
          {parts.map(renderRawAgentPart)}
        </div>
      ) : null}
    </section>
  );
}

function AgentUnifiedStream({ parts, live, fallbackText, terminalSuccessful }: { parts: AgentStreamPart[]; live?: boolean; fallbackText?: string; terminalSuccessful?: boolean }) {
  const displayParts = parts.length ? parts : fallbackText ? [{ type: "text" as const, text: fallbackText, state: live ? "streaming" as const : "done" as const }] : [];
  if (!displayParts.length) return null;
  const lastTextIndex = displayParts.map((part, index) => part.type === "text" ? index : -1).filter((index) => index >= 0).at(-1);
  const activityParts = displayParts.filter((part): part is Exclude<AgentStreamPart, { type: "text" }> => part.type !== "text");
  return (
    <div className="r-agent-unified-stream" data-testid="agent-unified-stream" aria-label="Unified agent response stream">
      {activityParts.length ? <AgentProgressCard parts={activityParts} live={live} terminalSuccessful={terminalSuccessful} /> : null}
      {displayParts.map((part, index) => {
        if (part.type === "text") {
          return (
            <MarkdownBody
              key={`text-${index}`}
              text={part.text}
              data-testid="agent-stream-text"
              data-stream-state={part.state}
              cursor={live && index === lastTextIndex ? <span className="r-stream-cursor" aria-hidden>|</span> : null}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
type ReasoningFrameRow = AgentJobDetailTelemetry["reasoningFrames"][number];
function framePrimaryText(frame: ReasoningFrameRow): string {
  if (frame.frameKind === "child") return `${frame.displayName ?? frame.phase}${frame.facet ? ` / ${frame.facet}` : ""}`;
  return frame.phase;
}
function frameSecondaryText(frame: ReasoningFrameRow): string {
  const bits = [
    frame.frameKind === "child" ? frame.cachePolicy : undefined,
    frame.toolAllowlist.length ? `${frame.toolAllowlist.length} tools` : undefined,
    frame.cacheKey,
  ].filter(Boolean);
  return bits.join(" - ");
}

const DEFAULT_NODEAGENT_GOAL = "Diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps.";
const NODEAGENT_PROMPTS = [
  { label: "@nodeagent diligence CardioNova", insert: "@nodeagent diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps" },
  { label: "@nodeagent runway gaps", insert: "@nodeagent prepare runway and milestone gaps for CardioNova and the batch watchlist" },
];
const SLASH_CMDS = [
  { label: "/demo multi-agent", insert: "/demo multi-agent startup diligence ", hint: "show startup-banking diligence queue lanes" },
];
const AGENT_MODEL_PROVIDER_ORDER: LlmProvider[] = ["openrouter", "anthropic", "openai", "gemini", "xai"];
const AGENT_MODEL_PROVIDER_LABELS: Record<LlmProvider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  xai: "xAI",
};
const AGENT_MODEL_PRESETS: Array<{ value: AgentModelSelection["mode"]; label: string }> = [
  { value: "adaptive", label: "Adaptive" },
  { value: "free", label: "Free" },
  { value: "top_paid", label: "Top paid" },
  { value: "specific", label: "Specific model" },
];

function hintForModelSelection(mode: AgentModelSelection["mode"]): string {
  switch (mode) {
    case "free": return "Routes NodeAgent through free-auto.";
    case "top_paid": return "Pins NodeAgent to the top paid route.";
    case "specific": return "Pins NodeAgent to an exact model policy.";
    default: return "Uses the adaptive NodeAgent route.";
  }
}

function parsePublicNodeAgentRequest(text: string): { goal: string; forceFree?: boolean } | null {
  const trimmed = text.trim();
  const mentionMatch = trimmed.match(/^@nodeagent(?:\s+|[:,-]\s*|$)/i);
  if (mentionMatch) {
    return { goal: trimmed.slice(mentionMatch[0].length).trim() || DEFAULT_NODEAGENT_GOAL };
  }
  if (/^\/ask\b/i.test(trimmed)) {
    return { goal: trimmed.replace(/^\/ask\s*/i, "").trim() || DEFAULT_NODEAGENT_GOAL };
  }
  if (/^\/free\b/i.test(trimmed)) {
    return { goal: trimmed.replace(/^\/free\s*/i, "").trim() || DEFAULT_NODEAGENT_GOAL, forceFree: true };
  }
  return null;
}

function isPublicNodeAgentDirective(text: string): boolean {
  return parsePublicNodeAgentRequest(text) !== null;
}

type DemoAgent = {
  id: string;
  name: string;
  scope: string;
  lane: string;
  color: string;
  startTick: number;
  doneTick: number;
  chunks: string[];
  commit: string;
};

type DemoGoldCase = {
  caseId: string;
  title: string;
  source: string;
  target: string;
  output: string;
  gold: string;
  evals: string[];
};

type DemoQueueItem = {
  label: string;
  startTick: number;
  doneTick: number;
};

type DemoProofItem = {
  label: string;
  value: string;
};

type DemoScenario = {
  eyebrow: string;
  title: string;
  lanes: string[];
  proofBoardLabel: string;
  queue: DemoQueueItem[];
  agents: DemoAgent[];
  claims: string[];
  cases: DemoGoldCase[];
  proof: DemoProofItem[];
};

const MULTI_AGENT_DEMO_MAX_TICK = 12;

const BENCHMARK_MULTI_AGENT_DEMO: DemoScenario = {
  eyebrow: "Public-gold work queue",
  title: "Three agents run public finance docs, exact gold checks, and no-clobber proof",
  lanes: ["child-job streams", "public source receipts", "CAS + eval gates"],
  proofBoardLabel: "Public gold proof board",
  queue: [
  { label: "Load public-gold manifest", startTick: 0, doneTick: 1 },
  { label: "Fan out TAT-DQA, FinanceBench, SEC", startTick: 1, doneTick: 3 },
  { label: "Stream source reads + tool receipts", startTick: 2, doneTick: 8 },
  { label: "Write CellPayloads through CAS", startTick: 6, doneTick: 10 },
  { label: "Run validators and seal handoff", startTick: 9, doneTick: 12 },
  ],
  agents: [
  {
    id: "agent-a",
    name: "Agent A",
    scope: "TAT-DQA PDF arithmetic",
    lane: "Owner token stream",
    color: "#7DD3FC",
    startTick: 1,
    doneTick: 9,
    chunks: [
      "Loaded public report page + OCR blocks.",
      "Claimed D7:D9 and evidence overlay.",
      "Extracted facts: 200,657 and 50,565.",
      "Wrote formula =200657-50565.",
      "Attached bbox/text refs to CellPayload.",
    ],
    commit: "D7 formula, 2 bbox refs, exact result",
  },
  {
    id: "agent-b",
    name: "Agent B",
    scope: "FinanceBench citation QA",
    lane: "Observer semantic chunks",
    color: "#A7F3D0",
    startTick: 2,
    doneTick: 10,
    chunks: [
      "Opened 3M_2018_10K benchmark row.",
      "Read cash-flow evidence page 59.",
      "Matched PP&E purchase line item.",
      "Answered $1,577.00 with citation.",
      "Queued QA memo + source page trace.",
    ],
    commit: "QA answer, page 59 citation, gold match",
  },
  {
    id: "agent-c",
    name: "Agent C",
    scope: "SEC XBRL + no-clobber",
    lane: "Artifact mutation stream",
    color: "#FDE68A",
    startTick: 3,
    doneTick: 12,
    chunks: [
      "Fetched Apple companyfacts snapshot.",
      "Filled revenue, net income, cash flow.",
      "Detected human note edit mid-run.",
      "Skipped stale write; issued review chip.",
      "Updated wiki TOC from verified evidence.",
    ],
    commit: "3 XBRL facts, 1 review chip, 1 wiki block",
  },
  ],
  claims: [
    "D7:D9 + PDF evidence claimed",
    "QA memo + source page claimed",
    "B12:D12 + wiki target claimed",
  ],
  cases: [
  {
    caseId: "tat-dqa-impairment-change",
    title: "TAT-DQA arithmetic proof",
    source: "Financial report PDF + OCR boxes",
    target: "D7",
    output: "=200657-50565 -> 150092 thousand",
    gold: "150092 thousand",
    evals: ["Formula AST PASS", "Value PASS", "Scale PASS", "bbox/text PASS"],
  },
  {
    caseId: "financebench_id_03029",
    title: "FinanceBench citation QA",
    source: "3M_2018_10K, page 59",
    target: "QA memo",
    output: "FY2018 capex = $1,577.00",
    gold: "$1577.00",
    evals: ["Answer PASS", "Evidence page PASS", "PP&E citation PASS"],
  },
  {
    caseId: "sec-aapl-fy2023-xbrl",
    title: "SEC XBRL watchlist fill",
    source: "AAPL 2023 10-K companyfacts",
    target: "B12:D12",
    output: "Revenue 383.285B; NI 96.995B; CFO 110.543B",
    gold: "Accession 0000320193-23-000106",
    evals: ["Digit PASS", "Unit PASS", "Period PASS", "filing PASS"],
  },
  {
    caseId: "noderoom-no-clobber-overlay",
    title: "Collaboration safety overlay",
    source: "Room trace + cell versions",
    target: "Human-owned note",
    output: "stale write rejected; review chip filed",
    gold: "human edit preserved",
    evals: ["CAS PASS", "Lease PASS", "Trace PASS", "Privacy PASS"],
  },
  ],
  proof: [
    { label: "Public gold", value: "4/4 cases validated" },
    { label: "No clobber", value: "human edit preserved" },
    { label: "Evidence", value: "page, bbox, XBRL refs present" },
    { label: "Runtime", value: "3 child jobs, 1 sealed handoff" },
  ],
};

const STARTUP_DILIGENCE_DEMO: DemoScenario = {
  eyebrow: "Startup diligence work queue",
  title: "Three agents turn live banking asks into a cited diligence package",
  lanes: ["company intake stream", "source-backed CellPayloads", "review + handoff gates"],
  proofBoardLabel: "Diligence proof board",
  queue: [
    { label: "Normalize CardioNova intake + five-company batch", startTick: 0, doneTick: 2 },
    { label: "Fan out research, finance runway, and source QA", startTick: 1, doneTick: 4 },
    { label: "Stream source reads, claims, and tool receipts", startTick: 2, doneTick: 8 },
    { label: "Write cited cells, chart artifact, and open questions", startTick: 6, doneTick: 10 },
    { label: "Rebase around human edit and seal handoff", startTick: 9, doneTick: 12 },
  ],
  agents: [
    {
      id: "startup-research",
      name: "Research Agent",
      scope: "CardioNova + batch diligence",
      lane: "Company source stream",
      color: "#7DD3FC",
      startTick: 1,
      doneTick: 9,
      chunks: [
        "Parsed intake: CardioNova, AI triage for hospitals.",
        "Claimed company rows and source-ref columns.",
        "Compared five-company startup banking watchlist.",
        "Wrote ICP, signal, competitors, and freshness cells.",
        "Attached source refs to every CellPayload.",
      ],
      commit: "6 company rows, 18 cited cells, 0 duplicate imports",
    },
    {
      id: "startup-finance",
      name: "Finance Agent",
      scope: "Runway and milestone chart",
      lane: "Deterministic finance tool",
      color: "#A7F3D0",
      startTick: 2,
      doneTick: 10,
      chunks: [
        "Read cash and burn assumptions from the sheet.",
        "Computed runway with deterministic math.",
        "Generated financing-risk status and milestone ticks.",
        "Drafted partner questions for top two companies.",
        "Queued chart artifact with assumption provenance.",
      ],
      commit: "runway chart, 2 milestone packs, assumptions cited",
    },
    {
      id: "startup-review",
      name: "Review Agent",
      scope: "No-clobber + handoff",
      lane: "Artifact mutation stream",
      color: "#FDE68A",
      startTick: 3,
      doneTick: 12,
      chunks: [
        "Detected analyst edit on the diligence sheet.",
        "Skipped stale write and filed a cell-local proposal.",
        "Updated workplan and open questions from verified evidence.",
        "Kept private concerns in the owner lane.",
        "Prepared Gmail, Notion, Slack, Linear, LinkedIn, and CRM drafts.",
      ],
      commit: "1 review chip, private lane preserved, drafts only",
    },
  ],
  claims: [
    "CardioNova row + batch watchlist claimed",
    "Runway chart + milestone questions claimed",
    "Human edit + downstream drafts protected",
  ],
  cases: [
    {
      caseId: "startup-cardionova-intake",
      title: "Singular company intake",
      source: "User call note + public company sources",
      target: "Company research row",
      output: "CardioNova: AI triage for hospitals; watchlist added",
      gold: "No duplicate row; source refs required",
      evals: ["Entity PASS", "Upsert PASS", "Source refs PASS"],
    },
    {
      caseId: "startup-bulk-five",
      title: "Bulk company diligence",
      source: "Startup banking list",
      target: "Research sheet",
      output: "Five companies enriched with ICP, signal, competitor, owner",
      gold: "5/5 rows complete",
      evals: ["Coverage PASS", "Freshness PASS", "CellPayload PASS"],
    },
    {
      caseId: "startup-runway-milestone",
      title: "Runway / milestone chart",
      source: "Cash, burn, and milestone assumptions",
      target: "Chart artifact",
      output: "Runway status + milestone ticks for top two targets",
      gold: "formula-driven, no guessed cash",
      evals: ["Math PASS", "Assumptions PASS", "Chart spec PASS"],
    },
    {
      caseId: "startup-no-clobber-handoff",
      title: "Collaboration safety + handoff",
      source: "Room trace + cell versions + private lane",
      target: "Proposal + drafts",
      output: "human edit preserved; downstream drafts require approval",
      gold: "no silent overwrite or OAuth side effect",
      evals: ["CAS PASS", "Privacy PASS", "Draft-only PASS"],
    },
  ],
  proof: [
    { label: "Sources", value: "18 cited cells" },
    { label: "No clobber", value: "human edit preserved" },
    { label: "Artifacts", value: "sheet, chart, workplan" },
    { label: "Handoff", value: "6 approval-gated drafts" },
  ],
};

function scenarioForDemoPrompt(prompt: string): DemoScenario {
  return /benchmark|public-gold|tat-dqa|financebench|sec\s+xbrl/i.test(prompt)
    ? BENCHMARK_MULTI_AGENT_DEMO
    : STARTUP_DILIGENCE_DEMO;
}

type ChatProps = {
  roomId: string;
  me: Actor;
  channel: Channel;
  variant: "public" | "private";
  agentName: string;
  activeArtifactId?: string;
  style?: CSSProperties;
  onOpenArtifact?: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
  coach?: ReactNode;
  embedded?: boolean;
  testId?: string;
};

export function Chat({ roomId, me, channel, variant, agentName, activeArtifactId, style, onOpenArtifact, coach, embedded = false, testId }: ChatProps) {
  const store = useStore();
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<ArtifactRef[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // @-mention typeahead (matches Cursor/Notion): type @ to attach a room artifact as a reference.
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [failedSends, setFailedSends] = useState<Array<{ cid: string; text: string }>>([]);
  const [jobBusy, setJobBusy] = useState<null | "cancel" | "retry">(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [agentErr, setAgentErr] = useState<string | null>(null); // C7/C2: honest surface for failed agent dispatches
  const [refOpenErr, setRefOpenErr] = useState<string | null>(null);
  const [roomLane, setRoomLane] = useState(false); // private panel: false = whisper to me, true = act in the room
  const [modelSelectionMode, setModelSelectionMode] = useState<AgentModelSelection["mode"]>("adaptive");
  const [specificModelPolicy, setSpecificModelPolicy] = useState("");
  const [multiAgentDemoStarted, setMultiAgentDemoStarted] = useState(false);
  const [multiAgentScenario, setMultiAgentScenario] = useState<DemoScenario>(STARTUP_DILIGENCE_DEMO);
  const [multiAgentTick, setMultiAgentTick] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadBusyRef = useRef(false);
  const nearBottom = useRef(true);
  const thinkingStartCount = useRef(0);
  // Room-switch safety: a public @nodeagent or private-agent call is fire-and-forget. If the user leaves this room
  // before it resolves, the server action still finishes on its OWN room (every mutation is roomId-scoped,
  // so no cross-room bleed) — but the client must NOT setState or post into an unmounted/stale channel.
  // aliveRef gates those; privTimerRef cancels the memory-mode reply timer on unmount.
  const aliveRef = useRef(true);
  const privTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; if (privTimerRef.current) clearTimeout(privTimerRef.current); };
  }, []);
  const messages = store.listMessages(roomId, channel);
  const isPrivate = variant === "private";
  const longJob = isPrivate ? null : store.lastLongFreeJob();
  const longJobAttempts = isPrivate ? [] : store.lastLongFreeJobAttempts();
  const longJobDetail = isPrivate ? null : store.lastLongFreeJobDetail();
  const hasQ3DemoSeed = !isPrivate && store.listArtifacts(roomId).some((a) => a.kind === "sheet" && a.title === "Q3 variance");
  const activeArtifact = useMemo(() => {
    if (!activeArtifactId || isPrivate) return undefined;
    return store.listArtifacts(roomId).find((a) => a.id === activeArtifactId);
  }, [activeArtifactId, isPrivate, roomId, store]);
  const contextualPrompts = useMemo(() => {
    if (!activeArtifact) return NODEAGENT_PROMPTS;
    const title = activeArtifact.title ?? "";
    const kind = activeArtifact.kind;
    if (kind === "sheet" && /runway|milestone/i.test(title)) {
      return [
        { label: "@nodeagent populate runway", insert: "@nodeagent calculate runway, burn, milestone risk, and evidence links for the batch" },
        { label: "@nodeagent find evidence gaps", insert: "@nodeagent identify missing cash, burn, and funding proof in the runway sheet" },
      ];
    }
    if (kind === "sheet" && /company|research/i.test(title)) {
      return [
        { label: "@nodeagent enrich companies", insert: "@nodeagent enrich selected companies with source-backed product, buyer, and funding facts" },
        { label: "@nodeagent diligence CardioNova", insert: "@nodeagent diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps" },
      ];
    }
    if (kind === "note" && /diligence|memo/i.test(title)) {
      return [
        { label: "@nodeagent draft memo", insert: "@nodeagent draft the diligence memo with sourced findings and gap analysis" },
        { label: "@nodeagent review memo", insert: "@nodeagent review the diligence memo for missing evidence and banker-ready follow-ups" },
      ];
    }
    if (kind === "wall") {
      return [
        { label: "@nodeagent organize wall", insert: "@nodeagent organize the wall captures by risk level and assign follow-up owners" },
        { label: "@nodeagent diligence CardioNova", insert: "@nodeagent diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps" },
      ];
    }
    return NODEAGENT_PROMPTS;
  }, [activeArtifact]);
  const emptyStateHint = useMemo(() => {
    if (!activeArtifact) return "Ask the room agent to work on the seeded model.";
    const title = activeArtifact.title ?? "";
    const kind = activeArtifact.kind;
    if (kind === "sheet" && /runway|milestone/i.test(title)) return "Ask NodeAgent to calculate runway, burn, and milestone risks.";
    if (kind === "sheet" && /company|research/i.test(title)) return "Ask NodeAgent to enrich companies with sourced facts.";
    if (kind === "note" && /diligence|memo/i.test(title)) return "Ask NodeAgent to draft or review the diligence memo.";
    if (kind === "wall") return "Pick an artifact or ask NodeAgent to organize the wall.";
    return "Ask the room agent to work on the seeded model.";
  }, [activeArtifact]);
  const showModelSelection = !isPrivate && store.mode === "convex";
  const specificModelGroups = useMemo(() => AGENT_MODEL_PROVIDER_ORDER
    .map((provider) => ({
      provider,
      label: AGENT_MODEL_PROVIDER_LABELS[provider],
      models: Array.from(new Set((llmModelCatalog[provider]?.agent ?? []).map((model) => resolveModelAlias(model.trim())))),
    }))
    .filter((group) => group.models.length > 0), []);
  const defaultSpecificModel = specificModelGroups[0]?.models[0] ?? "";
  const slashOptions = useMemo(() => SLASH_CMDS.filter((c) => store.mode === "memory" || c.label !== "/demo multi-agent"), [store.mode]);
  type MentionItem =
    | { kind: "agent"; key: string; label: string; hint: string }
    | { kind: "artifact"; key: string; label: string; hint: string; ref: ArtifactRef };
  const mentionMatches = useMemo<MentionItem[]>(() => {
    if (!mention) return [];
    const q = mention.q.toLowerCase();
    const items: MentionItem[] = [];
    // The room agent is addressable only as a LEADING "@nodeagent …" directive (parsePublicNodeAgentRequest),
    // so surface it only when the @ opens the message — unifying it with the artifact picker on one @ menu.
    if (!isPrivate && mention.start === 0 && "nodeagent".includes(q)) {
      items.push({ kind: "agent", key: "__nodeagent__", label: "nodeagent", hint: "Ask the room agent" });
    }
    const already = new Set(refs.map((r) => r.id));
    for (const a of store.listArtifacts(roomId)) {
      if (already.has(a.id) || (q !== "" && !a.title.toLowerCase().includes(q))) continue;
      items.push({ kind: "artifact", key: a.id, label: a.title, hint: a.kind, ref: { id: a.id, title: a.title, kind: a.kind } });
      if (items.length >= 7) break;
    }
    return items;
  }, [mention, refs, roomId, store, isPrivate]);
  const latestAttempt = longJobAttempts.at(-1);
  const canCancelLongJob = !!longJob && !["completed", "failed", "blocked", "cancelled"].includes(longJob.status);
  const canRetryLongJob = !!longJob && ["failed", "blocked", "cancelled", "paused"].includes(longJob.status);
  const longJobTerminal = !!longJob && ["completed", "failed", "blocked", "cancelled"].includes(longJob.status);
  const longJobActive = !!longJob && !longJobTerminal;
  const agentWorking = thinking || (!isPrivate && longJobActive);
  const unifiedStreamParts = (!isPrivate ? longJobDetail?.streamParts ?? [] : []) as AgentStreamPart[];
  const activeJobClientMsgId = !isPrivate && longJob ? `pubstream-${longJob.id}` : "";
  const hasActiveJobStreamMessage = !!activeJobClientMsgId && messages.some((m) => m.clientMsgId === activeJobClientMsgId);
  const liveOperationStream = (!isPrivate && agentWorking ? (longJobDetail?.operations ?? []).filter(showInAgentOperationStream).slice(-4) : []) as OperationStreamRow[];
  const longJobResultText = !isPrivate && longJobTerminal
    ? (longJob.finalText || (["failed", "blocked"].includes(longJob.status) && longJob.error ? `Agent job ${longJob.status}: ${longJob.error}` : ""))
    : "";
  const longJobVisibleError = !isPrivate && longJob && longJob.status !== "completed" ? longJob.error : "";
  const hasLongJobResultMessage = !!longJobResultText && messages.some((m) => m.author.kind === "agent" && (m.text.trim() === longJobResultText.trim() || m.clientMsgId === activeJobClientMsgId));
  const showLongJobResult = !!longJobResultText && !hasLongJobResultMessage;
  const longJobNeedsAttention = !!longJob && ["failed", "blocked", "cancelled"].includes(longJob.status);
  const showLongJobChrome = !!longJob && (!longJobTerminal || longJobNeedsAttention || jobDetailsOpen);
  const showAgentWorkingBubble = agentWorking && (!hasActiveJobStreamMessage || unifiedStreamParts.length === 0);
  const feedItems = useMemo(() => {
    const items: Array<
      | { kind: "message"; key: string; createdAt: number; message: Message }
      | { kind: "jobResult"; key: string; createdAt: number; status: string; text: string; streamParts: AgentStreamPart[] }
    > = messages.map((message) => ({
      kind: "message" as const,
      key: `msg-${message.clientMsgId || message.id}`,
      createdAt: message.createdAt,
      message,
    }));
    if (showLongJobResult && longJob) {
      items.push({
        kind: "jobResult" as const,
        key: `job-result-${longJob.id}`,
        createdAt: longJob.updatedAt,
        status: longJob.status,
        text: longJobResultText,
        streamParts: unifiedStreamParts,
      });
    }
    return items.sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
  }, [longJob, longJobResultText, messages, showLongJobResult, unifiedStreamParts]);
  const showEmptyState = messages.length === 0 && failedSends.length === 0 && !showLongJobResult && !showAgentWorkingBubble;
  const beginThinking = () => { thinkingStartCount.current = messages.length; setAgentErr(null); setThinking(true); };

  useEffect(() => { const el = feedRef.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight; }, [messages.length, agentWorking, liveOperationStream.length, unifiedStreamParts.length, multiAgentDemoStarted, multiAgentTick]);
  useEffect(() => {
    setMultiAgentDemoStarted(false);
    setMultiAgentScenario(STARTUP_DILIGENCE_DEMO);
    setMultiAgentTick(0);
  }, [roomId, channel]);
  useEffect(() => {
    if (!multiAgentDemoStarted) return;
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setInterval(() => {
      setMultiAgentTick((tick) => Math.min(MULTI_AGENT_DEMO_MAX_TICK, tick + 1));
    }, prefersReducedMotion ? 1 : 650);
    return () => window.clearInterval(timer);
  }, [multiAgentDemoStarted]);
  useEffect(() => {
    if (!thinking) return;
    if (messages.slice(thinkingStartCount.current).some((m) => m.author.kind === "agent")) setThinking(false);
  }, [messages, thinking]);
  useEffect(() => {
    if (!thinking || isPrivate || !longJobTerminal) return;
    setThinking(false);
  }, [isPrivate, longJobTerminal, thinking]);
  useEffect(() => {
    setJobDetailsOpen(false);
    setJobErr(null);
    setJobBusy(null);
  }, [roomId, channel, longJob?.id]);
  useEffect(() => {
    if (!longJobTerminal || longJobNeedsAttention) return;
    setJobDetailsOpen(false);
  }, [longJobNeedsAttention, longJobTerminal]);
  useEffect(() => {
    if (!specificModelPolicy && defaultSpecificModel) setSpecificModelPolicy(defaultSpecificModel);
  }, [defaultSpecificModel, specificModelPolicy]);
  const onScroll = () => { const el = feedRef.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const grow = () => { const el = taRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; } };

  const send = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t && refs.length === 0) return;
    const messageRefs = refs;
    const messageText = refs.length ? `${encodeArtifactRefLine(refs)}${t ? "\n\n" + t : ""}` : t;
    const cid = crypto.randomUUID();
    void store.postMessage({ roomId, channel, author: me, text: messageText, clientMsgId: cid, kind: "chat" })
      .then((fb) => { if (fb && !fb.ok) setFailedSends((f) => { if (f.some((x) => x.cid === cid)) return f; const next = [...f, { cid, text: messageText }]; return next.length > MAX_FAILED_SENDS ? next.slice(-MAX_FAILED_SENDS) : next; }); });
    setText(""); setRefs([]); setSlashOpen(false); setSlashIndex(0); setMention(null); setMentionIndex(0);
    requestAnimationFrame(grow);

    if (!isPrivate && store.mode === "memory" && /^\/demo\s+multi-agent\b/i.test(t)) {
      setMultiAgentTick(0);
      setMultiAgentScenario(scenarioForDemoPrompt(t));
      setMultiAgentDemoStarted(true);
      return;
    }

    const publicNodeAgentRequest = !isPrivate ? parsePublicNodeAgentRequest(t) : null;
    if (publicNodeAgentRequest) {
      const modelSelection: AgentModelSelection = publicNodeAgentRequest.forceFree
        ? { mode: "free" }
        : modelSelectionMode === "specific"
        ? { mode: "specific", modelPolicy: specificModelPolicy || defaultSpecificModel || "gemini-3.5-flash" }
        : { mode: modelSelectionMode };
      beginThinking();
      void store.askAgent({ goal: publicNodeAgentRequest.goal, references: messageRefs, modelSelection, contextArtifactId: activeArtifactId }).catch((e) => {
        if (aliveRef.current) {
          setAgentErr(agentErrorText(e));
          setThinking(false);
        }
      });
      return;
    }

    if (isPrivate && store.mode === "memory") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion:reduce)").matches ?? false;
      beginThinking();
      privTimerRef.current = setTimeout(() => {
        privTimerRef.current = null;
        if (!aliveRef.current) return; // user left the room — don't post into a stale channel
        setThinking(false);
        const aware = store.awareness(roomId, "agent_priv");
        store.postMessage({
          roomId,
          channel,
          author: { kind: "agent", id: "agent_priv", name: agentName, scope: "private", ownerId: me.id },
          text: aware.activeLocks.length
            ? `I see ${aware.activeLocks.length} active lock(s). I'll read those ranges as context and draft around them. This stays private until you promote it.`
            : "Reading the room context for that. This stays private to you until you promote it.",
          clientMsgId: crypto.randomUUID(),
          kind: "agent",
        });
      }, reduced ? 0 : 900);
    }

    if (isPrivate && store.mode === "convex" && t) {
      // Live private NodeAgent. Private lane → replies only to you. Room lane → acts in the shared room
      // (edits the sheet + posts public chat) as your personal agent, attributed to you.
      beginThinking();
      void store.askPrivateAgent({ goal: t, references: messageRefs }, { publish: roomLane }).catch((e) => { if (aliveRef.current) setAgentErr(agentErrorText(e)); }).finally(() => { if (aliveRef.current) setThinking(false); });
    }
  };

  const promote = (t: string) => {
    void store.postMessage({ roomId, channel: "public", author: me, text: `Sharing from my NodeAgent - ${t}`, clientMsgId: crypto.randomUUID(), kind: "chat" });
  };
  const retrySend = (cid: string, text: string) => {
    void store.postMessage({ roomId, channel, author: me, text, clientMsgId: cid, kind: "chat" })
      .then((fb) => { if (fb && fb.ok) setFailedSends((f) => f.filter((x) => x.cid !== cid)); });
  };
  const dismissFailed = (cid: string) => setFailedSends((f) => f.filter((x) => x.cid !== cid));
  const jobReason = (reason?: string) =>
    reason === "terminal" ? "Can't cancel — the job already finished."
      : reason === "not_retryable" ? "Can't retry — the job is completed or still running."
        : reason === "job_not_found" ? "That job no longer exists."
          : "Action failed — try again.";
  const cancelJob = () => {
    if (!longJob || jobBusy) return;
    setJobBusy("cancel"); setJobErr(null);
    void store.cancelLongFreeJob(longJob.id).then((fb) => { if (!fb.ok) setJobErr(jobReason(fb.reason)); }).finally(() => setJobBusy(null));
  };
  const retryJob = () => {
    if (!longJob || jobBusy) return;
    setJobBusy("retry"); setJobErr(null);
    void store.retryLongFreeJob(longJob.id).then((fb) => { if (!fb.ok) setJobErr(jobReason(fb.reason)); }).finally(() => setJobBusy(null));
  };

  const applySlash = (insert: string) => { setText(insert); setSlashOpen(false); setSlashIndex(0); requestAnimationFrame(() => { grow(); taRef.current?.focus(); }); };
  const applyMention = (item: MentionItem) => {
    if (!mention) return;
    const head = (v: string) => v.slice(0, mention.start);
    const tail = (v: string) => v.slice(mention.start + 1 + mention.q.length);
    if (item.kind === "agent") setText((v) => `${head(v)}@nodeagent ${tail(v)}`);
    else { setText((v) => head(v) + tail(v)); addRef(item.ref); }
    setMention(null); setMentionIndex(0);
    requestAnimationFrame(() => { grow(); taRef.current?.focus(); });
  };
  const addRef = (ref: ArtifactRef) => {
    const art = store.listArtifacts(roomId).find((a) => a.id === ref.id);
    if (!art) return;
    const canonical = { id: art.id, title: art.title, kind: art.kind };
    setRefs((cur) => cur.some((r) => r.id === canonical.id) ? cur : [...cur, canonical]);
  };
  const appendRefs = (nextRefs: ArtifactRef[]) => {
    setRefs((cur) => {
      const seen = new Set(cur.map((r) => r.id));
      const additions = nextRefs.filter((r) => !seen.has(r.id));
      return additions.length ? [...cur, ...additions] : cur;
    });
  };
  const removeRef = (id: string) => setRefs((cur) => cur.filter((r) => r.id !== id));
  const openComposerRef = (ref: ArtifactRef) => {
    const opened = onOpenArtifact?.(ref.id, { split: true });
    if (opened === false) setRefOpenErr(`Couldn't open ${ref.title}. The artifact or proposal no longer exists.`);
    else setRefOpenErr(null);
  };
  const uploadFiles = async (files: Iterable<File>) => {
    const fileList = Array.from(files);
    if (!fileList.length || uploadBusyRef.current) return;
    uploadBusyRef.current = true;
    setUploadingFiles(true);
    setUploadError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(new Error("Upload timed out - try fewer or smaller files.")), UPLOAD_TIMEOUT_MS);
    try {
      const parsed = await parseUploadedFiles(fileList, controller.signal);
      const uploadedRefs: ArtifactRef[] = [];
      let committed = 0;
      try {
        for (const artifact of parsed) {
          const id = await abortable(store.uploadArtifact({ roomId, artifact, actor: me, visibility: isPrivate ? "private" : "room" }), controller.signal);
          uploadedRefs.push({ id, title: artifact.title, kind: artifact.kind });
          committed += 1;
        }
      } catch (e) {
        if (aliveRef.current && uploadedRefs.length) appendRefs(uploadedRefs);
        const reason = e instanceof Error ? e.message : "please try again";
        throw new Error(committed > 0 ? `Uploaded ${committed} of ${parsed.length} item(s), then failed - ${reason}` : `Upload failed - ${reason}`);
      }
      if (aliveRef.current) appendRefs(uploadedRefs);
      requestAnimationFrame(() => taRef.current?.focus());
    } catch (e) {
      if (aliveRef.current) setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      window.clearTimeout(timer);
      uploadBusyRef.current = false;
      if (aliveRef.current) setUploadingFiles(false);
    }
  };
  const uploadDroppedFiles = (files: FileList) => uploadFiles(files);
  const openFilePicker = () => {
    if (uploadBusyRef.current) return;
    fileInputRef.current?.click();
  };
  const onAttachFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files?.length) void uploadFiles(files);
    e.currentTarget.value = "";
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedArtifactRef(e.dataTransfer) && !hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!isNode(e.relatedTarget) || !e.currentTarget.contains(e.relatedTarget)) setDropActive(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedArtifactRef(e.dataTransfer) && !hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    setDropActive(false);
    if (hasDraggedArtifactRef(e.dataTransfer)) {
      const ref = readDraggedArtifactRef(e.dataTransfer);
      if (ref) addRef(ref);
    } else if (e.dataTransfer.files.length) {
      void uploadDroppedFiles(e.dataTransfer.files);
    }
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value; setText(v); grow();
    const open = !isPrivate && v.trimStart() === "/" && slashOptions.length > 0;
    setSlashOpen(open);
    if (open) setSlashIndex(0);
    // @-mention: an @ at the caret (start or after whitespace) opens the artifact picker.
    const caret = e.target.selectionStart ?? v.length;
    const m = open ? null : /(?:^|\s)@(\S*)$/.exec(v.slice(0, caret));
    if (m) { setMention({ q: m[1], start: caret - m[1].length - 1 }); setMentionIndex(0); }
    else setMention(null);
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData.files;
    if (!files.length) return;
    e.preventDefault();
    void uploadFiles(files);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); applyMention(mentionMatches[mentionIndex] ?? mentionMatches[0]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (slashOpen && slashOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashOptions.length) % slashOptions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySlash(slashOptions[slashIndex]?.insert ?? slashOptions[0].insert);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === "Escape") { if (slashOpen) setSlashOpen(false); else taRef.current?.blur(); }
  };
  const canSend = !uploadingFiles && (text.trim().length > 0 || refs.length > 0);
  const rootClass = embedded ? `r-chat-embedded ${isPrivate ? "private" : "public"}` : `r-panel ${isPrivate ? "right" : "center"}`;

  return (
    <div
      className={rootClass}
      style={style}
      data-drop={String(dropActive)}
      data-testid={testId ?? (isPrivate ? "private-chat-panel" : "public-chat-panel")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="r-panel-head">
        {isPrivate ? <Lock size={14} /> : <MessageCircle size={14} />}
        <span className="h-title">{isPrivate ? "Your NodeAgent" : "Public chat"}</span>
        <span className={"r-tag " + (isPrivate ? "private" : "public")}>{isPrivate ? <><Lock size={10} /> Private</> : <><Globe size={10} /> Everyone</>}</span>
        <span className="grow" />
        {!isPrivate && <span className="r-tag agent" style={{ gap: 6 }}><span className="r-avatar agent sm" style={{ background: AGENT_AVATAR_COLOR, width: 18, height: 18, fontSize: 9 }}>N</span>Room NodeAgent</span>}
        {showLongJobChrome && longJob && (() => { const bad = ["failed", "blocked"].includes(longJob.status); return (
          <span className={"r-tag" + (bad ? " danger" : "")} role={bad ? "status" : undefined} data-testid="job-status" title="Latest long-running free-auto job"><Timer size={10} /> {longJob.status} {longJob.attempts}/{longJob.maxAttempts}</span>
        ); })()}
        {canCancelLongJob && (
          <button className="r-iconbtn r-iconbtn-sm" title={jobBusy === "cancel" ? "Cancelling…" : "Cancel long-running job"} aria-label="Cancel long-running job" data-testid="job-cancel" disabled={jobBusy !== null} onClick={cancelJob}>
            <X size={13} />
          </button>
        )}
        {canRetryLongJob && (
          <button className="r-iconbtn r-iconbtn-sm" title={jobBusy === "retry" ? "Retrying…" : "Retry long-running job"} aria-label="Retry long-running job" data-testid="job-retry" disabled={jobBusy !== null} onClick={retryJob}>
            <RefreshCw size={13} />
          </button>
        )}
        {jobErr && <span className="r-tag" role="alert" data-testid="job-error" style={{ color: "var(--danger-ink)" }}>{jobErr}</span>}
      </div>
      {isPrivate && <div className="r-private-banner"><Sparkles size={12} /> Reads room context; output stays yours until you promote it</div>}
      {!isPrivate && showLongJobChrome && longJob && (
        <div className="r-job-strip">
          <Timer size={12} />
          <span>{longJob.modelPolicy}</span>
          {latestAttempt && <span>attempt {latestAttempt.attempt}: {latestAttempt.resolvedModel} · {latestAttempt.stopReason} · {shortMs(latestAttempt.ms)}</span>}
          {longJob.nextRunAt && longJob.status !== "completed" && <span>next {clock(longJob.nextRunAt)}</span>}
          {longJobVisibleError && <span>{longJobVisibleError}</span>}
          <button className="r-job-detail-toggle" type="button" data-testid="job-detail-toggle" onClick={() => setJobDetailsOpen((open) => !open)} aria-expanded={jobDetailsOpen}>
            {jobDetailsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Details
          </button>
        </div>
      )}
      {!isPrivate && showLongJobChrome && longJob && jobDetailsOpen && (
        <div className="r-job-detail" data-testid="job-detail" aria-label="Agent job details">
          <div className="r-job-grid">
            <span>Runtime</span><b>{longJob.runtime ?? "inline"}</b>
            <span>Policy</span><b>{longJob.approvalPolicy ?? "n/a"}</b>
            <span>Slices</span><b>{longJob.actionSliceCount ?? 0}</b>
            <span>Model calls</span><b>{longJob.modelCallCount ?? 0}</b>
            <span>Tool calls</span><b>{longJob.toolCallCount ?? 0}</b>
            <span>Mutations</span><b>{longJob.mutationCount ?? 0}</b>
            <span>Receipts</span><b>{longJob.receiptCount ?? 0}</b>
            <span>Scheduler</span><b>{longJob.schedulerHandoffCount ?? 0}</b>
          </div>
          {longJobAttempts.length > 0 && (
            <div className="r-job-list">
              <span className="r-job-list-title">Attempts</span>
              {longJobAttempts.slice(-4).map((attempt) => (
                <span key={`${attempt.attempt}-${attempt.status}`}>{attempt.attempt}. {attempt.status} - {attempt.resolvedModel} - {shortMs(attempt.ms)}</span>
              ))}
            </div>
          )}
          {!!longJobDetail?.reasoningFrames.length && (
            <div className="r-frame-tree" data-testid="reasoning-frame-tree" aria-label="Reasoning frame tree">
              <span className="r-job-list-title"><GitBranch size={11} /> Reasoning frames</span>
              <div className="r-frame-phases">
                {longJobDetail.reasoningFrames.filter((frame) => frame.frameKind === "phase").slice(0, 5).map((frame) => (
                  <span key={frame.frameId} data-status={frame.status} title={frame.goal}>
                    <b>{frame.phase}</b>
                    <em>{frame.status}</em>
                  </span>
                ))}
              </div>
              {longJobDetail.reasoningFrames.some((frame) => frame.frameKind === "child") && (
                <div className="r-frame-children">
                  {longJobDetail.reasoningFrames.filter((frame) => frame.frameKind === "child").slice(0, 6).map((frame) => (
                    <span key={frame.frameId} data-status={frame.status} title={frame.goal}>
                      <b>{framePrimaryText(frame)}</b>
                      <em>{frameSecondaryText(frame) || frame.status}</em>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {longJobDetail && (
            <div className="r-job-list">
              <span className="r-job-list-title">Trace</span>
              {longJobDetail.operations.slice(-4).map((op) => (
                <span key={`op-${op.sequence}`}>{op.sequence}. {op.kind}:{op.name} - {op.status}{op.countDelta ? ` x${op.countDelta}` : ""}</span>
              ))}
              {longJobDetail.receipts.slice(0, 3).map((receipt) => (
                <span key={`receipt-${receipt.id}`}>receipt {receipt.mutationName} - {receipt.affectedIds.join(", ")}</span>
              ))}
              {longJobDetail.latestSteps.slice(-3).map((step) => (
                <span key={`step-${step.idx}`}>step {step.idx}: {step.tool} - {step.status}{step.elementId ? ` (${step.elementId})` : ""}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="r-chat" ref={feedRef} onScroll={onScroll} aria-live="polite" data-testid="chat-feed">
        {showEmptyState && (
          <div className="r-chat-empty" data-testid={isPrivate ? "private-chat-empty" : "public-chat-empty"}>
            <span>{isPrivate ? "Ask your NodeAgent privately, or switch it to Room mode." : emptyStateHint}</span>
            {!isPrivate && hasQ3DemoSeed && (
              <button className="r-mini-btn primary" type="button" data-testid="chat-empty-agent-cta" onClick={() => send(contextualPrompts[0]?.insert ?? NODEAGENT_PROMPTS[0].insert)}>
                <Sparkles size={12} /> Ask NodeAgent
              </button>
            )}
          </div>
        )}
        {agentErr && <div className="r-msg" role="alert" data-testid="agent-error" data-state="failed"><div className="body tiny" style={{ color: "var(--danger-ink)" }}>{agentErr}</div></div>}
        {feedItems.map((item) => item.kind === "message" ? (
          <Bubble
            key={item.key}
            m={item.message}
            roomId={roomId}
            variant={variant}
            me={me}
            onPromote={promote}
            onOpenArtifact={onOpenArtifact}
            agentStreamParts={item.message.clientMsgId === activeJobClientMsgId ? unifiedStreamParts : undefined}
            agentStreamLive={!longJobTerminal}
            agentStreamTerminalSuccessful={longJobTerminal && longJob?.status === "completed"}
          />
        ) : (
          <div className="r-msg agent" key={item.key} data-testid="agent-job-result" data-state={item.status}>
            <span className="r-avatar agent sm" style={{ background: AGENT_AVATAR_COLOR }}>N</span>
            <div className="body">
              <div className="meta">
                <span className="who">Room NodeAgent</span>
                <span className={"r-tag agent" + (["failed", "blocked"].includes(item.status) ? " danger" : "")} style={{ padding: "1px 5px", fontSize: 9 }}>{item.status}</span>
                <span className="time">{clock(item.createdAt)}</span>
              </div>
              {item.streamParts.length ? <AgentUnifiedStream parts={item.streamParts} live={false} fallbackText={item.text} terminalSuccessful={!["failed", "blocked"].includes(item.status)} /> : <MarkdownBody text={item.text} />}
            </div>
          </div>
        ))}
        {failedSends.map((f) => (
          <div className="r-msg" key={"fail-" + f.cid} data-testid="chat-failed" data-state="failed">
            <span className="r-avatar sm" style={{ background: colorFor(store, roomId, me) }}>{initials(me.name)}</span>
            <div className="body">
              <div className="meta"><span className="who">{me.name}</span><span className="r-tag" style={{ color: "var(--danger-ink)", padding: "1px 5px", fontSize: 9 }}>failed to send</span></div>
              <div className="text" style={{ opacity: 0.75 }}>{displayArtifactRefMessage(f.text)}</div>
              <div className="r-msg-actions" style={{ opacity: 1 }}>
                <button className="r-msg-act promote" data-testid="chat-retry" onClick={() => retrySend(f.cid, f.text)}><RefreshCw size={12} /> Retry</button>
                <button className="r-msg-act" onClick={() => dismissFailed(f.cid)}>Dismiss</button>
              </div>
            </div>
          </div>
        ))}
        {!isPrivate && multiAgentDemoStarted && <MultiAgentWorkbenchDemo tick={multiAgentTick} scenario={multiAgentScenario} />}
        {showAgentWorkingBubble && (
          <div className="r-msg agent" aria-label={`${agentName} is ${longJobActive && longJob ? longJob.status : "thinking"}`}>
            <span className="r-avatar agent sm" style={{ background: AGENT_AVATAR_COLOR }}>N</span>
            <div className="body">
              <div className="meta"><span className="who">{agentName}</span><span className="r-tag agent" style={{ padding: "1px 5px", fontSize: 9 }}>{longJobActive && longJob ? longJob.status : "thinking"}</span></div>
              {unifiedStreamParts.length ? (
                <AgentUnifiedStream parts={unifiedStreamParts} live={!longJobTerminal} fallbackText={longJobResultText} terminalSuccessful={longJobTerminal && longJob?.status === "completed"} />
              ) : liveOperationStream.length ? (
                <div className="r-agent-stream" data-testid="agent-operation-stream" aria-label="Live agent operation stream">
                  {liveOperationStream.map((op) => (
                    <span key={`live-${op.sequence}`} data-status={op.status}>
                      <b>{op.status}</b>{operationStreamText(op)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="r-typing"><i /><i /><i /></div>
              )}
            </div>
          </div>
        )}
        {!isPrivate && coach}
      </div>

      <div className="r-composer">
        {isPrivate && store.mode === "convex" && (
          <div className="r-lane" role="group" aria-label="Where your agent acts">
            <button type="button" className="r-lane-btn" data-on={String(!roomLane)} data-testid="lane-private" onClick={() => setRoomLane(false)} title="Private: your agent reads the room and replies only to you">
              <Lock size={11} /> Private
            </button>
            <button type="button" className="r-lane-btn" data-on={String(roomLane)} data-testid="lane-room" onClick={() => setRoomLane(true)} title="Room: your agent acts in the shared room — edits the sheet + posts to public chat, attributed to you">
              <Globe size={11} /> Room
            </button>
          </div>
        )}
        {slashOpen && slashOptions.length > 0 && (
          <div className="r-slash" role="listbox" aria-label="Commands">
            {slashOptions.map((c, i) => (
              <button key={c.label} className="r-slash-item" role="option" aria-selected={i === slashIndex} onMouseEnter={() => setSlashIndex(i)} onMouseDown={(e) => { e.preventDefault(); applySlash(c.insert); }}>
                <span className="cmd">{c.label}</span><span className="hint">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        {mention && mentionMatches.length > 0 && (
          <div className="r-slash" role="listbox" aria-label="Mention" data-testid="mention-menu">
            {mentionMatches.map((item, i) => (
              <button key={item.key} className="r-slash-item" role="option" aria-selected={i === mentionIndex} data-testid={item.kind === "agent" ? "mention-agent" : "mention-item"} onMouseEnter={() => setMentionIndex(i)} onMouseDown={(e) => { e.preventDefault(); applyMention(item); }}>
                <span className="cmd">@{item.label}</span><span className="hint">{item.hint}</span>
              </button>
            ))}
          </div>
        )}
        {refs.length > 0 && (
          <div className="r-ref-composer" aria-label="Message references">
            {refs.map((ref) => (
              <span key={ref.id} className="r-ref-chip">
                <button className="r-ref-open" type="button" onClick={() => openComposerRef(ref)}>
                  <Paperclip size={12} /> <span className="r-ref-title">{ref.title}</span>
                </button>
                <button className="r-ref-remove" type="button" aria-label={`Remove ${ref.title}`} onClick={() => removeRef(ref.id)}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        {refOpenErr && <div className="r-upload-error" role="alert" data-testid="artifact-ref-open-error">{refOpenErr}</div>}
        {uploadingFiles && <div className="r-upload-status" role="status" data-testid="chat-upload-status">Uploading files...</div>}
        {uploadError && <div className="r-upload-error" role="alert" data-testid="chat-upload-error">{uploadError}</div>}
        <div className="r-intake-preview-slot">
          {text.trim().length > 0 && <IntakePlanPreview roomId={roomId} text={text} targetArtifacts={refs.map((r) => r.id)} />}
        </div>
        <div className="r-input-wrap r-input-stack">
          <input
            ref={fileInputRef}
            className="r-chat-file-input"
            type="file"
            multiple
            accept=".csv,.tsv,.xlsx,.xls,.txt,.md,.json,.log,.pdf,image/*"
            onChange={onAttachFiles}
            data-testid="chat-file-input"
            aria-label="Attach files"
            tabIndex={-1}
          />
          <textarea ref={taRef} rows={1} value={text} onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste}
            placeholder={isPrivate ? (roomLane ? "Tell your agent to act in the room…" : "Ask privately…") : "Message the room or @nodeagent..."}
            data-testid="chat-composer"
            aria-label={isPrivate ? "Ask privately" : "Message the room"} />
          {/* One calm toolbar row (assistant-ui/shadcn): attach + an unobtrusive model chip on the
              left, send on the right. The route picker lives here as a ghost <select> — no labels,
              no helper sentence (moved to title=), revealed-on-relevance instead of always-stacked. */}
          <div className="r-composer-bar">
            <button
              className="r-attach"
              type="button"
              onClick={openFilePicker}
              disabled={uploadingFiles}
              data-testid="chat-attach"
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip size={15} />
            </button>
            {showModelSelection && (
              <select
                className="r-model-select"
                value={modelSelectionMode}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  const next = e.target.value as AgentModelSelection["mode"];
                  setModelSelectionMode(next);
                  if (next === "specific" && !specificModelPolicy && defaultSpecificModel) setSpecificModelPolicy(defaultSpecificModel);
                }}
                data-testid="chat-model-preset"
                aria-label="Agent route"
                title={hintForModelSelection(modelSelectionMode)}
              >
                {AGENT_MODEL_PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
            {showModelSelection && modelSelectionMode === "specific" && (
              <>
                {/* Free-text combobox (preserves the central-routing capability to pin any
                    provider-model, not just catalog presets) — kept compact in the toolbar. */}
                <input
                  className="r-model-select r-model-select-wide"
                  value={specificModelPolicy || defaultSpecificModel || ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setSpecificModelPolicy(e.target.value)}
                  list="agent-model-options"
                  placeholder="provider-model"
                  data-testid="chat-model-specific"
                  aria-label="Specific agent model"
                  title="Pinned model — type any provider-model"
                />
                <datalist id="agent-model-options">
                  {specificModelGroups.map((group) => (
                    group.models.map((model) => <option key={`${group.provider}-${model}`} value={model}>{`${group.label} - ${model}`}</option>)
                  ))}
                </datalist>
              </>
            )}
            <span className="r-composer-spacer" aria-hidden="true" />
            {/* The send button reflects the composer state — muted + disabled on empty input,
                not a live accent button that does nothing (state-honesty). */}
            <button className="r-send" onClick={() => send()} disabled={!canSend} data-testid="chat-send" aria-label="Send message"><Send size={15} /></button>
          </div>
        </div>
        {/* Suggestion chips only when the demo is seeded — no always-on keyboard sentence
            (discoverable behavior doesn't need permanent screen real estate). */}
        {!isPrivate && !slashOpen && hasQ3DemoSeed && (
          <div className="r-composer-hint">
            {contextualPrompts.map((prompt) => <button key={prompt.insert} className="r-chip" onClick={() => applySlash(prompt.insert)}>{prompt.label}</button>)}
            {store.mode === "memory" && <button className="r-chip" onClick={() => applySlash(SLASH_CMDS[0].insert)}>/demo multi-agent</button>}
            <span className="r-composer-kbd" aria-hidden="true">{hasQ3DemoSeed ? "Enter sends; Shift+Enter newline; @nodeagent acts" : "Attach, paste, drop files, or mention @nodeagent"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function statusForTick(startTick: number, doneTick: number, tick: number) {
  if (tick >= doneTick) return "done";
  if (tick >= startTick) return "running";
  return "queued";
}

function pctForTick(startTick: number, doneTick: number, tick: number) {
  if (tick <= startTick) return tick >= startTick ? 12 : 0;
  if (tick >= doneTick) return 100;
  return Math.max(12, Math.round(((tick - startTick) / Math.max(1, doneTick - startTick)) * 100));
}

function MultiAgentWorkbenchDemo({ tick, scenario }: { tick: number; scenario: DemoScenario }) {
  const complete = tick >= MULTI_AGENT_DEMO_MAX_TICK;
  return (
    <div className="r-agent-workbench" data-testid="multi-agent-workbench" aria-label="Multi-agent work queue demo">
      <div className="r-agent-workbench-head">
        <div>
          <span className="r-agent-eyebrow"><GitBranch size={13} /> {scenario.eyebrow}</span>
          <strong>{scenario.title}</strong>
        </div>
        <span className="r-agent-proof-pill" data-done={String(complete)}>{complete ? "HANDOFF SEALED" : "streaming"}</span>
      </div>

      <div className="r-agent-lanes" aria-label="Stream lanes">
        <span><Sparkles size={12} /> {scenario.lanes[0]}</span>
        <span><Database size={12} /> {scenario.lanes[1]}</span>
        <span><ShieldCheck size={12} /> {scenario.lanes[2]}</span>
      </div>

      <div className="r-command-queue" aria-label="Command queue">
        {scenario.queue.map((item) => {
          const status = statusForTick(item.startTick, item.doneTick, tick);
          return (
            <div className="r-command-item" data-status={status} key={item.label}>
              <ListChecks size={13} />
              <span>{item.label}</span>
              <b>{status}</b>
            </div>
          );
        })}
      </div>

      <div className="r-agent-grid">
        {scenario.agents.map((agent) => {
          const status = statusForTick(agent.startTick, agent.doneTick, tick);
          const pct = pctForTick(agent.startTick, agent.doneTick, tick);
          const visibleCount = Math.max(1, Math.min(agent.chunks.length, Math.floor(Math.max(0, tick - agent.startTick) / 2) + 1));
          const chunks = agent.chunks.slice(0, visibleCount);
          const active = status === "running";
          return (
            <div className="r-agent-card" data-status={status} data-testid={`multi-agent-${agent.id}`} key={agent.id} style={{ "--agent-color": agent.color } as CSSProperties}>
              <div className="r-agent-card-head">
                <span className="r-agent-dot" />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.scope}</small>
                </span>
                <b>{status}</b>
              </div>
              <div className="r-agent-progress" aria-label={`${agent.name} progress`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="r-agent-stream" aria-label={`${agent.name} stream`}>
                <em>{agent.lane}</em>
                {chunks.map((chunk, idx) => (
                  <span key={`${agent.id}-${idx}`}>{chunk}{active && idx === chunks.length - 1 ? <i aria-hidden="true">|</i> : null}</span>
                ))}
              </div>
              <div className="r-agent-commit">
                <span>{agent.commit}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="r-agent-claims" aria-label="Claimed ranges">
        {scenario.claims.map((claim, index) => (
          <span key={claim} style={{ "--claim-color": ["#7DD3FC", "#A7F3D0", "#FDE68A"][index] ?? "#CBD5E1" } as CSSProperties}>{claim}</span>
        ))}
      </div>

      <div className="r-agent-stream-strip" aria-label="Concurrent stream summary">
        {scenario.agents.map((agent) => {
          const status = statusForTick(agent.startTick, agent.doneTick, tick);
          const visibleCount = Math.max(1, Math.min(agent.chunks.length, Math.floor(Math.max(0, tick - agent.startTick) / 2) + 1));
          const latest = status === "done" ? agent.commit : agent.chunks[visibleCount - 1];
          return (
            <span key={`${agent.id}-strip`} data-status={status} style={{ "--agent-color": agent.color } as CSSProperties}>
              <i />
              <b>{agent.name}</b>
              <em>{latest}</em>
            </span>
          );
        })}
      </div>

      <div className="r-gold-board" aria-label={scenario.proofBoardLabel}>
        <div className="r-gold-board-head">
          <span>Source document</span>
          <span>NodeRoom output</span>
          <span>Gold / eval</span>
        </div>
        {scenario.cases.map((goldCase, index) => {
          const active = tick >= Math.max(2, index + 4);
          return (
            <div className="r-gold-row" data-active={String(active)} key={goldCase.caseId}>
              <div>
                <b>{goldCase.title}</b>
                <em>{goldCase.source}</em>
                <code>{goldCase.caseId}</code>
              </div>
              <div>
                <b>{goldCase.target}</b>
                <em>{active ? goldCase.output : "waiting for child receipt"}</em>
              </div>
              <div className="r-gold-evals">
                <b>{goldCase.gold}</b>
                {goldCase.evals.map((item) => <span key={item}>{active ? item : "queued"}</span>)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="r-agent-proof-grid" data-testid={complete ? "multi-agent-complete" : undefined}>
        {scenario.proof.map((item) => (
          <span key={item.label}><b>{item.label}</b><em>{item.value}</em></span>
        ))}
      </div>
    </div>
  );
}

type ArtifactEmbedPreview = {
  title: string;
  kind: string;
  meta: string;
  body: string;
  status?: string;
  evidenceCount: number;
  missing?: boolean;
};

function ArtifactKindIcon({ kind }: { kind: string }) {
  if (kind === "sheet") return <Table2 size={13} />;
  if (kind === "note") return <FileText size={13} />;
  if (kind === "wall") return <StickyNote size={13} />;
  return <Paperclip size={13} />;
}

function isCellPayload(value: unknown): value is CellPayload {
  return !!value && typeof value === "object" && "value" in value;
}

function valuePreview(value: unknown): string {
  const raw = isCellPayload(value) ? value.value : value;
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "object" && raw && "text" in raw && typeof (raw as { text?: unknown }).text === "string") return (raw as { text: string }).text.trim();
  try { return JSON.stringify(raw); } catch { return String(raw); }
}

function previewArtifact(artifact: Artifact | undefined, ref: ArtifactRef): ArtifactEmbedPreview {
  if (!artifact) {
    return {
      title: ref.title,
      kind: ref.kind || "artifact",
      meta: "Reference unavailable",
      body: "The artifact or proposal is no longer available in this room.",
      evidenceCount: 0,
      missing: true,
    };
  }
  const elements = artifact.order.map((id) => artifact.elements[id]).filter(Boolean);
  const values = elements.map((el) => el.value);
  const bodyBits = values.map(valuePreview).filter(Boolean).slice(0, 4);
  const status = values.map((value) => isCellPayload(value) ? value.status : undefined).find(Boolean);
  const evidenceCount = values.reduce<number>((sum, value) => sum + (isCellPayload(value) ? value.evidence?.length ?? 0 : 0), 0);
  const metaParts = [
    artifact.kind,
    artifact.meta?.dataframe ? `${artifact.meta.dataframe.rowCount} rows` : `${elements.length} item${elements.length === 1 ? "" : "s"}`,
    artifact.visibility && artifact.visibility !== "room" ? artifact.visibility : undefined,
  ].filter(Boolean);
  return {
    title: artifact.title,
    kind: artifact.kind,
    meta: metaParts.join(" - "),
    body: bodyBits.length ? bodyBits.join(" | ") : "No visible content yet.",
    status,
    evidenceCount,
  };
}

function ArtifactEmbed({ roomId, ref, store, onOpen }: { roomId: string; ref: ArtifactRef; store: RoomStore; onOpen: (ref: ArtifactRef) => void }) {
  const artifact = store.getArtifact(ref.id) ?? store.listArtifacts(roomId).find((a) => a.id === ref.id);
  const preview = previewArtifact(artifact, ref);
  return (
    <button className="r-msg-artifact r-msg-ref" data-kind={preview.kind} data-missing={preview.missing ? "true" : "false"} type="button" onClick={() => onOpen(ref)}>
      <span className="r-msg-artifact-icon"><ArtifactKindIcon kind={preview.kind} /></span>
      <span className="r-msg-artifact-main">
        <span className="r-msg-artifact-head">
          <strong>{preview.title}</strong>
          <em>{preview.meta}</em>
        </span>
        <span className="r-msg-artifact-body">{preview.body}</span>
        <span className="r-msg-artifact-foot">
          {preview.status && <span data-status={preview.status}>{preview.status}</span>}
          {preview.evidenceCount > 0 && <span>{preview.evidenceCount} source{preview.evidenceCount === 1 ? "" : "s"}</span>}
          <span>Open <ArrowUpRight size={10} /></span>
        </span>
      </span>
    </button>
  );
}

function Bubble({
  m,
  roomId,
  variant,
  me,
  onPromote,
  onOpenArtifact,
  agentStreamParts,
  agentStreamLive,
  agentStreamTerminalSuccessful,
}: {
  m: Message;
  roomId: string;
  variant: "public" | "private";
  me: Actor;
  onPromote: (t: string) => void;
  onOpenArtifact?: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
  agentStreamParts?: AgentStreamPart[];
  agentStreamLive?: boolean;
  agentStreamTerminalSuccessful?: boolean;
}) {
  const store = useStore();
  const parsed = parseArtifactRefMessage(m.text);
  const visibleText = displayArtifactRefMessage(m.text);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(parsed.body);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const agent = m.author.kind === "agent";
  const viaOwner = agent && m.author.ownerId ? store.listMembers(roomId).find((x) => x.id === m.author.ownerId)?.name : null;
  const ask = !agent && isPublicNodeAgentDirective(parsed.body);
  const mine = !agent && m.author.id === me.id;
  const canPromote = agent && variant === "private";
  const pending = String(m.id).startsWith("opt-"); // optimistic, not yet confirmed by the server
  // QA P2 perf: the avatar style depends only on the author's color — don't rebuild per feed render.
  const avatarStyle = useMemo(() => ({ background: colorFor(store, roomId, m.author) }), [store, roomId, m.author]);
  useEffect(() => {
    if (!editing) setDraft(parsed.body);
  }, [editing, parsed.body]);
  const copy = () => { void navigator.clipboard?.writeText(visibleText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  const saveEdit = () => {
    const t = draft.trim();
    const nextText = parsed.refs.length ? `${encodeArtifactRefLine(parsed.refs)}\n\n${t}` : t;
    if (t && nextText !== m.text) {
      setEditing(false); // optimistic update paints the new text instantly
      void store.editMessage(m.id, nextText, me).then((fb) => { setEditErr(fb.ok ? null : "Couldn't save your edit — it was reverted."); });
    } else setEditing(false);
  };
  const openRef = (ref: ArtifactRef) => {
    const opened = onOpenArtifact?.(ref.id, { split: true });
    if (opened === false) setOpenErr(`Couldn't open ${ref.title}. The artifact or proposal no longer exists.`);
    else setOpenErr(null);
  };

  return (
    <div className={"r-msg" + (agent ? " agent" : "")} data-testid="chat-message" data-clientmsgid={m.clientMsgId} data-state={pending ? "pending" : "confirmed"} style={pending ? { opacity: 0.6 } : undefined}>
      <span className={"r-avatar sm" + (agent ? " agent" : "")} style={avatarStyle}>{agent ? "N" : initials(m.author.name)}</span>
      <div className="body">
        <div className="meta">
          <span className="who">{m.author.name}</span>
          {agent && <span className="r-tag agent" style={{ padding: "1px 5px", fontSize: 9 }}>agent</span>}
          {viaOwner && <span className="r-tag" data-testid="agent-via" style={{ padding: "1px 5px", fontSize: 9 }}>via {viaOwner}</span>}
          {pending && <span className="r-tag" data-testid="chat-pending" style={{ padding: "1px 5px", fontSize: 9 }}>sending…</span>}
          <span className="time">{clock(m.createdAt)}</span>
        </div>
        {editing ? (
          <div className="r-input-wrap" style={{ marginTop: 4 }}>
            <textarea autoFocus rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } else if (e.key === "Escape") { setDraft(parsed.body); setEditing(false); } }}
              aria-label="Edit message" />
          </div>
        ) : (
          <>
            {parsed.refs.length > 0 && (
              <div className="r-msg-refs">
                {parsed.refs.map((ref) => (
                  <ArtifactEmbed key={ref.id} roomId={roomId} ref={ref} store={store} onOpen={openRef} />
                ))}
              </div>
            )}
            {agentStreamParts?.length ? (
              <AgentUnifiedStream parts={agentStreamParts} live={agentStreamLive} terminalSuccessful={agentStreamTerminalSuccessful} />
            ) : m.streamId && !m.text ? (
              <StreamedBody streamId={m.streamId} />
            ) : (
              parsed.body && (ask ? <span className="r-bubble-ask">{parsed.body}</span> : <MarkdownBody text={parsed.body} />)
            )}
          </>
        )}

        {editErr && <div className="tiny" role="alert" data-testid="chat-edit-error" style={{ color: "var(--danger-ink)", marginTop: 2 }}>{editErr}</div>}
        {openErr && <div className="tiny" role="alert" data-testid="chat-ref-error" style={{ color: "var(--danger-ink)", marginTop: 2 }}>{openErr}</div>}
        {editing ? (
          <div className="r-msg-actions" style={{ opacity: 1 }}>
            <button className="r-msg-act promote" data-testid="chat-edit-save" onClick={saveEdit}>Save</button>
            <button className="r-msg-act" onClick={() => { setDraft(parsed.body); setEditErr(null); setEditing(false); }}>Cancel</button>
          </div>
        ) : (
          <div className="r-msg-actions">
            <button className="r-msg-act" onClick={copy} aria-label="Copy message">{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}</button>
            {mine && <button className="r-msg-act" data-testid="chat-edit" onClick={() => { setDraft(parsed.body); setEditErr(null); setEditing(true); }} aria-label="Edit message"><Pencil size={12} /> Edit</button>}
            {canPromote && <button className="r-msg-act promote" onClick={() => onPromote(visibleText)} aria-label="Promote to the public chat"><ArrowUpRight size={12} /> Promote to public</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function isNode(value: EventTarget | null): value is Node {
  return value instanceof Node;
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files") || dataTransfer.files.length > 0;
}
