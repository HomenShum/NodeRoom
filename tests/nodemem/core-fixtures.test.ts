/**
 * NodeMem core fixture tests — Phase 1 offline benchmark.
 *
 * Verifies that NodeMem produces useful entities and facts
 * from realistic room transcripts, WITHOUT any Convex or LLM calls.
 *
 * Covers the modules the production NodeMem path (convex/nodemem.ts,
 * convex/nodememCompile.ts) uses: classifier, memoryCompiler,
 * retrievalPlanner, evidenceMemory, freshness.
 *
 * Gate criteria:
 * - Entity precision: correct company/person detection
 * - Entity recall: no missed entities in rich text
 * - Fact quality: correct predicates, appropriate status
 * - Evidence vs graph-only partitioning
 */

import { describe, it, expect } from "vitest";
import { classifyNoteworthy, normalizeEntityKey } from "../../src/nodemem/core/classifier";
import { compileEpisode, mergeEntities } from "../../src/nodemem/core/memoryCompiler";
import { planRetrieval, rankFacts } from "../../src/nodemem/core/retrievalPlanner";
import { partitionByEvidence } from "../../src/nodemem/core/evidenceMemory";
import { filterValidFacts, computeFreshnessSummary } from "../../src/nodemem/core/freshness";
import type { NodeMemEpisode } from "../../src/nodemem/core/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROOM_ID = "room_test_001";
const USER_ID = "user_test_001";

type EpisodeInput = Omit<NodeMemEpisode, "id" | "contentHash" | "createdAt">;

const FIXTURE_EPISODES: EpisodeInput[] = [
  {
    roomId: ROOM_ID,
    actorId: USER_ID,
    sourceKind: "chat",
    sourceId: "msg_001",
    visibility: "room",
    rawText: "UpscaleX is in Palo Alto. Talked to Mark Liu about their Series A and enterprise customers.",
  },
  {
    roomId: ROOM_ID,
    actorId: USER_ID,
    sourceKind: "chat",
    sourceId: "msg_002",
    visibility: "room",
    rawText: "Need their past events, companies they've been in touch with, and people backgrounds for the diligence sheet.",
  },
  {
    roomId: ROOM_ID,
    actorId: USER_ID,
    sourceKind: "notebook",
    sourceId: "note_001",
    visibility: "room",
    rawText: "UpscaleX is a B2B SaaS company. Product: AI-powered sales enablement. Competitors: Gong, Clari. Pricing: enterprise tier.",
  },
  {
    roomId: ROOM_ID,
    actorId: USER_ID,
    sourceKind: "spreadsheet",
    sourceId: "cell_003",
    visibility: "room",
    rawText: "UpscaleX funding: $15M Series A led by Andreessen Horowitz. Headcount: 45. ARR: $2M.",
  },
  {
    roomId: ROOM_ID,
    actorId: USER_ID,
    sourceKind: "source_capture",
    sourceId: "src_001",
    visibility: "room",
    rawText: "https://techcrunch.com/2025/03/15/upscalex-series-a — UpscaleX raises $15M Series A led by a16z for AI sales tools.",
  },
];

function fixtureEpisode(index: number): NodeMemEpisode {
  return { ...FIXTURE_EPISODES[index], id: `ep_fixture_${index}`, contentHash: `fixture_${index}`, createdAt: 0 };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NodeMem classifier", () => {
  it("detects company entity from capitalized multi-word name", () => {
    const f = classifyNoteworthy("UpscaleX is in Palo Alto. Talked to Mark Liu about their Series A.");
    expect(f.entities.length).toBeGreaterThan(0);
    const upscalex = f.entities.find((e) => e.displayName === "UpscaleX");
    expect(upscalex).toBeDefined();
    expect(upscalex!.type).toBe("company");
    expect(f.score).toBeGreaterThanOrEqual(0.35);
  });

  it("detects finance signal from funding keywords", () => {
    const f = classifyNoteworthy("They just raised Series A funding.");
    expect(f.signals).toContain("finance_signal");
    expect(f.facets).toContain("funding");
  });

  it("detects person interaction signal", () => {
    const f = classifyNoteworthy("Talked to Mark Liu from UpscaleX.");
    expect(f.signals).toContain("person_or_interaction");
  });

  it("detects research signal from product keywords", () => {
    const f = classifyNoteworthy("UpscaleX product is AI-powered sales enablement.");
    expect(f.signals).toContain("research_signal");
  });

  it("detects source URL", () => {
    const f = classifyNoteworthy("https://techcrunch.com/2025/03/15/upscalex-series-a");
    expect(f.signals).toContain("source_url");
  });

  it("ignores plain text with no entities", () => {
    const f = classifyNoteworthy("just checking in, how are things?");
    expect(f.action).toBe("ignore");
    expect(f.score).toBeLessThan(0.35);
  });

  it("filters stop words as entity names", () => {
    const f = classifyNoteworthy("The Next Series of events need follow up.");
    expect(f.entities.find((e) => e.displayName === "The Next Series")).toBeUndefined();
  });

  it("normalizes entity keys deterministically", () => {
    expect(normalizeEntityKey("UpscaleX")).toBe("upscalex");
    expect(normalizeEntityKey("Mark Liu")).toBe("mark-liu");
    expect(normalizeEntityKey("A.B.C Corp")).toBe("a-b-c-corp");
  });
});

describe("NodeMem compilation", () => {
  it("compiles episode into entities + facts", () => {
    const compiled = compileEpisode(fixtureEpisode(0));
    expect(compiled.entities.length).toBeGreaterThan(0);
    const upscalex = compiled.entities.find((e) => e.canonicalName === "UpscaleX");
    expect(upscalex).toBeDefined();
    expect(compiled.facts.length).toBeGreaterThan(0);
    expect(compiled.finding.score).toBeGreaterThanOrEqual(0.35);
  });

  it("merges entities from multiple episodes without duplicates", () => {
    const c1 = compileEpisode(fixtureEpisode(0));
    const c2 = compileEpisode(fixtureEpisode(2));
    const merged = mergeEntities(c1.entities, c2.entities);
    // Both episodes mention UpscaleX, so the merged entity should have 2+ source refs
    const upscalex = merged.find((e) => e.canonicalName === "UpscaleX");
    expect(upscalex).toBeDefined();
    expect(upscalex!.sourceRefs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("NodeMem retrieval + ranking", () => {
  it("classifies company research task from goal", () => {
    const plan = planRetrieval({
      goal: "Research UpscaleX company background and funding",
      userId: USER_ID,
      visibility: "room",
    });
    expect(plan.taskKind).toBe("company_research");
    expect(plan.shelves).toContain("evidence");
    expect(plan.shelves).toContain("temporal_graph");
  });

  it("ranks source-backed facts above manual facts", () => {
    const now = Date.now();
    const facts = [
      { id: "f1", subjectEntityId: "ent1", predicate: "funding", object: "$15M", status: "manual" as const, evidenceFactIds: [], episodeIds: [], confidence: 0.7, createdAt: now, updatedAt: now },
      { id: "f2", subjectEntityId: "ent1", predicate: "funding", object: "$15M Series A", status: "source_backed" as const, evidenceFactIds: ["ev1"], episodeIds: [], confidence: 0.9, createdAt: now, updatedAt: now },
    ];
    const plan = planRetrieval({ goal: "funding", userId: USER_ID, visibility: "room" });
    const ranked = rankFacts(facts, plan, now);
    expect(ranked[0].fact.id).toBe("f2");
    expect(ranked[0].fact.status).toBe("source_backed");
  });

  it("partitions evidence vs graph-only correctly", () => {
    const now = Date.now();
    const facts = [
      { id: "f1", subjectEntityId: "e1", predicate: "p", object: "o", status: "source_backed" as const, evidenceFactIds: ["ev1"], episodeIds: [], confidence: 0.9, createdAt: now, updatedAt: now },
      { id: "f2", subjectEntityId: "e1", predicate: "p", object: "o", status: "needs_review" as const, evidenceFactIds: [], episodeIds: [], confidence: 0.5, createdAt: now, updatedAt: now },
      { id: "f3", subjectEntityId: "e1", predicate: "p", object: "o", status: "rejected" as const, evidenceFactIds: [], episodeIds: [], confidence: 0.1, createdAt: now, updatedAt: now },
    ];
    const { evidence, graphOnly, rejected } = partitionByEvidence(facts);
    expect(evidence.length).toBe(1);
    expect(graphOnly.length).toBe(1);
    expect(rejected.length).toBe(1);
  });
});

describe("NodeMem freshness + validity", () => {
  it("filters valid facts (excludes superseded/rejected)", () => {
    const now = Date.now();
    const facts = [
      { id: "f1", subjectEntityId: "e1", predicate: "p", object: "o", status: "source_backed" as const, evidenceFactIds: ["ev1"], episodeIds: [], confidence: 0.9, createdAt: now, updatedAt: now },
      { id: "f2", subjectEntityId: "e1", predicate: "p", object: "o", status: "superseded" as const, evidenceFactIds: [], episodeIds: [], confidence: 0.1, createdAt: now - 1000, updatedAt: now - 1000 },
    ];
    const valid = filterValidFacts(facts, now);
    expect(valid.length).toBe(1);
    expect(valid[0].id).toBe("f1");
  });

  it("computes freshness summary with stale items", () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago
    const facts = [
      { id: "f1", subjectEntityId: "e1", predicate: "p", object: "o", status: "manual" as const, evidenceFactIds: [], episodeIds: [], confidence: 0.7, createdAt: old, updatedAt: old },
    ];
    const summary = computeFreshnessSummary(facts);
    expect(summary.needsRefresh).toBe(true);
    expect(summary.staleItems).toContain("f1");
  });
});
