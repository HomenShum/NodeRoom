import { describe, expect, it } from "vitest";
import { inviteHrefForRoom } from "../src/ui/RoomShell";

describe("room invite links", () => {
  it("copies a join URL instead of only the room code", () => {
    expect(inviteHrefForRoom("ab12cd", "https://app.example.com/?create=OLD&name=Maya#story")).toBe("https://app.example.com/?room=AB12CD");
  });
});
