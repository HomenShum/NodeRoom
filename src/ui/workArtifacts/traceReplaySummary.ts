import type { Proposal, TraceEvent, TraceType } from "../../engine/types";
import type { WorkArtifactStatus } from "./workArtifactTypes";

export type TraceReplayPhaseKind = "room" | "agent" | "edit" | "review" | "notebook" | "chat";

export interface TraceReplayPhase {
  id: TraceReplayPhaseKind;
  label: string;
  status: WorkArtifactStatus;
  traceIds: string[];
  artifactIds: string[];
  proposalIds: string[];
  startAt?: number;
  endAt?: number;
  summary: string;
}

export interface TraceReplaySummary {
  roomId: string;
  eventCount: number;
  status: WorkArtifactStatus;
  traceIds: string[];
  proposalIds: string[];
  artifactIds: string[];
  phases: TraceReplayPhase[];
  criticalPath: TraceReplayPhase[];
  replayHash: string;
}

const PHASE_LABEL: Record<TraceReplayPhaseKind, string> = {
  room: "Room setup",
  agent: "Agent work",
  edit: "Artifact edits",
  review: "Review decisions",
  notebook: "Notebook read model",
  chat: "Chat and messages",
};

const PHASE_ORDER: TraceReplayPhaseKind[] = ["room", "chat", "agent", "edit", "review", "notebook"];

function phaseOf(type: TraceType): TraceReplayPhaseKind {
  if (type === "room_created" || type === "member_joined" || type === "auto_allow_toggled") return "room";
  if (type === "message") return "chat";
  if (type.startsWith("notebook_") || type === "agent_work_plan_proposed" || type === "agent_work_plan_approved") return "notebook";
  if (type.includes("proposal") || type.includes("draft") || type.includes("conflict")) return "review";
  if (type.includes("edit") || type.includes("lock") || type === "schema_changed") return "edit";
  return "agent";
}

function traceStatus(trace: TraceEvent): WorkArtifactStatus {
  const text = `${trace.type} ${trace.summary} ${trace.detail ?? ""}`;
  if (/\b(failed|blocked|denied|conflict|error)\b/i.test(text)) return "failed";
  if (/\b(proposal|proposed|review|pending|needs[_\s-]?review|draft)\b/i.test(text)) return "needs_review";
  if (trace.type === "agent_status" && /\b(working|running|started)\b/i.test(text)) return "running";
  return "ready";
}

function rollup(statuses: WorkArtifactStatus[]): WorkArtifactStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("needs_review") || statuses.includes("pending")) return "needs_review";
  return statuses.length ? "ready" : "empty";
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function phaseSummary(kind: TraceReplayPhaseKind, traces: TraceEvent[], proposals: Proposal[]): string {
  if (traces.length === 0) return "No events recorded.";
  const failed = traces.filter((trace) => traceStatus(trace) === "failed").length;
  const review = traces.filter((trace) => traceStatus(trace) === "needs_review").length;
  const proposalCount = unique([...traces.map((trace) => trace.refs?.proposalId), ...proposals.map((proposal) => proposal.id)]).length;
  const parts = [`${traces.length} event${traces.length === 1 ? "" : "s"}`];
  if (proposalCount > 0 && (kind === "review" || kind === "edit")) parts.push(`${proposalCount} proposal${proposalCount === 1 ? "" : "s"}`);
  if (review > 0) parts.push(`${review} review`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" - ");
}

export function buildTraceReplaySummary(args: {
  roomId: string;
  traces: TraceEvent[];
  proposals?: Proposal[];
}): TraceReplaySummary {
  const proposals = args.proposals ?? [];
  const traces = [...args.traces].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const byPhase = new Map<TraceReplayPhaseKind, TraceEvent[]>();
  for (const kind of PHASE_ORDER) byPhase.set(kind, []);
  for (const trace of traces) byPhase.get(phaseOf(trace.type))?.push(trace);

  const phases = PHASE_ORDER.map((kind): TraceReplayPhase => {
    const phaseTraces = byPhase.get(kind) ?? [];
    const statuses = phaseTraces.map(traceStatus);
    const traceProposalIds = unique(phaseTraces.map((trace) => trace.refs?.proposalId));
    const phaseProposals = proposals.filter((proposal) => traceProposalIds.includes(proposal.id) || phaseTraces.some((trace) => trace.refs?.artifactId === proposal.artifactId));
    return {
      id: kind,
      label: PHASE_LABEL[kind],
      status: rollup(statuses),
      traceIds: phaseTraces.map((trace) => trace.id),
      artifactIds: unique(phaseTraces.map((trace) => trace.refs?.artifactId)),
      proposalIds: unique([...traceProposalIds, ...phaseProposals.map((proposal) => proposal.id)]),
      startAt: phaseTraces[0]?.ts,
      endAt: phaseTraces[phaseTraces.length - 1]?.ts,
      summary: phaseSummary(kind, phaseTraces, phaseProposals),
    };
  }).filter((phase) => phase.traceIds.length > 0);

  const status = rollup(phases.map((phase) => phase.status));
  const traceIds = traces.map((trace) => trace.id);
  const proposalIds = unique([...phases.flatMap((phase) => phase.proposalIds), ...proposals.map((proposal) => proposal.id)]);
  const artifactIds = unique(phases.flatMap((phase) => phase.artifactIds));
  const criticalPath = phases.filter((phase) => phase.status !== "ready").length
    ? phases.filter((phase) => phase.status !== "ready")
    : phases.slice(-3);
  const replayHash = stableHash({
    roomId: args.roomId,
    traceIds,
    proposalIds,
    artifactIds,
    phases: phases.map((phase) => ({
      id: phase.id,
      traceIds: phase.traceIds,
      status: phase.status,
      proposalIds: phase.proposalIds,
    })),
  });

  return {
    roomId: args.roomId,
    eventCount: traces.length,
    status,
    traceIds,
    proposalIds,
    artifactIds,
    phases,
    criticalPath,
    replayHash,
  };
}
