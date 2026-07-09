import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PreprodSeverity = "critical" | "high" | "medium" | "low";
export type PreprodStatus = "pass" | "fail" | "manual" | "skipped";

export type PreprodWaiver = {
  checkId: string;
  owner: string;
  reason: string;
  expiresAt: string;
  evidence: string[];
};

export type PreprodCheck = {
  id: string;
  category: string;
  sourceCategory: string;
  severity: PreprodSeverity;
  status: PreprodStatus;
  title: string;
  description: string;
  evidence: string[];
  verifier: string;
  finding?: string;
  fix?: string;
  waived?: boolean;
  waiver?: PreprodWaiver;
};

export type LiveHeaderCheck = {
  header: string;
  expected: string;
  actual?: string;
  ok: boolean;
};

export type LiveStorySmoke = {
  command: string;
  ok: boolean;
  stdoutTail?: string;
  stderrTail?: string;
  parsed?: unknown;
};

export type LivePreprodProbe = {
  url: string;
  checkedAt?: string;
  ok: boolean;
  rootStatus?: number;
  headers: Record<string, string>;
  headerChecks: LiveHeaderCheck[];
  storySmoke?: LiveStorySmoke;
  error?: string;
};

export type ProofloopPreprodReadinessReceipt = {
  schema: "proofloop-preprod-readiness-v1";
  generatedAt?: string;
  sourceAttribution: {
    name: string;
    url: string;
    version: string;
    license: string;
    importedAs: string;
  };
  git: {
    commit: string;
    dirty: boolean;
  };
  packageVersion?: string;
  liveUrl?: string;
  checks: PreprodCheck[];
  verifiedCriticalHigh: Array<{
    checkId: string;
    severity: PreprodSeverity;
    evidence: string[];
    verifier: string;
  }>;
  waivers: PreprodWaiver[];
  liveProbe?: LivePreprodProbe;
  releaseGate: {
    status: "passed" | "blocked";
    blockingFindings: string[];
    manualEvidenceRequired: string[];
    verifierCommand: string;
    liveVerifierCommand: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    manual: number;
    skipped: number;
    criticalHighTotal: number;
    criticalHighPassed: number;
    criticalHighFailed: number;
    blockingFindings: number;
    waiversActive: number;
    liveChecksPassed: boolean;
  };
  recommendations: string[];
};

type BuildArgs = {
  root?: string;
  generatedAt?: string;
  liveProbe?: LivePreprodProbe;
  waivers?: PreprodWaiver[];
};

type CheckDraft = Omit<PreprodCheck, "waived" | "waiver">;

const SOURCE_ATTRIBUTION = {
  name: "kevincui1034/preprod-check",
  url: "https://github.com/kevincui1034/preprod-check",
  version: "1.2.0",
  license: "MIT",
  importedAs: "ProofLoop deterministic preprod readiness receipt, not a runtime Claude plugin dependency.",
} as const;

const REQUIRED_SECURITY_HEADERS: Array<{ header: string; expected: string }> = [
  { header: "content-security-policy", expected: "default-src 'self'" },
  { header: "content-security-policy", expected: "object-src 'none'" },
  { header: "content-security-policy", expected: "frame-ancestors 'none'" },
  { header: "strict-transport-security", expected: "max-age=63072000" },
  { header: "strict-transport-security", expected: "includeSubDomains" },
  { header: "x-content-type-options", expected: "nosniff" },
  { header: "x-frame-options", expected: "DENY" },
  { header: "referrer-policy", expected: "strict-origin-when-cross-origin" },
  { header: "permissions-policy", expected: "camera=()" },
  { header: "permissions-policy", expected: "microphone=(self)" },
  { header: "cross-origin-opener-policy", expected: "same-origin" },
];

export function buildProofloopPreprodReadinessReceipt(args: BuildArgs = {}): ProofloopPreprodReadinessReceipt {
  const root = args.root ?? process.cwd();
  const packageJson = readJson<{ version?: string; scripts?: Record<string, string>; dependencies?: Record<string, string> }>(root, "package.json");
  const waivers = args.waivers ?? readJson<PreprodWaiver[]>(root, "docs/eval/proofloop-preprod-waivers.json") ?? [];
  const generatedAt = args.generatedAt;
  const checks = applyWaivers(buildChecks(root, packageJson, args.liveProbe), waivers, generatedAt);
  const blocking = checks.filter((check) =>
    (check.severity === "critical" || check.severity === "high") &&
    check.status === "fail" &&
    !check.waived
  );
  const manual = checks.filter((check) =>
    (check.severity === "critical" || check.severity === "high") &&
    check.status === "manual" &&
    !check.waived
  );
  const criticalHigh = checks.filter((check) => check.severity === "critical" || check.severity === "high");
  const verifiedCriticalHigh = criticalHigh
    .filter((check) => check.status === "pass")
    .map((check) => ({
      checkId: check.id,
      severity: check.severity,
      evidence: check.evidence,
      verifier: check.verifier,
    }));

  return {
    schema: "proofloop-preprod-readiness-v1",
    generatedAt,
    sourceAttribution: SOURCE_ATTRIBUTION,
    git: gitState(root),
    packageVersion: packageJson?.version,
    liveUrl: args.liveProbe?.url,
    checks,
    verifiedCriticalHigh,
    waivers,
    liveProbe: args.liveProbe,
    releaseGate: {
      status: blocking.length === 0 ? "passed" : "blocked",
      blockingFindings: blocking.map((check) => `${check.id}: ${check.finding ?? check.title}`),
      manualEvidenceRequired: manual.map((check) => `${check.id}: ${check.finding ?? check.title}`),
      verifierCommand: "npm run benchmark:proofloop:preprod -- --strict",
      liveVerifierCommand: "npm run benchmark:proofloop:preprod:live -- --strict",
    },
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      failed: checks.filter((check) => check.status === "fail").length,
      manual: checks.filter((check) => check.status === "manual").length,
      skipped: checks.filter((check) => check.status === "skipped").length,
      criticalHighTotal: criticalHigh.length,
      criticalHighPassed: criticalHigh.filter((check) => check.status === "pass").length,
      criticalHighFailed: criticalHigh.filter((check) => check.status === "fail").length,
      blockingFindings: blocking.length,
      waiversActive: checks.filter((check) => check.waived).length,
      liveChecksPassed: args.liveProbe ? args.liveProbe.ok : false,
    },
    recommendations: [
      "Run the static preprod receipt before every ProofLoop release claim.",
      "Run the live preprod receipt against noderoom.live before claiming production is healthy.",
      "Treat unwaived Critical/High failures as ship blockers; keep manual ops checks visible until external evidence exists.",
      "Keep preprod findings as ProofLoop work items with owner, expiry, evidence, and waiver history.",
    ],
  };
}

export async function collectLivePreprodProbe(args: { liveUrl: string; generatedAt?: string }): Promise<LivePreprodProbe> {
  const url = args.liveUrl.replace(/\/$/, "");
  try {
    const response = await fetch(`${url}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const headerChecks = evaluateSecurityHeaders(headers);
    return {
      url,
      checkedAt: args.generatedAt,
      ok: response.status >= 200 && response.status < 400 && headerChecks.every((check) => check.ok),
      rootStatus: response.status,
      headers,
      headerChecks,
    };
  } catch (error) {
    return {
      url,
      checkedAt: args.generatedAt,
      ok: false,
      headers: {},
      headerChecks: evaluateSecurityHeaders({}),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function evaluateSecurityHeaders(headers: Record<string, string | undefined>): LiveHeaderCheck[] {
  const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value ?? ""]));
  return REQUIRED_SECURITY_HEADERS.map((rule) => {
    const actual = lower.get(rule.header);
    return {
      header: rule.header,
      expected: rule.expected,
      actual,
      ok: !!actual && actual.toLowerCase().includes(rule.expected.toLowerCase()),
    };
  });
}

export function renderProofloopPreprodReadinessMarkdown(receipt: ProofloopPreprodReadinessReceipt): string {
  const lines = [
    "# ProofLoop Preprod Readiness",
    "",
    `Generated: ${receipt.generatedAt ?? "unknown"}`,
    "",
    `Source rubric: [${receipt.sourceAttribution.name}](${receipt.sourceAttribution.url}) ${receipt.sourceAttribution.version}, ${receipt.sourceAttribution.license}.`,
    "",
    "This receipt ports the preprod-check categories into a deterministic ProofLoop release gate. Agents may propose findings, but Critical/High findings must be verified by evidence before they block release.",
    "",
    "## Summary",
    "",
    `- Package version: ${receipt.packageVersion ?? "unknown"}`,
    `- Git commit: ${receipt.git.commit}${receipt.git.dirty ? " (dirty)" : ""}`,
    `- Release gate: ${receipt.releaseGate.status}`,
    `- Checks: ${receipt.summary.passed} passed, ${receipt.summary.failed} failed, ${receipt.summary.manual} manual, ${receipt.summary.skipped} skipped`,
    `- Critical/High: ${receipt.summary.criticalHighPassed}/${receipt.summary.criticalHighTotal} verified passed`,
    `- Blocking findings: ${receipt.summary.blockingFindings}`,
    `- Active waivers: ${receipt.summary.waiversActive}`,
    `- Live checks passed: ${receipt.summary.liveChecksPassed ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    "| Status | Severity | Category | Check | Evidence |",
    "|---|---|---|---|---|",
  ];

  for (const check of receipt.checks) {
    lines.push(
      `| ${check.status}${check.waived ? " (waived)" : ""} | ${check.severity} | ${escapePipes(check.category)} | ` +
      `\`${check.id}\` - ${escapePipes(check.title)} | ${escapePipes(check.evidence.join("<br>"))} |`,
    );
  }

  if (receipt.releaseGate.blockingFindings.length > 0) {
    lines.push("", "## Blocking Findings", "");
    for (const finding of receipt.releaseGate.blockingFindings) lines.push(`- ${finding}`);
  }

  if (receipt.releaseGate.manualEvidenceRequired.length > 0) {
    lines.push("", "## Manual Evidence Still Required", "");
    for (const item of receipt.releaseGate.manualEvidenceRequired) lines.push(`- ${item}`);
  }

  if (receipt.liveProbe) {
    lines.push("", "## Live Probe", "");
    lines.push(`- URL: ${receipt.liveProbe.url}`);
    lines.push(`- Root status: ${receipt.liveProbe.rootStatus ?? "unknown"}`);
    lines.push(`- Headers ok: ${receipt.liveProbe.headerChecks.every((check) => check.ok) ? "yes" : "no"}`);
    if (receipt.liveProbe.storySmoke) lines.push(`- Story smoke: ${receipt.liveProbe.storySmoke.ok ? "pass" : "fail"}`);
    if (receipt.liveProbe.error) lines.push(`- Error: ${receipt.liveProbe.error}`);
    lines.push("", "| Header | Expected | Actual | Status |", "|---|---|---|---|");
    for (const header of receipt.liveProbe.headerChecks) {
      lines.push(`| ${header.header} | ${escapePipes(header.expected)} | ${escapePipes(header.actual ?? "")} | ${header.ok ? "pass" : "fail"} |`);
    }
  }

  lines.push("", "## Verified Critical/High", "");
  for (const verified of receipt.verifiedCriticalHigh) {
    lines.push(`- \`${verified.checkId}\` (${verified.severity}) via ${verified.verifier}`);
  }

  lines.push("", "## Recommendations", "");
  for (const recommendation of receipt.recommendations) lines.push(`- ${recommendation}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

function buildChecks(root: string, packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string> } | undefined, liveProbe?: LivePreprodProbe): CheckDraft[] {
  const scripts = packageJson?.scripts ?? {};
  const checks: CheckDraft[] = [
    passIf("preprod-source-attribution", {
      category: "release safety",
      sourceCategory: "release safety & operability",
      severity: "low",
      title: "Preprod-check source attribution is recorded",
      description: "ProofLoop tracks the imported rubric source instead of silently copying checklist claims.",
      ok: true,
      evidence: [SOURCE_ATTRIBUTION.url],
      verifier: "constant sourceAttribution block",
    }),
    passIf("prod-gate-chain", {
      category: "release safety",
      sourceCategory: "release safety & operability",
      severity: "critical",
      title: "Production gate chains security, typecheck, tests, browser product memory, build, and dist security",
      description: "A release claim must be backed by a single reproducible gate.",
      ok: hasScriptTokens(scripts, "prod:gate", [
        "security:gate",
        "qa:matrix:check",
        "typecheck",
        "npm test",
        "test:product:memory",
        "npm run build",
        "security:gate -- --dist",
      ]),
      evidence: ["package.json:scripts.prod:gate"],
      verifier: "package script token check",
      finding: "prod:gate is missing one or more release-safety sub-gates.",
      fix: "Restore security, typecheck, full tests, product-memory browser checks, build, and dist security in prod:gate.",
    }),
    passIf("npx-proofloop-package-proof", {
      category: "release safety",
      sourceCategory: "release safety & operability",
      severity: "high",
      title: "Published npx proofloop package is registry-verified end to end",
      description: "The portable ProofLoop claim must be proven through the npm registry, not a local checkout or GitHub shortcut.",
      ok: npxPackageProofOk(root),
      evidence: [
        "docs/eval/proofloop-npx-package-proof.json",
        "docs/eval/PROOFLOOP_NPX_PACKAGE_PROOF.md",
        "https://www.npmjs.com/package/proofloop",
      ],
      verifier: "npm run benchmark:proofloop:npx-package -- --strict",
      finding: "Published npx proofloop package proof is missing or failed.",
      fix: "Run npm run benchmark:proofloop:npx-package -- --strict and commit the refreshed receipt.",
    }),
    passIf("static-security-headers", {
      category: "perimeter",
      sourceCategory: "security headers & cookies",
      severity: "critical",
      title: "Static Vercel security headers are configured",
      description: "CSP, HSTS, frame, referrer, permissions, and nosniff headers are required before prod claims.",
      ok: staticHeadersOk(root),
      evidence: ["vercel.json", "scripts/security-gate.ts"],
      verifier: "vercel.json required header scan",
      finding: "Required production security headers are absent from vercel.json.",
      fix: "Restore CSP, HSTS, X-Frame-Options, Referrer-Policy, X-Content-Type-Options, Permissions-Policy, and COOP.",
    }),
    liveHeaderCheck(liveProbe),
    liveStoryCheck(liveProbe),
    passIf("browser-provider-egress", {
      category: "perimeter",
      sourceCategory: "secrets / env, external-request safety, AI / LLM safety",
      severity: "critical",
      title: "Browser bundle is guarded from direct model-provider egress",
      description: "OpenRouter and direct provider keys must stay behind server-side actions and model adapters.",
      ok: filesExist(root, [
        "scripts/security-gate.ts",
        "tests/providerEgressPolicy.test.ts",
        "src/nodeagent/guardrails/egressPolicy.ts",
      ]) && fileContains(root, "scripts/security-gate.ts", "forbiddenBrowserProviders"),
      evidence: [
        "scripts/security-gate.ts",
        "tests/providerEgressPolicy.test.ts",
        "src/nodeagent/guardrails/egressPolicy.ts",
      ],
      verifier: "security-gate provider host scan",
      finding: "Provider egress guard evidence is missing.",
      fix: "Restore browser provider-host scans and provider egress policy tests.",
    }),
    passIf("ssrf-upload-boundary", {
      category: "perimeter",
      sourceCategory: "external-request safety (SSRF, uploads)",
      severity: "critical",
      title: "SSRF and upload-storage boundaries have executable tests",
      description: "Server-side URL fetches and uploaded files must reject private network and unsafe storage paths.",
      ok: filesExist(root, [
        "tests/fetchSourceSsrf.test.ts",
        "tests/fetchSourceNetworkGuard.test.ts",
        "tests/convexFetchSourcePolicy.test.ts",
        "tests/uploadedFileStorageContract.test.ts",
      ]),
      evidence: [
        "tests/fetchSourceSsrf.test.ts",
        "tests/fetchSourceNetworkGuard.test.ts",
        "tests/convexFetchSourcePolicy.test.ts",
        "tests/uploadedFileStorageContract.test.ts",
      ],
      verifier: "required security test file presence",
      finding: "SSRF/upload boundary test evidence is missing.",
      fix: "Restore fetch-source network guard and uploaded file storage contract tests.",
    }),
    passIf("secret-env-boundary", {
      category: "perimeter",
      sourceCategory: "secrets / env",
      severity: "critical",
      title: ".env.local is gitignored and tracked files are scanned for secret-shaped values",
      description: "Production readiness requires no provider secrets in tracked files or client env.",
      ok: envLocalIgnored(root) && fileContains(root, "scripts/security-gate.ts", "likelySecretPatterns"),
      evidence: [".gitignore", "scripts/security-gate.ts"],
      verifier: "git check-ignore plus security-gate secret-pattern scan",
      finding: ".env.local is not ignored or secret-pattern scanning is missing.",
      fix: "Ensure .env.local is ignored and restore likely-secret scanning in security-gate.",
    }),
    passIf("auth-tenancy-boundary", {
      category: "access",
      sourceCategory: "auth & multi-tenancy",
      severity: "critical",
      title: "Room auth and private artifact tenancy boundaries have tests",
      description: "Room tokens, active membership, and private artifacts must be re-checked server-side.",
      ok: filesExist(root, [
        "convex/lib.ts",
        "tests/authSessionPolicy.test.ts",
        "tests/privateArtifactVisibility.test.ts",
        "tests/convexBoundaryPolicy.test.ts",
      ]) && fileContains(root, "convex/lib.ts", "requireStrongAuthToken"),
      evidence: [
        "convex/lib.ts",
        "tests/authSessionPolicy.test.ts",
        "tests/privateArtifactVisibility.test.ts",
        "tests/convexBoundaryPolicy.test.ts",
      ],
      verifier: "auth helper and test file presence",
      finding: "Auth/tenancy boundary evidence is missing.",
      fix: "Restore room token validation and private artifact visibility tests.",
    }),
    passIf("billing-credit-integrity", {
      category: "money & abuse",
      sourceCategory: "billing & credit integrity",
      severity: "high",
      title: "Credit ledger and charge settlement paths have tests",
      description: "Agent spend and credit settlement must not silently overdraw or double-charge.",
      ok: filesExist(root, ["convex/credits.ts", "tests/creditLedger.test.ts", "tests/convexCredits.test.ts"]),
      evidence: ["convex/credits.ts", "tests/creditLedger.test.ts", "tests/convexCredits.test.ts"],
      verifier: "credit ledger implementation and tests",
      finding: "Credit ledger integrity proof is missing.",
      fix: "Restore credit ledger and Convex credit settlement tests.",
    }),
    passIf("agent-cost-step-caps", {
      category: "money & abuse",
      sourceCategory: "rate limiting, cost containment, AI / LLM safety",
      severity: "high",
      title: "Agent runs have step, deadline, and cost accounting caps",
      description: "Runaway agent loops and prompt-injection cost attacks need hard caps before external calls.",
      ok: fileContainsAll(root, "convex/agent.ts", ["maxSteps", "deadlineAt", "costUsd", "priceRun"]) &&
        filesExist(root, ["tests/openAiTokenLimit.test.ts", "tests/costSimulator.test.ts"]),
      evidence: ["convex/agent.ts", "tests/openAiTokenLimit.test.ts", "tests/costSimulator.test.ts"],
      verifier: "agent run cap token scan plus tests",
      finding: "Agent cost/step cap proof is missing.",
      fix: "Restore maxSteps/deadline/cost accounting and token-limit tests.",
    }),
    passIf("rate-limit-abuse", {
      category: "money & abuse",
      sourceCategory: "rate limiting & abuse",
      severity: "high",
      title: "Room join abuse is rate-limited and capped",
      description: "Anonymous room joins need cheap rejection before work is created.",
      ok: fileContainsAll(root, "convex/rooms.ts", ["MAX_MEMBERS_PER_ROOM", "MAX_JOINS_PER_MINUTE", "join_rate_limited"]),
      evidence: ["convex/rooms.ts", "scripts/security-gate.ts"],
      verifier: "rooms.ts rate-limit token scan",
      finding: "Room join rate-limit evidence is missing.",
      fix: "Restore room member caps and join-rate limiting.",
    }),
    passIf("ai-llm-safety", {
      category: "AI safety",
      sourceCategory: "AI / LLM safety",
      severity: "high",
      title: "Prompt-injection, provider egress, and benchmark contamination defenses are tested",
      description: "Model output must not cross trust boundaries or contaminate evaluator-only artifacts.",
      ok: filesExist(root, [
        "tests/promptInjection.test.ts",
        "tests/providerEgressPolicy.test.ts",
        "tests/benchmarkContamination.test.ts",
        "src/nodeagent/guardrails/egressPolicy.ts",
      ]),
      evidence: [
        "tests/promptInjection.test.ts",
        "tests/providerEgressPolicy.test.ts",
        "tests/benchmarkContamination.test.ts",
        "src/nodeagent/guardrails/egressPolicy.ts",
      ],
      verifier: "AI safety test file presence",
      finding: "AI/LLM safety test evidence is missing.",
      fix: "Restore prompt-injection, provider egress, and contamination tests.",
    }),
    passIf("performance-scalability", {
      category: "reliability",
      sourceCategory: "performance & scalability",
      severity: "high",
      title: "SLO and architecture budget gates are present",
      description: "Production readiness needs a cheap deterministic SLO and architecture budget guard.",
      ok: filesExist(root, ["scripts/slo-gate.ts", "scripts/architecture-budget-check.ts", "tests/roomsMetaPhase2.test.ts"]),
      evidence: ["scripts/slo-gate.ts", "scripts/architecture-budget-check.ts", "tests/roomsMetaPhase2.test.ts"],
      verifier: "SLO and architecture gate file presence",
      finding: "SLO or architecture budget gate is missing.",
      fix: "Restore slo:gate and architecture:budget proof scripts.",
    }),
    passIf("logging-trace-workpapers", {
      category: "reliability",
      sourceCategory: "logging & monitoring",
      severity: "medium",
      title: "Trace workpapers and ProofLoop artifacts are tested",
      description: "Incidents and regressions need trace IDs, receipts, and replayable evidence.",
      ok: filesExist(root, [
        "tests/nodeagentTraceSpine.test.ts",
        "tests/proofloopArtifacts.test.ts",
        "src/nodeagent/traces",
        "src/eval/proofloopArtifacts.ts",
      ]),
      evidence: [
        "tests/nodeagentTraceSpine.test.ts",
        "tests/proofloopArtifacts.test.ts",
        "src/nodeagent/traces/",
        "src/eval/proofloopArtifacts.ts",
      ],
      verifier: "trace test and artifact file presence",
      finding: "Trace/workpaper proof evidence is missing.",
      fix: "Restore NodeAgent trace spine and ProofLoop artifact tests.",
    }),
    passIf("feature-kill-switch", {
      category: "operations",
      sourceCategory: "release safety & operability",
      severity: "high",
      title: "Known risky lanes have explicit feature gates or kill switches",
      description: "A release must have a way to disable risky agent behavior without changing benchmark receipts.",
      ok: fileContains(root, "convex/agent.ts", "creditsEnforced") &&
        fileContains(root, "convex/roomActivity.ts", "PASSIVE_CREATE_AGENT_JOBS") &&
        fileContains(root, "src/nodeagent/guardrails/egressPolicy.ts", "PROVIDER_EGRESS_REQUIRE_ALLOWLIST") &&
        fileContains(root, "src/nodeagent/guardrails/egressPolicy.ts", "OPENROUTER_FREE_ALLOW_FILE_EGRESS"),
      evidence: [
        "convex/agent.ts",
        "convex/roomActivity.ts",
        "src/nodeagent/guardrails/egressPolicy.ts",
        "docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md",
      ],
      verifier: "feature gate token scan plus runbook",
      finding: "Feature gate evidence is missing.",
      fix: "Document and preserve kill switches for agent spend enforcement, passive job execution, and provider egress.",
    }),
    passIf("release-runbook", {
      category: "operations",
      sourceCategory: "release safety & operability",
      severity: "high",
      title: "ProofLoop preprod release runbook is tracked",
      description: "A human must be able to rerun gates, inspect live proof, and roll back.",
      ok: filesExist(root, ["docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md"]),
      evidence: ["docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md"],
      verifier: "tracked runbook file presence",
      finding: "Preprod release runbook is missing.",
      fix: "Add a runbook with gate commands, rollback path, kill switches, and restore evidence expectations.",
    }),
    manualCheck("backup-restore-rehearsal", {
      category: "operations",
      sourceCategory: "database, operations, release safety & operability",
      severity: "high",
      title: "External backup restore rehearsal evidence is attached",
      description: "Convex/Vercel backup restore state is external to this repository and needs a dated receipt.",
      evidence: ["docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md"],
      verifier: "manual external evidence required",
      finding: "Attach a dated restore rehearsal receipt before treating restore-readiness as proven.",
      fix: "Record the latest restore rehearsal ID/date/link in docs/eval/proofloop-preprod-readiness.json or a waiver.",
    }),
    manualCheck("legal-compliance-surface", {
      category: "legal",
      sourceCategory: "legal / compliance",
      severity: "low",
      title: "Privacy, ToS, and data-deletion posture are a product/legal decision",
      description: "This repo can track evidence, but legal readiness is not inferable from code alone.",
      evidence: ["docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md"],
      verifier: "manual legal review required",
      finding: "Attach privacy/ToS/data deletion review before broad public launch claims.",
      fix: "Add legal evidence links or mark the deployment as internal/demo only.",
    }),
  ];
  return checks;
}

function liveHeaderCheck(liveProbe?: LivePreprodProbe): CheckDraft {
  if (!liveProbe) {
    return manualCheck("live-security-headers", {
      category: "perimeter",
      sourceCategory: "security headers & cookies",
      severity: "critical",
      title: "Production URL serves required security headers",
      description: "Static config is not enough; prod must actually serve the headers.",
      evidence: ["npm run benchmark:proofloop:preprod:live"],
      verifier: "live URL header probe",
      finding: "Run live preprod to verify production headers.",
      fix: "Run npm run benchmark:proofloop:preprod:live -- --strict before production claims.",
    });
  }
  return passIf("live-security-headers", {
    category: "perimeter",
    sourceCategory: "security headers & cookies",
    severity: "critical",
    title: "Production URL serves required security headers",
    description: "Static config is not enough; prod must actually serve the headers.",
    ok: liveProbe.ok && liveProbe.headerChecks.every((check) => check.ok),
    evidence: [liveProbe.url, "docs/eval/proofloop-preprod-readiness.json"],
    verifier: "live URL header probe",
    finding: "Production URL is missing one or more required security headers.",
    fix: "Fix Vercel headers and redeploy before production claims.",
  });
}

function liveStoryCheck(liveProbe?: LivePreprodProbe): CheckDraft {
  if (!liveProbe?.storySmoke) {
    return manualCheck("live-story-smoke", {
      category: "release safety",
      sourceCategory: "release safety & operability",
      severity: "high",
      title: "Production story smoke has run against the live URL",
      description: "A prod claim should include a browser-visible route proof, not only build logs.",
      evidence: ["npm run qa:story:prod", "npm run benchmark:proofloop:preprod:live -- --live-story"],
      verifier: "Playwright story-route dogfood",
      finding: "Run the live story smoke before production claims.",
      fix: "Run npm run benchmark:proofloop:preprod:live -- --live-story --strict.",
    });
  }
  return passIf("live-story-smoke", {
    category: "release safety",
    sourceCategory: "release safety & operability",
    severity: "high",
    title: "Production story smoke has run against the live URL",
    description: "A prod claim should include a browser-visible route proof, not only build logs.",
    ok: liveProbe.storySmoke.ok,
    evidence: [liveProbe.storySmoke.command, liveProbe.url],
    verifier: "Playwright story-route dogfood",
    finding: "Live story smoke failed.",
    fix: "Fix the live story route or deployment before production claims.",
  });
}

function passIf(id: string, args: Omit<CheckDraft, "id" | "status"> & { ok: boolean }): CheckDraft {
  const { ok, ...rest } = args;
  return { id, status: ok ? "pass" : "fail", ...rest };
}

function manualCheck(id: string, args: Omit<CheckDraft, "id" | "status">): CheckDraft {
  return { id, status: "manual", ...args };
}

function applyWaivers(checks: CheckDraft[], waivers: PreprodWaiver[], generatedAt?: string): PreprodCheck[] {
  return checks.map((check) => {
    const waiver = waivers.find((candidate) => candidate.checkId === check.id && waiverActive(candidate, generatedAt));
    return waiver ? { ...check, waived: true, waiver } : { ...check, waived: false };
  });
}

function waiverActive(waiver: PreprodWaiver, generatedAt?: string): boolean {
  const now = Date.parse(generatedAt ?? new Date().toISOString());
  const expiry = Date.parse(waiver.expiresAt);
  return Number.isFinite(now) && Number.isFinite(expiry) && expiry >= now;
}

function staticHeadersOk(root: string): boolean {
  const vercel = readJson<{ headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }>(root, "vercel.json");
  const headers = vercel?.headers?.find((rule) => rule.source === "/(.*)")?.headers ?? [];
  const map: Record<string, string> = {};
  for (const header of headers) map[header.key.toLowerCase()] = header.value;
  return evaluateSecurityHeaders(map).every((check) => check.ok);
}

function npxPackageProofOk(root: string): boolean {
  const receipt = readJson<{
    schema?: string;
    packageSpec?: string;
    npmView?: { metadata?: { name?: string; version?: string; license?: string }; zeroDependencies?: boolean };
    claims?: Record<string, boolean>;
    summary?: { passed?: boolean };
  }>(root, "docs/eval/proofloop-npx-package-proof.json");
  const claims = receipt?.claims ?? {};
  return receipt?.schema === "proofloop-npx-package-proof-v1" &&
    receipt.packageSpec === "proofloop@0.1.0" &&
    receipt.npmView?.metadata?.name === "proofloop" &&
    receipt.npmView.metadata.version === "0.1.0" &&
    receipt.npmView.metadata.license === "MIT" &&
    receipt.npmView.zeroDependencies === true &&
    receipt.summary?.passed === true &&
    claims.registryLive === true &&
    claims.zeroDependencies === true &&
    claims.viteInitWorks === true &&
    claims.gateNpmTestFallbackPasses === true &&
    claims.stopHookBlocksFailingGate === true &&
    claims.forgeryGuardBlocksProofState === true &&
    claims.tooluseEmptyLogFailsClosed === true &&
    claims.tooluseDenyListFails === true;
}

function hasScriptTokens(scripts: Record<string, string>, scriptName: string, tokens: string[]): boolean {
  const script = scripts[scriptName] ?? "";
  return tokens.every((token) => script.includes(token));
}

function envLocalIgnored(root: string): boolean {
  const result = spawnSync("git", ["check-ignore", ".env.local"], { cwd: root, encoding: "utf8" });
  return result.status === 0;
}

function filesExist(root: string, paths: string[]): boolean {
  return paths.every((path) => existsSync(join(root, path)));
}

function fileContains(root: string, path: string, token: string): boolean {
  const absolute = join(root, path);
  return existsSync(absolute) && readFileSync(absolute, "utf8").includes(token);
}

function fileContainsAll(root: string, path: string, tokens: string[]): boolean {
  return tokens.every((token) => fileContains(root, path, token));
}

function readJson<T>(root: string, relativePath: string): T | undefined {
  const path = join(root, relativePath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function gitState(root: string): { commit: string; dirty: boolean } {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim() || "unknown";
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim();
  return { commit, dirty: status.length > 0 };
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}
