"use node";
// The Node half of the agent's PDF-citation tool: parse an uploaded PDF with unpdf (pure-JS,
// serverless PDF.js — no native module, so it RUNS in Convex; LiteParse bundles but its native
// linux-arm64 binary fails to load at runtime), find the target value's text item with real page
// coordinates, normalize the box to 0..1 via pdfBox (playwright-free), and persist a citation the
// Trace tab renders as `.r-tracevu-box` on the exact source line. NO Browserbase / no playwright / no native deps.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { getDocumentProxy } from "unpdf";
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

    const want = norm(a.target);
    if (!want) return { ok: false, error: "empty target" };

    let pdf;
    try {
      pdf = await getDocumentProxy(bytes);
    } catch (e) {
      return { ok: false, error: `pdf open failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items as any[]) {
        const str: string = it?.str ?? "";
        if (!str || !norm(str).includes(want)) continue;
        // PDF.js text item: transform = [a,b,c,d,e,f]; e=x, f=y (baseline, bottom-left origin, y up).
        // The glyph body spans [baseline, baseline+fontHeight] in y-up — normalizeBox("bottom-left") flips it.
        const e = it.transform[4];
        const f = it.transform[5];
        const overlay = normalizeBox(
          { x: e, y: f, w: it.width, h: it.height },
          { page: p, width: vp.width, height: vp.height },
          "bottom-left",
        );
        const box = { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h };
        await ctx.runMutation(insertCitationRef, {
          roomId: a.roomId,
          pdfStorageId: file.storageId,
          page: overlay.page,
          box,
          label: a.label ?? a.target,
          matchedText: str,
        });
        return { ok: true, page: overlay.page, box, matchedText: str, fileName: file.fileName };
      }
    }
    return { ok: false, error: `"${a.target}" not found in ${file.fileName}` };
  },
});
