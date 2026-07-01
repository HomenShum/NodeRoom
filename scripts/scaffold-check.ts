/**
 * Scaffold check — standalone CLI for self-scaffolding proof-looping.
 *
 * Usage:
 *   npx tsx scripts/scaffold-check.ts                  # check current diff
 *   npx tsx scripts/scaffold-check.ts --base=main      # check diff against base
 *   npx tsx scripts/scaffold-check.ts --report-only     # just generate the handoff
 *   npx tsx scripts/scaffold-check.ts --strict-immutability
 *                                                         # hard gate for scaffold-repair PRs
 *
 * What it does:
 *   1. Gets the list of files changed in the current branch (vs base)
 *   2. Checks immutable files. Advisory by default; strict mode fails scaffold-repair PRs.
 *   3. Runs the scaffold proposal pipeline (if agent-improvement-loop output exists)
 *   4. Generates a coding-agent handoff document with accepted proposals
 *   5. Writes the handoff to docs/eval/scaffold-handoff.md
 *
 * Exit codes:
 *   0 — all clear, handoff generated
 *   1 — immutable files violated in strict scaffold-repair mode
 *   2 — no changes to check
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMMUTABLE_FILES,
  rejectScaffoldProposal,
  generateScaffoldProposals,
  buildSelfScaffoldingReport,
  type SelfScaffoldingLoopResult,
} from "../src/eval/scaffoldProposal";
import { evaluateScaffoldGate, type ScaffoldGateResult } from "../src/eval/scaffoldGate";

// ─── Args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const baseArg = args.find((a) => a.startsWith("--base="));
const base = baseArg ? baseArg.split("=")[1] : "origin/main";
const reportOnly = args.includes("--report-only");
const strictImmutability = args.includes("--strict-immutability") || args.includes("--scaffold-repair");
const handoffPath = join(process.cwd(), "docs", "eval", "scaffold-handoff.md");

// ─── Get changed files ─────────────────────────────────────────────────────

function getChangedFiles(base: string): string[] {
  const changed = new Set<string>();
  const addLines = (stdout: string) => {
    for (const line of stdout.trim().split("\n").filter(Boolean)) changed.add(line);
  };

  const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  if (result.status === 0) {
    addLines(result.stdout);
  }

  // Include local tracked edits so `npm run scaffold:check` is useful before commit.
  const local = spawnSync("git", ["diff", "--name-only", "HEAD"], {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  if (local.status === 0) addLines(local.stdout);

  // Include untracked files that would be part of the PR.
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  if (untracked.status === 0) addLines(untracked.stdout);

  return [...changed].sort();
}

// ─── Load latest agent-improvement-loop output ─────────────────────────────

function loadLatestLoopRun(): { steps: Array<{ id: string; status: string; reason?: string }> } | null {
  const latestJson = join(process.cwd(), "docs", "eval", "agent-improvement-loop", "latest.json");
  if (!existsSync(latestJson)) return null;
  try {
    return JSON.parse(readFileSync(latestJson, "utf-8"));
  } catch {
    return null;
  }
}

// ─── Generate coding-agent handoff ─────────────────────────────────────────

function renderCodingAgentHandoff(
  report: SelfScaffoldingLoopResult,
  changedFiles: string[],
  gate: ScaffoldGateResult,
): string {
  const lines: string[] = [];

  lines.push("# Scaffold Handoff — For Your Coding Agent");
  lines.push("");
  lines.push("> Your coding agent (Codex, Claude Code, etc.) should apply the accepted");
  lines.push("> scaffold proposals below. Do NOT touch any immutable files.");
  lines.push("");
  lines.push("## Immutability Check");
  lines.push("");
  lines.push(`Mode: **${gate.mode}**`);
  lines.push("");
  if (gate.violations.length === 0) {
    lines.push("✅ No immutable files were modified in this branch.");
  } else if (gate.blocking) {
    lines.push(`❌ IMMUTABLE FILES VIOLATED: ${gate.violations.join(", ")}`);
    lines.push("");
    lines.push("**This scaffold-repair PR must be rejected.** The following files must never be modified");
    lines.push("by scaffold proposals:");
    for (const f of IMMUTABLE_FILES) lines.push(`- \`${f}\``);
  } else {
    lines.push(`⚠️ Immutable proof files changed: ${gate.violations.join(", ")}`);
    lines.push("");
    lines.push("This is advisory because the check is not running in strict scaffold-repair mode.");
    lines.push("If this PR is applying accepted scaffold proposals, rerun with `--strict-immutability`");
    lines.push("and reject the PR unless the immutable changes are removed.");
    lines.push("");
    lines.push("Immutable files guarded during scaffold repair:");
    for (const f of IMMUTABLE_FILES) lines.push(`- \`${f}\``);
  }
  lines.push("");
  lines.push("## Changed Files");
  lines.push("");
  for (const f of changedFiles) lines.push(`- \`${f}\``);
  lines.push("");

  if (report.accepted.length === 0 && report.needsAdversarialReview.length === 0) {
    lines.push("## No Scaffold Proposals to Apply");
    lines.push("");
    lines.push("Either no failures were detected, or all proposals were rejected.");
    if (report.rejected.length > 0) {
      lines.push("");
      lines.push("### Rejected Proposals");
      lines.push("");
      for (const r of report.rejected) {
        const review = report.reviews.find((rv) => rv.proposalId === r.proposalId);
        lines.push(`- **${r.proposalId}** (${r.target}): ${review?.reasons.join("; ")}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  if (report.accepted.length > 0) {
    lines.push("## Accepted Proposals — Apply These");
    lines.push("");
    lines.push("Your coding agent should make these changes to the scaffold files:");
    lines.push("");
    for (const proposal of report.accepted) {
      const review = report.reviews.find((r) => r.proposalId === proposal.proposalId);
      lines.push(`### ${proposal.proposalId}: ${proposal.changeType} → \`${proposal.target}\``);
      lines.push("");
      lines.push(`**Problem:** ${proposal.problem}`);
      lines.push("");
      lines.push(`**Change to apply:** ${proposal.change}`);
      lines.push("");
      lines.push(`**Why accepted:** ${review?.reasons.join("; ")}`);
      lines.push("");
      lines.push(`**Risk:** ${proposal.risk}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  if (report.needsAdversarialReview.length > 0) {
    lines.push("## Needs Adversarial Review — Do NOT Apply Yet");
    lines.push("");
    lines.push("These proposals passed the reject check but have not been approved by");
    lines.push("an adversarial reviewer. A human or frozen LLM judge must approve them first.");
    lines.push("");
    for (const proposal of report.needsAdversarialReview) {
      lines.push(`- **${proposal.proposalId}** (${proposal.target}): ${proposal.change}`);
    }
    lines.push("");
  }

  if (report.rejected.length > 0) {
    lines.push("## Rejected Proposals — Do NOT Apply");
    lines.push("");
    for (const r of report.rejected) {
      const review = report.reviews.find((rv) => rv.proposalId === r.proposalId);
      lines.push(`- **${r.proposalId}** (${r.target}): ${review?.reasons.join("; ")}`);
    }
    lines.push("");
  }

  lines.push("## Safety Boundary");
  lines.push("");
  lines.push("> Agent may improve the scaffold.");
  lines.push("> Agent may NOT weaken the proof gate.");
  lines.push("");
  lines.push("**Immutable files (never modify):**");
  for (const f of IMMUTABLE_FILES) lines.push(`- \`${f}\``);
  lines.push("");
  lines.push("**Scaffold files (safe to modify):**");
  lines.push("- `AGENTS.md`");
  lines.push("- `CLAUDE.md`");
  lines.push("- `proofloop/scenarios/*.yaml`");
  lines.push("- `proofloop/rubrics/*.yaml`");
  lines.push("- `proofloop/subagents/*.md`");
  lines.push("- `proofloop/adapters/*.js`");
  lines.push("- `.proofloop/memory.jsonl`");
  lines.push("- `src/nodeagent/models/prompts/systemPrompt.ts`");

  return `${lines.join("\n")}\n`;
}

// ─── Main ──────────────────────────────────────────────────────────────────

const changedFiles = reportOnly ? [] : getChangedFiles(base);

if (!reportOnly && changedFiles.length === 0) {
  console.log("scaffold-check: no changes to check");
  process.exit(2);
}

// Step 1: Immutability check. Advisory by default; strict for scaffold-repair PRs.
const scaffoldGate = evaluateScaffoldGate(changedFiles, strictImmutability ? "strict" : "advisory");

if (scaffoldGate.blocking) {
  console.error("scaffold-check: ❌ IMMUTABLE FILES VIOLATED IN STRICT MODE");
  console.error(`  Violations: ${scaffoldGate.violations.join(", ")}`);
  console.error("  These files must never be modified by scaffold proposals:");
  for (const f of IMMUTABLE_FILES) console.error(`    - ${f}`);
  process.exit(1);
}

if (scaffoldGate.advisory) {
  console.log(`scaffold-check: ⚠️ immutable proof files changed in advisory mode: ${scaffoldGate.violations.join(", ")}`);
} else {
  console.log(`scaffold-check: ✅ No blocking immutable-file violations (${changedFiles.length} files changed, mode=${scaffoldGate.mode})`);
}

// Step 2: Load latest loop run and generate scaffold proposals
const loopRun = loadLatestLoopRun();
let report: SelfScaffoldingLoopResult;

if (loopRun && loopRun.steps) {
  const failedSteps = loopRun.steps.filter((s) => s.status === "fail");
  const seeds = failedSteps.map((step) => ({
    failingStepId: step.id,
    failureSummary: step.reason ?? "see captured output",
    rootCauseCategory: "bad_prompt_or_context" as const,
    currentScaffoldGaps: [`Step ${step.id} failed — scaffold may need explicit instruction or evidence assertion.`],
  }));
  const proposals = generateScaffoldProposals(seeds);
  const reviews = proposals.map((p) => rejectScaffoldProposal(p, [p.target]));
  report = buildSelfScaffoldingReport({ proposals, reviews });
  console.log(`scaffold-check: ${proposals.length} proposals generated (${report.accepted.length} accepted, ${report.rejected.length} rejected, ${report.needsAdversarialReview.length} needs review)`);
} else {
  console.log("scaffold-check: no agent-improvement-loop output found — generating empty report");
  report = buildSelfScaffoldingReport({ proposals: [], reviews: [] });
}

// Step 3: Generate coding-agent handoff
const handoff = renderCodingAgentHandoff(report, changedFiles, scaffoldGate);
const handoffDir = join(process.cwd(), "docs", "eval");
mkdirSync(handoffDir, { recursive: true });
writeFileSync(handoffPath, handoff);

console.log(`scaffold-check: handoff written to ${handoffPath}`);

// Step 4: Also write JSON for programmatic consumption
const reportJsonPath = join(process.cwd(), "docs", "eval", "scaffold-report.json");
writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
console.log(`scaffold-check: report written to ${reportJsonPath}`);

process.exit(0);
