/**
 * Assistive policy resolver — resolves the effective policy for a room.
 */

export type AssistiveMode =
  | "off"
  | "suggestions_only"
  | "ask_before_research"
  | "approved_watchlist_only";

export const MODE_RESTRICTION_ORDER: AssistiveMode[] = [
  "off",
  "approved_watchlist_only",
  "ask_before_research",
  "suggestions_only",
];

export interface AssistivePolicy {
  mode: AssistiveMode;
  allowExternalCalls: boolean;
  maxSuggestionsPerHour: number;
  maxApprovedBackgroundJobsPerDay: number;
  disabledSignalKinds: string[];
  approvedEntityWatchlist: string[];
  source: "system_default" | "room_policy";
}

export interface PolicyStore {
  getRoomPolicy(roomId: string): Promise<AssistivePolicy | null>;
  setRoomPolicy(roomId: string, policy: Omit<AssistivePolicy, "source">): Promise<void>;
}

export const SYSTEM_DEFAULT_POLICY: AssistivePolicy = {
  mode: "suggestions_only",
  allowExternalCalls: true,
  maxSuggestionsPerHour: 10,
  maxApprovedBackgroundJobsPerDay: 5,
  disabledSignalKinds: [],
  approvedEntityWatchlist: [],
  source: "system_default",
};

export async function resolveAssistivePolicy(
  store: PolicyStore,
  roomId: string,
  systemDefault?: Partial<AssistivePolicy>,
): Promise<AssistivePolicy> {
  const system: AssistivePolicy = { ...SYSTEM_DEFAULT_POLICY, ...systemDefault };
  const roomPolicy = await store.getRoomPolicy(roomId);
  if (!roomPolicy) return system;

  const systemIdx = MODE_RESTRICTION_ORDER.indexOf(system.mode);
  const roomIdx = MODE_RESTRICTION_ORDER.indexOf(roomPolicy.mode);
  const effectiveMode =
    systemIdx <= roomIdx ? system.mode : roomPolicy.mode;

  return {
    mode: effectiveMode,
    allowExternalCalls: roomPolicy.allowExternalCalls && system.allowExternalCalls,
    maxSuggestionsPerHour: Math.min(roomPolicy.maxSuggestionsPerHour, system.maxSuggestionsPerHour),
    maxApprovedBackgroundJobsPerDay: Math.min(roomPolicy.maxApprovedBackgroundJobsPerDay, system.maxApprovedBackgroundJobsPerDay),
    disabledSignalKinds: [...new Set([...roomPolicy.disabledSignalKinds, ...system.disabledSignalKinds])],
    approvedEntityWatchlist: roomPolicy.approvedEntityWatchlist,
    source: "room_policy",
  };
}

export function isSignalDisabled(disabledKinds: string[], signalKinds: string[]): boolean {
  if (!disabledKinds.length) return false;
  return signalKinds.some((k) => disabledKinds.includes(k));
}

export function isEntityWatchlisted(watchlist: string[], entityNames: string[]): boolean {
  if (!watchlist.length) return false;
  const lowerWatch = new Set(watchlist.map((w) => w.toLowerCase().trim()));
  return entityNames.some((e) => lowerWatch.has(e.toLowerCase().trim()));
}

export function signalFingerprintHash(params: {
  sourceKind: string;
  signalKind: string;
  entityKind?: string;
}): string {
  return [params.sourceKind, params.signalKind, params.entityKind ?? "unknown"].join("|");
}
