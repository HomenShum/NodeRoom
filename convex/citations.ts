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
      ? pdfs.find((f) => pdfFileMatches(f.fileName, a.fileName!)) ?? pdfs[0]
      : pdfs[0];
    return match ? { storageId: match.storageId, fileName: match.fileName } : null;
  },
});

function pdfFileMatches(actual: string, requested: string): boolean {
  const actualLower = actual.toLowerCase();
  const requestedLower = requested.toLowerCase();
  if (actualLower.includes(requestedLower)) return true;
  const actualNorm = normalizePdfName(actual);
  const requestedNorm = normalizePdfName(requested);
  if (!requestedNorm) return false;
  if (actualNorm.includes(requestedNorm) || requestedNorm.includes(actualNorm)) return true;
  const tokens = requestedNorm.match(/[a-z0-9]{2,}/g) ?? [];
  return tokens.length > 0 && tokens.every((token) => actualNorm.includes(token));
}

function normalizePdfName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

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
