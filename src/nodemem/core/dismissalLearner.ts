/**
 * Dismissal learner — tracks entities that users have dismissed.
 */

export interface DismissalEntry {
  roomId: string;
  entityName: string;
  dismissedBy: string;
  dismissedAt: number;
  dismissCount: number;
}

export interface DismissalStore {
  isEntityDismissed(roomId: string, entityNames: string[]): Promise<boolean>;
  recordDismissal(roomId: string, entityNames: string[], dismissedBy: string): Promise<void>;
  listDismissed(roomId: string): Promise<DismissalEntry[]>;
}

export function isEntityDismissedSync(
  dismissed: Set<string>,
  entityNames: string[],
): boolean {
  if (!entityNames.length) return false;
  return entityNames.some((name) => dismissed.has(name.toLowerCase().trim()));
}

export async function isEntityDismissed(
  store: DismissalStore,
  roomId: string,
  entityNames: string[],
): Promise<boolean> {
  if (!entityNames.length) return false;
  return store.isEntityDismissed(roomId, entityNames);
}
