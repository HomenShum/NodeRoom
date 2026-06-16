import { embeddingVector } from "./embeddings";

export const OKF_EMBEDDING_DIMENSION = 64;

export interface OkfEmbeddingResult {
  vector: number[];
  provider: "openai" | "gemini" | "local";
  model: string;
}

export async function embedOkfText(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"): Promise<OkfEmbeddingResult> {
  const preferred = (process.env.OKF_EMBED_PROVIDER ?? "").toLowerCase();
  if ((preferred === "openai" || preferred === "") && process.env.OPENAI_API_KEY) {
    const model = process.env.OKF_OPENAI_EMBED_MODEL ?? "text-embedding-3-small";
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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

  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if ((preferred === "gemini" || preferred === "") && geminiKey) {
    const model = process.env.OKF_GEMINI_EMBED_MODEL ?? "gemini-embedding-2";
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
