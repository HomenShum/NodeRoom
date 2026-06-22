// Agent PDF-citation helpers (V8 runtime). The cite_in_file agent tool → citePdf.cite ("use node",
// runs LiteParse) → these: roomPdf resolves the room's uploaded PDF; insertAgentCitation writes a
// captureRecords row (kind: pdf_citation) that the Trace tab renders as a `.r-tracevu-box` over the
// exact source line. Mirrors captures:recordCitation's insert but is server-internal (no client proof),
// so the trusted agent runtime can ground a figure end-to-end. IDOR-guarded: the PDF must belong to the room.
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/** Resolve the room's uploaded PDF (by fileName substring, else the most recent). */
export const roomPdf = internalQuery({
  args: { roomId: v.id("rooms"), fileName: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ storageId: string; fileName: string } | null> => {
    const files = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_room", (q) => q.eq("roomId", a.roomId))
      .order("desc")
      .collect();
    const pdfs = files.filter(
      (f) => f.status !== "deleted" && (/pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.fileName)),
    );
    const match = a.fileName
      ? pdfs.find((f) => f.fileName.toLowerCase().includes(a.fileName!.toLowerCase()))
      : pdfs[0];
    return match ? { storageId: match.storageId, fileName: match.fileName } : null;
  },
});

/** Insert a pdf_citation capture record (already-normalized 0..1 box) — renders the highlight overlay. */
export const insertAgentCitation = internalMutation({
  args: {
    roomId: v.id("rooms"),
    pdfStorageId: v.string(),
    page: v.number(),
    box: v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
    label: v.string(),
    matchedText: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ recordId: string }> => {
    // IDOR: the PDF must belong to this room.
    const file = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", a.pdfStorageId))
      .first();
    if (!file || file.roomId !== a.roomId || file.status === "deleted") {
      throw new Error("PDF not found in this room");
    }
    const recordId = await ctx.db.insert("captureRecords", {
      roomId: a.roomId,
      url: "pdf://citation",
      goal: a.label,
      title: a.label,
      ok: true,
      ts: Date.now(),
      steps: [
        {
          phase: "citation",
          label: a.label,
          status: "ok",
          box: { ...a.box, page: a.page },
          pdfStorageId: a.pdfStorageId as Id<"_storage">,
        },
      ],
      data: { kind: "pdf_citation", page: a.page, matchedText: a.matchedText },
    });
    return { recordId: String(recordId) };
  },
});
