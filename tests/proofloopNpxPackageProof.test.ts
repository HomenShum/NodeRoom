import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ProofLoop npx package proof receipt", () => {
  it("records a real registry-backed published package proof", () => {
    const path = join(process.cwd(), "docs/eval/proofloop-npx-package-proof.json");
    expect(existsSync(path)).toBe(true);
    const receipt = JSON.parse(readFileSync(path, "utf8"));

    expect(receipt.schema).toBe("proofloop-npx-package-proof-v1");
    expect(receipt.packageSpec).toBe("proofloop@0.1.0");
    expect(receipt.npmView.metadata.name).toBe("proofloop");
    expect(receipt.npmView.metadata.version).toBe("0.1.0");
    expect(receipt.npmView.metadata.license).toBe("MIT");
    expect(receipt.npmView.zeroDependencies).toBe(true);
    expect(receipt.summary.passed).toBe(true);
    expect(receipt.claims).toMatchObject({
      registryLive: true,
      zeroDependencies: true,
      viteInitWorks: true,
      gateNpmTestFallbackPasses: true,
      stopHookBlocksFailingGate: true,
      forgeryGuardBlocksProofState: true,
      tooluseEmptyLogFailsClosed: true,
      tooluseDenyListFails: true,
    });

    const ids = receipt.steps.map((step: { id: string }) => step.id);
    expect(ids).toEqual(expect.arrayContaining([
      "npm-view",
      "clean-doctor",
      "vite-init",
      "gate-npm-test-fallback",
      "stop-hook-blocks-failing-gate",
      "forgery-guard-blocks-gate-state",
      "tooluse-empty-log-fails-closed",
      "tooluse-deny-list-fails",
    ]));
  });
});
