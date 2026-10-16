// @vitest-environment edge-runtime
/**
 * 2026-10 model refresh (SPEC Part A A.0.6, review round 5 defect 5) - the DEFAULT_AGENT_MODEL call sites driven through
 * their real handlers, not pinned by regular expressions over the source.
 *
 * Persona: a room member asks the room agent (public_ask), asks their private agent, or a queued job with no recorded
 * model is picked up by the job runner. Each handler is run with a convex-test database behind a fake Convex ctx and a fake
 * `fetch`. What is asserted is what reaches the wire: the model id in the request URL and the absence of sampling keys.
 * A downstream substitution (for example modelNameForEgress always returning the file-egress model) fails here; the
 * source-level pins in modelRefreshCallSites.test.ts only say where the default is spelled.
 *
 * No test here can reach a provider: `fetch` is replaced before any handler runs.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import { DEFAULT_AGENT_MODEL } from "../convex/modelDefaults";
import workflowSchema from "../node_modules/@convex-dev/workflow/dist/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/dist/component/schema.js";

const modules = import.meta.glob("../convex/**/*.ts");
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/dist/component/**/*.js");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/dist/component/**/*.js");
delete (modules as Record<string, unknown>)["../convex/agent.ts"]; // imported directly below; convex-test cannot bundle it
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

vi.setConfig({ testTimeout: 60_000 }); // the first import of convex/agent.ts pulls in the whole runtime graph

type Seen = { url: string; body: Record<string, any> };
const seen: Seen[] = [];
function installFakeTransport(options: { firstCallTool?: string } = {}) {
  seen.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: Record<string, any> = {};
    try { body = JSON.parse(typeof init?.body === "string" ? init.body : "{}"); } catch { /* not JSON */ }
    seen.push({ url, body });
    const part = options.firstCallTool && seen.length === 1
      ? { functionCall: { name: options.firstCallTool, args: {} } }
      : { text: "ok" };
    const reply = { candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  });
}

const FORBIDDEN_SAMPLING_KEYS = ["temperature", "top_p", "top_k", "topP", "topK"];
function expectNoSampling(body: Record<string, any>) {
  for (const key of FORBIDDEN_SAMPLING_KEYS) expect(body, key).not.toHaveProperty(key);
  for (const key of FORBIDDEN_SAMPLING_KEYS) expect(body.generationConfig ?? {}, `generationConfig.${key}`).not.toHaveProperty(key);
}

const ENV_KEYS = [
  "AGENT_MODEL", "AGENT_RESEARCH_MODEL", "AGENT_FILE_EGRESS_MODEL", "AGENT_MODEL_FILE_EGRESS", "AGENT_TOP_PAID_MODEL", "AGENT_FALLBACK_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CREDITS_ENFORCED", "NODEAGENT_ALLOWED_PROVIDERS",
  "PROVIDER_EGRESS_ALLOWED_PROVIDERS", "PROVIDER_EGRESS_REQUIRE_ALLOWLIST", "NODEROOM_PRODUCTION", "NODEROOM_FREE_ONLY",
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

const token = "0123456789abcdefghijklmnopqrstuvwxyzTOKEN";

async function setupRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  const now = Date.now();
  const roomId = await t.run((ctx) => ctx.db.insert("rooms", { code: "TWIRE", title: "Wire test", hostId: "", autoAllow: true, status: "live" as const, createdAt: now }));
  const memberId = await t.run(async (ctx) => ctx.db.insert("members", { roomId, name: "Host", role: "host" as const, anon: false, color: "#111111", authTokenHash: await hashToken(token), lastSeenAt: now }));
  const proof = { actor: { kind: "user" as const, id: String(memberId), name: "Host" }, token };
  await t.run((ctx) => ctx.db.patch(roomId, { hostId: String(memberId) }));
  await t.run((ctx) => ctx.db.insert("agentSessions", { roomId, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public" as const, status: "idle" as const, lastAction: "started", updatedAt: now }));
  const artifactId = await t.run((ctx) => ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: "Sheet", version: 1, order: [], updatedAt: now }));
  return { t, roomId, artifactId, proof };
}

/** A Convex ctx whose queries, mutations and actions run against the convex-test database. */
function ctxFor(t: Awaited<ReturnType<typeof setupRoom>>["t"]) {
  return {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
    runAction: (ref: any, args: any) => t.action(ref, args),
  };
}

describe("runPrivateAgent (convex/agent.ts, AGENT_MODEL ?? DEFAULT_AGENT_MODEL)", () => {
  it("with AGENT_MODEL unset the private consult goes to gemini-3.8-flash with no sampling keys", async () => {
    const { t, roomId, proof } = await setupRoom();
    const { runPrivateAgent } = await import("../convex/agent");
    installFakeTransport();
    const out = await (runPrivateAgent as any)._handler(ctxFor(t), { roomId, requester: proof, goal: "Summarise the room." });
    expect(out).toMatchObject({ ok: true, model: "gemini-3.8-flash" });
    expect(DEFAULT_AGENT_MODEL).toBe("gemini-3.8-flash");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/models/gemini-3.8-flash:generateContent");
    expectNoSampling(seen[0].body);
  });

  it("AGENT_MODEL keeps its precedence", async () => {
    process.env.AGENT_MODEL = "gemini-3.6-flash";
    const { t, roomId, proof } = await setupRoom();
    const { runPrivateAgent } = await import("../convex/agent");
    installFakeTransport();
    await (runPrivateAgent as any)._handler(ctxFor(t), { roomId, requester: proof, goal: "Summarise the room." });
    expect(seen[0].url).toContain("/models/gemini-3.6-flash:generateContent");
  });

  it("an AGENT_MODEL the catalog does not know never reaches the wire", async () => {
    process.env.AGENT_MODEL = "gemini-not-in-catalog";
    const { t, roomId, proof } = await setupRoom();
    const { runPrivateAgent } = await import("../convex/agent");
    installFakeTransport();
    await expect((runPrivateAgent as any)._handler(ctxFor(t), { roomId, requester: proof, goal: "Summarise the room." })).rejects.toMatchObject({ name: "UnknownModelError" });
    expect(seen).toHaveLength(0);
  });
});

describe("runRoomAgent public_ask (convex/agent.ts, AGENT_MODEL ?? DEFAULT_AGENT_MODEL)", () => {
  it("with AGENT_MODEL unset the room agent records gemini-3.8-flash and its first model call carries that id and no sampling keys", async () => {
    const { t, roomId, artifactId, proof } = await setupRoom();
    const { runRoomAgent } = await import("../convex/agent");
    installFakeTransport({ firstCallTool: "list_artifacts" }); // one real tool step, then a text answer: the run completes and its trace is recorded
    const out = await (runRoomAgent as any)._handler(ctxFor(t), { roomId, artifactId, requester: proof, goal: "Say hello." });
    expect(out.model).toBe("gemini-3.8-flash");
    const detail = await t.query(api.agentJobs.detail, { jobId: out.jobId, requester: proof });
    expect(detail?.job.modelPolicy).toBe("gemini-3.8-flash");
    expect(seen.length).toBeGreaterThan(0);
    for (const req of seen) {
      expect(req.url).toContain("/models/gemini-3.8-flash:");
      expectNoSampling(req.body);
    }
  });
});

describe("agentJobRunner.runFreeAutoJobSlice (a claimed job with no modelPolicy: AGENT_MODEL ?? DEFAULT_AGENT_MODEL)", () => {
  async function queuedJobWithoutModel(setup: Awaited<ReturnType<typeof setupRoom>>) {
    const { t, roomId, artifactId, proof } = setup;
    const created = await t.mutation(api.agentJobs.createOrReuse, {
      roomId, artifactId, requester: proof, goal: "Say hello.", entrypoint: "public_ask" as const, scope: "public_room" as const,
      modelPolicy: "gemini-3.8-flash", idempotencyKey: "wire-no-model", approvalPolicy: "auto_commit_safe" as const,
      evidencePolicy: "public_only" as const, autoAllow: true,
    });
    await t.run((ctx) => ctx.db.patch(created.jobId, { modelPolicy: "" })); // a legacy / unset policy: the runner picks its own default
    return created.jobId;
  }

  it("with AGENT_MODEL unset the slice's model call carries gemini-3.8-flash and no sampling keys", async () => {
    const setup = await setupRoom();
    const jobId = await queuedJobWithoutModel(setup);
    const { runFreeAutoJobSlice } = await import("../convex/agentJobRunner");
    installFakeTransport({ firstCallTool: "list_artifacts" });
    await (runFreeAutoJobSlice as any)._handler(ctxFor(setup.t), { jobId });
    expect(seen.length).toBeGreaterThan(0);
    for (const req of seen) {
      expect(req.url).toContain("/models/gemini-3.8-flash:");
      expectNoSampling(req.body);
    }
  });

  it("AGENT_MODEL keeps its precedence", async () => {
    process.env.AGENT_MODEL = "gemini-3.6-flash";
    const setup = await setupRoom();
    const jobId = await queuedJobWithoutModel(setup);
    const { runFreeAutoJobSlice } = await import("../convex/agentJobRunner");
    installFakeTransport({ firstCallTool: "list_artifacts" });
    await (runFreeAutoJobSlice as any)._handler(ctxFor(setup.t), { jobId });
    expect(seen[0].url).toContain("/models/gemini-3.6-flash:");
  });
});
