/**
 * ConvexRoomTools — the RoomTools port implemented over Convex. It is the ONLY
 * thing that differs between the spike and production: the agent harness
 * (context.ts, tools.ts, runtime.ts) is byte-for-byte identical; here each method
 * just runs a Convex query/mutation instead of calling the in-memory engine.
 *
 * Note the result MAPPING: the Convex mutations return their own shapes
 * (`{ ok:false, reason:'conflict', ... }`); we translate them to the harness's
 * RoomTools shapes (`{ ok:false, conflict:true, ... }`) so the model sees one
 * stable contract regardless of transport.
 */

import { makeFunctionReference } from "convex/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { RoomTools, RoomSnapshot, AwarenessView, CellView, EditOutcome, MergeView, SourceResult, ArtifactRef, SpreadsheetContextHit, SetColumnsOutcome, ReadNotebookOutcome, ApplyNotebookOutlineOutcome, ApplyNotebookBlockEditOutcome, NotebookEnrichmentPlan, NotebookOutlineSection } from "../src/nodeagent/core/types";
import type { Actor } from "../src/engine/types";
import type { ClaimSupportResult, EvidenceRef, LiteralSourceResult, OkfConceptFilter, OkfRetrievalPort, RetrievalHit } from "../src/nodeagent/retrieval/types";
import type { OkfConcept } from "../src/nodeagent/okf/types";
import { embedOkfText } from "./okfEmbeddingProvider";

const artifactsGetSheetRef = makeFunctionReference<"query">("artifacts:getSheet") as any;
const collabAwarenessRef = makeFunctionReference<"query">("collab:awareness") as any;
const artifactsReadRangeRef = makeFunctionReference<"query">("artifacts:readRange") as any;
const artifactsSearchSheetContextRef = makeFunctionReference<"query">("artifacts:searchSheetContext") as any;
const locksProposeLockRef = makeFunctionReference<"mutation">("locks:proposeLock") as any;
const locksReleaseLockRef = makeFunctionReference<"mutation">("locks:releaseLock") as any;
const artifactsApplyAgentCellEditRef = makeFunctionReference<"mutation">("artifacts:applyAgentCellEdit") as any;
const artifactsCreateAgentFileArtifactRef = makeFunctionReference<"mutation">("artifacts:createAgentFileArtifact") as any;
const artifactsSetArtifactMetaByAgentRef = makeFunctionReference<"mutation">("artifacts:setArtifactMetaByAgent") as any;
const artifactsSetColumnsByAgentRef = makeFunctionReference<"mutation">("artifacts:setColumnsByAgent") as any;
const presenceHeartbeatForAgentRef = makeFunctionReference<"mutation">("presence:heartbeatForAgent") as any;
const presenceReleaseForAgentRef = makeFunctionReference<"mutation">("presence:releaseForAgent") as any;
const draftsCreateDraftRef = makeFunctionReference<"mutation">("drafts:createDraft") as any;
const messagesSendAgentRef = makeFunctionReference<"mutation">("messages:sendAgent") as any;
const artifactsListForRoomRef = makeFunctionReference<"query">("artifacts:listForRoom") as any;
const okfListConceptsRef = makeFunctionReference<"query">("okf:listConceptsForAgent") as any;
const okfReadConceptRef = makeFunctionReference<"query">("okf:readConceptForAgent") as any;
const okfFullTextSearchRef = makeFunctionReference<"query">("okf:fullTextSearchForAgent") as any;
const okfSemanticSearchScanRef = makeFunctionReference<"query">("okf:semanticSearchScanForAgent") as any;
const okfConceptsForChunkScoresRef = makeFunctionReference<"query">("okf:conceptsForChunkScoresForAgent") as any;
const okfFilterRef = makeFunctionReference<"query">("okf:filterForAgent") as any;
const okfGlobRef = makeFunctionReference<"query">("okf:globForAgent") as any;
const okfRegexRef = makeFunctionReference<"query">("okf:regexForAgent") as any;
const okfBacklinksRef = makeFunctionReference<"query">("okf:backlinksForAgent") as any;
const okfExpandNeighborsRef = makeFunctionReference<"query">("okf:expandNeighborsForAgent") as any;
const okfResolveCitationRef = makeFunctionReference<"query">("okf:resolveCitationForAgent") as any;
const okfOpenLiteralRef = makeFunctionReference<"query">("okf:openLiteralForAgent") as any;
const okfCompareClaimRef = makeFunctionReference<"query">("okf:compareClaimForAgent") as any;
const okfRecordRetrievalEventRef = makeFunctionReference<"mutation">("okf:recordRetrievalEvent") as any;
const capturesRecordRef = makeFunctionReference<"mutation">("captures:record") as any;
const notebookReadForAgentRef = makeFunctionReference<"query">("notebookAgent:readNotebookForAgent") as any;
const notebookEnsureForAgentRef = makeFunctionReference<"mutation">("notebookAgent:ensureNotebookDocForAgent") as any;
const notebookApplyOutlineRef = makeFunctionReference<"mutation">("notebookAgent:applyOutlineByAgent") as any;
const notebookApplyBlockEditRef = makeFunctionReference<"mutation">("notebookAgent:applyBlockEditByAgent") as any;
const notebookPlanEnrichmentRef = makeFunctionReference<"query">("notebookAgent:planNotebookEnrichmentForAgent") as any;
const citePdfCiteRef = makeFunctionReference<"action">("citePdf:cite") as any;
const evidenceRecordSourceCaptureRef = makeFunctionReference<"mutation">("evidence:recordSourceCapture") as any;
const evidenceRecordEvidenceFactRef = makeFunctionReference<"mutation">("evidence:recordEvidenceFact") as any;

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ConvexRoomTools implements RoomTools {
  public readonly okf: OkfRetrievalPort;

  constructor(
    private ctx: ActionCtx,
    private roomId: Id<"rooms">,
    private artifactId: Id<"artifacts">,
    private actor: Actor,
    private sessionId: string,
    private jobId?: Id<"agentJobs">,
  ) {
    this.okf = new ConvexOkfRetrievalPort(ctx, roomId, actor, jobId);
  }

  async snapshot(artifactId: string = this.artifactId): Promise<RoomSnapshot> {
    const s = await this.ctx.runQuery(artifactsGetSheetRef, { roomId: this.roomId, artifactId });
    return s ?? { artifactId, version: 0, kind: "sheet", rows: [] };
  }

  async listArtifacts(): Promise<ArtifactRef[]> {
    const artifacts = await this.ctx.runQuery(artifactsListForRoomRef, { roomId: this.roomId }) as Array<ArtifactRef & { meta?: unknown }>;
    return artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      ...artifactReadHint(artifact),
    }));
  }

  async setArtifactMeta(args: { artifactId: string; title?: string; summary?: string; tags?: string[] }): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ctx.runMutation(artifactsSetArtifactMetaByAgentRef, { roomId: this.roomId, artifactId: args.artifactId, title: args.title, summary: args.summary, tags: args.tags, actor: this.actor });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "failed" };
    }
  }

  async createFileArtifacts(args: {
    files: Array<{ fileName: string; mimeType: string; size: number; dataUrl?: string; text?: string }>;
    summary?: string;
    sourceArtifactIds?: string[];
    sourceUrls?: string[];
  }): Promise<{ ok: true; artifacts: ArtifactRef[] } | { ok: false; error: string }> {
    try {
      const artifacts: ArtifactRef[] = [];
      for (const file of args.files) {
        const result = await this.ctx.runMutation(artifactsCreateAgentFileArtifactRef, {
          roomId: this.roomId,
          actor: this.actor,
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
          dataUrl: file.dataUrl,
          text: file.text,
          summary: args.summary,
          sourceArtifactIds: args.sourceArtifactIds,
          sourceUrls: args.sourceUrls,
        });
        artifacts.push({ id: String(result.artifactId), title: file.fileName, kind: "note" });
      }
      return { ok: true, artifacts };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "create_file_artifacts_failed" };
    }
  }

  /** Agent-governed SCHEMA edit (define_columns): declare/replace a sheet's COLUMNS, CAS-guarded on the
   *  artifact version. A stale baseVersion is returned as { conflict } DATA so the runtime re-reads/retries.
   *  Mirrors RoomEngine.setColumns / InMemoryRoomTools.setColumns — same SetColumnsOutcome contract. */
  async setColumns(args: { artifactId?: string; baseVersion: number; mode: "replace" | "merge"; columns: Array<{ label: string; type?: string; agentWritable?: boolean }> }): Promise<SetColumnsOutcome> {
    const r = await this.ctx.runMutation(artifactsSetColumnsByAgentRef, {
      roomId: this.roomId,
      artifactId: (args.artifactId ?? this.artifactId) as Id<"artifacts">,
      baseVersion: args.baseVersion,
      mode: args.mode,
      columns: args.columns,
      actor: this.actor,
    });
    if (r.ok) return { ok: true, version: r.version, columns: r.columns };
    if (r.reason === "conflict") return { ok: false, conflict: true, expected: r.expected, actual: r.actual };
    return { ok: false, error: r.reason ?? "set_columns_failed" };
  }

  /** Structured block view of a note artifact. Ensures the synced doc first
   *  (idempotent; seeds from legacy HTML), so reads always serve the synced
   *  lane — the agent never sees a doc its writes can't target. */
  async readNotebook(args: { artifactId?: string }): Promise<ReadNotebookOutcome> {
    const artifactId = (args.artifactId ?? this.artifactId) as Id<"artifacts">;
    try {
      await this.ctx.runMutation(notebookEnsureForAgentRef, { roomId: this.roomId, artifactId, actor: this.actor });
      return await this.ctx.runQuery(notebookReadForAgentRef, { roomId: this.roomId, artifactId, actor: this.actor });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "read_notebook_failed" };
    }
  }

  /** Governed outline append. Heartbeats an agent-intent presence claim on the
   *  notebook (targetKind "notebook_block") BEFORE the write, so the UI draws
   *  the intent indicator before content lands — the cell intent-box pattern. */
  async applyNotebookOutline(args: {
    artifactId?: string;
    title?: string;
    parentBlockId?: string;
    mode?: "append" | "merge";
    sections: NotebookOutlineSection[];
  }): Promise<ApplyNotebookOutlineOutcome> {
    const artifactId = (args.artifactId ?? this.artifactId) as Id<"artifacts">;
    if (this.actor.kind === "agent") {
      await this.ctx.runMutation(presenceHeartbeatForAgentRef, {
        roomId: this.roomId,
        artifactId,
        targetKind: "notebook_block",
        targetId: args.parentBlockId ?? "agent-section",
        mode: "agent_intent",
        actor: this.actor,
        label: `${this.actor.name} drafting notes`,
        ttlMs: 45_000,
      }).catch(() => null);
    }
    try {
      const r = await this.ctx.runMutation(notebookApplyOutlineRef, {
        roomId: this.roomId,
        artifactId,
        actor: this.actor,
        jobId: this.jobId,
        runLabel: this.sessionId,
        title: args.title,
        parentBlockId: args.parentBlockId,
        mode: args.mode,
        sections: args.sections,
      });
      if (r.ok) return {
        ok: true,
        lane: r.lane ?? "synced_doc",
        blockIds: r.blockIds ?? [],
        dedupedSections: r.dedupedSections ?? 0,
        needsReviewCount: r.needsReviewCount ?? 0,
        noop: r.noop,
        artifactVersion: r.artifactVersion,
        mutationReceiptId: r.mutationReceiptId ? String(r.mutationReceiptId) : undefined,
      };
      if (r.reason === "pending_approval") return { ok: false, pendingApproval: true, proposalId: r.proposalId };
      if (r.reason === "no_such_block") return { ok: false, noSuchBlock: true, parentBlockId: r.parentBlockId, currentBlocks: r.currentBlocks };
      return { ok: false, error: String(r.reason ?? "apply_notebook_outline_failed") };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "apply_notebook_outline_failed" };
    } finally {
      // Release the pre-write "drafting notes" intent claim — its promise is
      // false the instant the write call above returns, success or failure.
      if (this.actor.kind === "agent") {
        await this.ctx.runMutation(presenceReleaseForAgentRef, {
          roomId: this.roomId,
          artifactId,
          targetKind: "notebook_block",
          targetId: args.parentBlockId ?? "agent-section",
          actor: this.actor,
          mode: "agent_intent",
        }).catch(() => null);
      }
    }
  }

  /** Governed single-block edit — same presence-intent pattern as cell writes. */
  async applyNotebookBlockEdit(args: {
    artifactId?: string;
    blockId: string;
    baseTextHash?: string;
    action: "replace" | "append_children" | "annotate";
    content: string;
    reason?: string;
  }): Promise<ApplyNotebookBlockEditOutcome> {
    const artifactId = (args.artifactId ?? this.artifactId) as Id<"artifacts">;
    if (this.actor.kind === "agent") {
      await this.ctx.runMutation(presenceHeartbeatForAgentRef, {
        roomId: this.roomId,
        artifactId,
        targetKind: "notebook_block",
        targetId: args.blockId,
        mode: "agent_intent",
        actor: this.actor,
        label: `${this.actor.name} ${args.action === "annotate" ? "annotating" : "editing"} a block`,
        ttlMs: 45_000,
      }).catch(() => null);
    }
    try {
      const r = await this.ctx.runMutation(notebookApplyBlockEditRef, {
        roomId: this.roomId,
        artifactId,
        actor: this.actor,
        jobId: this.jobId,
        runLabel: this.sessionId,
        blockId: args.blockId,
        baseTextHash: args.baseTextHash,
        action: args.action,
        content: args.content,
        reason: args.reason,
      });
      if (r.ok) return { ok: true, lane: r.lane ?? "synced_doc", action: args.action, blockIds: r.blockIds ?? [] };
      if (r.reason === "pending_approval") return { ok: false, pendingApproval: true, proposalId: r.proposalId };
      if (r.reason === "no_such_block") return { ok: false, noSuchBlock: true, blockId: r.blockId, currentBlocks: r.currentBlocks };
      if (r.reason === "block_conflict") return { ok: false, blockConflict: true, currentText: r.currentText, currentTextHash: r.currentTextHash };
      if (r.reason === "human_block_protected") return { ok: false, humanBlockProtected: true, hint: r.hint };
      return { ok: false, error: String(r.reason ?? "update_notebook_block_failed") };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "update_notebook_block_failed" };
    } finally {
      // Same release-on-resolution as applyNotebookOutline above.
      if (this.actor.kind === "agent") {
        await this.ctx.runMutation(presenceReleaseForAgentRef, {
          roomId: this.roomId,
          artifactId,
          targetKind: "notebook_block",
          targetId: args.blockId,
          actor: this.actor,
          mode: "agent_intent",
        }).catch(() => null);
      }
    }
  }

  async planNotebookEnrichment(args: { artifactId?: string; maxTargets?: number }): Promise<NotebookEnrichmentPlan> {
    const artifactId = (args.artifactId ?? this.artifactId) as Id<"artifacts">;
    try {
      await this.ctx.runMutation(notebookEnsureForAgentRef, { roomId: this.roomId, artifactId, actor: this.actor });
      return await this.ctx.runQuery(notebookPlanEnrichmentRef, { roomId: this.roomId, artifactId, actor: this.actor, maxTargets: args.maxTargets });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "plan_notebook_enrichment_failed" };
    }
  }

  awareness(): Promise<AwarenessView> {
    return this.ctx.runQuery(collabAwarenessRef, { roomId: this.roomId, excludeAgentId: this.actor.id });
  }

  async readRange(elementIds: string[], artifactId?: string): Promise<CellView[]> {
    const explicitArtifactId = !!artifactId;
    const targetArtifactId = artifactId || this.artifactId;
    const cells = await this.ctx.runQuery(artifactsReadRangeRef, { roomId: this.roomId, artifactId: targetArtifactId, elementIds }) as CellView[];
    if (!explicitArtifactId && looksLikeExcelAddressRead(elementIds) && cells.every((cell) => cell.version === 0 && (cell.value === null || cell.value === ""))) {
      const artifacts = await this.ctx.runQuery(artifactsListForRoomRef, { roomId: this.roomId }) as ArtifactRef[];
      const candidates = artifacts
        .filter((artifact) => artifact.kind === "sheet" && String(artifact.id) !== String(targetArtifactId))
        .slice(0, 8)
        .map((artifact) => ({ id: artifact.id, title: artifact.title, kind: artifact.kind }));
      if (candidates.length) {
        const hint = `No A1-style cells were found on the primary blank Sheet 1. Use list_artifacts, then call read_range/search_sheet_context again with artifactId for the uploaded source workbook. Candidate artifactIds: ${candidates.map((artifact) => `${artifact.title}=${artifact.id}`).join("; ")}.`;
        return cells.map((cell) => ({ ...cell, hint, candidateArtifacts: candidates }));
      }
    }
    return cells;
  }

  searchSheetContext(query: string, artifactId: string = this.artifactId, limit = 8): Promise<SpreadsheetContextHit[]> {
    return this.ctx.runQuery(artifactsSearchSheetContextRef, { roomId: this.roomId, artifactId, query, limit });
  }

  async proposeLock(elementIds: string[], reason: string, artifactId: string = this.artifactId) {
    const r = await this.ctx.runMutation(locksProposeLockRef, { roomId: this.roomId, artifactId, elementIds, holder: this.actor, sessionId: this.sessionId, reason });
    return r.ok ? { ok: true as const, lockId: String(r.lockId) } : { ok: false as const, reason: r.reason, lockId: r.lockId ? String(r.lockId) : undefined };
  }

  async releaseLock(lockId: string): Promise<{ ok?: boolean; reason?: string; merged: MergeView[] }> {
    const r = await this.ctx.runMutation(locksReleaseLockRef, { lockId: lockId as Id<"locks">, actor: this.actor });
    if (!r.ok) return { ok: false, reason: r.reason, merged: [] };
    const merged = (r.merged ?? []).map((m: { draftId: unknown; verdict: string; applied: number; conflicts: number }) => ({ draftId: String(m.draftId), verdict: m.verdict, note: "", applied: m.applied, conflicts: m.conflicts }));
    return { merged };
  }

  async editCell(elementId: string, value: unknown, baseVersion: number, artifactId: string = this.artifactId, kind?: "set" | "create" | "delete"): Promise<EditOutcome> {
    if (this.actor.kind === "agent") {
      await this.ctx.runMutation(presenceHeartbeatForAgentRef, {
        roomId: this.roomId,
        artifactId,
        targetKind: "cell",
        targetId: elementId,
        mode: "agent_intent",
        actor: this.actor,
        label: `${this.actor.name} planning`,
        ttlMs: 45_000,
      });
      await this.ctx.runMutation(presenceHeartbeatForAgentRef, {
        roomId: this.roomId,
        artifactId,
        targetKind: "cell",
        targetId: elementId,
        mode: "commit_lease",
        actor: this.actor,
        label: `${this.actor.name} checking CAS`,
        ttlMs: 20_000,
      });
    }
    try {
      const r = await this.ctx.runMutation(artifactsApplyAgentCellEditRef, { roomId: this.roomId, artifactId, elementId, value, baseVersion, kind, actor: this.actor, jobId: this.jobId });
      if (r.ok) return { ok: true, version: r.version, mutationReceiptId: r.mutationReceiptId ? String(r.mutationReceiptId) : undefined };
      if (r.reason === "conflict") return { ok: false, conflict: true, expected: r.expected, actual: r.actual };
      if (r.reason === "locked") return { ok: false, locked: true, holder: r.by };
      if (r.reason === "pending_approval") return { ok: false, pendingApproval: true, proposalId: r.proposalId ? String(r.proposalId) : undefined };
      return { ok: false, error: r.reason };
    } finally {
      // Root-cause fix: release BOTH pre-write claims ("planning" +
      // "checking CAS") the instant this call resolves, instead of letting
      // them sit for their full TTL (up to 45s). Without this, a batch write
      // (e.g. 55 underwriting cells) left every cell "present" for tens of
      // seconds after the agent had already moved past it — the exact bug
      // that showed a wall of terracotta "Room NodeAgent" chips post-write.
      if (this.actor.kind === "agent") {
        await this.ctx.runMutation(presenceReleaseForAgentRef, {
          roomId: this.roomId,
          artifactId,
          targetKind: "cell",
          targetId: elementId,
          actor: this.actor,
        }).catch(() => null);
      }
    }
  }

  async createDraft(ops: { elementId: string; value: unknown; baseVersion: number }[], blockedByLockId: string, note: string, artifactId: string = this.artifactId) {
    const r = await this.ctx.runMutation(draftsCreateDraftRef, {
      roomId: this.roomId, artifactId, author: this.actor, note, blockedByLockId,
      ops: ops.map((o) => ({ opId: crypto.randomUUID(), artifactId: String(artifactId), elementId: o.elementId, kind: "set" as const, value: o.value, baseVersion: o.baseVersion })),
    });
    return { draftId: String(r.draftId) };
  }

  async say(text: string): Promise<void> {
    const channel = this.actor.scope === "private" && this.actor.ownerId ? this.actor.ownerId : "public";
    await this.ctx.runMutation(messagesSendAgentRef, { roomId: this.roomId, channel, author: this.actor, text, clientMsgId: crypto.randomUUID(), kind: "agent" });
  }

  /** Convex-standard-runtime source fetch: HTTPS-only, target-guarded, timeout-bound, and size-capped. */
  fetchSource(url: string): Promise<SourceResult> { return fetchSourceForConvex(url); }

  /** Persist an agent's live capture (screenshots → Convex storage, boxes kept) → renders in the Trace tab. */
  /** Ground a figure from an uploaded PDF: citePdf.cite (Node) parses + locates + boxes + persists. */
  async citeInFile(input: { target: string; label?: string; fileName?: string }): Promise<unknown> {
    return this.ctx.runAction(citePdfCiteRef, {
      roomId: this.roomId,
      target: input.target,
      label: input.label,
      fileName: input.fileName,
    });
  }

  async recordCapture(input: {
    url: string; goal: string; ok: boolean; title?: string; error?: string;
    data?: Record<string, unknown>;
    steps: Array<{ phase: string; label: string; status: string; detail?: string; box?: { x: number; y: number; w: number; h: number }; screenshotPng?: Uint8Array }>;
  }): Promise<void> {
    const steps: Array<Record<string, unknown>> = [];
    for (const s of input.steps) {
      let screenshotId: string | undefined;
      if (s.screenshotPng && s.screenshotPng.byteLength) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Uint8Array is a valid BlobPart at runtime; the DOM type isn't in Convex's Node tsconfig.
        screenshotId = (await this.ctx.storage.store(new Blob([s.screenshotPng as any], { type: "image/png" }))) as string;
      }
      const step: Record<string, unknown> = { phase: s.phase, label: s.label, status: s.status };
      if (s.detail !== undefined) step.detail = s.detail;
      if (s.box) step.box = s.box;
      if (screenshotId) step.screenshotId = screenshotId;
      steps.push(step);
    }
    await this.ctx.runMutation(capturesRecordRef, {
      roomId: this.roomId, url: input.url, goal: input.goal, title: input.title,
      ok: input.ok, error: input.error, ts: Date.now(), steps, data: input.data,
    });
    try {
      const contentHash = await sha256hex(JSON.stringify({ url: input.url, title: input.title, data: input.data, steps }));
      const firstScreenshotId = steps.map((s) => s.screenshotId).find((id): id is string => typeof id === "string");
      const visibility = this.actor.scope === "private" ? "private" : "room";
      const captureId = await this.ctx.runMutation(evidenceRecordSourceCaptureRef, {
        roomId: this.roomId,
        sourceUrl: input.url,
        sourceTitle: input.title,
        sourceKind: "web",
        contentHash,
        screenshotStorageId: firstScreenshotId,
        provider: "firecrawl",
        capturedByJobId: this.jobId,
        visibility,
        ownerId: visibility === "private" ? this.actor.ownerId : undefined,
      });
      for (const [key, value] of Object.entries(input.data ?? {})) {
        await this.ctx.runMutation(evidenceRecordEvidenceFactRef, {
          roomId: this.roomId,
          captureId,
          factId: `${contentHash}:${key}`,
          label: key,
          value,
          confidence: input.ok ? "medium" : "low",
          checks: { captureOk: input.ok, sourceUrl: input.url },
          usedBy: this.jobId ? [{ kind: "agentJob", id: String(this.jobId) }] : [],
          createdByJobId: this.jobId,
        });
      }
    } catch {
      // Evidence Accountant is additive. The older trace-facing capture record above remains durable.
    }
  }
}

function looksLikeExcelAddressRead(elementIds: string[]): boolean {
  return elementIds.some((id) => /^[A-Z]{1,3}\d+$/i.test(id.trim()));
}

function artifactReadHint(artifact: ArtifactRef & { meta?: unknown }): Pick<ArtifactRef, "readHint" | "exampleElementIds"> {
  if (artifact.kind !== "sheet") return {};
  const meta = artifact.meta as { excelGrid?: { rows?: unknown; columns?: unknown; sheetName?: unknown }; dataframe?: { columns?: unknown } } | undefined;
  const grid = meta?.excelGrid;
  if (typeof grid?.rows === "number" && typeof grid?.columns === "number") {
    const sheetName = typeof grid.sheetName === "string" ? ` (${grid.sheetName})` : "";
    return {
      readHint: `Uploaded workbook grid${sheetName}: pass artifactId="${artifact.id}" to search_sheet_context/read_range; cells use A1 ids such as A1, B2, C10.`,
      exampleElementIds: ["A1", "B2", "C10"],
    };
  }
  const columns = Array.isArray(meta?.dataframe?.columns) ? meta.dataframe.columns : [];
  if (columns.length) {
    return {
      readHint: `Structured sheet: pass artifactId="${artifact.id}" when reading this file; cells usually use rowId__columnId ids.`,
    };
  }
  return {};
}

class ConvexOkfRetrievalPort implements OkfRetrievalPort {
  constructor(
    private ctx: ActionCtx,
    private roomId: Id<"rooms">,
    private actor: Actor,
    private jobId?: Id<"agentJobs">,
  ) {}

  async listConcepts(args: OkfConceptFilter): Promise<OkfConcept[]> {
    const startedAt = Date.now();
    try {
      const concepts = await this.ctx.runQuery(okfListConceptsRef, { roomId: this.roomId, actor: this.actor, ...args });
      await this.record("okf.listConcepts", JSON.stringify(args), "completed", concepts.map((c: OkfConcept) => c.id), Date.now() - startedAt);
      return concepts;
    } catch (error) {
      await this.record("okf.listConcepts", JSON.stringify(args), "failed", [], Date.now() - startedAt, undefined, undefined, error);
      throw error;
    }
  }

  readConcept(args: { conceptId: string }): Promise<OkfConcept | null> {
    return this.ctx.runQuery(okfReadConceptRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  async fullTextSearch(args: { query: string; fields?: Array<"title" | "description" | "body" | "citations">; limit?: number } & OkfConceptFilter): Promise<RetrievalHit[]> {
    return this.hitQuery("okf.fullTextSearch", args.query, okfFullTextSearchRef, args as unknown as Record<string, unknown>);
  }

  async semanticSearch(args: { query: string; limit?: number } & OkfConceptFilter): Promise<RetrievalHit[]> {
    const startedAt = Date.now();
    let provider: string | undefined;
    let model: string | undefined;
    try {
      const embedded = await embedOkfText(args.query, "RETRIEVAL_QUERY", {
        artifacts: this.actor.scope === "private" ? [{ title: "Private OKF retrieval query", visibility: "private", source: "manual" }] : [],
      });
      provider = embedded.provider;
      model = embedded.model;
      try {
        const vectorHits = await (this.ctx as any).vectorSearch("okfChunks", "by_embedding", {
          vector: embedded.vector,
          limit: Math.max(1, Math.min(args.limit ?? 8, 50)),
          filter: (q: any) => q.eq("roomId", this.roomId),
        });
        if (Array.isArray(vectorHits) && vectorHits.length > 0) {
          const hits = await this.ctx.runQuery(okfConceptsForChunkScoresRef, {
            roomId: this.roomId,
            actor: this.actor,
            scores: vectorHits.map((hit: { _id: Id<"okfChunks">; _score?: number }) => ({ chunkId: hit._id, score: hit._score ?? 0 })),
            limit: args.limit,
          });
          if (hits.length > 0) {
            await this.record("okf.semanticSearch", args.query, "completed", hits.map((hit: RetrievalHit) => hit.concept.id), Date.now() - startedAt, provider, model);
            return hits;
          }
        }
      } catch {
        // Local convex-test does not expose vectorSearch; scan fallback below keeps the port usable.
      }
      const hits = await this.ctx.runQuery(okfSemanticSearchScanRef, { roomId: this.roomId, actor: this.actor, ...args });
      await this.record("okf.semanticSearch.scan", args.query, "completed", hits.map((hit: RetrievalHit) => hit.concept.id), Date.now() - startedAt, provider, model);
      return hits;
    } catch (error) {
      const hits = await this.ctx.runQuery(okfSemanticSearchScanRef, { roomId: this.roomId, actor: this.actor, ...args });
      await this.record("okf.semanticSearch.fallback", args.query, "completed", hits.map((hit: RetrievalHit) => hit.concept.id), Date.now() - startedAt, provider, model, error);
      return hits;
    }
  }

  filter(args: OkfConceptFilter): Promise<OkfConcept[]> {
    return this.ctx.runQuery(okfFilterRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  glob(args: { pattern: string; limit?: number }): Promise<OkfConcept[]> {
    return this.ctx.runQuery(okfGlobRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  async regex(args: { pattern: string; pathPrefix?: string; caseSensitive?: boolean; limit?: number }): Promise<RetrievalHit[]> {
    return this.hitQuery("okf.regex", args.pattern, okfRegexRef, args);
  }

  backlinks(args: { conceptId: string; depth?: number; limit?: number }): Promise<OkfConcept[]> {
    return this.ctx.runQuery(okfBacklinksRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  expandNeighbors(args: { conceptId: string; linkDepth: number; includeCitations?: boolean; includeBacklinks?: boolean; limit?: number }): Promise<OkfConcept[]> {
    return this.ctx.runQuery(okfExpandNeighborsRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  resolveCitation(args: { evidenceId: string }): Promise<LiteralSourceResult> {
    return this.ctx.runQuery(okfResolveCitationRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  openLiteral(args: {
    sourceArtifactId: string;
    page?: number;
    row?: number;
    column?: string;
    bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" };
  }): Promise<LiteralSourceResult> {
    return this.ctx.runQuery(okfOpenLiteralRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  compareClaim(args: { claim: string; evidenceRefs: EvidenceRef[] }): Promise<ClaimSupportResult> {
    return this.ctx.runQuery(okfCompareClaimRef, { roomId: this.roomId, actor: this.actor, ...args });
  }

  private async hitQuery(tool: string, query: string, ref: unknown, args: Record<string, unknown>): Promise<RetrievalHit[]> {
    const startedAt = Date.now();
    try {
      const hits = await this.ctx.runQuery(ref as any, { roomId: this.roomId, actor: this.actor, ...args });
      await this.record(tool, query, "completed", hits.map((hit: RetrievalHit) => hit.concept.id), Date.now() - startedAt);
      return hits;
    } catch (error) {
      await this.record(tool, query, "failed", [], Date.now() - startedAt, undefined, undefined, error);
      throw error;
    }
  }

  private async record(
    tool: string,
    query: string,
    status: "completed" | "failed",
    hitConceptIds: string[],
    latencyMs: number,
    provider?: string,
    model?: string,
    error?: unknown,
  ) {
    await this.ctx.runMutation(okfRecordRetrievalEventRef, {
      roomId: this.roomId,
      jobId: this.jobId,
      query: query.slice(0, 500),
      tool,
      status,
      candidateIds: hitConceptIds,
      hitConceptIds,
      visibility: this.actor.scope === "private" && this.actor.ownerId ? "private" : "public",
      ownerId: this.actor.scope === "private" && this.actor.ownerId ? this.actor.ownerId : undefined,
      latencyMs,
      provider,
      model,
      error: error ? (error instanceof Error ? error.message : String(error)).slice(0, 500) : undefined,
    });
  }
}

export async function fetchSourceForConvex(url: string): Promise<SourceResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "https_required" };
  const hostBlock = blockedConvexFetchHost(parsed.hostname);
  if (hostBlock) return { ok: false, error: hostBlock };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    let current = parsed;
    let res: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "NodeRoomAgent/0.1" },
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      if (!location) return { ok: false, error: "redirect_missing_location" };
      const next = new URL(location, current);
      if (next.protocol !== "https:") return { ok: false, error: "https_required" };
      const redirectBlock = blockedConvexFetchHost(next.hostname);
      if (redirectBlock) return { ok: false, error: redirectBlock };
      current = next;
      if (redirects === 5) return { ok: false, error: "too_many_redirects" };
    }
    if (!res) return { ok: false, error: "fetch_failed" };
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return {
        ok: true,
        title: current.hostname,
        snippet: `Text fetch unavailable with HTTP ${res.status}. Use capture_source for browser-rendered evidence or choose an unauthenticated source endpoint.`,
        url: current.toString(),
      };
    }
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const raw = (await res.text()).slice(0, 50_000);
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim()
      || current.hostname;
    const snippet = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1_200);
    return { ok: true, title, snippet, url: current.toString() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function blockedConvexFetchHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host.includes("%")) return "blocked_host";
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "169.254.169.254"
  ) {
    return "blocked_private_or_metadata_host";
  }
  const v4 = normalizedIpv4(host);
  if (v4 && privateOrReservedIpv4(v4)) return "blocked_private_or_reserved_ip";
  if (privateOrReservedIpv6(host)) return "blocked_private_or_reserved_ip";
  return null;
}

function normalizedIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : Number.NaN;
  });
  return nums.every((n) => Number.isInteger(n)) ? nums : null;
}

function privateOrReservedIpv4(ip: number[]): boolean {
  const [a, b] = ip;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function privateOrReservedIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("0:0:0:0:0:0:0:1")
  );
}
