import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("native notebook passive-intelligence source ownership", () => {
  it("keeps the ProseMirror adapter out of the passive activity enqueue path", () => {
    const source = readFileSync("convex/prosemirror.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(source).not.toMatch(/enqueueRoomActivity/);
    expect(source).not.toMatch(/roomActivityOutbox/);
  });
});
