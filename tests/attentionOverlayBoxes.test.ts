/**
 * Scenario: the no-clobber collaboration drill, viewed through the Attention Overlay.
 * Alice (human) is focused on one cell while a NodeAgent reads a range and a draft/lock land on others.
 * We exercise the box-DERIVING contract (focusBoxesForSheet) — pure logic, no DOM — across the angles
 * the live ?mode=memory demo could not: the provenance invariant (an agent edit must NEVER paint as a
 * human/blue box), conflict/proposal/evidence kinds, self/expiry filtering, range targets, and the BOUND cap.
 */
import { describe, it, expect } from "vitest";
import { focusBoxesForSheet, type SheetCellState } from "../src/ui/overlay/focusBoxesForSheet";
import { MAX_FOCUS_BOXES, type FocusKind } from "../src/ui/overlay/types";
import type { PresenceClaim } from "../src/app/store";

const NOW = 1_000_000;
const claim = (over: Partial<PresenceClaim> & { targetId: string; mode: PresenceClaim["mode"]; actor: PresenceClaim["actor"] }): PresenceClaim =>
  ({ id: `${over.actor.id}:${over.targetId}:${over.mode}`, roomId: "r", artifactId: "a", targetKind: "cell", label: undefined, color: undefined, updatedAt: NOW, expiresAt: NOW + 10_000, ...over } as unknown as PresenceClaim);
const human = { kind: "user" as const, id: "u_alice", name: "Alice" };
const agent = { kind: "agent" as const, id: "a_node", name: "NodeAgent" };
const run = (presence: PresenceClaim[], cellStates: SheetCellState[] = []) =>
  focusBoxesForSheet({ artifactId: "a", now: NOW, meId: "u_me", presence, cellStates });
const kindOf = (boxes: ReturnType<typeof run>, cellRange: string): FocusKind | undefined =>
  boxes.find((b) => b.target.kind === "cellRange" && (b.target as { cellRange: string }).cellRange === cellRange)?.focusKind;

describe("focusBoxesForSheet — Attention Overlay box derivation", () => {
  it("happy path: human focus is blue (user_focus), agent read is amber (agent_read)", () => {
    const boxes = run([
      claim({ targetId: "C2", mode: "focus", actor: human }),
      claim({ targetId: "A1:C5", mode: "agent_intent", actor: agent }),
    ]);
    expect(kindOf(boxes, "C2")).toBe("user_focus");
    expect(boxes.find((b) => b.focusKind === "user_focus")?.actorKind).toBe("human");
    expect(kindOf(boxes, "A1:C5")).toBe("agent_read"); // a range targetId yields ONE box
    expect(boxes.find((b) => b.focusKind === "agent_read")?.actorKind).toBe("agent");
  });

  it("PROVENANCE INVARIANT (P0): an AGENT editing is agent_write (amber), NEVER user_focus (blue)", () => {
    for (const mode of ["edit", "commit_lease"] as const) {
      const [box] = run([claim({ targetId: "B2", mode, actor: agent })]);
      expect(box.focusKind).toBe("agent_write");
      expect(box.actorKind).toBe("agent");
      expect(box.focusKind).not.toBe("user_focus");
    }
    // …and a HUMAN editing is still blue user_focus.
    const [hb] = run([claim({ targetId: "B2", mode: "edit", actor: human })]);
    expect(hb.focusKind).toBe("user_focus");
  });

  it("conflict / proposal / evidence kinds come from cellStates with correct actorKind", () => {
    const boxes = run([], [
      { id: "C2", lockedByOther: true, proposed: false, hasEvidence: false },
      { id: "C3", lockedByOther: false, proposed: true, hasEvidence: false },
      { id: "C4", lockedByOther: false, proposed: false, hasEvidence: true },
    ]);
    expect(kindOf(boxes, "C2")).toBe("conflict");
    expect(kindOf(boxes, "C3")).toBe("proposal");
    expect(boxes.find((b) => b.focusKind === "proposal")?.actorKind).toBe("agent");
    expect(kindOf(boxes, "C4")).toBe("evidence");
  });

  it("excludes self-presence and expired claims (no false 'someone is here')", () => {
    const boxes = run([
      claim({ targetId: "C2", mode: "focus", actor: { kind: "user", id: "u_me", name: "Me" } }), // self
      claim({ targetId: "C3", mode: "focus", actor: human, expiresAt: NOW - 1 }), // expired
      claim({ targetId: "C4", mode: "focus", actor: human }), // live, other
    ]);
    expect(boxes.map((b) => (b.target as { cellRange: string }).cellRange)).toEqual(["C4"]);
  });

  it("BOUND: caps at MAX_FOCUS_BOXES and evicts low-priority first (conflict survives a flood of evidence)", () => {
    const flood: SheetCellState[] = Array.from({ length: MAX_FOCUS_BOXES + 50 }, (_, i) => ({
      id: `E${i}`, lockedByOther: false, proposed: false, hasEvidence: true, // evidence = priority 10
    }));
    flood[0] = { id: "X1", lockedByOther: true, proposed: false, hasEvidence: false }; // conflict = priority 30
    const boxes = run([], flood);
    expect(boxes.length).toBe(MAX_FOCUS_BOXES);
    expect(boxes.some((b) => b.focusKind === "conflict")).toBe(true); // high-priority kept
  });
});
