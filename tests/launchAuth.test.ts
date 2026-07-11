import { afterEach, describe, expect, it, vi } from "vitest";
import { authIntentLabel, clearPersistedRoomSessions, launchAuthProvider, launchAuthRequired } from "../src/auth/launchAuth";

describe("launch authentication contract", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is fail-open only when the release flag is explicitly absent", () => {
    expect(launchAuthRequired({})).toBe(false);
    expect(launchAuthRequired({ VITE_NODEROOM_AUTH_REQUIRED: "0" })).toBe(false);
    expect(launchAuthRequired({ VITE_NODEROOM_AUTH_REQUIRED: "1" })).toBe(true);
  });

  it("defaults production-facing UI to GitHub and reserves password for explicit QA", () => {
    expect(launchAuthProvider({})).toBe("github");
    expect(launchAuthProvider({ VITE_NODEROOM_AUTH_PROVIDER: "github" })).toBe("github");
    expect(launchAuthProvider({ VITE_NODEROOM_AUTH_PROVIDER: "password" })).toBe("password");
  });

  it("uses literal first-run action labels", () => {
    expect(authIntentLabel("join")).toBe("join this room");
    expect(authIntentLabel("create")).toBe("create this workspace");
    expect(authIntentLabel("demo")).toBe("start a sample room");
  });

  it("clears every account-bound room session while preserving unrelated local state", () => {
    const values = new Map([
      ["noderoom:live:ABC123", "one"],
      ["noderoom:live:XYZ789", "two"],
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
