import { describe, expect, it } from "vitest";
import { roomIntroSafetyCopy } from "../src/ui/RoomShell";

describe("RoomShell walkthrough copy", () => {
  it("does not describe live Convex rooms as memory demos", () => {
    expect(roomIntroSafetyCopy("memory")).toContain("memory demo");
    expect(roomIntroSafetyCopy("convex")).toContain("production backend");
    expect(roomIntroSafetyCopy("convex")).not.toContain("nothing is sent anywhere");
  });
});
