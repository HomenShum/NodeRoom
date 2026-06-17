import { embeddingVector } from "./embeddings";
import { assertProviderEgressAllowed, assertProviderRouteAllowed, type ProviderEgressArtifact } from "../src/nodeagent/guardrails/egressPolicy";

export const OKF_EMBEDDING_DIMENSION = 64;

export interface OkfEmbeddingResult {
  vector: number[];
  provider: "openai" | "gemini" | "local";
  model: string;
}

type Env = Record<string, string | undefined>;
export interface OkfEmbeddingOptions {
  artifacts?: ProviderEgressArtifact[];
  env?: Env;
}

export async function embedOkfText(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT", options: OkfEmbeddingOptions = {}): Promise<OkfEmbeddingResult> {
  const env = options.env ?? process.env;
  const artifacts = options.artifacts ?? [];
  const preferred = (envValue(env, "OKF_EMBED_PROVIDER") ?? "").toLowerCase();
  const openaiKey = envValue(env, "OPENAI_API_KEY");
  if ((preferred === "openai" || preferred === "") && openaiKey) {
    const model = envValue(env, "OKF_OPENAI_EMBED_MODEL") ?? "text-embedding-3-small";
    if (!canUseExternalEmbedding(model, artifacts, env)) return localEmbedding(text);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${openaiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, input: text, dimensions: OKF_EMBEDDING_DIMENSION }),
    });
    if (!res.ok) throw new Error(`openai_embedding_${res.status}`);
    const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
    const values = json.data?.[0]?.embedding;
    if (!values?.length) throw new Error("openai_embedding_empty");
    return { provider: "openai", model, vector: normalizeDimension(values) };
  }

  const geminiKey = envValue(env, "GOOGLE_GENERATIVE_AI_API_KEY") ?? envValue(env, "GEMINI_API_KEY");
  if ((preferred === "gemini" || preferred === "") && geminiKey) {
    const model = envValue(env, "OKF_GEMINI_EMBED_MODEL") ?? "gemini-embedding-2";
    if (!canUseExternalEmbedding(model, artifacts, env)) return localEmbedding(text);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType,
      }),
    });
    if (!res.ok) throw new Error(`gemini_embedding_${res.status}`);
    const json = await res.json() as { embedding?: { values?: number[]; value?: number[] } };
    const values = json.embedding?.values ?? json.embedding?.value;
    if (!values?.length) throw new Error("gemini_embedding_empty");
    return { provider: "gemini", model, vector: normalizeDimension(values) };
  }

  return localEmbedding(text);
}

function envValue(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function canUseExternalEmbedding(model: string, artifacts: ProviderEgressArtifact[], env: Env): boolean {
  try {
    assertProviderRouteAllowed({ model, entrypoint: "okf_embedding", env });
    assertProviderEgressAllowed({ model, entrypoint: "okf_embedding", artifacts, env });
    return true;
  } catch {
    return false;
  }
}

function localEmbedding(text: string): OkfEmbeddingResult {
  return { provider: "local", model: "hashing-v1", vector: embeddingVector(text, OKF_EMBEDDING_DIMENSION) };
}

export function normalizeDimension(values: number[], dimension = OKF_EMBEDDING_DIMENSION): number[] {
  const compacted = values.length === dimension ? values : compactVector(values, dimension);
  const cleaned = compacted.map((n) => Number.isFinite(n) ? n : 0);
  const norm = Math.sqrt(cleaned.reduce((sum, n) => sum + n * n, 0)) || 1;
  return cleaned.map((n) => Number((n / norm).toFixed(8)));
}

function compactVector(values: number[], dimension: number): number[] {
  const out = Array.from({ length: dimension }, () => 0);
  values.forEach((value, index) => {
    out[index % dimension] += Number.isFinite(value) ? value : 0;
  });
  return out;
}
