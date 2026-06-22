/* ============================================================================
   Curated 2026 model registry — the source of truth for the mobile composer's
   model chips + the chat job-meta label. The server-side NodeAgent router
   already accepts every id below (via
   prefix-based provider routing); the env var `AGENT_MODEL` on Convex prod
   picks the actual default. This file exists so the UI no longer displays
   "Haiku/Sonnet/Opus" when the agent is actually running on something else.

   Provider routing recap:
     • gpt-* / o1-* / o4-*  → openai (direct)
     • claude-*             → anthropic (direct)
     • gemini-*             → gemini (direct)
     • anything with "/"    → openrouter (the substrate Homen prefers)
     • "auto"               → resolves to gemini-3.5-flash
     • "free"/"openrouter/free-auto" → free-auto sentinel
   ============================================================================ */

export type CostClass = "free" | "standard" | "premium";
export type ProviderHint = "openrouter" | "gemini" | "anthropic" | "openai";

export interface ModelRegistryEntry {
  /** The id the agent runtime will route on. Slash-format → OpenRouter. */
  id: string;
  /** Short label for chips ("GLM 5.2"). */
  displayName: string;
  /** One-line subtitle for the picker dropdown. */
  sub: string;
  /** Cost class for UI signal. */
  costClass: CostClass;
  /** mobile IconName (in MobileIcons.tsx). Kept loose; existing mobile chip icons. */
  icon: "route" | "bolt" | "sparkles" | "gauge" | "code" | "spark";
  /** Where this id ultimately ends up. */
  providerHint: ProviderHint;
  /** Optional one-line note for the desc tooltip / interview talking point. */
  notes?: string;
}

/** Active default — must match the Convex AGENT_MODEL env var. */
export const DEFAULT_MODEL_ID = "z-ai/glm-5.2";

export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  {
    id: "z-ai/glm-5.2",
    displayName: "GLM 5.2",
    sub: "Open-weight default · cheap · fast",
    costClass: "standard",
    icon: "bolt",
    providerHint: "openrouter",
    notes: "deepswe #5 44% open-weight; current AGENT_MODEL default on prod",
  },
  {
    id: "anthropic/claude-fable-5",
    displayName: "Claude Fable 5",
    sub: "Deepest synthesis · premium",
    costClass: "premium",
    icon: "sparkles",
    providerHint: "openrouter",
    notes: "deepswe #1 70%; route via OpenRouter substrate",
  },
  {
    id: "moonshotai/kimi-k2.7-code",
    displayName: "Kimi K2.7 Code",
    sub: "Open-weight coding-tuned",
    costClass: "standard",
    icon: "code",
    providerHint: "openrouter",
  },
  {
    id: "openai/gpt-5.5",
    displayName: "GPT 5.5",
    sub: "Deep diligence · premium",
    costClass: "premium",
    icon: "gauge",
    providerHint: "openrouter",
    notes: "deepswe #2 67% — routed via OpenRouter for consistent telemetry",
  },
  {
    id: "cohere/north-mini-code:free",
    displayName: "Cohere North Mini",
    sub: "Free tier · quick lookups",
    costClass: "free",
    icon: "spark",
    providerHint: "openrouter",
  },
  {
    id: "google/gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    sub: "Familiar Google route",
    costClass: "standard",
    icon: "spark",
    providerHint: "openrouter",
    notes: "Previously the AGENT_MODEL default; kept for fallback parity",
  },
];

/** UI label resolver. Used by MobileChat.tsx job-meta chip; falls back to
 *  "Auto" when the id is missing or unknown (legacy in-flight jobs may have
 *  job.route empty; that should never display the stale "haiku" literal). */
export function getModelLabel(id?: string | null): string {
  if (!id) return "Auto";
  const entry = MODEL_REGISTRY.find((m) => m.id === id);
  if (entry) return entry.displayName;
  // Slash-format id we haven't curated — show the last path segment so we
  // never silently lie about the model (e.g. "deepseek-v4-flash").
  if (id.includes("/")) return id.split("/").pop() || id;
  return id;
}
