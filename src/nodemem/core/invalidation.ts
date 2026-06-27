/**
 * Invalidation — memory lifecycle management.
 * Facts are invalidated or superseded, not silently overwritten.
 */

import type { NodeMemFact, FactStatus } from "./types";

export interface InvalidationStore {
  getFact(id: string): Promise<NodeMemFact | null>;
  updateFactStatus(id: string, status: FactStatus, validTo?: number): Promise<void>;
  listFactsByEntity(roomId: string, subjectEntityId: string): Promise<NodeMemFact[]>;
}

export type InvalidationReason =
  | "newer_source_contradicts"
  | "user_dismissed"
  | "fact_expired"
  | "room_privacy_changed"
  | "source_deleted"
  | "entity_renamed"
  | "artifact_superseded"
  | "architecture_changed"
  | "benchmark_failed";

export async function supersedeFact(
  store: InvalidationStore,
  oldFactId: string,
  _newFactId: string,
  _reason: InvalidationReason,
  now = Date.now(),
): Promise<void> {
  await store.updateFactStatus(oldFactId, "superseded", now);
}

export async function rejectFact(
  store: InvalidationStore,
  factId: string,
  _reason: InvalidationReason,
  now = Date.now(),
): Promise<void> {
  await store.updateFactStatus(factId, "rejected", now);
}

export async function expireFact(
  store: InvalidationStore,
  factId: string,
  now = Date.now(),
): Promise<void> {
  await store.updateFactStatus(factId, "superseded", now);
}

export async function supersedeContradictingFacts(
  store: InvalidationStore,
  roomId: string,
  newFact: { subjectEntityId: string; predicate: string; id: string },
  now = Date.now(),
): Promise<string[]> {
  const existing = await store.listFactsByEntity(roomId, newFact.subjectEntityId);
  const contradicting = existing.filter(
    (f) =>
      f.predicate === newFact.predicate &&
      f.id !== newFact.id &&
      (f.status === "source_backed" || f.status === "manual" || f.status === "graph_inferred" || f.status === "needs_review"),
  );
  const supersededIds: string[] = [];
  for (const f of contradicting) {
    await store.updateFactStatus(f.id, "superseded", now);
    supersededIds.push(f.id);
  }
  return supersededIds;
}
