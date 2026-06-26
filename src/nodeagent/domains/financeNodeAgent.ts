import type { FreshRoomProofReceipt } from "../../eval/freshRoomProofReceipts";
import { validateFreshRoomProofReceipt } from "../../eval/freshRoomProofReceipts";
import type { NodeAgentHook, StopDecision } from "../core/hooks";
import type { DomainGateVerdict, DomainPack, DomainValidationResult } from "./types";

export const FINANCE_NODEAGENT_DOMAIN_PACK_ID = "finance-nodeagent" as const;
export const FINANCE_NODEAGENT_DOMAIN_PROOF_SCHEMA = "finance-nodeagent.domain-proof.v1" as const;
export const FINANCE_NODEAGENT_DOMAIN_JUDGE_MARKER = "FINANCE NODEAGENT DOMAIN JUDGE:" as const;

export const FINANCE_NODEAGENT_GATE_IDS = [
  "no_clobber",
  "evidence_coverage",
  "formula_protection",
  "manual_vs_verified",
  "source_traceability",
  "privacy_boundary",
  "live_ui_proof",
  "export_reopen",
  "cost_latency",
] as const;

export type FinanceNodeAgentGateId = (typeof FINANCE_NODEAGENT_GATE_IDS)[number];

export interface FinanceNodeAgentGateReceipt {
  gateId: FinanceNodeAgentGateId;
  verdict: DomainGateVerdict;
  evidenceRefs: string[];
  detail?: string;
  assertions?: {
    casOrProposalProven?: boolean;
    noHumanActiveOverwrite?: boolean;
    materialClaimsSupported?: boolean;
    noUnsupportedMaterialClaims?: boolean;
    noFormulaScalarOverwrite?: boolean;
    protectedFormulaCellsDetected?: boolean;
    chatClaimsMarkedManual?: boolean;
    verifiedClaimsHaveEvidence?: boolean;
    citationsOpen?: boolean;
    exactLocatorsPresent?: boolean;
    privatePublicBoundaryPassed?: boolean;
    focusModeEnabled?: boolean;
    streamingTraceVisible?: boolean;
    traceBoxesVisible?: boolean;
    exportsDownloaded?: boolean;
    exportsReopened?: boolean;
    scorerPassed?: boolean;
    costRecorded?: boolean;
    latencyRecorded?: boolean;
    stopReasonRecorded?: boolean;
  };
  counts?: {
    materialClaims?: number;
    supportedClaims?: number;
    unsupportedClaims?: number;
    mutationReceipts?: number;
    formulaOverwriteAttempts?: number;
    privateLeaks?: number;
    exportedArtifacts?: number;
    reopenedArtifacts?: number;
    modelCalls?: number;
    toolCalls?: number;
  };
  metrics?: {
    latencyMs?: number;
    firstStreamMs?: number;
    firstMutationMs?: number;
    costUsd?: number;
  };
}

export interface FinanceNodeAgentDomainProofReceipt {
  schema: typeof FINANCE_NODEAGENT_DOMAIN_PROOF_SCHEMA;
  domainPackId: typeof FINANCE_NODEAGENT_DOMAIN_PACK_ID;
  caseId: string;
  generatedAt: string;
  roomId?: string;
  roomUrl?: string;
  taskId?: string;
  freshRoomProof?: FreshRoomProofReceipt;
  gates: Partial<Record<FinanceNodeAgentGateId, FinanceNodeAgentGateReceipt>>;
  passed: boolean;
}

export interface FinanceNodeAgentDomainValidationOptions {
  requiredGateIds?: readonly FinanceNodeAgentGateId[];
  requireFreshRoomProofReceipt?: boolean;
}

export const FINANCE_NODEAGENT_DOMAIN_PACK: DomainPack = {
  id: FINANCE_NODEAGENT_DOMAIN_PACK_ID,
  name: "Finance NodeAgent",
  ontology: {
    entities: [
      "Room",
      "User",
      "AgentJob",
      "Spreadsheet",
      "Cell",
      "Formula",
      "Notebook",
      "SourceCapture",
      "EvidenceFact",
      "Proposal",
      "TraceStep",
      "FocusBox",
      "PrivatePublicLane",
      "ExportedWorkbook",
      "ExportedDeck",
      "ExportedMemo",
    ],
    relationships: [
      "agent_job_reads_source_capture",
      "evidence_fact_supports_material_claim",
      "mutation_receipt_targets_cell",
      "focus_box_overlaps_target_range",
      "formula_cell_blocks_scalar_overwrite",
      "private_lane_blocks_public_output",
      "export_reopen_validates_artifact",
      "fresh_room_trace_proves_live_ui",
    ],
  },
  invariants: [
    {
      id: "no_clobber",
      description: "Human-authored work cannot be overwritten without CAS, semantic rebase, draft, or proposal receipt.",
      severity: "blocker",
      professionalFailure: "The agent silently overwrites an analyst's active cell or stale workbook state.",
    },
    {
      id: "evidence_coverage",
      description: "Material finance claims require source-backed evidence facts.",
      severity: "blocker",
      professionalFailure: "A banker-facing value is asserted without traceable source support.",
    },
    {
      id: "formula_protection",
      description: "Formula cells cannot be overwritten with scalar text by default.",
      severity: "blocker",
      professionalFailure: "A working model becomes unauditable because the agent pasted values over formulas.",
    },
    {
      id: "manual_vs_verified",
      description: "Chat-only claims remain manual evidence until source/file verification passes.",
      severity: "major",
      professionalFailure: "The room treats an unverified explanation as a proven workpaper fact.",
    },
    {
      id: "source_traceability",
      description: "Citations open to exact source, page, row, bbox, cell, or artifact region.",
      severity: "blocker",
      professionalFailure: "A reviewer cannot reopen the source behind a claimed metric.",
    },
    {
      id: "privacy_boundary",
      description: "Private notes, PII, and private uploads cannot leak into public room outputs.",
      severity: "blocker",
      professionalFailure: "A public deliverable discloses private source content or PII.",
    },
    {
      id: "live_ui_proof",
      description: "Benchmark and production claims require a real fresh browser room with Focus Mode, streaming trace, and visible proof boxes.",
      severity: "blocker",
      professionalFailure: "A planner or memory-mode eval is mistaken for live product capability.",
    },
    {
      id: "export_reopen",
      description: "Deliverables must export, reopen, and pass their scorer or artifact assertions.",
      severity: "blocker",
      professionalFailure: "The UI looks complete but the actual workbook/deck/memo/PDF is corrupt or empty.",
    },
    {
      id: "cost_latency",
      description: "Long workflows record tokens, tool calls, cost, latency, and stop reason.",
      severity: "major",
      professionalFailure: "The run cannot be priced, resumed, compared across models, or debugged after budget exhaustion.",
    },
  ],
  proofGates: [
    {
      id: "no_clobber",
      description: "CAS/proposal/draft receipt proves no human-active target was silently overwritten.",
      requiredReceipt: "no-clobber-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["no_clobber"],
    },
    {
      id: "evidence_coverage",
      description: "Every material finance claim maps to an evidence fact or is marked needs_review.",
      requiredReceipt: "evidence-coverage-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["evidence_coverage", "manual_vs_verified"],
    },
    {
      id: "formula_protection",
      description: "Formula cells were detected and protected from scalar overwrites.",
      requiredReceipt: "formula-protection-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["formula_protection"],
    },
    {
      id: "manual_vs_verified",
      description: "Manual chat claims and verified source-backed facts are separated.",
      requiredReceipt: "manual-vs-verified-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["manual_vs_verified"],
    },
    {
      id: "source_traceability",
      description: "Citations reopen exact sources, rows, cells, pages, bbox regions, or artifact anchors.",
      requiredReceipt: "source-traceability-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["source_traceability"],
    },
    {
      id: "privacy_boundary",
      description: "Public outputs are checked for private lane, private upload, and PII leakage.",
      requiredReceipt: "privacy-boundary-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["privacy_boundary"],
    },
    {
      id: "live_ui_proof",
      description: "Fresh room browser proof shows Focus Mode, streaming, trace boxes, and NodeAgent live loop.",
      requiredReceipt: "live-ui-proof-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["live_ui_proof"],
    },
    {
      id: "export_reopen",
      description: "Created deliverables were downloaded, reopened, and scorer/artifact assertions passed.",
      requiredReceipt: "export-reopen-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["export_reopen"],
    },
    {
      id: "cost_latency",
      description: "The run recorded cost, latency, model calls, tool calls, and stop reason.",
      requiredReceipt: "cost-latency-receipt.json",
      blocksParentClaim: true,
      invariantIds: ["cost_latency"],
    },
  ],
  visualChecks: [
    {
      id: "focus_boxes_and_trace",
      screenshotOrVideoRequired: true,
      canonicalViews: ["desktop_focus_mode", "mobile_focus_mode", "job_detail_trace"],
    },
  ],
  regressionFixtures: [
    "wrong-company-enrichment",
    "human-active-cell-overlap",
    "formula-cell-scalar-overwrite",
    "citation-anchor-missing",
    "private-note-public-leak",
    "memory-mode-benchmark-shortcut",
    "exported-workbook-empty-sheet",
  ],
};

export function validateFinanceNodeAgentDomainProof(
  receipt: unknown,
  options: FinanceNodeAgentDomainValidationOptions = {},
): DomainValidationResult {
  const requiredGateIds = options.requiredGateIds ?? FINANCE_NODEAGENT_GATE_IDS;
  const errors: string[] = [];
  const missingGateIds: string[] = [];
  const proof = objectRecord(receipt) as Partial<FinanceNodeAgentDomainProofReceipt> | undefined;

  const add = (message: string) => errors.push(message);
  if (!proof) add("receipt must be a JSON object");
  if (proof?.schema !== FINANCE_NODEAGENT_DOMAIN_PROOF_SCHEMA) add(`schema must be ${FINANCE_NODEAGENT_DOMAIN_PROOF_SCHEMA}`);
  if (proof?.domainPackId !== FINANCE_NODEAGENT_DOMAIN_PACK_ID) add(`domainPackId must be ${FINANCE_NODEAGENT_DOMAIN_PACK_ID}`);
  if (!nonEmptyString(proof?.caseId)) add("caseId is required");
  if (!nonEmptyString(proof?.generatedAt) || Number.isNaN(Date.parse(proof.generatedAt ?? ""))) add("generatedAt must be an ISO timestamp");
  if (proof?.passed !== true) add("passed must be true");

  for (const gateId of requiredGateIds) {
    const gate = proof?.gates?.[gateId];
    if (!gate) {
      missingGateIds.push(gateId);
      add(`missing required finance gate: ${gateId}`);
      continue;
    }
    validateGate(gateId, gate, add);
  }

  if (options.requireFreshRoomProofReceipt || proof?.freshRoomProof) {
    if (!proof?.freshRoomProof) {
      add("freshRoomProof is required");
    } else {
      const fresh = validateFreshRoomProofReceipt(proof.freshRoomProof, {
        requireFocusMode: true,
        requireArtifactPlaceholderScan: true,
        requireAgentTerminalQuality: true,
      });
      for (const error of fresh.errors) add(`freshRoomProof: ${error}`);
    }
  }

  return {
    ok: errors.length === 0,
    domainPackId: FINANCE_NODEAGENT_DOMAIN_PACK_ID,
    caseId: proof?.caseId,
    errors,
    missingGateIds,
  };
}

export function createFinanceNodeAgentDomainJudgeHook(options: {
  getReceipt?: () => FinanceNodeAgentDomainProofReceipt | null | undefined;
  receipt?: FinanceNodeAgentDomainProofReceipt | null;
  requiredGateIds?: readonly FinanceNodeAgentGateId[];
  requireFreshRoomProofReceipt?: boolean;
} = {}): NodeAgentHook {
  return {
    preStop: () => {
      const receipt = options.getReceipt ? options.getReceipt() : options.receipt;
      const validation = validateFinanceNodeAgentDomainProof(receipt, {
        requiredGateIds: options.requiredGateIds,
        requireFreshRoomProofReceipt: options.requireFreshRoomProofReceipt,
      });
      if (validation.ok) return { action: "allow", reason: "Finance NodeAgent domain gates passed." } satisfies StopDecision;
      const reason = `Finance domain gates are not proven: ${validation.errors.join("; ")}`;
      return {
        action: "continue",
        reason,
        prompt: `${FINANCE_NODEAGENT_DOMAIN_JUDGE_MARKER} ${reason}. Add or repair the domain proof receipt before claiming the room workflow is complete.`,
      } satisfies StopDecision;
    },
  };
}

function validateGate(
  gateId: FinanceNodeAgentGateId,
  gate: FinanceNodeAgentGateReceipt,
  add: (message: string) => void,
): void {
  if (gate.gateId !== gateId) add(`${gateId}: gateId must match key`);
  if (gate.verdict !== "pass") add(`${gateId}: verdict must be pass`);
  if (!Array.isArray(gate.evidenceRefs) || gate.evidenceRefs.length === 0) add(`${gateId}: evidenceRefs must not be empty`);

  const assertions = gate.assertions ?? {};
  const counts = gate.counts ?? {};
  const metrics = gate.metrics ?? {};

  if (gateId === "no_clobber") {
    requireTrue(assertions.casOrProposalProven, `${gateId}: CAS/proposal proof is required`, add);
    requireTrue(assertions.noHumanActiveOverwrite, `${gateId}: human-active overwrite protection is required`, add);
    if ((counts.mutationReceipts ?? 0) <= 0) add(`${gateId}: mutationReceipts must be > 0`);
  }
  if (gateId === "evidence_coverage") {
    requireTrue(assertions.materialClaimsSupported, `${gateId}: material claims must be supported`, add);
    requireTrue(assertions.noUnsupportedMaterialClaims, `${gateId}: unsupported material claims must be zero`, add);
    if ((counts.materialClaims ?? 0) <= 0) add(`${gateId}: materialClaims must be > 0`);
    if ((counts.supportedClaims ?? 0) < (counts.materialClaims ?? 0)) add(`${gateId}: supportedClaims must cover materialClaims`);
    if ((counts.unsupportedClaims ?? 0) !== 0) add(`${gateId}: unsupportedClaims must be 0`);
  }
  if (gateId === "formula_protection") {
    requireTrue(assertions.noFormulaScalarOverwrite, `${gateId}: noFormulaScalarOverwrite must be true`, add);
    if ((counts.formulaOverwriteAttempts ?? 0) !== 0) add(`${gateId}: formulaOverwriteAttempts must be 0`);
  }
  if (gateId === "manual_vs_verified") {
    requireTrue(assertions.chatClaimsMarkedManual, `${gateId}: chat claims must be marked manual until verified`, add);
    requireTrue(assertions.verifiedClaimsHaveEvidence, `${gateId}: verified claims must have evidence`, add);
  }
  if (gateId === "source_traceability") {
    requireTrue(assertions.citationsOpen, `${gateId}: citations must open`, add);
    requireTrue(assertions.exactLocatorsPresent, `${gateId}: exact source locators are required`, add);
  }
  if (gateId === "privacy_boundary") {
    requireTrue(assertions.privatePublicBoundaryPassed, `${gateId}: private/public boundary must pass`, add);
    if ((counts.privateLeaks ?? 0) !== 0) add(`${gateId}: privateLeaks must be 0`);
  }
  if (gateId === "live_ui_proof") {
    requireTrue(assertions.focusModeEnabled, `${gateId}: Focus Mode must be enabled`, add);
    requireTrue(assertions.streamingTraceVisible, `${gateId}: streaming trace must be visible`, add);
    requireTrue(assertions.traceBoxesVisible, `${gateId}: focus/trace boxes must be visible`, add);
  }
  if (gateId === "export_reopen") {
    requireTrue(assertions.exportsDownloaded, `${gateId}: exports must be downloaded`, add);
    requireTrue(assertions.exportsReopened, `${gateId}: exports must reopen`, add);
    requireTrue(assertions.scorerPassed, `${gateId}: scorer must pass`, add);
    if ((counts.exportedArtifacts ?? 0) <= 0) add(`${gateId}: exportedArtifacts must be > 0`);
    if ((counts.reopenedArtifacts ?? 0) < (counts.exportedArtifacts ?? 0)) add(`${gateId}: reopenedArtifacts must cover exportedArtifacts`);
  }
  if (gateId === "cost_latency") {
    requireTrue(assertions.costRecorded, `${gateId}: cost must be recorded`, add);
    requireTrue(assertions.latencyRecorded, `${gateId}: latency must be recorded`, add);
    requireTrue(assertions.stopReasonRecorded, `${gateId}: stop reason must be recorded`, add);
    if (!finiteNonNegative(metrics.latencyMs)) add(`${gateId}: latencyMs must be a finite non-negative number`);
    if (!finiteNonNegative(metrics.costUsd)) add(`${gateId}: costUsd must be a finite non-negative number`);
    if ((counts.modelCalls ?? 0) <= 0) add(`${gateId}: modelCalls must be > 0`);
    if ((counts.toolCalls ?? 0) <= 0) add(`${gateId}: toolCalls must be > 0`);
  }
}

function requireTrue(value: unknown, message: string, add: (message: string) => void): void {
  if (value !== true) add(message);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
