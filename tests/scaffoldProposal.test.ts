import { describe, it, expect } from "vitest";
import {
  type ScaffoldProposal,
  type ScaffoldReviewResult,
  type ScaffoldAcceptContext,
  IMMUTABLE_FILES,
  touchesImmutableFile,
  detectVerifierWeakening,
  rejectScaffoldProposal,
  evaluateScaffoldAcceptance,
  generateScaffoldProposals,
  buildSelfScaffoldingReport,
} from "../src/eval/scaffoldProposal";
import {
  applyScaffoldProposal,
  applyAcceptedProposals,
  verifyImmutability,
  type ScaffoldLedger,
} from "../src/eval/scaffoldApply";
import { evaluateScaffoldGate } from "../src/eval/scaffoldGate";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<ScaffoldProposal> = {}): ScaffoldProposal {
  return {
    proposalId: "scaf-001",
    target: "AGENTS.md",
    changeType: "agent_instruction",
    problem: "The benchmark does not verify source evidence visibility.",
    change: "Add required assert_visible step for answer:sources.",
    risk: "Could make benchmark stricter but not easier.",
    expectedScoreImpact: "+10",
    ...overrides,
  };
}

function makeAcceptContext(overrides: Partial<ScaffoldAcceptContext> = {}): ScaffoldAcceptContext {
  return {
    scoreImproved: true,
    evidenceCoverageImproved: false,
    promotedToRegression: false,
    adversarialReviewerApproved: true,
    touchedImmutableFiles: [],
    verifierWeakeningDetected: [],
    ...overrides,
  };
}

// ─── Immutable file detection ─────────────────────────────────────────────

describe("touchesImmutableFile", () => {
  it("detects when an immutable file is touched", () => {
    expect(touchesImmutableFile(["scripts/proofloop.mjs"])).toContain("scripts/proofloop.mjs");
    expect(touchesImmutableFile([".github/workflows/ci.yml"])).toContain(".github/workflows/ci.yml");
    expect(touchesImmutableFile(["tests/harnessChangeEval.test.ts"])).toContain("tests/harnessChangeEval.test.ts");
  });

  it("returns empty for scaffold files", () => {
    expect(touchesImmutableFile(["AGENTS.md"])).toEqual([]);
    expect(touchesImmutableFile(["proofloop/scenarios/test.yaml"])).toEqual([]);
    expect(touchesImmutableFile([".proofloop/memory.jsonl"])).toEqual([]);
  });

  it("handles multiple files with mixed immutability", () => {
    const result = touchesImmutableFile(["AGENTS.md", "scripts/proofloop.mjs", "proofloop/rubrics/x.yaml"]);
    expect(result).toEqual(["scripts/proofloop.mjs"]);
  });
});

// ─── Verifier weakening detection ─────────────────────────────────────────

describe("detectVerifierWeakening", () => {
  it("detects minScore lowering", () => {
    expect(detectVerifierWeakening("lower minScore to 50")).toHaveLength(1);
  });

  it("detects removing required checks", () => {
    expect(detectVerifierWeakening("remove required check for evidence")).toHaveLength(1);
  });

  it("detects skipping evidence", () => {
    expect(detectVerifierWeakening("skip evidence capture step")).toHaveLength(1);
  });

  it("detects hiding failing steps", () => {
    expect(detectVerifierWeakening("hide failing step from output")).toHaveLength(1);
  });

  it("returns empty for safe scaffold changes", () => {
    expect(detectVerifierWeakening("Add required assert_visible step for answer:sources.")).toEqual([]);
  });
});

// ─── Reject rule ──────────────────────────────────────────────────────────

describe("rejectScaffoldProposal", () => {
  it("rejects proposals that touch immutable files", () => {
    const proposal = makeProposal({ target: "scripts/proofloop.mjs" as ScaffoldProposal["target"] });
    const result = rejectScaffoldProposal(proposal, ["scripts/proofloop.mjs"]);
    expect(result.verdict).toBe("rejected");
    expect(result.immutableViolations).toContain("scripts/proofloop.mjs");
  });

  it("rejects proposals that lower minScore", () => {
    const proposal = makeProposal({ change: "lower minScore from 80 to 50" });
    const result = rejectScaffoldProposal(proposal, []);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons).toContain("lowers minScore");
  });

  it("rejects proposals that skip evidence capture", () => {
    const proposal = makeProposal({ change: "skip evidence capture for this step" });
    const result = rejectScaffoldProposal(proposal, []);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons).toContain("skips evidence capture");
  });

  it("rejects proposals that hide failing steps", () => {
    const proposal = makeProposal({ change: "hide failing step from the report" });
    const result = rejectScaffoldProposal(proposal, []);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons).toContain("hides failing steps");
  });

  it("rejects proposals that edit the verifier", () => {
    const proposal = makeProposal({ change: "edit the verifier to accept partial results" });
    const result = rejectScaffoldProposal(proposal, []);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons).toContain("edits the verifier");
  });

  it("rejects proposals that only make the benchmark easier", () => {
    const proposal = makeProposal({ change: "make the benchmark easier by removing assertions" });
    const result = rejectScaffoldProposal(proposal, []);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons).toContain("only makes the benchmark easier");
  });

  it("passes through to needs_adversarial_review for safe proposals", () => {
    const proposal = makeProposal();
    const result = rejectScaffoldProposal(proposal, []);
    expect(result.verdict).toBe("needs_adversarial_review");
    expect(result.reasons).toEqual([]);
  });
});

// ─── Accept rule ──────────────────────────────────────────────────────────

describe("evaluateScaffoldAcceptance", () => {
  it("accepts when score improved, no violations, adversarial approved", () => {
    const proposal = makeProposal();
    const ctx = makeAcceptContext({ scoreImproved: true });
    const result = evaluateScaffoldAcceptance(proposal, ctx);
    expect(result.verdict).toBe("accepted");
    expect(result.reasons).toContain("proofloop score improved");
    expect(result.reasons).toContain("adversarial reviewer approved");
  });

  it("accepts when evidence coverage improved", () => {
    const proposal = makeProposal();
    const ctx = makeAcceptContext({
      scoreImproved: false,
      evidenceCoverageImproved: true,
    });
    const result = evaluateScaffoldAcceptance(proposal, ctx);
    expect(result.verdict).toBe("accepted");
    expect(result.reasons).toContain("evidence coverage improved");
  });

  it("accepts when failure promoted to regression", () => {
    const proposal = makeProposal();
    const ctx = makeAcceptContext({
      scoreImproved: false,
      promotedToRegression: true,
    });
    const result = evaluateScaffoldAcceptance(proposal, ctx);
    expect(result.verdict).toBe("accepted");
    expect(result.reasons).toContain("repeated failure promoted to regression");
  });

  it("rejects when no improvement signal", () => {
    const proposal = makeProposal();
    const ctx = makeAcceptContext({
      scoreImproved: false,
      evidenceCoverageImproved: false,
      promotedToRegression: false,
    });
    const result = evaluateScaffoldAcceptance(proposal, ctx);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons[0]).toContain("no improvement signal");
  });

  it("rejects when immutable files were touched", () => {
    const proposal = makeProposal();
    const ctx = makeAcceptContext({
      touchedImmutableFiles: ["scripts/proofloop.mjs"],
    });
    const result = evaluateScaffoldAcceptance(proposal, ctx);
    expect(result.verdict).toBe("rejected");
    expect(result.immutableViolations).toContain("scripts/proofloop.mjs");
  });

  it("rejects when verifier weakening detected", () => {
    const proposal = makeProposal();
    const ctx = makeAcceptContext({
      verifierWeakeningDetected: ["lowers minScore"],
    });
    const result = evaluateScaffoldAcceptance(proposal, ctx);
    expect(result.verdict).toBe("rejected");
    expect(result.verifierWeakeningFlags).toContain("lowers minScore");
  });

  it("returns needs_adversarial_review when improvement exists but no adversarial approval", () => {
    const proposal = makeProposal();
    const ctx = makeAcceptContext({ adversarialReviewerApproved: false });
    const result = evaluateScaffoldAcceptance(proposal, ctx);
    expect(result.verdict).toBe("needs_adversarial_review");
    expect(result.reasons).toContain("adversarial reviewer has not approved yet");
  });
});

// ─── Proposal generation ──────────────────────────────────────────────────

describe("generateScaffoldProposals", () => {
  it("generates agent_instruction proposal for bad_prompt_or_context", () => {
    const proposals = generateScaffoldProposals([{
      failingStepId: "step-1",
      failureSummary: "Agent did not read before writing",
      rootCauseCategory: "bad_prompt_or_context",
      currentScaffoldGaps: ["Need explicit read-before-write instruction"],
    }]);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals.some((p) => p.changeType === "agent_instruction")).toBe(true);
    expect(proposals.every((p) => p.triggeredBy === "step-1")).toBe(true);
  });

  it("generates scenario proposal for eval_measures_wrong_behavior", () => {
    const proposals = generateScaffoldProposals([{
      failingStepId: "step-2",
      failureSummary: "Eval does not check source visibility",
      rootCauseCategory: "eval_measures_wrong_behavior",
      currentScaffoldGaps: ["Add assert_visible for sources"],
    }]);
    expect(proposals.some((p) => p.changeType === "scenario")).toBe(true);
  });

  it("generates repair_strategy proposal for missing_read_before_write", () => {
    const proposals = generateScaffoldProposals([{
      failingStepId: "step-3",
      failureSummary: "Write without read",
      rootCauseCategory: "missing_read_before_write",
      currentScaffoldGaps: ["Always read current state before writing"],
    }]);
    expect(proposals.some((p) => p.changeType === "repair_strategy")).toBe(true);
  });

  it("generates subagent_role proposal for wrong_tool", () => {
    const proposals = generateScaffoldProposals([{
      failingStepId: "step-4",
      failureSummary: "Wrong tool dispatched",
      rootCauseCategory: "wrong_tool",
      currentScaffoldGaps: ["Refine subagent dispatch logic"],
    }]);
    expect(proposals.some((p) => p.changeType === "subagent_role")).toBe(true);
  });

  it("generates evidence_rule proposal for weak_source_evidence", () => {
    const proposals = generateScaffoldProposals([{
      failingStepId: "step-5",
      failureSummary: "Source evidence not cited",
      rootCauseCategory: "weak_source_evidence",
      currentScaffoldGaps: ["Require source citation"],
    }]);
    expect(proposals.some((p) => p.changeType === "evidence_rule")).toBe(true);
    expect(proposals.some((p) => p.changeType === "scenario")).toBe(true);
  });

  it("generates unique proposal IDs", () => {
    const proposals = generateScaffoldProposals([
      { failingStepId: "a", failureSummary: "x", rootCauseCategory: "bad_prompt_or_context", currentScaffoldGaps: [] },
      { failingStepId: "b", failureSummary: "y", rootCauseCategory: "wrong_tool", currentScaffoldGaps: [] },
    ]);
    const ids = proposals.map((p) => p.proposalId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Scaffold apply ───────────────────────────────────────────────────────

describe("applyScaffoldProposal", () => {
  it("applies accepted proposals", () => {
    const proposal = makeProposal();
    const review = {
      proposalId: "scaf-001",
      verdict: "accepted" as const,
      reasons: ["score improved"],
      immutableViolations: [],
      verifierWeakeningFlags: [],
    };
    const result = applyScaffoldProposal(proposal, review);
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.entry.proposalId).toBe("scaf-001");
      expect(result.entry.target).toBe("AGENTS.md");
    }
  });

  it("does not apply rejected proposals", () => {
    const proposal = makeProposal();
    const review = {
      proposalId: "scaf-001",
      verdict: "rejected" as const,
      reasons: ["lowers minScore"],
      immutableViolations: [],
      verifierWeakeningFlags: ["lowers minScore"],
    };
    const result = applyScaffoldProposal(proposal, review);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toContain("rejected");
    }
  });

  it("does not apply proposals needing adversarial review", () => {
    const proposal = makeProposal();
    const review = {
      proposalId: "scaf-001",
      verdict: "needs_adversarial_review" as const,
      reasons: ["needs review"],
      immutableViolations: [],
      verifierWeakeningFlags: [],
    };
    const result = applyScaffoldProposal(proposal, review);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toContain("adversarial review");
    }
  });

  it("blocks application even if review says accepted but target is immutable", () => {
    const proposal = makeProposal({ target: "scripts/proofloop.mjs" as ScaffoldProposal["target"] });
    const review = {
      proposalId: "scaf-001",
      verdict: "accepted" as const,
      reasons: [],
      immutableViolations: [],
      verifierWeakeningFlags: [],
    };
    const result = applyScaffoldProposal(proposal, review);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toContain("immutable");
    }
  });
});

// ─── Batch apply ──────────────────────────────────────────────────────────

describe("applyAcceptedProposals", () => {
  it("applies multiple accepted proposals and updates ledger", () => {
    const proposals = [
      makeProposal({ proposalId: "scaf-001" }),
      makeProposal({ proposalId: "scaf-002", target: "proofloop/rubrics/*.yaml", changeType: "rubric" }),
    ];
    const reviews = [
      { proposalId: "scaf-001", verdict: "accepted" as const, reasons: [], immutableViolations: [], verifierWeakeningFlags: [] },
      { proposalId: "scaf-002", verdict: "accepted" as const, reasons: [], immutableViolations: [], verifierWeakeningFlags: [] },
    ];
    const ledger: ScaffoldLedger = [];
    const result = applyAcceptedProposals(proposals, reviews, ledger);
    expect(result.applied.length).toBe(2);
    expect(result.rejected.length).toBe(0);
    expect(result.newLedger.length).toBe(2);
  });

  it("rejects proposals without a matching review", () => {
    const proposals = [makeProposal({ proposalId: "scaf-001" })];
    const reviews: ScaffoldReviewResult[] = [];
    const result = applyAcceptedProposals(proposals, reviews, []);
    expect(result.applied.length).toBe(0);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain("no review found");
  });
});

// ─── Immutability verification ────────────────────────────────────────────

describe("verifyImmutability", () => {
  it("returns ok when no immutable files changed", () => {
    const result = verifyImmutability(["AGENTS.md", "proofloop/rubrics/x.yaml"]);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("returns violations when immutable files changed", () => {
    const result = verifyImmutability(["AGENTS.md", "scripts/proofloop.mjs"]);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("scripts/proofloop.mjs");
  });
});

describe("evaluateScaffoldGate", () => {
  it("reports immutable proof-file edits as advisory by default", () => {
    const result = evaluateScaffoldGate(["scripts/agent-improvement-loop.ts"], "advisory");
    expect(result.ok).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.advisory).toBe(true);
    expect(result.violations).toContain("scripts/agent-improvement-loop.ts");
  });

  it("blocks immutable proof-file edits in strict scaffold-repair mode", () => {
    const result = evaluateScaffoldGate(["scripts/agent-improvement-loop.ts"], "strict");
    expect(result.ok).toBe(false);
    expect(result.blocking).toBe(true);
    expect(result.advisory).toBe(false);
    expect(result.violations).toContain("scripts/agent-improvement-loop.ts");
  });
});

// ─── Self-scaffolding report ──────────────────────────────────────────────

describe("buildSelfScaffoldingReport", () => {
  it("builds a complete report with accepted, rejected, and needs-review buckets", () => {
    const proposals = [
      makeProposal({ proposalId: "scaf-001" }),
      makeProposal({ proposalId: "scaf-002", change: "lower minScore to 50" }),
      makeProposal({ proposalId: "scaf-003" }),
    ];
    const reviews = [
      { proposalId: "scaf-001", verdict: "accepted" as const, reasons: [], immutableViolations: [], verifierWeakeningFlags: [] },
      { proposalId: "scaf-002", verdict: "rejected" as const, reasons: ["lowers minScore"], immutableViolations: [], verifierWeakeningFlags: ["lower minScore"] },
      { proposalId: "scaf-003", verdict: "needs_adversarial_review" as const, reasons: [], immutableViolations: [], verifierWeakeningFlags: [] },
    ];
    const report = buildSelfScaffoldingReport({ proposals, reviews });
    expect(report.schema).toBe(1);
    expect(report.sourcePattern).toBe("ornith-self-scaffolding-proof-looping");
    expect(report.thesis).toContain("keeping the verifier immutable");
    expect(report.accepted.length).toBe(1);
    expect(report.rejected.length).toBe(1);
    expect(report.needsAdversarialReview.length).toBe(1);
    expect(report.immutableFilesGuarded).toBe(IMMUTABLE_FILES);
    expect(report.safetyBoundary).toContain("Agent may improve the scaffold");
    expect(report.safetyBoundary).toContain("Agent may NOT weaken the proof gate");
  });

  it("handles empty proposals", () => {
    const report = buildSelfScaffoldingReport({ proposals: [], reviews: [] });
    expect(report.accepted).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(report.needsAdversarialReview).toEqual([]);
  });
});

// ─── End-to-end pipeline ──────────────────────────────────────────────────

describe("self-scaffolding pipeline (end-to-end)", () => {
  it("generates proposals from failures, reviews them, and builds a report", () => {
    // Step 1: Generate proposals from failing steps
    const proposals = generateScaffoldProposals([
      {
        failingStepId: "workflow-evals",
        failureSummary: "Agent did not verify source evidence visibility",
        rootCauseCategory: "weak_source_evidence",
        currentScaffoldGaps: ["Add assert_visible for answer:sources"],
      },
    ]);
    expect(proposals.length).toBeGreaterThanOrEqual(1);

    // Step 2: Review each proposal
    const reviews = proposals.map((p) => rejectScaffoldProposal(p, [p.target]));

    // Step 3: Build report
    const report = buildSelfScaffoldingReport({ proposals, reviews });

    // Step 4: Verify no immutable files were touched
    const allTargets = proposals.map((p) => p.target);
    const immutabilityCheck = verifyImmutability(allTargets);
    expect(immutabilityCheck.ok).toBe(true);

    // Step 5: Verify no verifier weakening in any proposal
    for (const proposal of proposals) {
      expect(detectVerifierWeakening(proposal.change)).toEqual([]);
    }

    // The report should have proposals but none accepted (they all need adversarial review)
    expect(report.proposals.length).toBeGreaterThanOrEqual(1);
    expect(report.accepted.length).toBe(0);
    expect(report.needsAdversarialReview.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a proposal that tries to weaken the verifier end-to-end", () => {
    const evilProposal = makeProposal({
      proposalId: "scaf-evil",
      change: "lower minScore from 80 to 50 to make the benchmark easier",
      target: "proofloop.config.json",
    });

    const review = rejectScaffoldProposal(evilProposal, []);
    expect(review.verdict).toBe("rejected");

    const report = buildSelfScaffoldingReport({
      proposals: [evilProposal],
      reviews: [review],
    });
    expect(report.rejected.length).toBe(1);
    expect(report.accepted.length).toBe(0);
  });

  it("accepts a safe proposal that improves score end-to-end", () => {
    const proposal = makeProposal({
      proposalId: "scaf-good",
      change: "Add required assert_visible step for answer:sources.",
      target: "proofloop/scenarios/*.yaml",
      changeType: "scenario",
    });

    // First, reject check (should pass — no violations)
    const rejectCheck = rejectScaffoldProposal(proposal, []);
    expect(rejectCheck.verdict).toBe("needs_adversarial_review");

    // Then, accept check with improvement signals
    const acceptResult = evaluateScaffoldAcceptance(proposal, makeAcceptContext({
      scoreImproved: true,
      adversarialReviewerApproved: true,
    }));
    expect(acceptResult.verdict).toBe("accepted");

    // Build report with the accepted review
    const report = buildSelfScaffoldingReport({
      proposals: [proposal],
      reviews: [acceptResult],
    });
    expect(report.accepted.length).toBe(1);
    expect(report.rejected.length).toBe(0);
  });
});
