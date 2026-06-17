import "./benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { generateObject, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const args = process.argv.slice(2);
const mediaPath = optionValue("--media");
const outPath = optionValue("--out") ?? join(process.cwd(), "docs", "eval", "agent-improvement-loop", "gemini-ui-review.json");
const model = optionValue("--model") ?? process.env.GEMINI_UI_REVIEW_MODEL ?? "gemini-3.5-flash";

if (!mediaPath) throw new Error("--media=<screenshot-or-video> is required");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");

const mediaBytes = readFileSync(mediaPath);
const mediaType = mediaTypeFor(mediaPath);

const reviewSchema = z.object({
  overall: z.enum(["pass", "partial", "fail"]),
  summary: z.string(),
  scores: z.object({
    filesAndSpreadsheet: z.number().min(0).max(10),
    publicPrivateChatAgent: z.number().min(0).max(10),
    convexLiveState: z.number().min(0).max(10),
    traceAcceptAllAutoAccept: z.number().min(0).max(10),
    notesWikiSpreadsheet: z.number().min(0).max(10),
    wallPostIts: z.number().min(0).max(10),
    multiUserSignals: z.number().min(0).max(10),
    evidenceCitations: z.number().min(0).max(10),
  }),
  observedEvidence: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  workflowPainPoints: z.array(z.object({
    user: z.enum(["gtm_sales", "finance_banking", "harness_engineer", "general_collaborator"]),
    painPoint: z.string(),
    observed: z.boolean(),
    note: z.string(),
  })).default([]),
  recommendedEvalAdditions: z.array(z.string()).default([]),
});

const prompt = [
  "You are reviewing a NodeRoom UI recording or screenshot for production workflow evidence.",
  "Score only what is visible. Do not infer success from claims in text unless the UI shows the state, trace, artifact, or result.",
  "Judge the interaction quality against polished professional collaboration tools such as Notion and Linear: restrained hierarchy, obvious active state, low step count, readable dense data, clear collaboration presence, and no ambiguous mode switches.",
  "",
  "Check these NodeRoom production scenarios:",
  "Scores must be on a 0-5 scale. If you naturally score on a 0-10 scale, divide by 2 before returning JSON.",
  "1. User can work with both uploaded files and spreadsheets.",
  "2. Public chat, private chat, and the room/private agent are usable.",
  "3. Room trace shows proposals or accept-all/auto-accept behavior with host consent.",
  "4. Research/operation workflow touches user-to-agent-to-Convex-to-artifact state.",
  "5. Notes/wiki and spreadsheet work together with evidence links.",
  "6. Wall supports post-it creation/deletion.",
  "7. Multi-user online state or collaboration locks are visible.",
  "8. GTM sales and finance/banker pain points are actually addressed, not only described.",
  "",
  "Return JSON matching the schema. Keep evidence and missing evidence concrete.",
].join("\n");

const messages: ModelMessage[] = [{
  role: "user",
  content: [
    { type: "text", text: prompt },
    { type: "file", data: mediaBytes, filename: basename(mediaPath), mediaType },
  ],
}];

const result = await generateObject({
  model: google(model),
  schema: reviewSchema,
  messages,
});

const review = normalizeReview(result.object);
const out = {
  generatedAt: new Date().toISOString(),
  model,
  mediaPath,
  mediaType,
  scoreScale: "0-5; model 0-10 outputs are normalized",
  review,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${outPath}`);
console.log(`${review.overall}: ${review.summary}`);

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function mediaTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  throw new Error(`Unsupported media extension for Gemini UI review: ${ext}`);
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function normalizeReview(review: z.infer<typeof reviewSchema>): z.infer<typeof reviewSchema> {
  const scores = { ...review.scores };
  for (const key of Object.keys(scores) as Array<keyof typeof scores>) {
    scores[key] = Number((scores[key] > 5 ? scores[key] / 2 : scores[key]).toFixed(2));
  }
  return { ...review, scores };
}
