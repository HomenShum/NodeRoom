/**
 * 2026-10 model refresh (SPEC Part A §A.2.9, rule A.0.6): one request-shape test per changed role.
 *
 * Each test builds a REAL provider request through the repo's own builder (convexModel's direct-HTTP
 * steps, the AI-SDK adapter, aiSdkReasoner, the LangChain bridge) with a fake transport (`fetch`), then asserts
 *   - the wire `model` string is the §1.2 id, written here as a literal on purpose (not imported from the code
 *     under test), and
 *   - the keys the §1.3 row forbids for that id are absent from the body.
 * These assertions fail against the pre-refresh literals (gemini-3.5-flash, claude-haiku-4-5, claude-sonnet-4, ...).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { anthropicModel, model as adapterModel } from "../src/nodeagent/models/adapter";
import { convexModel } from "../src/nodeagent/models/convexModel";
import { aiSdkReasoner } from "../src/nodeagent/capture/reasoning";
import { createLangChainAgentModel } from "../src/nodeagent/integrations/langchain";
import { createPiAiAdapter } from "../src/nodeagent/models/piAiAdapter";
import { defaultRouteForTask, chooseNodeAgentRoute } from "../src/nodeagent/core/adaptiveRouter";
import { providerParserModelCandidates } from "../src/nodeagent/models/providerParserLive";
import { getModelPricing, getProviderForModel, resolveModelAlias } from "../src/nodeagent/models/modelCatalog";
import type { AgentTool } from "../src/nodeagent/core/types";

type Seen = { url: string; headers: Record<string, string>; body: Record<string, any> };

const NOOP_TOOL: AgentTool = {
  name: "noop",
  description: "does nothing",
  schema: z.object({ note: z.string().optional() }),
  execute: async () => ({ ok: true }),
};

/** Sampling / reasoning / prefill keys that the §1.3 rows for the 5.5 and 3.x ids reject or deprecate. */
const FORBIDDEN_SAMPLING_KEYS = ["temperature", "top_p", "top_k", "topP", "topK", "frequency_penalty", "presence_penalty"];

function anthropicOk(model: string) {
  return { id: "msg_test", type: "message", role: "assistant", model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
}
function geminiOk() {
  return { candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
}
function chatOk(model: string) {
  return { id: "gen-test", model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
}

const seen: Seen[] = [];
function installFakeTransport(respond: (req: Seen) => unknown) {
  seen.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const req: Seen = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(raw) };
    seen.push(req);
    return new Response(JSON.stringify(respond(req)), { status: 200, headers: { "content-type": "application/json" } });
  });
}

function expectNoSamplingKeys(body: Record<string, any>) {
  for (const key of FORBIDDEN_SAMPLING_KEYS) expect(body, key).not.toHaveProperty(key);
  expect(body.generationConfig ?? {}, "generationConfig").not.toHaveProperty("temperature");
  expect(body.generationConfig?.thinkingConfig ?? {}, "thinkingConfig").not.toHaveProperty("thinkingBudget");
}

const ENV_KEYS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENROUTER_API_KEY",
  "AGENT_MODEL", "AGENT_MODEL_MAX_OUTPUT_TOKENS", "AGENT_FALLBACK_MODEL", "AGENT_RESEARCH_MODEL", "AGENT_ROUTER_MODEL",
  "PROVIDER_PARSER_GEMINI_MODEL", "PROVIDER_PARSER_OPENAI_MODEL", "PROVIDER_PARSER_ANTHROPIC_MODEL", "PROVIDER_PARSER_OPENROUTER_MODEL",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

describe("Claude 5.5 over the direct Anthropic HTTP step (convexModel.anthropicStep)", () => {
  for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const) {
    it(`${id}: wire id, no sampling/thinking/tool_choice/prefill, max_tokens floored at 2048`, async () => {
      installFakeTransport(() => anthropicOk(id));
      // A cap sized for 4.5 (1024) would truncate a 5.5 reply because thinking counts toward max_tokens.
      process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS = "1024";
      await convexModel(id).next({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [NOOP_TOOL],
        toolChoice: "required",
      });
      expect(seen).toHaveLength(1);
      const { body, url } = seen[0];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(body.model).toBe(id);
      expectNoSamplingKeys(body);
      expect(body).not.toHaveProperty("thinking"); // budget_tokens is a 400 on 5.5
      expect(body).not.toHaveProperty("tool_choice"); // Sonnet/Opus 5.5 400 on forced choice; Haiku sends none either
      expect(body.messages.at(-1).role).toBe("user"); // assistant prefill is a 400 on 5.5
      expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
    });
  }

  it("a pre-5.5 id keeps the configured cap (the floor is keyed to the 5.5 ids only)", async () => {
    installFakeTransport(() => anthropicOk("claude-haiku-4-5"));
    process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS = "1024";
    await convexModel("claude-haiku-4-5").next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen[0].body.max_tokens).toBe(1024);
  });

  it("reads response content blocks by type (a leading thinking block does not hide the text)", async () => {
    installFakeTransport(() => ({
      ...anthropicOk("claude-haiku-5-5"),
      content: [{ type: "thinking", thinking: "hmm", signature: "sig" }, { type: "text", text: "answer" }],
    }));
    const step = await convexModel("claude-haiku-5-5").next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(step.text).toBe("answer");
  });
});

describe("anthropic/claude-*-5.5 over OpenRouter (convexModel.openAiCompatibleStep)", () => {
  it("top_paid default anthropic/claude-sonnet-5.5: forced tool_choice is sent as auto", async () => {
    installFakeTransport(() => chatOk("anthropic/claude-sonnet-5.5"));
    await convexModel("anthropic/claude-sonnet-5.5").next({
      system: "s", messages: [{ role: "user", content: "hi" }], tools: [NOOP_TOOL], toolChoice: "required",
    });
    const { body, url } = seen[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("anthropic/claude-sonnet-5.5");
    expect(body.tool_choice).toBe("auto");
    expectNoSamplingKeys(body);
  });

  it("opus 5.5 is downgraded the same way; haiku 5.5 accepts a forced choice and keeps it", async () => {
    installFakeTransport(() => chatOk("x"));
    const turn = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [NOOP_TOOL], toolChoice: "required" as const };
    await convexModel("anthropic/claude-opus-5.5").next(turn);
    await convexModel("anthropic/claude-haiku-5.5").next(turn);
    expect(seen.map((r) => [r.body.model, r.body.tool_choice])).toEqual([
      ["anthropic/claude-opus-5.5", "auto"],
      ["anthropic/claude-haiku-5.5", "required"],
    ]);
  });
});

describe("Claude 5.5 over the AI-SDK adapter (adapter.model, direct Anthropic)", () => {
  const cases = [
    { id: "claude-haiku-5-5", forcedAllowed: true, effort: "medium" },
    { id: "claude-sonnet-5-5", forcedAllowed: false, effort: "high" },
    { id: "claude-opus-5-5", forcedAllowed: false, effort: "medium" },
  ] as const;
  for (const c of cases) {
    it(`${c.id}: wire id, explicit effort ${c.effort}, ${c.forcedAllowed ? "forced tool_choice kept" : "forced tool_choice downgraded"}, no sampling keys`, async () => {
      // A forced tool_choice makes the SDK demand a tool call back, so answer with one.
      installFakeTransport((req) => req.body.tool_choice?.type === "any"
        ? { ...anthropicOk(c.id), content: [{ type: "tool_use", id: "tu_1", name: "noop", input: {} }], stop_reason: "tool_use" }
        : anthropicOk(c.id));
      await adapterModel(c.id).next({
        system: "s", messages: [{ role: "user", content: "hi" }], tools: [NOOP_TOOL], toolChoice: "required",
      });
      expect(seen).toHaveLength(1); // the AI SDK's own retry loop is pinned to 0
      const { body, url } = seen[0];
      expect(url).toMatch(/\/messages$/);
      expect(body.model).toBe(c.id);
      expectNoSamplingKeys(body);
      expect(body).not.toHaveProperty("thinking");
      expect(body.output_config?.effort).toBe(c.effort);
      expect(body.max_tokens).toBe(8192);
      if (c.forcedAllowed) expect(body.tool_choice?.type).toBe("any");
      else expect(body.tool_choice?.type).toBe("auto");
    });
  }

  it("anthropicModel() defaults to claude-haiku-5-5 (was claude-haiku-4-5)", async () => {
    installFakeTransport(() => anthropicOk("claude-haiku-5-5"));
    const m = anthropicModel();
    expect(m.name).toBe("claude-haiku-5-5");
    await m.next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen[0].body.model).toBe("claude-haiku-5-5");
  });
});

describe("capture reasoner (aiSdkReasoner)", () => {
  it("defaults to claude-haiku-5-5 and sends no sampling keys", async () => {
    installFakeTransport((req) => {
      // generateObject answers either through a JSON tool or as text, depending on the SDK mode it picked.
      const tool = (req.body.tools ?? []).find((t: any) => t?.name === "json");
      return tool
        ? { ...anthropicOk("claude-haiku-5-5"), content: [{ type: "tool_use", id: "tu_1", name: "json", input: { ok: true } }], stop_reason: "tool_use" }
        : { ...anthropicOk("claude-haiku-5-5"), content: [{ type: "text", text: "{\"ok\":true}" }] };
    });
    const reasoner = aiSdkReasoner();
    expect(reasoner.name).toBe("claude-haiku-5-5");
    await reasoner.decide({
      system: "s",
      instruction: "decide",
      context: { title: "t", url: "https://example.test", a11y: "tree" } as any,
      schema: z.object({ ok: z.boolean() }),
    });
    expect(seen[0].body.model).toBe("claude-haiku-5-5");
    expectNoSamplingKeys(seen[0].body);
  });
});

describe("gemini-3.8-flash (the new DEFAULT_AGENT_MODEL)", () => {
  it("AI-SDK adapter: wire id in the URL, output cap set, no temperature / thinkingBudget", async () => {
    installFakeTransport(() => geminiOk());
    await adapterModel("gemini-3.8-flash").next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/models/gemini-3.8-flash:generateContent");
    expectNoSamplingKeys(seen[0].body);
    expect(seen[0].body.generationConfig?.maxOutputTokens).toBe(8192);
  });

  it("direct HTTP step: wire id in the URL, no temperature / thinkingBudget", async () => {
    installFakeTransport(() => geminiOk());
    await convexModel("gemini-3.8-flash").next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen[0].url).toContain("/models/gemini-3.8-flash:generateContent");
    expectNoSamplingKeys(seen[0].body);
  });

  it("pi-ai adapter default resolves to a routable, priced gemini id (no pi-ai package: it wraps model())", () => {
    const m = createPiAiAdapter();
    expect(m.name).toBe("gemini-3.8-flash");
    expect(getProviderForModel(m.name)).toBe("gemini");
    expect(getModelPricing(m.name)).not.toBeNull();
  });
});

describe("default ids at the changed sites", () => {
  it("AGENT_MODEL-less routing lands on gemini-3.8-flash; the fast lane stays on the laddered route", () => {
    expect(defaultRouteForTask("chat" as any)).toBe("gemini-3.8-flash");
    expect(resolveModelAlias("auto")).toBe("gemini-3.8-flash");
    // adaptiveRouter.ts fast lane moves only after docs/eval/ladder/model-refresh-noderoom.json exists.
    expect(chooseNodeAgentRoute({ task: "chat", risk: "low", latency: "interactive" } as any).model).toBe("gemini-3.5-flash");
  });

  it("provider-parser candidate lists are the refreshed ones (no retired / unlisted ids)", () => {
    expect(providerParserModelCandidates("gemini")).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
    expect(providerParserModelCandidates("openai")).toEqual(["gpt-5.5", "gpt-5.4-mini"]);
    expect(providerParserModelCandidates("anthropic")).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(providerParserModelCandidates("openrouter")).not.toContain("nex-agi/nex-n2-pro");
    // caller preference and the env override still come first
    expect(providerParserModelCandidates("gemini", "gemini-3.1-pro-preview", { PROVIDER_PARSER_GEMINI_MODEL: "x" } as any).slice(0, 2))
      .toEqual(["gemini-3.1-pro-preview", "x"]);
  });
});

describe("LangChain bridge tool_choice guard", () => {
  function captured(modelName: string) {
    const bound: Array<Record<string, unknown>> = [];
    const chat = {
      model: modelName,
      bindTools(_tools: unknown[], config: Record<string, unknown>) {
        bound.push(config);
        return { invoke: async () => ({ content: "ok" }) };
      },
      invoke: async () => ({ content: "ok" }),
    };
    return { chat, bound };
  }
  it("sends tool_choice any for Haiku 5.5 and for 4.x, and nothing for Sonnet/Opus 5.5", async () => {
    const got: Record<string, unknown> = {};
    for (const id of ["claude-haiku-5-5", "claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"]) {
      const { chat, bound } = captured(id);
      await createLangChainAgentModel(chat as any).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [NOOP_TOOL], toolChoice: "required" });
      got[id] = bound[0];
    }
    expect(got).toEqual({
      "claude-haiku-5-5": { tool_choice: "any" },
      "claude-haiku-4-5": { tool_choice: "any" },
      "claude-sonnet-5-5": {},
      "claude-opus-5-5": {},
    });
  });
});
