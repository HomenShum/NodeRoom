import { describe, expect, it } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import {
  createFinanceNodeAgentDomainJudgeHook,
  FINANCE_NODEAGENT_DOMAIN_JUDGE_MARKER,
  FINANCE_NODEAGENT_DOMAIN_PACK,
  FINANCE_NODEAGENT_DOMAIN_PACK_ID,
  FINANCE_NODEAGENT_DOMAIN_PROOF_SCHEMA,
  InMemoryRoomTools,
  ROOM_TOOLS,
  runAgent,
  scriptedModel,
  validateFinanceNodeAgentDomainProof,
  type FinanceNodeAgentDomainProofReceipt,
  type FinanceNodeAgentGateId,
  type FinanceNodeAgentGateReceipt,
} from "../src/nodeagent/index";

function setup() {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  return { rt };
}

function gate(gateId: FinanceNodeAgentGateId): FinanceNodeAgentGateReceipt {
  const base = {
    gateId,
    verdict: "pass" as const,
    evidenceRefs: [`trace:${gateId}`],
  };
  if (gateId === "no_clobber") {
    return {
      ...base,
      assertions: { casOrProposalProven: true, noHumanActiveOverwrite: true },
      counts: { mutationReceipts: 2 },
    };
  }
  if (gateId === "evidence_coverage") {
    return {
      ...base,
      assertions: { materialClaimsSupported: true, noUnsupportedMaterialClaims: true },
      counts: { materialClaims: 3, supportedClaims: 3, unsupportedClaims: 0 },
    };
  }
  if (gateId === "formula_protection") {
    return {
      ...base,
      assertions: { noFormulaScalarOverwrite: true, protectedFormulaCellsDetected: true },
      counts: { formulaOverwriteAttempts: 0 },
    };
  }
  if (gateId === "manual_vs_verified") {
    return {
      ...base,
      assertions: { chatClaimsMarkedManual: true, verifiedClaimsHaveEvidence: true },
    };
  }
  if (gateId === "source_traceability") {
    return {
      ...base,
      assertions: { citationsOpen: true, exactLocatorsPresent: true },
    };
  }
  if (gateId === "privacy_boundary") {
    return {
      ...base,
      assertions: { privatePublicBoundaryPassed: true },
      counts: { privateLeaks: 0 },
    };
  }
  if (gateId === "live_ui_proof") {
    return {
      ...base,
      assertions: { focusModeEnabled: true, streamingTraceVisible: true, traceBoxesVisible: true },
    };
  }
  if (gateId === "export_reopen") {
    return {
      ...base,
      assertions: { exportsDownloaded: true, exportsReopened: true, scorerPassed: true },
      counts: { exportedArtifacts: 5, reopenedArtifacts: 5 },
    };
  }
  return {
    ...base,
    assertions: { costRecorded: true, latencyRecorded: true, stopReasonRecorded: true },
    counts: { modelCalls: 8, toolCalls: 31 },
    metrics: { latencyMs: 120_000, firstStreamMs: 1_500, firstMutationMs: 30_000, costUsd: 0.42 },
  };
}

function goodReceipt(): FinanceNodeAgentDomainProofReceipt {
  return {
    schema: FINANCE_NODEAGENT_DOMAIN_PROOF_SCHEMA,
    domainPackId: FINANCE_NODEAGENT_DOMAIN_PACK_ID,
    caseId: "FR-020",
    generatedAt: "2026-06-25T00:00:00.000Z",
    roomId: "NRTEST123",
    roomUrl: "http://127.0.0.1:5273/?room=NRTEST123&focusMode=1",
    gates: {
      no_clobber: gate("no_clobber"),
      evidence_coverage: gate("evidence_coverage"),
      formula_protection: gate("formula_protection"),
      manual_vs_verified: gate("manual_vs_verified"),
      source_traceability: gate("source_traceability"),
      privacy_boundary: gate("privacy_boundary"),
      live_ui_proof: gate("live_ui_proof"),
      export_reopen: gate("export_reopen"),
      cost_latency: gate("cost_latency"),
    },
    passed: true,
  };
}

describe("finance NodeAgent domain pack", () => {
  it("defines NodeRoom finance workflow ontology, invariants, gates, and regression fixtures", () => {
    expect(FINANCE_NODEAGENT_DOMAIN_PACK.id).toBe("finance-nodeagent");
    expect(FINANCE_NODEAGENT_DOMAIN_PACK.ontology.entities).toEqual(expect.arrayContaining([
      "AgentJob",
      "EvidenceFact",
      "FocusBox",
      "PrivatePublicLane",
      "ExportedWorkbook",
    ]));
    expect(FINANCE_NODEAGENT_DOMAIN_PACK.invariants.map((invariant) => invariant.id)).toEqual(expect.arrayContaining([
      "no_clobber",
      "evidence_coverage",
      "formula_protection",
      "privacy_boundary",
      "live_ui_proof",
    ]));
    expect(FINANCE_NODEAGENT_DOMAIN_PACK.proofGates.every((gateDef) => gateDef.blocksParentClaim)).toBe(true);
    expect(FINANCE_NODEAGENT_DOMAIN_PACK.regressionFixtures).toEqual(expect.arrayContaining([
      "wrong-company-enrichment",
      "human-active-cell-overlap",
      "exported-workbook-empty-sheet",
    ]));
  });

  it("accepts a complete finance domain proof receipt", () => {
    const validation = validateFinanceNodeAgentDomainProof(goodReceipt());

    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.missingGateIds).toEqual([]);
  });

  it("rejects evidence coverage when material claims outnumber supported claims", () => {
    const receipt = goodReceipt();
    receipt.gates.evidence_coverage = {
      ...gate("evidence_coverage"),
      assertions: { materialClaimsSupported: false, noUnsupportedMaterialClaims: false },
      counts: { materialClaims: 3, supportedClaims: 2, unsupportedClaims: 1 },
    };

    const validation = validateFinanceNodeAgentDomainProof(receipt);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("material claims must be supported");
    expect(validation.errors.join("\n")).toContain("unsupportedClaims must be 0");
  });

  it("rejects live UI proof without Focus Mode and visible trace boxes", () => {
    const receipt = goodReceipt();
    receipt.gates.live_ui_proof = {
      ...gate("live_ui_proof"),
      assertions: { focusModeEnabled: false, streamingTraceVisible: true, traceBoxesVisible: false },
    };

    const validation = validateFinanceNodeAgentDomainProof(receipt);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("Focus Mode must be enabled");
    expect(validation.errors.join("\n")).toContain("focus/trace boxes must be visible");
  });

  it("blocks runtime stop when the finance domain receipt is missing", async () => {
    const { rt } = setup();
    const result = await runAgent({
      rt,
      goal: "finish the finance workflow",
      model: scriptedModel(() => ({ say: "The workflow is complete.", done: true })),
      tools: ROOM_TOOLS,
      hooks: [createFinanceNodeAgentDomainJudgeHook()],
      maxSteps: 1,
    });

    expect(result.stopReason).toBe("step_budget");
    expect(result.handoff?.summary).toContain("Finance domain gates are not proven");
    expect(result.messages.some((message) =>
      message.role === "assistant" && message.content === "The workflow is complete.",
    )).toBe(true);
  });

  it("allows runtime stop when the finance domain receipt passes", async () => {
    const { rt } = setup();
    const result = await runAgent({
      rt,
      goal: "finish the finance workflow",
      model: scriptedModel(() => ({ say: "The workflow is complete.", done: true })),
      tools: ROOM_TOOLS,
      hooks: [createFinanceNodeAgentDomainJudgeHook({ receipt: goodReceipt() })],
      maxSteps: 1,
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalText).toBe("The workflow is complete.");
  });

  it("continues the loop with a domain-judge prompt when there is room to recover", async () => {
    const { rt } = setup();
    const result = await runAgent({
      rt,
      goal: "finish the finance workflow",
      model: scriptedModel(({ messages }) => {
        const sawDomainJudge = messages.some((message) =>
          message.role === "user" && message.content.startsWith(FINANCE_NODEAGENT_DOMAIN_JUDGE_MARKER),
        );
        return sawDomainJudge
          ? { say: "Still blocked by missing domain proof.", done: true }
          : { say: "The workflow is complete.", done: true };
      }),
      tools: ROOM_TOOLS,
      hooks: [createFinanceNodeAgentDomainJudgeHook()],
      initialMessages: [
        { role: "user", content: "HARNESS NOTE: this run cannot be complete - no cells were written or proposed." },
      ],
      maxSteps: 2,
    });

    expect(result.stopReason).toBe("step_budget");
    expect(result.messages.some((message) =>
      message.role === "user" && message.content.startsWith(FINANCE_NODEAGENT_DOMAIN_JUDGE_MARKER),
    )).toBe(true);
  });
});
