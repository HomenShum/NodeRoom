/**
 * Scan orchestrator — ties classifier + dedup + dismissal + policy + quotas.
 * Doctrine: "Notice passively, act explicitly."
 */

import { classifyNoteworthy, type NoteworthyFinding } from "./classifier";
import { findExistingNoteworthyForEntity, roomNoteworthyQuotaExceeded } from "./dedup";
import { isEntityDismissed } from "./dismissalLearner";
import {
  resolveAssistivePolicy,
  isSignalDisabled,
  isEntityWatchlisted,
  type AssistivePolicy,
} from "./policyResolver";
import type { DismissalStore } from "./dismissalLearner";
import type { DedupStore } from "./dedup";
import type { PolicyStore } from "./policyResolver";

export type ActivityStatus =
  | "queued"
  | "running"
  | "scanning"
  | "completed"
  | "ignored"
  | "not_noteworthy"
  | "noteworthy"
  | "job_created"
  | "failed";

export interface ScanResult {
  status: ActivityStatus;
  finding?: NoteworthyFinding;
  reason?: string;
  text?: string;
}

export interface ScanInput {
  id: string;
  roomId: string;
  sourceKind: string;
  sourceId: string;
  sourceHash: string;
  text: string;
  visibility: "private" | "room" | "public";
  ownerId?: string;
}

export interface MemoryStore extends DismissalStore, DedupStore, PolicyStore {
  patchRow(id: string, patch: { status: ActivityStatus; finding?: NoteworthyFinding; reason?: string; updatedAt: number }): Promise<void>;
}

export interface ScanConfig {
  maxPerRoomPerHour?: number;
  systemDefaultPolicy?: Partial<AssistivePolicy>;
}

const DEFAULT_CONFIG: Required<Pick<ScanConfig, "maxPerRoomPerHour">> = {
  maxPerRoomPerHour: 10,
};

export async function scanActivity(
  store: MemoryStore,
  input: ScanInput,
  config?: ScanConfig,
): Promise<ScanResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const text = input.text;
  const finding = classifyNoteworthy(text);

  if (finding.action === "ignore" || finding.score < 0.35) {
    const result: ScanResult = { status: "not_noteworthy", finding, text };
    await store.patchRow(input.id, { status: "not_noteworthy", finding, updatedAt: Date.now() });
    return result;
  }

  const entityNames = finding.entities.map((e) => e.displayName).filter(Boolean);
  const signalKinds = finding.signals;

  const policy = await resolveAssistivePolicy(store, input.roomId, cfg.systemDefaultPolicy);

  if (policy.mode === "off") {
    const result: ScanResult = { status: "not_noteworthy", finding, reason: "policy_off", text };
    await store.patchRow(input.id, { status: "not_noteworthy", finding, reason: "policy_off", updatedAt: Date.now() });
    return result;
  }

  if (isSignalDisabled(policy.disabledSignalKinds, signalKinds)) {
    const result: ScanResult = { status: "not_noteworthy", finding, reason: "signal_disabled_by_policy", text };
    await store.patchRow(input.id, { status: "not_noteworthy", finding, reason: "signal_disabled_by_policy", updatedAt: Date.now() });
    return result;
  }

  if (policy.mode === "approved_watchlist_only" && !isEntityWatchlisted(policy.approvedEntityWatchlist, entityNames)) {
    const result: ScanResult = { status: "not_noteworthy", finding, reason: "not_on_watchlist", text };
    await store.patchRow(input.id, { status: "not_noteworthy", finding, reason: "not_on_watchlist", updatedAt: Date.now() });
    return result;
  }

  if (await roomNoteworthyQuotaExceeded(store, input.roomId, cfg.maxPerRoomPerHour)) {
    const result: ScanResult = { status: "not_noteworthy", finding, reason: "room_quota_exceeded", text };
    await store.patchRow(input.id, { status: "not_noteworthy", finding, reason: "room_quota_exceeded", updatedAt: Date.now() });
    return result;
  }

  if (await findExistingNoteworthyForEntity(store, input.roomId, entityNames, input.id)) {
    const result: ScanResult = { status: "not_noteworthy", finding, reason: "duplicate_entity", text };
    await store.patchRow(input.id, { status: "not_noteworthy", finding, reason: "duplicate_entity", updatedAt: Date.now() });
    return result;
  }

  if (await isEntityDismissed(store, input.roomId, entityNames)) {
    const result: ScanResult = { status: "not_noteworthy", finding, reason: "previously_dismissed", text };
    await store.patchRow(input.id, { status: "not_noteworthy", finding, reason: "previously_dismissed", updatedAt: Date.now() });
    return result;
  }

  const result: ScanResult = { status: "noteworthy", finding, text };
  await store.patchRow(input.id, { status: "noteworthy", finding, updatedAt: Date.now() });
  return result;
}
