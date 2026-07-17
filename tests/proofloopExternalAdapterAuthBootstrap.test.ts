import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const runner = readFileSync(resolve("scripts/proofloop-external-adapter-live-room-run.ts"), "utf8");
const scenario = readFileSync(resolve("proofloop/benchmarks/common/live-room-scenario.spec.ts"), "utf8");
const config = readFileSync(resolve("playwright.proofloop.config.ts"), "utf8");

describe("ProofLoop authenticated room bootstrap", () => {
  it("passes an explicit per-adapter room URL without embedding browser credentials", () => {
    expect(runner).toContain("PROOFLOOP_EXISTING_ROOM_URLS");
    expect(runner).toContain("PROOFLOOP_EXISTING_ROOM_URL: bootstrapRoomUrls[id]");
    expect(runner).not.toMatch(/cookie|localStorage/);
    expect(config).toContain("PROOFLOOP_AUTH_STORAGE_STATE");
    expect(config).toContain("storageState: authStorageState || undefined");
    expect(runner).toContain("authenticated_browser_state_required");
    expect(runner).toContain("Interactive browser credentials are intentionally not exported");
  });

  it("joins the supplied room through the ordinary UI and still requires a blank sheet", () => {
    expect(scenario).toContain('bootstrapUrl.searchParams.set("name", "Proof Loop")');
    expect(scenario).toContain("expect(displayName).toBeVisible");
    expect(scenario).toContain('getByRole("dialog", { name: "Join this room" })');
    expect(scenario).toContain("fresh authenticated bootstrap room must expose a blank sheet CTA");
    expect(scenario).toContain("live convex");
    expect(scenario).toContain("authenticated_browser_state_required");
  });

  it("fails fast with a structured security boundary when production auth state is absent", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "proofloop-auth-boundary-"));
    try {
      const result = spawnSync(
        process.execPath,
        [
          resolve("node_modules/tsx/dist/cli.mjs"),
          resolve("scripts/proofloop-external-adapter-live-room-run.ts"),
          "--prod",
          "--id",
          "finch",
          "--json-out-dir",
          outputDir,
        ],
        {
          cwd: resolve("."),
          encoding: "utf8",
          env: { ...process.env, PROOFLOOP_AUTH_STORAGE_STATE: "" },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("PROOFLOOP_AUTH_STORAGE_STATE");
      const receipt = JSON.parse(readFileSync(join(outputDir, "finch.json"), "utf8")) as {
        status: string;
        failedGates: string[];
        securityBoundary?: { kind?: string; environmentVariable?: string };
      };
      expect(receipt).toMatchObject({
        status: "failed",
        securityBoundary: {
          kind: "authenticated_browser_state_required",
          environmentVariable: "PROOFLOOP_AUTH_STORAGE_STATE",
        },
      });
      expect(receipt.failedGates).toContain("authenticated_browser_state_required");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 15_000);
});
