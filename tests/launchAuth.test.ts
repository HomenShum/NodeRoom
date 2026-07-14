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
