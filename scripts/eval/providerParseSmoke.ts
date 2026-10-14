/**
 * LIVE provider-parse smoke. Proves the LLM-native extraction lane end-to-end with a REAL API call:
 *   messy text → provider (Gemini/OpenAI/Claude/OpenRouter) structured extraction →
 *   ProviderExtraction → artifactsFromProviderExtraction() → CellPayload cells w/ evidence.
 * Verifies the architecture invariant: canonical Convex storageId != disposable provider file id.
 *
 *   npx tsx scripts/eval/providerParseSmoke.ts                       # gemini default
 *   npx tsx scripts/eval/providerParseSmoke.ts gemini-3.8-flash,gpt-5.4-mini,claude-haiku-5-5
 */
import "../benchmark/loadEnv";
import { z } from "zod";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getProviderForModel } from "../../src/nodeagent/models/modelCatalog";
import { priceRun } from "../../src/nodeagent/models/adapter";
import { artifactsFromProviderExtraction, providerFileCacheMeta, type CanonicalFileRef, type ProviderExtraction, type ProviderUploadResult } from "../../src/app/providerParserAdapter";
import type { CellPayload, ProviderParser } from "../../src/engine/types";

const MODELS = (process.argv[2] || "gemini-3.8-flash,gpt-5.4-mini,claude-haiku-5-5").split(",").map((s) => s.trim());

// Synthetic messy diligence text — the ParselyFi/PitchBook archetype (unstructured → structured), no private data.
const SAMPLE = `Diligence scratch notes (messy):
- Acme Robotics — seed stage, raised ~$4M from Initialized + a few angels, HQ in San Francisco, builds warehouse pick-and-place arms, about 25 people.
- Nimbus Health (formerly CloudCare) closed a $30m Series B led by a16z last quarter, based in NYC, does AI clinical documentation, ~120 employees, founders are ex-Epic.
- ZeroPoint Energy: stealth, fusion-adjacent, Boston, no funding disclosed, team of 8 out of MIT.`;

const PROMPT = `Extract the companies in the notes below into ONE table with columns exactly: Company, Stage, Funding, HQ, Employees, Sector. One row per company. If a value is not stated, leave it BLANK — do NOT invent. Provide an evidence list: for each company, the verbatim phrase that grounds it.\n\nNOTES:\n${SAMPLE}`;

const SCHEMA = z.object({
  tables: z.array(z.object({
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    confidence: z.number().optional(),
  })),
  evidence: z.array(z.object({ label: z.string(), snippet: z.string().optional(), confidence: z.number().optional() })).optional(),
  warnings: z.array(z.string()).optional(),
});

function providerModel(modelId: string) {
  const p = getProviderForModel(modelId);
  if (p === "google") return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(modelId);
  if (p === "anthropic") return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
  if (p === "openrouter") return createOpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" }).chat(modelId);
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).chat(modelId); // openai
}

async function smoke(modelId: string) {
  const provider = getProviderForModel(modelId) as ProviderParser;
  const t0 = Date.now();
  const res = await generateObject({ model: providerModel(modelId), schema: SCHEMA, prompt: PROMPT });
  const ms = Date.now() - t0;
  const extraction = res.object as ProviderExtraction;

  // Canonical file ref (Convex storage) — note the id is NOT a provider id.
  const file: CanonicalFileRef = { storageId: "convex:kg2abc...storage", artifactId: "artifact:room1:notes", fileName: "diligence-notes.txt", mimeType: "text/plain", size: SAMPLE.length };
  const upload: ProviderUploadResult = { provider, providerFileId: `${provider}:files/inline-${modelId}`, cachedAt: Date.now() };
  const providerFile = providerFileCacheMeta(file, upload);
  const artifacts = artifactsFromProviderExtraction({ file, providerFile, provider, model: modelId, extraction });

  const cost = priceRun(modelId, res.usage?.inputTokens ?? 0, res.usage?.outputTokens ?? 0);
  const art = artifacts[0];
  const tbl = extraction.tables?.[0];
  console.log(`\n=== ${modelId} (${provider}) · ${(ms / 1000).toFixed(1)}s · $${cost.toFixed(4)} ===`);
  console.log(`canonical storageId : ${file.storageId}`);
  console.log(`provider file id    : ${providerFile.providerFileId}   (disposable cache, != storageId: ${file.storageId !== providerFile.providerFileId})`);
  if (!art || !tbl) { console.log("  NO TABLE EXTRACTED"); return false; }
  console.log(`artifact: "${art.title}"  cols=[${(art.meta?.dataframe?.columns ?? []).map((c) => c.label).join(", ")}]  rows=${tbl.rows.length}  seedCells=${art.seed.length}`);
  // show the first row as CellPayload (value · status · confidence · #evidence)
  const cols = art.meta?.dataframe?.columns ?? [];
  for (const col of cols) {
    const cell = art.seed.find((s) => s.id === `p1__${col.id}`)?.value as CellPayload | undefined;
    if (cell) console.log(`  ${col.label.padEnd(10)} = "${String(cell.value)}"  [${cell.status}, conf=${cell.confidence ?? "-"}, ${cell.evidence?.length ?? 0} evidence]`);
  }
  // honesty: did it invent funding for ZeroPoint (which says "no funding disclosed")?
  const zp = tbl.rows.find((r) => String(r[0]).toLowerCase().includes("zeropoint"));
  if (zp) console.log(`  honesty check — ZeroPoint funding cell: "${zp[2]}" (should be blank/none, not invented)`);
  return true;
}

(async () => {
  console.log(`LIVE provider-parse smoke · models: ${MODELS.join(", ")}`);
  for (const m of MODELS) {
    try { await smoke(m); }
    catch (e) { console.log(`\n=== ${m} === ERROR: ${e instanceof Error ? e.message : String(e)}`); }
  }
})();
