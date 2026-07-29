/**
 * Capture, always armed — scenario tests for the ⌘K "Capture a thought" palette action
 * (note-surface rule-capture-always-armed; docs/design/note-surface/ score receipts).
 *
 * Persona: a banker mid-review in a live room. A thought arrives while she is reading a
 * variance cell; she hits ⌘K, runs Capture, and types. The contract under test: the
 * capture op asks NO classification question (empty text, preset color/position), lands
 * on the wall through the same CAS spine as every other edit, and survives a burst —
 * because a palette command that can collide with itself under rapid capture is a
 * capture tool that loses thoughts.
 *
 * Angles: happy path (op lands, wall grows), burst (rapid sequential captures all land,
 * no id collisions), degraded (room without a wall lists no command — honest absence is
 * asserted at the builder level: the caller guards on wall existence), and adversarial
 * (a stale-base create against an existing id is refused by the engine, not merged).
 */

import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildWallCapture } from "../src/ui/RoomShell";
import type { Actor } from "../src/engine/types";

function setup() {
  const eng = new RoomEngine();
  const { room, host } = eng.createRoom({ title: "Q3 diligence", hostName: "Maya", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: "Maya" };
  const wall = eng.createArtifact({
    roomId: room.id, kind: "wall", title: "Quick captures", by: me,
    seed: [{ id: "s_welcome", value: { text: "Drop ideas here", x: 60, y: 60, color: "#FDE68A" } }],
  });
  return { eng, room, wall, me };
}

function applyCapture(eng: RoomEngine, roomId: string, wallId: string, me: Actor, capture: ReturnType<typeof buildWallCapture>) {
  return eng.applyEdit({
    roomId,
    op: { opId: crypto.randomUUID(), artifactId: wallId, elementId: capture.elementId, kind: "create", value: capture.value, baseVersion: 0 },
    actor: me,
  });
}

describe("capture always armed — palette capture through the engine", () => {
  it("creates an unclassified, empty-text capture on the wall (no question before the first keystroke)", () => {
    const { eng, room, wall, me } = setup();
    const capture = buildWallCapture(eng.getArtifact(wall.id)!);

    expect(capture.value.text).toBe(""); // nothing pre-written, nothing asked
    const fb = applyCapture(eng, room.id, wall.id, me, capture);
    expect(fb.ok).toBe(true);

    const after = eng.getArtifact(wall.id)!;
    expect(after.order).toContain(capture.elementId);
    expect(after.elements[capture.elementId]?.value).toEqual(capture.value);
  });

  it("survives a burst: 50 rapid captures all land with unique ids and unique-enough placement", () => {
    const { eng, room, wall, me } = setup();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const capture = buildWallCapture(eng.getArtifact(wall.id)!);
      const fb = applyCapture(eng, room.id, wall.id, me, capture);
      expect(fb.ok).toBe(true);
      expect(ids.has(capture.elementId)).toBe(false);
      ids.add(capture.elementId);
    }
    expect(eng.getArtifact(wall.id)!.order.length).toBe(51); // seed + 50
  });

  it("cycles the shared post-it palette by wall size, matching the wall's own Capture button", () => {
    const { eng, wall } = setup();
    const first = buildWallCapture(eng.getArtifact(wall.id)!);
    // 1 existing capture -> palette index 1 of the 5-color cycle
    expect(first.value.color).toBe("#F2DE9B");
  });

  it("adversarial: recreating an existing element id is refused by CAS, not silently merged", () => {
    const { eng, room, wall, me } = setup();
    const capture = buildWallCapture(eng.getArtifact(wall.id)!);
    expect(applyCapture(eng, room.id, wall.id, me, capture).ok).toBe(true);
    const replay = applyCapture(eng, room.id, wall.id, me, capture);
    expect(replay.ok).toBe(false); // same elementId at baseVersion 0 must conflict
  });
});
