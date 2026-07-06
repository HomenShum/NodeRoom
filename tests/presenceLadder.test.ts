/**
 * presenceLadder — the pure ladder primitive behind cursor presence on the sheet:
 * 1 cursor = flag · 2–3 = stacked flags · 4+ = cluster count (design-reference/scale,
 * "Presence at scale"). panels/Artifact.tsx integrates it next wave; these tests pin
 * the thresholds, dedupe, determinism, and scale bounds it must hold there.
 *
 * Scenario: a 120-person diligence room is enriching one Company-research grid.
 * Bankers hover the same hot cells (focus), a couple of them edit, the NodeAgent
 * holds agent_intent/commit_lease claims, stale claims expire mid-render, and a
 * burst drops 500 claims on one cell. The ladder must stay honest (distinct-actor
 * counts), deterministic (same set → same order), and bounded (capped previews).
 */
import { describe, expect, it } from "vitest";
import { ladderFor, LADDER_MEMBER_CAP, LADDER_STACK_MAX, AGENT_PRESENCE_TTL_MS } from "../src/ui/presenceLadder";
import type { PresenceClaim } from "../src/app/store";

const NOW = 1_750_000_000_000;

function claim(over: Partial<PresenceClaim> & { actorId: string; targetId: string }): PresenceClaim {
  const { actorId, ...rest } = over;
  return {
    id: `${actorId}:${over.targetId}:${over.mode ?? "focus"}`,
    roomId: "room-1",
    artifactId: "art-research",
    targetKind: "cell",
    mode: "focus",
    actor: { kind: "user", id: actorId, name: `Name ${actorId}` },
    updatedAt: NOW - 1000,
    expiresAt: NOW + 60_000,
    ...rest,
  } as PresenceClaim;
}

describe("ladderFor — thresholds (1 flag · 2–3 stack · 4+ cluster)", () => {
  it("one fresh cursor renders as a FLAG carrying that member's identity and color", () => {
    const claims = [claim({ actorId: "u-priya", targetId: "sr_0004__owner", color: "#D97757", mode: "focus" })];
    const out = ladderFor(claims, "sr_0004__owner", NOW);
    expect(out.mode).toBe("flag");
    expect(out.count).toBe(1);
    expect(out.members).toHaveLength(1);
    expect(out.members[0]).toMatchObject({ id: "u-priya", name: "Name u-priya", kind: "user", color: "#D97757", mode: "focus" });
  });

  it("fades an agent's presence once it moves on, but keeps a fresh one and never fades humans", () => {
    const target = "sr_0004__owner";
    // Post-write: NodeAgent's claim on this cell is server-valid (long TTL) but
    // it last touched the cell well past the display-freshness window → fades.
    const staleAgent = claim({
      actorId: "agent-node", targetId: target, mode: "commit_lease",
      actor: { kind: "agent", id: "agent-node", name: "Room NodeAgent" },
      updatedAt: NOW - AGENT_PRESENCE_TTL_MS - 1, expiresAt: NOW + 120_000,
    });
    expect(ladderFor([staleAgent], target, NOW).mode).toBe("none");

    // A fresh agent claim (still within the window) DOES show.
    const freshAgent = { ...staleAgent, updatedAt: NOW - 2_000 };
    expect(ladderFor([freshAgent], target, NOW).mode).toBe("flag");

    // A human's stale-but-unexpired claim is NOT faded — people stay live until their own TTL.
    const staleHuman = claim({ actorId: "u-priya", targetId: target, updatedAt: NOW - AGENT_PRESENCE_TTL_MS - 5_000, expiresAt: NOW + 120_000 });
    expect(ladderFor([staleHuman], target, NOW).mode).toBe("flag");
  });

  it("an empty / fully-irrelevant claim set is honestly NONE, not a phantom flag", () => {
    expect(ladderFor([], "sr_0004__owner", NOW)).toEqual({ mode: "none", members: [], count: 0 });
    const elsewhere = [claim({ actorId: "u-priya", targetId: "sr_0009__funding" })];
    expect(ladderFor(elsewhere, "sr_0004__owner", NOW).mode).toBe("none");
  });

  it("2 and 3 distinct actors stack; the 4th collapses the stack into a cluster count", () => {
    const target = "sr_0012__funding";
    const two = [claim({ actorId: "u-a", targetId: target }), claim({ actorId: "u-b", targetId: target })];
    expect(ladderFor(two, target, NOW).mode).toBe("stack");

    const three = [...two, claim({ actorId: "u-c", targetId: target })];
    const outThree = ladderFor(three, target, NOW);
    expect(outThree.mode).toBe("stack");
    expect(outThree.count).toBe(LADDER_STACK_MAX);

    const four = [...three, claim({ actorId: "u-d", targetId: target })];
    const outFour = ladderFor(four, target, NOW);
    expect(outFour.mode).toBe("cluster");
    expect(outFour.count).toBe(4);
    expect(outFour.members.length).toBeLessThanOrEqual(LADDER_MEMBER_CAP);
  });

  it("one banker holding focus AND edit on the same cell counts ONCE, with the edit claim winning the preview", () => {
    const target = "sr_0004__owner";
    const claims = [
      claim({ actorId: "u-priya", targetId: target, mode: "focus", updatedAt: NOW - 500 }),
      claim({ actorId: "u-priya", targetId: target, mode: "edit", updatedAt: NOW - 500 }),
    ];
    const out = ladderFor(claims, target, NOW);
    expect(out.mode).toBe("flag");
    expect(out.count).toBe(1);
    expect(out.members[0].mode).toBe("edit");
  });
});

describe("ladderFor — expiry and honesty", () => {
  it("expired claims never count: a cell that WAS crowded decays to the survivors", () => {
    const target = "sr_0005__summary";
    const claims = [
      claim({ actorId: "u-a", targetId: target, expiresAt: NOW - 1 }), // just expired
      claim({ actorId: "u-b", targetId: target, expiresAt: NOW }), // boundary: expiresAt <= now is gone
      claim({ actorId: "u-c", targetId: target, expiresAt: NOW + 5_000 }),
      claim({ actorId: "agent-room", targetId: target, mode: "agent_intent", actor: { kind: "agent", id: "agent-room", name: "Room NodeAgent" }, expiresAt: NOW + 5_000 }),
    ];
    const out = ladderFor(claims, target, NOW);
    expect(out.mode).toBe("stack");
    expect(out.count).toBe(2);
    expect(out.members.map((m) => m.id).sort()).toEqual(["agent-room", "u-c"]);
    expect(out.members.find((m) => m.id === "agent-room")?.kind).toBe("agent");
  });
});

describe("ladderFor — deterministic ordering", () => {
  it("orders freshest-first with actor-id tie-break, and a shuffled input yields the SAME order", () => {
    const target = "sr_0020__status";
    const base = [
      claim({ actorId: "u-maya", targetId: target, updatedAt: NOW - 100 }),
      claim({ actorId: "u-priya", targetId: target, updatedAt: NOW - 50 }),
      claim({ actorId: "u-zed", targetId: target, updatedAt: NOW - 100 }), // ties with maya → id asc
    ];
    const expected = ["u-priya", "u-maya", "u-zed"];
    expect(ladderFor(base, target, NOW).members.map((m) => m.id)).toEqual(expected);
    const shuffled = [base[2], base[0], base[1]];
    expect(ladderFor(shuffled, target, NOW).members.map((m) => m.id)).toEqual(expected);
  });

  it("is pure: the input claim array is never mutated or reordered", () => {
    const target = "sr_0001__company";
    const claims = [
      claim({ actorId: "u-b", targetId: target, updatedAt: NOW - 10 }),
      claim({ actorId: "u-a", targetId: target, updatedAt: NOW - 5 }),
    ];
    const snapshot = JSON.stringify(claims);
    ladderFor(claims, target, NOW);
    expect(JSON.stringify(claims)).toBe(snapshot);
  });
});

describe("ladderFor — adversarial + scale (burst and sustained)", () => {
  it("burst: 500 claims stampeding ONE cell stay bounded — honest count, capped member preview", () => {
    const target = "sr_0004__owner";
    const claims: PresenceClaim[] = [];
    for (let i = 0; i < 500; i++) {
      claims.push(claim({ actorId: `u-${String(i % 250).padStart(3, "0")}`, targetId: target, updatedAt: NOW - (i % 97) }));
    }
    const out = ladderFor(claims, target, NOW);
    expect(out.mode).toBe("cluster");
    expect(out.count).toBe(250); // distinct actors, not raw claim volume
    expect(out.members).toHaveLength(LADDER_MEMBER_CAP);
  });

  it("sustained: sweeping 500 claims spread over 100 cells resolves every cell correctly (5 actors each → cluster)", () => {
    const claims: PresenceClaim[] = [];
    for (let cell = 0; cell < 100; cell++) {
      for (let a = 0; a < 5; a++) {
        claims.push(claim({ actorId: `u-${cell}-${a}`, targetId: `sr_${cell}__owner`, updatedAt: NOW - a }));
      }
    }
    for (let cell = 0; cell < 100; cell++) {
      const out = ladderFor(claims, `sr_${cell}__owner`, NOW);
      expect(out.mode).toBe("cluster");
      expect(out.count).toBe(5);
      expect(out.members).toHaveLength(LADDER_MEMBER_CAP);
    }
  });

  it("malformed claims (missing actor) are skipped instead of crashing the render path", () => {
    const target = "sr_0004__owner";
    const claims = [
      { ...claim({ actorId: "u-ok", targetId: target }), actor: undefined } as unknown as PresenceClaim,
      claim({ actorId: "u-priya", targetId: target }),
    ];
    const out = ladderFor(claims, target, NOW);
    expect(out.mode).toBe("flag");
    expect(out.members[0].id).toBe("u-priya");
  });
});
