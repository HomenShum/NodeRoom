export const mediaDimensions = [
  "featureClarity",
  "workflowCompleteness",
  "visualDesign",
  "consistency",
  "evidenceQuality",
  "legibility",
  "professionalRelevance",
  "productionHonesty",
] as const;

export const uiUxWeights = {
  workflowClarity: 12,
  firstThirtySecondMagic: 10,
  visualHierarchyDensity: 10,
  professionalRelevance: 10,
  responsivenessInteraction: 12,
  artifactLegibility: 10,
  evidenceTraceClarity: 12,
  accessibility: 8,
  agentCollaborationState: 8,
  shareabilityViralityLoop: 8,
} as const;

export const designPerformanceBudgets = {
  maxInteractionLatencyMs: 300,
  timeToOptimisticBubbleMs: 100,
  timeToEvidencePreviewMs: 300,
  maxLongTasks: 0,
  maxCls: 0.1,
} as const;

export type MediaDimension = (typeof mediaDimensions)[number];
export type UiUxDimension = keyof typeof uiUxWeights;
export type GateStatus = "passed" | "failed" | "not_run";
export type DesignVerdict =
  | "ship"
  | "ship_but_media_needs_polish"
  | "needs_functional_gate"
  | "functional_blocker"
  | "design_blocker"
  | "accessibility_blocker";

export type DesignDefect = {
  severity: "P0" | "P1" | "P2" | "P3";
  title: string;
  evidenceFrame?: string;
};

export type FunctionalGate = {
  status: GateStatus;
  tests: Array<{ name: string; status: GateStatus; evidencePath?: string }>;
};

export type PerformanceLayer = {
  status: GateStatus;
  evidencePath?: string;
  inpP75?: number;
  lcp?: number;
  cls?: number;
  longTasks: number;
  maxInteractionLatencyMs?: number;
  timeToOptimisticBubbleMs?: number;
  timeToFirstAgentChunkMs?: number;
  timeToEvidencePreviewMs?: number;
};

export type AccessibilityLayer = {
  status: GateStatus;
  evidencePath?: string;
  axeViolations?: number;
  deterministicViolations?: number;
  keyboardPathPassed?: boolean;
  reducedMotionPassed?: boolean;
  screenReaderNotes: string[];
};

export type MediaJudgeLayer = {
  model: string;
  total: number;
  max: number;
  dimensions: Partial<Record<MediaDimension, number>>;
  defects: DesignDefect[];
};

export type DesignReferenceComparison = {
  referenceApp: string;
  borrowedConvention: string;
  nodeRoomScreen: string;
  score: number;
  note: string;
};

export type ViralitySignals = {
  roomInviteVisible: boolean;
  shareActionVisible: boolean;
  timeToShareSeconds?: number;
  downstreamHandoffVisible: boolean;
  notificationDeepLinkVisible: boolean;
};

export type DesignQualityRunInput = {
  runId: string;
  commitSha: string;
  appUrl: string;
  createdAt: string;
  scenario:
    | "first_30s_capture"
    | "live_room_collab"
    | "agent_work_plan"
    | "spreadsheet_conflict"
    | "evidence_hover"
    | "coach_mode"
    | "mobile_capture"
    | "landing_to_room";
  artifacts: {
    videoPath?: string;
    screenshots: string[];
    domSnapshots: string[];
    tracePath?: string;
    perfTracePath?: string;
    convexRunIds: string[];
  };
  functionalGate: FunctionalGate;
  performance: PerformanceLayer;
  accessibility: AccessibilityLayer;
  mediaJudge?: MediaJudgeLayer;
  referenceComparisons: DesignReferenceComparison[];
  viralitySignals: ViralitySignals;
};

export type DesignQualityRun = DesignQualityRunInput & {
  productCorrectnessScore: "pass_fail_only";
  uiUxScore: {
    total: number;
    max: 100;
    dimensions: Record<UiUxDimension, number>;
  };
  verdict: DesignVerdict;
  blockers: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mediaRatio(media: MediaJudgeLayer | undefined, ...keys: MediaDimension[]) {
  if (!media) return 0;
  const values = keys.map((key) => media.dimensions[key]).filter((value): value is number => typeof value === "number");
  if (!values.length) return 0;
  return clamp(values.reduce((sum, value) => sum + value, 0) / (values.length * 2), 0, 1);
}

function referenceRatio(references: DesignReferenceComparison[]) {
  if (!references.length) return 0;
  return clamp(references.reduce((sum, ref) => sum + ref.score, 0) / (references.length * 2), 0, 1);
}

function viralityRatio(signals: ViralitySignals) {
  const checks = [
    signals.roomInviteVisible,
    signals.shareActionVisible,
    signals.downstreamHandoffVisible,
    signals.notificationDeepLinkVisible,
    typeof signals.timeToShareSeconds === "number" && signals.timeToShareSeconds <= 30,
  ];
  return checks.filter(Boolean).length / checks.length;
}

function performanceRatio(performance: PerformanceLayer) {
  if (performance.status === "failed") return 0;
  if (performance.status === "not_run") return 0;
  const checks = Object.values(designPerformanceChecks(performance));
  return checks.filter(Boolean).length / checks.length;
}

export function designPerformanceChecks(performance: PerformanceLayer) {
  return {
    maxInteractionLatencyMs: typeof performance.maxInteractionLatencyMs === "number" && performance.maxInteractionLatencyMs <= designPerformanceBudgets.maxInteractionLatencyMs,
    timeToOptimisticBubbleMs: typeof performance.timeToOptimisticBubbleMs === "number" && performance.timeToOptimisticBubbleMs <= designPerformanceBudgets.timeToOptimisticBubbleMs,
    timeToEvidencePreviewMs: typeof performance.timeToEvidencePreviewMs === "number" && performance.timeToEvidencePreviewMs <= designPerformanceBudgets.timeToEvidencePreviewMs,
    longTasks: performance.longTasks <= designPerformanceBudgets.maxLongTasks,
    cls: typeof performance.cls === "number" && performance.cls <= designPerformanceBudgets.maxCls,
  };
}

export function designPerformancePasses(performance: PerformanceLayer) {
  return Object.values(designPerformanceChecks(performance)).every(Boolean);
}

function accessibilityRatio(accessibility: AccessibilityLayer) {
  if (accessibility.status === "failed") return 0;
  if (accessibility.status === "not_run") return 0;
  const automatedViolations = accessibility.axeViolations ?? accessibility.deterministicViolations;
  const checks = [
    automatedViolations === 0,
    accessibility.keyboardPathPassed === true,
    accessibility.reducedMotionPassed === true,
    accessibility.screenReaderNotes.length === 0,
  ];
  return checks.filter(Boolean).length / checks.length;
}

function roundScore(value: number) {
  return Number(value.toFixed(1));
}

function weightedScore(weight: number, ratio: number) {
  return roundScore(weight * clamp(ratio, 0, 1));
}

export function buildDesignQualityRun(input: DesignQualityRunInput): DesignQualityRun {
  const refRatio = referenceRatio(input.referenceComparisons);
  const dimensions: Record<UiUxDimension, number> = {
    workflowClarity: weightedScore(uiUxWeights.workflowClarity, mediaRatio(input.mediaJudge, "featureClarity", "workflowCompleteness")),
    firstThirtySecondMagic: weightedScore(uiUxWeights.firstThirtySecondMagic, (mediaRatio(input.mediaJudge, "featureClarity") + viralityRatio(input.viralitySignals)) / 2),
    visualHierarchyDensity: weightedScore(uiUxWeights.visualHierarchyDensity, mediaRatio(input.mediaJudge, "visualDesign", "consistency")),
    professionalRelevance: weightedScore(uiUxWeights.professionalRelevance, (mediaRatio(input.mediaJudge, "professionalRelevance") + refRatio) / 2),
    responsivenessInteraction: weightedScore(uiUxWeights.responsivenessInteraction, performanceRatio(input.performance)),
    artifactLegibility: weightedScore(uiUxWeights.artifactLegibility, mediaRatio(input.mediaJudge, "legibility")),
    evidenceTraceClarity: weightedScore(uiUxWeights.evidenceTraceClarity, mediaRatio(input.mediaJudge, "evidenceQuality", "productionHonesty")),
    accessibility: weightedScore(uiUxWeights.accessibility, accessibilityRatio(input.accessibility)),
    agentCollaborationState: weightedScore(uiUxWeights.agentCollaborationState, input.functionalGate.status === "passed" ? mediaRatio(input.mediaJudge, "productionHonesty", "evidenceQuality") : 0),
    shareabilityViralityLoop: weightedScore(uiUxWeights.shareabilityViralityLoop, viralityRatio(input.viralitySignals)),
  };
  const total = roundScore(Object.values(dimensions).reduce((sum, value) => sum + value, 0));
  const blockers = blockersFor(input);
  return {
    ...input,
    productCorrectnessScore: "pass_fail_only",
    uiUxScore: { total, max: 100, dimensions },
    verdict: verdictFor(input, total, blockers),
    blockers,
  };
}

function blockersFor(input: DesignQualityRunInput) {
  const blockers: string[] = [];
  if (input.functionalGate.status === "failed") blockers.push("functional gate failed");
  if (input.functionalGate.status === "not_run") blockers.push("functional gate not run in this design-quality pass");
  if (input.performance.status === "failed") blockers.push("performance gate failed");
  if (input.accessibility.status === "failed") blockers.push("accessibility gate failed");
  for (const defect of input.mediaJudge?.defects ?? []) {
    if (defect.severity === "P0" || defect.severity === "P1") blockers.push(`${defect.severity} media/design defect: ${defect.title}`);
  }
  return blockers;
}

function verdictFor(input: DesignQualityRunInput, score: number, blockers: string[]): DesignVerdict {
  if (input.functionalGate.status === "failed") return "functional_blocker";
  if (input.functionalGate.status === "not_run") return "needs_functional_gate";
  if (input.accessibility.status === "failed") return "accessibility_blocker";
  if (input.performance.status === "failed") return "design_blocker";
  if (blockers.some((blocker) => blocker.includes("P0") || blocker.includes("P1"))) return "design_blocker";
  if (score >= 82 && (input.mediaJudge?.defects ?? []).filter((defect) => defect.severity === "P2").length === 0) return "ship";
  return "ship_but_media_needs_polish";
}

export function mediaScoreLabel(media: MediaJudgeLayer | undefined) {
  return media ? `${media.total}/${media.max}` : "not run";
}
