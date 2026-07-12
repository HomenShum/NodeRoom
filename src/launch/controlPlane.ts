import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { launchPolicy, launchPolicyDigest, type LaunchArtifactKind, type LaunchGateProfile } from "./policy";

export type LaunchApproval = {
  schema: 1;
  privatePilotApproved: boolean;
  productionMigrationApproved: boolean;
  productionDeployApproved: boolean;
  publicReposApproved: boolean;
  productHuntSubmissionApproved: boolean;
  publicDistributionApproved: boolean;
  emailSendApproved: boolean;
  maxLaunchSpendUsd: number;
  targetLaunchAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

export type LaunchEvidenceStatus = "pass" | "fail" | "manual" | "blocked";

export type LaunchEvidenceCheck = {
  id: string;
  lane: string;
  status: LaunchEvidenceStatus;
  detail: string;
  evidence: string[];
  verifiedAt?: string;
  verification?: {
    kind: "launch-bundle";
    bundlePath: string;
    profile: LaunchGateProfile;
    claimId: string;
  };
};

export type LaunchEvidenceLedger = {
  schema: 1;
  updatedAt: string;
  checks: LaunchEvidenceCheck[];
};

export type LaunchGateName = "pilot" | "product-hunt" | "production" | "public-repos" | "distribution";

export type LaunchCheckResult = {
  id: string;
  status: "pass" | "fail";
  detail: string;
  evidence: string[];
};

export type LaunchGateReceipt = {
  schema: "noderoom-launch-gate-v1";
  gate: LaunchGateName;
  generatedAt: string;
  status: "passed" | "blocked";
  approvalSource: ".launch/approval.json" | ".launch/approval.example.json";
  checks: LaunchCheckResult[];
  blockers: string[];
  resumeCommand: string;
};

export type LaunchDoctorReceipt = {
  schema: "noderoom-launch-doctor-v1";
  generatedAt: string;
  status: "passed" | "blocked";
  checks: LaunchCheckResult[];
  blockers: string[];
};

export type LaunchProofBundleManifest = {
  schema: "noderoom-launch-proof-bundle-v1";
  appCommit: string;
  backendRevision: string;
  generatedAt: string;
  generatedBy: "scripts/launch-gate.ts";
  profile: LaunchGateProfile;
  policyDigest: string;
  claimBoundary: "candidate-ci" | "pilot-preview" | "production";
  status: "passed" | "blocked";
  requiredKinds: LaunchArtifactKind[];
  files: Array<{
    path: string;
    sha256: string;
    sizeBytes: number;
    kind: LaunchArtifactKind;
  }>;
  claims: Array<{
    id: string;
    claim: string;
    evidence: string[];
  }>;
};

export type LaunchProofVerificationOptions = {
  expectedCommit?: string;
  expectedPolicyDigest?: string;
  requireKinds?: LaunchArtifactKind[];
  maxAgeHours?: number;
};

export type LaunchProofVerification = {
  schema: "noderoom-launch-proof-verification-v1";
  generatedAt: string;
  status: "passed" | "blocked";
  bundlePath: string;
  appCommit?: string;
  backendRevision?: string;
  checks: LaunchCheckResult[];
  blockers: string[];
};

const APPROVAL_KEYS: Array<keyof LaunchApproval> = [
  "privatePilotApproved",
  "productionMigrationApproved",
  "productionDeployApproved",
  "publicReposApproved",
  "productHuntSubmissionApproved",
  "publicDistributionApproved",
  "emailSendApproved",
];

const REQUIRED_STRUCTURE = [
  ".launch/approval.example.json",
  ".launch/launch-state.json",
  ".launch/ledger.jsonl",
  ".launch/blockers.json",
  ".launch/decisions.json",
  ".launch/risk-register.json",
  ".launch/gates.json",
  ".launch/secret-inventory.json",
  ".launch/deployment-manifest.json",
  ".launch/distribution-manifest.yaml",
  ".launch/incident-response.md",
  ".launch/support-playbook.md",
  ".launch/kill-switches.md",
  ".launch/product-hunt/submission.json",
  ".launch/product-hunt/media-manifest.json",
];

const REQUIRED_SCRIPTS = [
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
];

const GATE_REQUIREMENTS: Record<LaunchGateName, { approval: keyof LaunchApproval; checks: string[]; resumeCommand: string }> = {
  pilot: {
    approval: "privatePilotApproved",
    checks: [
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
    ],
    resumeCommand: "npm run launch:gate:pilot",
  },
  "product-hunt": {
    approval: "productHuntSubmissionApproved",
    checks: [
      "code.release-candidate",
      "code.typecheck",
      "code.convex-typecheck",
      "code.tests",
      "code.production-build",
      "code.security-gate",
      "code.design-gate",
      "production.migration",
      "production.auth-strict",
      "production.legacy-room-policy",
      "production.browser-proof",
      "pilot.current-revision-auth-phone",
      "product.literal-promise",
      "product.read-only-sample",
      "product.bounded-live-workflow",
      "product.honest-partial-result",
      "product.trace-evidence",
      "product.workbook-session",
      "product.launch-feature-scope",
      "product.export-reopen",
      "ux.desktop-matrix",
      "ux.mobile-matrix",
      "ux.accessibility",
      "ux.performance",
      "ux.independent-taste",
      "privacy.legal-policies",
      "controls.global-spend-cap",
      "controls.kill-switch",
      "product.finance-claim-scope",
      "launch.media-complete",
      "launch.links-verified",
      "launch.public-repos-ready",
      "launch.monitoring-ready",
      "launch.support-ready",
    ],
    resumeCommand: "npm run launch:gate:product-hunt",
  },
  production: {
    approval: "productionDeployApproved",
    checks: [
      "production.migration-approval",
      "production.fresh-backups",
      "production.rollback-tested",
      "production.migration",
      "production.function-spec",
      "production.storage-references",
      "production.auth-strict",
      "production.legacy-room-policy",
      "production.browser-proof",
      "ux.independent-taste",
      "operations.monitoring-ready",
    ],
    resumeCommand: "npm run launch:proof:prod",
  },
  "public-repos": {
    approval: "publicReposApproved",
    checks: [
      "repos.proofloop-release",
      "repos.proofloop-install",
      "repos.proofloop-ci",
      "repos.nodereach-release",
      "repos.nodereach-dry-run",
      "repos.secret-scan",
    ],
    resumeCommand: "npm run launch:gate:public-repos",
  },
  distribution: {
    approval: "publicDistributionApproved",
    checks: [
      "distribution.manifest",
      "distribution.previews",
      "distribution.idempotency",
      "distribution.rate-limits",
      "distribution.kill-switch",
      "distribution.product-hunt-compliance",
    ],
    resumeCommand: "npm run launch:distribution:execute",
  },
};

export function buildLaunchDoctorReceipt(root: string, generatedAt = new Date().toISOString()): LaunchDoctorReceipt {
  const checks: LaunchCheckResult[] = [];
  for (const path of REQUIRED_STRUCTURE) {
    checks.push(check(existsSync(join(root, path)), `structure:${path}`, `Required launch-control file ${path}`, [path]));
  }

  const approvalExample = readJson<unknown>(join(root, ".launch/approval.example.json"));
  const approvalErrors = validateApproval(approvalExample);
  checks.push(check(approvalErrors.length === 0, "approval:example-schema", approvalErrors.join("; ") || "Approval example is valid and fail-closed.", [".launch/approval.example.json"]));

  const localApprovalPath = join(root, ".launch/approval.json");
  if (existsSync(localApprovalPath)) {
    const localErrors = validateApproval(readJson<unknown>(localApprovalPath));
    checks.push(check(localErrors.length === 0, "approval:local-schema", localErrors.join("; ") || "Local approval file is valid.", [".launch/approval.json"]));
  } else {
    checks.push(check(true, "approval:local-schema", "No local approval file is present; irreversible actions remain disabled.", [".launch/approval.example.json"]));
  }

  const packageJson = readJson<{ scripts?: Record<string, string> }>(join(root, "package.json"));
  for (const script of REQUIRED_SCRIPTS) {
    checks.push(check(Boolean(packageJson?.scripts?.[script]), `script:${script}`, `Package script ${script} is ${packageJson?.scripts?.[script] ? "configured" : "missing"}.`, ["package.json"]));
  }

  const gitignore = readText(join(root, ".gitignore"));
  for (const pattern of [
    ".launch/approval.json",
    ".launch/chrome-profile/",
    ".launch/outbox/distribution.sqlite",
    ".launch/receipts/ci/launch-proof-verification.json",
  ]) {
    checks.push(check(gitignore.split(/\r?\n/).some((line) => line.trim() === pattern), `gitignore:${pattern}`, `${pattern} must be ignored.`, [".gitignore"]));
  }

  const secretInventory = readJson<unknown>(join(root, ".launch/secret-inventory.json"));
  const secretErrors = validateSecretInventory(secretInventory);
  checks.push(check(secretErrors.length === 0, "secrets:inventory", secretErrors.join("; ") || "Secret inventory records names and presence only.", [".launch/secret-inventory.json"]));

  const evidence = readJson<LaunchEvidenceLedger>(join(root, ".launch/gates.json"));
  const duplicateEvidenceIds = duplicateIds(evidence?.checks?.map((entry) => entry.id) ?? []);
  checks.push(check(evidence?.schema === 1 && Array.isArray(evidence.checks) && duplicateEvidenceIds.length === 0, "gates:evidence-ledger", duplicateEvidenceIds.length ? `Duplicate evidence ids: ${duplicateEvidenceIds.join(", ")}` : "Launch evidence ledger is structurally valid.", [".launch/gates.json"]));

  const blockers = checks.filter((entry) => entry.status === "fail").map((entry) => `${entry.id}: ${entry.detail}`);
  return {
    schema: "noderoom-launch-doctor-v1",
    generatedAt,
    status: blockers.length ? "blocked" : "passed",
    checks,
    blockers,
  };
}

export function evaluateLaunchGate(root: string, gate: LaunchGateName, generatedAt = new Date().toISOString()): LaunchGateReceipt {
  const { approval, source, errors } = loadApproval(root);
  const ledger = readJson<LaunchEvidenceLedger>(join(root, ".launch/gates.json"));
  const indexed = new Map((ledger?.checks ?? []).map((entry) => [entry.id, entry]));
  const requirements = GATE_REQUIREMENTS[gate];
  const checks: LaunchCheckResult[] = [];

  checks.push(check(errors.length === 0, "approval:schema", errors.join("; ") || `Approval loaded from ${source}.`, [source]));
  checks.push(check(Boolean(approval?.[requirements.approval]), `approval:${String(requirements.approval)}`, `${String(requirements.approval)} must be explicitly true.`, [source]));

  if (gate === "production") {
    checks.push(check(Boolean(approval?.productionMigrationApproved), "approval:productionMigrationApproved", "productionMigrationApproved must be explicitly true.", [source]));
  }

  for (const id of requirements.checks) {
    const evidence = indexed.get(id);
    const verification = evidence ? verifyLaunchEvidence(root, evidence, generatedAt) : undefined;
    const evidencePassed = evidence?.status === "pass" && verification?.ok === true;
    checks.push({
      id,
      status: evidencePassed ? "pass" : "fail",
      detail: evidence?.status === "pass"
        ? verification?.detail ?? "Self-reported pass is not accepted without an immutable verifier."
        : evidence?.detail ?? "Required launch evidence is missing.",
      evidence: evidence?.evidence ?? [".launch/gates.json"],
    });
  }

  const blockers = checks.filter((entry) => entry.status === "fail").map((entry) => `${entry.id}: ${entry.detail}`);
  return {
    schema: "noderoom-launch-gate-v1",
    gate,
    generatedAt,
    status: blockers.length ? "blocked" : "passed",
    approvalSource: source,
    checks,
    blockers,
    resumeCommand: requirements.resumeCommand,
  };
}

export function verifyLaunchProofBundle(
  root: string,
  bundlePath: string,
  generatedAt = new Date().toISOString(),
  options: LaunchProofVerificationOptions = {},
): LaunchProofVerification {
  const absoluteBundle = resolve(root, bundlePath);
  const manifestPath = join(absoluteBundle, "manifest.json");
  const manifest = readJson<LaunchProofBundleManifest>(manifestPath);
  const checks: LaunchCheckResult[] = [];

  checks.push(check(Boolean(manifest), "bundle:manifest", "Proof bundle manifest must exist and contain valid JSON.", [relative(root, manifestPath)]));
  checks.push(check(manifest?.schema === "noderoom-launch-proof-bundle-v1", "bundle:schema", "Proof bundle schema must be noderoom-launch-proof-bundle-v1.", [relative(root, manifestPath)]));
  checks.push(check(Boolean(manifest?.appCommit && manifest.backendRevision), "bundle:revisions", "App and backend revisions must both be recorded.", [relative(root, manifestPath)]));
  checks.push(check(manifest?.generatedBy === "scripts/launch-gate.ts", "bundle:generator", "Trusted bundles must be generated by scripts/launch-gate.ts.", [relative(root, manifestPath)]));
  checks.push(check(manifest?.status === "passed", "bundle:status", "The immutable command policy must pass before the bundle is trusted.", [relative(root, manifestPath)]));
  checks.push(check(Boolean(manifest?.claims?.length), "bundle:claims", "At least one supported claim must map to evidence.", [relative(root, manifestPath)]));

  const policy = manifest?.profile === "ci" || manifest?.profile === "pilot" ? launchPolicy(manifest.profile) : undefined;
  const expectedPolicyDigest = options.expectedPolicyDigest ?? (policy ? launchPolicyDigest(policy) : undefined);
  checks.push(check(Boolean(policy), "bundle:profile", "Bundle profile must be a supported immutable launch policy.", [relative(root, manifestPath)]));
  checks.push(check(Boolean(expectedPolicyDigest && manifest?.policyDigest === expectedPolicyDigest), "bundle:policy-digest", `Expected policy digest ${expectedPolicyDigest ?? "unavailable"}, received ${manifest?.policyDigest ?? "missing"}.`, [relative(root, manifestPath)]));
  checks.push(check(!options.expectedCommit || manifest?.appCommit === options.expectedCommit, "bundle:commit", `Expected app commit ${options.expectedCommit ?? "any"}, received ${manifest?.appCommit ?? "missing"}.`, [relative(root, manifestPath)]));

  const generatedMs = manifest?.generatedAt ? Date.parse(manifest.generatedAt) : Number.NaN;
  const verificationMs = Date.parse(generatedAt);
  const maxAgeHours = options.maxAgeHours ?? policy?.maxBundleAgeHours ?? 24;
  const ageMs = verificationMs - generatedMs;
  checks.push(check(Number.isFinite(generatedMs) && Number.isFinite(verificationMs) && ageMs >= -60_000 && ageMs <= maxAgeHours * 3_600_000, "bundle:freshness", `Bundle must be no older than ${maxAgeHours} hours and cannot be from the future.`, [relative(root, manifestPath)]));

  const fileEntries = manifest?.files ?? [];
  const duplicatePaths = duplicateIds(fileEntries.map((entry) => entry.path));
  checks.push(check(duplicatePaths.length === 0, "bundle:duplicate-paths", duplicatePaths.length ? `Duplicate bundle paths: ${duplicatePaths.join(", ")}.` : "Bundle paths are unique.", [relative(root, manifestPath)]));

  const requiredKinds = [...new Set([...(manifest?.requiredKinds ?? []), ...(options.requireKinds ?? [])])];
  const actualKinds = new Set(fileEntries.map((entry) => entry.kind));
  checks.push(check(requiredKinds.every((kind) => actualKinds.has(kind)), "bundle:required-kinds", `Required kinds: ${requiredKinds.join(", ") || "none"}; actual kinds: ${[...actualKinds].join(", ") || "none"}.`, [relative(root, manifestPath)]));
  checks.push(check(Boolean(policy && sameStringSet(manifest?.requiredKinds ?? [], policy.requiredKinds)), "bundle:policy-kinds", "Manifest requiredKinds must exactly match the immutable policy.", [relative(root, manifestPath)]));

  for (const entry of fileEntries) {
    const filePath = resolve(absoluteBundle, entry.path);
    const escaped = isAbsolute(entry.path) || relative(absoluteBundle, filePath).startsWith("..");
    const exists = !escaped && existsSync(filePath);
    const symlink = exists ? lstatSync(filePath).isSymbolicLink() : false;
    const bytes = exists && !symlink ? readFileSync(filePath) : undefined;
    const actualHash = bytes ? sha256(bytes) : undefined;
    const valid = exists && !symlink && bytes?.byteLength === entry.sizeBytes && actualHash === entry.sha256.toLowerCase();
    const detail = escaped
      ? "Bundle paths must stay inside the bundle."
      : symlink
        ? "Bundle evidence may not be a symbolic link."
        : exists
          ? `Expected ${entry.sizeBytes} bytes/${entry.sha256.toLowerCase()}, received ${bytes?.byteLength ?? 0} bytes/${actualHash ?? "missing"}.`
          : "Evidence file is missing.";
    checks.push(check(valid, `bundle:file:${entry.path}`, detail, [entry.path]));

    if (valid && entry.path.startsWith("receipts/") && entry.path.endsWith(".json")) {
      const receipt = readJson<{ schema?: string; status?: string; gitCommit?: string; policyDigest?: string }>(filePath);
      checks.push(check(receipt?.schema === "noderoom-launch-command-receipt-v1" && receipt.status === "passed", `bundle:receipt:${entry.path}`, "Command receipt must use the launch receipt schema and have passed.", [entry.path]));
      checks.push(check(receipt?.gitCommit === manifest?.appCommit && receipt?.policyDigest === manifest?.policyDigest, `bundle:receipt-binding:${entry.path}`, "Command receipt must bind to the manifest commit and policy digest.", [entry.path]));
    }
  }

  const metadata = readJson<{ schema?: string; status?: string; gitCommit?: string; backendRevision?: string; policyDigest?: string; workingTreeDirty?: boolean; generatedBy?: string }>(join(absoluteBundle, "metadata.json"));
  checks.push(check(
    metadata?.schema === "noderoom-launch-bundle-metadata-v1" &&
      metadata.status === "passed" &&
      metadata.gitCommit === manifest?.appCommit &&
      metadata.backendRevision === manifest?.backendRevision &&
      metadata.policyDigest === manifest?.policyDigest &&
      metadata.workingTreeDirty === false &&
      metadata.generatedBy === "scripts/launch-gate.ts",
    "bundle:metadata-binding",
    "Bundle metadata must prove a clean worktree and bind generator, status, app, backend, and policy revisions.",
    ["metadata.json"],
  ));

  const declared = new Set(fileEntries.map((entry) => entry.path));
  const duplicateClaimIds = duplicateIds((manifest?.claims ?? []).map((claim) => claim.id));
  checks.push(check(duplicateClaimIds.length === 0, "bundle:duplicate-claims", duplicateClaimIds.length ? `Duplicate claim ids: ${duplicateClaimIds.join(", ")}.` : "Claim ids are unique.", [relative(root, manifestPath)]));
  for (const claim of manifest?.claims ?? []) {
    checks.push(check(Boolean(claim.id) && claim.evidence.length > 0 && claim.evidence.every((path) => declared.has(path)), `bundle:claim:${claim.id || sha256(Buffer.from(claim.claim)).slice(0, 12)}`, `Claim '${claim.claim}' must have a stable id and reference declared evidence files.`, claim.evidence));
  }

  if (manifest?.claimBoundary === "production") {
    const productionKinds: LaunchArtifactKind[] = ["browser", "deterministic", "visual", "trace", "cost", "security", "metadata"];
    checks.push(check(productionKinds.every((kind) => actualKinds.has(kind)), "bundle:production-kinds", "Production claims require browser, deterministic, visual, trace, cost, security, and metadata evidence.", [relative(root, manifestPath)]));
  }

  const blockers = checks.filter((entry) => entry.status === "fail").map((entry) => `${entry.id}: ${entry.detail}`);
  return {
    schema: "noderoom-launch-proof-verification-v1",
    generatedAt,
    status: blockers.length ? "blocked" : "passed",
    bundlePath,
    appCommit: manifest?.appCommit,
    backendRevision: manifest?.backendRevision,
    checks,
    blockers,
  };
}

function verifyLaunchEvidence(root: string, evidence: LaunchEvidenceCheck, generatedAt: string): { ok: boolean; detail: string } {
  if (!evidence.verification) {
    return { ok: false, detail: `${evidence.detail} Descriptive ledger status is not accepted without an immutable verifier.` };
  }
  if (evidence.verification.kind === "launch-bundle") {
    const policy = launchPolicy(evidence.verification.profile);
    const expectedCommit = gitHead(root);
    const verification = verifyLaunchProofBundle(root, evidence.verification.bundlePath, generatedAt, {
      expectedCommit,
      expectedPolicyDigest: launchPolicyDigest(policy),
      requireKinds: policy.requiredKinds,
      maxAgeHours: policy.maxBundleAgeHours,
    });
    const manifest = readJson<LaunchProofBundleManifest>(join(root, evidence.verification.bundlePath, "manifest.json"));
    const hasClaim = manifest?.claims.some((claim) => claim.id === evidence.verification?.claimId) ?? false;
    if (verification.status === "passed" && hasClaim) return { ok: true, detail: evidence.detail };
    const first = verification.blockers[0] ?? `Required claim '${evidence.verification.claimId}' is missing.`;
    return { ok: false, detail: `${evidence.detail} Immutable verification failed: ${first}` };
  }
  return { ok: false, detail: `${evidence.detail} Unsupported verification kind.` };
}

export function validateApproval(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Approval must be an object."];
  const approval = value as Partial<LaunchApproval>;
  const errors: string[] = [];
  if (approval.schema !== 1) errors.push("schema must equal 1");
  for (const key of APPROVAL_KEYS) if (typeof approval[key] !== "boolean") errors.push(`${String(key)} must be boolean`);
  if (typeof approval.maxLaunchSpendUsd !== "number" || !Number.isFinite(approval.maxLaunchSpendUsd) || approval.maxLaunchSpendUsd < 0) errors.push("maxLaunchSpendUsd must be a non-negative finite number");
  for (const key of ["targetLaunchAt", "approvedBy", "approvedAt"] as const) if (approval[key] !== null && typeof approval[key] !== "string") errors.push(`${key} must be a string or null`);
  const anyApproved = APPROVAL_KEYS.some((key) => approval[key] === true);
  if (anyApproved && (!approval.approvedBy || !approval.approvedAt)) errors.push("approvedBy and approvedAt are required when any approval is true");
  return errors;
}

function loadApproval(root: string): { approval?: LaunchApproval; source: ".launch/approval.json" | ".launch/approval.example.json"; errors: string[] } {
  const localPath = join(root, ".launch/approval.json");
  const source = existsSync(localPath) ? ".launch/approval.json" : ".launch/approval.example.json";
  const approval = readJson<LaunchApproval>(join(root, source));
  return { approval, source, errors: validateApproval(approval) };
}

function gitHead(root: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

function validateSecretInventory(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Secret inventory must be an object."];
  const inventory = value as { schema?: unknown; secrets?: unknown };
  if (inventory.schema !== 1 || !Array.isArray(inventory.secrets)) return ["Secret inventory requires schema 1 and a secrets array."];
  const errors: string[] = [];
  const allowed = new Set(["name", "present", "scope", "usedBy", "lastVerifiedAt", "valueRecorded"]);
  for (const [index, raw] of inventory.secrets.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push(`secrets[${index}] must be an object`); continue; }
    const entry = raw as Record<string, unknown>;
    for (const key of Object.keys(entry)) if (!allowed.has(key)) errors.push(`secrets[${index}] contains forbidden field ${key}`);
    if (typeof entry.name !== "string" || !entry.name) errors.push(`secrets[${index}].name is required`);
    if (typeof entry.present !== "boolean") errors.push(`secrets[${index}].present must be boolean`);
    if (entry.valueRecorded !== false) errors.push(`secrets[${index}].valueRecorded must be false`);
    if (!Array.isArray(entry.usedBy) || entry.usedBy.some((item) => typeof item !== "string")) errors.push(`secrets[${index}].usedBy must be a string array`);
  }
  return errors;
}

function check(ok: boolean, id: string, detail: string, evidence: string[]): LaunchCheckResult {
  return { id, status: ok ? "pass" : "fail", detail, evidence };
}

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
