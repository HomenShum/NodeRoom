import type { Artifact, Proposal } from "../engine/types";

export interface RoomOpenTarget {
  artifactId: string;
  elementId?: string;
  source: "artifact" | "proposal";
}

export const OPT_ARTIFACT_PREFIX = "opt-art-";

export function optimisticArtifactIdentity(id: string): { kind: string; title: string } | null {
  if (!id.startsWith(OPT_ARTIFACT_PREFIX)) return null;
  const rest = id.slice(OPT_ARTIFACT_PREFIX.length);
  const sep = rest.indexOf("-");
  if (sep <= 0) return null;
  return { kind: rest.slice(0, sep), title: rest.slice(sep + 1) };
}

export function resolveRoomOpenTarget(input: {
  id: string;
  artifacts: Array<Pick<Artifact, "id"> & Partial<Pick<Artifact, "kind" | "title">>>;
  proposals: Pick<Proposal, "id" | "artifactId" | "op">[];
}): RoomOpenTarget | null {
  const artifact = input.artifacts.find((item) => item.id === input.id);
  if (artifact) return { artifactId: artifact.id, source: "artifact" };

  const optimistic = optimisticArtifactIdentity(input.id);
  if (optimistic) {
    const real = input.artifacts.find((item) =>
      !String(item.id).startsWith(OPT_ARTIFACT_PREFIX) &&
      item.kind === optimistic.kind &&
      item.title === optimistic.title
    );
    if (real) return { artifactId: real.id, source: "artifact" };
  }

  const proposal = input.proposals.find((item) => item.id === input.id);
  if (!proposal) return null;
  const proposalArtifact = input.artifacts.find((item) => item.id === proposal.artifactId);
  if (!proposalArtifact) return null;
  const elementId = proposal.op.kind === "set" || proposal.op.kind === "create" || proposal.op.kind === "delete"
    ? proposal.op.elementId
    : undefined;
  return { artifactId: proposalArtifact.id, elementId, source: "proposal" };
}
