import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type OpenRouterModel = {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
};

const args = process.argv.slice(2);
const limit = Number(optionValue("--limit") ?? 25);
const jsonOut = optionValue("--json-out") ?? "docs/eval/openrouter-top-paid-tools-snapshot.json";
const maxInputPerMillionUsd = Number(optionValue("--max-input-per-million-usd") ?? 1.25);
const maxOutputPerMillionUsd = Number(optionValue("--max-output-per-million-usd") ?? 4);
const url = "https://openrouter.ai/api/v1/models";

const response = await fetch(url, {
  headers: {
    "HTTP-Referer": "https://github.com/HomenShum/noderoom",
    "X-Title": "NodeRoom benchmark route audit",
  },
});

if (!response.ok) {
  throw new Error(`OpenRouter model discovery failed: ${response.status} ${response.statusText}`);
}

const body = await response.json() as { data?: OpenRouterModel[] };
const models = (body.data ?? [])
  .filter(isCheapPaidToolModel)
  .sort((a, b) =>
    (b.created ?? 0) - (a.created ?? 0) ||
    (pricePerMillion(a.pricing?.prompt) + pricePerMillion(a.pricing?.completion)) -
      (pricePerMillion(b.pricing?.prompt) + pricePerMillion(b.pricing?.completion)) ||
    a.id.localeCompare(b.id)
  )
  .slice(0, limit)
  .map((model, index) => ({
    rank: index + 1,
    id: model.id,
    name: model.name ?? model.id,
    created: model.created ?? 0,
    createdAt: model.created ? new Date(model.created * 1000).toISOString() : undefined,
    contextLength: model.context_length ?? 0,
    inputPerMillionUsd: pricePerMillion(model.pricing?.prompt),
    outputPerMillionUsd: pricePerMillion(model.pricing?.completion),
    supportsTools: model.supported_parameters?.includes("tools") === true,
    supportsToolChoice: model.supported_parameters?.includes("tool_choice") === true,
    supportsStructuredOutputs: model.supported_parameters?.includes("structured_outputs") === true,
    supportsParallelToolCalls: model.supported_parameters?.includes("parallel_tool_calls") === true,
    supportedParameters: model.supported_parameters ?? [],
  }));

const snapshot = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: url,
  selection: {
    sort: "created_desc_then_price",
    supportedParameters: ["tools", "tool_choice"],
    paidOnly: true,
    cheapCaps: {
      inputPerMillionUsd: maxInputPerMillionUsd,
      outputPerMillionUsd: maxOutputPerMillionUsd,
    },
    outputModalities: ["text"],
    limit,
  },
  modelCount: models.length,
  models,
};

writeJson(jsonOut, snapshot);
console.log(`wrote ${jsonOut}`);
console.log(`OpenRouter latest cheap paid tool-capable snapshot: ${models.length} model(s)`);

function isCheapPaidToolModel(model: OpenRouterModel): boolean {
  const inputPerMillion = pricePerMillion(model.pricing?.prompt);
  const outputPerMillion = pricePerMillion(model.pricing?.completion);
  if (inputPerMillion <= 0 && outputPerMillion <= 0) return false;
  if (inputPerMillion < 0 || outputPerMillion < 0) return false;
  if (inputPerMillion > maxInputPerMillionUsd || outputPerMillion > maxOutputPerMillionUsd) return false;
  const params = new Set(model.supported_parameters ?? []);
  if (!params.has("tools") || !params.has("tool_choice")) return false;
  const outputs = model.architecture?.output_modalities ?? [];
  if (outputs.length > 0 && !outputs.includes("text")) return false;
  const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase();
  if (/safety|moderation|embed|clip|audio|music/.test(haystack)) return false;
  return true;
}

function pricePerMillion(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? Number((parsed * 1_000_000).toFixed(6)) : 0;
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
