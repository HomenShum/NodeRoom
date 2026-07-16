import { describe, expect, it, vi } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor, ChangeOp } from "../src/engine/types";

function setup() {
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({
    title: "Atomic artifact edits",
    hostName: "Jordan",
    autoAllow: true,
  });
  const actor: Actor = { kind: "user", id: host.id, name: host.name };
  const artifact = engine.createArtifact({
    roomId: room.id,
    kind: "note",
    title: "Collaborative deck",
    by: actor,
    seed: [
      { id: "deck:meta", value: { title: "Draft" } },
      { id: "slide:one", value: { title: "Opening" } },
    ],
  });
  return { engine, room, actor, artifact };
}

function op(
  opId: string,
  artifactId: string,
  elementId: string,
  kind: ChangeOp["kind"],
  value: unknown,
  baseVersion: number,
): ChangeOp {
  return { opId, artifactId, elementId, kind, value, baseVersion };
}

describe("RoomEngine.applyArtifactEdits", () => {
  it("atomically applies set, create, and delete operations and emits once", () => {
    const { engine, room, actor, artifact } = setup();
    const listener = vi.fn();
    engine.subscribe(listener);
    const traceCount = engine.listTraces(room.id).length;

    const result = engine.applyArtifactEdits({
      roomId: room.id,
      artifactId: artifact.id,
      actor,
      ops: [
        op("bundle-set", artifact.id, "deck:meta", "set", { title: "Final" }, 1),
        op("bundle-create", artifact.id, "slide:two", "create", { title: "Evidence" }, 0),
        op("bundle-delete", artifact.id, "slide:one", "delete", null, 1),
      ],
    });

    expect(result).toEqual({
      ok: true,
      artifactVersion: 4,
      results: [
        { opId: "bundle-set", elementId: "deck:meta", version: 2 },
        { opId: "bundle-create", elementId: "slide:two", version: 1 },
        { opId: "bundle-delete", elementId: "slide:one", version: 1 },
      ],
    });
    expect(engine.getArtifact(artifact.id)).toMatchObject({
      version: 4,
      order: ["deck:meta", "slide:two"],
      elements: {
        "deck:meta": { version: 2, value: { title: "Final" } },
        "slide:two": { version: 1, value: { title: "Evidence" } },
      },
    });
    expect(engine.getArtifact(artifact.id)?.elements["slide:one"]).toBeUndefined();
    expect(engine.listTraces(room.id)).toHaveLength(traceCount + 3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale later operation without changing earlier elements, versions, or traces", () => {
    const { engine, room, actor, artifact } = setup();
    const beforeArtifact = structuredClone(engine.getArtifact(artifact.id));
    const beforeTraces = structuredClone(engine.listTraces(room.id));
    const listener = vi.fn();
    engine.subscribe(listener);

    const result = engine.applyArtifactEdits({
      roomId: room.id,
      artifactId: artifact.id,
      actor,
      ops: [
        op("valid-first", artifact.id, "deck:meta", "set", { title: "Must not persist" }, 1),
        op("stale-second", artifact.id, "slide:one", "set", { title: "Stale" }, 0),
      ],
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      opId: "stale-second",
      elementId: "slide:one",
      expected: 0,
      actual: 1,
    });
    expect(engine.getArtifact(artifact.id)).toEqual(beforeArtifact);
    expect(engine.listTraces(room.id)).toEqual(beforeTraces);
    expect(listener).not.toHaveBeenCalled();
  });
});
