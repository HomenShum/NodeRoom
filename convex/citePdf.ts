"use node";
// The Node half of the agent's PDF-citation tool: parse an uploaded PDF with LiteParse (Node-only —
// hence "use node"; verified to bundle into Convex), find the target value's text item with real
// page coordinates, normalize the box to 0..1 via pdfBox (playwright-free), and persist a citation
// the Trace tab renders as `.r-tracevu-box` on the exact source line. NO Browserbase / no playwright.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { parseWithLiteParse } from "../src/app/liteparseAdapter";
import { normalizeBox } from "../src/nodeagent/capture/pdfBox";

const roomPdfRef = makeFunctionReference<"query">("citations:roomPdf") as any;
const insertCitationRef = makeFunctionReference<"mutation">("citations:insertAgentCitation") as any;

// Loose normalization so "$41,321" / "41,321" / "41321" all match a glyph run.
const norm = (s: string) => s.toLowerCase().replace(/[\s,$%()]/g, "");

type CiteResult = {
  ok: boolean;
  error?: string;
  page?: number;
  box?: { x: number; y: number; w: number; h: number };
  matchedText?: string;
  fileName?: string;
};

export const cite = internalAction({
  args: {
    roomId: v.id("rooms"),
    target: v.string(),
    label: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<CiteResult> => {
    const file = (await ctx.runQuery(roomPdfRef, { roomId: a.roomId, fileName: a.fileName })) as
      | { storageId: string; fileName: string }
      | null;
    if (!file) return { ok: false, error: "no PDF uploaded in this room (upload a .pdf first)" };

    const blob = await ctx.storage.get(file.storageId as any);
    if (!blob) return { ok: false, error: "PDF bytes not found in storage" };
    const bytes = new Uint8Array(await blob.arrayBuffer());

    let parsed;
    try {
      parsed = await parseWithLiteParse({
        file: { fileName: file.fileName, mimeType: "application/pdf" } as any,
        bytes,
        maxPages: 30,
      });
    } catch (e) {
      return { ok: false, error: `pdf parse failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    const want = norm(a.target);
    if (!want) return { ok: false, error: "empty target" };

    for (const page of parsed.pages) {
      for (const item of page.textItems) {
        if (!item.text) continue;
        if (norm(item.text).includes(want)) {
          const overlay = normalizeBox(
            { x: item.x, y: item.y, w: item.width, h: item.height },
            { page: page.pageNum, width: page.width, height: page.height },
            "top-left",
          );
          const box = { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h };
          await ctx.runMutation(insertCitationRef, {
            roomId: a.roomId,
            pdfStorageId: file.storageId,
            page: overlay.page,
            box,
            label: a.label ?? a.target,
            matchedText: item.text,
          });
          return { ok: true, page: overlay.page, box, matchedText: item.text, fileName: file.fileName };
        }
      }
    }
    return { ok: false, error: `"${a.target}" not found in ${file.fileName}` };
  },
});
