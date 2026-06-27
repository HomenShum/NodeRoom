/**
 * Episode log — append-only raw event log with content hashing + dedupe.
 *
 * The episode log is the ground truth. Everything else is derived.
 * No memory without a source episode.
 */

import type { NodeMemEpisode, EpisodeSourceKind, Visibility } from "./types";
import { sha256HexShort } from "./hash";

export interface EpisodeInput {
  workspaceId?: string;
  roomId?: string;
  actorId?: string;
  sourceKind: EpisodeSourceKind;
  sourceId: string;
  sourceVersion?: number;
  visibility: Visibility;
  rawText?: string;
  rawJson?: string;
  artifactRefs?: string[];
}

export interface EpisodeStore {
  appendEpisode(episode: NodeMemEpisode): Promise<string>;
  getEpisode(id: string): Promise<NodeMemEpisode | null>;
  listEpisodesByRoom(roomId: string, limit?: number): Promise<NodeMemEpisode[]>;
  listEpisodesBySource(sourceKind: string, sourceId: string): Promise<NodeMemEpisode[]>;
}

/** Compute a deterministic content hash for an episode. */
export async function episodeContentHash(input: EpisodeInput): Promise<string> {
  const payload = JSON.stringify({
    s: input.sourceKind,
    i: input.sourceId,
    v: input.sourceVersion ?? 0,
    t: input.rawText ?? "",
    j: input.rawJson ?? "",
    a: input.artifactRefs ?? [],
  });
  return sha256HexShort(payload, 32);
}

/** Check if an episode is a duplicate of an existing one by content hash. */
export function isDuplicateEpisode(
  existing: NodeMemEpisode[],
  contentHash: string,
): boolean {
  return existing.some((e) => e.contentHash === contentHash);
}

/** Create a fully-formed episode from input, with generated id + hash. */
export async function createEpisode(input: EpisodeInput, now = Date.now()): Promise<NodeMemEpisode> {
  const contentHash = await episodeContentHash(input);
  const id = `ep_${contentHash}_${now.toString(36)}`;
  return {
    id,
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    actorId: input.actorId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    visibility: input.visibility,
    contentHash,
    rawText: input.rawText,
    rawJson: input.rawJson,
    artifactRefs: input.artifactRefs,
    createdAt: now,
  };
}

/**
 * Append an episode to the store, deduplicating by content hash.
 * Returns the episode id (existing or new).
 */
export async function appendEpisode(
  store: EpisodeStore,
  input: EpisodeInput,
  now = Date.now(),
): Promise<{ id: string; duplicate: boolean }> {
  const contentHash = await episodeContentHash(input);
  const existing = await store.listEpisodesBySource(input.sourceKind, input.sourceId);
  const dup = existing.find((e) => e.contentHash === contentHash);
  if (dup) {
    return { id: dup.id, duplicate: true };
  }
  const episode = await createEpisode(input, now);
  await store.appendEpisode(episode);
  return { id: episode.id, duplicate: false };
}
