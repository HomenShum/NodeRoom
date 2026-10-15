import "./benchmark/loadEnv";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { convexModel, convexPriceRequest } from "../src/nodeagent/models/convexModel";
import type { StartupGeneratedCellPayload, StartupProviderGeneratedContent } from "./startup-diligence-live-eval";
import {
  runStartupDiligenceConvexContractEval,
  writeStartupDiligenceEvalArtifacts,
} from "./startup-diligence-live-eval";

const DEFAULT_JSON_OUT = "docs/eval/startup-diligence-provider-results.json";
const DEFAULT_MANIFEST = "docs/eval/startup-diligence-war-room-live.json";
const DEFAULT_TIMEOUT_MS = 90_000;

type ProviderDraft = {
  cellPayload: StartupGeneratedCellPayload;
  finalText: string;
};

async function generateProviderContent(modelId: string): Promise<StartupProviderGeneratedContent> {
  const model = convexModel(modelId, { entrypoint: "public_ask" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const started = performance.now();
  try {
    const step = await model.next({
      system: [
        "You are the NodeRoom public Room NodeAgent for a startup-banking diligence room.",
        "Return only valid JSON. Do not include markdown fences.",
        "The JSON must include cellPayload and finalText.",
        "cellPayload must be an evidence-bearing CellPayload for the CardioNova summary cell.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            "Use these public room facts:",
            "- Company: CardioNova",
            "- Website: https://cardionova.example",
            "- Business: AI triage workflow for hospital intake",
            "- Cash: $1.5M",
            "- Burn: $125k/month",
            "- Source refs available: cardionova-intake.pdf#page=1 and cardionova-deck.pdf#page=12",
            "",
            "Return exactly this JSON shape:",
            "{",
            '  "cellPayload": {',
            '    "kind": "CellPayload",',
            '    "value": "one concise diligence summary",',
            '    "confidence": 0.0,',
            '    "status": "needs_review",',
            '    "evidence": [{ "source": "source label", "sourceRef": "source ref", "quote": "short quote" }]',
            "  },",
            '  "finalText": "one concise final room update describing what was written and why it needs host review"',
            "}",
          ].join("\n"),
        },
      ],
      tools: [],
      signal: controller.signal,
    });
    const ms = Math.round(performance.now() - started);
    const responseText = step.text ?? "";
    const parsed = parseProviderDraft(responseText);
    const inputTokens = step.usage?.inputTokens ?? 0;
    const outputTokens = step.usage?.outputTokens ?? 0;
    return {
      requestedModel: modelId,
      resolvedModel: model.name,
      providerRoute: step.providerRoute,
      responseText,
      cellPayload: parsed.cellPayload,
      finalText: parsed.finalText,
      usage: { inputTokens, outputTokens },
      costUsd: convexPriceRequest(model.name, inputTokens, outputTokens),
      ms,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runStartupDiligenceProviderEval(args: {
  model?: string;
  jsonOut?: string;
  manifestPath?: string;
  noWrite?: boolean;
} = {}) {
  const errors: Array<{ model: string; error: string }> = [];
  for (const model of providerCandidates(args.model)) {
    try {
      const providerGenerated = await generateProviderContent(model);
      const report = await runStartupDiligenceConvexContractEval({ providerGenerated });
      if (!args.noWrite) {
        writeStartupDiligenceEvalArtifacts(report, {
          jsonOut: args.jsonOut ?? DEFAULT_JSON_OUT,
          manifestPath: args.manifestPath ?? DEFAULT_MANIFEST,
        });
      }
      return { report, providerGenerated, attempted: providerCandidates(args.model).slice(0, errors.length + 1), errors };
    } catch (error) {
      errors.push({ model, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new Error(`startup provider eval failed for all candidates: ${JSON.stringify(errors, null, 2)}`);
}

function parseProviderDraft(text: string): ProviderDraft {
  const parsed = JSON.parse(extractJson(text));
  const cellPayload = parsed.cellPayload ?? parsed;
  const evidence = Array.isArray(cellPayload.evidence) ? cellPayload.evidence : [];
  if (cellPayload.kind !== "CellPayload") throw new Error("provider_json_missing_CellPayload_kind");
  if (typeof cellPayload.value !== "string" || cellPayload.value.trim().length < 20) throw new Error("provider_json_missing_summary_value");
  if (!evidence.length) throw new Error("provider_json_missing_evidence");
  const finalText = String(parsed.finalText ?? "").trim();
  if (finalText.length < 20) throw new Error("provider_json_missing_finalText");
  return {
    cellPayload: {
      kind: "CellPayload",
      value: cellPayload.value.trim(),
      confidence: clamp(Number(cellPayload.confidence) || 0.72, 0, 1),
      status: cellPayload.status === "reviewed" ? "reviewed" : "needs_review",
      evidence: evidence.slice(0, 4).map((item: any) => ({
        source: String(item.source || "CardioNova diligence source"),
        sourceRef: String(item.sourceRef || "cardionova-intake.pdf#page=1"),
        quote: String(item.quote || cellPayload.value).slice(0, 240),
      })),
    },
    finalText,
  };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("provider_response_missing_json_object");
}

function providerCandidates(explicit?: string): string[] {
  const candidates = [
    explicit,
    process.env.STARTUP_DILIGENCE_PROVIDER_MODEL,
    process.env.AGENT_RESEARCH_MODEL,
    process.env.AGENT_MODEL,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "gemini-3.8-flash" : undefined,
    process.env.OPENROUTER_API_KEY ? "moonshotai/kimi-k2.6" : undefined,
    process.env.OPENROUTER_API_KEY ? "z-ai/glm-4.7-flash" : undefined,
    process.env.OPENAI_API_KEY ? "gpt-5.4-nano" : undefined,
    process.env.ANTHROPIC_API_KEY ? "claude-haiku-5-5" : undefined,
  ].filter((value): value is string => !!value && value.trim().length > 0);
  return [...new Set(candidates.map((value) => value.trim()))];
}

function optionValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function main() {
  const jsonOut = optionValue("--json-out") ?? DEFAULT_JSON_OUT;
  const manifestPath = optionValue("--manifest") ?? DEFAULT_MANIFEST;
  const model = optionValue("--model");
  const strict = process.argv.includes("--strict");
  const noWrite = process.argv.includes("--no-write");
  const { report, providerGenerated, attempted, errors } = await runStartupDiligenceProviderEval({
    model,
    jsonOut,
    manifestPath,
    noWrite,
  });
  console.log(`startup diligence provider eval: ${report.pass ? "PASS" : "FAIL"} checks=${report.summary.passed}/${report.summary.checks} mode=${report.mode}`);
  console.log(`model requested=${providerGenerated.requestedModel} resolved=${providerGenerated.resolvedModel} ms=${providerGenerated.ms} costUsd=${providerGenerated.costUsd ?? 0}`);
  console.log(`attempted=${attempted.join(", ")}`);
  for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.id} - ${check.summary}`);
  if (errors.length) console.log(`fallbackErrors=${JSON.stringify(errors)}`);
  if (!noWrite) {
    console.log(`wrote ${jsonOut}`);
    console.log(`updated ${manifestPath}`);
  }
  if (strict && !report.pass) process.exit(1);
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
