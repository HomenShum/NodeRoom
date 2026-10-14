/** Minimal direct probe — calls each model with a 1-token request and prints OK or the real
 *  error, so we KNOW which latest ids actually exist/work before benchmarking.
 *   npx tsx scripts/benchmark/probe.ts */
import "./loadEnv";
const { generateText } = await import("ai");
const { anthropic } = await import("@ai-sdk/anthropic");
const { openai, createOpenAI } = await import("@ai-sdk/openai");
const { google } = await import("@ai-sdk/google");
const or = createOpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });

const cases: [string, any][] = [
  // Anthropic latest (5.5 = the migration-guide successors; claude-opus-4-8 is still Active)
  ["claude-haiku-5-5", anthropic("claude-haiku-5-5")],
  ["claude-sonnet-5-5", anthropic("claude-sonnet-5-5")],
  ["claude-opus-5-5", anthropic("claude-opus-5-5")],
  ["claude-opus-4-8", anthropic("claude-opus-4-8")],
  ["claude-sonnet-4-6", anthropic("claude-sonnet-4-6")],
  ["claude-haiku-4-5", anthropic("claude-haiku-4-5")],
  // Google latest (gemini 3.x). gemini-3.5-flash stays on purpose: Google auto-routes it to 3.6 since 2026-10-08.
  ["gemini-3.8-flash", google("gemini-3.8-flash")],
  ["gemini-3.5-flash-lite", google("gemini-3.5-flash-lite")],
  ["gemini-3.5-flash", google("gemini-3.5-flash")],
  ["gemini-3-flash-preview", google("gemini-3-flash-preview")],
  ["gemini-3.1-flash-lite", google("gemini-3.1-flash-lite")],
  ["gemini-2.5-flash", google("gemini-2.5-flash")],
  ["gemini-2.5-flash-lite", google("gemini-2.5-flash-lite")],
  // OpenAI latest (gpt-5.x / gpt-6.x)
  ["gpt-6.1-sol", openai("gpt-6.1-sol")],
  ["gpt-5.5", openai("gpt-5.5")],
  ["gpt-5.4", openai("gpt-5.4")],
  ["gpt-5.4-mini", openai("gpt-5.4-mini")],
  ["gpt-5.4-nano", openai("gpt-5.4-nano")],
  // OpenRouter (cheap/free) — simple-call reachability
  ["OR ibm-granite/granite-4.1-8b", or.chat("ibm-granite/granite-4.1-8b")],
  ["OR deepseek/deepseek-v4-flash", or.chat("deepseek/deepseek-v4-flash")],
  ["OR z-ai/glm-4.7-flash", or.chat("z-ai/glm-4.7-flash")],
];
for (const [name, model] of cases) {
  try {
    const r = await generateText({ model, prompt: "Reply with the word OK." });
    console.log(`✅ ${name.padEnd(26)} -> "${(r.text || "").slice(0, 16).trim()}"`);
  } catch (e: any) {
    const status = e?.statusCode ?? e?.status ?? "";
    console.log(`❌ ${name.padEnd(26)} -> [${status}] ${(e?.message || "").slice(0, 90)}`);
  }
}
