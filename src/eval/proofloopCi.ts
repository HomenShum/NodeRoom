/**
 * Proof Loop CI installer -- `proofloop ci install github`.
 *
 * Writes a GitHub Actions workflow into a TARGET repo (--dir) that runs the
 * real Proof Loop gate (`proofloop gate --goal <id>`, see
 * scripts/proofloop-cli.ts cmdGoalGate) and fails the job when the persisted
 * goal ledger is not "passed".
 *
 * IMPORTANT: this repo's own `.github/workflows/` is on IMMUTABLE_FILES, so
 * this installer is never run against the noderoom repo itself -- it ships
 * only the template (proofloop/templates/github-proofloop-gate.yml) plus this
 * installer code. Tests target mkdtemp dirs only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const PROOFLOOP_CI_TEMPLATE_RELPATH = "proofloop/templates/github-proofloop-gate.yml";
export const PROOFLOOP_CI_WORKFLOW_RELPATH = ".github/workflows/proofloop-gate.yml";
export const PROOFLOOP_CI_GOAL_PLACEHOLDER = "__PROOFLOOP_GOAL__";

export type ProofloopCiInstallOptions = {
  /** Target repo root the workflow is written into. Default: cwd. */
  root?: string;
  /** Repo root that CONTAINS the template (this repo). Default: cwd. */
  sourceRoot?: string;
  /** Goal id the gate checks. Default: official-scores. */
  goalId?: string;
};

export type ProofloopCiInstallResult = {
  root: string;
  templatePath: string;
  workflowPath: string;
  goalId: string;
};

export function installProofloopGithubCi(options: ProofloopCiInstallOptions = {}): ProofloopCiInstallResult {
  const root = resolve(options.root ?? process.cwd());
  const sourceRoot = resolve(options.sourceRoot ?? process.cwd());
  const goalId = options.goalId ?? "official-scores";
  if (!/^[a-zA-Z0-9._-]+$/.test(goalId)) {
    throw new Error(`Invalid goal id for CI install: ${goalId}`);
  }

  const templatePath = join(sourceRoot, ...PROOFLOOP_CI_TEMPLATE_RELPATH.split("/"));
  if (!existsSync(templatePath)) {
    throw new Error(`Proof Loop CI template not found at ${templatePath}. Run from the repo that ships ${PROOFLOOP_CI_TEMPLATE_RELPATH}.`);
  }
  const template = readFileSync(templatePath, "utf8");
  const rendered = template.split(PROOFLOOP_CI_GOAL_PLACEHOLDER).join(goalId);

  const workflowPath = join(root, ...PROOFLOOP_CI_WORKFLOW_RELPATH.split("/"));
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, rendered, "utf8");

  return { root, templatePath, workflowPath, goalId };
}
