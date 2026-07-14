import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ProofLoop dev-audience-ready proof", () => {
  const script = readFileSync("scripts/proofloop-dev-audience-ready.ts", "utf8");
  const cursorLauncher = readFileSync("scripts/proofloop-cursor-launch.mjs", "utf8");

  it("keeps the default proof dry-run/free-first instead of paid-provider-first", () => {
    expect(script).toContain("PROOFLOOP_CURSOR_DRY_RUN");
    expect(script).toContain("PROOFLOOP_WINDSURF_DRY_RUN");
    expect(script).toContain("PROOFLOOP_DEVIN_API_DRY_RUN");
    expect(script).toContain("proofloop-free-openrouter-nodeagent-gauge.json");
    expect(script).toContain("openrouter-free-model-discovery.json");
    expect(script).toContain("free-first-router-cost-receipt");
    expect(script).toContain("paidModelCalls: false");
    expect(script).toContain("FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION");
    expect(script).toContain("VOICE_ALLOW_PAID_FALLBACK");
    expect(script).toContain("proxyJudgeCannotClaimOfficialScore");
  });

  it("lets Cursor launch/session export be smoke-tested without a live model call", () => {
    expect(cursorLauncher).toContain("PROOFLOOP_CURSOR_DRY_RUN");
    expect(cursorLauncher).toContain("dry-run cursor native launch ok");
    expect(cursorLauncher).toContain("proofloop-cursor-session-export-v1");
  });
});
