import "./benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { generateObject, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

// One-off: review a recorded NodeRoom workflow video against the 4 demo issues
// the user raised (fresh-room state, agent completion vs budget, room density,
// button overload). Compress big recordings first; Gemini inline cap is ~20MB.

const args = process.argv.slice(2);
const mediaPath = optionValue("--media");
const outPath = optionValue("--out") ?? join(process.cwd(), "docs", "eval", "agent-improvement-loop", "mp4-workflow-review.json");
const model = optionValue("--model") ?? process.env.GEMINI_UI_REVIEW_MODEL ?? "gemini-3.6-flash";

if (!mediaPath) throw new Error("--media=<video> is required");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");

const mediaBytes = readFileSync(mediaPath);
const mediaType = mediaTypeFor(mediaPath);

const issueSchema = z.object({
  observed: z.boolean(),
  severity: z.enum(["none", "minor", "moderate", "severe"]),
  firstTimestamp: z.string().describe("mm:ss in the video where this is first visible, or n/a"),
  detail: z.string(),
});

const reviewSchema = z.object({
  overall: z.enum(["pass", "partial", "fail"]),
  workflowSummary: z.string().describe("Step-by-step of what actually happens in the recording, in order."),
  workflowGoal: z.string().describe("What the user/agent appears to be TRYING to accomplish."),
  workflowCompleted: z.enum(["yes", "partial", "no"]).describe("Did the agent actually finish the task, or stop early?"),
  completionEvidence: z.string().describe("Concrete on-screen evidence for the completion verdict — e.g. final artifact state, a 'stopped'/'budget' message, an unfinished panel."),
  timeline: z.array(z.object({ ts: z.string(), event: z.string() })).default([]),
  issues: z.object({
    freshRoomState: issueSchema.describe("When a NEW room is joined/created, is it a blank fresh state, or already pre-populated with content?"),
    agentStoppedAtBudget: issueSchema.describe("Does the agent visibly halt at a budget/token/cost limit instead of completing the workflow? Quote any budget/limit/stopped text seen."),
    roomTooCrowded: issueSchema.describe("Is the room visually crowded / too much to parse at once?"),
    tooManyButtons: issueSchema.describe("Are there too many buttons/controls for a new user to learn?"),
  }),
  visibleButtons: z.array(z.string()).default([]).describe("Best-effort list of every distinct button/control label or icon visible by default in the room."),
  recommendations: z.array(z.object({
    issue: z.enum(["fresh-room-state", "agent-completion-vs-budget", "room-density", "too-many-buttons", "other"]),
    fix: z.string(),
    priority: z.enum(["P0", "P1", "P2"]),
  })).default([]),
});

const prompt = [
  "You are Gemini 3.5 Flash performing a strict UX + workflow review of a screen recording of NodeRoom,",
  "a real-time collaborative room where humans and AI agents work together over a shared artifact (spreadsheet/notes/wall).",
  "",
  "Watch the ENTIRE video carefully and report ONLY what is actually visible/audible. Do not assume backend success from captions.",
  "",
  "The product owner has flagged FOUR suspected problems. For each, judge whether the recording confirms it, with a timestamp and concrete evidence:",
  "  1. FRESH ROOM STATE: The user joined/created a NEW room but it was NOT a fresh blank room — it already had content. Watch the moment a room is entered: is the canvas/spreadsheet/wall empty, or pre-filled?",
  "  2. AGENT COMPLETION vs BUDGET: The agent did NOT accomplish the workflow — it stopped at a BUDGET/token/cost LIMIT. Look for any 'budget', 'limit', 'stopped', 'paused', 'insufficient', or run-terminated message, and whether the final artifact looks finished or abandoned.",
  "  3. ROOM TOO CROWDED: The room shows too much at once and is hard to understand. Assess information density, number of simultaneous panels, and visual clutter.",
  "  4. TOO MANY BUTTONS: There are too many buttons/controls for a user to learn. Count and list the distinct controls visible by default.",
  "",
  "Also give an honest verdict on whether the WORKFLOW WAS COMPLETED end-to-end, with the on-screen evidence.",
  "Build a short timeline of key moments (mm:ss -> event).",
  "Then give prioritized, concrete recommendations (P0 = breaks the demo / misleads, P1 = fix before demo, P2 = polish).",
  "",
  "Return strict JSON matching the schema.",
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

const out = {
  generatedAt: new Date().toISOString(),
  model,
  mediaPath,
  mediaType,
  mediaBytes: mediaBytes.length,
  review: result.object,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${outPath}`);
console.log(`overall=${result.object.overall} completed=${result.object.workflowCompleted}`);
console.log(result.object.workflowSummary);

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function mediaTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  throw new Error(`Unsupported media extension: ${ext}`);
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
