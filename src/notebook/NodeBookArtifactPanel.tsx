import { NodeBookArtifactSurface, type NodeBookArtifactSurfaceProps } from "@nodebook/react";

export type NodeRoomNodeBookArtifactPanelProps = NodeBookArtifactSurfaceProps & {
  roomId: string;
};

/** Host adapter: NodeRoom owns room identity; NodeBook owns artifact rendering only. */
export function NodeRoomNodeBookArtifactPanel({ roomId, ...artifact }: NodeRoomNodeBookArtifactPanelProps) {
  return (
    <div data-nodebook-host="noderoom" data-nodebook-workspace-id={roomId}>
      <NodeBookArtifactSurface {...artifact} />
    </div>
  );
}
