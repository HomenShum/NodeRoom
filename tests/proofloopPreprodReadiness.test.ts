import { describe, expect, it } from "vitest";
import {
  buildProofloopPreprodReadinessReceipt,
  evaluateSecurityHeaders,
  renderProofloopPreprodReadinessMarkdown,
  type LivePreprodProbe,
} from "../src/eval/proofloopPreprodReadiness";

function passingLiveProbe(): LivePreprodProbe {
  const headers = {
    "content-security-policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(self)",
    "cross-origin-opener-policy": "same-origin",
  };
  return {
    url: "https://noderoom.live",
    ok: true,
    rootStatus: 200,
    headers,
    headerChecks: evaluateSecurityHeaders(headers),
    storySmoke: {
      command: "node scripts/story-route-dogfood.mjs --base-url https://noderoom.live",
      ok: true,
      stdoutTail: '{"ok":true,"baseUrl":"https://noderoom.live"}',
      parsed: { ok: true },
    },
  };
}

describe("ProofLoop preprod readiness receipt", () => {
  it("ports preprod-check into a deterministic ProofLoop release gate", () => {
    const receipt = buildProofloopPreprodReadinessReceipt({
      root: process.cwd(),
      generatedAt: "2026-07-03T00:00:00.000Z",
    });

    expect(receipt.schema).toBe("proofloop-preprod-readiness-v1");
    expect(receipt.sourceAttribution.url).toBe("https://github.com/kevincui1034/preprod-check");
    expect(receipt.sourceAttribution.importedAs).toContain("deterministic");
    expect(receipt.releaseGate.status).toBe("passed");
    expect(receipt.summary.blockingFindings).toBe(0);
    expect(receipt.summary.manual).toBeGreaterThan(0);
    expect(receipt.releaseGate.manualEvidenceRequired.join(" ")).toContain("backup-restore-rehearsal");

    const ids = receipt.checks.map((check) => check.id);
    expect(ids).toEqual(expect.arrayContaining([
      "prod-gate-chain",
      "npx-proofloop-package-proof",
      "static-security-headers",
      "browser-provider-egress",
      "ssrf-upload-boundary",
      "agent-cost-step-caps",
      "release-runbook",
      "backup-restore-rehearsal",
    ]));
    expect(receipt.checks.find((check) => check.id === "npx-proofloop-package-proof")?.status).toBe("pass");

    const criticalHigh = receipt.checks.filter((check) => check.severity === "critical" || check.severity === "high");
    expect(receipt.verifiedCriticalHigh.length).toBeGreaterThan(criticalHigh.length - receipt.summary.manual - 1);

    const markdown = renderProofloopPreprodReadinessMarkdown(receipt);
    expect(markdown).toContain("ProofLoop Preprod Readiness");
    expect(markdown).toContain("Manual Evidence Still Required");
    expect(markdown).toContain("kevincui1034/preprod-check");
  });

  it("records live production header and story smoke evidence when provided", () => {
    const receipt = buildProofloopPreprodReadinessReceipt({
      root: process.cwd(),
      generatedAt: "2026-07-03T00:00:00.000Z",
      liveProbe: passingLiveProbe(),
    });

    expect(receipt.summary.liveChecksPassed).toBe(true);
    expect(receipt.checks.find((check) => check.id === "live-security-headers")?.status).toBe("pass");
    expect(receipt.checks.find((check) => check.id === "live-story-smoke")?.status).toBe("pass");
    expect(receipt.liveProbe?.storySmoke?.ok).toBe(true);

    const markdown = renderProofloopPreprodReadinessMarkdown(receipt);
    expect(markdown).toContain("Live Probe");
    expect(markdown).toContain("Story smoke: pass");
  });

  it("fails the live header verifier when required headers are missing", () => {
    const checks = evaluateSecurityHeaders({
      "content-security-policy": "default-src 'self'",
    });

    expect(checks.find((check) => check.header === "content-security-policy" && check.expected === "default-src 'self'")?.ok).toBe(true);
    expect(checks.find((check) => check.header === "x-frame-options")?.ok).toBe(false);
    expect(checks.filter((check) => !check.ok).length).toBeGreaterThan(0);
  });
});
