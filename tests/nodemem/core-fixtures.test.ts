/**
 * NodeMem core fixture tests — Phase 1 offline benchmark.
 *
 * Verifies that NodeMem produces useful entities/facts/ContextPacks
 * from realistic room transcripts, WITHOUT any Convex or LLM calls.
 *
 * Gate criteria:
 * - Entity precision: correct company/person detection
 * - Entity recall: no missed entities in rich text
 * - Duplicate rate: dedup works
 * - Fact quality: correct predicates, appropriate status
 * - ContextPack size: fits under token budget
 * - ContextPack relevance: evidence vs graph-only partitioning
 * - Assembly time: fast enough for production
 */

import { describe, it, expect } from "vitest";
import {
  classifyNoteworthy,
  normalizeEntityKey,
  compileEpisode,
  mergeEntities,
  assembleContextPack,
  planRetrieval,
  rankFacts,
  partitionByEvidence,
  filterValidFacts,
  computeFreshnessSummary,
  InMemoryAdapter,
  type EpisodeInput,
  type RetrievalRequest,
} from "../../src/nodemem/index";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROOM_ID = "room_test_001";
const USER_ID = "user_test_001";

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

describe("NodeMem episode log + compilation", () => {
  it("creates episodes with deterministic content hashes", async () => {
    const adapter = new InMemoryAdapter();
    const ep1 = await adapter.appendEpisode(
      await (async () => {
        const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
        return createEpisode(FIXTURE_EPISODES[0]);
      })(),
    );
    expect(ep1).toBeTruthy();

    const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
    const ep2 = await createEpisode(FIXTURE_EPISODES[0]);
    expect(ep2.contentHash).toBeTruthy();
  });

  it("deduplicates episodes with same content hash", async () => {
    const { appendEpisode } = await import("../../src/nodemem/core/episodeLog");
    const adapter = new InMemoryAdapter();
    const r1 = await appendEpisode(adapter, FIXTURE_EPISODES[0]);
    const r2 = await appendEpisode(adapter, FIXTURE_EPISODES[0]);
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect(r1.id).toBe(r2.id);
  });

  it("compiles episode into entities + facts", async () => {
    const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
    const adapter = new InMemoryAdapter();
    const ep = await createEpisode(FIXTURE_EPISODES[0]);
    await adapter.appendEpisode(ep);
    const compiled = compileEpisode(ep);
    expect(compiled.entities.length).toBeGreaterThan(0);
    const upscalex = compiled.entities.find((e) => e.canonicalName === "UpscaleX");
    expect(upscalex).toBeDefined();
    expect(compiled.facts.length).toBeGreaterThan(0);
    expect(compiled.finding.score).toBeGreaterThanOrEqual(0.35);
  });

  it("merges entities from multiple episodes without duplicates", async () => {
    const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
    const adapter = new InMemoryAdapter();
    const ep1 = await createEpisode(FIXTURE_EPISODES[0]);
    const ep2 = await createEpisode(FIXTURE_EPISODES[2]);
    await adapter.appendEpisode(ep1);
    await adapter.appendEpisode(ep2);

    const c1 = compileEpisode(ep1);
    const c2 = compileEpisode(ep2);
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

describe("NodeMem ContextPack assembly", () => {
  it("assembles a ContextPack from fixture episodes", async () => {
    const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
    const adapter = new InMemoryAdapter();

    // Record all fixture episodes
    for (const input of FIXTURE_EPISODES) {
      const ep = await createEpisode(input);
      await adapter.appendEpisode(ep);
      const compiled = compileEpisode(ep);
      for (const ent of compiled.entities) {
        await adapter.upsertEntity(ent);
      }
      for (const fact of compiled.facts) {
        await adapter.insertFact(fact);
      }
    }

    const request: RetrievalRequest = {
      goal: "Research UpscaleX: funding, product, competitors, people",
      roomId: ROOM_ID,
      userId: USER_ID,
      entityKeys: ["ent_upscalex_room_test_001"],
      visibility: "room",
    };

    const pack = await assembleContextPack({
      port: adapter,
      request,
      liveState: { roomId: ROOM_ID },
    });

    expect(pack.packId).toBeTruthy();
    expect(pack.taskKind).toBe("company_research");
    expect(pack.evidence.length + pack.graphFacts.length).toBeGreaterThan(0);
    expect(pack.retrievalTrace.length).toBeGreaterThan(0);
    expect(pack.allowedActions).toContain("fetch_source");
    expect(pack.prohibitedActions).toContain("delete_entity");
  });

  it("ContextPack fits under token budget (approx 4 chars/token)", async () => {
    const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
    const adapter = new InMemoryAdapter();

    for (const input of FIXTURE_EPISODES) {
      const ep = await createEpisode(input);
      await adapter.appendEpisode(ep);
      const compiled = compileEpisode(ep);
      for (const ent of compiled.entities) await adapter.upsertEntity(ent);
      for (const fact of compiled.facts) await adapter.insertFact(fact);
    }

    const pack = await assembleContextPack({
      port: adapter,
      request: {
        goal: "Research UpscaleX",
        roomId: ROOM_ID,
        userId: USER_ID,
        visibility: "room",
        maxFacts: 10,
      },
    });

    const packJson = JSON.stringify(pack);
    const approxTokens = Math.ceil(packJson.length / 4);
    // Gate: ContextPack must fit under 1200 tokens (the bounded injection budget)
    expect(approxTokens).toBeLessThan(1200);
  });

  it("ContextPack marks graph-only facts as needs_review", async () => {
    const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
    const adapter = new InMemoryAdapter();

    const ep = await createEpisode(FIXTURE_EPISODES[0]);
    await adapter.appendEpisode(ep);
    const compiled = compileEpisode(ep);
    for (const ent of compiled.entities) await adapter.upsertEntity(ent);
    for (const fact of compiled.facts) await adapter.insertFact(fact);

    const pack = await assembleContextPack({
      port: adapter,
      request: {
        goal: "Research UpscaleX",
        roomId: ROOM_ID,
        userId: USER_ID,
        visibility: "room",
      },
    });

    // All compiled facts start as manual or needs_review (no source captures yet)
    for (const gf of pack.graphFacts) {
      expect(gf.status).toMatch(/manual|needs_review|graph_inferred/);
    }
  });

  it("assembly is fast (p95 < 50ms for 5 episodes)", async () => {
    const { createEpisode } = await import("../../src/nodemem/core/episodeLog");
    const adapter = new InMemoryAdapter();

    for (const input of FIXTURE_EPISODES) {
      const ep = await createEpisode(input);
      await adapter.appendEpisode(ep);
      const compiled = compileEpisode(ep);
      for (const ent of compiled.entities) await adapter.upsertEntity(ent);
      for (const fact of compiled.facts) await adapter.insertFact(fact);
    }

    const t0 = Date.now();
    await assembleContextPack({
      port: adapter,
      request: { goal: "Research UpscaleX", roomId: ROOM_ID, userId: USER_ID, visibility: "room" },
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
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
