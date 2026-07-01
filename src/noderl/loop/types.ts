export const LOOP_PATTERNS = [
  "generate_critique_rewrite",
  "score_retry",
  "multi_critic",
  "adversarial_critique",
  "judge_ensemble",
  "reflexion",
  "memory_update",
  "error_library",
  "success_pattern",
  "memory_compression",
  "plan_execute_replan",
  "dynamic_workflow",
  "goal_decomposition",
  "progress_evaluation",
  "constraint_satisfaction",
  "branch_explore",
  "tree_search",
  "debate",
  "prompt_optimization",
  "workflow_optimization",
] as const;

export type LoopPattern = (typeof LOOP_PATTERNS)[number];
export type LoopMode = "quick" | "standard" | "deep" | "benchmark";

export type LoopPolicy = {
  taskKind: string;
  mode: LoopMode;
  requiredLoops: LoopPattern[];
  optionalLoops: LoopPattern[];
  forbiddenLoops: LoopPattern[];
  maxAttempts: number;
  maxCostUsd: number;
  maxTimeMs: number;
  stopConditions: string[];
  verifier: string[];
  memoryWrites: string[];
  escalation: "none" | "human_review" | "strong_model" | "operator";
};

export type LoopAttempt = {
  attemptId: string;
  roomId: string;
  jobId: string;
  traceId: string;
  taskKind: string;
  mode: LoopMode;
  loopsUsed: LoopPattern[];
  modelRoute: string[];
  toolsUsed: string[];
  costUsd: number;
  latencyMs: number;
  outputRefs: string[];
  evidenceRefs: string[];
  visualRefs: string[];
  score: number;
  passed: boolean;
  failureCategories: string[];
  strategyDelta?: string;
};

export type ProofloopReward = {
  taskCompletion: number;
  evidenceGrounding: number;
  artifactCorrectness: number;
  visualClarity: number;
  humanAcceptance: number;
  costEfficiency: number;
  latencyEfficiency: number;
  safety: number;
  total: number;
};

export type RoutingFeatures = {
  taskKind:
    | "accounting_reconciliation"
    | "profile_research"
    | "xbrl_tagging"
    | "financial_statement_verification"
    | "spreadsheet_edit"
    | "notebook_dossier"
    | "visual_trace_judge";
  sourceTypes: Array<"xlsx" | "pdf" | "docx" | "pptx" | "html" | "image" | "chat" | "xbrl">;
  outputTargets: Array<"spreadsheet" | "notebook" | "deck" | "pdf" | "graph">;
  contextSizeTokens: number;
  formulaComplexity: "low" | "medium" | "high";
  evidenceStrictness: "low" | "medium" | "banker_grade";
  privacyLevel: "public" | "room" | "private";
  budgetRemainingUsd: number;
  latencyTargetMs?: number;
  priorFailures: string[];
  similarTaskStats?: Array<{
    model: string;
    passRate: number;
    medianCostUsd: number;
    medianLatencyMs: number;
    evidenceScore: number;
  }>;
};

export type FusionRoutePlan = {
  plannerModel: string;
  extractorModel: string;
  reasoningModel: string;
  verifierModel: string;
  visualJudgeModel?: string;
  tools: Array<
    | "deterministic_parser"
    | "linkup_search"
    | "firecrawl_capture"
    | "browser_bbox_capture"
    | "spreadsheet_formula_engine"
    | "xbrl_parser"
  >;
  maxCostUsd: number;
  maxAttempts: number;
  escalationPolicy: Array<{
    ifFailure: string;
    thenRoute: Partial<FusionRoutePlan>;
  }>;
};

export type ProfileResearchPacket = {
  packetId: string;
  subject: {
    kind: "person" | "company" | "fund" | "portfolio_company" | "topic";
    name: string;
    aliases: string[];
    confidence: number;
  };
  ontology: {
    entities: Array<{
      id: string;
      kind: "person" | "company" | "fund" | "event" | "source" | "role";
      label: string;
      confidence: number;
    }>;
    edges: Array<{
      from: string;
      relation:
        | "works_at"
        | "founded"
        | "invested_in"
        | "portfolio_of"
        | "attended_event"
        | "mentioned_with"
        | "source_supports"
        | "needs_review";
      to: string;
      evidenceFactIds: string[];
      confidence: number;
    }>;
  };
  dossier: {
    executiveSummary: string;
    timeline: string[];
    people: string[];
    companies: string[];
    events: string[];
    openQuestions: string[];
    nextActions: string[];
  };
  evidence: Array<{
    factId: string;
    claim: string;
    sourceUrl?: string;
    quote?: string;
    screenshotRef?: string;
    bboxNorm?: { x: number; y: number; w: number; h: number };
    status: "source_backed" | "manual" | "graph_inferred" | "needs_review";
  }>;
  outputs: {
    spreadsheetRows: unknown[];
    notebookBlocks: unknown[];
    graphNodes: unknown[];
  };
};

