/**
 * Per-token price table for models whose official price was verified.
 * USD per 1M tokens. Unknown model => costUsd null, never 0.
 *
 * Sources (fetched 2026-10-29):
 *   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
 *   OpenAI    https://developers.openai.com/api/docs/pricing (standard tier)
 *   Google    https://ai.google.dev/gemini-api/docs/pricing (paid tier)
 * Not listed on the provider page that day, so deliberately absent: gemini-3.5-flash.
 *
 * Convention: `inputTokens` is uncached input; cache reads/writes are counted
 * separately (Anthropic usage semantics). Adapters for providers that report
 * cached tokens as a subset of input must subtract them before emitting usage.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  provider: "anthropic" | "openai" | "google";
}

// ponytail: base tier only. Long-context tiers (Haiku 5.5 >100k prompt, gpt-5.5/5.4/6-sol >272k,
// gemini-3.1-pro >200k) are per request and cannot be applied to run totals; cost is a lower bound there.
const PRICES: Record<string, Price> = {
  // cacheWrite = 5-minute cache write price.
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, provider: "anthropic" },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, provider: "anthropic" },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, provider: "anthropic" },
  // OpenAI does not bill cache writes separately; they are priced as input.
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5, provider: "openai" },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5, provider: "openai" },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75, provider: "openai" },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0.2, provider: "openai" },
  "gpt-5.3-codex": { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 1.75, provider: "openai" },
  "gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2, provider: "openai" },
  // Context-cache storage (per hour) is not modelled; cache writes priced as input.
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3, provider: "google" },
  "gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2, provider: "google" },
};

const SOURCE_DATE = "2026-10-29";

/** Strips routing prefixes ("anthropic/", "models/") and Anthropic date suffixes ("-20261001"). */
function normalizeModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(?:models\/|anthropic\/|openai\/|google\/)/, "")
    .replace(/-\d{8}$/, "");
}

export function priceUsage(
  model: string,
  t: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): { costUsd: number | null; source: string } {
  const p = PRICES[normalizeModel(model ?? "")];
  if (!p) return { costUsd: null, source: `no verified price for model "${model}"` };
  const cost =
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      (t.cacheReadTokens ?? 0) * p.cacheRead +
      (t.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000;
  return { costUsd: Math.round(cost * 1e6) / 1e6, source: `price-table:${p.provider}:${SOURCE_DATE}:base-tier` };
}
