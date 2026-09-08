import { describe, expect, it } from "vitest";

import { assertElementDraftWithinLimit, assertElementValueBatchWithinLimit, assertElementValueWithinLimit, elementValueLimitViolation, MAX_ELEMENT_VALUE_BYTES } from "../src/engine/elementValueLimits";
import { RoomEngine } from "../src/engine/roomEngine";
import { notebookCheckpointDecision } from "../src/notebook/notebookCheckpointLimit";

describe("bounded NodeRoom element writes", () => {
  it("allows a realistic NodeBook artifact update below the shared mutation ceiling", () => {
    const payload = {
      schemaVersion: "nodebook.visual-artifact/v1",
      kind: "flow",
      format: "structured-json",
      payload: JSON.stringify({ nodes: Array.from({ length: 50 }, (_, id) => ({ id: `n${id}`, label: `Node ${id}` })) }),
      contentHash: "a".repeat(64),
    };

    expect(elementValueLimitViolation(payload, "set")).toBeNull();
  });

  it("rejects a 1.2 MB NodeAgent value before production Convex persistence", () => {
    expect(elementValueLimitViolation("x".repeat(1_200_000), "set")).toBe("value_too_large");
    expect(elementValueLimitViolation("x".repeat(MAX_ELEMENT_VALUE_BYTES), "set")).toBe("value_too_large");
  });

  it("does not make deletion depend on the superseded value size", () => {
    expect(elementValueLimitViolation("x".repeat(MAX_ELEMENT_VALUE_BYTES + 1), "delete")).toBeNull();
  });

  it("rejects unserializable cyclic tool output before CAS, proposal, or history work", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(elementValueLimitViolation(cyclic, "create")).toBe("value_not_serializable");
  });

  it("rejects a binary NodeAgent tool result that JSON sizing would undercount", () => {
    expect(elementValueLimitViolation(new ArrayBuffer(1_200_000), "set")).toBe("value_not_serializable");
    expect(elementValueLimitViolation({ attachment: new Uint8Array(32) }, "create")).toBe("value_not_serializable");
  });

  it("rejects lossy or over-deep values before they become misleading canonical state", () => {
    expect(elementValueLimitViolation({ createdAt: new Date() }, "set")).toBe("value_not_serializable");
    expect(elementValueLimitViolation({ missing: undefined }, "set")).toBe("value_not_serializable");
    expect(elementValueLimitViolation({ score: Number.NaN }, "set")).toBe("value_not_serializable");
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 14; index += 1) deep = { child: deep };
    expect(elementValueLimitViolation(deep, "set")).toBe("value_not_serializable");
  });

  it("blocks the NodeAgent draft twin before it can accumulate an oversized pending row", () => {
    const engine = new RoomEngine();
    const { room, host } = engine.createRoom({ title: "Bounded draft room", hostName: "Maya", autoAllow: true });
    const hostActor = { kind: "user" as const, id: host.id, name: "Maya" };
    const note = engine.createArtifact({ roomId: room.id, kind: "note", title: "Visual", by: hostActor, seed: [] });
    const agent = { kind: "agent" as const, id: "room-agent", name: "Room NodeAgent", scope: "public" as const };

    expect(() => engine.createDraft({
      roomId: room.id,
      artifactId: note.id,
      author: agent,
      note: "oversized visual draft",
      ops: [{ opId: "too-large", artifactId: note.id, elementId: "nodebook:artifact", kind: "create", value: "x".repeat(MAX_ELEMENT_VALUE_BYTES), baseVersion: 0 }],
    })).toThrow("value_too_large");
    expect(engine.listDrafts(room.id)).toHaveLength(0);
  });

  it("provides the same fail-fast exception for mutation entrypoints that cannot return result unions", () => {
    expect(() => assertElementValueWithinLimit("x".repeat(MAX_ELEMENT_VALUE_BYTES), "set")).toThrow("value_too_large");
  });

  it("rejects individually valid values whose aggregate seed crosses 5 MB", () => {
    const values = Array.from({ length: 8 }, (_, index) => ({ value: String(index).repeat(650_000) }));
    expect(() => assertElementValueBatchWithinLimit(values)).toThrow("element_batch_too_large");

    const engine = new RoomEngine();
    const { room, host } = engine.createRoom({ title: "Aggregate bound", hostName: "Maya", autoAllow: true });
    const hostActor = { kind: "user" as const, id: host.id, name: "Maya" };
    expect(() => engine.createArtifact({ roomId: room.id, kind: "note", title: "Oversized", by: hostActor, seed: values.map((entry, index) => ({ id: `seed-${index}`, value: entry.value })) })).toThrow("element_batch_too_large");
  });

  it("measures the complete persisted draft including note and multi-op overhead", () => {
    const individuallyValid = [
      { kind: "create", value: "a".repeat(400_000) },
      { kind: "create", value: "b".repeat(400_000) },
    ];
    expect(() => assertElementDraftWithinLimit(individuallyValid, "bounded note")).toThrow("draft_document_too_large");
    expect(() => assertElementDraftWithinLimit([], "n".repeat(8_193))).toThrow("draft_note_too_large");
  });

  it("skips a 1.2 MB legacy notebook mirror while preserving the canonical document lane", () => {
    expect(notebookCheckpointDecision("<p>" + "x".repeat(1_200_000) + "</p>")).toEqual({
      status: "skip",
      reason: "value_too_large",
    });
  });

  it("bounds sustained pending NodeAgent proposals and drafts at 500 rows per room", () => {
    const engine = new RoomEngine();
    const { room, host } = engine.createRoom({ title: "Queue bound", hostName: "Maya", autoAllow: false });
    const hostActor = { kind: "user" as const, id: host.id, name: "Maya" };
    const agent = { kind: "agent" as const, id: "room-agent", name: "Room NodeAgent", scope: "public" as const };
    const note = engine.createArtifact({ roomId: room.id, kind: "note", title: "Visual", by: hostActor, seed: [] });

    for (let index = 0; index < 500; index += 1) {
      const result = engine.applyEdit({ roomId: room.id, actor: agent, op: { opId: `proposal-${index}`, artifactId: note.id, elementId: `visual-${index}`, kind: "create", value: "bounded", baseVersion: 0 } });
      expect(result.ok || result.reason === "pending_approval").toBe(true);
      engine.createDraft({ roomId: room.id, artifactId: note.id, author: agent, note: `draft-${index}`, ops: [] });
    }

    const overflow = engine.applyEdit({ roomId: room.id, actor: agent, op: { opId: "proposal-overflow", artifactId: note.id, elementId: "visual-overflow", kind: "create", value: "bounded", baseVersion: 0 } });
    expect(overflow).toEqual({ ok: false, reason: "proposal_queue_full" });
    expect(() => engine.createDraft({ roomId: room.id, artifactId: note.id, author: agent, note: "draft-overflow", ops: [] })).toThrow("draft_queue_full");
  });

  it("evicts the oldest resolved proposals and drafts during sustained review churn", () => {
    const engine = new RoomEngine();
    const { room, host } = engine.createRoom({ title: "Resolved retention", hostName: "Maya", autoAllow: false });
    const hostActor = { kind: "user" as const, id: host.id, name: "Maya" };
    const agent = { kind: "agent" as const, id: "room-agent", name: "Room NodeAgent", scope: "public" as const };
    const note = engine.createArtifact({ roomId: room.id, kind: "note", title: "Visual", by: hostActor, seed: [] });

    for (let index = 0; index < 550; index += 1) {
      const proposed = engine.applyEdit({ roomId: room.id, actor: agent, op: { opId: `resolved-proposal-${index}`, artifactId: note.id, elementId: `visual-${index}`, kind: "create", value: "bounded", baseVersion: 0 } });
      if (proposed.ok || proposed.reason !== "pending_approval") throw new Error("scenario expected a review proposal");
      engine.resolveProposal(proposed.proposalId, false, hostActor);
      const draft = engine.createDraft({ roomId: room.id, artifactId: note.id, author: agent, note: `resolved-draft-${index}`, ops: [] });
      engine.mergeDraft(draft.id);
    }

    expect(engine.collectionSizes()).toEqual({ proposals: 500, drafts: 500 });
  });
});
