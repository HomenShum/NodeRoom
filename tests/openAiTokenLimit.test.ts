import { describe, expect, it } from "vitest";
import { openAiCompatibleTokenLimitParam } from "../src/nodeagent/models/openAiTokenLimit";

describe("OpenAI-compatible token limit params", () => {
  it("uses max_completion_tokens for direct OpenAI gpt-5 chat models", () => {
    expect(openAiCompatibleTokenLimitParam("gpt-5.4-nano", "https://api.openai.com/v1/chat/completions", 1024)).toEqual({
      max_completion_tokens: 1024,
    });
  });

  it("keeps max_tokens for OpenRouter and older direct chat models", () => {
    expect(openAiCompatibleTokenLimitParam("gpt-5.4-nano", "https://openrouter.ai/api/v1/chat/completions", 1024)).toEqual({
      max_tokens: 1024,
    });
    expect(openAiCompatibleTokenLimitParam("gpt-4.1-mini", "https://api.openai.com/v1/chat/completions", 1024)).toEqual({
      max_tokens: 1024,
    });
  });
});
