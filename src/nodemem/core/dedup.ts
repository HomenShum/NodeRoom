/**
 * Dedup + quota — prevents duplicate noteworthy suggestions for the same entity.
 */

import type { NoteworthyFinding } from "./classifier";

export interface NoteworthyRow {
  id: string;
  roomId: string;
  status: string;
  entityNames: string[];
  updatedAt: number;
  finding?: NoteworthyFinding;
}

export interface DedupStore {
  listNoteworthy(roomId: string, limit?: number): Promise<NoteworthyRow[]>;
  countNoteworthyLastHour(roomId: string): Promise<number>;
}

export const FEED_STALENESS_MS = 2 * 24 * 60 * 60 * 1000;

export async function findExistingNoteworthyForEntity(
  store: DedupStore,
  roomId: string,
  entityNames: string[],
  excludeId?: string,
): Promise<boolean> {
  if (!entityNames.length) return false;
  const rows = await store.listNoteworthy(roomId, 50);
  const cutoff = Date.now() - FEED_STALENESS_MS;
  const entitySet = new Set(entityNames.map((e) => e.toLowerCase().trim()));
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    if (row.updatedAt < cutoff) continue;
    const existingEntities = row.entityNames.map((e) => e.toLowerCase().trim()).filter(Boolean);
    if (existingEntities.some((e) => entitySet.has(e))) return true;
  }
  return false;
}

export async function roomNoteworthyQuotaExceeded(
  store: DedupStore,
  roomId: string,
  maxPerHour: number,
): Promise<boolean> {
  const count = await store.countNoteworthyLastHour(roomId);
  return count >= maxPerHour;
}
