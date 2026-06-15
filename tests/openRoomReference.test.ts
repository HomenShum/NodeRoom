import { describe, expect, it } from "vitest";
import { resolveRoomOpenTarget } from "../src/ui/openRoomReference";
import type { Artifact, Proposal } from "../src/engine/types";

const artifact = (id: string): Pick<Artifact, "id"> => ({ id });

describe("room open target resolver", () => {
  it("opens direct artifact ids", () => {
    expect(resolveRoomOpenTarget({
      id: "artifact-1",
      artifacts: [artifact("artifact-1")],
      proposals: [],
    })).toEqual({ artifactId: "artifact-1", source: "artifact" });
  });

  it("opens proposal ids by routing to their target artifact and cell", () => {
    const proposals: Pick<Proposal, "id" | "artifactId" | "op">[] = [{
      id: "proposal-1",
      artifactId: "artifact-1",
      op: {
        opId: "op-1",
        artifactId: "artifact-1",
        elementId: "r_rev__variance",
        kind: "set",
        value: "+24%",
        baseVersion: 1,
      },
    }];

    expect(resolveRoomOpenTarget({
      id: "proposal-1",
      artifacts: [artifact("artifact-1")],
      proposals,
    })).toEqual({
      artifactId: "artifact-1",
      elementId: "r_rev__variance",
      source: "proposal",
    });
  });

  it("returns null for stale artifact or proposal references", () => {
    expect(resolveRoomOpenTarget({ id: "missing-artifact", artifacts: [], proposals: [] })).toBeNull();
    expect(resolveRoomOpenTarget({
      id: "proposal-1",
      artifacts: [],
      proposals: [{
        id: "proposal-1",
        artifactId: "deleted-artifact",
        op: { opId: "op-1", artifactId: "deleted-artifact", elementId: "A1", kind: "set", value: "x", baseVersion: 1 },
      }],
    })).toBeNull();
  });
});
