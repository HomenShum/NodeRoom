import { createOkfConcept } from "../concept";
import type { OkfConcept } from "../types";

export function roomToOkfConcept(args: {
  roomId: string;
  title: string;
  artifactIds: string[];
  timestamp: string;
}): OkfConcept {
  return createOkfConcept({
    path: "rooms/current_room.md",
    frontmatter: {
      type: "Room",
      title: args.title,
      description: `NodeRoom live work bundle with ${args.artifactIds.length} artifact(s).`,
      resource: `noderoom://rooms/${args.roomId}`,
      tags: ["room", "noderoom"],
      timestamp: args.timestamp,
      visibility: "public",
      noderoom: { roomId: args.roomId, visibility: "public", targetRefs: args.artifactIds },
    },
    body: `# Artifacts\n${args.artifactIds.map((id) => `* ${id}`).join("\n")}\n`,
  });
}

