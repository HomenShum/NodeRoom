/**
 * ContextPack assembler — builds task-shaped ContextPacks from stored memories.
 *
 * This is the "retrieval + assembly" step: query memories → rank → assemble.
 * The ContextPack is the agent's memory interface: it carries evidence,
 * graph facts, decisions, preferences, procedures, failure patterns,
 * and open questions — all with provenance.
 */

import type {
  NodeMemContextPack,
  NodeMemEntity,
  NodeMemFact,
  NodeMemDecision,
  NodeMemPreference,
  NodeMemProcedure,
  NodeMemFailurePattern,
  ContextPackEvidence,
  ContextPackGraphFact,
  ContextPackPermissions,
  ContextPackFreshness,
  ContextPackLiveState,
  RetrievalTraceEntry,
  Visibility,
  TaskKind,
} from "./types";
import type { MemoryPort } from "../ports/memoryPort";
import { planRetrieval, rankFacts, type RetrievalRequest, type ScoredFact } from "./retrievalPlanner";
import { partitionByEvidence, classifyConfidence } from "./evidenceMemory";
import { computeFreshnessSummary } from "./freshness";
import { sha256HexShort } from "./hash";

/** Actions allowed by task kind. */
const ALLOWED_ACTIONS: Record<TaskKind, string[]> = {
  company_research: ["fetch_source", "write_cell", "write_note", "create_entity", "record_evidence"],
  spreadsheet_edit: ["write_cell", "write_formula", "claim_lock", "release_lock"],
  evidence_capture: ["fetch_source", "record_evidence", "write_note"],
  architecture_change: ["read_schema", "propose_change", "write_note"],
  qa_debug: ["run_test", "read_log", "write_note", "propose_fix"],
  product_design: ["write_note", "create_mockup", "propose_change"],
  coding_agent_handoff: ["write_note", "read_code", "write_code", "run_test"],
  general: ["write_note"],
};

/** Actions prohibited by task kind. */
const PROHIBITED_ACTIONS: Record<TaskKind, string[]> = {
  company_research: ["delete_entity", "overwrite_fact"],
  spreadsheet_edit: ["delete_artifact", "create_entity"],
  evidence_capture: ["delete_evidence", "overwrite_fact"],
  architecture_change: ["delete_schema", "force_deploy"],
  qa_debug: ["deploy_fix", "delete_test"],
  product_design: ["delete_mockup", "force_deploy"],
  coding_agent_handoff: ["deploy_code", "delete_branch"],
  general: ["delete_anything"],
};

export interface AssembleContextPackArgs {
  port: MemoryPort;
  request: RetrievalRequest;
  liveState?: ContextPackLiveState;
  now?: number;
}

/**
 * Assemble a ContextPack from stored memories.
 *
 * Steps:
 * 1. Plan retrieval (task classification + multi-lane plan)
 * 2. Query entities by keys (if provided)
 * 3. Query facts by entity keys (or all room facts)
 * 4. Rank + filter facts by task relevance
 * 5. Partition into evidence vs graph-only
 * 6. Query decisions, preferences, procedures, failures
 * 7. Compute freshness
 * 8. Build permissions (visibility filtering)
 * 9. Assemble final ContextPack
 */
export async function assembleContextPack(
  args: AssembleContextPackArgs,
): Promise<NodeMemContextPack> {
  const { port, request, liveState = {}, now = Date.now() } = args;

  // 1. Plan retrieval
  const plan = planRetrieval(request);
  const trace: RetrievalTraceEntry[] = [];

  // 2. Query entities
  let entities: NodeMemEntity[] = [];
  if (request.entityKeys?.length && request.roomId) {
    entities = await port.listEntitiesByKeys(request.roomId, request.entityKeys);
    trace.push({
      retriever: "exact",
      query: request.entityKeys.join(", "),
      resultIds: entities.map((e) => e.id),
      reason: "Direct entity key lookup",
    });
  } else if (request.roomId) {
    entities = await port.listEntitiesByRoom(request.roomId);
    trace.push({
      retriever: "bm25",
      query: request.goal,
      resultIds: entities.map((e) => e.id),
      reason: "All room entities",
    });
  }

  // 3. Query facts
  let facts: NodeMemFact[] = [];
  if (request.roomId) {
    facts = await port.listFactsByKeys(request.roomId, request.entityKeys);
    trace.push({
      retriever: "bm25",
      query: request.goal,
      resultIds: facts.map((f) => f.id),
      reason: "Facts by entity keys or room",
    });
  }

  // 4. Rank facts
  const scoredFacts: ScoredFact[] = rankFacts(facts, plan, now);
  const rankedFacts = scoredFacts.map((s) => s.fact);

  // 5. Partition by evidence
  const { evidence, graphOnly } = partitionByEvidence(rankedFacts);

  // 6. Build evidence entries
  const evidenceEntries: ContextPackEvidence[] = evidence.map((fact) => ({
    factId: fact.id,
    label: fact.predicate,
    value: fact.object,
    sourceRefs: fact.evidenceFactIds,
    confidence: classifyConfidence(fact),
  }));

  // 7. Build graph fact entries (flagged as needs_review)
  const graphFactEntries: ContextPackGraphFact[] = graphOnly.map((fact) => ({
    factId: fact.id,
    statement: `${fact.predicate}: ${fact.object}`,
    status: fact.status,
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    provenance: fact.episodeIds,
  }));

  // 8. Query decisions, preferences, procedures, failures
  const decisions: NodeMemDecision[] = request.roomId
    ? await port.listDecisions(request.roomId, 5)
    : [];
  const preferences: NodeMemPreference[] = await port.listPreferences(request.userId, request.roomId);
  const procedures: NodeMemProcedure[] = await port.listProcedures();
  const failures: NodeMemFailurePattern[] = await port.listFailures(5);

  // 9. Compute freshness
  const freshness: ContextPackFreshness = computeFreshnessSummary(rankedFacts, { now });

  // 10. Build permissions
  const includedVisibility: Visibility[] = request.visibility === "public"
    ? ["public", "room"]
    : request.visibility === "room"
      ? ["public", "room", "private"]
      : ["public", "room", "private", "system"];
  const permissions: ContextPackPermissions = {
    userId: request.userId,
    roomId: request.roomId,
    includedVisibility,
    excludedReasons: [],
  };

  // 11. Open questions from graph-only facts
  const openQuestions = graphOnly
    .filter((f) => f.status === "needs_review")
    .map((f) => `Verify: ${f.predicate} for ${f.subjectEntityId}`)
    .slice(0, 5);

  // 12. Assemble
  const packId = await sha256HexShort(
    JSON.stringify({
      goal: request.goal,
      taskKind: plan.taskKind,
      entityCount: entities.length,
      factCount: rankedFacts.length,
      now,
    }),
    32,
  );

  return {
    packId: `cp_${packId}`,
    goal: request.goal,
    taskKind: plan.taskKind,
    generatedAt: now,
    freshness,
    permissions,
    liveState,
    evidence: evidenceEntries,
    graphFacts: graphFactEntries,
    decisions,
    preferences,
    procedures,
    failuresToAvoid: failures,
    openQuestions,
    allowedActions: ALLOWED_ACTIONS[plan.taskKind] ?? ALLOWED_ACTIONS.general,
    prohibitedActions: PROHIBITED_ACTIONS[plan.taskKind] ?? PROHIBITED_ACTIONS.general,
    retrievalTrace: trace,
  };
}
