import type { ArtifactRef } from "../../core/types";

export function findArtifactByKind(artifacts: ArtifactRef[], kind: string): ArtifactRef[] {
  return artifacts.filter((artifact) => artifact.kind === kind);
}

