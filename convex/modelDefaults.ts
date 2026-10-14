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
