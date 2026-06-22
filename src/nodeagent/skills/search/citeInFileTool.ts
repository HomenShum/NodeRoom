/**
 * cite_in_file — the agent's PDF-citation tool. Given an uploaded filing in the room, it finds a
 * value's exact text on the page and pins a highlight box (`.r-tracevu-box`) on that source line in
 * the Trace tab — the deployable, playwright-free exact-box lane (Browserbase can't run in Convex).
 *
 * The tool is thin: it delegates to the server room runtime (rt.citeInFile → convex citePdf.cite,
 * a "use node" action that runs LiteParse + pdfBox + records the citation). In a non-server runtime
 * (browser/in-memory) rt.citeInFile is undefined and we return an honest unavailable result.
 */
import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";

const schema = z.object({
  target: z
    .string()
    .describe("the exact value or phrase to find in the uploaded PDF (e.g. a number like 41,321, or 'Total revenues')"),
  label: z.string().optional().describe("a short human label for the citation (defaults to the target)"),
  fileName: z
    .string()
    .optional()
    .describe("optional: which uploaded PDF to cite (substring match); defaults to the room's most recent PDF"),
});

export const citeInFileTool: AgentTool = {
  name: "cite_in_file",
  description:
    "Ground a figure in an uploaded PDF: find the exact value/phrase on the page and pin a citation box on that source line (renders in the Trace tab). Use right after you state a number that comes from an uploaded filing so the claim is verifiable.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    if (!rt.citeInFile) {
      return { ok: false, error: "cite_in_file is only available in the server room runtime" };
    }
    return rt.citeInFile({ target: args.target, label: args.label, fileName: args.fileName });
  },
};
