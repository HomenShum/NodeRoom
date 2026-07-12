import { createHash } from "node:crypto";

export type LaunchGateProfile = "ci" | "pilot";
export type LaunchArtifactKind = "browser" | "deterministic" | "visual" | "trace" | "cost" | "security" | "metadata";

export type LaunchCommandPolicy = {
  id: string;
  kind: LaunchArtifactKind;
  program: "npm" | "npx";
  args: string[];
  timeoutMs: number;
};

export type LaunchCommandInvocation = {
  executable: string;
  shell: boolean;
};

export type LaunchPolicy = {
  schema: "noderoom-launch-policy-v1";
  profile: LaunchGateProfile;
  claimBoundary: "candidate-ci" | "pilot-preview";
  commands: LaunchCommandPolicy[];
  requiredKinds: LaunchArtifactKind[];
  maxBundleAgeHours: number;
  allowDirtyWorktree: false;
  allowSelfReportedEvidence: false;
};

const CI_COMMANDS: LaunchCommandPolicy[] = [
  { id: "launch-control-tests", kind: "deterministic", program: "npm", args: ["test", "--", "--run", "tests/launchControlPlane.test.ts"], timeoutMs: 120_000 },
  { id: "application-typecheck", kind: "deterministic", program: "npm", args: ["run", "typecheck", "--", "--pretty", "false"], timeoutMs: 180_000 },
  { id: "convex-typecheck", kind: "deterministic", program: "npx", args: ["tsc", "--noEmit", "--project", "convex/tsconfig.json", "--pretty", "false"], timeoutMs: 180_000 },
  { id: "production-build", kind: "deterministic", program: "npm", args: ["run", "build"], timeoutMs: 240_000 },
  { id: "security-gate", kind: "security", program: "npm", args: ["run", "security:gate"], timeoutMs: 180_000 },
  { id: "launch-surface-browser", kind: "browser", program: "npm", args: ["run", "test:launch:surface"], timeoutMs: 300_000 },
];

const PILOT_COMMANDS: LaunchCommandPolicy[] = [
  { id: "application-typecheck", kind: "deterministic", program: "npm", args: ["run", "typecheck", "--", "--pretty", "false"], timeoutMs: 180_000 },
  { id: "convex-typecheck", kind: "deterministic", program: "npx", args: ["tsc", "--noEmit", "--project", "convex/tsconfig.json", "--pretty", "false"], timeoutMs: 180_000 },
  { id: "full-vitest", kind: "deterministic", program: "npm", args: ["test", "--", "--run"], timeoutMs: 900_000 },
  { id: "launch-spend-controls", kind: "cost", program: "npm", args: ["test", "--", "--run", "tests/providerSpend.test.ts", "tests/modelSpendMeter.test.ts", "tests/launchUsageLimits.test.ts", "tests/convexCredits.test.ts", "tests/freshRoomLaunchCredits.test.ts"], timeoutMs: 180_000 },
  { id: "production-build", kind: "deterministic", program: "npm", args: ["run", "build"], timeoutMs: 240_000 },
  { id: "security-gate", kind: "security", program: "npm", args: ["run", "security:gate"], timeoutMs: 180_000 },
  { id: "design-gate", kind: "visual", program: "npm", args: ["run", "design:audit"], timeoutMs: 180_000 },
  { id: "nodeagent-frame-smoke", kind: "trace", program: "npm", args: ["run", "nodeagent:frame:smoke"], timeoutMs: 120_000 },
  { id: "omnigent-smoke", kind: "trace", program: "npm", args: ["run", "omnigent:nodeagent:smoke"], timeoutMs: 120_000 },
  { id: "fresh-room-proofs", kind: "browser", program: "npm", args: ["run", "fresh-room:proofs"], timeoutMs: 240_000 },
  { id: "product-memory-browser", kind: "browser", program: "npm", args: ["run", "test:product:memory"], timeoutMs: 900_000 },
  { id: "launch-surface-browser", kind: "browser", program: "npm", args: ["run", "test:launch:surface"], timeoutMs: 300_000 },
  { id: "accounting-proofloop", kind: "deterministic", program: "npm", args: ["run", "proofloop:accounting"], timeoutMs: 300_000 },
  { id: "notion-proofloop", kind: "deterministic", program: "npm", args: ["run", "proofloop:notion"], timeoutMs: 300_000 },
  { id: "deployed-auth-first-user", kind: "browser", program: "npm", args: ["run", "launch:proof:deployed-auth"], timeoutMs: 900_000 },
];

export function launchPolicy(profile: LaunchGateProfile): LaunchPolicy {
  return {
    schema: "noderoom-launch-policy-v1",
    profile,
    claimBoundary: profile === "ci" ? "candidate-ci" : "pilot-preview",
    commands: profile === "ci" ? CI_COMMANDS : PILOT_COMMANDS,
    requiredKinds: profile === "ci"
      ? ["metadata", "deterministic", "security", "browser"]
      : ["metadata", "deterministic", "security", "visual", "trace", "browser", "cost"],
    maxBundleAgeHours: 24,
    allowDirtyWorktree: false,
    allowSelfReportedEvidence: false,
  };
}

export function launchCommandInvocation(
  program: LaunchCommandPolicy["program"],
  platform = process.platform,
): LaunchCommandInvocation {
  return platform === "win32"
    ? { executable: `${program}.cmd`, shell: true }
    : { executable: program, shell: false };
}

export function launchPolicyDigest(policy: LaunchPolicy): string {
  return createHash("sha256").update(stableJson(policy)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
