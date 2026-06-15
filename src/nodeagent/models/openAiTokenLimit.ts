export function openAiCompatibleTokenLimitParam(
  modelId: string,
  endpoint: string,
  maxTokens: number,
): { max_tokens?: number; max_completion_tokens?: number } {
  if (isDirectOpenAiEndpoint(endpoint) && requiresMaxCompletionTokens(modelId)) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}

function isDirectOpenAiEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === "api.openai.com";
  } catch {
    return endpoint.includes("api.openai.com");
  }
}

function requiresMaxCompletionTokens(modelId: string): boolean {
  return /^gpt-5(?:[.-]|$)/i.test(modelId);
}
