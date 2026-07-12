import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLaunchDoctorReceipt,
  evaluateLaunchGate,
  validateApproval,
  verifyLaunchProofBundle,
  type LaunchApproval,
  type LaunchEvidenceCheck,
} from "../src/launch/controlPlane";
import { launchCommandInvocation, launchPolicy, launchPolicyDigest } from "../src/launch/policy";
import { validateDeployedProofInput } from "../src/launch/deployedProof";

const APPROVAL: LaunchApproval = {
  schema: 1,
  privatePilotApproved: false,
  productionMigrationApproved: false,
  productionDeployApproved: false,
  publicReposApproved: false,
  productHuntSubmissionApproved: false,
  publicDistributionApproved: false,
  emailSendApproved: false,
  maxLaunchSpendUsd: 100,
  targetLaunchAt: null,
  approvedBy: null,
  approvedAt: null,
};

const PILOT_CHECKS = [
  "code.release-candidate",
  "code.typecheck",
  "code.convex-typecheck",
  "code.tests",
  "code.production-build",
  "pilot.authenticated-preview",
  "pilot.first-user-journey",
  "pilot.export-reopen",
  "pilot.reload-persistence",
  "pilot.current-revision-auth-phone",
  "pilot.issue-delete-support",
  "privacy.public-private-isolation",
  "privacy.beta-data-policy",
  "controls.job-cap",
  "controls.workspace-cap",
  "controls.global-spend-cap",
  "controls.kill-switch",
  "product.finance-claim-scope",
  "product.workbook-session",
  "product.launch-feature-scope",
  "operations.support-ready",
];

describe("launch control plane", () => {
  it("requires approver identity and timestamp whenever an irreversible approval is true", () => {
    expect(validateApproval(APPROVAL)).toEqual([]);
    expect(validateApproval({ ...APPROVAL, productionDeployApproved: true })).toEqual([
      "approvedBy and approvedAt are required when any approval is true",
    ]);
    expect(validateApproval({
      ...APPROVAL,
      productionDeployApproved: true,
      approvedBy: "release-owner",
      approvedAt: "2026-07-11T08:00:00.000Z",
    })).toEqual([]);
  });

  it("passes doctor only when the fail-closed control-plane structure is complete", () => {
    const root = fixtureRoot();
    const receipt = buildLaunchDoctorReceipt(root, "2026-07-11T08:00:00.000Z");
    expect(receipt.status).toBe("passed");
    expect(receipt.blockers).toEqual([]);

    write(root, ".gitignore", ".launch/approval.json\n.launch/chrome-profile/\n.launch/outbox/distribution.sqlite\n");
    const dirtyVerifier = buildLaunchDoctorReceipt(root, "2026-07-11T08:00:00.000Z");
    expect(dirtyVerifier.status).toBe("blocked");
    expect(dirtyVerifier.blockers.join("\n")).toContain(".launch/receipts/ci/launch-proof-verification.json must be ignored");
    write(root, ".gitignore", launchFixtureGitignore());

    write(root, ".launch/secret-inventory.json", JSON.stringify({
      schema: 1,
      secrets: [{ name: "TOKEN", present: true, scope: "local", usedBy: [], valueRecorded: false, value: "forbidden" }],
    }));
    const blocked = buildLaunchDoctorReceipt(root, "2026-07-11T08:00:00.000Z");
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockers.join("\n")).toContain("forbidden field value");
  });

  it("rejects forged pass statuses even after approval", () => {
    const root = fixtureRoot(PILOT_CHECKS.map(passEvidence));
    const blocked = evaluateLaunchGate(root, "pilot", "2026-07-11T08:00:00.000Z");
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockers.join("\n")).toContain("privatePilotApproved");

    writeJson(root, ".launch/approval.json", {
      ...APPROVAL,
      privatePilotApproved: true,
      approvedBy: "release-owner",
      approvedAt: "2026-07-11T08:00:00.000Z",
    });
    const forged = evaluateLaunchGate(root, "pilot", "2026-07-11T08:00:00.000Z");
    expect(forged.status).toBe("blocked");
    expect(forged.blockers.join("\n")).toContain("Descriptive ledger status is not accepted without an immutable verifier");

    const failedEvidence = PILOT_CHECKS.map((id) => id === "controls.kill-switch"
      ? { ...passEvidence(id), status: "manual" as const, detail: "Owner drill pending." }
      : passEvidence(id));
    writeJson(root, ".launch/gates.json", { schema: 1, updatedAt: "2026-07-11T08:00:00.000Z", checks: failedEvidence });
    const manual = evaluateLaunchGate(root, "pilot", "2026-07-11T08:00:00.000Z");
    expect(manual.status).toBe("blocked");
    expect(manual.blockers.join("\n")).toContain("Owner drill pending");
  });

  it("verifies generated policy-bound bundles and detects tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "noderoom-launch-proof-"));
    const bundle = ".launch/release-proof/candidate";
    writeStrictBundle(root, bundle);

    expect(verifyLaunchProofBundle(root, bundle, "2026-07-11T08:00:00.000Z", { expectedCommit: "abc123" }).status).toBe("passed");
    write(root, `${bundle}/receipts/deterministic/typecheck.json`, "tampered\n");
    const blocked = verifyLaunchProofBundle(root, bundle, "2026-07-11T08:00:00.000Z", { expectedCommit: "abc123" });
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockers.join("\n")).toContain("bundle:file:receipts/deterministic/typecheck.json");
  });

  it("rejects mismatched commits, untrusted generators, and duplicate evidence paths", () => {
    const root = mkdtempSync(join(tmpdir(), "noderoom-launch-proof-forged-"));
    const bundle = ".launch/release-proof/candidate";
    writeStrictBundle(root, bundle);

    const mismatch = verifyLaunchProofBundle(root, bundle, "2026-07-11T08:00:00.000Z", { expectedCommit: "different" });
    expect(mismatch.blockers.join("\n")).toContain("bundle:commit");

    const manifestPath = join(root, bundle, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { generatedBy: string; files: unknown[] };
    manifest.generatedBy = "manual";
    manifest.files.push(manifest.files[0]);
    writeJson(root, `${bundle}/manifest.json`, manifest);
    const forged = verifyLaunchProofBundle(root, bundle, "2026-07-11T08:00:00.000Z", { expectedCommit: "abc123" });
    expect(forged.blockers.join("\n")).toContain("bundle:generator");
    expect(forged.blockers.join("\n")).toContain("bundle:duplicate-paths");
  });

  it("binds deployed proof coordinates to a clean app commit and Convex tree revision", () => {
    const valid = {
      deployedAuth: "1",
      baseUrl: "https://preview.example.test",
      expectedAppCommit: "app123",
      expectedBackendRevision: "convex456",
      expectedConvexUrl: "https://candidate-preview-123.convex.cloud",
      gitCommit: "app123",
      gitBackendRevision: "convex456",
      worktreeDirty: false,
    };
    expect(validateDeployedProofInput(valid)).toEqual([]);
    expect(validateDeployedProofInput({ ...valid, expectedBackendRevision: "self-reported" }).join("\n"))
      .toContain("must equal the local Convex tree revision (convex456)");
    expect(validateDeployedProofInput({ ...valid, worktreeDirty: true }).join("\n"))
      .toContain("worktree must be clean");
    expect(validateDeployedProofInput({ ...valid, baseUrl: "http://127.0.0.1:5173" }).join("\n"))
      .toContain("must use https");
    expect(validateDeployedProofInput({ ...valid, expectedConvexUrl: "https://example.com" }).join("\n"))
      .toContain("must be an https://<deployment>.convex.cloud URL");
  });

  it("requires deterministic first-run mobile browser proof in candidate and pilot policies", () => {
    for (const profile of ["ci", "pilot"] as const) {
      const policy = launchPolicy(profile);
      expect(policy.requiredKinds).toContain("browser");
      expect(policy.commands).toContainEqual(expect.objectContaining({
        id: "launch-surface-browser",
        kind: "browser",
        args: ["run", "test:launch:surface"],
      }));
    }
  });

  it("resolves npm through the command shell on Windows", () => {
    expect(launchCommandInvocation("npm", "win32")).toEqual({ executable: "npm.cmd", shell: true });
    expect(launchCommandInvocation("npx", "linux")).toEqual({ executable: "npx", shell: false });

    const invocation = launchCommandInvocation("npm");
    const result = spawnSync(invocation.executable, ["--version"], {
      encoding: "utf8",
      shell: invocation.shell,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

function writeStrictBundle(root: string, bundle: string): void {
  const policy = launchPolicy("ci");
  const policyDigest = launchPolicyDigest(policy);
  const generatedAt = "2026-07-11T08:00:00.000Z";
  const common = {
    schema: "noderoom-launch-command-receipt-v1",
    status: "passed",
    program: "npm",
    args: [],
    gitCommit: "abc123",
    policyDigest,
    startedAt: generatedAt,
    finishedAt: generatedAt,
    durationMs: 1,
    exitCode: 0,
    stdoutTail: "",
    stderrTail: "",
    outputRedacted: true,
  };
  const files = [
    { path: "metadata.json", kind: "metadata" },
    { path: "receipts/deterministic/typecheck.json", kind: "deterministic" },
    { path: "receipts/security/security-gate.json", kind: "security" },
    { path: "receipts/browser/launch-surface.json", kind: "browser" },
  ] as const;
  writeJson(root, `${bundle}/metadata.json`, {
    schema: "noderoom-launch-bundle-metadata-v1",
    generatedAt,
    generatedBy: "scripts/launch-gate.ts",
    profile: "ci",
    claimBoundary: "candidate-ci",
    gitCommit: "abc123",
    backendRevision: "backend123",
    policyDigest,
    workingTreeDirty: false,
    status: "passed",
  });
  writeJson(root, `${bundle}/receipts/deterministic/typecheck.json`, { ...common, id: "typecheck", kind: "deterministic" });
  writeJson(root, `${bundle}/receipts/security/security-gate.json`, { ...common, id: "security-gate", kind: "security" });
  writeJson(root, `${bundle}/receipts/browser/launch-surface.json`, { ...common, id: "launch-surface", kind: "browser" });
  const fileRecords = files.map((entry) => {
    const bytes = readFileSync(join(root, bundle, entry.path));
    return { path: entry.path, kind: entry.kind, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  writeJson(root, `${bundle}/manifest.json`, {
    schema: "noderoom-launch-proof-bundle-v1",
    appCommit: "abc123",
    backendRevision: "backend123",
    generatedAt,
    generatedBy: "scripts/launch-gate.ts",
    profile: "ci",
    policyDigest,
    claimBoundary: "candidate-ci",
    status: "passed",
    requiredKinds: policy.requiredKinds,
    files: fileRecords,
    claims: [
      { id: "command:typecheck", claim: "Typecheck passed.", evidence: ["receipts/deterministic/typecheck.json"] },
      { id: "command:security-gate", claim: "Security gate passed.", evidence: ["receipts/security/security-gate.json"] },
      { id: "command:launch-surface", claim: "Launch surface passed.", evidence: ["receipts/browser/launch-surface.json"] },
    ],
  });
}

function fixtureRoot(evidence: LaunchEvidenceCheck[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-launch-control-"));
  const structure = [
    ".launch/launch-state.json",
    ".launch/ledger.jsonl",
    ".launch/blockers.json",
    ".launch/decisions.json",
    ".launch/risk-register.json",
    ".launch/deployment-manifest.json",
    ".launch/distribution-manifest.yaml",
    ".launch/incident-response.md",
    ".launch/support-playbook.md",
    ".launch/kill-switches.md",
    ".launch/product-hunt/submission.json",
    ".launch/product-hunt/media-manifest.json",
  ];
  writeJson(root, ".launch/approval.example.json", APPROVAL);
  for (const path of structure) write(root, path, path.endsWith(".json") ? "{}\n" : "fixture\n");
  writeJson(root, ".launch/gates.json", { schema: 1, updatedAt: "2026-07-11T08:00:00.000Z", checks: evidence });
  writeJson(root, ".launch/secret-inventory.json", {
    schema: 1,
    secrets: [{ name: "TOKEN", present: false, scope: "local", usedBy: ["test"], lastVerifiedAt: "2026-07-11T08:00:00.000Z", valueRecorded: false }],
  });
  write(root, ".gitignore", launchFixtureGitignore());
  writeJson(root, "package.json", {
    scripts: Object.fromEntries([
      "launch:doctor",
      "launch:gate:ci",
      "launch:gate:candidate",
      "launch:gate:pilot",
      "launch:gate:product-hunt",
      "launch:proof:prod",
      "launch:proof:verify",
      "launch:proof:deployed-auth",
      "launch:distribution:preview",
      "launch:distribution:execute",
      "launch:monitor",
    ].map((name) => [name, "fixture"])),
  });
  return root;
}

function launchFixtureGitignore(): string {
  return [
    ".launch/approval.json",
    ".launch/chrome-profile/",
    ".launch/outbox/distribution.sqlite",
    ".launch/receipts/ci/launch-proof-verification.json",
    "",
  ].join("\n");
}

function passEvidence(id: string): LaunchEvidenceCheck {
  return { id, lane: "test", status: "pass", detail: `${id} passed.`, evidence: ["fixture"] };
}

function writeJson(root: string, path: string, value: unknown): void {
  write(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function write(root: string, path: string, value: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
