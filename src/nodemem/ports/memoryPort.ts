/**
 * Memory port — interfaces for the full NodeMem memory store.
 * Implement with Convex, in-memory, or any backend.
 */

import type {
  NodeMemEpisode,
  NodeMemEntity,
  NodeMemFact,
  NodeMemDecision,
  NodeMemPreference,
  NodeMemProcedure,
  NodeMemFailurePattern,
  NodeMemFeedback,
  NodeMemContextPack,
  FactStatus,
} from "../core/types";

// ─── Episode Store ──────────────────────────────────────────────────────────

export interface EpisodeStore {
  appendEpisode(episode: NodeMemEpisode): Promise<string>;
  getEpisode(id: string): Promise<NodeMemEpisode | null>;
  listEpisodesByRoom(roomId: string, limit?: number): Promise<NodeMemEpisode[]>;
  listEpisodesBySource(sourceKind: string, sourceId: string): Promise<NodeMemEpisode[]>;
}

// ─── Entity Store ───────────────────────────────────────────────────────────

export interface EntityStore {
  upsertEntity(entity: NodeMemEntity): Promise<void>;
  getEntity(id: string): Promise<NodeMemEntity | null>;
  listEntitiesByRoom(roomId: string): Promise<NodeMemEntity[]>;
  listEntitiesByKeys(roomId: string, entityKeys: string[]): Promise<NodeMemEntity[]>;
}

// ─── Fact Store ─────────────────────────────────────────────────────────────

export interface FactStore {
  insertFact(fact: NodeMemFact): Promise<void>;
  getFact(id: string): Promise<NodeMemFact | null>;
  updateFactStatus(id: string, status: FactStatus, validTo?: number): Promise<void>;
  listFactsByRoom(roomId?: string): Promise<NodeMemFact[]>;
  listFactsByEntity(roomId: string, subjectEntityId: string): Promise<NodeMemFact[]>;
  listFactsByKeys(roomId?: string, entityKeys?: string[]): Promise<NodeMemFact[]>;
}

// ─── Decision Store ─────────────────────────────────────────────────────────

export interface DecisionStore {
  recordDecision(decision: NodeMemDecision): Promise<void>;
  listDecisions(roomId?: string, limit?: number): Promise<NodeMemDecision[]>;
}

// ─── Preference Store ───────────────────────────────────────────────────────

export interface PreferenceStore {
  recordPreference(pref: NodeMemPreference): Promise<void>;
  listPreferences(userId?: string, roomId?: string): Promise<NodeMemPreference[]>;
}

// ─── Procedure Store ────────────────────────────────────────────────────────

export interface ProcedureStore {
  recordProcedure(proc: NodeMemProcedure): Promise<void>;
  listProcedures(): Promise<NodeMemProcedure[]>;
}

// ─── Failure Store ──────────────────────────────────────────────────────────

export interface FailureStore {
  recordFailure(failure: NodeMemFailurePattern): Promise<void>;
  listFailures(limit?: number): Promise<NodeMemFailurePattern[]>;
}

// ─── Feedback Store ─────────────────────────────────────────────────────────

export interface FeedbackStore {
  recordFeedback(fb: NodeMemFeedback): Promise<void>;
  listFeedbackByTarget(targetKind: string, targetId: string): Promise<NodeMemFeedback[]>;
}

// ─── ContextPack Store ──────────────────────────────────────────────────────

export interface ContextPackStore {
  saveContextPack(pack: NodeMemContextPack): Promise<void>;
  getContextPack(packId: string): Promise<NodeMemContextPack | null>;
}

// ─── Combined Port ──────────────────────────────────────────────────────────

export interface MemoryPort extends
  EpisodeStore,
  EntityStore,
  FactStore,
  DecisionStore,
  PreferenceStore,
  ProcedureStore,
  FailureStore,
  FeedbackStore,
  ContextPackStore {}
