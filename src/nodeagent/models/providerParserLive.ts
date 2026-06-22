import { createHash } from "node:crypto";
import { generateObject, generateText, type LanguageModel, type ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  artifactsFromProviderExtraction,
  providerFileCacheMeta,
  type CanonicalFileRef,
  type ProviderExtraction,
  type ProviderParserAdapter,
  type ProviderUploadResult,
} from "../../app/providerParserAdapter";
import type { ProviderFileCacheMeta, ProviderParser } from "../../engine/types";
import type { UploadedArtifactInput } from "../../app/uploadedArtifact";
import {
  assertProviderEgressAllowed,
  assertProviderRouteAllowed,
  type ProviderRouteReceipt,
} from "../guardrails/egressPolicy";

export type ProviderParserSource = {
  bytes?: Uint8Array;
  text?: string;
  checksum?: string;
};

export type ProviderParserSourceLoader = (file: CanonicalFileRef) => Promise<ProviderParserSource | undefined>;

export type LiveProviderParserOptions = {
  provider: ProviderParser;
  model?: string;
  loadSource?: ProviderParserSourceLoader;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
};

export type LiveProviderParserRunArgs = {
  provider: ProviderParser;
  file: CanonicalFileRef;
  model?: string;
  prompt?: string;
  source?: ProviderParserSource;
  env?: NodeJS.ProcessEnv;
};

export type LiveProviderParserRunResult = {
  provider: ProviderParser;
  model: string;
  providerRoute: ProviderRouteReceipt;
  providerFile: ProviderFileCacheMeta;
  extraction: ProviderExtraction;
  artifacts: UploadedArtifactInput[];
};

const MAX_TEXT_CONTEXT = 80_000;

const providerExtractionSchema = z.object({
  summary: z.string().optional(),
  tables: z.array(z.object({
    title: z.string().min(1),
    columns: z.array(z.string().min(1)).min(1),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    confidence: z.number().min(0).max(1).optional(),
  })).default([]),
  evidence: z.array(z.object({
    label: z.string().min(1),
    snippet: z.string().optional(),
    table: z.string().optional(),
    row: z.number().int().positive().optional(),
    column: z.string().optional(),
    page: z.number().int().positive().optional(),
    bbox: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      unit: z.enum(["px", "pt", "normalized"]).optional(),
    }).optional(),
    url: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).default([]),
  warnings: z.array(z.string()).default([]),
});

type ProviderExtractionObject = z.infer<typeof providerExtractionSchema>;

const DEFAULT_EXTRACTION_PROMPT = [
  "Extract the referenced business file into agent-usable data.",
  "Return tables for finance/GTM metrics, source-linked evidence, and warnings for ambiguity.",
  "Every table row should be suitable for a NodeRoom dataframe cell payload.",
].join(" ");

export const PROVIDER_PARSER_ENV_KEYS: Record<ProviderParser, string> = {
  gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const PROVIDER_MODEL_ENV_KEYS: Record<ProviderParser, string> = {
  gemini: "PROVIDER_PARSER_GEMINI_MODEL",
  openai: "PROVIDER_PARSER_OPENAI_MODEL",
  anthropic: "PROVIDER_PARSER_ANTHROPIC_MODEL",
  openrouter: "PROVIDER_PARSER_OPENROUTER_MODEL",
};

const PROVIDER_MODEL_DEFAULTS: Record<ProviderParser, string[]> = {
  gemini: ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"],
  openai: ["gpt-5.5", "gpt-5.4-mini", "gpt-5-mini", "gpt-4.1-mini"],
  anthropic: ["claude-haiku-4-5", "claude-3-5-haiku-latest", "claude-sonnet-4-5"],
  openrouter: ["z-ai/glm-5.2", "moonshotai/kimi-k2.7-code", "cohere/north-mini-code:free", "nvidia/nemotron-3-ultra-550b-a55b", "nex-agi/nex-n2-pro"],
};

export function providerParserModelCandidates(
  provider: ProviderParser,
  preferred?: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return uniqueStrings([
    preferred,
    env[PROVIDER_MODEL_ENV_KEYS[provider]],
    ...PROVIDER_MODEL_DEFAULTS[provider],
  ]);
}

export function hasProviderParserKey(provider: ProviderParser, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env[PROVIDER_PARSER_ENV_KEYS[provider]];
}

export function providerFileCacheId(provider: ProviderParser, file: CanonicalFileRef, source?: ProviderParserSource): string {
  const hash = createHash("sha256");
  hash.update(provider);
  hash.update("\0");
  hash.update(file.storageId);
  hash.update("\0");
  hash.update(file.fileName);
  hash.update("\0");
  hash.update(file.mimeType);
  hash.update("\0");
  hash.update(String(file.size));
  hash.update("\0");
  if (source?.checksum) hash.update(source.checksum);
  if (source?.bytes) hash.update(Buffer.from(source.bytes));
  if (source?.text) hash.update(source.text);
  return `${provider}:inline:${hash.digest("hex").slice(0, 24)}`;
}

export function createLiveProviderParserAdapter(options: LiveProviderParserOptions): ProviderParserAdapter {
  const sourceCache = new Map<string, ProviderParserSource | undefined>();
  const now = options.now ?? Date.now;
  return {
    provider: options.provider,
    async uploadFile(file: CanonicalFileRef): Promise<ProviderUploadResult> {
      const source = await options.loadSource?.(file);
      sourceCache.set(file.storageId, source);
      return {
        provider: options.provider,
        providerFileId: providerFileCacheId(options.provider, file, source),
        cachedAt: now(),
      };
    },
    async extract(args: Parameters<ProviderParserAdapter["extract"]>[0]): Promise<ProviderExtraction> {
      const source = sourceCache.has(args.file.storageId)
        ? sourceCache.get(args.file.storageId)
        : await options.loadSource?.(args.file);
      const result = await extractWithLiveProvider({
        provider: options.provider,
        model: args.model || options.model || providerParserModelCandidates(options.provider)[0],
        file: args.file,
        prompt: args.prompt,
        source,
        env: options.env,
      });
      return result.extraction;
    },
  };
}

export async function runLiveProviderParser(args: LiveProviderParserRunArgs): Promise<LiveProviderParserRunResult> {
  const model = args.model ?? providerParserModelCandidates(args.provider)[0];
  const providerRoute = assertProviderParserAllowed({
    model,
    file: args.file,
    source: args.source,
    env: args.env,
  });
  const adapter = createLiveProviderParserAdapter({
    provider: args.provider,
    model,
    loadSource: async () => args.source,
    env: args.env,
  });
  const upload = await adapter.uploadFile(args.file);
  const providerFile = providerFileCacheMeta(args.file, upload);
  const extraction = await adapter.extract({
    file: args.file,
    providerFile,
    model,
    prompt: args.prompt ?? DEFAULT_EXTRACTION_PROMPT,
  });
  const artifacts = artifactsFromProviderExtraction({
    file: args.file,
    providerFile,
    provider: args.provider,
    model: providerRoute.resolvedModel,
    extraction,
    providerRoute,
  });
  return { provider: args.provider, model: providerRoute.resolvedModel, providerRoute, providerFile, extraction, artifacts };
}

export function sanitizeProviderError(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(env)) {
    if (value && value.length > 12) message = message.replaceAll(value, "[redacted]");
  }
  return message.replace(/\s+/g, " ").slice(0, 240);
}

export async function extractProviderExtractionWithFallback(args: {
  structured: () => Promise<unknown>;
  text: () => Promise<string>;
  describeStructuredError?: (error: unknown) => string;
}): Promise<ProviderExtraction> {
  try {
    return normalizeExtraction(await args.structured());
  } catch (objectError) {
    const parsed = normalizeExtraction(parseJsonObject(await args.text()));
    return {
      ...parsed,
      warnings: [
        ...(parsed.warnings ?? []),
        `Structured output fallback used after generateObject failed: ${(args.describeStructuredError ?? sanitizeProviderError)(objectError)}`,
      ],
    };
  }
}

async function extractWithLiveProvider(args: {
  provider: ProviderParser;
  model: string;
  file: CanonicalFileRef;
  prompt: string;
  source?: ProviderParserSource;
  env?: NodeJS.ProcessEnv;
}): Promise<{ extraction: ProviderExtraction; providerRoute: ProviderRouteReceipt }> {
  const providerRoute = assertProviderParserAllowed(args);
  const model = providerLanguageModel(args.provider, providerRoute.resolvedModel);
  const prompt = buildExtractionPrompt(args.prompt, args.file, args.source);
  const input = buildPromptInput(prompt, args.file, args.source);

  const extraction = await extractProviderExtractionWithFallback({
    structured: async () => {
      const res = "messages" in input
        ? await generateObject({ model, schema: providerExtractionSchema, messages: input.messages })
        : await generateObject({ model, schema: providerExtractionSchema, prompt: input.prompt });
      return res.object;
    },
    text: async () => {
      const textPrompt = `${prompt}\n\nReturn JSON only. The JSON must match this shape: ${schemaHint()}`;
      const textInput = buildPromptInput(textPrompt, args.file, args.source);
      const res = "messages" in textInput
        ? await generateText({ model, messages: textInput.messages })
        : await generateText({ model, prompt: textInput.prompt });
      return res.text;
    },
  });
  return { extraction, providerRoute };
}

function providerLanguageModel(provider: ProviderParser, modelId: string): LanguageModel {
  switch (provider) {
    case "gemini":
      return google(modelId);
    case "openai":
      return openai(modelId);
    case "anthropic":
      return anthropic(modelId);
    case "openrouter":
      return createOpenAI({
        apiKey: envValue("OPENROUTER_API_KEY"),
        baseURL: envValue("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
        headers: { "HTTP-Referer": "https://noderoom.local", "X-Title": "NodeRoom provider parser" },
      }).chat(modelId);
    default:
      return assertNever(provider);
  }
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function buildExtractionPrompt(prompt: string, file: CanonicalFileRef, source?: ProviderParserSource): string {
  const sourceText = boundedSourceText(source);
  const fileSummary = [
    `File name: ${file.fileName}`,
    `MIME type: ${file.mimeType}`,
    `Convex storage id: ${file.storageId}`,
    file.artifactId ? `NodeRoom artifact id: ${file.artifactId}` : undefined,
  ].filter(Boolean).join("\n");
  return [
    prompt || DEFAULT_EXTRACTION_PROMPT,
    "",
    fileSummary,
    "",
    "Output contract:",
    "- tables[].columns are dataframe column labels.",
    "- tables[].rows contain scalar JSON cell values only.",
    "- evidence[] should cite the visible source text, page, screenshot, or section.",
    "- warnings[] should name missing fields, ambiguous values, or low-confidence layout reads.",
    sourceText ? `\nSource text preview:\n${sourceText}` : "",
  ].join("\n");
}

function buildPromptInput(
  prompt: string,
  file: CanonicalFileRef,
  source?: ProviderParserSource,
): { prompt: string } | { messages: ModelMessage[] } {
  if (!source?.bytes || boundedSourceText(source)) return { prompt };
  return {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "file", data: Buffer.from(source.bytes), filename: file.fileName, mediaType: file.mimeType },
      ],
    }],
  };
}

function boundedSourceText(source?: ProviderParserSource): string | undefined {
  if (source?.text) return source.text.slice(0, MAX_TEXT_CONTEXT);
  if (!source?.bytes) return undefined;
  const text = Buffer.from(source.bytes).toString("utf8");
  if (!text.trim()) return undefined;
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
  if (replacementCount / Math.max(text.length, 1) > 0.01) return undefined;
  return text.slice(0, MAX_TEXT_CONTEXT);
}

function normalizeExtraction(raw: unknown): ProviderExtraction {
  const parsed: ProviderExtractionObject = providerExtractionSchema.parse(raw);
  return {
    summary: parsed.summary,
    tables: parsed.tables.map((table) => ({
      title: table.title,
      columns: table.columns,
      rows: table.rows,
      confidence: table.confidence,
    })),
    evidence: parsed.evidence,
    warnings: parsed.warnings,
  };
}

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) throw new Error("provider returned no JSON object");
  return JSON.parse(candidate);
}

function schemaHint(): string {
  return JSON.stringify({
    summary: "short optional string",
    tables: [{ title: "table title", columns: ["Column"], rows: [["value"]], confidence: 0.8 }],
    evidence: [{ label: "source label", snippet: "short quote", table: "table title", row: 1, column: "Column", page: 1, bbox: { x: 0, y: 0, width: 1, height: 1, unit: "normalized" }, confidence: 0.8 }],
    warnings: ["optional warning"],
  });
}

function assertProviderParserAllowed(args: {
  model: string;
  file: CanonicalFileRef;
  source?: ProviderParserSource;
  env?: NodeJS.ProcessEnv;
}): ProviderRouteReceipt {
  const providerRoute = assertProviderRouteAllowed({
    model: args.model,
    entrypoint: "provider_parser",
    env: args.env ?? process.env,
  });
  assertProviderEgressAllowed({
    model: providerRoute.resolvedModel,
    entrypoint: "provider_parser",
    artifacts: [providerParserEgressArtifact(args.file, args.source)],
    env: args.env ?? process.env,
  });
  return providerRoute;
}

function providerParserEgressArtifact(file: CanonicalFileRef, source?: ProviderParserSource) {
  return {
    title: file.fileName,
    kind: "file",
    meta: {
      upload: {
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
        parsedAt: Date.now(),
      },
      document: {
        parser: "provider",
        lane: "document_layout",
        status: "server_parser_required",
        outputs: [source?.text ? "text" : "pages", "bounding_boxes"],
        requiredRuntime: source?.bytes ? ["node"] : [],
      },
    },
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    for (const part of value?.split(",") ?? []) {
      const trimmed = part.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider parser: ${value}`);
}
