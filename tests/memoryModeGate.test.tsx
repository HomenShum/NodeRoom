import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Who: a visitor on the production site (VITE_CONVEX_URL set at build time) who adds
 * `?mode=memory` to the URL, and the harness/CI that legitimately needs the keyless room.
 * Failure this pins: the query param alone used to switch ANY build, production included,
 * to the scripted in-memory engine (observed: canned "Committed r_rev +24%..." replies).
 * Rule: `?mode=memory` counts only in a build with VITE_NODEROOM_HARNESS=1; a build
 * without VITE_CONVEX_URL (immutable CI) has only the keyless room anyway.
 */
async function gate(env: { convexUrl?: string; harness?: string }, url: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_CONVEX_URL", env.convexUrl ?? "");
  vi.stubEnv("VITE_NODEROOM_HARNESS", env.harness ?? "");
  window.history.replaceState(null, "", url);
  return import("../src/app/store");
}

const PROD = { convexUrl: "https://example-123.convex.cloud" };

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

// The first import transforms the store's whole dependency tree; later re-imports hit the cache.
describe("?mode=memory gating", { timeout: 120_000 }, () => {
  it("a production build ignores ?mode=memory on the desktop URL and stays on Convex", async () => {
    expect((await gate(PROD, "/?mode=memory&surface=desktop")).HAS_CONVEX).toBe(true);
    expect((await gate(PROD, "/?surface=desktop")).HAS_CONVEX).toBe(true);
  });

  it("a production build ignores the mobile hash spelling too (MobileRoot shares the rule)", async () => {
    const { memoryModeRequested } = await gate(PROD, "/#mobile?mode=memory");
    expect(memoryModeRequested(new URLSearchParams("mode=memory"))).toBe(false);
  });

  it("near-miss harness flags do not open the harness", async () => {
    for (const harness of ["true", "0", "yes", " 1"]) {
      expect((await gate({ ...PROD, harness }, "/?mode=memory")).HAS_CONVEX, `harness=${JSON.stringify(harness)}`).toBe(true);
    }
  });

  it("a harness build (VITE_NODEROOM_HARNESS=1) still reaches the keyless room by URL, and only by URL", async () => {
    const harnessed = { ...PROD, harness: "1" };
    expect((await gate(harnessed, "/?mode=memory&surface=desktop")).HAS_CONVEX).toBe(false);
    expect((await gate(harnessed, "/?surface=desktop")).HAS_CONVEX).toBe(true);
    const { memoryModeRequested } = await gate(harnessed, "/");
    expect(memoryModeRequested(new URLSearchParams("mode=memory"))).toBe(true);
    expect(memoryModeRequested(new URLSearchParams("mode=convex"))).toBe(false);
  });

  it("a build without VITE_CONVEX_URL (immutable CI) runs keyless with or without the param", async () => {
    expect((await gate({}, "/?mode=memory")).HAS_CONVEX).toBe(false);
    expect((await gate({}, "/")).HAS_CONVEX).toBe(false);
  });
});
