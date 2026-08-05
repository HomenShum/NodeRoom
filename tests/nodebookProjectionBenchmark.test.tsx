import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";

import type { Artifact } from "../src/engine/types";
import { projectRoomArtifactsToNodeBook, updateRoomArtifactProjectionCache, type RoomArtifactProjectionCache } from "../src/notebook/NodeBookWorkspaceSurface";

it("measures fresh-array projection churn before and after semantic caching", () => {
const artifacts = Array.from({ length: 500 }, (_, index): Artifact => ({
  id: `artifact-${index}`,
  roomId: "scale-room",
  kind: "note",
  title: `Evidence ${index}`,
  version: 1,
  elements: {},
  order: [],
  updatedAt: 1,
  visibility: "room",
}));
const iterations = 1_000;

let startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) projectRoomArtifactsToNodeBook("scale-room", [...artifacts]);
const beforeMs = performance.now() - startedAt;

let cache: RoomArtifactProjectionCache | undefined;
let reused = 0;
startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) {
  const previous = cache;
  const freshArtifacts = [...artifacts];
  cache = updateRoomArtifactProjectionCache(cache, "scale-room", freshArtifacts);
  if (cache === previous) reused += 1;
}
const afterMs = performance.now() - startedAt;
expect(reused).toBe(iterations - 1);
console.log(JSON.stringify({ scenario: "500 artifacts across 1000 unchanged store renders", beforeMs: Number(beforeMs.toFixed(1)), afterMs: Number(afterMs.toFixed(1)), speedup: Number((beforeMs / afterMs).toFixed(2)), beforeProjections: iterations, afterProjections: 1, cacheReuses: reused }));
});
