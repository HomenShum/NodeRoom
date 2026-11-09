import "./benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { generateObject, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

// One-off: rigorous visual-polish critique of a NodeRoom screenshot against the
// Open Design contract (docs/design/open-design-redesign/DESIGN.md + design-contract.md).
const args = process.argv.slice(2);
const mediaPath = args.find((a) => a.startsWith("--media="))?.slice("--media=".length);
const outPath = args.find((a) => a.startsWith("--out="))?.slice("--out=".length)
  ?? join(process.cwd(), ".tmp-qa", "gemini-visual-polish.json");
const model = process.env.GEMINI_UI_REVIEW_MODEL ?? "gemini-3.6-flash";
if (!mediaPath) throw new Error("--media=<png> required");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required");

const bytes = readFileSync(mediaPath);
const mediaType = extname(mediaPath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";

const schema = z.object({
  overall: z.enum(["polished", "needs-work", "rough"]),
  oneLineVerdict: z.string(),
  issues: z.array(z.object({
    severity: z.enum(["P0", "P1", "P2"]),
    area: z.enum(["color", "typography", "spacing-rhythm", "hierarchy", "density", "alignment", "component-craft", "state-signal", "overflow", "motion-static"]),
    element: z.string().describe("the specific element/region in the screenshot"),
    observed: z.string(),
    fix: z.string().describe("the concrete CSS/layout change"),
  })).default([]),
  strengths: z.array(z.string()).default([]),
});

const prompt = [
  "You are a senior product designer doing a STRICT visual-polish critique of one screenshot of NodeRoom,",
  "a calm multiplayer financial-diligence room (humans + AI agents over a shared spreadsheet/notes/wall).",
  "Judge craft only: color discipline, typography, spacing rhythm, hierarchy, density, alignment, component polish.",
  "",
  "Hold it to this design contract:",
  "- COLOR: quiet neutral at rest; ONE warm terracotta accent; state color only on REAL state (amber=needs review,",
  "  green=complete/approved, red=failed/missing, blue=source/evidence). 'If everything is colorful, the design failed.'",
  "- TYPOGRAPHY: sober UI stack; tabular numerals for financial figures; hierarchy by WEIGHT + placement, not oversized",
  "  headings inside panels; long text clamps to 1-2 lines; letter-spacing 0.",
  "- SPACING: compact 4/8/12/16/24 rhythm; alignment before styling; stable control dimensions (no layout shift).",
  "- DENSITY: resting room ~12-14 meaningful controls; calm but clearly alive (agents working). Not a trading terminal,",
  "  not a generic AI chat app, not a consumer game.",
  "- HIERARCHY: the work surface carries focus; chrome (rails, tape, trace) recedes.",
  "- No text overlap/overflow; compact controls must not clip.",
  "",
  "Return STRICT JSON. Be specific and concrete: name the exact element and give the exact CSS/layout fix.",
  "Prioritize P0 = breaks the calm/credible feel; P1 = clear craft gap; P2 = refinement.",
].join("\n");

const messages: ModelMessage[] = [{ role: "user", content: [{ type: "text", text: prompt }, { type: "file", data: bytes, filename: "room.png", mediaType }] }];
const result = await generateObject({ model: google(model), schema, messages });
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), model, mediaPath, review: result.object }, null, 2));
console.log(`overall=${result.object.overall} :: ${result.object.oneLineVerdict}`);
for (const i of result.object.issues) console.log(`[${i.severity}] ${i.area} | ${i.element}: ${i.fix}`);
