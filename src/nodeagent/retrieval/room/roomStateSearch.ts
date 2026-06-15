import type { AwarenessView, RoomSnapshot } from "../../core/types";

export function summarizeRoomState(snapshot: RoomSnapshot, awareness: AwarenessView): string {
  return `${snapshot.kind}:${snapshot.artifactId}:v${snapshot.version} rows=${snapshot.rows.length} locks=${awareness.activeLocks.length}`;
}

