/**
 * In-memory adapter — zero-dependency reference implementation.
 * Implements MemoryStore (passive detection) + MemoryPort (full memory system).
 * Use for testing, demos, and local development.
 */

import type { NoteworthyFinding } from "../core/classifier";
import type { NoteworthyRow } from "../core/dedup";
import type { DismissalEntry } from "../core/dismissalLearner";
import type { AssistivePolicy } from "../core/policyResolver";
import type { MemoryStore, ActivityStatus, ScanInput } from "../core/scanOrchestrator";
import type { NodeMemEpisode } from "../core/types";
import type { NodeMemEntity } from "../core/types";
import type { NodeMemFact, FactStatus } from "../core/types";
import type { NodeMemDecision } from "../core/types";
import type { NodeMemPreference } from "../core/types";
import type { NodeMemProcedure } from "../core/types";
import type { NodeMemFailurePattern } from "../core/types";
import type { NodeMemFeedback } from "../core/types";
import type { NodeMemContextPack } from "../core/types";

interface StoredRow extends NoteworthyRow {
  finding?: NoteworthyFinding;
  reason?: string;
  text?: string;
  visibility: string;
  ownerId?: string;
  createdAt: number;
}

interface StoredDismissal extends DismissalEntry {}

interface StoredPolicy extends AssistivePolicy {}

export class InMemoryAdapter implements MemoryStore {
  private rows = new Map<string, StoredRow>();
  private dismissals = new Map<string, StoredDismissal[]>();
  private policies = new Map<string, StoredPolicy>();
  private nextId = 0;

  private episodes = new Map<string, NodeMemEpisode>();
  private episodesBySource = new Map<string, NodeMemEpisode[]>();
  private entities = new Map<string, NodeMemEntity>();
  private facts = new Map<string, NodeMemFact>();
  private decisions = new Map<string, NodeMemDecision>();
  private preferences = new Map<string, NodeMemPreference>();
  private procedures = new Map<string, NodeMemProcedure>();
  private failures = new Map<string, NodeMemFailurePattern>();
  private feedback = new Map<string, NodeMemFeedback[]>();
  private contextPacks = new Map<string, NodeMemContextPack>();

  insertActivity(input: Omit<ScanInput, "id">): string {
    const id = `row-${++this.nextId}`;
    const row: StoredRow = {
      id,
      roomId: input.roomId,
      status: "queued",
      entityNames: [],
      updatedAt: Date.now(),
      createdAt: Date.now(),
      visibility: input.visibility,
      ownerId: input.ownerId,
    };
    this.rows.set(id, row);
    return id;
  }

  getRow(id: string): StoredRow | undefined {
    return this.rows.get(id);
  }

  listNoteworthyRows(roomId: string): StoredRow[] {
    return [...this.rows.values()]
      .filter((r) => r.roomId === roomId && r.status === "noteworthy")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async patchRow(
    id: string,
    patch: { status: ActivityStatus; finding?: NoteworthyFinding; reason?: string; updatedAt: number },
  ): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.status = patch.status;
    if (patch.finding) {
      row.finding = patch.finding;
      row.entityNames = patch.finding.entities.map((e) => e.displayName);
    }
    if (patch.reason) row.reason = patch.reason;
    row.updatedAt = patch.updatedAt;
  }

  async listNoteworthy(roomId: string, limit = 50): Promise<NoteworthyRow[]> {
    return this.listNoteworthyRows(roomId)
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        roomId: r.roomId,
        status: r.status,
        entityNames: r.entityNames,
        updatedAt: r.updatedAt,
        finding: r.finding,
      }));
  }

  async countNoteworthyLastHour(roomId: string): Promise<number> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return this.listNoteworthyRows(roomId).filter((r) => r.updatedAt >= oneHourAgo).length;
  }

  async isEntityDismissed(roomId: string, entityNames: string[]): Promise<boolean> {
    if (!entityNames.length) return false;
    const dismissed = this.dismissals.get(roomId) ?? [];
    const dismissedSet = new Set(dismissed.map((d) => d.entityName.toLowerCase().trim()));
    return entityNames.some((name) => dismissedSet.has(name.toLowerCase().trim()));
  }

  async recordDismissal(roomId: string, entityNames: string[], dismissedBy: string): Promise<void> {
    const existing = this.dismissals.get(roomId) ?? [];
    const now = Date.now();
    for (const name of entityNames) {
      const key = name.toLowerCase().trim();
      const existingEntry = existing.find((d) => d.entityName === key);
      if (existingEntry) {
        existingEntry.dismissedBy = dismissedBy;
        existingEntry.dismissedAt = now;
        existingEntry.dismissCount++;
      } else {
        existing.push({ roomId, entityName: key, dismissedBy, dismissedAt: now, dismissCount: 1 });
      }
    }
    this.dismissals.set(roomId, existing);
  }

  async listDismissed(roomId: string): Promise<DismissalEntry[]> {
    return [...(this.dismissals.get(roomId) ?? [])];
  }

  async getRoomPolicy(roomId: string): Promise<AssistivePolicy | null> {
    return this.policies.get(roomId) ?? null;
  }

  async setRoomPolicy(roomId: string, policy: Omit<AssistivePolicy, "source">): Promise<void> {
    this.policies.set(roomId, { ...policy, source: "room_policy" });
  }

  clear(): void {
    this.rows.clear();
    this.dismissals.clear();
    this.policies.clear();
    this.nextId = 0;
    this.episodes.clear();
    this.episodesBySource.clear();
    this.entities.clear();
    this.facts.clear();
    this.decisions.clear();
    this.preferences.clear();
    this.procedures.clear();
    this.failures.clear();
    this.feedback.clear();
    this.contextPacks.clear();
  }

  getAllRows(): StoredRow[] {
    return [...this.rows.values()];
  }

  // --- EpisodeStore ---

  async appendEpisode(episode: NodeMemEpisode): Promise<string> {
    this.episodes.set(episode.id, episode);
    const key = `${episode.sourceKind}:${episode.sourceId}`;
    const list = this.episodesBySource.get(key) ?? [];
    list.push(episode);
    this.episodesBySource.set(key, list);
    return episode.id;
  }

  async getEpisode(id: string): Promise<NodeMemEpisode | null> {
    return this.episodes.get(id) ?? null;
  }

  async listEpisodesByRoom(roomId: string, limit = 50): Promise<NodeMemEpisode[]> {
    return [...this.episodes.values()]
      .filter((e) => e.roomId === roomId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async listEpisodesBySource(sourceKind: string, sourceId: string): Promise<NodeMemEpisode[]> {
    return this.episodesBySource.get(`${sourceKind}:${sourceId}`) ?? [];
  }

  // --- EntityStore ---

  async upsertEntity(entity: NodeMemEntity): Promise<void> {
    this.entities.set(entity.id, entity);
  }

  async getEntity(id: string): Promise<NodeMemEntity | null> {
    return this.entities.get(id) ?? null;
  }

  async listEntitiesByRoom(roomId: string): Promise<NodeMemEntity[]> {
    return [...this.entities.values()].filter((e) => e.roomId === roomId);
  }

  async listEntitiesByKeys(roomId: string, entityKeys: string[]): Promise<NodeMemEntity[]> {
    const roomEntities = await this.listEntitiesByRoom(roomId);
    const keySet = new Set(entityKeys);
    return roomEntities.filter((e) => keySet.has(e.id) || keySet.has(e.canonicalName.toLowerCase()));
  }

  // --- FactStore ---

  async insertFact(fact: NodeMemFact): Promise<void> {
    this.facts.set(fact.id, fact);
  }

  async getFact(id: string): Promise<NodeMemFact | null> {
    return this.facts.get(id) ?? null;
  }

  async updateFactStatus(id: string, status: FactStatus, validTo?: number): Promise<void> {
    const fact = this.facts.get(id);
    if (!fact) return;
    fact.status = status;
    if (validTo !== undefined) fact.validTo = validTo;
    fact.updatedAt = Date.now();
  }

  async listFactsByRoom(roomId?: string): Promise<NodeMemFact[]> {
    const all = [...this.facts.values()];
    if (!roomId) return all;
    return all.filter((f) => f.roomId === roomId);
  }

  async listFactsByEntity(roomId: string, subjectEntityId: string): Promise<NodeMemFact[]> {
    return [...this.facts.values()].filter(
      (f) => f.roomId === roomId && f.subjectEntityId === subjectEntityId,
    );
  }

  async listFactsByKeys(roomId?: string, entityKeys?: string[]): Promise<NodeMemFact[]> {
    let facts = await this.listFactsByRoom(roomId);
    if (entityKeys?.length) {
      const keySet = new Set(entityKeys);
      facts = facts.filter((f) => keySet.has(f.subjectEntityId));
    }
    return facts;
  }

  // --- DecisionStore ---

  async recordDecision(decision: NodeMemDecision): Promise<void> {
    this.decisions.set(decision.id, decision);
  }

  async listDecisions(roomId?: string, limit = 10): Promise<NodeMemDecision[]> {
    const all = [...this.decisions.values()].sort((a, b) => b.createdAt - a.createdAt);
    if (!roomId) return all.slice(0, limit);
    return all.filter((d) => d.roomId === roomId).slice(0, limit);
  }

  // --- PreferenceStore ---

  async recordPreference(pref: NodeMemPreference): Promise<void> {
    this.preferences.set(pref.id, pref);
  }

  async listPreferences(userId?: string, roomId?: string): Promise<NodeMemPreference[]> {
    let prefs = [...this.preferences.values()];
    if (userId) prefs = prefs.filter((p) => p.userId === userId);
    if (roomId) prefs = prefs.filter((p) => p.scope === "room" || p.scope === "workspace");
    return prefs;
  }

  // --- ProcedureStore ---

  async recordProcedure(proc: NodeMemProcedure): Promise<void> {
    this.procedures.set(proc.id, proc);
  }

  async listProcedures(): Promise<NodeMemProcedure[]> {
    return [...this.procedures.values()];
  }

  // --- FailureStore ---

  async recordFailure(failure: NodeMemFailurePattern): Promise<void> {
    this.failures.set(failure.id, failure);
  }

  async listFailures(limit = 10): Promise<NodeMemFailurePattern[]> {
    return [...this.failures.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  // --- FeedbackStore ---

  async recordFeedback(fb: NodeMemFeedback): Promise<void> {
    const key = `${fb.targetKind}:${fb.targetId}`;
    const list = this.feedback.get(key) ?? [];
    list.push(fb);
    this.feedback.set(key, list);
  }

  async listFeedbackByTarget(targetKind: string, targetId: string): Promise<NodeMemFeedback[]> {
    return this.feedback.get(`${targetKind}:${targetId}`) ?? [];
  }

  // --- ContextPackStore ---

  async saveContextPack(pack: NodeMemContextPack): Promise<void> {
    this.contextPacks.set(pack.packId, pack);
  }

  async getContextPack(packId: string): Promise<NodeMemContextPack | null> {
    return this.contextPacks.get(packId) ?? null;
  }
}
