import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authIntentLabel,
  clearPersistedRoomSessions,
  launchAuthProvider,
  launchAuthRequired,
} from "../src/auth/launchAuth";

describe("launch authentication contract", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("enables the account gate only when the release flag is explicit", () => {
    expect(launchAuthRequired({})).toBe(false);
    expect(launchAuthRequired({ VITE_NODEROOM_AUTH_REQUIRED: "0" })).toBe(false);
    expect(launchAuthRequired({ VITE_NODEROOM_AUTH_REQUIRED: "1" })).toBe(true);
  });

  it("defaults to GitHub and exposes additional providers only when configured", () => {
    expect(launchAuthProvider({})).toBe("github");
    expect(launchAuthProvider({ VITE_NODEROOM_AUTH_PROVIDER: "github" })).toBe("github");
    expect(launchAuthProvider({ VITE_NODEROOM_AUTH_PROVIDER: "password" })).toBe("password");
    expect(launchAuthProvider({ VITE_NODEROOM_AUTH_PROVIDER: "both" })).toBe("both");
  });

  it("uses literal first-run action labels", () => {
    expect(authIntentLabel("join")).toBe("join this room");
    expect(authIntentLabel("create")).toBe("create this workspace");
    expect(authIntentLabel("demo")).toBe("start a sample room");
  });

  it("keeps first-run and sample copy aligned with authenticated room access", () => {
    const launchSurfaces = [
      "index.html",
      "src/ui/Landing.tsx",
      "src/landing/roomTour/RoomTourFlows.tsx",
      "src/landing/roomTour/roomTourData.ts",
      "src/ui/mobile/MobileRoot.tsx",
      "src/ui/mobile/RoomJoinConsent.tsx",
      "src/ui/mobile/MobileGapSheets.tsx",
      "src/ui/mobile/mobileData.ts",
      "src/engine/demoRoom.ts",
      "src/app/roomStore.ts",
      "convex/seed.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(launchSurfaces).toContain("Sign-in required");
    expect(launchSurfaces).toContain("Sign in, then join with a six-character room code");
    expect(launchSurfaces).toContain("membership is bound to the signed-in account");
    expect(launchSurfaces).not.toContain("Public by default");
    expect(launchSurfaces).not.toContain("No account needed");
    expect(launchSurfaces).not.toContain("no account · join as guest");
    expect(launchSurfaces).not.toContain("Anyone allowed by this deployment");
    expect(launchSurfaces).not.toContain("anon · quokka");
  });

  it("clears active and pending room state while preserving unrelated preferences", () => {
    const values = new Map([
      ["noderoom:live:ABC123", "active"],
      ["noderoom:livePending:ABC123", "desktop-pending"],
      ["noderoom:mobilePending:XYZ789", "mobile-pending"],
      ["theme", "dark"],
    ]);
    const storage = {
      get length() { return values.size; },
      key(index: number) { return [...values.keys()][index] ?? null; },
      removeItem(key: string) { values.delete(key); },
    };

    clearPersistedRoomSessions(storage);

    expect([...values.entries()]).toEqual([["theme", "dark"]]);
  });
});
