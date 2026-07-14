// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

// REGRESSION: "That room is full" used to cause infinite flashing. Root cause (see
// docs/COMPONENT_STATE_AUDIT_FINDINGS.md + the App.tsx join effect): the effect's run guard was
// re-satisfied on every failure because `busy` flips true->false in .finally and nothing latched
// the failed attempt. join() therefore re-fired in an unbounded loop. The fix (App.tsx:90,107-108)
// is a per-request `attemptedRef` latch. This test renders the live app driven into the room_full
// path and asserts the join mutation fires EXACTLY ONCE — the assertion that fails pre-fix (the
// count climbs without bound) and passes post-fix.

// hoisted so the vi.mock factory below can close over it (vi.mock is hoisted above plain consts).
const { joinMock } = vi.hoisted(() => ({
  joinMock: vi.fn(async () => ({ error: "room_full" as const })),
}));

// A single shared, referentially-stable mock stands in for every useMutation() call site. Only
// `join` is invoked on the room_full path, so its call count == joinMock's call count. Stability
// matters: a fresh fn per render would itself churn the effect deps (mirrors real Convex useMutation).
vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => (args === "skip" ? undefined : { roomId: "r_full" }),
  useMutation: () => joinMock,
}));

// Force the live (Convex) branch and stub the providers. On the room_full path `session` stays null,
// so ConvexStoreProvider/RoomShell never actually render — mocking only avoids their heavy imports.
vi.mock("../src/app/store", () => ({
  HAS_CONVEX: true,
  EngineStoreProvider: ({ children }: { children?: ReactNode }) => children,
  ConvexStoreProvider: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("../src/ui/RoomShell", () => ({ RoomShell: () => null }));
vi.mock("../src/landing/LandingStory", () => ({ LandingStory: () => null }));

import { App } from "../src/ui/App";

describe("room_full no-flash (App.tsx join-effect latch)", () => {
  beforeEach(() => {
    joinMock.mockClear();
    window.localStorage.clear();
    window.sessionStorage.clear();
    // Scenario: a teammate confirms the explicit join preflight for a room that
    // reaches capacity before the mutation lands. Identity stays out of the URL.
    window.sessionStorage.setItem("noderoom:livePending:TEAMQ3", JSON.stringify({ name: "Guest" }));
    window.history.replaceState({}, "", "/?room=TEAMQ3&confirmed=1");
  });

  it("calls joinAnonymous exactly once and settles on the honest error (no re-fire loop)", async () => {
    render(<App />);

    // The honest failure surfaces in the live join form...
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/room is full/i),
    );

    // ...and the latch means exactly one attempt was made.
    expect(joinMock).toHaveBeenCalledTimes(1);

    // Let several more macrotask/microtask cycles elapse. Pre-fix, the effect re-fired on every
    // busy:true->false flip, so this count would keep climbing. Post-fix it stays pinned at 1.
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 50));
    expect(joinMock).toHaveBeenCalledTimes(1);
  });
});
