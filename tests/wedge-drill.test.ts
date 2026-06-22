// Wedge drill — the no-clobber human+agent over shared artifact invariant.
// Per src/engine/demoRoom.ts playCollab(opts.conflict=true): the host (Homen) takes a lock on
// r_rev__variance, the room agent drafts "+19%" against the locked cell, the host then applies
// "+24%" against base, releases the lock, and the substrate runs semantic-rebase. The wedge
// invariant: the host's "+24%" SURVIVES in canonical state (no silent clobber by the agent's
// stale "+19%") and the agent posts a coherent rebase outcome to public channel.
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom, playCollab } from "../src/engine/demoRoom";

describe("Wedge: no-clobber over a shared artifact (human lock + concurrent agent write)", () => {
  it("conflict drill: host's +24% survives in canonical state; agent's stale +19% routed via semantic-rebase", async () => {
    const engine = new RoomEngine();
    const demo = buildDemoRoom(engine);

    const before = engine.getArtifact(demo.sheetId)!.elements["r_rev__variance"];
    expect(before.value, "variance cell starts empty").toBe("");
    expect(before.version, "variance cell starts at version 1").toBe(1);

    await playCollab(engine, demo, { conflict: true, reduced: true });

    // INVARIANT 1: host's "+24%" is the canonical state (the human's intent survived; no clobber).
    const after = engine.getArtifact(demo.sheetId)!.elements["r_rev__variance"];
    expect(after.value, "the host's +24% must be the canonical state — agent must not clobber it").toBe("+24%");
    expect(after.version, "canonical version advanced past base").toBeGreaterThan(1);

    // INVARIANT 2: the substrate posted a coherent rebase outcome message to PUBLIC channel
    // (either a review proposal was opened for the agent's stale +19%, or it was reconciled).
    const publicMessages = engine.listMessages(demo.roomId, "public");
    const rebaseOutcome = publicMessages.find((m) =>
      typeof m.text === "string" && /(semantic rebase|review proposal|already reconciled)/i.test(m.text)
    );
    expect(rebaseOutcome, "agent must post a semantic-rebase outcome (no silent overwrite)").toBeDefined();

    // INVARIANT 3: the agent's draft was NOT applied as-is (its "+19%" must not be the canonical value).
    expect(after.value, "agent's stale +19% must not be the canonical value").not.toBe("+19%");
  });
});
