import { describe, expect, it } from "vitest";
import {
  assertCredentialFreeNodeSlideValue,
  authorizeNodeRoomNodeSlideOperation,
  nodeRoomNodeSlideOperation,
} from "../src/integrations/nodeslide/hostAuthorization";
import { toNodeSlidePrincipalFromVerifiedActor } from "../src/integrations/nodeslide/hostPrincipal";

const host = { kind: "user" as const, id: "member:host", name: "Maya" };
const member = { kind: "user" as const, id: "member:guest", name: "Riley" };
const room = { id: "room:1", status: "live" as const, autoAllow: false };
const artifact = {
  id: "artifact:deck",
  roomId: room.id,
  visibility: "room" as const,
  createdBy: host,
  meta: { tags: ["noderoom:deck"] },
};

function principal(actor = host, role: "host" | "member" = "host") {
  return toNodeSlidePrincipalFromVerifiedActor({
    actor,
    membershipRole: role,
    hostAuthVerified: true,
    allowDeckWrites: role === "host",
  });
}

describe("NodeRoom production NodeSlide authorization policy", () => {
  it("binds operation-v1 reads and writes to verified membership and opaque evidence", () => {
    const read = authorizeNodeRoomNodeSlideOperation({
      operation: nodeRoomNodeSlideOperation({ action: "deck.read", deckId: artifact.id, principal: principal() }),
      verifiedActor: host,
      member: { ...host, role: "host", roomId: room.id },
      room,
      artifact,
      evidenceId: "trace:read-1",
    });
    expect(read).toMatchObject({
      membershipRole: "host",
      routePolicy: "member_read",
      writePolicy: "artifact_cas",
      evidence: {
        issuer: "noderoom",
        policyId: "noderoom.nodeslide.artifact-authority",
        policyVersion: "1",
        evidenceId: "trace:read-1",
      },
    });
    expect(JSON.stringify(read.evidence)).not.toMatch(/token|requester|actorProof/i);

    const write = authorizeNodeRoomNodeSlideOperation({
      operation: nodeRoomNodeSlideOperation({ action: "patch.apply", deckId: artifact.id, principal: principal(), resourceId: "patch:1" }),
      verifiedActor: host,
      member: { ...host, role: "host", roomId: room.id },
      room,
      artifact,
    });
    expect(write.routePolicy).toBe("host_write");
  });

  it("allows a member to read and propose but not apply, approve, or forge grants", () => {
    const memberPrincipal = principal(member, "member");
    const common = {
      verifiedActor: member,
      member: { ...member, role: "member" as const, roomId: room.id },
      room,
      artifact,
    };
    expect(authorizeNodeRoomNodeSlideOperation({
      ...common,
      operation: nodeRoomNodeSlideOperation({ action: "proposal.create", deckId: artifact.id, principal: memberPrincipal, resourceId: "proposal:1" }),
    }).routePolicy).toBe("member_proposal");
    expect(() => authorizeNodeRoomNodeSlideOperation({
      ...common,
      operation: nodeRoomNodeSlideOperation({ action: "patch.apply", deckId: artifact.id, principal: memberPrincipal, resourceId: "patch:1" }),
    })).toThrow("nodeslide_host_required");

    const forged = { ...memberPrincipal, permissions: [...memberPrincipal.permissions, "nodeslide:write"] };
    expect(() => authorizeNodeRoomNodeSlideOperation({
      ...common,
      operation: nodeRoomNodeSlideOperation({ action: "deck.read", deckId: artifact.id, principal: forged as typeof memberPrincipal }),
    })).toThrow("nodeslide_principal_permissions_untrusted");
  });

  it("rejects deck-scope mismatches, private cross-owner reads, ended rooms, and credential fields", () => {
    const operation = nodeRoomNodeSlideOperation({ action: "deck.read", deckId: artifact.id, principal: principal() });
    const common = {
      operation,
      verifiedActor: host,
      member: { ...host, role: "host" as const, roomId: room.id },
      room,
      artifact,
    };
    expect(() => authorizeNodeRoomNodeSlideOperation({ ...common, artifact: { ...artifact, id: "artifact:other" } })).toThrow("nodeslide_deck_scope_mismatch");
    expect(() => authorizeNodeRoomNodeSlideOperation({ ...common, room: { ...room, status: "ended" as const } })).toThrow("nodeslide_room_not_live");
    expect(() => authorizeNodeRoomNodeSlideOperation({ ...common, artifact: { ...artifact, visibility: "private", createdBy: member } })).toThrow("nodeslide_artifact_not_visible");
    expect(() => assertCredentialFreeNodeSlideValue({ evidence: { token: "do-not-store" } })).toThrow("credential_field_forbidden");
  });
});
