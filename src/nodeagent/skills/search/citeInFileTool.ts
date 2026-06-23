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

const base = z.object({
  target: z
    .string()
    .min(1)
    .describe("the exact value or phrase to find in the uploaded PDF, as a plain string (e.g. \"41,321\" or \"Total revenues\"). NOT an artifact id."),
  label: z.string().optional().describe("a short human label for the citation (defaults to the target)"),
  fileName: z
    .string()
    .optional()
    .describe("optional: which uploaded PDF to cite (substring match); defaults to the room's most recent PDF"),
});

// Cheap/quantized models often send the value under a synonym key, or as a bare string, or JSON-encoded.
// Coalesce any of those into `target` before validation (the [[cheap-model-tool-ergonomics]] pattern) —
// the model-facing JSON schema still shows the clean `base` shape via zodToJsonSchema's ZodEffects unwrap.
const TARGET_ALIASES = ["value", "phrase", "query", "text", "q", "find", "search", "term", "string"];
const schema = z.preprocess((raw) => {
  if (typeof raw === "string") {
    const s = raw.trim();
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? parsed : { target: s };
    } catch {
      return { target: s };
    }
  }
  if (raw && typeof raw === "object") {
    const o: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    if (typeof o.target !== "string" || !(o.target as string).trim()) {
      for (const k of TARGET_ALIASES) {
        if (typeof o[k] === "string" && (o[k] as string).trim()) {
          o.target = o[k];
          break;
        }
      }
    }
    return o;
  }
  return raw;
}, base);

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
