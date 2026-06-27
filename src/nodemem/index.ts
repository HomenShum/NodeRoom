/**
 * NodeMem — barrel export.
 *
 * Provenance-first memory control plane.
 * Passive detection + full memory system (episodes, entities, facts, ContextPacks).
 */

// Core types
export * from "./core/types";

// Core modules
export { classifyNoteworthy, normalizeEntityKey, CLASSIFIER_VERSION, SIGNAL } from "./core/classifier";
export type { NoteworthyFinding, EntityDetection, EvidenceSpan, NoteworthyAction, Signal, EntityType } from "./core/classifier";

export { createEpisode, appendEpisode, episodeContentHash, isDuplicateEpisode } from "./core/episodeLog";
export type { EpisodeInput, EpisodeStore } from "./core/episodeLog";

export { compileEpisode, mergeEntities } from "./core/memoryCompiler";
export type { CompiledMemories } from "./core/memoryCompiler";

export { assembleContextPack } from "./core/contextAssembler";
export type { AssembleContextPackArgs } from "./core/contextAssembler";

export { planRetrieval, classifyTask, shelvesForTask, rankFacts } from "./core/retrievalPlanner";
export type { RetrievalRequest, RetrievalPlan, RetrieverLane, ScoredFact } from "./core/retrievalPlanner";

export { isSourceBacked, isGraphOnly, canBeFinalEvidence, classifyConfidence, filterFinalEvidence, partitionByEvidence, promoteToSourceBacked, demoteToNeedsReview } from "./core/evidenceMemory";

export { isFactValid, isFactStale, freshnessLevel, filterValidFacts, partitionByFreshness, computeFreshnessSummary } from "./core/freshness";

export { supersedeFact, rejectFact, expireFact, supersedeContradictingFacts } from "./core/invalidation";
export type { InvalidationStore, InvalidationReason } from "./core/invalidation";

export { findExistingNoteworthyForEntity, roomNoteworthyQuotaExceeded } from "./core/dedup";
export type { NoteworthyRow, DedupStore } from "./core/dedup";

export { activityDedupeKey } from "./core/dedupeKey";
export type { SourceKind, EventKind, ActivityDedupeArgs, ActivityEvent } from "./core/dedupeKey";

export { isEntityDismissed, isEntityDismissedSync } from "./core/dismissalLearner";
export type { DismissalEntry, DismissalStore } from "./core/dismissalLearner";

export { resolveAssistivePolicy, isSignalDisabled, isEntityWatchlisted, signalFingerprintHash, SYSTEM_DEFAULT_POLICY } from "./core/policyResolver";
export type { AssistiveMode, AssistivePolicy, PolicyStore } from "./core/policyResolver";

export { scanActivity } from "./core/scanOrchestrator";
export type { ScanResult, ScanInput, MemoryStore, ScanConfig, ActivityStatus } from "./core/scanOrchestrator";

export { computeDebounce, clampQuietMs } from "./core/debouncer";
export type { DebounceState } from "./core/debouncer";

export { sha256Hex, sha256HexShort } from "./core/hash";

// Ports
export type { MemoryPort, EpisodeStore as PEpisodeStore, EntityStore, FactStore, DecisionStore, PreferenceStore, ProcedureStore, FailureStore, FeedbackStore, ContextPackStore } from "./ports/memoryPort";

// Adapters
export { InMemoryAdapter } from "./adapters/inMemoryAdapter";

// Memory context builder (Phase 3 — system prompt injection)
export { buildMemorySystemContext, injectMemoryIntoSystemPrompt, estimateContextPackTokens } from "./memoryContextBuilder";
export type { MemoryContextOptions } from "./memoryContextBuilder";
