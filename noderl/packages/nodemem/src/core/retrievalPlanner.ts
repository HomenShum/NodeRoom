/**
 * Retrieval planner — task classifier + multi-lane retrieval planning.
 */

import type {
  TaskKind,
  MemoryShelf,
  RetrieverKind,
  NodeMemFact,
  Visibility,
} from "./types";

export interface RetrievalRequest {
  goal: string;
  roomId?: string;
  userId: string;
  entityKeys?: string[];
  taskKind?: TaskKind;
  asOf?: number;
  visibility: Visibility;
  maxFacts?: number;
}

export interface RetrievalPlan {
  taskKind: TaskKind;
  shelves: MemoryShelf[];
  retrievers: RetrieverLane[];
  maxFacts: number;
}

export interface RetrieverLane {
  kind: RetrieverKind;
  query: string;
  reason: string;
}

/** Classify the task kind from the goal string. */
export function classifyTask(goal: string): TaskKind {
  const lower = goal.toLowerCase();
  if (/debug|error|fail|regression|fix|bug/.test(lower)) return "qa_debug";
  if (/research|diligence|company|portfolio|background/.test(lower)) return "company_research";
  if (/spreadsheet|cell|formula|model|financial/.test(lower)) return "spreadsheet_edit";
  if (/evidence|source|capture|verify|cite/.test(lower)) return "evidence_capture";
  if (/architecture|schema|system|refactor|dependency/.test(lower)) return "architecture_change";
  if (/design|ui|ux|layout|component/.test(lower)) return "product_design";
  if (/handoff|resume|continue|session|branch/.test(lower)) return "coding_agent_handoff";
  return "general";
}

/** Determine which memory shelves are relevant for a task kind. */
export function shelvesForTask(taskKind: TaskKind): MemoryShelf[] {
  switch (taskKind) {
    case "company_research":
      return ["working", "recent", "evidence", "temporal_graph", "preference", "procedural"];
    case "spreadsheet_edit":
      return ["working", "recent", "structural", "evidence"];
    case "evidence_capture":
      return ["working", "evidence", "procedural"];
    case "architecture_change":
      return ["working", "recent", "structural", "historical"];
    case "qa_debug":
      return ["working", "recent", "structural", "historical"];
    case "product_design":
      return ["working", "recent", "preference", "persona"];
    case "coding_agent_handoff":
      return ["working", "recent", "structural", "historical", "procedural"];
    default:
      return ["working", "recent"];
  }
}

/** Build a retrieval plan for a request. */
export function planRetrieval(request: RetrievalRequest): RetrievalPlan {
  const taskKind = request.taskKind ?? classifyTask(request.goal);
  const shelves = shelvesForTask(taskKind);
  const maxFacts = request.maxFacts ?? 30;

  const retrievers: RetrieverLane[] = [];

  if (request.entityKeys?.length) {
    retrievers.push({
      kind: "exact",
      query: request.entityKeys.join(", "),
      reason: "Direct entity key lookup for mentioned entities",
    });
  }

  retrievers.push({
    kind: "bm25",
    query: request.goal,
    reason: "Keyword match over room notes and episode text",
  });

  if (shelves.includes("evidence") || shelves.includes("temporal_graph")) {
    retrievers.push({
      kind: "semantic",
      query: request.goal,
      reason: "Semantic similarity over source captures and evidence",
    });
  }

  if (shelves.includes("temporal_graph")) {
    retrievers.push({
      kind: "graph",
      query: request.entityKeys?.join(", ") ?? request.goal,
      reason: "Relationship traversal for people, companies, events",
    });
  }

  if (shelves.includes("recent")) {
    retrievers.push({
      kind: "recent",
      query: request.roomId ?? "",
      reason: "Recent operational memory: last runs, errors, handoffs",
    });
  }

  retrievers.push({
    kind: "filter",
    query: `visibility:${request.visibility}`,
    reason: "Policy filter: exclude memories not visible to this actor",
  });

  return { taskKind, shelves, retrievers, maxFacts };
}

/** Score and rank retrieved facts by task relevance. */
export interface ScoredFact {
  fact: NodeMemFact;
  reason: string;
  risk: "low" | "medium" | "high";
}

export function rankFacts(
  facts: NodeMemFact[],
  plan: RetrievalPlan,
  now = Date.now(),
): ScoredFact[] {
  const scored: ScoredFact[] = facts.map((fact) => {
    const reasons: string[] = [];
    let risk: "low" | "medium" | "high" = "low";

    if (fact.status === "source_backed") {
      reasons.push("Source-backed with evidence references");
    } else if (fact.status === "graph_inferred") {
      reasons.push("Graph-inferred — needs review");
      risk = "medium";
    } else if (fact.status === "needs_review") {
      reasons.push("Needs review — no evidence backing");
      risk = "medium";
    } else if (fact.status === "manual") {
      reasons.push("Manual claim — user-supplied, unverified");
      risk = "medium";
    } else if (fact.status === "superseded") {
      reasons.push("Superseded by newer information");
      risk = "high";
    }

    const age = now - fact.updatedAt;
    if (age > 30 * 24 * 60 * 60 * 1000) {
      reasons.push("Stale — older than 30 days");
      risk = risk === "high" ? "high" : "medium";
    }

    if (fact.confidence >= 0.8) {
      reasons.push(`High confidence (${fact.confidence.toFixed(2)})`);
    } else if (fact.confidence < 0.5) {
      reasons.push(`Low confidence (${fact.confidence.toFixed(2)})`);
      risk = risk === "high" ? "high" : "medium";
    }

    return {
      fact,
      reason: reasons.join("; "),
      risk,
    };
  });

  const statusOrder: Record<string, number> = {
    source_backed: 0,
    manual: 1,
    graph_inferred: 2,
    needs_review: 3,
    superseded: 4,
    rejected: 5,
  };

  scored.sort((a, b) => {
    const sa = statusOrder[a.fact.status] ?? 99;
    const sb = statusOrder[b.fact.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return b.fact.confidence - a.fact.confidence;
  });

  return scored.slice(0, plan.maxFacts);
}
