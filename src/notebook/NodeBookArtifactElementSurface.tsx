import type { ReactNode } from "react";
import type { Artifact } from "../engine/types";
import { NodeRoomNodeBookArtifactPanel } from "./NodeBookArtifactPanel";
import { decodeNodeBookVisualEnvelope, NODEBOOK_VISUAL_ELEMENT_ID } from "./visualArtifactEnvelope";

export function NodeBookArtifactElementSurface({
  roomId,
  artifact,
  fallback,
}: {
  roomId: string;
  artifact: Artifact;
  fallback: ReactNode;
}) {
  if (artifact.roomId !== roomId) {
    return (
      <div className="r-nodebook-artifact-error" role="alert" data-testid="nodebook-artifact-envelope-error" data-error-code="ROOM_SCOPE_MISMATCH">
        <strong>NodeBook artifact unavailable</strong>
        <span>The selected artifact does not belong to this room.</span>
      </div>
    );
  }
  const element = artifact.elements[NODEBOOK_VISUAL_ELEMENT_ID];
  const decoded = decodeNodeBookVisualEnvelope(element?.value, {
    artifactId: artifact.id,
    title: artifact.title,
    version: element?.version ?? 0,
  });

  if (decoded.status === "absent") return <>{fallback}</>;
  if (decoded.status === "invalid") {
    return (
      <div className="r-nodebook-artifact-error" role="alert" data-testid="nodebook-artifact-envelope-error" data-error-code={decoded.errorCode}>
        <strong>NodeBook artifact unavailable</strong>
        <span>{decoded.message}</span>
      </div>
    );
  }

  return (
    <div className="r-nodebook-artifact" data-testid="nodebook-artifact-surface">
      <NodeRoomNodeBookArtifactPanel roomId={roomId} {...decoded.artifact} />
    </div>
  );
}
