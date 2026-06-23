import { describe, expect, it } from "vitest";
import {
  BENCHMARK_DELIVERABLE_TYPES,
  BENCHMARK_UI_GATES,
  type BenchmarkDeliverableKind,
  type OfficialBenchmarkUiId,
} from "../src/eval/officialBenchmarkUiCoverage";

type BenchmarkUiGateId = (typeof BENCHMARK_UI_GATES)[number]["id"];

type ArtifactOutput =
  | ".xlsx"
  | ".xlsm"
  | ".pptx"
  | ".docx"
  | ".pdf"
  | ".md"
  | ".png"
  | "trace"
  | "video"
  | "screenshot"
  | "scorecard";

type ImplementationStatus = "shipped" | "partial" | "target" | "blocked";
type ProofLevel = "contract_only" | "unit" | "integration" | "live_browser" | "official_scorer" | "human_reviewed";
type ProofSurface = "chat" | "spreadsheet" | "notebook" | "deck" | "pdf" | "web" | "mobile" | "trace" | "download";

type ProofSignal =
  | BenchmarkUiGateId
  | "agent_live_loop"
  | "room_trace_visible"
  | "job_detail_visible"
  | "focus_box_or_attention_overlay"
  | "evidence_box_or_citation_anchor"
  | "mutation_visible_in_artifact"
  | "internal_verifier_handoff"
  | "visual_judge_handoff"
  | "human_review_handoff";

type AgentSystemCapability =
  | "harness_loop"
  | "tool_contracts"
  | "context_builder"
  | "skill_loading"
  | "artifact_mutations"
  | "trace_receipts"
  | "ui_streaming"
  | "ui_boxes"
  | "deliverable_exports"
  | "official_scoring"
  | "internal_scoring"
  | "privacy_no_clobber"
  | "cost_latency_telemetry";

type RuntimeProofBinding = {
  command: string;
  testFile: string;
  fixtureId?: string;
  expectedArtifacts: Array<{
    kind: "sheet" | "note" | "deck" | "pdf" | "trace" | "scorecard" | "video" | "download";
    titlePattern?: string;
    exportExtension?: ArtifactOutput;
  }>;
  expectedSelectors: string[];
  expectedFiles: string[];
  scorerCommand?: string;
  maxRuntimeMs?: number;
  maxCostUsd?: number;
};

type VerifierBinding = {
  kind: "playwright" | "vitest" | "official_scorer" | "internal_rubric" | "visual_judge" | "human_review";
  command: string;
  outputPath: string;
  passCriteria: string[];
};

type ProofSignalBinding = {
  signal: ProofSignal;
  surface: ProofSurface;
  required: boolean;
  selector?: string;
  screenshotRequired?: boolean;
};

type FreshArtifact = {
  kind: "sheet" | "note" | "deck" | "document" | "pdf" | "trace" | "scorecard" | "video" | "download" | "upload";
  titlePattern: string;
};

type ArtifactAssertion = {
  artifactKind: "sheet" | "note" | "deck" | "document" | "pdf" | "wall" | "trace" | "download";
  targetRef: string;
  expected:
    | { containsText: string }
    | { cellStatus: "complete" | "needs_review" | "gap" }
    | { proposalExists: true }
    | { evidenceCountAtLeast: number }
    | { versionIncreased: true }
    | { downloadExtension: ArtifactOutput; reopened: true };
};

type EvidenceGate = {
  minEvidenceFacts: number;
  requiredEvidenceKinds: Array<"source" | "upload" | "computed" | "manual">;
  requireClickableCitation: boolean;
  requireBBoxOrAnchor: boolean;
  requireQuoteFoundInSource: boolean;
  allowManualOnlyFinal: boolean;
};

type CostLatencyGate = {
  maxRuntimeMs?: number;
  maxFirstStreamMs?: number;
  maxFirstMutationMs?: number;
  maxModelCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostUsd?: number;
};

type SpreadsheetVerifier = {
  formulaRecomputeRequired?: boolean;
  formulaPreservationRequired?: boolean;
  chartVisualRequired?: boolean;
  formatDiffRequired?: boolean;
  mergedCellsRequired?: boolean;
  dependencyBlastRadiusRequired?: boolean;
};

type FreshnessProof = {
  createRoomCommand: string;
  roomIdPattern: string;
  forbiddenPreloadedArtifacts: string[];
  allowedStarterTemplates?: string[];
  requireCreatedAfterRunStart: boolean;
};

type MobileGate = {
  viewport: "iPhone-14" | "Pixel-7" | "iPad";
  noHorizontalOverflow: boolean;
  tapTargetsMinPx: number;
  hoverFallbackRequired: boolean;
  keyboardSafeComposer: boolean;
};

type FailureMode =
  | "dispatch_error"
  | "partial_upload_failure"
  | "export_failure"
  | "scorer_failure"
  | "provider_timeout"
  | "retrieval_failure"
  | "permission_denied"
  | "cas_conflict"
  | "budget_cap";

type PeerAgentSystem = "openclaw" | "claude-code" | "pi-agent-core" | "hermes-agent" | "langchain-deepagent";

type PeerComparison = {
  peer: PeerAgentSystem;
  comparableMode: "same_benchmark" | "same_browser_ui" | "same_tool_contract" | "literature_only";
  resultPath?: string;
  notes: string;
};

type FreshRoomRealUserCase = {
  id: string;
  title: string;
  track: OfficialBenchmarkUiId | "nonbtb" | "product-smoke" | "collaboration" | "failure";
  implementationStatus: ImplementationStatus;
  proofLevel: ProofLevel;
  entry: "blank-room" | "upload-first-room" | "starter-room" | "member-joined-room" | "mobile-room";
  userAction: string;
  artifactsCreatedFresh: FreshArtifact[];
  officialRequiredDeliverables: BenchmarkDeliverableKind[];
  internalRequiredDeliverables: ArtifactOutput[];
  outputs: ArtifactOutput[];
  proofSignals: ProofSignalBinding[];
  agentSystemCapabilities: AgentSystemCapability[];
  runtimeProof: RuntimeProofBinding;
  verifiers: VerifierBinding[];
  artifactAssertions: ArtifactAssertion[];
  evidenceGate?: EvidenceGate;
  costLatencyGate: CostLatencyGate;
  securityAssertions: string[];
  freshnessProof: FreshnessProof;
  spreadsheetVerifier?: SpreadsheetVerifier;
  mobileGate?: MobileGate;
  failureModes?: FailureMode[];
  peerComparisons?: PeerComparison[];
};

const PEER_AGENT_SYSTEMS: PeerAgentSystem[] = [
  "openclaw",
  "claude-code",
  "pi-agent-core",
  "hermes-agent",
  "langchain-deepagent",
];

const proofSignalValues = new Set<ProofSignal>([
  ...BENCHMARK_UI_GATES.map((gate) => gate.id),
  "agent_live_loop",
  "room_trace_visible",
  "job_detail_visible",
  "focus_box_or_attention_overlay",
  "evidence_box_or_citation_anchor",
  "mutation_visible_in_artifact",
  "internal_verifier_handoff",
  "visual_judge_handoff",
  "human_review_handoff",
]);

function assertProofSignal(value: string): asserts value is ProofSignal {
  expect(proofSignalValues.has(value as ProofSignal), `unknown proof signal ${value}`).toBe(true);
}

const EVERY_RUN_PROOFS: ProofSignalBinding[] = [
  { signal: "fresh_room_join", surface: "chat", required: true, selector: '[data-testid="public-chat-panel"]' },
  { signal: "public_nodeagent_invocation", surface: "chat", required: true, selector: '[data-testid="chat-message"]' },
  { signal: "visible_streaming_progress", surface: "chat", required: true, selector: '[data-testid="agent-unified-stream"]' },
  { signal: "trace_video_artifacts", surface: "trace", required: true, selector: '[data-testid="room-trace"]', screenshotRequired: true },
  { signal: "no_memory_mode_shortcut", surface: "trace", required: true },
  { signal: "agent_live_loop", surface: "chat", required: true, selector: '[data-part="step"], [data-part="tool"]' },
  { signal: "room_trace_visible", surface: "trace", required: true, selector: '[data-testid="room-trace"]' },
  { signal: "job_detail_visible", surface: "chat", required: true, selector: '[data-testid="job-detail"]' },
  { signal: "focus_box_or_attention_overlay", surface: "spreadsheet", required: true, selector: '[data-testid="attention-overlay"]', screenshotRequired: true },
  { signal: "mutation_visible_in_artifact", surface: "spreadsheet", required: true, selector: '[data-testid="artifact-panel"]' },
];

const EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY: AgentSystemCapability[] = [
  "harness_loop",
  "tool_contracts",
  "context_builder",
  "artifact_mutations",
  "trace_receipts",
  "ui_streaming",
  "ui_boxes",
  "cost_latency_telemetry",
];

const BASE_COST_LATENCY: CostLatencyGate = {
  maxFirstStreamMs: 2_500,
  maxRuntimeMs: 180_000,
  maxCostUsd: 0.25,
  maxModelCalls: 20,
};

const BASE_FRESHNESS: FreshnessProof = {
  createRoomCommand: "browser creates a room through the public UI",
  roomIdPattern: "live Convex room code generated after test start",
  forbiddenPreloadedArtifacts: ["memory-mode demo seed", "stale localStorage session"],
  requireCreatedAfterRunStart: true,
};

const BASE_SECURITY_ASSERTIONS = [
  "no_private_artifact_leak",
  "no_untrusted_room_data_as_instruction",
  "agent_cannot_write_forbidden_columns",
  "formula_cells_not_scalar_overwritten",
  "no_silent_human_clobber",
];

const FRESH_ROOM_REAL_USER_CASES: FreshRoomRealUserCase[] = [
  {
    id: "FR-001",
    title: "blank fresh room first public @nodeagent ask creates the first work surface",
    track: "product-smoke",
    implementationStatus: "partial",
    proofLevel: "live_browser",
    entry: "blank-room",
    userAction: "Create a room, type a first public @nodeagent ask, and do not pre-seed artifacts.",
    artifactsCreatedFresh: [
      { kind: "sheet", titlePattern: "Sheet 1" },
      { kind: "trace", titlePattern: "room trace" },
      { kind: "video", titlePattern: "fresh blank room video" },
    ],
    officialRequiredDeliverables: [],
    internalRequiredDeliverables: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    outputs: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "deliverable_export_download", surface: "download", required: true, selector: '[data-testid="artifact-export-xlsx"]' },
      { signal: "artifact_reopen_validation", surface: "download", required: true },
      { signal: "internal_verifier_handoff", surface: "trace", required: true },
      { signal: "visual_judge_handoff", surface: "trace", required: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "deliverable_exports",
      "internal_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npm run test:product:live:agent -- --case FR-001",
      testFile: "e2e/public-nodeagent-real-room.spec.ts",
      expectedArtifacts: [
        { kind: "sheet", titlePattern: "Sheet 1", exportExtension: ".xlsx" },
        { kind: "trace", titlePattern: "room trace" },
        { kind: "video", titlePattern: "fresh blank room video" },
      ],
      expectedSelectors: ['[data-testid="agent-unified-stream"]', '[data-testid="attention-overlay"]'],
      expectedFiles: ["test-results/fresh-room/FR-001/video.webm", "test-results/fresh-room/FR-001/scorecard.md"],
      maxRuntimeMs: 180_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "playwright",
        command: "npm run test:product:live:agent -- --case FR-001",
        outputPath: "docs/eval/fresh-room/FR-001/latest.json",
        passCriteria: ["0 console errors", "visible stream", "artifact mutation visible", "trace rows visible"],
      },
      {
        kind: "visual_judge",
        command: "visual-judge run --scenario noderoom-fresh-room-FR-001",
        outputPath: "docs/eval/fresh-room/FR-001/scorecard.md",
        passCriteria: ["0 overflow", "0 contrast failures", "desktop video captured", "mobile video captured"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "sheet", targetRef: "Sheet 1", expected: { versionIncreased: true } },
      { artifactKind: "trace", targetRef: "agentSteps", expected: { containsText: "tool" } },
      { artifactKind: "download", targetRef: "xlsx export", expected: { downloadExtension: ".xlsx", reopened: true } },
    ],
    evidenceGate: {
      minEvidenceFacts: 1,
      requiredEvidenceKinds: ["computed"],
      requireClickableCitation: false,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: false,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: BASE_COST_LATENCY,
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
    spreadsheetVerifier: {
      formulaRecomputeRequired: false,
      formulaPreservationRequired: false,
      dependencyBlastRadiusRequired: true,
    },
  },
  {
    id: "FR-002",
    title: "fresh starter room public @nodeagent mutates starter artifacts with governed columns and boxes",
    track: "product-smoke",
    implementationStatus: "partial",
    proofLevel: "live_browser",
    entry: "starter-room",
    userAction: "Create a fresh starter room, click or type a public @nodeagent diligence request, and inspect the created starter artifacts.",
    artifactsCreatedFresh: [
      { kind: "sheet", titlePattern: "Company research" },
      { kind: "sheet", titlePattern: "Q3 variance" },
      { kind: "trace", titlePattern: "room trace" },
    ],
    officialRequiredDeliverables: [],
    internalRequiredDeliverables: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    outputs: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "deliverable_export_download", surface: "download", required: true, selector: '[data-testid="artifact-export-xlsx"]' },
      { signal: "artifact_reopen_validation", surface: "download", required: true },
      { signal: "internal_verifier_handoff", surface: "trace", required: true },
      { signal: "visual_judge_handoff", surface: "trace", required: true },
      { signal: "evidence_box_or_citation_anchor", surface: "spreadsheet", required: true, selector: ".r-srcchip, [data-testid='evidence-anchor']", screenshotRequired: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "deliverable_exports",
      "internal_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/full-modern-ux-bar.spec.ts --grep \"desktop public agent\"",
      testFile: "e2e/full-modern-ux-bar.spec.ts",
      fixtureId: "starter-cardionova",
      expectedArtifacts: [
        { kind: "sheet", titlePattern: "Company research", exportExtension: ".xlsx" },
        { kind: "trace", titlePattern: "room trace" },
      ],
      expectedSelectors: ['[data-testid="agent-unified-stream"]', '[data-testid="attention-overlay"]', ".r-srcchip"],
      expectedFiles: ["test-results/fresh-room/FR-002/video.webm", "test-results/fresh-room/FR-002/scorecard.md"],
      maxRuntimeMs: 180_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "playwright",
        command: "npx playwright test e2e/full-modern-ux-bar.spec.ts --grep \"desktop public agent\"",
        outputPath: "test-results/fresh-room/FR-002",
        passCriteria: ["CardioNova row complete", "source chip visible", "attention overlay visible", "trace visible"],
      },
      {
        kind: "visual_judge",
        command: "visual-judge run --scenario noderoom-starter-FR-002",
        outputPath: "docs/eval/fresh-room/FR-002/scorecard.md",
        passCriteria: ["0 overflow", "0 contrast failures", "video captured"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "sheet", targetRef: "rc_cardionova__summary", expected: { cellStatus: "complete" } },
      { artifactKind: "sheet", targetRef: "rc_cardionova__summary", expected: { evidenceCountAtLeast: 1 } },
      { artifactKind: "trace", targetRef: "agentSteps", expected: { containsText: "write_locked_cell" } },
    ],
    evidenceGate: {
      minEvidenceFacts: 1,
      requiredEvidenceKinds: ["source", "computed"],
      requireClickableCitation: true,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: true,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: BASE_COST_LATENCY,
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: {
      ...BASE_FRESHNESS,
      allowedStarterTemplates: ["starter-room"],
      forbiddenPreloadedArtifacts: ["memory-mode demo seed", "previous room localStorage session"],
    },
    spreadsheetVerifier: {
      formulaRecomputeRequired: false,
      formulaPreservationRequired: false,
      dependencyBlastRadiusRequired: true,
    },
  },
  {
    id: "FR-010",
    title: "SpreadsheetBench V1 fresh live room produces and reopens a scored workbook",
    track: "spreadsheetbench-v1",
    implementationStatus: "partial",
    proofLevel: "official_scorer",
    entry: "upload-first-room",
    userAction: "Upload the official workbook or source files, then send the official instruction through public @nodeagent.",
    artifactsCreatedFresh: [
      { kind: "upload", titlePattern: "SpreadsheetBench V1 inputs" },
      { kind: "sheet", titlePattern: "candidate workbook" },
      { kind: "scorecard", titlePattern: "SpreadsheetBench V1 score receipt" },
    ],
    officialRequiredDeliverables: ["workbook"],
    internalRequiredDeliverables: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    outputs: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "official_fixture_upload", surface: "chat", required: true, selector: ".r-file-input" },
      { signal: "deliverable_export_download", surface: "download", required: true, selector: '[data-testid="artifact-export-xlsx"]' },
      { signal: "artifact_reopen_validation", surface: "download", required: true },
      { signal: "official_scorer_handoff", surface: "download", required: true },
      { signal: "evidence_box_or_citation_anchor", surface: "spreadsheet", required: true, selector: ".r-srcchip, [data-testid='evidence-anchor']" },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "deliverable_exports",
      "official_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test --config playwright.real-flow.config.ts e2e/benchmark-ui-spreadsheetbench.spec.ts",
      testFile: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
      fixtureId: "spreadsheetbench-v1",
      expectedArtifacts: [
        { kind: "sheet", titlePattern: "candidate workbook", exportExtension: ".xlsx" },
        { kind: "scorecard", titlePattern: "score receipt" },
      ],
      expectedSelectors: ['[data-testid="job-status"]', '[data-testid="artifact-export-xlsx"]'],
      expectedFiles: ["docs/eval/spreadsheetbench-live-room-proof.json", "test-results/spreadsheetbench-export.xlsx"],
      scorerCommand: "gradeGolden on reopened workbook",
      maxRuntimeMs: 320_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "playwright",
        command: "npx playwright test --config playwright.real-flow.config.ts e2e/benchmark-ui-spreadsheetbench.spec.ts",
        outputPath: "docs/eval/spreadsheetbench-live-room-proof.json",
        passCriteria: ["fresh live room", "official upload", "downloaded xlsx", "reopened workbook", "grade passes"],
      },
      {
        kind: "official_scorer",
        command: "gradeGolden on reopened workbook",
        outputPath: "docs/eval/spreadsheetbench-live-room-proof.json",
        passCriteria: ["score ok", "0 fabrication", "correct equals n", "anti-cheat self-test passes"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "sheet", targetRef: "metric rows", expected: { evidenceCountAtLeast: 5 } },
      { artifactKind: "download", targetRef: "candidate workbook", expected: { downloadExtension: ".xlsx", reopened: true } },
      { artifactKind: "trace", targetRef: "agentSteps", expected: { containsText: "@nodeagent" } },
    ],
    evidenceGate: {
      minEvidenceFacts: 5,
      requiredEvidenceKinds: ["upload", "computed"],
      requireClickableCitation: true,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: true,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: { ...BASE_COST_LATENCY, maxRuntimeMs: 320_000 },
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
    spreadsheetVerifier: {
      formulaRecomputeRequired: true,
      formulaPreservationRequired: true,
      formatDiffRequired: true,
      dependencyBlastRadiusRequired: true,
    },
    peerComparisons: PEER_AGENT_SYSTEMS.map((peer) => ({
      peer,
      comparableMode: "same_benchmark",
      notes: "Run this same fresh-room SpreadsheetBench V1 task when a comparable adapter exists.",
    })),
  },
  {
    id: "FR-011",
    title: "SpreadsheetBench V2 fresh live room covers workbook, formulas, formatting, and chart proof",
    track: "spreadsheetbench-v2",
    implementationStatus: "target",
    proofLevel: "contract_only",
    entry: "upload-first-room",
    userAction: "Upload the official V2 workbook, run the official @nodeagent instruction, then export and score the edited workbook.",
    artifactsCreatedFresh: [
      { kind: "upload", titlePattern: "SpreadsheetBench V2 workbook" },
      { kind: "sheet", titlePattern: "candidate workbook" },
      { kind: "scorecard", titlePattern: "chart visual grade" },
    ],
    officialRequiredDeliverables: ["workbook"],
    internalRequiredDeliverables: [".xlsx", ".png", "trace", "video", "screenshot", "scorecard"],
    outputs: [".xlsx", ".png", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "official_fixture_upload", surface: "chat", required: true, selector: ".r-file-input" },
      { signal: "deliverable_export_download", surface: "download", required: true, selector: '[data-testid="artifact-export-xlsx"]' },
      { signal: "artifact_reopen_validation", surface: "download", required: true },
      { signal: "official_scorer_handoff", surface: "download", required: true },
      { signal: "evidence_box_or_citation_anchor", surface: "spreadsheet", required: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "deliverable_exports",
      "official_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/benchmark-ui-spreadsheetbench.spec.ts --grep \"V2\"",
      testFile: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
      fixtureId: "spreadsheetbench-v2",
      expectedArtifacts: [
        { kind: "sheet", titlePattern: "candidate workbook", exportExtension: ".xlsx" },
        { kind: "scorecard", titlePattern: "chart scorecard", exportExtension: ".png" },
      ],
      expectedSelectors: ['[data-testid="artifact-export-xlsx"]', '[data-testid="agent-unified-stream"]'],
      expectedFiles: ["docs/eval/spreadsheetbench-v2-live-room-proof.json"],
      scorerCommand: "SpreadsheetBench V2 scorer plus chart visual grader",
      maxRuntimeMs: 420_000,
      maxCostUsd: 0.5,
    },
    verifiers: [
      {
        kind: "official_scorer",
        command: "SpreadsheetBench V2 scorer plus chart visual grader",
        outputPath: "docs/eval/spreadsheetbench-v2-live-room-proof.json",
        passCriteria: ["formula recompute pass", "format diff pass", "chart visual pass", "reopened workbook pass"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "download", targetRef: "candidate workbook", expected: { downloadExtension: ".xlsx", reopened: true } },
      { artifactKind: "sheet", targetRef: "chart source range", expected: { versionIncreased: true } },
    ],
    evidenceGate: {
      minEvidenceFacts: 5,
      requiredEvidenceKinds: ["upload", "computed"],
      requireClickableCitation: true,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: true,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: { ...BASE_COST_LATENCY, maxRuntimeMs: 420_000, maxCostUsd: 0.5 },
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
    spreadsheetVerifier: {
      formulaRecomputeRequired: true,
      formulaPreservationRequired: true,
      chartVisualRequired: true,
      formatDiffRequired: true,
      mergedCellsRequired: true,
      dependencyBlastRadiusRequired: true,
    },
    peerComparisons: PEER_AGENT_SYSTEMS.map((peer) => ({
      peer,
      comparableMode: "same_benchmark",
      notes: "Target peer comparison once the V2 browser adapter and chart verifier are wired.",
    })),
  },
  {
    id: "FR-020",
    title: "BankerToolBench fresh live room emits the full deliverable package",
    track: "bankertoolbench",
    implementationStatus: "target",
    proofLevel: "contract_only",
    entry: "upload-first-room",
    userAction: "Upload official BankerToolBench task inputs and send the official instruction through public @nodeagent.",
    artifactsCreatedFresh: [
      { kind: "sheet", titlePattern: "candidate workbook" },
      { kind: "deck", titlePattern: "candidate deck" },
      { kind: "document", titlePattern: "candidate memo" },
      { kind: "pdf", titlePattern: "candidate PDF" },
      { kind: "download", titlePattern: "package manifest" },
    ],
    officialRequiredDeliverables: ["workbook", "presentation", "document", "pdf"],
    internalRequiredDeliverables: [".xlsx", ".xlsm", ".pptx", ".docx", ".pdf", "trace", "video", "screenshot", "scorecard"],
    outputs: [".xlsx", ".xlsm", ".pptx", ".docx", ".pdf", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "official_fixture_upload", surface: "chat", required: true, selector: ".r-file-input" },
      { signal: "deliverable_export_download", surface: "download", required: true },
      { signal: "artifact_reopen_validation", surface: "download", required: true },
      { signal: "official_scorer_handoff", surface: "download", required: true },
      { signal: "evidence_box_or_citation_anchor", surface: "pdf", required: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "deliverable_exports",
      "official_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/benchmark-ui-bankertoolbench.spec.ts",
      testFile: "e2e/benchmark-ui-bankertoolbench.spec.ts",
      fixtureId: "bankertoolbench",
      expectedArtifacts: [
        { kind: "download", titlePattern: "workbook", exportExtension: ".xlsx" },
        { kind: "download", titlePattern: "model workbook", exportExtension: ".xlsm" },
        { kind: "download", titlePattern: "deck", exportExtension: ".pptx" },
        { kind: "download", titlePattern: "memo", exportExtension: ".docx" },
        { kind: "download", titlePattern: "PDF", exportExtension: ".pdf" },
      ],
      expectedSelectors: ['[data-testid="agent-unified-stream"]', '[data-testid="job-detail"]'],
      expectedFiles: ["docs/eval/bankertoolbench-live-room-proof.json", "test-results/bankertoolbench/package-manifest.json"],
      scorerCommand: "official BankerToolBench verifier",
      maxRuntimeMs: 900_000,
      maxCostUsd: 2,
    },
    verifiers: [
      {
        kind: "official_scorer",
        command: "official BankerToolBench verifier",
        outputPath: "docs/eval/bankertoolbench-live-room-proof.json",
        passCriteria: ["all expected files downloaded", "all files reopen", "manifest references downloaded files", "verifier accepts package"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "download", targetRef: "workbook", expected: { downloadExtension: ".xlsx", reopened: true } },
      { artifactKind: "download", targetRef: "deck", expected: { downloadExtension: ".pptx", reopened: true } },
      { artifactKind: "download", targetRef: "memo", expected: { downloadExtension: ".docx", reopened: true } },
      { artifactKind: "download", targetRef: "pdf", expected: { downloadExtension: ".pdf", reopened: true } },
    ],
    evidenceGate: {
      minEvidenceFacts: 10,
      requiredEvidenceKinds: ["source", "upload", "computed"],
      requireClickableCitation: true,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: true,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: { maxRuntimeMs: 900_000, maxFirstStreamMs: 2_500, maxCostUsd: 2, maxModelCalls: 80 },
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
    spreadsheetVerifier: {
      formulaRecomputeRequired: true,
      formulaPreservationRequired: true,
      formatDiffRequired: true,
      mergedCellsRequired: true,
      dependencyBlastRadiusRequired: true,
    },
    peerComparisons: PEER_AGENT_SYSTEMS.map((peer) => ({
      peer,
      comparableMode: "same_benchmark",
      notes: "Target comparison on the same official BankerToolBench task package.",
    })),
  },
  {
    id: "FR-030",
    title: "NodeBench NB-01 company profile fresh room creates a cited workbook",
    track: "nonbtb",
    implementationStatus: "partial",
    proofLevel: "official_scorer",
    entry: "upload-first-room",
    userAction: "Upload NB-01 sources and ask @nodeagent to create company_profile.xlsx.",
    artifactsCreatedFresh: [
      { kind: "upload", titlePattern: "source_financials.csv" },
      { kind: "upload", titlePattern: "source_shares.txt" },
      { kind: "sheet", titlePattern: "company_profile workbook" },
    ],
    officialRequiredDeliverables: ["workbook"],
    internalRequiredDeliverables: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    outputs: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "official_fixture_upload", surface: "chat", required: true, selector: ".r-file-input" },
      { signal: "deliverable_export_download", surface: "download", required: true, selector: '[data-testid="artifact-export-xlsx"]' },
      { signal: "artifact_reopen_validation", surface: "download", required: true },
      { signal: "internal_verifier_handoff", surface: "download", required: true },
      { signal: "evidence_box_or_citation_anchor", surface: "spreadsheet", required: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "deliverable_exports",
      "internal_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/benchmark-ui-spreadsheetbench.spec.ts --grep \"nb-01\"",
      testFile: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
      fixtureId: "nb-01-company-profile",
      expectedArtifacts: [{ kind: "sheet", titlePattern: "company_profile", exportExtension: ".xlsx" }],
      expectedSelectors: ['[data-testid="artifact-export-xlsx"]', '[data-testid="job-status"]'],
      expectedFiles: ["docs/eval/spreadsheetbench-live-room-proof.json"],
      scorerCommand: "non-BTB NB-01 rubric",
      maxRuntimeMs: 320_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "internal_rubric",
        command: "non-BTB NB-01 rubric",
        outputPath: "docs/eval/spreadsheetbench-live-room-proof.json",
        passCriteria: ["all values correct", "0 fabrication", "source evidence present"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "download", targetRef: "company_profile.xlsx", expected: { downloadExtension: ".xlsx", reopened: true } },
    ],
    evidenceGate: {
      minEvidenceFacts: 5,
      requiredEvidenceKinds: ["upload", "computed"],
      requireClickableCitation: true,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: true,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: { ...BASE_COST_LATENCY, maxRuntimeMs: 320_000 },
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
    spreadsheetVerifier: {
      formulaRecomputeRequired: true,
      formulaPreservationRequired: true,
      dependencyBlastRadiusRequired: true,
    },
  },
  {
    id: "FR-031",
    title: "NodeBench NB-02 vendor pricing fresh room creates a formula-backed workbook",
    track: "nonbtb",
    implementationStatus: "target",
    proofLevel: "contract_only",
    entry: "upload-first-room",
    userAction: "Upload NB-02 quote files and ask @nodeagent to create pricing.xlsx.",
    artifactsCreatedFresh: [
      { kind: "upload", titlePattern: "quotes.csv" },
      { kind: "sheet", titlePattern: "pricing workbook" },
    ],
    officialRequiredDeliverables: ["workbook"],
    internalRequiredDeliverables: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    outputs: [".xlsx", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "official_fixture_upload", surface: "chat", required: true, selector: ".r-file-input" },
      { signal: "deliverable_export_download", surface: "download", required: true, selector: '[data-testid="artifact-export-xlsx"]' },
      { signal: "artifact_reopen_validation", surface: "download", required: true },
      { signal: "internal_verifier_handoff", surface: "download", required: true },
      { signal: "evidence_box_or_citation_anchor", surface: "spreadsheet", required: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "deliverable_exports",
      "internal_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/benchmark-ui-nodebench.spec.ts --grep \"nb-02\"",
      testFile: "e2e/benchmark-ui-nodebench.spec.ts",
      fixtureId: "nb-02-vendor-pricing",
      expectedArtifacts: [{ kind: "sheet", titlePattern: "pricing", exportExtension: ".xlsx" }],
      expectedSelectors: ['[data-testid="artifact-export-xlsx"]', '[data-testid="agent-unified-stream"]'],
      expectedFiles: ["docs/eval/nodebench-nb-02-live-room-proof.json"],
      scorerCommand: "non-BTB NB-02 rubric",
      maxRuntimeMs: 320_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "internal_rubric",
        command: "non-BTB NB-02 rubric",
        outputPath: "docs/eval/nodebench-nb-02-live-room-proof.json",
        passCriteria: ["vendor totals correct", "live formulas preserved", "source evidence present"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "download", targetRef: "pricing.xlsx", expected: { downloadExtension: ".xlsx", reopened: true } },
    ],
    evidenceGate: {
      minEvidenceFacts: 3,
      requiredEvidenceKinds: ["upload", "computed"],
      requireClickableCitation: true,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: true,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: { ...BASE_COST_LATENCY, maxRuntimeMs: 320_000 },
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
    spreadsheetVerifier: {
      formulaRecomputeRequired: true,
      formulaPreservationRequired: true,
      dependencyBlastRadiusRequired: true,
    },
  },
  {
    id: "FR-032",
    title: "NodeBench NB-03 reconciliation fresh room creates a cited reconciliation document",
    track: "nonbtb",
    implementationStatus: "target",
    proofLevel: "contract_only",
    entry: "upload-first-room",
    userAction: "Upload NB-03 bank and ledger CSVs and ask @nodeagent to create reconciliation.md.",
    artifactsCreatedFresh: [
      { kind: "upload", titlePattern: "bank.csv" },
      { kind: "upload", titlePattern: "ledger.csv" },
      { kind: "document", titlePattern: "reconciliation.md" },
    ],
    officialRequiredDeliverables: [],
    internalRequiredDeliverables: [".md", "trace", "video", "screenshot", "scorecard"],
    outputs: [".md", "trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "official_fixture_upload", surface: "chat", required: true, selector: ".r-file-input" },
      { signal: "internal_verifier_handoff", surface: "download", required: true },
      { signal: "evidence_box_or_citation_anchor", surface: "notebook", required: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "internal_scoring",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/benchmark-ui-nodebench.spec.ts --grep \"nb-03\"",
      testFile: "e2e/benchmark-ui-nodebench.spec.ts",
      fixtureId: "nb-03-reconciliation",
      expectedArtifacts: [{ kind: "note", titlePattern: "reconciliation.md", exportExtension: ".md" }],
      expectedSelectors: ['[data-testid="agent-unified-stream"]', '[data-testid="room-trace"]'],
      expectedFiles: ["docs/eval/nodebench-nb-03-live-room-proof.json"],
      scorerCommand: "non-BTB NB-03 rubric",
      maxRuntimeMs: 320_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "internal_rubric",
        command: "non-BTB NB-03 rubric",
        outputPath: "docs/eval/nodebench-nb-03-live-room-proof.json",
        passCriteria: ["reconciliation ties", "unmatched rows identified", "source evidence present"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "document", targetRef: "reconciliation.md", expected: { containsText: "unmatched" } },
    ],
    evidenceGate: {
      minEvidenceFacts: 2,
      requiredEvidenceKinds: ["upload", "computed"],
      requireClickableCitation: true,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: true,
      allowManualOnlyFinal: false,
    },
    costLatencyGate: { ...BASE_COST_LATENCY, maxRuntimeMs: 320_000 },
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
  },
  {
    id: "FR-040",
    title: "member joins fresh room and sees stream, trace, boxes, proposals, and mutations live",
    track: "collaboration",
    implementationStatus: "partial",
    proofLevel: "live_browser",
    entry: "member-joined-room",
    userAction: "Host starts @nodeagent; member watches public chat, artifact mutations, trace, and review controls.",
    artifactsCreatedFresh: [
      { kind: "sheet", titlePattern: "shared target sheet" },
      { kind: "trace", titlePattern: "proposal trace" },
      { kind: "video", titlePattern: "member joined video" },
    ],
    officialRequiredDeliverables: [],
    internalRequiredDeliverables: ["trace", "video", "screenshot", "scorecard"],
    outputs: ["trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS,
      { signal: "focus_box_or_attention_overlay", surface: "spreadsheet", required: true, selector: '[data-testid="focus-box"]', screenshotRequired: true },
      { signal: "evidence_box_or_citation_anchor", surface: "spreadsheet", required: true },
      { signal: "human_review_handoff", surface: "spreadsheet", required: true, selector: '[data-testid="proposal-inline"]' },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npm run test:product:live:agent -- --case FR-040",
      testFile: "e2e/three-user-collab.spec.ts",
      expectedArtifacts: [
        { kind: "sheet", titlePattern: "shared target sheet" },
        { kind: "trace", titlePattern: "proposal trace" },
      ],
      expectedSelectors: ['[data-testid="proposal-inline"]', '[data-testid="focus-box"]', '[data-testid="room-trace"]'],
      expectedFiles: ["test-results/fresh-room/FR-040/video.webm"],
      maxRuntimeMs: 240_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "playwright",
        command: "npm run test:product:live:agent -- --case FR-040",
        outputPath: "test-results/fresh-room/FR-040",
        passCriteria: ["member sees public stream", "host-only review enforced", "proposal visible", "trace updates"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "sheet", targetRef: "conflicted cell", expected: { proposalExists: true } },
      { artifactKind: "trace", targetRef: "review event", expected: { containsText: "proposal" } },
    ],
    evidenceGate: {
      minEvidenceFacts: 1,
      requiredEvidenceKinds: ["computed", "manual"],
      requireClickableCitation: false,
      requireBBoxOrAnchor: true,
      requireQuoteFoundInSource: false,
      allowManualOnlyFinal: true,
    },
    costLatencyGate: { ...BASE_COST_LATENCY, maxRuntimeMs: 240_000 },
    securityAssertions: [
      ...BASE_SECURITY_ASSERTIONS,
      "host_only_controls_enforced",
      "member_cannot_apply_host_proposal",
    ],
    freshnessProof: BASE_FRESHNESS,
  },
  {
    id: "FR-050",
    title: "mobile fresh room can run public @nodeagent and inspect created artifacts",
    track: "product-smoke",
    implementationStatus: "target",
    proofLevel: "contract_only",
    entry: "mobile-room",
    userAction: "Create or join on mobile, send @nodeagent, open the resulting artifact, and return to chat.",
    artifactsCreatedFresh: [
      { kind: "sheet", titlePattern: "mobile-visible work surface" },
      { kind: "video", titlePattern: "mobile fresh room video" },
    ],
    officialRequiredDeliverables: [],
    internalRequiredDeliverables: ["trace", "video", "screenshot", "scorecard"],
    outputs: ["trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      ...EVERY_RUN_PROOFS.map((binding) => ({ ...binding, surface: binding.surface === "spreadsheet" ? "mobile" as const : binding.surface })),
      { signal: "visual_judge_handoff", surface: "mobile", required: true },
    ],
    agentSystemCapabilities: [
      ...EVERY_POSITIVE_AGENT_SYSTEM_CAPABILITY,
      "skill_loading",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/responsive-qa.spec.ts --grep \"mobile.*nodeagent\"",
      testFile: "e2e/responsive-qa.spec.ts",
      expectedArtifacts: [
        { kind: "sheet", titlePattern: "mobile-visible work surface" },
        { kind: "video", titlePattern: "mobile fresh room video" },
      ],
      expectedSelectors: ['[data-testid="chat-composer"]', '[data-testid="agent-unified-stream"]', '[data-testid="artifact-panel"]'],
      expectedFiles: ["test-results/fresh-room/FR-050/mobile-video.webm", "docs/eval/fresh-room/FR-050/scorecard.md"],
      maxRuntimeMs: 180_000,
      maxCostUsd: 0.25,
    },
    verifiers: [
      {
        kind: "playwright",
        command: "npx playwright test e2e/responsive-qa.spec.ts --grep \"mobile.*nodeagent\"",
        outputPath: "test-results/fresh-room/FR-050",
        passCriteria: ["composer reachable", "artifact reachable", "no impossible overlay", "stream visible"],
      },
      {
        kind: "visual_judge",
        command: "visual-judge run --scenario noderoom-mobile-FR-050",
        outputPath: "docs/eval/fresh-room/FR-050/scorecard.md",
        passCriteria: ["0 horizontal overflow", "tap targets >= 44px", "keyboard safe composer", "hover fallback visible"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "sheet", targetRef: "mobile work surface", expected: { versionIncreased: true } },
    ],
    costLatencyGate: BASE_COST_LATENCY,
    securityAssertions: BASE_SECURITY_ASSERTIONS,
    freshnessProof: BASE_FRESHNESS,
    mobileGate: {
      viewport: "iPhone-14",
      noHorizontalOverflow: true,
      tapTargetsMinPx: 44,
      hoverFallbackRequired: true,
      keyboardSafeComposer: true,
    },
  },
  {
    id: "FR-060",
    title: "fresh room failure states are honest for dispatch, upload, export, scorer, provider, permission, conflict, and budget errors",
    track: "failure",
    implementationStatus: "target",
    proofLevel: "contract_only",
    entry: "blank-room",
    userAction: "Force representative backend, upload, export, scorer, provider, permission, conflict, and budget failures.",
    artifactsCreatedFresh: [
      { kind: "trace", titlePattern: "failed job row" },
      { kind: "upload", titlePattern: "failed upload ref" },
      { kind: "scorecard", titlePattern: "failed scorer receipt" },
    ],
    officialRequiredDeliverables: [],
    internalRequiredDeliverables: ["trace", "video", "screenshot", "scorecard"],
    outputs: ["trace", "video", "screenshot", "scorecard"],
    proofSignals: [
      { signal: "fresh_room_join", surface: "chat", required: true },
      { signal: "public_nodeagent_invocation", surface: "chat", required: true },
      { signal: "visible_streaming_progress", surface: "chat", required: true },
      { signal: "trace_video_artifacts", surface: "trace", required: true, screenshotRequired: true },
      { signal: "no_memory_mode_shortcut", surface: "trace", required: true },
      { signal: "room_trace_visible", surface: "trace", required: true, selector: '[data-testid="room-trace"]' },
      { signal: "job_detail_visible", surface: "chat", required: true, selector: '[data-testid="job-detail"]' },
      { signal: "internal_verifier_handoff", surface: "trace", required: true },
    ],
    agentSystemCapabilities: [
      "harness_loop",
      "tool_contracts",
      "context_builder",
      "trace_receipts",
      "ui_streaming",
      "cost_latency_telemetry",
      "privacy_no_clobber",
    ],
    runtimeProof: {
      command: "npx playwright test e2e/failure-states.spec.ts",
      testFile: "e2e/failure-states.spec.ts",
      expectedArtifacts: [
        { kind: "trace", titlePattern: "failure trace" },
        { kind: "scorecard", titlePattern: "failure scorecard" },
      ],
      expectedSelectors: ['[data-testid="job-error"]', '[data-testid="job-detail"]', '[data-testid="room-trace"]'],
      expectedFiles: ["docs/eval/fresh-room/FR-060/failure-scorecard.json"],
      maxRuntimeMs: 240_000,
      maxCostUsd: 0.05,
    },
    verifiers: [
      {
        kind: "playwright",
        command: "npx playwright test e2e/failure-states.spec.ts",
        outputPath: "docs/eval/fresh-room/FR-060/failure-scorecard.json",
        passCriteria: ["honest error visible", "no fake success", "trace explains failure", "retry only when safe"],
      },
    ],
    artifactAssertions: [
      { artifactKind: "trace", targetRef: "failure reason", expected: { containsText: "error" } },
    ],
    costLatencyGate: { maxRuntimeMs: 240_000, maxFirstStreamMs: 2_500, maxCostUsd: 0.05 },
    securityAssertions: [
      ...BASE_SECURITY_ASSERTIONS,
      "no_partial_artifact_claimed_as_final",
      "retry_button_only_when_safe",
    ],
    freshnessProof: BASE_FRESHNESS,
    failureModes: [
      "dispatch_error",
      "partial_upload_failure",
      "export_failure",
      "scorer_failure",
      "provider_timeout",
      "retrieval_failure",
      "permission_denied",
      "cas_conflict",
      "budget_cap",
    ],
  },
];

const REQUIRED_PROOFS: ProofSignal[] = [
  "fresh_room_join",
  "public_nodeagent_invocation",
  "visible_streaming_progress",
  "trace_video_artifacts",
  "no_memory_mode_shortcut",
  "agent_live_loop",
  "room_trace_visible",
  "job_detail_visible",
  "focus_box_or_attention_overlay",
  "mutation_visible_in_artifact",
];

const REQUIRED_AGENT_SYSTEM_CAPABILITIES: AgentSystemCapability[] = [
  "harness_loop",
  "tool_contracts",
  "context_builder",
  "skill_loading",
  "artifact_mutations",
  "trace_receipts",
  "ui_streaming",
  "ui_boxes",
  "deliverable_exports",
  "official_scoring",
  "internal_scoring",
  "privacy_no_clobber",
  "cost_latency_telemetry",
];

describe("fresh-room real-user benchmark acceptance matrix", () => {
  it("covers every official benchmark track", () => {
    const tracks = new Set(FRESH_ROOM_REAL_USER_CASES.map((item) => item.track));

    expect(Array.from(tracks)).toEqual(expect.arrayContaining([
      "bankertoolbench",
      "spreadsheetbench-v1",
      "spreadsheetbench-v2",
    ]));
  });

  it("marks each case with an honest implementation status and proof level", () => {
    for (const item of FRESH_ROOM_REAL_USER_CASES) {
      expect(item.implementationStatus, `${item.id} needs implementation status`).toMatch(/^(shipped|partial|target|blocked)$/);
      expect(item.proofLevel, `${item.id} needs proof level`).toMatch(/^(contract_only|unit|integration|live_browser|official_scorer|human_reviewed)$/);
    }

    expect(FRESH_ROOM_REAL_USER_CASES.find((item) => item.id === "FR-020")?.implementationStatus).toBe("target");
    expect(FRESH_ROOM_REAL_USER_CASES.find((item) => item.id === "FR-020")?.proofLevel).toBe("contract_only");
  });

  it("covers every required official benchmark deliverable extension", () => {
    const requiredExtensions = BENCHMARK_DELIVERABLE_TYPES
      .filter((item) => item.requiredFor.length > 0)
      .flatMap((item) => item.extensions);
    const coveredOutputs = new Set(FRESH_ROOM_REAL_USER_CASES.flatMap((item) => item.outputs));

    for (const extension of requiredExtensions) {
      expect(coveredOutputs.has(extension as ArtifactOutput), `missing fresh-room output coverage for ${extension}`).toBe(true);
    }
  });

  it("keeps every official benchmark UI gate represented as a known proof signal", () => {
    const proofSignals = new Set(FRESH_ROOM_REAL_USER_CASES.flatMap((item) => item.proofSignals.map((binding) => binding.signal)));

    for (const gate of BENCHMARK_UI_GATES) {
      assertProofSignal(gate.id);
      expect(proofSignals.has(gate.id), `missing benchmark UI gate ${gate.id}`).toBe(true);
    }
  });

  it("binds every proof signal to a surface and marks required proof explicitly", () => {
    for (const item of FRESH_ROOM_REAL_USER_CASES) {
      for (const binding of item.proofSignals) {
        assertProofSignal(binding.signal);
        expect(binding.surface, `${item.id}:${binding.signal} needs a surface`).toMatch(/^(chat|spreadsheet|notebook|deck|pdf|web|mobile|trace|download)$/);
        expect(typeof binding.required, `${item.id}:${binding.signal} must mark required`).toBe("boolean");
      }
    }
  });

  it("requires trace, boxes, live looping, streaming, and visible artifact mutation on every positive run", () => {
    const positiveCases = FRESH_ROOM_REAL_USER_CASES.filter((item) => item.track !== "failure");

    for (const item of positiveCases) {
      const signals = new Set(item.proofSignals.map((binding) => binding.signal));
      for (const proof of REQUIRED_PROOFS) {
        expect(signals.has(proof), `${item.id} is missing ${proof}`).toBe(true);
      }
    }
  });

  it("starts from real fresh-room entries with explicit anti-seeding proof", () => {
    const allowedEntries = new Set<FreshRoomRealUserCase["entry"]>([
      "blank-room",
      "upload-first-room",
      "starter-room",
      "member-joined-room",
      "mobile-room",
    ]);

    for (const item of FRESH_ROOM_REAL_USER_CASES) {
      expect(allowedEntries.has(item.entry), `${item.id} has an invalid entry`).toBe(true);
      expect(item.freshnessProof.requireCreatedAfterRunStart, `${item.id} must require room creation after run start`).toBe(true);
      expect(item.freshnessProof.forbiddenPreloadedArtifacts.length, `${item.id} must forbid stale seeds`).toBeGreaterThan(0);
      expect(item.artifactsCreatedFresh.length, `${item.id} must create artifacts fresh`).toBeGreaterThan(0);
    }
  });

  it("covers each fresh-room entry class a user can exercise", () => {
    const entries = new Set(FRESH_ROOM_REAL_USER_CASES.map((item) => item.entry));

    expect(Array.from(entries)).toEqual(expect.arrayContaining([
      "blank-room",
      "upload-first-room",
      "starter-room",
      "member-joined-room",
      "mobile-room",
    ]));
  });

  it("requires executable runtime proof bindings and structured verifier outputs", () => {
    for (const item of FRESH_ROOM_REAL_USER_CASES) {
      expect(item.runtimeProof.command, `${item.id} needs a runtime command`).toMatch(/\S/);
      expect(item.runtimeProof.testFile, `${item.id} needs a test file`).toMatch(/^e2e\/.+\.spec\.ts$/);
      expect(item.runtimeProof.expectedArtifacts.length, `${item.id} needs expected artifacts`).toBeGreaterThan(0);
      expect(item.runtimeProof.expectedSelectors.length, `${item.id} needs expected selectors`).toBeGreaterThan(0);
      expect(item.runtimeProof.expectedFiles.length, `${item.id} needs expected files`).toBeGreaterThan(0);
      expect(item.verifiers.length, `${item.id} needs verifiers`).toBeGreaterThan(0);
      for (const verifier of item.verifiers) {
        expect(verifier.command, `${item.id} verifier command`).toMatch(/\S/);
        expect(verifier.outputPath, `${item.id} verifier output`).toMatch(/\S/);
        expect(verifier.passCriteria.length, `${item.id} verifier criteria`).toBeGreaterThan(0);
      }
    }
  });

  it("frames official benchmark UI runs as a peer-agent-system bar, not just artifact smoke tests", () => {
    expect(Array.from(PEER_AGENT_SYSTEMS)).toEqual([
      "openclaw",
      "claude-code",
      "pi-agent-core",
      "hermes-agent",
      "langchain-deepagent",
    ]);

    const capabilities = new Set(FRESH_ROOM_REAL_USER_CASES.flatMap((item) => item.agentSystemCapabilities));
    for (const capability of REQUIRED_AGENT_SYSTEM_CAPABILITIES) {
      expect(capabilities.has(capability), `missing agent-system capability ${capability}`).toBe(true);
    }

    for (const item of FRESH_ROOM_REAL_USER_CASES.filter((caseItem) =>
      caseItem.track === "bankertoolbench" || caseItem.track === "spreadsheetbench-v1" || caseItem.track === "spreadsheetbench-v2"
    )) {
      expect(item.peerComparisons?.length, `${item.id} needs peer comparison slots`).toBe(PEER_AGENT_SYSTEMS.length);
      expect(item.peerComparisons?.every((comparison) => comparison.comparableMode === "same_benchmark")).toBe(true);
    }
  });

  it("adds cost, latency, security, evidence, mobile, spreadsheet, and failure gates where they matter", () => {
    for (const item of FRESH_ROOM_REAL_USER_CASES) {
      expect(item.costLatencyGate.maxRuntimeMs, `${item.id} needs max runtime`).toBeGreaterThan(0);
      expect(item.securityAssertions.length, `${item.id} needs security assertions`).toBeGreaterThan(0);
      expect(item.artifactAssertions.length, `${item.id} needs artifact assertions`).toBeGreaterThan(0);
    }

    for (const item of FRESH_ROOM_REAL_USER_CASES.filter((caseItem) => caseItem.outputs.includes(".xlsx"))) {
      expect(item.spreadsheetVerifier, `${item.id} needs spreadsheet verifier details`).toBeTruthy();
    }

    const mobile = FRESH_ROOM_REAL_USER_CASES.find((item) => item.id === "FR-050");
    expect(mobile?.mobileGate).toMatchObject({
      noHorizontalOverflow: true,
      tapTargetsMinPx: 44,
      hoverFallbackRequired: true,
      keyboardSafeComposer: true,
    });

    const failure = FRESH_ROOM_REAL_USER_CASES.find((item) => item.id === "FR-060");
    expect(failure?.failureModes).toEqual(expect.arrayContaining([
      "dispatch_error",
      "partial_upload_failure",
      "export_failure",
      "scorer_failure",
      "provider_timeout",
      "retrieval_failure",
      "permission_denied",
      "cas_conflict",
      "budget_cap",
    ]));
  });
});
