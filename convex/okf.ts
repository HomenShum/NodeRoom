import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { actorProofV, actorV, requireActorInRoom, requireActorProof } from "./lib";
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
  // Skill RAG filters (additive; ignored by non-skill concepts). See DYNAMIC_SKILL_RETRIEVAL.md.
  skill_categories: v.optional(v.array(v.string())),
  skill_trust_min: v.optional(v.union(v.literal("untrusted"), v.literal("community"), v.literal("verified"))),
};
const evidenceRefV = v.object({
  evidenceId: v.string(),
  conceptId: v.optional(v.string()),
  citationId: v.optional(v.string()),
  sourceArtifactId: v.optional(v.string()),
});
const requesterArgsV = { requester: actorProofV };
const agentAccessArgsV = { actor: actorV };

type OkfAccess = { privateOwnerId?: string };
type ActorLike = { kind: "user" | "agent"; id: string; name: string; ownerId?: string; scope?: "public" | "private" };
type VisibleRow = { visibility?: OkfVisibility; ownerId?: string };
type ArtifactAcl = { visibility?: "private" | "room" | "public"; createdBy?: ActorLike };
type SourceLocatorArgs = {
  page?: number;
  row?: number;
  column?: string;
  bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" };
};
type ElementDoc = Doc<"elements">;
const DEFAULT_LITERAL_SNIPPET_CHARS = 900;
const TEXT_DOCUMENT_LITERAL_CHARS = 24_000;

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

function ownerIdFromActor(actor?: ActorLike): string | undefined {
  if (!actor) return undefined;
  if (actor.kind === "agent") return actor.ownerId;
  return actor.id;
}

function ownerIdFromConcept(concept: OkfConcept): string | undefined {
  const frontmatterOwner = typeof concept.frontmatter.ownerId === "string" ? concept.frontmatter.ownerId : undefined;
  const noderoomOwner = typeof concept.frontmatter.noderoom?.ownerId === "string" ? concept.frontmatter.noderoom.ownerId : undefined;
  return noderoomOwner ?? frontmatterOwner;
}

function accessForActor(actor: ActorLike): OkfAccess {
  if (actor.kind === "agent" && actor.scope === "private" && actor.ownerId) return { privateOwnerId: actor.ownerId };
  if (actor.kind === "user") return { privateOwnerId: actor.id };
  return {};
}

async function accessForRequester(ctx: QueryCtx, roomId: Id<"rooms">, requester?: { actor: ActorLike; token?: string }): Promise<OkfAccess> {
  if (!requester) throw new Error("okf_room_membership_required");
  const actor = await requireActorProof(ctx, roomId, requester);
  return accessForActor(actor);
}

async function accessForAgent(ctx: QueryCtx, roomId: Id<"rooms">, actor: ActorLike): Promise<OkfAccess> {
  await requireActorInRoom(ctx, roomId, actor);
  return accessForActor(actor);
}

function canReadVisible(row: VisibleRow, access: OkfAccess): boolean {
  const visibility = normalizeVisibility(row.visibility);
  if (visibility === "public" || visibility === "redacted") return true;
  return !!access.privateOwnerId && row.ownerId === access.privateOwnerId;
}

async function visibleConceptIdSet(ctx: QueryCtx, roomId: Id<"rooms">, ids: string[], access: OkfAccess): Promise<Set<string>> {
  const visible = new Set<string>();
  for (const conceptId of distinct(ids)) {
    const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", roomId).eq("conceptId", conceptId)).unique();
    if (row && canReadVisible(row, access)) visible.add(conceptId);
  }
  return visible;
}

async function readableConceptRow(ctx: QueryCtx, roomId: Id<"rooms">, conceptId: string, access: OkfAccess) {
  const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", roomId).eq("conceptId", conceptId)).unique();
  return row && canReadVisible(row, access) ? row : null;
}

function canOpenArtifact(artifact: ArtifactAcl, access: OkfAccess): boolean {
  if (artifact.visibility !== "private") return true;
  const ownerId = ownerIdFromActor(artifact.createdBy);
  return !!access.privateOwnerId && ownerId === access.privateOwnerId;
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
  const ownerId = ownerIdFromConcept(args.concept);
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
    ownerId,
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

async function roomConceptRows(ctx: QueryCtx, roomId: Id<"rooms">, limit = 500, access: OkfAccess = {}) {
  const rows = await ctx.db.query("okfConcepts").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(limit);
  return rows.filter((row) => canReadVisible(row, access));
}

async function filteredConcepts(ctx: QueryCtx, roomId: Id<"rooms">, args: OkfConceptFilter, access: OkfAccess = {}) {
  const rows = await roomConceptRows(ctx, roomId, 800, access);
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

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function distinct(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

function excelColumnLabels(limit = 52): string[] {
  const labels: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    let n = i;
    let label = "";
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    labels.push(label);
  }
  return labels;
}

function columnCandidates(meta: unknown, requested?: string): string[] {
  if (!requested) return [];
  const normalized = normalizedKey(requested);
  const candidates = [requested, requested.trim(), requested.trim().toLowerCase()];
  const dataframe = safeRecord(safeRecord(meta).dataframe);
  const columns = Array.isArray(dataframe.columns) ? dataframe.columns : [];
  for (const column of columns) {
    const c = safeRecord(column);
    const id = typeof c.id === "string" ? c.id : undefined;
    const label = typeof c.label === "string" ? c.label : undefined;
    if (id && normalizedKey(id) === normalized) candidates.push(id);
    if (label && normalizedKey(label) === normalized) {
      candidates.push(label);
      if (id) candidates.push(id);
    }
  }
  return distinct(candidates);
}

function rowIdForElementId(elementId: string): string | undefined {
  const marker = elementId.indexOf("__");
  return marker > 0 ? elementId.slice(0, marker) : undefined;
}

function columnIdForElementId(elementId: string): string | undefined {
  const marker = elementId.indexOf("__");
  if (marker > 0) return elementId.slice(marker + 2);
  const match = /^([A-Za-z]+)\d+$/.exec(elementId);
  return match?.[1];
}

function orderedRowIds(order: string[]): string[] {
  const ids: string[] = [];
  for (const elementId of order) {
    const rowId = rowIdForElementId(elementId);
    if (rowId && !ids.includes(rowId)) ids.push(rowId);
  }
  return ids;
}

function cellPayloadValue(value: unknown): unknown {
  const record = safeRecord(value);
  return "value" in record ? record.value : value;
}

function formatCellValue(value: unknown): string {
  const payload = safeRecord(value);
  const raw = cellPayloadValue(value);
  const base = typeof raw === "string" ? raw : JSON.stringify(raw);
  const status = typeof payload.status === "string" ? ` (status: ${payload.status})` : "";
  const formula = typeof payload.formula === "string" ? `; formula: ${payload.formula}` : "";
  return `${base ?? ""}${status}${formula}`.slice(0, 500);
}

function formatElementLine(element: ElementDoc): string {
  return `${element.elementId}: ${formatCellValue(element.value)}`;
}

function payloadEvidenceMatches(value: unknown, locator: SourceLocatorArgs, columns: string[]): boolean {
  const evidence = safeRecord(value).evidence;
  if (!Array.isArray(evidence)) return false;
  return evidence.some((item) => {
    const e = safeRecord(item);
    const rowMatches = locator.row == null || Number(e.row) === locator.row;
    const evidenceColumn = typeof e.column === "string" ? e.column : undefined;
    const columnMatches = !locator.column || (evidenceColumn && columns.some((column) => normalizedKey(column) === normalizedKey(evidenceColumn)));
    return rowMatches && columnMatches;
  });
}

function cellEvidenceItems(value: unknown): Record<string, unknown>[] {
  const evidence = safeRecord(value).evidence;
  return Array.isArray(evidence) ? evidence.map(safeRecord) : [];
}

function locatorFromEvidence(evidence: Record<string, unknown>): SourceLocatorArgs {
  const bbox = safeRecord(evidence.bbox);
  return {
    page: typeof evidence.page === "number" ? evidence.page : undefined,
    row: typeof evidence.row === "number" ? evidence.row : undefined,
    column: typeof evidence.column === "string" ? evidence.column : undefined,
    bbox: typeof bbox.x === "number" && typeof bbox.y === "number" && typeof bbox.width === "number" && typeof bbox.height === "number"
      ? {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        unit: bbox.unit === "px" || bbox.unit === "pt" || bbox.unit === "normalized" ? bbox.unit : undefined,
      }
      : undefined,
  };
}

async function getElementById(ctx: QueryCtx, artifactId: Id<"artifacts">, elementId: string): Promise<ElementDoc | null> {
  return await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", elementId)).unique();
}

async function getElementsByIds(ctx: QueryCtx, artifactId: Id<"artifacts">, elementIds: string[]): Promise<ElementDoc[]> {
  const out: ElementDoc[] = [];
  for (const elementId of distinct(elementIds)) {
    const element = await getElementById(ctx, artifactId, elementId);
    if (element) out.push(element);
  }
  return out;
}

function artifactLiteralResult(artifact: Doc<"artifacts">, locator: SourceLocatorArgs, snippet: string, limit = DEFAULT_LITERAL_SNIPPET_CHARS): LiteralSourceResult {
  return {
    ok: true,
    title: artifact.title,
    resource: String(artifact._id),
    snippet: snippet.slice(0, limit),
    locator: { page: locator.page, row: locator.row, column: locator.column, bbox: locator.bbox },
  };
}

function uploadedTextDocumentSnippet(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as { fileName?: unknown; mimeType?: unknown; size?: unknown; text?: unknown };
  if (typeof doc.text !== "string" || !doc.text.trim()) return null;
  const mimeType = typeof doc.mimeType === "string" ? doc.mimeType : "";
  const fileName = typeof doc.fileName === "string" ? doc.fileName : "";
  if (mimeType && !mimeType.startsWith("text/") && !/\.(txt|md|json|log)$/i.test(fileName)) return null;
  return [
    `fileName: ${fileName || "(uploaded text)"}`,
    `mimeType: ${mimeType || "text/plain"}`,
    typeof doc.size === "number" ? `size: ${doc.size}` : undefined,
    "",
    doc.text,
  ].filter((part): part is string => part !== undefined).join("\n");
}

async function literalFromArtifact(ctx: QueryCtx, artifact: Doc<"artifacts">, locator: SourceLocatorArgs): Promise<LiteralSourceResult> {
  if (artifact.kind === "note" && locator.row == null && !locator.column && !locator.bbox) {
    const docElement = await getElementById(ctx, artifact._id, "doc");
    const textSnippet = uploadedTextDocumentSnippet(docElement?.value);
    if (textSnippet) return artifactLiteralResult(artifact, locator, textSnippet, TEXT_DOCUMENT_LITERAL_CHARS);
  }

  const columns = columnCandidates(artifact.meta, locator.column);
  const rows = orderedRowIds(artifact.order);
  const rowId = locator.row && locator.row > 0 ? rows[locator.row - 1] : undefined;
  const directIds = [
    ...(locator.row && locator.column ? columns.map((column) => `${column}${locator.row}`) : []),
    ...(locator.row && !locator.column ? excelColumnLabels().map((column) => `${column}${locator.row}`) : []),
    ...(rowId ? columns.map((column) => `${rowId}__${column}`) : []),
    ...(locator.row ? ["r", "row", "u"].flatMap((prefix) => columns.map((column) => `${prefix}${locator.row}__${column}`)) : []),
  ];
  const direct = await getElementsByIds(ctx, artifact._id, directIds);
  if (direct[0]) return artifactLiteralResult(artifact, locator, direct.map(formatElementLine).join("\n"));

  const orderMatches = artifact.order.filter((elementId) => {
    if (!columns.length) return true;
    const columnId = columnIdForElementId(elementId);
    return !!columnId && columns.some((column) => normalizedKey(column) === normalizedKey(columnId));
  });
  const evidenceScanIds = orderMatches.slice(0, 2_000);
  const evidenceScan = await getElementsByIds(ctx, artifact._id, evidenceScanIds);
  const evidenceMatched = evidenceScan.find((element) => payloadEvidenceMatches(element.value, locator, columns));
  if (evidenceMatched) return artifactLiteralResult(artifact, locator, formatElementLine(evidenceMatched));

  if (rowId) {
    const rowIds = artifact.order.filter((elementId) => elementId.startsWith(`${rowId}__`)).slice(0, 40);
    const rowElements = await getElementsByIds(ctx, artifact._id, rowIds);
    if (rowElements.length) return artifactLiteralResult(artifact, locator, rowElements.map(formatElementLine).join("\n"));
  }

  if (locator.row != null) {
    const rowEvidence = (await getElementsByIds(ctx, artifact._id, artifact.order.slice(0, 2_000)))
      .filter((element) => payloadEvidenceMatches(element.value, { ...locator, column: undefined }, []))
      .slice(0, 40);
    if (rowEvidence.length) return artifactLiteralResult(artifact, locator, rowEvidence.map(formatElementLine).join("\n"));
  }

  const fallbackIds = orderMatches.length ? orderMatches.slice(0, 20) : artifact.order.slice(0, 20);
  const fallback = await getElementsByIds(ctx, artifact._id, fallbackIds);
  const snippet = fallback.length
    ? fallback.map(formatElementLine).join("\n")
    : JSON.stringify(artifact.meta ?? {}).slice(0, 900);
  return artifactLiteralResult(artifact, locator, snippet);
}

async function getSourceArtifact(ctx: QueryCtx, roomId: Id<"rooms">, sourceArtifactId: unknown, access: OkfAccess): Promise<Doc<"artifacts"> | null> {
  if (typeof sourceArtifactId !== "string") return null;
  let artifact: Doc<"artifacts"> | null = null;
  try {
    artifact = await ctx.db.get(sourceArtifactId as Id<"artifacts">);
  } catch {
    return null;
  }
  if (!artifact || String(artifact.roomId) !== String(roomId) || !canOpenArtifact(artifact, access)) return null;
  return artifact;
}

async function sourceArtifactNotFoundResult(ctx: QueryCtx, roomId: Id<"rooms">, access: OkfAccess): Promise<LiteralSourceResult & { candidates: Array<{ id: string; title: string; kind: string }> }> {
  const candidates = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(80))
    .filter((artifact) => canOpenArtifact(artifact, access))
    .slice(0, 16)
    .map((artifact) => ({ id: String(artifact._id), title: artifact.title, kind: artifact.kind }));
  return {
    ok: false,
    error: "artifact_not_found",
    snippet: `sourceArtifactId must be an exact artifact id from list_artifacts/source evidence; retry with one of these exact candidate ids: ${candidates.map((artifact) => `${artifact.title}=${artifact.id}`).join("; ")}`,
    candidates,
  };
}

async function resolveCellEvidence(ctx: QueryCtx, roomId: Id<"rooms">, evidenceId: string, access: OkfAccess): Promise<LiteralSourceResult | null> {
  const artifacts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(100);
  for (const artifact of artifacts) {
    if (!canOpenArtifact(artifact, access)) continue;
    const elements = await getElementsByIds(ctx, artifact._id, artifact.order.slice(0, 2_000));
    for (const element of elements) {
      const evidence = cellEvidenceItems(element.value).find((item) => item.id === evidenceId);
      if (!evidence) continue;
      const locator = locatorFromEvidence(evidence);
      const sourceArtifact = await getSourceArtifact(ctx, roomId, evidence.sourceArtifactId, access);
      if (evidence.sourceArtifactId && !sourceArtifact) return { ok: false, error: "evidence_not_found" };
      if (sourceArtifact) return literalFromArtifact(ctx, sourceArtifact, locator);
      const label = typeof evidence.label === "string" ? evidence.label : evidenceId;
      const source = typeof evidence.url === "string" ? evidence.url : typeof evidence.source === "string" ? evidence.source : String(artifact._id);
      const snippet = [
        label,
        typeof evidence.snippet === "string" ? evidence.snippet : undefined,
        `Claim cell ${artifact.title}/${element.elementId}: ${formatCellValue(element.value)}`,
      ].filter(Boolean).join("\n");
      return { ok: true, title: label, resource: source, snippet: snippet.slice(0, 900), locator };
    }
  }
  return null;
}

export async function enqueueArtifactSnapshotForOkf(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  createdByJobId?: Id<"agentJobs">;
}) {
  const artifact = await ctx.db.get(args.artifactId);
  if (!artifact || String(artifact.roomId) !== String(args.roomId)) return { ok: false as const, reason: "artifact_missing" as const };
  const visibility = artifact.visibility === "private" ? "private" : "public";
  const ownerId = visibility === "private" ? ownerIdFromActor(artifact.createdBy) : undefined;
  const elements = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId)).take(600);
  const rows = elements.map((element) => `${element.elementId}: ${typeof element.value === "string" ? element.value : JSON.stringify(element.value)}`).join("\n");
  const concept = createOkfConcept({
    path: `rooms/${String(args.roomId)}/artifacts/${String(args.artifactId)}.md`,
    frontmatter: {
      type: artifact.kind === "sheet" ? "Spreadsheet" : artifact.kind === "note" ? "Report" : "Workflow",
      title: artifact.title,
      // Agent-managed metadata (deriveArtifactMeta / set_artifact_meta) feeds the embedding via the
      // concept frontmatter: summary -> description, content tags merged ahead of the structural ones.
      description: (artifact.meta as { summary?: string } | undefined)?.summary,
      timestamp: new Date(artifact.updatedAt).toISOString(),
      visibility,
      tags: [...(((artifact.meta as { tags?: string[] } | undefined)?.tags) ?? []), artifact.kind, "convex", "artifact"],
      noderoom: {
        roomId: String(args.roomId),
        artifactId: String(args.artifactId),
        ownerId,
        status: "complete",
        confidence: 1,
        sourceKind: "computed",
        visibility,
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
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const concept = a.concept as OkfConcept;
    const visibility = normalizeVisibility(concept.frontmatter.visibility ?? concept.frontmatter.noderoom?.visibility);
    if (visibility === "private") {
      const requestedOwnerId = ownerIdFromConcept(concept);
      if (requestedOwnerId && requestedOwnerId !== actor.id) throw new Error("private_concept_owner_mismatch");
      concept.frontmatter.ownerId = actor.id;
      concept.frontmatter.noderoom = { ...(concept.frontmatter.noderoom ?? {}), ownerId: actor.id, visibility };
    }
    return upsertConceptRow(ctx, { ...a, concept });
  },
});

/** Skill RAG: trust tier → OKF confidence. Mirrored in retrieval/okf/okfFilters.ts. */
const SKILL_TRUST_CONFIDENCE: Record<"local" | "verified" | "community" | "untrusted", number> = {
  local: 1,
  verified: 0.95,
  community: 0.6,
  untrusted: 0.3,
};

const skillTrustV = v.union(v.literal("local"), v.literal("verified"), v.literal("community"), v.literal("untrusted"));

/**
 * Ingest one Agent Skill catalog record as an OKF concept (type "Agent Skill"), reusing the
 * existing okfConcepts/okfChunks pipeline + embed outbox — no new table, no schema change.
 *
 * Convex boundary: a mutation CANNOT fetch, so the SKILL.md `body` is passed IN by the caller
 * (build-skill-index / an admin script that read it from disk or via the SSRF-guarded loader).
 * Keeping the fetch out of the mutation is the cleaner of the two spec options.
 *
 * Only name+description+meta are required up front; `body` is optional — load_skill pulls the
 * full body on demand. When `body` is omitted the concept still indexes on its description (the
 * load-bearing retrieval hook), so it remains discoverable.
 */
export const indexSkillFromCatalog = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    categories: v.optional(v.array(v.string())),
    trust: skillTrustV,
    install: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceCatalog: v.optional(v.string()),
    version: v.optional(v.string()),
    body: v.optional(v.string()),
    contentHash: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireActorProof(ctx, a.roomId, a.requester);
    if (!a.description.trim()) throw new Error("skill_description_required");
    const categories = a.categories ?? [];
    const concept = createOkfConcept({
      // Skills live in a stable, per-room path namespace so re-ingestion patches the same row.
      path: `rooms/${String(a.roomId)}/skills/${a.slug}.md`,
      frontmatter: {
        type: "Agent Skill",
        title: a.name,
        // description IS the semantic retrieval hook (feeds searchText + the embedding).
        description: a.description,
        resource: a.sourceUrl ?? a.install,
        // categories → tags so the existing tag filter + skill_categories filter both work.
        tags: [...categories, "agent-skill", `trust:${a.trust}`],
        noderoom: {
          roomId: String(a.roomId),
          status: "complete",
          confidence: SKILL_TRUST_CONFIDENCE[a.trust],
          sourceKind: "external_skill",
          visibility: "public",
          skill_install: a.install,
          skill_trust: a.trust,
          skill_categories: categories,
          skill_version: a.version,
          skill_source_catalog: a.sourceCatalog,
        },
      },
      // Body is the SKILL.md content when provided; otherwise a discoverable placeholder.
      body: a.body && a.body.trim() ? a.body : `# ${a.name}\n\n${a.description}\n\n(Skill body not yet loaded — use load_skill to fetch it.)`,
    });
    await upsertConceptRow(ctx, {
      roomId: a.roomId,
      concept,
      sourceKind: "external_skill",
      sourceId: a.slug,
    });
    return { ok: true as const, conceptId: concept.id };
  },
});

export const promoteConcept = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    conceptId: v.string(),
    targetVisibility: v.union(v.literal("redacted"), v.literal("public")),
    redactedBody: v.string(),
    redactedTitle: v.optional(v.string()),
    redactedDescription: v.optional(v.string()),
    path: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const body = a.redactedBody.trim();
    if (!body) throw new Error("redacted_body_required");
    const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", a.conceptId)).unique();
    if (!row || row.visibility !== "private" || row.ownerId !== actor.id) throw new Error("private_concept_owner_required");
    const source = toConcept(row);
    const sourceNoderoom = source.frontmatter.noderoom ?? {};
    const now = Date.now();
    const promoted = createOkfConcept({
      path: a.path ?? `rooms/${String(a.roomId)}/promoted/${source.id}-${a.targetVisibility}.md`,
      frontmatter: {
        type: source.frontmatter.type,
        title: a.redactedTitle?.trim() || source.frontmatter.title || source.path,
        description: a.redactedDescription?.trim() || `Public-safe promotion of ${source.frontmatter.title ?? source.path}.`,
        resource: source.frontmatter.resource,
        timestamp: new Date(now).toISOString(),
        visibility: a.targetVisibility,
        tags: distinct([...(source.frontmatter.tags ?? []).filter((tag) => normalizedKey(tag) !== "private"), ...(a.tags ?? []), "promoted", a.targetVisibility]),
        noderoom: clean({
          roomId: String(a.roomId),
          artifactId: sourceNoderoom.artifactId,
          elementId: sourceNoderoom.elementId,
          status: sourceNoderoom.status ?? "needs_review",
          confidence: sourceNoderoom.confidence,
          sourceKind: "okf_promotion",
          visibility: a.targetVisibility,
          promotedFromConceptId: source.id,
          promotedBy: actor.id,
          promotedAt: new Date(now).toISOString(),
        }),
      },
      body,
    });
    return upsertConceptRow(ctx, {
      roomId: a.roomId,
      concept: promoted,
      sourceKind: "okf_promotion",
      sourceId: source.id,
      sourceVersion: row.sourceVersion,
    });
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
      const traceOwnerId = ownerIdFromActor(trace.actor);
      const traceVisibility: OkfVisibility = trace.actor.kind === "agent" && trace.actor.scope === "private" && traceOwnerId ? "private" : "public";
      const concept = createOkfConcept({
        path: `rooms/${String(a.roomId)}/traces/${String(trace._id)}.md`,
        frontmatter: {
          type: "Agent Trace",
          title: `${trace.type} trace ${String(trace._id).slice(-6)}`,
          timestamp: new Date(trace.ts).toISOString(),
          visibility: traceVisibility,
          tags: ["trace", trace.type],
          noderoom: clean({ roomId: String(a.roomId), ownerId: traceOwnerId, status: "complete", confidence: 0.75, sourceKind: "computed", visibility: traceVisibility }),
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
  args: { roomId: v.id("rooms"), ...filterArgsV, ...requesterArgsV },
  handler: async (ctx, a) => filteredConcepts(ctx, a.roomId, a, await accessForRequester(ctx, a.roomId, a.requester)),
});

export const readConcept = query({
  args: { roomId: v.id("rooms"), conceptId: v.string(), ...requesterArgsV },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", a.conceptId)).unique();
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    return row && canReadVisible(row, access) ? toConcept(row) : null;
  },
});

export const fullTextSearch = query({
  args: { roomId: v.id("rooms"), query: v.string(), fields: v.optional(v.array(v.union(v.literal("title"), v.literal("description"), v.literal("body"), v.literal("citations")))), ...filterArgsV, ...requesterArgsV },
  handler: async (ctx, a) => {
    const concepts = await filteredConcepts(ctx, a.roomId, a, await accessForRequester(ctx, a.roomId, a.requester));
    return visibleHits(rankOkfConcepts(concepts, a.query), a.limit);
  },
});

export const semanticSearchScan = query({
  args: { roomId: v.id("rooms"), query: v.string(), ...filterArgsV, ...requesterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const qv = embeddingVector(a.query, OKF_EMBEDDING_DIMENSION);
    const chunks = (await ctx.db.query("okfChunks").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId)).take(800)).filter((chunk) => canReadVisible(chunk, access));
    const scores = new Map<string, number>();
    for (const chunk of chunks) {
      scores.set(chunk.conceptId, Math.max(scores.get(chunk.conceptId) ?? -1, cosine(qv, chunk.embedding)));
    }
    const concepts = await filteredConcepts(ctx, a.roomId, a, access);
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
    ...requesterArgsV,
  },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const best = new Map<string, number>();
    for (const score of a.scores) {
      const chunk = await ctx.db.get(score.chunkId);
      if (!chunk || String(chunk.roomId) !== String(a.roomId) || !canReadVisible(chunk, access)) continue;
      best.set(chunk.conceptId, Math.max(best.get(chunk.conceptId) ?? -1, score.score));
    }
    const hits: RetrievalHit[] = [];
    for (const [conceptId, score] of best) {
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", conceptId)).unique();
      if (row && canReadVisible(row, access)) hits.push({ concept: toConcept(row), score: Number(score.toFixed(4)), reasons: [`vector_index=${score.toFixed(2)}`] });
    }
    return hits.sort((x, y) => y.score - x.score).slice(0, cap(a.limit, 8, 50));
  },
});

export const filter = query({
  args: { roomId: v.id("rooms"), ...filterArgsV, ...requesterArgsV },
  handler: async (ctx, a) => filteredConcepts(ctx, a.roomId, a, await accessForRequester(ctx, a.roomId, a.requester)),
});

export const glob = query({
  args: { roomId: v.id("rooms"), pattern: v.string(), limit: v.optional(v.number()), ...requesterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const re = new RegExp("^" + a.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    const rows = await roomConceptRows(ctx, a.roomId, 800, access);
    return rows.map(toConcept).filter((concept) => re.test(concept.path)).slice(0, cap(a.limit, 50, 100));
  },
});

export const regex = query({
  args: { roomId: v.id("rooms"), pattern: v.string(), pathPrefix: v.optional(v.string()), caseSensitive: v.optional(v.boolean()), limit: v.optional(v.number()), ...requesterArgsV },
  handler: async (ctx, a) => {
    const re = new RegExp(a.pattern, a.caseSensitive ? "" : "i");
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const concepts = (await filteredConcepts(ctx, a.roomId, { pathPrefix: a.pathPrefix, limit: 800 }, access)).filter((concept) => re.test(`${concept.path}\n${concept.body}`));
    return concepts.map((concept) => ({ concept, score: 1, reasons: ["regex_match"] })).slice(0, cap(a.limit, 8, 50));
  },
});

export const backlinks = query({
  args: { roomId: v.id("rooms"), conceptId: v.string(), depth: v.optional(v.number()), limit: v.optional(v.number()), ...requesterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    if (!await readableConceptRow(ctx, a.roomId, a.conceptId, access)) return [];
    const edges = await ctx.db.query("okfEdges").withIndex("by_to", (q) => q.eq("roomId", a.roomId).eq("toConceptId", a.conceptId)).take(cap(a.limit, 25, 100));
    const out: OkfConcept[] = [];
    for (const edge of edges) {
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", edge.fromConceptId)).unique();
      if (row && canReadVisible(row, access)) out.push(toConcept(row));
    }
    return out;
  },
});

export const expandNeighbors = query({
  args: { roomId: v.id("rooms"), conceptId: v.string(), linkDepth: v.number(), includeCitations: v.optional(v.boolean()), includeBacklinks: v.optional(v.boolean()), limit: v.optional(v.number()), ...requesterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    if (!await readableConceptRow(ctx, a.roomId, a.conceptId, access)) return [];
    const out = new Map<string, OkfConcept>();
    const forward = await ctx.db.query("okfEdges").withIndex("by_from", (q) => q.eq("roomId", a.roomId).eq("fromConceptId", a.conceptId)).take(cap(a.limit, 25, 100));
    const backward = a.includeBacklinks ? await ctx.db.query("okfEdges").withIndex("by_to", (q) => q.eq("roomId", a.roomId).eq("toConceptId", a.conceptId)).take(cap(a.limit, 25, 100)) : [];
    for (const edge of [...forward, ...backward]) {
      if (!a.includeCitations && edge.kind === "citation") continue;
      const target = edge.fromConceptId === a.conceptId ? edge.toConceptId : edge.fromConceptId;
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", target)).unique();
      if (row && canReadVisible(row, access)) out.set(row.conceptId, toConcept(row));
    }
    return [...out.values()].slice(0, cap(a.limit, 25, 100));
  },
});

export const resolveCitation = query({
  args: { roomId: v.id("rooms"), evidenceId: v.string(), ...requesterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const rows = await roomConceptRows(ctx, a.roomId, 800, access);
    for (const row of rows) {
      const concept = toConcept(row);
      const citation = concept.citations.find((c) => c.id === a.evidenceId);
      if (citation) return literalFromConcept(concept, { evidenceId: a.evidenceId, conceptId: concept.id, citationId: citation.id });
    }
    const direct = rows.find((row) => row.conceptId === a.evidenceId);
    if (direct) return literalFromConcept(toConcept(direct), { evidenceId: a.evidenceId, conceptId: direct.conceptId });
    return await resolveCellEvidence(ctx, a.roomId, a.evidenceId, access) ?? { ok: false, error: "evidence_not_found" };
  },
});

export const openLiteral = query({
  args: { roomId: v.id("rooms"), sourceArtifactId: v.string(), page: v.optional(v.number()), row: v.optional(v.number()), column: v.optional(v.string()), bbox: v.optional(v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number(), unit: v.optional(v.union(v.literal("px"), v.literal("pt"), v.literal("normalized"))) })), ...requesterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const artifact = await getSourceArtifact(ctx, a.roomId, a.sourceArtifactId, access);
    if (!artifact) {
      return await sourceArtifactNotFoundResult(ctx, a.roomId, access);
    }
    return await literalFromArtifact(ctx, artifact, { page: a.page, row: a.row, column: a.column, bbox: a.bbox });
  },
});

export const compareClaim = query({
  args: { roomId: v.id("rooms"), claim: v.string(), evidenceRefs: v.array(evidenceRefV), ...requesterArgsV },
  handler: async (ctx, a): Promise<ClaimSupportResult> => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const claimTokens = tokenizeForRetrieval(a.claim);
    const checkedEvidence: LiteralSourceResult[] = [];
    const missing: string[] = [];
    let best = 0;
    for (const ref of a.evidenceRefs) {
      const row = ref.conceptId ? await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", ref.conceptId!)).unique() : null;
      const literal = literalFromConcept(row && canReadVisible(row, access) ? toConcept(row) : null, ref);
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

export const listConceptsForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, ...filterArgsV },
  handler: async (ctx, a) => filteredConcepts(ctx, a.roomId, a, await accessForAgent(ctx, a.roomId, a.actor)),
});

export const readConceptForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, conceptId: v.string() },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", a.conceptId)).unique();
    return row && canReadVisible(row, access) ? toConcept(row) : null;
  },
});

export const fullTextSearchForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, query: v.string(), fields: v.optional(v.array(v.union(v.literal("title"), v.literal("description"), v.literal("body"), v.literal("citations")))), ...filterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const concepts = await filteredConcepts(ctx, a.roomId, a, access);
    return visibleHits(rankOkfConcepts(concepts, a.query), a.limit);
  },
});

export const semanticSearchScanForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, query: v.string(), ...filterArgsV },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const qv = embeddingVector(a.query, OKF_EMBEDDING_DIMENSION);
    const chunks = (await ctx.db.query("okfChunks").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId)).take(800)).filter((chunk) => canReadVisible(chunk, access));
    const scores = new Map<string, number>();
    for (const chunk of chunks) {
      scores.set(chunk.conceptId, Math.max(scores.get(chunk.conceptId) ?? -1, cosine(qv, chunk.embedding)));
    }
    const concepts = await filteredConcepts(ctx, a.roomId, a, access);
    const lexical = rankOkfConcepts(concepts, a.query);
    const hits = concepts.map((concept) => {
      const vectorScore = scores.get(concept.id) ?? 0;
      const lex = lexical.find((hit) => hit.concept.id === concept.id)?.score ?? 0;
      return { concept, score: Number((0.7 * vectorScore + 0.3 * lex).toFixed(4)), reasons: [`vector=${vectorScore.toFixed(2)}`, `lexical=${lex.toFixed(2)}`] };
    }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score);
    return visibleHits(hits, a.limit);
  },
});

export const conceptsForChunkScoresForAgent = internalQuery({
  args: {
    roomId: v.id("rooms"),
    ...agentAccessArgsV,
    scores: v.array(v.object({ chunkId: v.id("okfChunks"), score: v.number() })),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const best = new Map<string, number>();
    for (const score of a.scores) {
      const chunk = await ctx.db.get(score.chunkId);
      if (!chunk || String(chunk.roomId) !== String(a.roomId) || !canReadVisible(chunk, access)) continue;
      best.set(chunk.conceptId, Math.max(best.get(chunk.conceptId) ?? -1, score.score));
    }
    const hits: RetrievalHit[] = [];
    for (const [conceptId, score] of best) {
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", conceptId)).unique();
      if (row && canReadVisible(row, access)) hits.push({ concept: toConcept(row), score: Number(score.toFixed(4)), reasons: [`vector_index=${score.toFixed(2)}`] });
    }
    return hits.sort((x, y) => y.score - x.score).slice(0, cap(a.limit, 8, 50));
  },
});

export const filterForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, ...filterArgsV },
  handler: async (ctx, a) => filteredConcepts(ctx, a.roomId, a, await accessForAgent(ctx, a.roomId, a.actor)),
});

export const globForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, pattern: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const re = new RegExp("^" + a.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    const rows = await roomConceptRows(ctx, a.roomId, 800, access);
    return rows.map(toConcept).filter((concept) => re.test(concept.path)).slice(0, cap(a.limit, 50, 100));
  },
});

export const regexForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, pattern: v.string(), pathPrefix: v.optional(v.string()), caseSensitive: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const re = new RegExp(a.pattern, a.caseSensitive ? "" : "i");
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const concepts = (await filteredConcepts(ctx, a.roomId, { pathPrefix: a.pathPrefix, limit: 800 }, access)).filter((concept) => re.test(`${concept.path}\n${concept.body}`));
    return concepts.map((concept) => ({ concept, score: 1, reasons: ["regex_match"] })).slice(0, cap(a.limit, 8, 50));
  },
});

export const backlinksForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, conceptId: v.string(), depth: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    if (!await readableConceptRow(ctx, a.roomId, a.conceptId, access)) return [];
    const edges = await ctx.db.query("okfEdges").withIndex("by_to", (q) => q.eq("roomId", a.roomId).eq("toConceptId", a.conceptId)).take(cap(a.limit, 25, 100));
    const out: OkfConcept[] = [];
    for (const edge of edges) {
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", edge.fromConceptId)).unique();
      if (row && canReadVisible(row, access)) out.push(toConcept(row));
    }
    return out;
  },
});

export const expandNeighborsForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, conceptId: v.string(), linkDepth: v.number(), includeCitations: v.optional(v.boolean()), includeBacklinks: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    if (!await readableConceptRow(ctx, a.roomId, a.conceptId, access)) return [];
    const out = new Map<string, OkfConcept>();
    const forward = await ctx.db.query("okfEdges").withIndex("by_from", (q) => q.eq("roomId", a.roomId).eq("fromConceptId", a.conceptId)).take(cap(a.limit, 25, 100));
    const backward = a.includeBacklinks ? await ctx.db.query("okfEdges").withIndex("by_to", (q) => q.eq("roomId", a.roomId).eq("toConceptId", a.conceptId)).take(cap(a.limit, 25, 100)) : [];
    for (const edge of [...forward, ...backward]) {
      if (!a.includeCitations && edge.kind === "citation") continue;
      const target = edge.fromConceptId === a.conceptId ? edge.toConceptId : edge.fromConceptId;
      const row = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", target)).unique();
      if (row && canReadVisible(row, access)) out.set(row.conceptId, toConcept(row));
    }
    return [...out.values()].slice(0, cap(a.limit, 25, 100));
  },
});

export const resolveCitationForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, evidenceId: v.string() },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const rows = await roomConceptRows(ctx, a.roomId, 800, access);
    for (const row of rows) {
      const concept = toConcept(row);
      const citation = concept.citations.find((c) => c.id === a.evidenceId);
      if (citation) return literalFromConcept(concept, { evidenceId: a.evidenceId, conceptId: concept.id, citationId: citation.id });
    }
    const direct = rows.find((row) => row.conceptId === a.evidenceId);
    if (direct) return literalFromConcept(toConcept(direct), { evidenceId: a.evidenceId, conceptId: direct.conceptId });
    return await resolveCellEvidence(ctx, a.roomId, a.evidenceId, access) ?? { ok: false, error: "evidence_not_found" };
  },
});

export const openLiteralForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, sourceArtifactId: v.string(), page: v.optional(v.number()), row: v.optional(v.number()), column: v.optional(v.string()), bbox: v.optional(v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number(), unit: v.optional(v.union(v.literal("px"), v.literal("pt"), v.literal("normalized"))) })) },
  handler: async (ctx, a) => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const artifact = await getSourceArtifact(ctx, a.roomId, a.sourceArtifactId, access);
    if (!artifact) {
      return await sourceArtifactNotFoundResult(ctx, a.roomId, access);
    }
    return await literalFromArtifact(ctx, artifact, { page: a.page, row: a.row, column: a.column, bbox: a.bbox });
  },
});

export const compareClaimForAgent = internalQuery({
  args: { roomId: v.id("rooms"), ...agentAccessArgsV, claim: v.string(), evidenceRefs: v.array(evidenceRefV) },
  handler: async (ctx, a): Promise<ClaimSupportResult> => {
    const access = await accessForAgent(ctx, a.roomId, a.actor);
    const claimTokens = tokenizeForRetrieval(a.claim);
    const checkedEvidence: LiteralSourceResult[] = [];
    const missing: string[] = [];
    let best = 0;
    for (const ref of a.evidenceRefs) {
      const row = ref.conceptId ? await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId).eq("conceptId", ref.conceptId!)).unique() : null;
      const literal = literalFromConcept(row && canReadVisible(row, access) ? toConcept(row) : null, ref);
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
    visibility: v.optional(okfVisibilityV),
    ownerId: v.optional(v.string()),
    latencyMs: v.number(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const visibility = normalizeVisibility(a.visibility);
    if (visibility === "private" && !a.ownerId) throw new Error("private_retrieval_event_owner_required");
    return ctx.db.insert("retrievalEvents", { ...a, visibility, createdAt: Date.now() });
  },
});

export const traceLens = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, a) => {
    const access = await accessForRequester(ctx, a.roomId, a.requester);
    const concepts = (await ctx.db.query("okfConcepts").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).order("desc").take(24)).filter((row) => canReadVisible(row, access)).slice(0, 12);
    const edges = await ctx.db.query("okfEdges").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).take(24);
    const events = (await ctx.db.query("retrievalEvents").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).order("desc").take(24))
      .filter((event) => canReadVisible({ visibility: normalizeVisibility(event.visibility), ownerId: event.ownerId }, access))
      .slice(0, 12);
    const outboxRows = await ctx.db.query("okfOutbox").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId)).collect();
    const chunks = (await ctx.db.query("okfChunks").withIndex("by_room_concept", (q) => q.eq("roomId", a.roomId)).take(500)).filter((chunk) => canReadVisible(chunk, access));
    const visibleEventConceptIds = await visibleConceptIdSet(ctx, a.roomId, events.flatMap((event) => event.hitConceptIds), access);
    const visibleConceptIds = new Set(concepts.map((concept) => concept.conceptId));
    const outbox = outboxRows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return {
      concepts: concepts.map((row) => ({ conceptId: row.conceptId, path: row.path, type: row.type, title: row.title, status: row.status, visibility: row.visibility, updatedAt: row.updatedAt })),
      edges: edges.filter((edge) => visibleConceptIds.has(edge.fromConceptId) && visibleConceptIds.has(edge.toConceptId)).map((edge) => ({ fromConceptId: edge.fromConceptId, toConceptId: edge.toConceptId, label: edge.label, kind: edge.kind })),
      events: events.map((event) => ({ tool: event.tool, query: event.query, status: event.status, hitConceptIds: event.hitConceptIds.filter((id) => visibleEventConceptIds.has(id)), latencyMs: event.latencyMs, provider: event.provider, model: event.model, createdAt: event.createdAt })),
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
      claimed.push({ jobId: job._id, roomId: job.roomId, conceptId: job.conceptId, contentHash: job.contentHash, title: concept.title, text: concept.searchText, visibility: concept.visibility, ownerId: concept.ownerId });
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
      ownerId: v.optional(v.string()),
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
