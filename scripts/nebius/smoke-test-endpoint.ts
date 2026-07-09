import "../benchmark/loadEnv";

import {
  extractNebiusMessageText,
  hasNebiusReasoningTrace,
  nebiusChatCompletion,
  sanitizeNebiusError,
} from "../../src/lib/models/providers/nebius";

const args = process.argv.slice(2);
const model = optionValue("--model") ?? process.env.NEBIUS_SMOKE_MODEL ?? process.env.NEBIUS_SEO_JUDGE_MODEL ?? "nebius/MiniMaxAI/MiniMax-M2.5";
const prompt = optionValue("--prompt") ?? "Reply with strict JSON: {\"ok\":true,\"provider\":\"nebius\"}";
const maxTokens = Number(optionValue("--max-tokens") ?? process.env.NEBIUS_SMOKE_MAX_TOKENS ?? 400);

try {
  const startedAt = Date.now();
  const response = await nebiusChatCompletion({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    maxTokens,
  });
  const choice = response.choices?.[0];
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    model,
    elapsedMs: Date.now() - startedAt,
    finishReason: choice?.finish_reason ?? null,
    text: extractNebiusMessageText(response),
    hasReasoningTrace: hasNebiusReasoningTrace(response),
    usage: response.usage,
  }, null, 2));
} catch (error) {
  console.error(sanitizeNebiusError(error));
  process.exitCode = 1;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
