export const NODEAGENT_TRACE_SCHEMA = "nodeagent.trace.v1" as const;

export type TraceTriggerKind =
  | "chat"
  | "notebook"
  | "spreadsheet"
  | "passive"
  | "benchmark"
  | "ui_test";

export type TraceRefKind =
  | "artifact"
  | "cell"
  | "source"
  | "screenshot"
  | "video"
  | "context_pack"
  | "tool_result"
  | "mutation"
  | "approval"
  | "eval"
  | "memory"
  | "frame"
  | "cache"
  | "okf"
  | "ui_surface";

export interface TraceRef {
  refId: string;
  kind: TraceRefKind | string;
  label?: string;
  uri?: string;
  hash?: string;
  redacted?: boolean;
}

export interface NodeAgentTraceTrigger {
  kind: TraceTriggerKind;
  userId?: string;
  prompt?: string;
  selectedArtifactIds: string[];
  openedSurface?: string;
  clientScreenContext?: {
    activePanel: string;
    selectedRange?: string;
    visibleArtifactRefs: string[];
  };
}

export interface NodeAgentTracePlan {
  goal: string;
  plannedReads: TraceRef[];
  plannedWrites: TraceRef[];
  approvalRequired: boolean;
  estimatedCostUsd?: number;
  riskFlags: string[];
}

export interface NodeAgentTraceContextPack {
  worldModelHash: string;
  includedRefs: TraceRef[];
  excludedRefs: Array<{
    ref: TraceRef;
    reason: "privacy" | "irrelevant" | "too_large" | "stale";
  }>;
}

export type TraceStepPhase =
  | "observe"
  | "plan"
  | "retrieve"
  | "tool_call"
  | "evidence_capture"
  | "reason"
  | "proposal"
  | "mutation"
  | "approval"
  | "eval"
  | "ui_verify";

export interface TraceToolReceipt {
  name: string;
  argsHash: string;
  resultHash: string;
  status: "ok" | "failed" | "cached" | "skipped";
  latencyMs?: number;
  costUsd?: number;
  sourceRefs?: TraceRef[];
}

export interface TraceStep {
  stepId: string;
  traceId: string;
  phase: TraceStepPhase;
  title: string;
  summary: string;
  inputRefs: TraceRef[];
  outputRefs: TraceRef[];
  model?: {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
  tool?: TraceToolReceipt;
  visual?: {
    screenshotRef?: string;
    bbox?: { x: number; y: number; w: number; h: number };
    videoRef?: string;
  };
  timings: {
    startedAt: number;
    endedAt?: number;
    latencyMs?: number;
  };
  verdict?: {
    status: "ok" | "warning" | "blocked" | "failed";
    reason?: string;
  };
}

export interface EvidenceReceipt {
  receiptId: string;
  traceId: string;
  label: string;
  sourceRefs: TraceRef[];
  artifactRefs: TraceRef[];
  factHash?: string;
  verifier?: string;
  confidence?: number;
  status: "verified" | "needs_review" | "rejected";
}

export interface MutationReceipt {
  receiptId: string;
  traceId: string;
  targetRefs: TraceRef[];
  beforeHash?: string;
  afterHash?: string;
  baseVersion?: number;
  payloadHash: string;
  status: "proposed" | "committed" | "skipped" | "conflict" | "pending_approval";
}

export interface ApprovalReceipt {
  receiptId: string;
  traceId: string;
  approverId?: string;
  targetRefs: TraceRef[];
  decision: "approved" | "rejected" | "needs_changes" | "auto_allowed";
  decidedAt: number;
}

export interface ReworkLedgerEntry {
  id: string;
  date: string;
  oldApproach: string;
  whyItSeemedRight: string;
  failureObserved: string;
  traceRefs: string[];
  decision: "reverted" | "reworked" | "kept_with_limits";
  newApproach: string;
  whyNewApproachIsBetter: string;
  lesson: string;
  affectedFiles: string[];
  testOrEvalProof: string[];
}

export interface NodeAgentTrace {
  schema: typeof NODEAGENT_TRACE_SCHEMA;
  traceId: string;
  roomId?: string;
  agentJobId?: string;
  createdAt: number;
  updatedAt: number;
  trigger: NodeAgentTraceTrigger;
  plan: NodeAgentTracePlan;
  contextPack: NodeAgentTraceContextPack;
  steps: TraceStep[];
  evidence: EvidenceReceipt[];
  mutations: MutationReceipt[];
  approvals: ApprovalReceipt[];
  eval: {
    benchmarkCaseId?: string;
    score?: number;
    passed?: boolean;
    failureClass?: string;
    proofArtifacts: TraceRef[];
  };
  final: {
    outputArtifactRefs: TraceRef[];
    summary: string;
    status: "completed" | "failed" | "needs_review" | "cancelled";
  };
  reworkLedger?: ReworkLedgerEntry[];
}
