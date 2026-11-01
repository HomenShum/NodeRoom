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
import { anthropicModel, judge, model as adapterModel } from "../src/nodeagent/models/adapter";
import { convexModel } from "../src/nodeagent/models/convexModel";
import { DEFAULT_TOP_PAID_MODEL } from "../convex/modelDefaults";
import { aiSdkReasoner } from "../src/nodeagent/capture/reasoning";
import { createLangChainAgentModel } from "../src/nodeagent/integrations/langchain";
import { createPiAiAdapter } from "../src/nodeagent/models/piAiAdapter";
import { defaultRouteForTask, chooseNodeAgentRoute } from "../src/nodeagent/core/adaptiveRouter";
import { providerParserModelCandidates } from "../src/nodeagent/models/providerParserLive";
import { getModelPricing, getProviderForModel, resolveModelAlias, UnknownModelError } from "../src/nodeagent/models/modelCatalog";
import type { AgentModel, AgentTool } from "../src/nodeagent/core/types";
import { runAgent, InMemoryRoomTools } from "../src/nodeagent/index";
import { estimateChars } from "../src/nodeagent/core/contextCompactor";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { SERVER_PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/server/productionTools";

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

  // SPEC §1.3 downgrades a forced tool_choice to `auto`; tool definitions stay plain. `strict: true` is NOT sent: the
  // production room-tool schemas are not strict-compatible (Anthropic rejects objects without additionalProperties:false,
  // record types and length/range constraints), so it would swap one 400 for another. The harness validates after the turn.
  for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const) {
    it(`${id}: a required tool choice never ships strict tool definitions, even for all ${SERVER_PRODUCTION_ROOM_TOOLS.length} production room tools`, async () => {
      installFakeTransport(() => anthropicOk(id));
      await convexModel(id).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: SERVER_PRODUCTION_ROOM_TOOLS as unknown as AgentTool[], toolChoice: "required" });
      expect(seen[0].body.tools).toHaveLength(SERVER_PRODUCTION_ROOM_TOOLS.length);
      for (const tool of seen[0].body.tools) expect(tool, tool.name).not.toHaveProperty("strict");
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
  it("anthropic/claude-sonnet-5.5 (an operator-set AGENT_TOP_PAID_MODEL): forced tool_choice is sent as auto", async () => {
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

  it("the auto downgrade ships plain tool definitions (no strict) for all production room tools; a kept forced choice does too", async () => {
    installFakeTransport(() => chatOk("x"));
    const turn = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: SERVER_PRODUCTION_ROOM_TOOLS as unknown as AgentTool[], toolChoice: "required" as const };
    await convexModel("anthropic/claude-sonnet-5.5").next(turn);
    await convexModel("anthropic/claude-opus-5.5").next(turn);
    await convexModel("anthropic/claude-haiku-5.5").next(turn);
    expect(seen.map((r) => [r.body.model, r.body.tool_choice])).toEqual([
      ["anthropic/claude-sonnet-5.5", "auto"],
      ["anthropic/claude-opus-5.5", "auto"],
      ["anthropic/claude-haiku-5.5", "required"],
    ]);
    for (const r of seen) for (const tool of r.body.tools) expect(tool.function, tool.function.name).not.toHaveProperty("strict");
  });
});

describe("top_paid code default (SPEC-v9 D2: nvidia/nemotron-3.5-super-vl:free) over OpenRouter", () => {
  it("the id the top_paid route resolves to goes out as written, with a forced tool_choice and no sampling keys", async () => {
    // The runner builds this model from job.modelPolicy, which defaultModelPolicyForRoute fills with DEFAULT_TOP_PAID_MODEL.
    expect(DEFAULT_TOP_PAID_MODEL).toBe("nvidia/nemotron-3.5-super-vl:free");
    installFakeTransport(() => chatOk("nvidia/nemotron-3.5-super-vl:free"));
    await convexModel(DEFAULT_TOP_PAID_MODEL).next({
      system: "s", messages: [{ role: "user", content: "hi" }], tools: [NOOP_TOOL], toolChoice: "required",
    });
    expect(seen).toHaveLength(1);
    const { body, url } = seen[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("nvidia/nemotron-3.5-super-vl:free");
    expect(body.tool_choice).toBe("required"); // §1.3 forbids forcing only on the Claude 5.5 ids
    expectNoSamplingKeys(body);
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
      // §1.3: `auto` replaces a forced choice; tool definitions stay plain for every id (the production schemas are not strict-compatible).
      for (const tool of body.tools) expect(tool, tool.name).not.toHaveProperty("strict");
    });
  }

  it("all production room tools go out plain (no strict) on the AI-SDK path for Sonnet and Opus 5.5", async () => {
    for (const id of ["claude-sonnet-5-5", "claude-opus-5-5"] as const) {
      installFakeTransport(() => ({ ...anthropicOk(id), content: [{ type: "tool_use", id: "tu_1", name: SERVER_PRODUCTION_ROOM_TOOLS[0].name, input: {} }], stop_reason: "tool_use" }));
      await adapterModel(id).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: SERVER_PRODUCTION_ROOM_TOOLS as unknown as AgentTool[], toolChoice: "required" }).catch(() => undefined);
      expect(seen.length, id).toBeGreaterThan(0);
      expect(seen[0].body.tools, id).toHaveLength(SERVER_PRODUCTION_ROOM_TOOLS.length);
      expect(seen[0].body.tool_choice?.type, id).toBe("auto");
      for (const tool of seen[0].body.tools) expect(tool, `${id} ${tool.name}`).not.toHaveProperty("strict");
    }
  });

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
    expect(seen[0].body.output_config?.effort).toBe("medium"); // explicit §1.3 default for Haiku 5.5, not the vendor's
  });

  it("an explicit claude-sonnet-5-5 id sends effort high (the caller's id, not a default, picks the row)", async () => {
    installFakeTransport(() => ({ ...anthropicOk("claude-sonnet-5-5"), content: [{ type: "text", text: "{\"ok\":true}" }] }));
    await aiSdkReasoner("claude-sonnet-5-5").decide({
      system: "s",
      instruction: "decide",
      context: { title: "t", url: "https://example.test", a11y: "tree" } as any,
      schema: z.object({ ok: z.boolean() }),
    });
    expect(seen[0].body.model).toBe("claude-sonnet-5-5");
    expect(seen[0].body.output_config?.effort).toBe("high");
  });

  // SPEC A.0.10 at the public boundary of the migrated capture/reasoning.ts:23 role: convex/capturesNode.ts `capture` hands a
  // client-supplied modelId to aiSdkReasoner, and the provider is picked by prefix alone. Any room member could drive any
  // Anthropic or OpenAI id; the resolver now refuses ids the catalog does not know before a request exists.
  it.each(["claude-not-in-catalog-9", "gpt-not-in-catalog", "o3-not-in-catalog", "claude-opus-9"])("refuses the unknown id %s with zero requests", async (id) => {
    installFakeTransport(() => ({ ...anthropicOk("claude-haiku-5-5"), content: [{ type: "text", text: "{\"ok\":true}" }] }));
    let decided: Promise<unknown> | undefined;
    expect(() => {
      decided = aiSdkReasoner(id).decide({ system: "s", instruction: "decide", context: { title: "t", url: "https://example.test", a11y: "tree" } as any, schema: z.object({ ok: z.boolean() }) });
    }).toThrow(UnknownModelError);
    await decided?.catch(() => undefined);
    expect(seen).toHaveLength(0);
  });

  // Review round 6, defect 2. An unknown id that LOOKS free resolves to `openrouter/free-auto`, which this Anthropic/OpenAI seam
  // cannot serve. The guard used to throw the resolution away and send the raw string to whichever provider its prefix named.
  it.each(["claude-not-in-catalog:free", "gpt-not-in-catalog-free", "gemini-3.8-flash:free", "foo/bar:free"])("refuses the free-looking unknown id %s with zero requests (not sent under its raw name)", async (id) => {
    installFakeTransport(() => ({ ...anthropicOk("claude-haiku-5-5"), content: [{ type: "text", text: "{\"ok\":true}" }] }));
    let decided: Promise<unknown> | undefined;
    expect(() => {
      decided = aiSdkReasoner(id).decide({ system: "s", instruction: "decide", context: { title: "t", url: "https://example.test", a11y: "tree" } as any, schema: z.object({ ok: z.boolean() }) });
    }).toThrow("capture_reasoner_route_unsupported:openrouter/free-auto");
    await decided?.catch(() => undefined);
    expect(seen).toHaveLength(0);
  });

  it("dispatches the RESOLVED id: a dotted display id goes out in its hyphenated wire form", async () => {
    installFakeTransport(() => ({ ...anthropicOk("claude-opus-4-8"), content: [{ type: "text", text: "{\"ok\":true}" }] }));
    await aiSdkReasoner("claude-opus-4.8").decide({ system: "s", instruction: "decide", context: { title: "t", url: "https://example.test", a11y: "tree" } as any, schema: z.object({ ok: z.boolean() }) });
    expect(seen[0].body.model).toBe("claude-opus-4-8");
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

  // Review round 6, defect 1 (SPEC-v9 D1). Persona: an evaluator runs the startup-diligence provider eval with an id the catalog has
  // never seen (`--model` or an env candidate). origin/main measured that id; the fail-closed resolver skipped it and measured
  // gemini-3.8-flash instead. An operator-selected id reaches the wire as written; server code (no option) still refuses it.
  it("convexModel({ operatorSelected }) sends an id the catalog does not know as written; without the option it throws before any request", async () => {
    installFakeTransport(() => geminiOk());
    await convexModel("gemini-not-in-catalog", { operatorSelected: true }).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/models/gemini-not-in-catalog:generateContent");
    expect(() => convexModel("gemini-not-in-catalog")).toThrow(UnknownModelError);
    expect(seen).toHaveLength(1);
  });

  it("judge() sends explicit output_config.effort on the Claude 5.5 ids: haiku medium, sonnet high, opus medium", async () => {
    for (const [id, effort] of [["claude-haiku-5-5", "medium"], ["claude-sonnet-5-5", "high"], ["claude-opus-5-5", "medium"]] as const) {
      installFakeTransport(() => anthropicOk(id));
      await judge(id, "p");
      expect(seen, id).toHaveLength(1);
      expect(seen[0].body.model).toBe(id);
      expect(seen[0].body.output_config?.effort, id).toBe(effort);
      expectNoSamplingKeys(seen[0].body);
    }
  });

  // Review round 7, defect 2 (SPEC-v9 D1). Persona: an evaluator runs `evals/professionalLiveCatalog --model <id>` or sets JUDGE_MODEL to
  // an id the catalog has never seen. origin/main sent that id; judge() used the strict resolver, so it threw, and a concrete `:free`
  // id was rewritten to a different free model - the run was measured under the wrong label.
  it("judge(id, prompt, { operatorSelected }) sends the id as written; without the option an unknown id throws before any request", async () => {
    installFakeTransport(() => geminiOk());
    await judge("gemini-not-in-catalog", "p", { operatorSelected: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/models/gemini-not-in-catalog:generateContent");
    await expect(judge("gemini-not-in-catalog", "p")).rejects.toBeInstanceOf(UnknownModelError);
    expect(seen).toHaveLength(1);
    installFakeTransport(() => chatOk("acme/new-model:free"));
    await judge("acme/new-model:free", "p", { operatorSelected: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen[0].body.model).toBe("acme/new-model:free");
  });

  // Review round 6, defect 4 (A.0.5 compatibility). The explicit alias table replaced a regex that hyphenated EVERY dotted
  // claude id; the two retired ids it forgot went out dotted. Both are retired (the provider rejects either spelling), but a persisted
  // row on one of them must produce the request main produced.
  it.each([["claude-opus-4.1", "claude-opus-4-1"], ["claude-haiku-3.5", "claude-haiku-3-5"]])("retained dotted id %s goes out as %s on both Anthropic builders", async (id, wire) => {
    installFakeTransport(() => anthropicOk(wire));
    await convexModel(id).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    await adapterModel(id).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen.map((r) => r.body.model)).toEqual([wire, wire]);
  });

  it("pi-ai adapter default: next() puts gemini-3.8-flash on the wire, with no sampling keys (no pi-ai package: it wraps model())", async () => {
    installFakeTransport(() => geminiOk());
    const m = createPiAiAdapter();
    expect(m.name).toBe("gemini-3.8-flash");
    await m.next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/models/gemini-3.8-flash:generateContent");
    expectNoSamplingKeys(seen[0].body);
    expect(getProviderForModel(m.name)).toBe("gemini");
    expect(getModelPricing(m.name)).not.toBeNull();
  });

  it("pi-ai adapter keeps deriving the provider from an explicit modelName (A.0.4)", async () => {
    installFakeTransport(() => geminiOk());
    await createPiAiAdapter({ modelName: "gemini-3.6-flash" }).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(seen[0].url).toContain("/models/gemini-3.6-flash:generateContent");
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
  it("sends tool_choice any for Haiku 5.5 and for 4.x; Sonnet/Opus 5.5 get no forced choice and no strict", async () => {
    const got: Record<string, unknown> = {};
    for (const id of ["claude-haiku-5-5", "claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"]) {
      const { chat, bound } = captured(id);
      await createLangChainAgentModel(chat as any).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [NOOP_TOOL], toolChoice: "required" });
      got[id] = bound[0];
    }
    expect(got).toEqual({
      "claude-haiku-5-5": { tool_choice: "any" },
      "claude-haiku-4-5": { tool_choice: "any" },
      "claude-sonnet-5-5": {}, // SPEC §1.3: forced choice -> provider default (auto); no strict, the schemas are not strict-compatible
      "claude-opus-5-5": {},
    });
    // No forced choice requested: nothing is added for any id.
    for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {
      const { chat, bound } = captured(id);
      await createLangChainAgentModel(chat as any).next({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [NOOP_TOOL], toolChoice: "auto" });
      expect(bound[0], id).toEqual({});
    }
  });
});

// Claude 5.5 thinks by default (SPEC 1.3: adaptive), and the migration guide's [BLOCKS] item says an earlier assistant turn's
// thinking blocks are passed back unmodified. Drives the REAL runtime loop (runAgent) over each transport, not just the adapters.
describe("Claude 5.5 tool loop sends the earlier turn's thinking blocks back unmodified", () => {
  const THINKING = { type: "thinking", thinking: "I should call noop first.", signature: "sig-abc" };
  const REDACTED = { type: "redacted_thinking", data: "opaque-redacted-payload" };
  const paths: Array<[string, (id: string) => AgentModel]> = [
    ["server path (convexModel.anthropicStep)", (id) => convexModel(id)],
    ["AI-SDK path (adapter.model)", (id) => adapterModel(id)],
  ];
  for (const [label, build] of paths) {
    for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const) {
      it(`${label}, ${id}: step 2's assistant turn is [thinking, redacted_thinking, tool_use] in that order, blocks byte-identical`, async () => {
        installFakeTransport((req) => req.body.messages.some((m: any) => m.role === "assistant")
          ? anthropicOk(id)
          : { ...anthropicOk(id), content: [THINKING, REDACTED, { type: "tool_use", id: "tu_1", name: "noop", input: {} }], stop_reason: "tool_use" });
        const engine = new RoomEngine();
        const d = buildDemoRoom(engine);
        const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
        await runAgent({ rt, goal: "call noop then finish", model: build(id), tools: [NOOP_TOOL], maxSteps: 3 });
        expect(seen.length).toBeGreaterThanOrEqual(2); // the runtime may add a closing turn; request 2 is the one under test
        const assistant = seen[1].body.messages.find((m: any) => m.role === "assistant");
        expect(assistant.content.map((b: any) => b.type)).toEqual(["thinking", "redacted_thinking", "tool_use"]);
        expect(assistant.content[0]).toEqual(THINKING);
        expect(assistant.content[1]).toEqual(REDACTED);
      });
    }
  }

  it("a turn without thinking blocks stays text + tool_use only (nothing is invented)", async () => {
    installFakeTransport((req) => req.body.messages.some((m: any) => m.role === "assistant")
      ? anthropicOk("claude-haiku-5-5")
      : { ...anthropicOk("claude-haiku-5-5"), content: [{ type: "tool_use", id: "tu_1", name: "noop", input: {} }], stop_reason: "tool_use" });
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    await runAgent({ rt, goal: "call noop then finish", model: convexModel("claude-haiku-5-5"), tools: [NOOP_TOOL], maxSteps: 3 });
    expect(seen[1].body.messages.find((m: any) => m.role === "assistant").content.map((b: any) => b.type)).toEqual(["tool_use"]);
  });
});

// A thinking block is signed against system + tools + every earlier message. The runtime edits that prefix (compaction
// rewrites old read_range results; the offered tool set shrinks before the first write), and a re-sent block whose prefix
// changed is a 400 on new accounts (migration guide, "preserved thinking"). So the sender must drop the stale block and every later one,
// and keep sending blocks while the prefix is untouched (the byte-identical case is tested above).
describe("Claude 5.5 thinking blocks are not re-sent once the runtime has edited their prefix", () => {
  const ID = "claude-sonnet-5-5";
  const paths: Array<[string, (id: string) => AgentModel]> = [
    ["server path (convexModel.anthropicStep)", (id) => convexModel(id)],
    ["AI-SDK path (adapter.model)", (id) => adapterModel(id)],
  ];
  const thinkingOf = (sig: string) => ({ type: "thinking", thinking: "", signature: sig });
  const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use", id, name, input });
  /** Request n is answered by script[n-1] (n = assistant turns already in the history + 1); past the script, plain text. */
  function scripted(script: unknown[][]) {
    installFakeTransport((req) => {
      const turns = req.body.messages.filter((m: any) => m.role === "assistant").length;
      return script[turns] ? { ...anthropicOk(ID), content: script[turns], stop_reason: "tool_use" } : anthropicOk(ID);
    });
  }
  const blockTypes = (req: Seen) => req.body.messages.filter((m: any) => m.role === "assistant").map((m: any) => m.content.map((b: any) => b.type));
  const setup = () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    return new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  };
  const BIG_READ: AgentTool = {
    name: "read_range",
    description: "reads cells",
    schema: z.object({}),
    execute: async () => Array.from({ length: 15 }, (_, i) => ({ id: `A${i + 1}`, version: 1, locked: null, value: "x".repeat(1000) })),
  };

  for (const [label, build] of paths) {
    it(`${label}: compaction rewrites an earlier tool result, so request 3 drops the block signed against it`, async () => {
      scripted([[thinkingOf("sig1"), toolUse("tu_1", "read_range")], [thinkingOf("sig2"), toolUse("tu_2", "read_range")]]);
      await runAgent({ rt: setup(), goal: "read the sheet", model: build(ID), tools: [BIG_READ], maxSteps: 4, compaction: { maxChars: 24000 } });
      expect(seen.length).toBeGreaterThanOrEqual(3);
      // request 2: nothing edited yet, so sig1 rides along; request 3: the 15K result that sig2 was signed after is now rewritten, so sig2 is stale; sig1 only depends on the untouched opening message, so it stays
      expect(blockTypes(seen[1])).toEqual([["thinking", "tool_use"]]);
      const toolResults = seen[2].body.messages.flatMap((m: any) => m.role === "user" && Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "tool_result") : []);
      expect(toolResults.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(toolResults[0].content).length, "the earlier read_range result was compacted").toBeLessThan(5000);
      expect(blockTypes(seen[2])).toEqual([["thinking", "tool_use"], ["tool_use"]]);
      expect(JSON.stringify(seen[2].body)).toContain("sig1");
      expect(JSON.stringify(seen[2].body)).not.toContain("sig2");
    });

    it(`${label}: the same run without compaction keeps every block (control: stripping is caused by the edit, not unconditional)`, async () => {
      scripted([[thinkingOf("sig1"), toolUse("tu_1", "read_range")], [thinkingOf("sig2"), toolUse("tu_2", "read_range")]]);
      await runAgent({ rt: setup(), goal: "read the sheet", model: build(ID), tools: [BIG_READ], maxSteps: 4 });
      expect(blockTypes(seen[2])).toEqual([["thinking", "tool_use"], ["thinking", "tool_use"]]);
    });

    it(`${label}: the runtime dropping \`say\` after the first turn changes the tool set, so request 2 carries no thinking blocks`, async () => {
      const say: AgentTool = { name: "say", description: "say something", schema: z.object({ text: z.string().optional() }), execute: async () => ({ ok: true }) };
      const editCell: AgentTool = { name: "edit_cell", description: "edit a cell", schema: z.object({}), execute: async () => ({ ok: true }) };
      scripted([[thinkingOf("sig1"), toolUse("tu_1", "say", { text: "on it" })], [toolUse("tu_2", "edit_cell")]]);
      await runAgent({ rt: setup(), goal: "set the revenue cell to 100", model: build(ID), tools: [say, editCell], maxSteps: 4 });
      expect(seen[0].body.tools.map((t: any) => t.name).sort()).toEqual(["edit_cell", "say"]);
      expect(seen[1].body.tools.map((t: any) => t.name)).toEqual(["edit_cell"]); // the tool set really did shrink
      expect(blockTypes(seen[1])).toEqual([["tool_use"]]);
    });
  }

  it("estimateChars counts thinking text, signatures and redacted data", () => {
    const msg = { role: "assistant" as const, content: "", thinking: [
      { type: "thinking" as const, thinking: "a".repeat(100), signature: "s".repeat(50) },
      { type: "redacted_thinking" as const, data: "d".repeat(30) },
    ] };
    expect(estimateChars([msg])).toBe(180);
  });
});
