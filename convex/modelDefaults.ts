/**
 * Convex-safe default model ids (no imports, no Node APIs). One literal per default so a model
 * refresh edits one line. Env chains (AGENT_MODEL ?? ...) stay at the call sites.
 *
 * Spec: model-defaults SPEC Part A §A.2 (NodeRoom).
 */

/**
 * Default agent model. Was "gemini-3.5-flash": Google deprecated it 2026-10-08 and auto-routes it
 * to gemini-3.6-flash. Merge is gated on the L1-L4 ladder receipt in
 * docs/eval/ladder/model-refresh-noderoom.json (see CHANGELOG/qa/model-refresh-noderoom.md).
 */
export const DEFAULT_AGENT_MODEL = "gemini-3.8-flash";

/** File-egress fallback (OpenRouter). Listed, no expiry; unchanged by the refresh. */
export const DEFAULT_FILE_EGRESS_MODEL = "z-ai/glm-4.7-flash";

/**
 * `top_paid` route default (convex/agentJobs.ts; env chain AGENT_TOP_PAID_MODEL ?? AGENT_MODEL ?? this stays at the call site).
 * Was "anthropic/claude-sonnet-4" (retired 2026-06-15). SPEC-v9 D2 (Homen, 2026-10-16): no working OpenRouter key exists, so
 * an OpenRouter-routed role moves to the newest `:free` model that the public https://openrouter.ai/api/v1/models list shows
 * with the capabilities the role needs. This role runs the tool loop (forced tool_choice, tools, structured outputs) over long
 * room context, so it needs `tools`, `tool_choice`, `structured_outputs` and a >= 256K context. List fetched
 * 2026-10-16T11:32Z: nvidia/nemotron-3.5-super-vl:free (created 2026-10-15, 1,000,000 context, text output, no expiration_date).
 * LIVE-UNVERIFIED (no key, Homen 2026-10-16): never called. Unlike the old paid default this is a free route, so a room with
 * an uploaded file is blocked by the free-file-egress gate unless AGENT_TOP_PAID_MODEL / AGENT_MODEL is set (CHANGELOG/qa).
 */
export const DEFAULT_TOP_PAID_MODEL = "nvidia/nemotron-3.5-super-vl:free";
