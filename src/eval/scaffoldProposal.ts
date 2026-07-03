/**
 * Self-scaffolding proof-looping — the Ornith-1.0 lesson applied to NodeRoom.
 *
 * Core thesis: Proof-looping runs the proof. Self-scaffolding proof-looping
 * improves the proof process itself — while keeping the verifier immutable.
 *
 * The loop:
 *   patch app → run proofloop → analyze failure
 *   → propose scaffold improvement + propose code improvement
 *   → run proofloop again
 *   → keep only changes that improve score
 *   → promote fixed failure into regression
 *
 * What counts as scaffold (agent MAY edit):
 *   AGENTS.md, proofloop.config.json, scenarios/*.yaml, rubrics/*.yaml,
 *   subagents/*.md, adapters/*.js, memory.jsonl, system prompt guidance
 *
 * What must be immutable (agent may NOT edit during repair):
 *   scripts/proofloop.mjs, hidden regression tests, CI workflow gate,
 *   proof score calculation, evidence requirement checker,
 *   protected benchmark fixtures
 *
 * Safety rule: "Let the agent improve the playbook, but never let it move the goalpost."
 */

import type { RootCauseCategory } from "./improvementArtifacts";

// ─── Types ────────────────────────────────────────────────────────────────

// Where a proposal/failure/regression actually originated -- see
// noderl/spec/anti-reward-hacking-doctrine.md. Optional and additive: nothing that already
// constructs a ScaffoldProposal (or the promoted-regressions.json entries in proofloop-cli.ts, or the
// TaskFailure/NodeMemFailurePattern records in src/nodemem/failureMemory.ts) needs to change.
// A scaffold-delta suggestion grounded in "real_user_run" or "official_benchmark" should be
// trusted over one grounded in "synthetic_edge_case" or "model_generated_proposal" -- treating
// them as equally trustworthy is the model-collapse failure mode (training the loop's future
// behavior only on its own generated output).
export type ProofLoopSource =
  | "real_user_run"
  | "live_browser_proof"
  | "official_benchmark"
  | "human_feedback"
  | "redteam_proposal"
  | "synthetic_edge_case"
  | "model_generated_proposal";

export type ScaffoldChangeType =
  | "scenario"
  | "rubric"
  | "agent_instruction"
  | "memory_rule"
  | "subagent_role"
  | "repair_strategy"
  | "evidence_rule";

export type ScaffoldTarget =
  | "AGENTS.md"
  | "CLAUDE.md"
  | "proofloop.config.json"
  | "proofloop/scenarios/*.yaml"
  | "proofloop/rubrics/*.yaml"
  | "proofloop/subagents/*.md"
  | "proofloop/adapters/*.js"
  | ".proofloop/memory.jsonl"
  | "src/nodeagent/models/prompts/systemPrompt.ts";

/** Files the agent may NOT modify during scaffold repair. */
export const IMMUTABLE_FILES: readonly string[] = [
  "scripts/proofloop.mjs",
  "scripts/agent-improvement-loop.ts",
  "tests/harnessChangeEval.test.ts",
  ".github/workflows/",
  "src/eval/evalTrustPolicy.ts",
  "src/eval/architectureBudget.ts",
  "evals/evalStore.ts",
];

/**
 * Patterns that indicate a scaffold change weakens the verifier.
 * Exported so `proofloop hooks install` can snapshot the real list into its
 * PreToolUse guard config instead of maintaining a drifting duplicate.
 */
export const VERIFIER_WEAKENING_PATTERNS: readonly RegExp[] = [
  /minScore\s*[:=]\s*\d+/i, // lowering minScore
  /lower\s+minScore/i, // "lower minScore"
  /remove.*required.*check/i,
  /skip.*evidence/i,
  /hide.*failing/i,
  /disable.*gate/i,
  /bypass.*assertion/i,
];

export interface ScaffoldProposal {
  proposalId: string;
  target: ScaffoldTarget;
  changeType: ScaffoldChangeType;
  problem: string;
  change: string;
  risk: string;
  expectedScoreImpact: string;
  rootCauseCategory?: RootCauseCategory;
  /** The specific failing step or eval case that triggered this proposal. */
  triggeredBy?: string;
  /** Where the failure/insight behind this proposal actually came from. See ProofLoopSource. */
  source?: ProofLoopSource;
}

export type ScaffoldReviewVerdict = "accepted" | "rejected" | "needs_adversarial_review";

export interface ScaffoldReviewResult {
  proposalId: string;
  verdict: ScaffoldReviewVerdict;
  reasons: string[];
  immutableViolations: string[];
  verifierWeakeningFlags: string[];
}

export interface ScaffoldAcceptContext {
  /** Did the proofloop score improve after applying the scaffold change? */
  scoreImproved: boolean;
  /** Did evidence coverage improve? */
  evidenceCoverageImproved: boolean;
  /** Was a repeated failure promoted into a regression test? */
  promotedToRegression: boolean;
  /** Did the adversarial reviewer approve? */
  adversarialReviewerApproved: boolean;
  /** Did the change touch any immutable file? */
  touchedImmutableFiles: string[];
  /** Did the change weaken any verifier? */
  verifierWeakeningDetected: string[];
}

// ─── Immutable-file check ──────────────────────────────────────────────────

export function touchesImmutableFile(changedPaths: string[]): string[] {
  return changedPaths.filter((path) =>
    IMMUTABLE_FILES.some(
      (immutable) =>
        path === immutable ||
        path.startsWith(immutable) ||
        immutable.endsWith("/") && path.startsWith(immutable),
    ),
  );
}

// ─── Verifier-weakening detection ──────────────────────────────────────────

export function detectVerifierWeakening(changeDescription: string): string[] {
  const flags: string[] = [];
  for (const pattern of VERIFIER_WEAKENING_PATTERNS) {
    const match = changeDescription.match(pattern);
    if (match) flags.push(match[0]);
  }
  return flags;
}

// ─── Reject rule ────────────────────────────────────────────────────────────

export function rejectScaffoldProposal(
  proposal: ScaffoldProposal,
  changedPaths: string[],
): ScaffoldReviewResult {
  const reasons: string[] = [];
  const immutableViolations = touchesImmutableFile(changedPaths);
  const verifierWeakeningFlags = detectVerifierWeakening(proposal.change);

  if (immutableViolations.length > 0) {
    reasons.push(`touched immutable files: ${immutableViolations.join(", ")}`);
  }
  if (verifierWeakeningFlags.length > 0) {
    reasons.push(`verifier-weakening patterns detected: ${verifierWeakeningFlags.join(", ")}`);
  }

  // Explicit reject patterns from the spec
  const rejectPatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /removes?\s+required\s+check/i, reason: "removes required checks" },
    { pattern: /lower[s]?\s+minScore/i, reason: "lowers minScore" },
    { pattern: /skip[s]?\s+evidence\s+capture/i, reason: "skips evidence capture" },
    { pattern: /hide[s]?\s+failing\s+step/i, reason: "hides failing steps" },
    { pattern: /edit[s]?\s+(the\s+)?verifier/i, reason: "edits the verifier" },
    { pattern: /edit[s]?\s+CI\s+gate/i, reason: "edits CI gate" },
    { pattern: /make[s]?\s+(the\s+)?benchmark\s+easier/i, reason: "only makes the benchmark easier" },
  ];

  for (const { pattern, reason } of rejectPatterns) {
    if (pattern.test(proposal.change) || pattern.test(proposal.problem)) {
      reasons.push(reason);
    }
  }

  return {
    proposalId: proposal.proposalId,
    verdict: reasons.length > 0 ? "rejected" : "needs_adversarial_review",
    reasons,
    immutableViolations,
    verifierWeakeningFlags,
  };
}

// ─── Accept rule ────────────────────────────────────────────────────────────

export function evaluateScaffoldAcceptance(
  proposal: ScaffoldProposal,
  ctx: ScaffoldAcceptContext,
): ScaffoldReviewResult {
  // Hard reject: immutable files touched or verifier weakened
  if (ctx.touchedImmutableFiles.length > 0) {
    return {
      proposalId: proposal.proposalId,
      verdict: "rejected",
      reasons: [`touched immutable files: ${ctx.touchedImmutableFiles.join(", ")}`],
      immutableViolations: ctx.touchedImmutableFiles,
      verifierWeakeningFlags: ctx.verifierWeakeningDetected,
    };
  }
  if (ctx.verifierWeakeningDetected.length > 0) {
    return {
      proposalId: proposal.proposalId,
      verdict: "rejected",
      reasons: [`verifier weakened: ${ctx.verifierWeakeningDetected.join(", ")}`],
      immutableViolations: [],
      verifierWeakeningFlags: ctx.verifierWeakeningDetected,
    };
  }

  // Accept conditions: at least one improvement signal
  const improvementSignals: string[] = [];
  if (ctx.scoreImproved) improvementSignals.push("proofloop score improved");
  if (ctx.evidenceCoverageImproved) improvementSignals.push("evidence coverage improved");
  if (ctx.promotedToRegression) improvementSignals.push("repeated failure promoted to regression");

  if (improvementSignals.length === 0) {
    return {
      proposalId: proposal.proposalId,
      verdict: "rejected",
      reasons: ["no improvement signal: score did not improve, evidence coverage did not improve, and no failure was promoted to regression"],
      immutableViolations: [],
      verifierWeakeningFlags: [],
    };
  }

  // Adversarial reviewer must approve
  if (!ctx.adversarialReviewerApproved) {
    return {
      proposalId: proposal.proposalId,
      verdict: "needs_adversarial_review",
      reasons: [...improvementSignals, "adversarial reviewer has not approved yet"],
      immutableViolations: [],
      verifierWeakeningFlags: [],
    };
  }

  return {
    proposalId: proposal.proposalId,
    verdict: "accepted",
    reasons: [...improvementSignals, "adversarial reviewer approved", "no immutable files touched", "no verifier weakening detected"],
    immutableViolations: [],
    verifierWeakeningFlags: [],
  };
}

// ─── Proposal generation from failure ───────────────────────────────────────

export interface ScaffoldProposalSeed {
  failingStepId: string;
  failureSummary: string;
  rootCauseCategory: RootCauseCategory;
  currentScaffoldGaps: string[];
}

/**
 * Generate scaffold proposals from a failing proofloop step.
 * Each proposal targets a specific scaffold file and describes what to change.
 */
export function generateScaffoldProposals(seeds: ScaffoldProposalSeed[]): ScaffoldProposal[] {
  const proposals: ScaffoldProposal[] = [];
  let counter = 0;

  for (const seed of seeds) {
    counter++;

    // Agent instruction proposal — fix the prompt/playbook
    if (
      seed.rootCauseCategory === "bad_prompt_or_context" ||
      seed.rootCauseCategory === "stale_context"
    ) {
      proposals.push({
        proposalId: `scaf-${String(counter).padStart(3, "0")}`,
        target: "AGENTS.md",
        changeType: "agent_instruction",
        problem: seed.failureSummary,
        change: `Add explicit instruction for step ${seed.failingStepId}: ${seed.currentScaffoldGaps.join("; ")}`,
        risk: "Could make instructions stricter but not easier.",
        expectedScoreImpact: "+5 to +15",
        rootCauseCategory: seed.rootCauseCategory,
        triggeredBy: seed.failingStepId,
      });
    }

    // Scenario proposal — fix the test scenario
    if (
      seed.rootCauseCategory === "eval_measures_wrong_behavior" ||
      seed.rootCauseCategory === "weak_source_evidence"
    ) {
      proposals.push({
        proposalId: `scaf-${String(counter).padStart(3, "0")}`,
        target: "proofloop/scenarios/*.yaml",
        changeType: "scenario",
        problem: seed.failureSummary,
        change: `Add required evidence assertion for step ${seed.failingStepId}: ${seed.currentScaffoldGaps.join("; ")}`,
        risk: "Could make benchmark stricter but not easier.",
        expectedScoreImpact: "+10",
        rootCauseCategory: seed.rootCauseCategory,
        triggeredBy: seed.failingStepId,
      });
    }

    // Repair strategy proposal — fix how the agent repairs
    if (
      seed.rootCauseCategory === "missing_read_before_write" ||
      seed.rootCauseCategory === "bad_mutation_contract"
    ) {
      proposals.push({
        proposalId: `scaf-${String(counter).padStart(3, "0")}`,
        target: ".proofloop/memory.jsonl",
        changeType: "repair_strategy",
        problem: seed.failureSummary,
        change: `Record repair pattern: always read current state + version before writing in step ${seed.failingStepId}`,
        risk: "Could make repair stricter but not easier.",
        expectedScoreImpact: "+10",
        rootCauseCategory: seed.rootCauseCategory,
        triggeredBy: seed.failingStepId,
      });
    }

    // Subagent role proposal — fix subagent dispatch
    if (seed.rootCauseCategory === "wrong_tool") {
      proposals.push({
        proposalId: `scaf-${String(counter).padStart(3, "0")}`,
        target: "proofloop/subagents/*.md",
        changeType: "subagent_role",
        problem: seed.failureSummary,
        change: `Refine subagent role for step ${seed.failingStepId}: ${seed.currentScaffoldGaps.join("; ")}`,
        risk: "Could make subagent dispatch stricter but not easier.",
        expectedScoreImpact: "+5 to +10",
        rootCauseCategory: seed.rootCauseCategory,
        triggeredBy: seed.failingStepId,
      });
    }

    // Evidence rule proposal — fix evidence requirements
    if (seed.rootCauseCategory === "weak_source_evidence") {
      proposals.push({
        proposalId: `scaf-${String(counter).padStart(3, "0")}`,
        target: "proofloop/rubrics/*.yaml",
        changeType: "evidence_rule",
        problem: seed.failureSummary,
        change: `Add evidence requirement: source must be visible and cited for step ${seed.failingStepId}`,
        risk: "Could make evidence requirements stricter but not easier.",
        expectedScoreImpact: "+10",
        rootCauseCategory: seed.rootCauseCategory,
        triggeredBy: seed.failingStepId,
      });
    }
  }

  return proposals;
}

// ─── Self-scaffolding loop result ───────────────────────────────────────────

export interface SelfScaffoldingLoopResult {
  schema: 1;
  generatedAt: string;
  sourcePattern: "ornith-self-scaffolding-proof-looping";
  thesis: string;
  proposals: ScaffoldProposal[];
  reviews: ScaffoldReviewResult[];
  accepted: ScaffoldProposal[];
  rejected: ScaffoldProposal[];
  needsAdversarialReview: ScaffoldProposal[];
  immutableFilesGuarded: readonly string[];
  safetyBoundary: string;
}

export function buildSelfScaffoldingReport(input: {
  generatedAt?: string;
  proposals: ScaffoldProposal[];
  reviews: ScaffoldReviewResult[];
}): SelfScaffoldingLoopResult {
  const accepted = input.proposals.filter((p) => {
    const review = input.reviews.find((r) => r.proposalId === p.proposalId);
    return review?.verdict === "accepted";
  });
  const rejected = input.proposals.filter((p) => {
    const review = input.reviews.find((r) => r.proposalId === p.proposalId);
    return review?.verdict === "rejected";
  });
  const needsAdversarialReview = input.proposals.filter((p) => {
    const review = input.reviews.find((r) => r.proposalId === p.proposalId);
    return review?.verdict === "needs_adversarial_review";
  });

  return {
    schema: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourcePattern: "ornith-self-scaffolding-proof-looping",
    thesis: "Proof-looping runs the proof. Self-scaffolding proof-looping improves the proof process itself — while keeping the verifier immutable.",
    proposals: input.proposals,
    reviews: input.reviews,
    accepted,
    rejected,
    needsAdversarialReview,
    immutableFilesGuarded: IMMUTABLE_FILES,
    safetyBoundary:
      "Agent may improve the scaffold (playbook, rubrics, subagent roles, repair strategies). " +
      "Agent may NOT weaken the proof gate (verifier, CI gate, score calculation, hidden tests, protected fixtures). " +
      "Scaffold changes are kept only if proofloop score improves, evidence coverage improves, or a failure is promoted to regression — " +
      "AND no verifier/gate was weakened, no immutable file was modified, and the adversarial reviewer approves.",
  };
}
