import { describe, expect, it } from "vitest";
import { engine, createFreshRoom } from "../src/app/roomStore";

/**
 * Root-cause regression net for the `#story` playground going dark: engine
 * .createRoom() creates a BARE room, so createFreshRoom MUST seed a sheet or
 * the StoryLab grid + L4/L7 lease drill silently no-op on an empty artId "".
 * (The e2e net is e2e/mobile-story-surfaces.spec.ts's lease drill; this is the
 * fast unit guard on the exact seam.)
 */
describe("createFreshRoom — StoryLab playground precondition", () => {
  it("seeds a sheet the grid + lease drill can address", () => {
    const { roomId, me } = createFreshRoom("Seven-layer playground", "You");

    const sheet = engine.listArtifacts(roomId).find((a) => a.kind === "sheet");
    expect(sheet, "a fresh playground room must contain a sheet").toBeTruthy();

    // The drills address cells as `${rowId}__${col}`; prove the seeded sheet
    // accepts a lease-cell write (kind "create" for a fresh cell), so the
    // "Run the lease drill" button can never be a silent no-op on artId "" again.
    const res = engine.applyEdit({
      roomId,
      op: { opId: "t1", artifactId: sheet!.id, elementId: "r5__C", kind: "create", value: "+20.5%", baseVersion: 0 },
      actor: me,
    });
    expect(res.ok).toBe(true);
  });

  it("gives each fresh room its own isolated sheet (no cross-room bleed)", () => {
    const a = createFreshRoom("Room A", "You");
    const b = createFreshRoom("Room B", "You");
    const sheetA = engine.listArtifacts(a.roomId).find((x) => x.kind === "sheet");
    const sheetB = engine.listArtifacts(b.roomId).find((x) => x.kind === "sheet");
    expect(sheetA && sheetB).toBeTruthy();
    expect(sheetA!.id).not.toBe(sheetB!.id);
  });
});
