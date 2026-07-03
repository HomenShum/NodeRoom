/**
 * Scenario tests for `proofloop ci install github`.
 *
 * Persona: a founder adopts Proof Loop in THEIR product repo and wants the
 * gate red/green on every PR. The installer must write the workflow into the
 * TARGET repo only -- this repo's own .github/workflows/ is immutable and must
 * never gain a proofloop-gate.yml from this test suite.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installProofloopGithubCi, PROOFLOOP_CI_GOAL_PLACEHOLDER } from "../src/eval/proofloopCi";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-ci-"));
  tempRoots.push(root);
  return root;
}

describe("proofloop ci install github", () => {
  it("writes the workflow into the target repo and references the real gate command", () => {
    const root = tempRoot();
    const result = installProofloopGithubCi({ root, sourceRoot: process.cwd() });

    expect(result.workflowPath).toBe(join(root, ".github", "workflows", "proofloop-gate.yml"));
    const workflow = readFileSync(result.workflowPath, "utf8");
    // The exact gate contract from scripts/proofloop-cli.ts cmdGoalGate.
    expect(workflow).toContain("npx tsx scripts/proofloop-cli.ts gate --goal official-scores");
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("npm ci");
    expect(workflow).not.toContain(PROOFLOOP_CI_GOAL_PLACEHOLDER);

    // Idempotent: reinstall with a custom goal overwrites cleanly.
    const custom = installProofloopGithubCi({ root, sourceRoot: process.cwd(), goalId: "my-goal" });
    expect(readFileSync(custom.workflowPath, "utf8")).toContain("gate --goal my-goal");
  });

  it("rejects goal ids that would break the YAML and reports a missing template clearly", () => {
    const root = tempRoot();
    expect(() => installProofloopGithubCi({ root, sourceRoot: process.cwd(), goalId: "bad goal; rm -rf" })).toThrow(/Invalid goal id/);
    expect(() => installProofloopGithubCi({ root, sourceRoot: root })).toThrow(/template not found/);
    expect(existsSync(join(root, ".github", "workflows", "proofloop-gate.yml"))).toBe(false);
  });

  it("never creates the workflow in this repo itself", () => {
    // The installer only ever ran against temp dirs above; assert the
    // IMMUTABLE .github/workflows/ of this repo did not gain our file.
    expect(existsSync(join(process.cwd(), ".github", "workflows", "proofloop-gate.yml"))).toBe(false);
  });
});
