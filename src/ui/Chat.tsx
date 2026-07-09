/** Public/private Copilot chat surfaces. Reads via useStore(). */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Lock, MessageCircle, Globe, Send, Square, Sparkles, Copy, Check, ArrowUpRight, Pencil, Paperclip, X, Timer, RefreshCw, ChevronDown, ChevronUp, ChevronRight, ListChecks, GitBranch, ShieldCheck, Database, FileText, StickyNote, Table2, Brain, Target, Mic, MicOff } from "lucide-react";
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
import {
  classifyVoiceTranscript,
  confirmCommand,
  createVoiceSpeechToTextAdapters,
  dispatchRoomCommand,
  type RoomCommand,
  type SpeechToTextAdapter,
  type VoiceDispatchResult,
  type VoiceRoomStore,
} from "../voice";
import "./chat-scale.css";

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
const clock = (ts: number) => { const d = new Date(ts); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

type ContextualPrompt = { label: string; insert: string };
type DecisionMetric = { label: string; value: string; tone?: "good" | "warn" | "muted" };
type DecisionAssistantState = {
  artifactId: string;
  eyebrow: string;
  title: string;
  body: string;
  progressLabel: string;
  progressPct: number;
  metrics: DecisionMetric[];
  reviewSignals: string[];
  prompts: ContextualPrompt[];
};
type AgentResearchReceipt = {
  artifactId: string;
  cellId: string;
  company: string;
  sourceCount: number;
  sourceLabel: string;
  sourceDetail: string;
  sourceUrl?: string;
  fromVersion: number;
  toVersion: number;
};

const REVIEW_SIGNAL_RE = /\b(verify|requires?|claimed|unknown|gap|missing|unverified|needs?\s+review|before\s+ic)\b/i;

function artifactRowIds(artifact: Artifact): string[] {
  const rows: string[] = [];
  for (const elementId of artifact.order ?? []) {
    const rowId = elementId.split("__")[0];
    if (rowId && !rows.includes(rowId)) rows.push(rowId);
  }
  return rows;
}

function artifactCellValue(artifact: Artifact, rowId: string, col: string): string {
  return valuePreview(artifact.elements[`${rowId}__${col}`]?.value);
}

function artifactCellPayload(artifact: Artifact, rowId: string, col: string): CellPayload | null {
  const value = artifact.elements[`${rowId}__${col}`]?.value;
  return isCellPayload(value) ? value : null;
}

function artifactCellVersion(artifact: Artifact, rowId: string, col: string): number {
  return artifact.elements[`${rowId}__${col}`]?.version ?? 1;
}

function artifactCellEvidence(artifact: Artifact, rowId: string, col: string): NonNullable<CellPayload["evidence"]> {
  return artifactCellPayload(artifact, rowId, col)?.evidence ?? [];
}

function artifactCellEvidenceCount(artifact: Artifact, rowId: string, col: string): number {
  return artifactCellEvidence(artifact, rowId, col).length;
}

function buildAgentResearchReceipt(artifact: Artifact | undefined): AgentResearchReceipt | null {
  if (!artifact || artifact.kind !== "sheet" || !/company|research/i.test(artifact.title ?? "")) return null;
  const rows = artifactRowIds(artifact);
  const completedRows = rows.filter((id) => (artifactCellValue(artifact, id, "status") || "").toLowerCase() === "complete");
  const rowId = completedRows[0];
  if (!rowId) return null;
  const company = artifactCellValue(artifact, rowId, "company") || rowId;
  const evidenceCols = ["status", "summary", "funding", "headcount", "recent_signal", "source", "source2"];
  const evidenceRows = rows.length >= 100 ? completedRows : [rowId];
  const allEvidence = evidenceRows.flatMap((id) => evidenceCols.flatMap((col) => artifactCellEvidence(artifact, id, col)));
  const seenEvidence = new Set<string>();
  const uniqueEvidence = allEvidence.filter((item) => {
    const key = item.url ?? item.source ?? item.id ?? item.label;
    if (seenEvidence.has(key)) return false;
    seenEvidence.add(key);
    return true;
  });
  if (!uniqueEvidence.length) return null;
  const first = uniqueEvidence[0];
  const toVersion = Math.max(
    artifactCellVersion(artifact, rowId, "status"),
    artifactCellVersion(artifact, rowId, "summary"),
    artifactCellVersion(artifact, rowId, "funding"),
    artifact.version,
  );
  return {
    artifactId: artifact.id,
    cellId: `${rowId}__status`,
    company,
    sourceCount: uniqueEvidence.length,
    sourceLabel: first.label || "Source receipt",
    sourceDetail: first.snippet || first.url || first.source || "Evidence attached to the committed row.",
    sourceUrl: first.url ?? first.source,
    fromVersion: Math.max(1, toVersion - 1),
    toVersion,
  };
}

function buildResearchDecisionState(artifact: Artifact | undefined): DecisionAssistantState | null {
  if (!artifact || artifact.kind !== "sheet" || !/company|research/i.test(artifact.title ?? "")) return null;
  const rows = artifactRowIds(artifact);
  if (!rows.length) return null;
  const statusFor = (rowId: string) => (artifactCellValue(artifact, rowId, "status") || "pending").toLowerCase();
  const completedRows = rows.filter((rowId) => statusFor(rowId) === "complete");
  const pendingRows = rows.filter((rowId) => statusFor(rowId) === "pending");
  const activeRowId = completedRows[0] ?? rows[0];
  const company = artifactCellValue(artifact, activeRowId, "company") || activeRowId;
  const evidenceFields = ["status", "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched"];
  const rowSources = Math.max(
    artifactCellEvidenceCount(artifact, activeRowId, "status"),
    artifactCellEvidenceCount(artifact, activeRowId, "summary"),
    artifactCellEvidenceCount(artifact, activeRowId, "funding"),
    artifactCellEvidenceCount(artifact, activeRowId, "source"),
    artifactCellEvidenceCount(artifact, activeRowId, "source2"),
  );
  const evidenceCellCount = rows.reduce((sum, rowId) =>
    sum + evidenceFields.filter((col) => artifactCellEvidenceCount(artifact, rowId, col) > 0).length, 0);
  const updatedFieldLabels = [
    ["summary", "Summary"],
    ["funding", "Funding"],
    ["headcount", "Headcount"],
    ["recent_signal", "Signal"],
  ] as const;
  const updatedFields = updatedFieldLabels.filter(([col]) => artifactCellValue(artifact, activeRowId, col));
  const reviewSignals = updatedFieldLabels
    .filter(([col]) => REVIEW_SIGNAL_RE.test(artifactCellValue(artifact, activeRowId, col)))
    .map(([, label]) => label);
  const progressPct = Math.max(8, Math.round((completedRows.length / rows.length) * 100));
  const title = completedRows.length
    ? `${company} is ready for review`
    : `${rows.length} companies ready to enrich`;
  const body = completedRows.length
    ? reviewSignals.length
      ? `${reviewSignals.join(", ")} still need human judgment before this moves forward.`
      : `${updatedFields.length || evidenceCellCount} fields are backed by visible source metadata.`
    : `${pendingRows.length} pending companies can be enriched from the active research sheet.`;
  const prompts: ContextualPrompt[] = completedRows.length
    ? [
      { label: "Review sources", insert: `@nodeagent verify ${company} sources and flag any unsupported claims as needs review` },
      { label: "Find evidence gaps", insert: `@nodeagent identify remaining evidence gaps for ${company} and the company research sheet` },
      ...(pendingRows.length ? [{ label: "Enrich pending", insert: "@nodeagent enrich remaining pending companies with source-backed product, buyer, funding, and hiring facts" }] : []),
    ]
    : [
      { label: "Enrich companies", insert: "@nodeagent enrich selected companies with source-backed product, buyer, and funding facts" },
      { label: "Find evidence gaps", insert: "@nodeagent identify missing source evidence in the company research sheet" },
    ];
  return {
    artifactId: artifact.id,
    eyebrow: completedRows.length ? "Ready for review" : "Research queue",
    title,
    body,
    progressLabel: `${completedRows.length}/${rows.length} complete`,
    progressPct,
    metrics: [
      { label: "Complete", value: `${completedRows.length}/${rows.length}`, tone: completedRows.length ? "good" : "muted" },
      { label: "Sources", value: rowSources ? `${rowSources}` : "0", tone: rowSources ? "good" : "warn" },
      { label: "Updated", value: `${updatedFields.length}`, tone: updatedFields.length ? "good" : "muted" },
      { label: "Pending", value: `${pendingRows.length}`, tone: pendingRows.length ? "warn" : "good" },
    ],
    reviewSignals,
    prompts,
  };
}

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
  if (typeof value === "string") {
    const friendlyFailure = humanAgentFailureText(value);
    if (friendlyFailure !== value.trim()) return truncateAgentPreview(friendlyFailure);
  }
  const friendly = friendlyStreamPreview(value);
  if (friendly) return friendly;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const cleaned = text
    .replace(/\\"/g, "\"")
    .replace(/[{}[\]"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncateAgentPreview(cleaned);
}

function truncateAgentPreview(text: string): string {
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function humanAgentFailureText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (/tool_required_no_call_terminal|provider returned no tool call for \d+ required tool-use turns/i.test(normalized)) {
    return "Required tool call missing. NodeAgent checkpointed the trace and will resume with the required tool forced.";
  }
  if (/provider_egress_blocked:free_file_egress_requires_OPENROUTER_FREE_ALLOW_FILE_EGRESS/i.test(normalized)) {
    return "Provider blocked file egress for this free OpenRouter model. Use a route with file egress enabled or the local parser lane.";
  }
  if (/(openrouter|provider).*(402|insufficient credit)|(?:402|insufficient credit).*(openrouter|provider)/i.test(normalized)) {
    return "Provider route blocked by insufficient credits. Add OpenRouter credits or switch NodeAgent to a funded model route before rerunning.";
  }
  return normalized;
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
    case "you_search": return "Searched the web";
    case "you_research": return "Ran deep research";
    case "you_finance_research": return "Ran finance research";
    case "sec_facts": return "Fetched SEC filings";
    case "skill_search": return "Searched skills catalog";
    case "propose_lock": return "Locked target cells";
    case "edit_cell": return "Edited cell";
    case "create_draft": return "Drafted changes";
    case "update_wiki": return "Updated wiki";
    case "reconcile_cell": return "Reconciled cell";
    case "run_algorithm_artifact": return "Ran algorithm";
    case "source_open_literal": return "Read source values";
    default: return titleCaseToolName(toolName);
  }
}

function agentPartState(part: Exclude<AgentStreamPart, { type: "text" }>): string {
  if (isToolStreamPart(part)) return toolStateLabel(part);
  if (part.type === "reasoning" || part.type === "plan") return part.state === "streaming" || part.state === "started" ? "running" : part.state === "failed" ? "failed" : "done";
  if (part.state === "failed") return "failed";
  if (part.state === "started" || part.state === "streaming") return "running";
  if (part.state === "skipped") return "skipped";
  return "done";
}

function agentPartLabel(part: Exclude<AgentStreamPart, { type: "text" }>): string {
  if (part.type === "step-start") return part.title;
  if (part.type === "reasoning") return `Thoughts (step ${part.step + 1})`;
  if (part.type === "plan") return "Game plan";
  if (isToolStreamPart(part)) return agentActionLabel(part.toolName);
  if (part.type === "data-artifact") return "Published artifact";
  return part.title;
}

function agentPartPreview(part: Exclude<AgentStreamPart, { type: "text" }>): string {
  if (part.type === "step-start") return "";
  if (part.type === "reasoning") return part.text.slice(0, 120) + (part.text.length > 120 ? "..." : "");
  if (part.type === "plan") return part.text.slice(0, 120) + (part.text.length > 120 ? "..." : "");
  if (isToolStreamPart(part)) return previewStreamValue(part.output ?? part.input ?? part.error);
  if (part.type === "data-artifact") return part.title;
  return part.text || (part.error ? humanAgentFailureText(part.error) : "");
}

function agentPartPayload(part: Exclude<AgentStreamPart, { type: "text" }>): string {
  const payload: Record<string, unknown> = { type: part.type, state: part.state };
  if ("step" in part && typeof part.step === "number") payload.step = part.step + 1;
  if ("status" in part && part.status) payload.status = part.status;
  if ("toolName" in part) payload.toolName = part.toolName;
  if ("toolCallId" in part) payload.toolCallId = part.toolCallId;
  if ("input" in part && part.input !== undefined) payload.input = part.input;
  if ("output" in part && part.output !== undefined) payload.output = parseStreamPreviewJson(part.output);
  if ("text" in part && part.text) payload.text = part.text;
  if ("error" in part && part.error) payload.error = humanAgentFailureText(part.error);
  if ("metadata" in part && part.metadata) payload.metadata = part.metadata;
  if ("ms" in part && part.ms !== undefined) payload.ms = part.ms;
  return JSON.stringify(payload, null, 2);
}

function agentPartSummary(
  part: Exclude<AgentStreamPart, { type: "text" }>,
  index: number,
  icon: ReactNode,
  status: string,
  badge: string,
  label: string,
  preview: string,
): ReactNode {
  return (
    <details className="r-agent-part" key={`part-${part.type}-${index}`} data-part={part.type} data-status={status}>
      <summary>
        {icon}<b>{badge}</b><span>{label}</span>{preview && <em>{preview}</em>}
      </summary>
      <pre className="r-agent-part-payload">{agentPartPayload(part)}</pre>
    </details>
  );
}

function renderRawAgentPart(part: Exclude<AgentStreamPart, { type: "text" }>, index: number): ReactNode {
  if (part.type === "step-start") {
    return agentPartSummary(part, index, <ListChecks size={12} />, part.state, `step ${part.step + 1}`, part.title, "");
  }
  if (part.type === "reasoning") {
    return agentPartSummary(part, index, <Brain size={12} />, part.state, part.state, `Thoughts (step ${part.step + 1})`, part.text.slice(0, 200) + (part.text.length > 200 ? "..." : ""));
  }
  if (part.type === "plan") {
    return agentPartSummary(part, index, <Target size={12} />, part.state, part.state, "Game plan", part.text.slice(0, 200) + (part.text.length > 200 ? "..." : ""));
  }
  if (isToolStreamPart(part)) {
    const state = toolStateLabel(part);
    const preview = previewStreamValue(part.output ?? part.input ?? part.error);
    return agentPartSummary(part, index, <Database size={12} />, state, state, part.toolName, preview);
  }
  if (part.type === "data-artifact") {
    return agentPartSummary(part, index, <Paperclip size={12} />, part.state, part.state, part.title, "");
  }
  return agentPartSummary(part, index, <ShieldCheck size={12} />, part.state, part.state, part.title, part.text || (part.error ? humanAgentFailureText(part.error) : ""));
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
    if (part.type === "reasoning" || part.type === "plan") continue;
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stepStarts = parts.filter((part): part is Extract<AgentStreamPart, { type: "step-start" }> => part.type === "step-start");
  const stepCount = stepStarts.length;
  const maxSteps = stepStarts[0]?.metadata?.maxSteps as number | undefined;
  const currentStep = stepStarts.length > 0 ? (stepStarts[stepStarts.length - 1].metadata?.step as number | undefined) ?? stepCount : 0;
  const progressPct = maxSteps ? Math.min(100, Math.round((currentStep / maxSteps) * 100)) : 0;
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
    <section className="r-agent-workflow-progress sc-run" data-testid="agent-progress-card" data-status={hasFailure ? "failed" : hasRunning ? "running" : "done"}>
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
      {maxSteps ? (
        <div className="r-agent-progress-bar" data-testid="agent-progress-bar" role="progressbar" aria-valuenow={currentStep} aria-valuemin={0} aria-valuemax={maxSteps}>
          <div className="r-agent-progress-bar-fill" style={{ width: `${progressPct}%` }} />
          <span className="r-agent-progress-bar-label">Step {currentStep}/{maxSteps}</span>
        </div>
      ) : null}
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

function AgentPlanCard({ part }: { part: Extract<AgentStreamPart, { type: "plan" }>; live?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="r-agent-plan-card" data-testid="agent-plan-card" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Target size={13} /> <strong>Game plan</strong>
        {part.goal ? <em>Goal: {part.goal.slice(0, 80)}{part.goal.length > 80 ? "..." : ""}</em> : null}
      </summary>
      <div className="r-agent-plan-body">{part.text}</div>
    </details>
  );
}

function AgentReasoningCard({ part }: { part: Extract<AgentStreamPart, { type: "reasoning" }>; live?: boolean }) {
  const stateLabel = part.state === "streaming" || part.state === "started" ? "thinking" : part.state === "failed" ? "failed" : "done";
  return (
    <details className="r-agent-reasoning-card" data-testid="agent-reasoning-card" data-state={stateLabel}>
      <summary>
        <Brain size={12} /> <span>Thoughts (step {part.step + 1})</span>
        {stateLabel === "thinking" ? <RefreshCw size={10} className="r-spin" /> : <Check size={10} />}
      </summary>
      <div className="r-agent-reasoning-body">{part.text}</div>
    </details>
  );
}

function AgentUnifiedStream({ parts, live, fallbackText, terminalSuccessful }: { parts: AgentStreamPart[]; live?: boolean; fallbackText?: string; terminalSuccessful?: boolean }) {
  const displayParts = parts.length ? parts : fallbackText ? [{ type: "text" as const, text: fallbackText, state: live ? "streaming" as const : "done" as const }] : [];
  if (!displayParts.length) return null;
  const lastTextIndex = displayParts.map((part, index) => part.type === "text" ? index : -1).filter((index) => index >= 0).at(-1);
  const planPart = displayParts.find((part): part is Extract<AgentStreamPart, { type: "plan" }> => part.type === "plan");
  const reasoningParts = displayParts.filter((part): part is Extract<AgentStreamPart, { type: "reasoning" }> => part.type === "reasoning");
  const activityParts = displayParts.filter((part): part is Exclude<AgentStreamPart, { type: "text" | "reasoning" | "plan" }> => part.type !== "text" && part.type !== "reasoning" && part.type !== "plan");
  return (
    <div className="r-agent-unified-stream" data-testid="agent-unified-stream" aria-label="Unified agent response stream">
      {planPart ? <AgentPlanCard part={planPart} live={live} /> : null}
      {activityParts.length ? <AgentProgressCard parts={activityParts} live={live} terminalSuccessful={terminalSuccessful} /> : null}
      {reasoningParts.map((part, index) => <AgentReasoningCard key={`reasoning-${index}`} part={part} live={live} />)}
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
const AGENT_MODEL_PROVIDER_ORDER: LlmProvider[] = ["openrouter", "anthropic", "openai", "gemini", "xai", "nebius"];
const AGENT_MODEL_PROVIDER_LABELS: Record<LlmProvider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  xai: "xAI",
  nebius: "Nebius",
};
const AGENT_MODEL_PRESETS: Array<{ value: AgentModelSelection["mode"]; label: string }> = [
  { value: "adaptive", label: "Adaptive" },
  { value: "free", label: "Free" },
  { value: "top_paid", label: "Top paid" },
  { value: "specific", label: "Specific model" },
];

function hintForModelSelection(mode: AgentModelSelection["mode"]): string {
  switch (mode) {
    case "free": return "Routes NodeAgent through free-auto; uploaded-file jobs need an explicit server-side paid promotion.";
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

/* ─────────────── Chat-at-scale pure helpers (exported for tests/chatScale.test.ts) ───────────────
 * Day dividers, agent-run collapse, and the jump-to-latest threshold are pure O(n) functions so the
 * 312-message scale seed (roomStore.seedScaleMessages) renders without re-sorting or quadratic work. */

const DAY_MS = 86_400_000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local midnight for a timestamp — two messages share a divider iff they share a local calendar day. */
function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 'Today' | 'Yesterday' | 'Jun 30' (adds ', <year>' once the year differs from now's). Future
 *  timestamps (clock skew between optimistic rows and the server) read as 'Today', never a phantom date. */
export function chatDayLabel(ts: number, now: number = Date.now()): string {
  // Math.round absorbs DST days that are 23h/25h long — the diff is always within ±1h of a multiple of 24h.
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(ts)) / DAY_MS);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  const d = new Date(ts);
  const label = `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

export type ChatDayRow<T> =
  | { kind: "day"; key: string; label: string }
  | { kind: "row"; key: string; row: T };

/** Single pass over an already-sorted feed: a hairline divider row precedes the first entry of
 *  each local day. O(n) — no sorting, no date re-parsing beyond one Date per row. */
export function groupMessagesByDay<T extends { createdAt: number; key: string }>(rows: T[], now: number = Date.now()): ChatDayRow<T>[] {
  const out: ChatDayRow<T>[] = [];
  let lastDay = Number.NaN;
  for (const row of rows) {
    const day = startOfLocalDay(row.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      out.push({ kind: "day", key: `day-${day}`, label: chatDayLabel(row.createdAt, now) });
    }
    out.push({ kind: "row", key: row.key, row });
  }
  return out;
}

/** The run id lives in the message's clientMsgId — the job runner and streaming lane mint
 *  run-scoped ids (`pubstream-<jobId>` convex/streaming.ts, `final-<runId>` + `plan-blocked-<jobId>`
 *  convex/agent.ts, `privstream-<streamId>`). Human sends use crypto.randomUUID() so they can never
 *  match, and a spoofed prefix on a non-agent author is ignored. */
const AGENT_RUN_CLIENT_MSG_ID_RE = /^(?:pubstream|privstream|final|plan-blocked)-(.+)$/;

export function agentRunIdFor(message: { author: { kind: string }; clientMsgId?: string }): string | null {
  if (message.author.kind !== "agent") return null;
  const match = AGENT_RUN_CLIENT_MSG_ID_RE.exec(message.clientMsgId ?? "");
  return match ? match[1] : null;
}

export type ChatRunRow<T> =
  | { kind: "run"; key: string; runId: string; createdAt: number; rows: T[] }
  | { kind: "loose"; key: string; createdAt: number; row: T };

/** Collapse CONSECUTIVE same-run rows into one run row (O(n), one runIdFor call per row).
 *  A human message or a different run always closes the group — a person is never swallowed
 *  into an agent run and order is never re-sorted. When `isAgentRow` is provided, agent rows
 *  WITHOUT a run id (the runner's `say` posts use crypto.randomUUID()) are absorbed into the
 *  open run only when the SAME run id resumes right after them (provably sandwiched inside the
 *  run's span); otherwise they stay loose. */
export function groupAgentRuns<T extends { createdAt: number; key: string }>(
  rows: T[],
  runIdFor: (row: T) => string | null,
  isAgentRow?: (row: T) => boolean,
): ChatRunRow<T>[] {
  const out: ChatRunRow<T>[] = [];
  let buffer: T[] = []; // agent rows with no run id, provisionally inside the open run
  const flushLoose = () => {
    for (const buffered of buffer) out.push({ kind: "loose", key: buffered.key, createdAt: buffered.createdAt, row: buffered });
    buffer = [];
  };
  for (const row of rows) {
    const runId = runIdFor(row);
    const prev = out[out.length - 1];
    if (runId) {
      if (prev?.kind === "run" && prev.runId === runId) {
        prev.rows.push(...buffer, row); // the sandwich closed on the same run — the chatter was its own
        buffer = [];
      } else {
        flushLoose(); // buffered rows belonged to neither run — keep them loose, in order
        out.push({ kind: "run", key: `run-${runId}-${row.key}`, runId, createdAt: row.createdAt, rows: [row] });
      }
      continue;
    }
    if (prev?.kind === "run" && isAgentRow?.(row)) {
      buffer.push(row);
      continue;
    }
    flushLoose();
    out.push({ kind: "loose", key: row.key, createdAt: row.createdAt, row });
  }
  flushLoose();
  return out;
}

/** Default-collapse decision: only a FINISHED run long enough to be noise (>3 messages) starts
 *  collapsed. Live runs always render expanded so receipts/stream testids stay reachable. */
export function runCollapsedByDefault(messageCount: number, finished: boolean): boolean {
  return finished && messageCount > 3;
}

/** Jump-to-latest shows only when the reader is ≥2 viewports above the newest message. */
export function shouldShowJumpToLatest(distanceFromBottom: number, viewportHeight: number): boolean {
  return viewportHeight > 0 && distanceFromBottom >= viewportHeight * 2;
}

/** One agent run in the feed. Collapsed = one quiet line ("Run · N steps · view"); expanding
 *  restores every original row (and every pinned testid inside) untouched. A group that mounts
 *  while its run is live starts expanded and STAYS expanded after the run finishes — collapse
 *  defaults only apply to runs that were already finished when first rendered. */
function ChatRunGroup({ runId, live, count, children }: { runId: string; live: boolean; count: number; children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => !runCollapsedByDefault(count, !live));
  const open = live || expanded;
  if (!open) {
    return (
      <button
        type="button"
        className="r-chat-run-summary sc-run"
        data-testid="chat-run-summary"
        data-run-id={runId}
        onClick={() => setExpanded(true)}
        title="Expand this agent run"
      >
        <Sparkles size={11} aria-hidden />
        <span>Run · {count} step{count === 1 ? "" : "s"}</span>
        <em>view</em>
      </button>
    );
  }
  return (
    <section className="r-chat-run sc-run" data-testid="chat-run-group" data-run-id={runId} data-live={String(live)}>
      {children}
      {!live && runCollapsedByDefault(count, true) && (
        <button type="button" className="r-chat-run-collapse" data-testid="chat-run-collapse" onClick={() => setExpanded(false)}>
          <ChevronUp size={11} /> Collapse run
        </button>
      )}
    </section>
  );
}

type ChatFeedItem =
  | { kind: "message"; key: string; createdAt: number; message: Message }
  | { kind: "jobResult"; key: string; createdAt: number; status: string; text: string; streamParts: AgentStreamPart[] };

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
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [pendingVoiceCommand, setPendingVoiceCommand] = useState<RoomCommand | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadBusyRef = useRef(false);
  const voiceAbortRef = useRef<AbortController | null>(null);
  const voiceSttRef = useRef<SpeechToTextAdapter | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  const lastAgentInputRef = useRef<string | null>(null); // last public-agent request, for Regenerate
  const nearBottom = useRef(true);
  const [showJump, setShowJump] = useState(false); // "Jump to latest" pill when scrolled up ≥2 viewports
  const showJumpRef = useRef(false); // mirrors showJump for the scroll handler + unread effect
  const jumpBaselineRef = useRef(0); // messages already seen when the reader scrolled away
  const [jumpUnread, setJumpUnread] = useState(0); // new messages since scroll-away
  const thinkingStartCount = useRef(0);
  // Room-switch safety: a public @nodeagent or private-agent call is fire-and-forget. If the user leaves this room
  // before it resolves, the server action still finishes on its OWN room (every mutation is roomId-scoped,
  // so no cross-room bleed) — but the client must NOT setState or post into an unmounted/stale channel.
  // aliveRef gates those; privTimerRef cancels the memory-mode reply timer on unmount.
  const aliveRef = useRef(true);
  const privTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (privTimerRef.current) clearTimeout(privTimerRef.current);
      voiceAbortRef.current?.abort();
      void voiceSttRef.current?.stop?.();
    };
  }, []);
  const messages = store.listMessages(roomId, channel);
  const isPrivate = variant === "private";
  const longJob = isPrivate ? null : store.lastLongFreeJob();
  const longJobAttempts = isPrivate ? [] : store.lastLongFreeJobAttempts();
  const longJobDetail = isPrivate ? null : store.lastLongFreeJobDetail();
  const activeArtifact = useMemo(() => {
    if (!activeArtifactId || isPrivate) return undefined;
    return store.listArtifacts(roomId).find((a) => a.id === activeArtifactId);
  }, [activeArtifactId, isPrivate, roomId, store]);
  const decisionState = isPrivate ? null : buildResearchDecisionState(activeArtifact);
  // The decision card summarises a completed research run — it must stay visible once research lands
  // (i.e. after the @nodeagent request is sent, when messages exist). A prior `&& messages.length === 0`
  // empty-state gate hid it the moment a message was sent, breaking the "summarizes a completed
  // research run" contract (decision-assistant.spec).
  const showDecisionCard = !!decisionState;
  const pinnedAgentResearchReceipt = isPrivate ? null : buildAgentResearchReceipt(activeArtifact);
  const contextualPrompts = useMemo(() => {
    if (decisionState) return decisionState.prompts;
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
        { label: "@nodeagent organize the wall", insert: "@nodeagent organize the wall captures by risk level and assign follow-up owners" },
        { label: "@nodeagent diligence CardioNova", insert: "@nodeagent diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps" },
      ];
    }
    return NODEAGENT_PROMPTS;
  }, [activeArtifact, decisionState]);
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
  const slashOptions = useMemo(() => [] as { label: string; insert: string; hint: string }[], [store.mode]);
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
    const items: ChatFeedItem[] = messages.map((message) => ({
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
  // Chat at scale: collapse consecutive same-run agent messages, then slice the feed into local
  // days. Both passes are pure O(n) helpers (tested in tests/chatScale.test.ts) over the already
  // sorted feedItems, so the 312-message scale seed costs one linear walk per render.
  const feedRows = useMemo(
    () => groupMessagesByDay(groupAgentRuns(
      feedItems,
      (item) => item.kind === "message" ? agentRunIdFor(item.message) : null,
      (item) => item.kind === "message" && item.message.author.kind === "agent",
    )),
    [feedItems],
  );
  const activeRunId = !isPrivate && longJob ? String(longJob.id) : null;
  const showEmptyState = messages.length === 0 && failedSends.length === 0 && !showLongJobResult && !showAgentWorkingBubble;
  const beginThinking = () => { thinkingStartCount.current = messages.length; setAgentErr(null); setThinking(true); };

  useEffect(() => { const el = feedRef.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight; }, [messages.length, agentWorking, liveOperationStream.length, unifiedStreamParts.length]);
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
  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottom.current = fromBottom < 80; // autoscroll keeps following until the reader really leaves
    const far = shouldShowJumpToLatest(fromBottom, el.clientHeight); // chip only past 2 viewports
    if (far === showJumpRef.current) return;
    showJumpRef.current = far;
    if (far) jumpBaselineRef.current = messages.length; // start counting unread from scroll-away
    setJumpUnread(0);
    setShowJump(far);
  };
  // Unread badge: while the reader is scrolled away, count messages that landed after scroll-away.
  useEffect(() => {
    if (showJumpRef.current) setJumpUnread(Math.max(0, messages.length - jumpBaselineRef.current));
  }, [messages.length]);

  const grow = () => { const el = taRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; } };

  const composerModelSelection = (forceFree?: boolean): AgentModelSelection => {
    if (forceFree) return { mode: "free" };
    return modelSelectionMode === "specific"
      ? { mode: "specific", modelPolicy: specificModelPolicy || defaultSpecificModel || "gemini-3.5-flash" }
      : { mode: modelSelectionMode };
  };

  const voiceSessionId = () => {
    if (!voiceSessionIdRef.current) voiceSessionIdRef.current = `voice-${crypto.randomUUID()}`;
    return voiceSessionIdRef.current;
  };

  const composerSpeechToTextAdapters = (): SpeechToTextAdapter[] => {
    const requester = store.actorProof();
    const adapters = createVoiceSpeechToTextAdapters(
      CONVEX_SITE_URL && requester
        ? {
        siteUrl: CONVEX_SITE_URL,
        roomId,
        requester,
          providerMaxMs: 30_000,
        }
        : null,
    );
    if (!adapters.length) throw new Error("voice_input_unavailable");
    return adapters;
  };

  const voiceDispatchError = (result: VoiceDispatchResult): string => {
    if (result.ok) return "";
    if (result.kind === "no_active_job") return "No active agent job to cancel.";
    if (result.kind === "rejected") return "Voice command cancelled.";
    return result.reason || "Voice command failed.";
  };

  const clearVoiceInput = () => {
    setText("");
    setRefs([]);
    setVoiceTranscript("");
    requestAnimationFrame(grow);
  };

  const dispatchVoiceFromComposer = (command: RoomCommand) => {
    setPendingVoiceCommand(null);
    setVoiceErr(null);
    const agentCommand = command.kind === "public_agent_request" || command.kind === "private_agent_request";
    if (agentCommand) beginThinking();
    if (command.kind === "public_agent_request") lastAgentInputRef.current = command.transcript || `@nodeagent ${command.commandText}`;
    clearVoiceInput();
    void dispatchRoomCommand(store as unknown as VoiceRoomStore, command)
      .then((result) => {
        if (!aliveRef.current) return;
        if (!result.ok) {
          setVoiceErr(voiceDispatchError(result));
          if (agentCommand) setThinking(false);
        }
      })
      .catch((e) => {
        if (!aliveRef.current) return;
        setVoiceErr(agentErrorText(e));
        if (agentCommand) setThinking(false);
      })
      .finally(() => {
        if (!aliveRef.current) return;
        if (command.kind === "private_agent_request") setThinking(false);
      });
  };

  const handleVoiceTranscript = (transcript: string, confidence?: number) => {
    const command = classifyVoiceTranscript({
      roomId,
      actor: me,
      channel,
      transcript,
      privateMode: isPrivate,
      publishPrivateToRoom: roomLane,
      modelSelection: composerModelSelection(),
      contextArtifactId: activeArtifactId,
      references: refs,
      now: Date.now(),
    });
    if (command.kind === "confirm_pending_command") {
      if (pendingVoiceCommand) dispatchVoiceFromComposer(confirmCommand(pendingVoiceCommand));
      else setVoiceErr("No voice command is waiting for confirmation.");
      return;
    }
    if (command.kind === "reject_pending_command") {
      setPendingVoiceCommand(null);
      setVoiceErr(null);
      clearVoiceInput();
      return;
    }
    if (command.requiresConfirmation && !command.confirmed) {
      setPendingVoiceCommand(command);
      setVoiceTranscript(transcript);
      setVoiceErr(confidence !== undefined && confidence < 0.7 ? "Low-confidence transcript. Confirm before routing it." : null);
      return;
    }
    dispatchVoiceFromComposer(command);
  };

  const stopVoiceInput = (opts: { cancel?: boolean } = {}) => {
    if (opts.cancel !== false) voiceAbortRef.current?.abort();
    void voiceSttRef.current?.stop?.();
    voiceAbortRef.current = null;
    voiceSttRef.current = null;
    setVoiceListening(false);
  };

  const recoverableVoiceStartError = (error: unknown): boolean => {
    const text = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    return /voice_provider_microphone_unavailable|voice_provider_media_recorder_unavailable|voice_input_unavailable|speech_recognition_unavailable|microphone_unavailable|media_recorder_unavailable|notallowed|permission|denied|not-allowed|audio-capture|no-speech/i.test(text);
  };

  const toggleVoiceInput = () => {
    if (voiceListening) {
      stopVoiceInput({ cancel: false });
      return;
    }
    setVoiceErr(null);
    setPendingVoiceCommand(null);
    setVoiceTranscript("");
    const controller = new AbortController();
    let adapters: SpeechToTextAdapter[];
    try {
      adapters = composerSpeechToTextAdapters();
    } catch (e) {
      setVoiceErr(e instanceof Error && /voice_input_unavailable|speech_recognition_unavailable/i.test(e.message)
        ? "Voice input is not available in this browser."
        : agentErrorText(e));
      return;
    }
    voiceAbortRef.current = controller;
    setVoiceListening(true);
    void (async () => {
      let lastError: unknown = null;
      for (const stt of adapters) {
        if (controller.signal.aborted) return;
        voiceSttRef.current = stt;
        try {
          const stream = await stt.start({
            roomId,
            actor: me,
            channel,
            privateMode: isPrivate,
            publishPrivateToRoom: roomLane,
            modelSelection: composerModelSelection(),
            contextArtifactId: activeArtifactId,
            references: refs,
            locale: typeof navigator === "undefined" ? undefined : navigator.language,
            sessionId: voiceSessionId(),
            signal: controller.signal,
          });
          for await (const chunk of stream) {
            if (!aliveRef.current || controller.signal.aborted) return;
            const heard = chunk.text.trim();
            if (heard) {
              setVoiceTranscript(heard);
              setText(heard);
              requestAnimationFrame(grow);
            }
            if (chunk.isFinal && heard) {
              stopVoiceInput({ cancel: true });
              handleVoiceTranscript(heard, chunk.confidence);
              return;
            }
          }
          return;
        } catch (error) {
          lastError = error;
          void stt.stop?.();
          if (!recoverableVoiceStartError(error)) throw error;
        }
      }
      throw lastError ?? new Error("voice_input_unavailable");
    })()
      .catch((e) => {
        if (!aliveRef.current || controller.signal.aborted) return;
        setVoiceErr(e instanceof Error && /voice_input_unavailable|speech_recognition_unavailable|microphone_unavailable|media_recorder_unavailable/i.test(e.message)
          ? "Voice input is not available in this browser."
          : agentErrorText(e));
      })
      .finally(() => {
        if (aliveRef.current && voiceAbortRef.current === controller) {
          voiceAbortRef.current = null;
          voiceSttRef.current = null;
          setVoiceListening(false);
        }
      });
  };

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

    const publicNodeAgentRequest = !isPrivate ? parsePublicNodeAgentRequest(t) : null;
    if (publicNodeAgentRequest) {
      const modelSelection = composerModelSelection(publicNodeAgentRequest.forceFree);
      beginThinking();
      lastAgentInputRef.current = t;
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
  const rootClass = `${embedded ? `r-chat-embedded nr-chat-panel ${isPrivate ? "private" : "public"}` : `r-panel nr-panel nr-chat-panel ${isPrivate ? "right nr-panel--right" : "center nr-panel--center"}`}${isPrivate ? "" : " fx-chat"}`;

  // One feed item — a chat/agent Bubble or the long-job result card. Shared by loose rows and
  // expanded run groups so every existing testid (receipts, unified stream) renders identically.
  const renderFeedItem = (item: ChatFeedItem) => item.kind === "message" ? (
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
    <div className="r-msg fx-msg agent" key={item.key} data-testid="agent-job-result" data-state={item.status}>
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
  );

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
        {!isPrivate && messages.length > 0 && <span className="r-tag">{messages.length}</span>}
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
          {longJobVisibleError && <span>{humanAgentFailureText(longJobVisibleError)}</span>}
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

      {showDecisionCard && (
        <DecisionAssistantPanel state={decisionState} onPrompt={applySlash} />
      )}
      {pinnedAgentResearchReceipt && (
        <div className="r-pinned-agent-receipt" data-testid="pinned-agent-research-receipt">
          <AgentResearchReceiptStrip receipt={pinnedAgentResearchReceipt} onOpenArtifact={onOpenArtifact} />
        </div>
      )}

      <div className="r-chat" ref={feedRef} onScroll={onScroll} aria-live="polite" data-testid="chat-feed">
        {showEmptyState && (
          <div className="r-chat-empty" data-testid={isPrivate ? "private-chat-empty" : "public-chat-empty"}>
            <span>{isPrivate ? "Ask your NodeAgent privately, or switch it to Room mode." : emptyStateHint}</span>
            {!isPrivate && (
              <button className="r-mini-btn primary" type="button" data-testid="chat-empty-agent-cta" onClick={() => send(contextualPrompts[0]?.insert ?? NODEAGENT_PROMPTS[0].insert)}>
                <Sparkles size={12} /> Ask NodeAgent
              </button>
            )}
          </div>
        )}
        {agentErr && <div className="r-msg fx-msg" role="alert" data-testid="agent-error" data-state="failed"><div className="body tiny" style={{ color: "var(--danger-ink)" }}>{agentErr}</div></div>}
        {feedRows.map((dayRow) => {
          if (dayRow.kind === "day") {
            return (
              <div className="r-chat-day" key={dayRow.key} data-testid="chat-day-divider" role="separator" aria-label={dayRow.label}>
                <span>{dayRow.label}</span>
              </div>
            );
          }
          const runRow = dayRow.row;
          if (runRow.kind === "run") {
            // Live = this run's job is still executing, or one of its rows is still streaming its body.
            const live = (!!activeRunId && runRow.runId === activeRunId && !longJobTerminal)
              || runRow.rows.some((item) => item.kind === "message" && !!item.message.streamId && !item.message.text);
            return (
              <ChatRunGroup key={runRow.key} runId={runRow.runId} live={live} count={runRow.rows.length}>
                {runRow.rows.map(renderFeedItem)}
              </ChatRunGroup>
            );
          }
          return renderFeedItem(runRow.row);
        })}
        {failedSends.map((f) => (
          <div className="r-msg fx-msg" key={"fail-" + f.cid} data-testid="chat-failed" data-state="failed">
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
        {showAgentWorkingBubble && (
          <div className="r-msg fx-msg agent" aria-label={`${agentName} is ${longJobActive && longJob ? longJob.status : "thinking"}`}>
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
        {showJump && (
          <button
            type="button"
            className="r-chat-jump"
            data-testid="chat-jump-latest"
            data-unread={jumpUnread}
            onClick={() => { const el = feedRef.current; if (el) { el.scrollTop = el.scrollHeight; nearBottom.current = true; showJumpRef.current = false; setJumpUnread(0); setShowJump(false); } }}
          >
            <ChevronDown size={13} />
            {jumpUnread > 0 && <b className="r-chat-jump-count" data-testid="chat-jump-unread">{jumpUnread} new</b>}
            Jump to latest
          </button>
        )}
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
        {voiceListening && <div className="r-voice-status" role="status" data-testid="chat-voice-status"><Mic size={12} /> {voiceTranscript || "Listening"}</div>}
        {voiceErr && <div className="r-upload-error r-voice-error" role="alert" data-testid="chat-voice-error">{voiceErr}</div>}
        {pendingVoiceCommand && (
          <div className="r-voice-confirm" data-testid="chat-voice-confirm" role="group" aria-label="Confirm voice command">
            <span>{pendingVoiceCommand.confirmationPrompt ?? "Confirm voice command"}</span>
            <button type="button" onClick={() => dispatchVoiceFromComposer(confirmCommand(pendingVoiceCommand))} data-testid="chat-voice-confirm-yes">Confirm</button>
            <button type="button" onClick={() => { setPendingVoiceCommand(null); clearVoiceInput(); }} data-testid="chat-voice-confirm-no">Cancel</button>
          </div>
        )}
        <div className="r-intake-preview-slot">
          {text.trim().length > 0 && <IntakePlanPreview roomId={roomId} text={text} targetArtifacts={refs.map((r) => r.id)} />}
        </div>
        <div className="r-input-wrap r-input-stack rm-chatin">
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
            placeholder={isPrivate ? (roomLane ? "Tell your agent to act in the room…" : "Ask privately…") : "Message the room or @nod"}
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
            <button
              className="r-attach r-voice-btn"
              type="button"
              onClick={toggleVoiceInput}
              data-active={String(voiceListening)}
              data-testid="chat-voice"
              aria-pressed={voiceListening}
              aria-label={voiceListening ? "Stop voice input" : "Start voice input"}
              title={voiceListening ? "Stop voice input" : "Start voice input"}
            >
              {voiceListening ? <MicOff size={15} /> : <Mic size={15} />}
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
            {longJobActive ? (
              <button className="r-send send r-send-stop" onClick={cancelJob} disabled={jobBusy !== null} data-testid="chat-stop" title="Stop generating" aria-label="Stop generating"><Square size={13} /></button>
            ) : (
              <button className="r-send send" onClick={() => send()} disabled={!canSend} data-testid="chat-send" aria-label="Send message"><Send size={15} /></button>
            )}
          </div>
        </div>
        {!isPrivate && !slashOpen && (
          <div className="r-composer-hint">
            {longJobTerminal && lastAgentInputRef.current && (
              <button className="r-chip r-chip-regen" data-testid="chat-regenerate" title="Run the last agent request again" onClick={() => send(lastAgentInputRef.current!)}><RefreshCw size={11} /> Regenerate</button>
            )}
            {contextualPrompts.map((prompt) => <button key={prompt.insert} className="r-chip" onClick={() => applySlash(prompt.insert)}>{prompt.label}</button>)}
            <span className="r-composer-kbd" aria-hidden="true">Enter sends; Shift+Enter newline; @nodeagent acts</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionAssistantPanel({ state, onPrompt }: { state: DecisionAssistantState; onPrompt: (prompt: string) => void }) {
  return (
    <section className="r-decision-card" data-testid="decision-assistant" aria-label="Decision summary">
      <div className="r-decision-head">
        <span className="r-decision-icon" aria-hidden><ListChecks size={14} /></span>
        <div>
          <span className="r-decision-eyebrow">{state.eyebrow}</span>
          <strong>{state.title}</strong>
        </div>
      </div>
      <div className="r-decision-progress" aria-label={state.progressLabel}>
        <span style={{ width: `${state.progressPct}%` }} />
        <b>{state.progressLabel}</b>
      </div>
      <div className="r-decision-metrics">
        {state.metrics.map((metric) => (
          <span key={metric.label} data-tone={metric.tone ?? "muted"}>
            <b>{metric.value}</b>
            <em>{metric.label}</em>
          </span>
        ))}
      </div>
      <p>{state.body}</p>
      {state.reviewSignals.length > 0 && (
        <div className="r-decision-review" data-testid="decision-review-signals">
          <ShieldCheck size={12} />
          <span>{state.reviewSignals.join(", ")}</span>
        </div>
      )}
      <div className="r-decision-actions">
        {state.prompts.slice(0, 3).map((prompt) => (
          <button key={prompt.insert} type="button" onClick={() => onPrompt(prompt.insert)}>
            {prompt.label}
          </button>
        ))}
      </div>
    </section>
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

function AgentResearchReceiptStrip({
  receipt,
  onOpenArtifact,
}: {
  receipt: AgentResearchReceipt;
  onOpenArtifact?: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
}) {
  return (
    <div className="r-agent-receipt sc-run" data-testid="agent-research-receipt">
      <button
        type="button"
        className="r-agent-receipt-main"
        data-testid="agent-view-row"
        onClick={() => onOpenArtifact?.(receipt.artifactId, { split: true, elementId: receipt.cellId })}
      >
        <ChevronRight size={12} />
        <span>Reconciled 2 rows · <b data-testid="agent-source-receipt">{receipt.sourceCount} sources</b></span>
      </button>
      <span className="r-agent-receipt-version" data-testid="agent-version-receipt">
        v{receipt.fromVersion} -&gt; v{receipt.toVersion}
      </span>
      <span className="r-agent-receipt-chip" data-testid="agent-lock-released-receipt"><Lock size={12} /> lock released</span>
      <span className="r-agent-receipt-quote" style={{ gridColumn: "1 / -1" }}>
        <b>{receipt.company}</b>
        <span>{receipt.sourceLabel}: {receipt.sourceDetail}</span>
      </span>
    </div>
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
  // Sync receipt: the optimistic row wears "saving…"; when the server row replaces it, the Bubble
  // survives the swap (its feed key is the shared clientMsgId), so the same instance observes
  // pending→confirmed and flips to a "synced" chip that fades out.
  const wasPendingRef = useRef(pending);
  const [justSynced, setJustSynced] = useState(false);
  useEffect(() => {
    const wasPending = wasPendingRef.current;
    wasPendingRef.current = pending;
    if (!wasPending || pending) return;
    setJustSynced(true);
    const timer = setTimeout(() => setJustSynced(false), 1800);
    return () => clearTimeout(timer);
  }, [pending]);
  const agentResearchReceipt = useMemo(() => {
    if (!agent || !/Researched\s+\d+\s+compan/i.test(parsed.body)) return null;
    const research = store.listArtifacts(roomId).find((a) => a.kind === "sheet" && /company|research/i.test(a.title ?? ""));
    return buildAgentResearchReceipt(research);
  }, [agent, parsed.body, roomId, store]);
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
    <div className={"r-msg fx-msg" + (agent ? " agent" : "")} data-testid="chat-message" data-clientmsgid={m.clientMsgId} data-state={pending ? "pending" : "confirmed"} style={pending ? { opacity: 0.6 } : undefined}>
      <span className={"r-avatar sm" + (agent ? " agent" : "")} style={avatarStyle}>{agent ? "N" : initials(m.author.name)}</span>
      <div className="body">
        <div className="meta">
          <span className="who">{m.author.name}</span>
          {agent && <span className="r-tag agent" style={{ padding: "1px 5px", fontSize: 9 }}>agent</span>}
          {viaOwner && <span className="r-tag" data-testid="agent-via" style={{ padding: "1px 5px", fontSize: 9 }}>via {viaOwner}</span>}
          {pending && <span className="r-tag r-chat-sync" data-testid="chat-pending" data-sync="saving">saving…</span>}
          {!pending && justSynced && <span className="r-tag r-chat-sync" data-testid="chat-synced" data-sync="synced">synced</span>}
          <span className="time">{clock(m.createdAt)}</span>
        </div>
        {editing ? (
          <div className="r-input-wrap rm-chatin" style={{ marginTop: 4 }}>
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
            ) : agentResearchReceipt ? null : (
              parsed.body && (ask ? <span className="r-bubble-ask fx-cmd">{parsed.body}</span> : <MarkdownBody text={parsed.body} />)
            )}
            {agentResearchReceipt && <AgentResearchReceiptStrip receipt={agentResearchReceipt} onOpenArtifact={onOpenArtifact} />}
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
