import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  });

  it("joins the supplied room through the ordinary UI and still requires a blank sheet", () => {
    expect(scenario).toContain('bootstrapUrl.searchParams.set("name", "Proof Loop")');
    expect(scenario).toContain("expect(displayName).toBeVisible");
    expect(scenario).toContain('getByRole("dialog", { name: "Join this room" })');
    expect(scenario).toContain("fresh authenticated bootstrap room must expose a blank sheet CTA");
    expect(scenario).toContain("live convex");
  });
});
