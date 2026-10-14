/**
 * Output-token cap shared by the Convex-safe HTTP model (convexModel.ts) and the AI-SDK adapter
 * (adapter.ts), so the cap a request carries is the same number the spend reservation prices.
 */
import { isClaude55Id } from "./modelCatalog";

const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
/** Claude 5.5 spends thinking inside max_tokens; a cap sized for 4.5 truncates the answer. */
const CLAUDE_55_MIN_OUTPUT_TOKENS = 2_048;

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]?.trim() || fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

export function modelMaxOutputTokens(modelId?: string): number {
  const configured = envNumber("AGENT_MODEL_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS, 1_024, 32_000);
  return modelId && isClaude55Id(modelId) ? Math.max(configured, CLAUDE_55_MIN_OUTPUT_TOKENS) : configured;
}
