import { describe, expect, it } from "vitest";
import {
  toNodeSlidePrincipalFromVerifiedActor,
  type VerifiedNodeRoomActorForNodeSlide,
} from "../src/integrations/nodeslide/hostPrincipal";

describe("NodeRoom NodeSlide host principal adapter", () => {
  it("normalizes a verified host without replacing NodeRoom auth", () => {
    const principal = toNodeSlidePrincipalFromVerifiedActor({
      actor: { kind: "user", id: "user:host", name: "Host" },
      membershipRole: "host",
      hostAuthVerified: true,
      allowDeckWrites: true,
    });

    expect(principal).toEqual({
      userId: "user:host",
      roles: ["noderoom:host"],
      permissions: ["nodeslide:read", "nodeslide:propose", "nodeslide:write"],
    });
  });

  it("keeps write authority opt-in for a verified agent", () => {
    const principal = toNodeSlidePrincipalFromVerifiedActor({
      actor: {
        kind: "agent",
        id: "agent:private-reviewer",
        name: "Private reviewer",
        scope: "private",
        ownerId: "user:host",
      },
      membershipRole: "member",
      hostAuthVerified: true,
    });

    expect(principal.roles).toEqual(["noderoom:agent:private"]);
    expect(principal.permissions).toEqual(["nodeslide:read", "nodeslide:propose"]);
  });

  it("fails closed if callers bypass the verified-host precondition", () => {
    const unverified = {
      actor: { kind: "user", id: "user:unknown", name: "Unknown" },
      membershipRole: "member",
      hostAuthVerified: false,
    } as unknown as VerifiedNodeRoomActorForNodeSlide;

    expect(() => toNodeSlidePrincipalFromVerifiedActor(unverified)).toThrow(
      "verified NodeRoom host auth",
    );
  });
});
