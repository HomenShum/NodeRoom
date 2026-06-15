import type { Artifact, Proposal } from "../engine/types";

export interface RoomOpenTarget {
  artifactId: string;
  elementId?: string;
  source: "artifact" | "proposal";
}

export function resolveRoomOpenTarget(input: {
  id: string;
  artifacts: Pick<Artifact, "id">[];
  proposals: Pick<Proposal, "id" | "artifactId" | "op">[];
}): RoomOpenTarget | null {
  const artifact = input.artifacts.find((item) => item.id === input.id);
  if (artifact) return { artifactId: artifact.id, source: "artifact" };

  const proposal = input.proposals.find((item) => item.id === input.id);
  if (!proposal) return null;
  const proposalArtifact = input.artifacts.find((item) => item.id === proposal.artifactId);
  if (!proposalArtifact) return null;
  const elementId = proposal.op.kind === "set" || proposal.op.kind === "create" || proposal.op.kind === "delete"
    ? proposal.op.elementId
    : undefined;
  return { artifactId: proposalArtifact.id, elementId, source: "proposal" };
}
