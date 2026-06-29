/**
 * Memory compiler — extracts entities, facts, and claims from episodes.
 *
 * Uses the deterministic classifier for entity/signal detection,
 * then promotes findings into structured memory objects.
 *
 * This is the "extraction pipeline" step: raw episode → candidate memories.
 */

import { classifyNoteworthy, normalizeEntityKey } from "./classifier";
import type { NoteworthyFinding } from "./classifier";
import type {
  NodeMemEpisode,
  NodeMemEntity,
  NodeMemFact,
  EntityKind,
  FactStatus,
} from "./types";

export interface CompiledMemories {
  entities: NodeMemEntity[];
  facts: NodeMemFact[];
  finding: NoteworthyFinding;
}

/** Map classifier entity type to NodeMem entity kind. */
function mapEntityKind(classifierType: string): EntityKind {
  if (classifierType === "person") return "person";
  if (classifierType === "company") return "company";
  return "concept";
}

/** Map classifier action to initial fact status. */
function mapFactStatus(action: string): FactStatus {
  if (action === "start_research_job") return "needs_review";
  if (action === "create_coach_cue") return "manual";
  if (action === "index_only") return "manual";
  return "manual";
}

/**
 * Compile an episode into candidate entities + facts.
 * This is pure: same episode → same candidates.
 */
export function compileEpisode(
  episode: NodeMemEpisode,
  now = Date.now(),
): CompiledMemories {
  const text = episode.rawText ?? "";
  const finding = classifyNoteworthy(text);

  const entities: NodeMemEntity[] = finding.entities.map((e) => ({
    id: `ent_${normalizeEntityKey(e.displayName)}_${episode.roomId ?? "global"}`,
    workspaceId: episode.workspaceId,
    roomId: episode.roomId,
    kind: mapEntityKind(e.type),
    canonicalName: e.displayName,
    aliases: [],
    summary: "",
    confidence: e.confidence,
    lastSeenAt: now,
    sourceRefs: [episode.id],
  }));

  const facts: NodeMemFact[] = [];

  // Entity mention fact
  if (entities.length > 0) {
    const primary = entities[0];
    facts.push({
      id: `fact_${primary.id}_mention_${now.toString(36)}`,
      workspaceId: episode.workspaceId,
      roomId: episode.roomId,
      subjectEntityId: primary.id,
      predicate: "mentioned_in",
      object: episode.sourceKind,
      status: mapFactStatus(finding.action),
      episodeIds: [episode.id],
      evidenceFactIds: [],
      confidence: finding.score,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Finance signal fact
  if (finding.signals.includes("finance_signal") && entities.length > 0) {
    const primary = entities[0];
    facts.push({
      id: `fact_${primary.id}_finance_${now.toString(36)}`,
      workspaceId: episode.workspaceId,
      roomId: episode.roomId,
      subjectEntityId: primary.id,
      predicate: "has_finance_signal",
      object: finding.evidenceSpans.find((s) => s.signal === "finance_signal")?.text ?? "",
      status: "needs_review",
      episodeIds: [episode.id],
      evidenceFactIds: [],
      confidence: 0.8,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Person interaction fact
  if (finding.signals.includes("person_or_interaction") && entities.length > 0) {
    const primary = entities[0];
    facts.push({
      id: `fact_${primary.id}_person_${now.toString(36)}`,
      workspaceId: episode.workspaceId,
      roomId: episode.roomId,
      subjectEntityId: primary.id,
      predicate: "person_interaction",
      object: finding.evidenceSpans.find((s) => s.signal === "person_or_interaction")?.text ?? "",
      status: "manual",
      episodeIds: [episode.id],
      evidenceFactIds: [],
      confidence: 0.75,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Research signal fact
  if (finding.signals.includes("research_signal") && entities.length > 0) {
    const primary = entities[0];
    facts.push({
      id: `fact_${primary.id}_research_${now.toString(36)}`,
      workspaceId: episode.workspaceId,
      roomId: episode.roomId,
      subjectEntityId: primary.id,
      predicate: "has_research_signal",
      object: finding.evidenceSpans.find((s) => s.signal === "research_signal")?.text ?? "",
      status: "needs_review",
      episodeIds: [episode.id],
      evidenceFactIds: [],
      confidence: 0.7,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { entities, facts, finding };
}

/**
 * Merge newly compiled entities with existing ones (dedupe by canonical name).
 */
export function mergeEntities(
  existing: NodeMemEntity[],
  newEntities: NodeMemEntity[],
  now = Date.now(),
): NodeMemEntity[] {
  const byKey = new Map<string, NodeMemEntity>();
  for (const e of existing) byKey.set(e.id, e);
  for (const ne of newEntities) {
    const prev = byKey.get(ne.id);
    if (prev) {
      byKey.set(ne.id, {
        ...prev,
        aliases: [...new Set([...prev.aliases, ...ne.aliases])],
        sourceRefs: [...new Set([...prev.sourceRefs, ...ne.sourceRefs])],
        confidence: Math.max(prev.confidence, ne.confidence),
        lastSeenAt: now,
      });
    } else {
      byKey.set(ne.id, ne);
    }
  }
  return [...byKey.values()];
}
