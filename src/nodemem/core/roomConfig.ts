// Pure NodeMem per-room config resolution — no Convex imports, so it is unit-testable in isolation.
// The Convex wrapper (convex/nodemem.ts resolveRoomNodeMem) reads the override row, then defers here.

export type NodeMemModeLite = "off" | "shadow" | "active_ab";

/** Default ContextPack token budget when neither a per-room override nor a caller specifies one. */
export const DEFAULT_NODEMEM_MAX_TOKENS = 1200;

export interface RoomNodeMemConfig {
  mode: NodeMemModeLite;
  maxTokens?: number | null;
}

/**
 * Resolve the effective NodeMem mode + token budget for a room.
 * A per-room override row (when present) wins; otherwise fall back to the global mode.
 * Absent override → global behavior, so production rooms (which have no override row) are unaffected.
 */
export function pickRoomNodeMem(
  override: RoomNodeMemConfig | null | undefined,
  globalMode: NodeMemModeLite,
): { mode: NodeMemModeLite; maxTokens: number } {
  if (override) {
    return { mode: override.mode, maxTokens: override.maxTokens ?? DEFAULT_NODEMEM_MAX_TOKENS };
  }
  return { mode: globalMode, maxTokens: DEFAULT_NODEMEM_MAX_TOKENS };
}
