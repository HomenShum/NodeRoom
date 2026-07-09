export type GeminiTextResult = {
  model: string;
  text: string;
};

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

export async function geminiGenerateText(args: {
  prompt: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<GeminiTextResult> {
  const env = args.env ?? process.env;
  const key = requireGeminiApiKey(env);
  const model = args.model ?? env.GEMINI_SEO_TEXT_MODEL ?? DEFAULT_GEMINI_MODEL;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: args.prompt }] }],
    }),
  });
  if (!response.ok) throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return {
    model,
    text: body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "",
  };
}

export function requireGeminiApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? env.GOOGLE_API_KEY?.trim();
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY is required");
  return key;
}

export function hasGeminiVideoSupport(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY)?.trim());
}
