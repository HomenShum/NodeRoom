import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { loadArtifactPlugin } from "@nodebook/react";
import { sha256Text } from "@nodebook/core/mermaid";

import type { Artifact } from "../src/engine/types";
import { RoomEngine } from "../src/engine/roomEngine";
import { NODEBOOK_DECISION_FLOW_ENVELOPE } from "../src/engine/demoRoom";
import { NodeBookArtifactElementSurface } from "../src/notebook/NodeBookArtifactElementSurface";
import { NODEBOOK_VISUAL_ELEMENT_ID, NODEBOOK_VISUAL_SCHEMA_VERSION } from "../src/notebook/visualArtifactEnvelope";

const actor = { kind: "user" as const, id: "maya", name: "Maya" };

function noteWith(value: unknown, version = 1): Artifact {
  return {
    id: "note-visual-1",
    roomId: "room-shared-1",
    kind: "note",
    title: "Shared decision flow",
    version,
    elements: value === undefined ? {} : {
      [NODEBOOK_VISUAL_ELEMENT_ID]: {
        id: NODEBOOK_VISUAL_ELEMENT_ID,
        value,
        version,
        updatedAt: 1,
        updatedBy: actor,
      },
    },
    order: value === undefined ? [] : [NODEBOOK_VISUAL_ELEMENT_ID],
    updatedAt: 1,
    createdBy: actor,
    visibility: "room",
  };
}

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value() { return (this.textContent?.length ?? 0) * 7; },
  });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value() { return { x: 0, y: 0, width: (this.textContent?.length ?? 0) * 7, height: 16 }; },
  });
});

describe("NodeRoom mounts NodeBook in the real note branch contract", () => {
  it("leaves an ordinary collaborative note on the existing host surface", () => {
    const view = render(<NodeBookArtifactElementSurface roomId="room-shared-1" artifact={noteWith(undefined)} fallback={<div data-testid="existing-note">Existing notebook</div>} />);

    expect(view.getByTestId("existing-note").textContent).toBe("Existing notebook");
    expect(view.queryByTestId("nodebook-artifact-surface")).toBeNull();
  });

  it("renders one package-owned artifact with room identity and the subscribed element version", async () => {
    const payload = "flowchart LR\n  shared[Shared nodes] --> review[Human review]";
    const plugin = await loadArtifactPlugin("mermaid");
    const contentHash = await sha256Text(await plugin.validatePayload(payload));
    const envelope = { schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION, kind: "mermaid", format: "mermaid", payload, contentHash };
    const view = render(<NodeBookArtifactElementSurface roomId="room-shared-1" artifact={noteWith(envelope, 42)} fallback={<div data-testid="existing-note" />} />);

    await waitFor(() => expect(view.container.querySelector("[data-nodebook-artifact-rendered] svg")).not.toBeNull(), { timeout: 15_000 });
    expect(view.container.querySelector('[data-nodebook-host="noderoom"]')?.getAttribute("data-nodebook-workspace-id")).toBe("room-shared-1");
    expect(view.container.querySelector("[data-nodebook-artifact-version]")?.getAttribute("data-nodebook-artifact-version")).toBe("42");
    expect(view.queryByTestId("existing-note")).toBeNull();
  }, 30_000);

  it("shows an honest alert and mounts neither renderer nor note fallback for a malformed reserved envelope", () => {
    const view = render(<NodeBookArtifactElementSurface roomId="room-shared-1" artifact={noteWith({ schemaVersion: "stale" })} fallback={<div data-testid="existing-note" />} />);

    expect(view.getByRole("alert").getAttribute("data-error-code")).toBe("UNSUPPORTED_SCHEMA");
    expect(view.queryByTestId("nodebook-artifact-surface")).toBeNull();
    expect(view.queryByTestId("existing-note")).toBeNull();
  });

  it("fails closed when host and artifact room scopes do not match", () => {
    const view = render(<NodeBookArtifactElementSurface roomId="room-other" artifact={noteWith(undefined)} fallback={<div data-testid="existing-note" />} />);

    expect(view.getByRole("alert").getAttribute("data-error-code")).toBe("ROOM_SCOPE_MISMATCH");
    expect(view.queryByTestId("existing-note")).toBeNull();
  });

  it("keeps a NodeAgent visual proposal non-canonical until a human accepts it, then renders the accepted CAS version", async () => {
    const engine = new RoomEngine();
    const { room, host } = engine.createRoom({ title: "Agent review room", hostName: "Maya", autoAllow: false });
    const hostActor = { kind: "user" as const, id: host.id, name: "Maya" };
    const agent = { kind: "agent" as const, id: "nodeagent-public", name: "Room NodeAgent", scope: "public" as const };
    const note = engine.createArtifact({ roomId: room.id, kind: "note", title: "Agent decision flow", by: hostActor, seed: [] });
    const proposal = engine.applyEdit({
      roomId: room.id,
      actor: agent,
      op: { opId: "agent-flow-v1", artifactId: note.id, elementId: NODEBOOK_VISUAL_ELEMENT_ID, kind: "create", value: NODEBOOK_DECISION_FLOW_ENVELOPE, baseVersion: 0 },
    });

    expect(proposal.ok).toBe(false);
    expect(engine.getArtifact(note.id)?.elements[NODEBOOK_VISUAL_ELEMENT_ID]).toBeUndefined();
    if (proposal.ok || proposal.reason !== "pending_approval") throw new Error("expected pending NodeAgent proposal");

    const rejected = engine.resolveProposal(proposal.proposalId, false, hostActor);
    expect(rejected).toBeNull();
    expect(engine.getArtifact(note.id)?.elements[NODEBOOK_VISUAL_ELEMENT_ID]).toBeUndefined();

    const retry = engine.applyEdit({
      roomId: room.id,
      actor: agent,
      op: { opId: "agent-flow-v2", artifactId: note.id, elementId: NODEBOOK_VISUAL_ELEMENT_ID, kind: "create", value: NODEBOOK_DECISION_FLOW_ENVELOPE, baseVersion: 0 },
    });
    if (retry.ok || retry.reason !== "pending_approval") throw new Error("expected second pending NodeAgent proposal");
    const accepted = engine.resolveProposal(retry.proposalId, true, hostActor);
    expect(accepted?.ok).toBe(true);
    const canonical = engine.getArtifact(note.id)!;
    expect(canonical.elements[NODEBOOK_VISUAL_ELEMENT_ID].version).toBe(1);

    const view = render(<NodeBookArtifactElementSurface roomId={room.id} artifact={canonical} fallback={<div data-testid="existing-note" />} />);
    await waitFor(() => expect(view.container.querySelector("[data-nodebook-artifact-rendered] svg")).not.toBeNull(), { timeout: 15_000 });
    expect(view.container.querySelector("[data-nodebook-artifact-version]")?.getAttribute("data-nodebook-artifact-version")).toBe("1");
  }, 30_000);
});
