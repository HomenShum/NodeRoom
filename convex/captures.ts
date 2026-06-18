/**
 * Live-capture persistence + read (V8 runtime). The Node action (capturesNode.ts) runs the browser
 * pipeline, stores screenshots in Convex storage, then calls `record` here. `byRoom` returns a
 * LIGHTWEIGHT list (screenshot/pdf storage ids, NOT resolved to URLs — avoids N×M `getUrl` calls
 * per reactive re-run); `captureDetail` resolves URLs for the selected record only. `recordCitation`
 * is a member-gated public mutation so a client PDF citation is 1 mutation, 0 actions, 0 storage
 * writes. Reads/writes are gated to room members (requireActorProof).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof } from "./lib";

const MAX_CAPTURE_RECORDS = 20;
const MAX_CITATIONS_PER_ROOM = 100;

type CaptureStepRecord = {
  phase: string;
  label: string;
  status: string;
  detail?: string;
  box?: { x: number; y: number; w: number; h: number; page?: number };
  screenshotId?: Id<"_storage">;
  pdfStorageId?: Id<"_storage">;
};

type CaptureRecordInput = {
  _id: Id<"captureRecords">;
  url: string;
  title?: string;
  goal: string;
  ok: boolean;
  ts: number;
  steps: CaptureStepRecord[];
  data?: unknown;
  error?: string;
};

const captureStepV = v.object({
  phase: v.string(),
  label: v.string(),
  status: v.string(),
  detail: v.optional(v.string()),
  box: v.optional(v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number(), page: v.optional(v.number()) })),
  screenshotId: v.optional(v.id("_storage")),
  pdfStorageId: v.optional(v.id("_storage")),
});

/** Membership gate the action calls BEFORE spending on a capture (admission control — no spend for non-members). */
export const assertMember = internalQuery({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return true;
  },
});

/** Persist a finished capture. Internal — only the action calls it. */
export const record = internalMutation({
  args: {
    roomId: v.id("rooms"),
    url: v.string(),
    goal: v.string(),
    title: v.optional(v.string()),
    ok: v.boolean(),
    error: v.optional(v.string()),
    ts: v.number(),
    steps: v.array(captureStepV),
    data: v.optional(v.any()),
  },
  handler: async (ctx, a) => ctx.db.insert("captureRecords", a),
});

/** Shared TraceRecord builder — one shape for both byRoom (lightweight) and captureDetail (resolved).
 *  `resolveAttachment` returns id-only attachments for byRoom, URL-resolved for captureDetail. */
function buildCaptureRecord(r: CaptureRecordInput, resolveAttachment: (s: CaptureStepRecord, i: number) => unknown[] | undefined) {
  return {
    id: `capture-${r._id}`,
    kind: "agent" as const,
    title: r.title ?? `Live capture · ${safeHost(r.url)}`,
    subtitle: r.goal,
    ts: new Date(r.ts).toISOString(),
    source: { tool: /sec\.gov/i.test(r.url) ? "sec_facts" : "capture_source" },
    verdict: r.ok ? undefined : { label: "capture failed", tone: "risk" as const },
    steps: r.steps.map((s, i) => ({
      idx: i + 1,
      group: s.phase,
      label: s.label,
      status: s.status,
      detail: s.detail,
      attachments: resolveAttachment(s, i),
    })),
    raw: { url: r.url, data: r.data, error: r.error },
  };
}

/** Room captures as Trace records, newest first. LIGHTWEIGHT: screenshot ids are NOT resolved to
 *  URLs here (avoids N×M `ctx.storage.getUrl` calls per reactive re-run). Use `captureDetail` to
 *  resolve URLs for the selected record only. Members only. */
export const byRoom = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    const rows = await ctx.db.query("captureRecords").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(MAX_CAPTURE_RECORDS);
    return rows.map((r) => buildCaptureRecord(r, (s) =>
      s.screenshotId
        ? [{ kind: "screenshot" as const, ...(s.box ? { box: s.box } : {}) }]
        : s.pdfStorageId
          ? [{ kind: "pdf" as const, page: s.box?.page ?? 1, boxes: s.box ? [s.box] : [] }]
          : undefined,
    ));
  },
});

/** Resolve screenshot URLs for ONE capture record (the selected one). Called lazily by the client
 *  only when a capture is expanded — avoids resolving all 20 records' URLs on every reactive re-run. */
export const captureDetail = query({
  args: { roomId: v.id("rooms"), captureId: v.id("captureRecords"), requester: actorProofV },
  handler: async (ctx, { roomId, captureId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    const r = await ctx.db.get(captureId);
    if (!r || r.roomId !== roomId) return null;
    const stepUrls = await Promise.all(r.steps.map(async (s) => ({
      screenshotUrl: s.screenshotId ? await ctx.storage.getUrl(s.screenshotId) : null,
      pdfUrl: s.pdfStorageId ? await ctx.storage.getUrl(s.pdfStorageId) : null,
    })));
    return buildCaptureRecord(r, (s, i) => {
      const { screenshotUrl, pdfUrl } = stepUrls[i];
      return screenshotUrl
        ? [{ kind: "screenshot" as const, url: screenshotUrl, ...(s.box ? { box: s.box } : {}) }]
        : pdfUrl
          ? [{ kind: "pdf" as const, url: pdfUrl, page: s.box?.page ?? 1, boxes: s.box ? [s.box] : [] }]
          : undefined;
    });
  },
});

function safeHost(u: string): string { try { return new URL(u).hostname; } catch { return u; } }

/** Client-citation mutation: a member writes a PDF citation directly (1 mutation, 0 actions, 0
 *  storage writes). The PDF is already in storage (uploaded as a room artifact); the citation just
 *  references it by storage ID + page + normalized box. The client resolves the PDF URL lazily via
 *  `captureDetail` — no `getUrl` in the reactive `byRoom` list.
 *
 *  Security: verifies the `pdfStorageId` belongs to `roomId` (via `uploadedFiles.by_storage`) to
 *  prevent cross-room IDOR. Caps citations at `MAX_CITATIONS_PER_ROOM` per room to prevent DoW. */
export const recordCitation = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    pdfStorageId: v.id("_storage"),
    page: v.number(),
    box: v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
    label: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    // IDOR guard: verify the PDF storage blob belongs to this room (not another room's file).
    const file = await ctx.db.query("uploadedFiles").withIndex("by_storage", (q) => q.eq("storageId", String(a.pdfStorageId))).first();
    if (!file || file.roomId !== a.roomId || file.status === "deleted") {
      throw new Error("PDF not found in this room");
    }
    // Write cap: prevent denial-of-wallet via unbounded citation writes.
    const existing = await ctx.db.query("captureRecords").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).take(MAX_CITATIONS_PER_ROOM + 1);
    if (existing.length >= MAX_CITATIONS_PER_ROOM) {
      throw new Error(`Citation cap reached (${MAX_CITATIONS_PER_ROOM} per room)`);
    }
    return ctx.db.insert("captureRecords", {
      roomId: a.roomId,
      url: a.source ?? "pdf://citation",
      goal: a.label,
      title: a.label,
      ok: true,
      ts: Date.now(),
      steps: [{
        phase: "citation",
        label: a.label,
        status: "ok",
        box: { ...a.box, page: a.page },
        pdfStorageId: a.pdfStorageId,
      }],
      data: { kind: "pdf_citation", page: a.page, citedBy: actor.id },
    });
  },
});
