import { describe, expect, it } from "vitest";
import {
  LOOP_PATTERNS,
  LOOP_REGISTRY,
  appendAttemptLedger,
  assertBoundedPolicy,
  buildLoopMemoryRecord,
  buildProofloopReward,
  buildStrategyDelta,
  createLoopAttempt,
  evaluateLoopAttempt,
  routeFusionTask,
  selectLoopPolicy,
  type ProfileResearchPacket,
} from "../src/noderl/loop";

describe("NodeLoopRuntime v1", () => {
  it("registers the exact 20 loop patterns from the source text", () => {
    expect(LOOP_PATTERNS).toHaveLength(20);
    expect(LOOP_REGISTRY.map((entry) => entry.id)).toEqual([...LOOP_PATTERNS]);
    expect(LOOP_PATTERNS).toContain("workflow_optimization");
    expect(LOOP_PATTERNS).toContain("generate_critique_rewrite");
  });

  it("selects bounded policies with verifiers, stop conditions, and no forbidden overlap", () => {
    for (const taskKind of ["accounting_reconciliation", "profile_research_packet", "live_user_benchmark", "unknown"]) {
      const policy = selectLoopPolicy(taskKind);
      expect(assertBoundedPolicy(policy)).toEqual([]);
      expect(policy.maxAttempts).toBeGreaterThan(0);
      expect(policy.maxCostUsd).toBeGreaterThan(0);
      expect(policy.stopConditions.length).toBeGreaterThan(0);
      expect(policy.verifier.length).toBeGreaterThan(0);
    }
  });

  it("builds attempts, rewards, strategy deltas, and memory records with trace IDs", () => {
    const policy = selectLoopPolicy("accounting_reconciliation");
    const attempt = createLoopAttempt({
      roomId: "room-1",
      jobId: "job-1",
      traceId: "trace-1",
      taskKind: "accounting_reconciliation",
      mode: "benchmark",
      loopsUsed: ["goal_decomposition", "constraint_satisfaction", "score_retry"],
      modelRoute: ["planner", "worker", "verifier"],
      toolsUsed: ["spreadsheet_formula_engine"],
      costUsd: 1.2,
      latencyMs: 30_000,
      outputRefs: ["reconciliation.xlsx"],
      evidenceRefs: ["evidence-facts.json"],
      visualRefs: ["screenshot.png"],
      score: 1,
      passed: true,
    });

    const evaluation = evaluateLoopAttempt(attempt, policy);
    expect(evaluation.passed).toBe(true);

    const reward = buildProofloopReward({ attempt, maxCostUsd: policy.maxCostUsd, latencyTargetMs: policy.maxTimeMs });
    expect(reward.total).toBeGreaterThan(0.8);

    const strategyDelta = buildStrategyDelta(attempt, reward);
    const memory = buildLoopMemoryRecord(attempt, reward, strategyDelta);
    expect(memory.traceId).toBe("trace-1");
    expect(memory.kind).toBe("success_pattern");
    expect(appendAttemptLedger([], attempt)).toHaveLength(1);
  });

  it("routes finance/profile work with explicit tools and escalation policy", () => {
    const route = routeFusionTask({
      taskKind: "xbrl_tagging",
      sourceTypes: ["xbrl", "pdf", "image"],
      outputTargets: ["spreadsheet", "graph"],
      contextSizeTokens: 80_000,
      formulaComplexity: "high",
      evidenceStrictness: "banker_grade",
      privacyLevel: "room",
      budgetRemainingUsd: 4,
      priorFailures: ["evidence_grounding_failure"],
    });
    expect(route.tools).toContain("xbrl_parser");
    expect(route.tools).toContain("spreadsheet_formula_engine");
    expect(route.tools).toContain("browser_bbox_capture");
    expect(route.plannerModel).toBe("strong-model");
    expect(route.escalationPolicy.map((item) => item.ifFailure)).toContain("verifier_feedback");
  });

  it("types the ProfileResearchPacket contract for spreadsheet, notebook, graph, and evidence outputs", () => {
    const packet = {
      packetId: "packet-1",
      subject: { kind: "company", name: "UpscaleX", aliases: ["Upscale X"], confidence: 0.9 },
      ontology: {
        entities: [{ id: "company-1", kind: "company", label: "UpscaleX", confidence: 0.9 }],
        edges: [{ from: "source-1", relation: "source_supports", to: "company-1", evidenceFactIds: ["fact-1"], confidence: 0.8 }],
      },
      dossier: {
        executiveSummary: "Source-backed profile packet.",
        timeline: [],
        people: [],
        companies: ["UpscaleX"],
        events: [],
        openQuestions: ["Verify latest funding status."],
        nextActions: ["Assign owner."],
      },
      evidence: [{ factId: "fact-1", claim: "Company profile exists.", sourceUrl: "https://example.com", status: "source_backed" }],
      outputs: { spreadsheetRows: [], notebookBlocks: [], graphNodes: [] },
    } satisfies ProfileResearchPacket;

    expect(packet.subject.name).toBe("UpscaleX");
    expect(packet.evidence[0].status).toBe("source_backed");
  });
});
