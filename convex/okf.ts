import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof } from "./lib";
import { createOkfConcept } from "../src/nodeagent/okf/concept";
import type { OkfCitation, OkfConcept, OkfLink, OkfVisibility } from "../src/nodeagent/okf/types";
import type { ClaimSupportResult, EvidenceRef, LiteralSourceResult, OkfConceptFilter, RetrievalHit } from "../src/nodeagent/retrieval/types";
import { filterOkfConcepts } from "../src/nodeagent/retrieval/okf/okfFilters";
import { rankOkfConcepts, tokenizeForRetrieval } from "../src/nodeagent/retrieval/ranking/hybridRanker";
import { embeddingVector, sha256hex } from "./embeddings";
import { OKF_EMBEDDING_DIMENSION } from "./okfEmbeddingProvider";

const okfVisibilityV = v.union(v.literal("public"), v.literal("private"), v.literal("redacted"));
const filterArgsV = {
  type: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  pathPrefix: v.optional(v.string()),
  status: v.optional(v.string()),
  confidenceMin: v.optional(v.number()),
  timestampAfter: v.optional(v.string()),
  visibility: v.optional(okfVisibilityV),
  limit: v.optional(v.number()),
};
const evidenceRefV = v.object({
  evidenceId: v.string(),
  conceptId: v.optional(v.string()),
  citationId: v.optional(v.string()),
  sourceArtifactId: v.optional(v.string()),
});

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

function cap(limit: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(limit ?? fallback, max));
}

function conceptSearchText(concept: OkfConcept): string {
  return [
    concept.frontmatter.title,
    concept.frontmatter.description,
    concept.frontmatter.type,
    ...(concept.frontmatter.tags ?? []),
    concept.body,
    ...concept.citations.map((c) => `${c.id} ${c.label} ${c.target}`),
  ].filter(Boolean).join("\n");
}

function toConcept(row: {
  conceptId: string;
  path: string;
  frontmatter: unknown;
  body: string;
  links: OkfLink[];
  citations: OkfCitation[];
}): OkfConcept {
  return {
    id: row.conceptId,
    path: row.path,
    frontmatter: row.frontmatter as OkfConcept["frontmatter"],
    body: row.body,
    links: row.links,
    citations: row.citations,
  };
}

function normalizeVisibility(value: unknown): OkfVisibility {
  return value === "private" || value === "redacted" || value === "public" ? value : "public";
}

async function upsertConceptRow(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  concept: OkfConcept;
  sourceKind?: string;
  sourceId?: string;
  sourceVersion?: number;
  provider?: string;
  model?: string;
  createdByJobId?: Id<"agentJobs">;
}) {
  const now = Date.now();
  const searchText = conceptSearchText(args.concept);
  const contentHash = await sha256hex(`${args.concept.path}\n${JSON.stringify(args.concept.frontmatter)}\n${args.concept.body}`);
  const visibility = normalizeVisibility(args.concept.frontmatter.visibility ?? args.concept.frontmatter.noderoom?.visibility);
  const tags = args.concept.frontmatter.tags ?? [];
  const status = args.concept.frontmatter.noderoom?.status;
  const confidence = args.concept.frontmatter.noderoom?.confidence;
  const rowFields = clean({
    roomId: args.roomId,
    conceptId: args.concept.id,
    path: args.concept.path,
    type: String(args.concept.frontmatter.type),
    title: args.concept.frontmatter.title,
    description: args.concept.frontmatter.description,
    body: args.concept.body,
    searchText,
    resource: args.concept.frontmatter.resource,
    tags,
    status,
    confidence,
    visibility,
    frontmatter: args.concept.frontmatter,
    links: args.concept.links,
    citations: args.concept.citations,
    sourceKind: args.sourceKind ?? args.concept.frontmatter.noderoom?.sourceKind,
    sourceId: args.sourceId,
    sourceVersion: args.sourceVersion,
    contentHash,
    provider: args.provider,
    model: args.model,
    createdByJobId: args.createdByJobId,
    updatedAt: now,
  });
  const existing = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", args.roomId).eq("conceptId", args.concept.id)).unique();
  if (existing) {
    await ctx.db.patch(existing._id, rowFields);
  } else {
    await ctx.db.insert("okfConcepts", { ...rowFields, createdAt: now });
  }

  const oldEdges = await ctx.db.query("okfEdges").withIndex("by_from", (q) => q.eq("roomId", args.roomId).eq("fromConceptId", args.concept.id)).collect();
  for (const edge of oldEdges) await ctx.db.delete(edge._id);
  for (const link of args.concept.links) {
    if (!link.conceptId) continue;
    await ctx.db.insert("okfEdges", { roomId: args.roomId, fromConceptId: args.concept.id, toConceptId: link.conceptId, label: link.label, kind: "link", createdAt: now });
  }
  for (const citation of args.concept.citations) {
    if (!citation.conceptId) continue;
    await ctx.db.insert("okfEdges", { roomId: args.roomId, fromConceptId: args.concept.id, toConceptId: citation.conceptId, label: citation.label, kind: "citation", createdAt: now });
  }

  const priorJob = await ctx.db.query("okfOutbox").withIndex("by_room_concept", (q) => q.eq("roomId", args.roomId).eq("conceptId", args.concept.id)).unique();
  if (!priorJob || priorJob.contentHash !== contentHash || priorJob.status === "failed") {
    if (priorJob) {
      await ctx.db.patch(priorJob._id, { contentHash, status: "queued", attempts: 0, nextRunAt: now, leaseId: undefined, leaseUntil: undefined, error: undefined, updatedAt: now });
    } else {
      await ctx.db.insert("okfOutbox", { roomId: args.roomId, conceptId: args.concept.id, contentHash, status: "queued", attempts: 0, nextRunAt: now, createdAt: now, updatedAt: now });
    }
  }
  return { conceptId: args.concept.id, contentHash };
}

async function roomConceptRows(ctx: QueryCtx, roomId: Id<"rooms">, limit = 500) {
  return ctx.db.query("okfConcepts").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(limit);
}

async function filteredConcepts(ctx: QueryCtx, roomId: Id<"rooms">, args: OkfConceptFilter) {
  const rows = await roomConceptRows(ctx, roomId, 800);
  return filterOkfConcepts(rows.map(toConcept), args);
}

function visibleHits(hits: RetrievalHit[], limit?: number) {
  return hits.slice(0, cap(limit, 8, 50));
}

function cosine(a: number[], b: number[]) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

function literalFromConcept(concept: OkfConcept | null, ref: EvidenceRef): LiteralSourceResult {
  if (!concept) return { ok: false, error: "evidence_not_found" };
  const citation = ref.citationId ? concept.citations.find((c) => c.id === ref.citationId) : undefined;
  return {
    ok: true,
    conceptId: concept.id,
    title: concept.frontmatter.title ?? concept.path,
    resource: citation?.target ?? concept.frontmatter.resource,
    snippet: concept.body.slice(0, 900),
    locator: ref.sourceArtifactId ? { row: undefined } : undefined,
  };
}

export async function enqueueArtifactSnapshotForOkf(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  createdByJobId?: Id<"agentJobs">;
}) {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact || String(artifact.roomId) !== String(args.roomId)) return { ok: false as const, reason: "artifact_missing" as const };
  const elements = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId)).take(600);
  const rows = elements.map((element) => `${element.elementId}: ${typeof element.value === "string" ? element.value : JSON.stringify(element.value)}`).join("\n");
  const concept = createOkfConcept({
    path: `rooms/${String(args.roomId)}/artifacts/${String(args.artifactId)}.md`,
    frontmatter: {
      type: artifact.kind === "sheet" ? "Spreadsheet" : artifact.kind === "note" ? "Report" : "Workflow",
      title: artifact.title,
      timestamp: new Date(artifact.updatedAt).toISOString(),
      visibility: "public",
      tags: [artifact.kind, "convex", "artifact"],
      noderoom: {
        roomId: String(args.roomId),
        artifactId: String(args.artifactId),
        status: "complete",
        confidence: 1,
        sourceKind: "computed",
        visibility: "public",
        targetRefs: elements.slice(0, 80).map((e) => e.elementId),
      },
    },
    body: rows || `Artifact ${artifact.title} has no indexed elements yet.`,
  });
  await upsertConceptRow(ctx, { roomId: args.roomId, concept, sourceKind: "artifact", sourceId: String(args.artifactId), sourceVersion: artifact.version, createdByJobId: args.createdByJobId });
  return { ok: true as const, conceptId: concept.id };
}

export const upsertConcept = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    concept: v.any(),
    sourceKind: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    sourceVersion: v.optional(v.number()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    createdByJobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, a) => {
    await requireActorProof(ctx, a.roomId, a.requester);
    return upsertConceptRow(ctx, { ...a, concept: a.concept as OkfConcept });
  },
});

export const reindexRoom = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireActorProof(ctx, a.roomId, a.requester);
    const artifacts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).take(cap(a.limit, 25, 100));
    let indexed = 0;
    for (const artifact of artifacts) {
      const result = await enqueueArtifactSnapshotForOkf(ctx, { roomId: a.roomId, artifactId: artifact._id });
      if (result.ok) indexed++;
    }
    const traces = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).order("desc").take(30);
    for (const trace of traces) {
      const concept = createOkfConcept({
        path: `rooms/${String(a.roomId)}/traces/${String(trace._id)}.md`,
        frontmatter: {
          type: "Agent Trace",
          title: `${trace.type} trace ${String(trace._id).slice(-6)}`,
          timestamp: new Date(trace.ts).toISOString(),
          visibility: "public",
          tags: ["trace", trace.type],
          noderoom: { roomId: String(a.roomId), status: "complete", confidence: 0.75, sourceKind: "computed", visibility: "public" },
        },
        body: `${trace.summary}\n\n${trace.detail ?? ""}`.slice(0, 8_000),
      });
      await upsertConceptRow(ctx, { roomId: a.roomId, concept, sourceKind: "trace", sourceId: String(trace._id), sourceVersion: 1 });
      indexed++;
    }
    return { indexed };
  },
});

export const listConcepts = query({
  args: { roomId: v.id("rooms"), ...filterArgsV },
  handler: async (ctx, a) => filteredConcepts(ctx, a.roomId, a),
});

export const readConcept = query({
  args: { roomId: v.id("rooms"), conceptId: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", a.conceptId)).unique();
    return row ? toConcept(row) : null;
  },
});

export const fullTextSearch = query({
  args: { roomId: v.id("rooms"), query: v.string(), fields: v.optional(v.array(v.union(v.literal("title"), v.literal("description"), v.literal("body"), v.literal("citations")))), ...filterArgsV },
  handler: async (ctx, a) => {
    const concepts = await filteredConcepts(ctx, a.roomId, a);
    return visibleHits(rankOkfConcepts(concepts, a.query), a.limit);
  },
});

export const semanticSearchScan = query({
  args: { roomId: v.id("rooms"), query: v.string(), ...filterArgsV },
  handler: async (ctx, a) => {
    const qv = embeddingVector(a.query, OKF_EMBEDDING_DIMENSION);
    const chunks = await ctx.db.query("okfChunks").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId)).take(800);
    const scores = new Map<string, number>();
    for (const chunk of chunks) {
      scores.set(chunk.conceptId, Math.max(scores.get(chunk.conceptId) ?? -1, cosine(qv, chunk.embedding)));
    }
    const concepts = await filteredConcepts(ctx, a.roomId, a);
    const lexical = rankOkfConcepts(concepts, a.query);
    const hits = concepts.map((concept) => {
      const vectorScore = scores.get(concept.id) ?? 0;
      const lex = lexical.find((hit) => hit.concept.id === concept.id)?.score ?? 0;
      return { concept, score: Number((0.7 * vectorScore + 0.3 * lex).toFixed(4)), reasons: [`vector=${vectorScore.toFixed(2)}`, `lexical=${lex.toFixed(2)}`] };
    }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score);
    return visibleHits(hits, a.limit);
  },
});

export const conceptsForChunkScores = query({
  args: {
    roomId: v.id("rooms"),
    scores: v.array(v.object({ chunkId: v.id("okfChunks"), score: v.number() })),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const best = new Map<string, number>();
    for (const score of a.scores) {
      const chunk = await ctx.db.get(score.chunkId);
      if (!chunk || String(chunk.roomId) !== String(a.roomId)) continue;
      best.set(chunk.conceptId, Math.max(best.get(chunk.conceptId) ?? -1, score.score));
    }
    const hits: RetrievalHit[] = [];
    for (const [conceptId, score] of best) {
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", conceptId)).unique();
      if (row) hits.push({ concept: toConcept(row), score: Number(score.toFixed(4)), reasons: [`vector_index=${score.toFixed(2)}`] });
    }
    return hits.sort((x, y) => y.score - x.score).slice(0, cap(a.limit, 8, 50));
  },
});

export const filter = query({
  args: { roomId: v.id("rooms"), ...filterArgsV },
  handler: async (ctx, a) => filteredConcepts(ctx, a.roomId, a),
});

export const glob = query({
  args: { roomId: v.id("rooms"), pattern: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const re = new RegExp("^" + a.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    const rows = await roomConceptRows(ctx, a.roomId, 800);
    return rows.map(toConcept).filter((concept) => re.test(concept.path)).slice(0, cap(a.limit, 50, 100));
  },
});

export const regex = query({
  args: { roomId: v.id("rooms"), pattern: v.string(), pathPrefix: v.optional(v.string()), caseSensitive: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const re = new RegExp(a.pattern, a.caseSensitive ? "" : "i");
    const concepts = (await filteredConcepts(ctx, a.roomId, { pathPrefix: a.pathPrefix, limit: 800 })).filter((concept) => re.test(`${concept.path}\n${concept.body}`));
    return concepts.map((concept) => ({ concept, score: 1, reasons: ["regex_match"] })).slice(0, cap(a.limit, 8, 50));
  },
});

export const backlinks = query({
  args: { roomId: v.id("rooms"), conceptId: v.string(), depth: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const edges = await ctx.db.query("okfEdges").withIndex("by_to", (q) => q.eq("roomId", a.roomId).eq("toConceptId", a.conceptId)).take(cap(a.limit, 25, 100));
    const out: OkfConcept[] = [];
    for (const edge of edges) {
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", edge.fromConceptId)).unique();
      if (row) out.push(toConcept(row));
    }
    return out;
  },
});

export const expandNeighbors = query({
  args: { roomId: v.id("rooms"), conceptId: v.string(), linkDepth: v.number(), includeCitations: v.optional(v.boolean()), includeBacklinks: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const out = new Map<string, OkfConcept>();
    const forward = await ctx.db.query("okfEdges").withIndex("by_from", (q) => q.eq("roomId", a.roomId).eq("fromConceptId", a.conceptId)).take(cap(a.limit, 25, 100));
    const backward = a.includeBacklinks ? await ctx.db.query("okfEdges").withIndex("by_to", (q) => q.eq("roomId", a.roomId).eq("toConceptId", a.conceptId)).take(cap(a.limit, 25, 100)) : [];
    for (const edge of [...forward, ...backward]) {
      if (!a.includeCitations && edge.kind === "citation") continue;
      const target = edge.fromConceptId === a.conceptId ? edge.toConceptId : edge.fromConceptId;
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", target)).unique();
      if (row) out.set(row.conceptId, toConcept(row));
    }
    return [...out.values()].slice(0, cap(a.limit, 25, 100));
  },
});

export const resolveCitation = query({
  args: { roomId: v.id("rooms"), evidenceId: v.string() },
  handler: async (ctx, a) => {
    const rows = await roomConceptRows(ctx, a.roomId, 800);
    for (const row of rows) {
      const concept = toConcept(row);
      const citation = concept.citations.find((c) => c.id === a.evidenceId);
      if (citation) return literalFromConcept(concept, { evidenceId: a.evidenceId, conceptId: concept.id, citationId: citation.id });
    }
    const direct = rows.find((row) => row.conceptId === a.evidenceId);
    return literalFromConcept(direct ? toConcept(direct) : null, { evidenceId: a.evidenceId, conceptId: direct?.conceptId });
  },
});

export const openLiteral = query({
  args: { roomId: v.id("rooms"), sourceArtifactId: v.string(), page: v.optional(v.number()), row: v.optional(v.number()), column: v.optional(v.string()), bbox: v.optional(v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number(), unit: v.optional(v.union(v.literal("px"), v.literal("pt"), v.literal("normalized"))) })) },
  handler: async (ctx, a) => {
    const artifact = await ctx.db.get(a.sourceArtifactId as Id<"artifacts">);
    if (!artifact || String(artifact.roomId) !== String(a.roomId)) return { ok: false, error: "artifact_not_found" };
    return { ok: true, title: artifact.title, resource: String(artifact._id), snippet: JSON.stringify(artifact.meta ?? {}).slice(0, 900), locator: { page: a.page, row: a.row, column: a.column, bbox: a.bbox } };
  },
});

export const compareClaim = query({
  args: { roomId: v.id("rooms"), claim: v.string(), evidenceRefs: v.array(evidenceRefV) },
  handler: async (ctx, a): Promise<ClaimSupportResult> => {
    const claimTokens = tokenizeForRetrieval(a.claim);
    const checkedEvidence: LiteralSourceResult[] = [];
    const missing: string[] = [];
    let best = 0;
    for (const ref of a.evidenceRefs) {
      const row = ref.conceptId ? await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", ref.conceptId!)).unique() : null;
      const literal = literalFromConcept(row ? toConcept(row) : null, ref);
      checkedEvidence.push(literal);
      if (!literal.ok || !literal.snippet) {
        missing.push(ref.evidenceId);
        continue;
      }
      const evidenceTokens = new Set(tokenizeForRetrieval(literal.snippet));
      const overlap = claimTokens.filter((token) => evidenceTokens.has(token)).length / Math.max(1, claimTokens.length);
      best = Math.max(best, overlap);
    }
    return {
      support: best >= 0.75 ? "supports" : best >= 0.4 ? "partial" : checkedEvidence.some((e) => e.ok) ? "unsupported" : "unsupported",
      score: Number(best.toFixed(4)),
      checkedEvidence,
      missing,
    };
  },
});

export const recordRetrievalEvent = mutation({
  args: {
    roomId: v.id("rooms"),
    jobId: v.optional(v.id("agentJobs")),
    runId: v.optional(v.id("agentRuns")),
    query: v.string(),
    tool: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    candidateIds: v.array(v.string()),
    hitConceptIds: v.array(v.string()),
    latencyMs: v.number(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => ctx.db.insert("retrievalEvents", { ...a, createdAt: Date.now() }),
});

export const traceLens = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, a) => {
    await requireActorProof(ctx, a.roomId, a.requester);
    const concepts = await ctx.db.query("okfConcepts").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).order("desc").take(12);
    const edges = await ctx.db.query("okfEdges").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).take(24);
    const events = await ctx.db.query("retrievalEvents").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).order("desc").take(12);
    const outboxRows = await ctx.db.query("okfOutbox").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId)).collect();
    const chunks = await ctx.db.query("okfChunks").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId)).take(500);
    const outbox = outboxRows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return {
      concepts: concepts.map((row) => ({ conceptId: row.conceptId, path: row.path, type: row.type, title: row.title, status: row.status, visibility: row.visibility, updatedAt: row.updatedAt })),
      edges: edges.map((edge) => ({ fromConceptId: edge.fromConceptId, toConceptId: edge.toConceptId, label: edge.label, kind: edge.kind })),
      events: events.map((event) => ({ tool: event.tool, query: event.query, status: event.status, hitConceptIds: event.hitConceptIds, latencyMs: event.latencyMs, provider: event.provider, model: event.model, createdAt: event.createdAt })),
      outbox: { queued: outbox.queued ?? 0, running: outbox.running ?? 0, completed: outbox.completed ?? 0, failed: outbox.failed ?? 0 },
      chunkCount: chunks.length,
    };
  },
});

export const claimOutbox = internalMutation({
  args: { leaseId: v.string(), leaseMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const due = await ctx.db.query("okfOutbox").withIndex("by_status_nextRunAt", (q) => q.eq("status", "queued")).order("asc").take(cap(a.limit, 5, 20));
    const claimed = [];
    for (const job of due) {
      if ((job.nextRunAt ?? 0) > now) continue;
      const concept = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", job.roomId).eq("conceptId", job.conceptId)).unique();
      if (!concept || concept.contentHash !== job.contentHash) {
        await ctx.db.patch(job._id, { status: "failed", attempts: job.attempts + 1, error: "concept_changed_or_missing", updatedAt: now });
        continue;
      }
      await ctx.db.patch(job._id, { status: "running", attempts: job.attempts + 1, leaseId: a.leaseId, leaseUntil: now + a.leaseMs, updatedAt: now });
      claimed.push({ jobId: job._id, roomId: job.roomId, conceptId: job.conceptId, contentHash: job.contentHash, title: concept.title, text: concept.searchText, visibility: concept.visibility });
    }
    return claimed;
  },
});

export const completeOutbox = internalMutation({
  args: {
    jobId: v.id("okfOutbox"),
    roomId: v.id("rooms"),
    conceptId: v.string(),
    contentHash: v.string(),
    chunks: v.array(v.object({
      chunkId: v.string(),
      chunkIndex: v.number(),
      text: v.string(),
      embedding: v.array(v.float64()),
      embeddingProvider: v.string(),
      embeddingModel: v.string(),
      embeddingDimension: v.number(),
      visibility: okfVisibilityV,
    })),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || String(job.roomId) !== String(a.roomId) || job.conceptId !== a.conceptId || job.contentHash !== a.contentHash) return { ok: false as const, reason: "job_mismatch" as const };
    const existing = await ctx.db.query("okfChunks").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", a.conceptId)).collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const chunk of a.chunks) {
      await ctx.db.insert("okfChunks", { roomId: a.roomId, conceptId: a.conceptId, contentHash: a.contentHash, searchText: chunk.text, createdAt: now, updatedAt: now, ...chunk });
    }
    await ctx.db.patch(a.jobId, { status: "completed", leaseId: undefined, leaseUntil: undefined, error: undefined, updatedAt: now });
    return { ok: true as const };
  },
});

export const failOutbox = internalMutation({
  args: { jobId: v.id("okfOutbox"), error: v.string() },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const };
    const now = Date.now();
    await ctx.db.patch(a.jobId, {
      status: "queued",
      error: a.error,
      leaseId: undefined,
      leaseUntil: undefined,
      nextRunAt: now + Math.min(5 * 60_000, 2 ** Math.min(job.attempts, 8) * 1_000),
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const sweepOutboxLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const running = await ctx.db.query("okfOutbox").withIndex("by_status_nextRunAt", (q) => q.eq("status", "running")).take(50);
    let swept = 0;
    for (const job of running) {
      if ((job.leaseUntil ?? 0) > now) continue;
      await ctx.db.patch(job._id, { status: "queued", leaseId: undefined, leaseUntil: undefined, nextRunAt: now, updatedAt: now, error: "lease_expired" });
      swept++;
    }
    return { swept };
  },
});
