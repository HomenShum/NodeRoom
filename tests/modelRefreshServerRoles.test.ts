/**
 * 2026-10 model refresh (SPEC Part A §A.2.9, rule A.0.6) — request-shape tests for the roles whose builders are
 * server-side or script-side. Every test drives the repo's OWN builder with a fake transport (`fetch`) and asserts
 * the wire id (written here as a literal on purpose) plus the keys the §1.3 row forbids:
 *
 *   - Gemini TTS         convex/http.ts  /voice/synthesize route -> synthesizeWithGemini
 *   - private stream     convex/http.ts  /stream-private-reply route -> streamPrivateReplyText -> geminiStream
 *                        (the route picks `process.env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL`; nothing is injected)
 *   - provider parser    providerParserLive.runLiveProviderParser with no model argument (the default candidate)
 *   - judge scripts      the scripts themselves, executed with argv + fixtures; the request must name
 *                        gemini-3.6-flash and carry no `temperature`
 *   - .env.example       every example value this PR changed equals what the code defaults to
 *
 * No test here can reach a provider: `fetch` is replaced before any builder runs.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLiveProviderParser, providerParserModelCandidates } from "../src/nodeagent/models/providerParserLive";
import { DEFAULT_AGENT_MODEL } from "../convex/modelDefaults";

type Seen = { url: string; headers: Record<string, string>; body: Record<string, any> };
const seen: Seen[] = [];
vi.setConfig({ testTimeout: 30_000 }); // the first import of convex/http.ts pulls in the Convex auth module graph

function installFakeTransport(respond: (req: Seen) => Response | unknown) {
  seen.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = typeof init?.body === "string" ? init.body : "{}";
    let body: Record<string, any> = {};
    try { body = JSON.parse(raw); } catch { /* not JSON (multipart / binary) */ }
    const req: Seen = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body };
    seen.push(req);
    const out = respond(req);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  });
}

const FORBIDDEN_SAMPLING_KEYS = ["temperature", "top_p", "top_k", "topP", "topK"];
function expectNoSampling(body: Record<string, any>) {
  for (const key of FORBIDDEN_SAMPLING_KEYS) expect(body, key).not.toHaveProperty(key);
  for (const key of FORBIDDEN_SAMPLING_KEYS) expect(body.generationConfig ?? {}, `generationConfig.${key}`).not.toHaveProperty(key);
}

const ENV_KEYS = [
  "AGENT_MODEL", "AGENT_FALLBACK_MODEL", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
  "VOICE_TTS_PROVIDER", "VOICE_TTS_PROVIDER_ORDER", "VOICE_GEMINI_TTS_MODEL", "VOICE_GEMINI_TTS_VOICE", "VOICE_GEMINI_TTS_API_REVISION",
  "NODEROOM_FREE_ONLY", "VOICE_FREE_ONLY", "PROVIDER_PARSER_ALLOW_FILE_EGRESS", "PROVIDER_PARSER_GEMINI_MODEL",
  "PROVIDER_PARSER_ANTHROPIC_MODEL", "GEMINI_JUDGE_MODEL", "GEMINI_UI_REVIEW_MODEL", "GEMINI_MEDIA_JUDGE_MODEL",
  "GEMINI_SEO_VIDEO_JUDGE_MODEL", "JUDGE_MODEL", "NODEAGENT_ALLOWED_PROVIDERS", "PROVIDER_EGRESS_ALLOWED_PROVIDERS",
  "PROVIDER_EGRESS_REQUIRE_ALLOWLIST", "NODEROOM_PRODUCTION", "STARTUP_DILIGENCE_PROVIDER_MODEL", "AGENT_RESEARCH_MODEL", "OPENROUTER_API_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

// ───────────────────────────── Gemini TTS ─────────────────────────────

const TTS_MODEL = "gemini-3.8-flash-tts"; // SPEC §1.2; replaces gemini-3.1-flash-tts-preview (Google shutdown 2026-11-17)

async function synthesizeThroughRoute(): Promise<Response> {
  const http = (await import("../convex/http")).default;
  const [route] = http.lookup("/voice/synthesize", "POST") as unknown as [{ _handler: (ctx: unknown, req: Request) => Promise<Response> }];
  const request = new Request("https://example.convex.site/voice/synthesize", {
    method: "POST",
    body: JSON.stringify({ roomId: "room1", requester: { actor: { kind: "user", id: "u1", name: "Maya" }, token: "t" }, text: "NodeAgent is working." }),
  });
  return route._handler({ runQuery: async () => null }, request);
}

const pcmAudio = () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from(new Uint8Array(480)).toString("base64") } }] } }] });

describe("Gemini TTS (convex/http.ts synthesizeWithGemini, served by POST /voice/synthesize)", () => {
  beforeEach(() => { process.env.VOICE_TTS_PROVIDER = "gemini"; });

  it("sends the default request to gemini-3.8-flash-tts with the audio-modality config and no sampling keys", async () => {
    installFakeTransport(() => pcmAudio());
    const res = await synthesizeThroughRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Voice-TTS-Model")).toBe(TTS_MODEL);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`);
    expect(seen[0].headers["x-goog-api-key"]).toBe("test-google-key");
    expect(seen[0].body.model).toBe(TTS_MODEL);
    expect(seen[0].body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(seen[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
    expectNoSampling(seen[0].body);
  });

  it("VOICE_GEMINI_TTS_MODEL keeps its precedence over the code default", async () => {
    process.env.VOICE_GEMINI_TTS_MODEL = "gemini-3.8-flash-tts-override";
    installFakeTransport(() => pcmAudio());
    await synthesizeThroughRoute();
    expect(seen[0].url).toContain("/models/gemini-3.8-flash-tts-override:generateContent");
    expect(seen[0].body.model).toBe("gemini-3.8-flash-tts-override");
  });
});

// ───────────────────────────── private stream ─────────────────────────────

describe("private-reply stream (POST /stream-private-reply -> streamPrivateReplyText -> geminiStream)", () => {
  async function drivePrivateStreamRoute() {
    const appended: string[] = [];
    // The route hands its generator to the persistent-text-streaming component; run that generator inline.
    vi.doMock("../convex/streaming", () => ({
      streamingComponent: {
        stream: async (_ctx: unknown, _req: unknown, _id: string, generate: (c: unknown, r: unknown, i: string, append: (t: string) => Promise<void>) => Promise<void>) => {
          await generate({ runMutation: async () => null }, _req, _id, async (t) => { appended.push(t); });
          return new Response("streamed", { status: 200 });
        },
      },
    }));
    vi.resetModules();
    const http = (await import("../convex/http")).default;
    const [route] = http.lookup("/stream-private-reply", "POST") as unknown as [{ _handler: (ctx: unknown, req: Request) => Promise<Response> }];
    const ctx = { runQuery: async () => ({ requesterName: "Maya", roomContext: "ctx", goal: "summarise", roomId: "r1", clientMsgId: "c1" }) };
    const request = new Request("https://example.convex.site/stream-private-reply", {
      method: "POST",
      body: JSON.stringify({ streamId: "s1", requester: { actor: { kind: "user", id: "u1", name: "Maya" }, token: "t" } }),
    });
    const res = await route._handler(ctx, request);
    vi.doUnmock("../convex/streaming");
    return { res, appended };
  }
  const sse = (text: string) => new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });

  it("with AGENT_MODEL unset the route streams from gemini-3.8-flash, with an output cap and no sampling keys", async () => {
    installFakeTransport(() => sse("hello"));
    const { res, appended } = await drivePrivateStreamRoute();
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/models/gemini-3.8-flash:streamGenerateContent");
    expect(seen[0].body.generationConfig.maxOutputTokens).toBeGreaterThan(0);
    expectNoSampling(seen[0].body);
    expect(appended.join("")).toBe("hello");
    expect(DEFAULT_AGENT_MODEL).toBe("gemini-3.8-flash"); // the constant the route falls back to
  });

  it("AGENT_MODEL keeps its precedence over the default", async () => {
    process.env.AGENT_MODEL = "gemini-3.6-flash";
    installFakeTransport(() => sse("hi"));
    await drivePrivateStreamRoute();
    expect(seen[0].url).toContain("/models/gemini-3.6-flash:streamGenerateContent");
  });
});

// ───────────────────────────── provider parser ─────────────────────────────

describe("provider parser (providerParserLive.runLiveProviderParser, default candidate)", () => {
  const file = { storageId: "s1", artifactId: "a1", fileName: "diligence.pdf", mimeType: "application/pdf", size: 10 };
  const extractionJson = JSON.stringify({ tables: [], evidence: [] });
  beforeEach(() => { process.env.PROVIDER_PARSER_ALLOW_FILE_EGRESS = "1"; });

  const run = (provider: "gemini" | "anthropic", model?: string) =>
    runLiveProviderParser({ provider, file, source: { text: "ARR $12M" }, ...(model ? { model } : {}) });

  it("gemini: the default candidate is gemini-3.8-flash on the wire, no sampling keys", async () => {
    installFakeTransport(() => ({ candidates: [{ content: { role: "model", parts: [{ text: extractionJson }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 } }));
    const result = await run("gemini");
    expect(result.model).toBe("gemini-3.8-flash");
    expect(seen.length).toBeGreaterThan(0);
    for (const req of seen) {
      expect(req.url).toContain("/models/gemini-3.8-flash:generateContent");
      expectNoSampling(req.body);
    }
  });

  const anthropicText = (model: string) => ({ id: "msg_t", type: "message", role: "assistant", model, content: [{ type: "text", text: extractionJson }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 5 } });

  for (const c of [
    { label: "default candidate", model: undefined, wire: "claude-haiku-5-5", effort: "medium" },
    { label: "second candidate", model: "claude-sonnet-5-5", wire: "claude-sonnet-5-5", effort: "high" },
  ] as const) {
    it(`anthropic ${c.label}: wire id ${c.wire}, explicit effort ${c.effort}, no sampling / thinking / prefill`, async () => {
      installFakeTransport((req) => req.body.tool_choice?.type
        ? { ...anthropicText(c.wire), content: [{ type: "tool_use", id: "tu_1", name: "json", input: { tables: [], evidence: [] } }], stop_reason: "tool_use" }
        : anthropicText(c.wire));
      const result = await run("anthropic", c.model);
      expect(result.model).toBe(c.wire);
      expect(seen.length).toBeGreaterThan(0);
      for (const req of seen) {
        expect(req.url).toMatch(/\/messages$/);
        expect(req.body.model).toBe(c.wire);
        expectNoSampling(req.body);
        expect(req.body).not.toHaveProperty("thinking");
        expect(req.body.output_config?.effort).toBe(c.effort);
        expect(req.body.messages.at(-1).role).toBe("user");
      }
    });
  }

  it("the default candidate lists are the refreshed ones", () => {
    expect(providerParserModelCandidates("gemini")[0]).toBe("gemini-3.8-flash");
    expect(providerParserModelCandidates("anthropic")[0]).toBe("claude-haiku-5-5");
  });
});

// ───────────────────────────── judge scripts ─────────────────────────────

const JUDGE_MODEL = "gemini-3.6-flash"; // what Google already serves under the deprecated 3.5 name (SPEC A.2.9 EXTRA rows)
const FIXTURE_ROOT = resolve(".tmp-qa", "model-refresh-fixtures"); // .tmp-qa/ is gitignored
const geminiGenerateContent = () => ({ candidates: [{ content: { role: "model", parts: [{ text: "{}" }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });

/**
 * Execute a judge script's top level with `argv`, with `fetch` faked. The script is allowed to fail after it has
 * sent its request (the canned answer is not a valid verdict); what matters is the request it built.
 */
async function runJudgeScript(load: () => Promise<unknown>, argv: string[], answer: () => unknown = geminiGenerateContent): Promise<Seen[]> {
  installFakeTransport(answer);
  vi.resetModules();
  const argvBefore = process.argv;
  process.argv = ["node", "judge-script", ...argv];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never); // `void run().catch(() => process.exit(1))` must not kill the worker
  try { await load(); } catch { /* the canned answer is not a valid verdict */ }
  // Scripts that fire `void run()` return before the request; wait for it.
  for (let i = 0; i < 100 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  process.argv = argvBefore;
  return [...seen];
}

describe("Gemini judge scripts pin gemini-3.6-flash and send no temperature", () => {
  let dir: string;
  let png: string;
  let mp4: string;
  beforeEach(() => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    dir = mkdtempSync(join(FIXTURE_ROOT, "judge-"));
    png = join(dir, "shot.png");
    mp4 = join(dir, "clip.mp4");
    writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
    writeFileSync(mp4, Buffer.from("00000018667479706d703432", "hex"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function expectJudgeRequest(requests: Seen[]) {
    expect(requests.length, "the script sent a request").toBeGreaterThan(0);
    for (const req of requests) {
      expect(req.url).toContain(`/models/${JUDGE_MODEL}:generateContent`);
      expectNoSampling(req.body);
    }
  }

  it("scripts/design-qa/rubric-panel.ts (generateObject, four lenses)", async () => {
    const requests = await runJudgeScript(() => import("../scripts/design-qa/rubric-panel"), [`--media=${png}`, `--out=${join(dir, "out.json")}`]);
    expectJudgeRequest(requests);
  });

  it("scripts/gemini-visual-polish.ts (generateObject)", async () => {
    const requests = await runJudgeScript(() => import("../scripts/gemini-visual-polish"), [`--media=${png}`, `--out=${join(dir, "out.json")}`]);
    expectJudgeRequest(requests);
  });

  it("scripts/gemini-mp4-workflow-review.ts (generateObject)", async () => {
    const requests = await runJudgeScript(() => import("../scripts/gemini-mp4-workflow-review"), [`--media=${mp4}`, `--out=${join(dir, "out.json")}`]);
    expectJudgeRequest(requests);
  });

  it("skills/seo-qa/scripts/judge-video-gemini.ts (generateObject) and GEMINI_SEO_VIDEO_JUDGE_MODEL keeps precedence", async () => {
    const requests = await runJudgeScript(() => import("../skills/seo-qa/scripts/judge-video-gemini"), ["--input", mp4, "--out-dir", join(dir, "out")]);
    expectJudgeRequest(requests);
    process.env.GEMINI_SEO_VIDEO_JUDGE_MODEL = "gemini-3.8-flash";
    const overridden = await runJudgeScript(() => import("../skills/seo-qa/scripts/judge-video-gemini"), ["--input", mp4, "--out-dir", join(dir, "out")]);
    expect(overridden[0]?.url).toContain("/models/gemini-3.8-flash:generateContent");
  });

  it("scripts/walkthroughs/judge-video.ts (raw fetch): model from GEMINI_JUDGE_MODEL ?? gemini-3.6-flash", async () => {
    const episodeRel = join("..", ".tmp-qa", "model-refresh-fixtures", dir.split(/[\\/]/).at(-1)!); // episodes/<id> resolves under the fixture dir
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "renders", "short.mp4"), Buffer.from("00000018667479706d703432", "hex"));
    const requests = await runJudgeScript(() => import("../scripts/walkthroughs/judge-video"), [episodeRel, "renders/short.mp4"]);
    expectJudgeRequest(requests);
    process.env.GEMINI_JUDGE_MODEL = "gemini-3.8-flash";
    const overridden = await runJudgeScript(() => import("../scripts/walkthroughs/judge-video"), [episodeRel, "renders/short.mp4"]);
    expect(overridden[0]?.url).toContain("/models/gemini-3.8-flash:generateContent");
  });

  it("the scripts that need ImageMagick / LibreOffice / benchmark workbooks cannot be executed here: their request builders are checked on the AST", async () => {
    // judge-demo-gif.ts and judge-state-captures.ts decode GIF/PNG sets with ImageMagick, spreadsheetbench-chart-visual-grade.ts
    // renders workbooks with LibreOffice and gemini-demo-media-judge.ts walks the tracked media tree. Parse each and assert that
    // no object literal anywhere in the file carries a `temperature` property and that the pinned model literal is present.
    const ts = await import("typescript");
    const targets: Array<{ file: string; model: RegExp }> = [
      { file: "scripts/judge-demo-gif.ts", model: /GEMINI_JUDGE_MODEL \?\? "gemini-3\.6-flash"/ },
      { file: "scripts/judge-state-captures.ts", model: /GEMINI_JUDGE_MODEL \?\? "gemini-3\.6-flash"/ },
      { file: "scripts/spreadsheetbench-chart-visual-grade.ts", model: /"gemini-3\.6-flash"/ },
      { file: "scripts/gemini-demo-media-judge.ts", model: /"gemini-3\.6-flash"/ },
    ];
    for (const { file, model } of targets) {
      const text = readFileSync(file, "utf8");
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const temperatureProps: string[] = [];
      const visit = (node: import("typescript").Node) => {
        if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
          const name = node.name.getText(source).replace(/["'`]/g, "");
          if (/^temperature$/i.test(name)) temperatureProps.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(temperatureProps, `${file} sends temperature`).toEqual([]);
      expect(model.test(text), `${file} pins ${JUDGE_MODEL}`).toBe(true);
    }
  });
});

// ───────────────── review round 2: every other model-bearing script, driven through a fake transport ─────────────────

/**
 * Run `body` with the process working directory switched to a fresh fixture directory. Scripts that resolve
 * `process.cwd()` at import (ROOT, docs/..., .tmp-qa/...) then read and write ONLY inside it.
 */
async function inFixtureCwd<T>(body: (dir: string) => Promise<T>): Promise<T> {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_ROOT, "cwd-"));
  const before = process.cwd();
  process.chdir(dir);
  try { return await body(dir); } finally { process.chdir(before); rmSync(dir, { recursive: true, force: true }); }
}

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const MP4 = Buffer.from("00000018667479706d703432", "hex");

describe("Gemini scripts that need a fixture tree: the request names gemini-3.6-flash and carries no temperature", () => {
  afterEach(() => { vi.doUnmock("node:child_process"); });

  function expectJudgeRequest(requests: Seen[], model = JUDGE_MODEL) {
    expect(requests.length, "the script sent a request").toBeGreaterThan(0);
    for (const req of requests) {
      expect(req.url).toContain(`/models/${model}:generateContent`);
      expectNoSampling(req.body);
    }
  }

  it("scripts/gemini-ui-review.ts (generateObject); GEMINI_UI_REVIEW_MODEL and --model keep their precedence", async () => {
    await inFixtureCwd(async (dir) => {
      const png = join(dir, "shot.png");
      writeFileSync(png, PNG);
      const args = [`--media=${png}`, `--out=${join(dir, "out.json")}`];
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/gemini-ui-review"), args));
      process.env.GEMINI_UI_REVIEW_MODEL = "gemini-3.8-flash";
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/gemini-ui-review"), args), "gemini-3.8-flash");
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/gemini-ui-review"), [...args, "--model=gemini-3.5-flash-lite"]), "gemini-3.5-flash-lite");
    });
  });

  it("scripts/eval/painJudge.ts (generateText); JUDGE_MODEL keeps its precedence", async () => {
    await inFixtureCwd(async (dir) => {
      mkdirSync(join(dir, "docs", "eval"), { recursive: true });
      mkdirSync(join(dir, "docs", "screenshots"), { recursive: true });
      writeFileSync(join(dir, "docs", "eval", "pain-rubric.json"), "[]");
      writeFileSync(join(dir, "docs", "eval", "ladder-trace.txt"), "L1 ok");
      for (const [, name] of readFileSync(resolve(__dirname, "../scripts/eval/painJudge.ts"), "utf8").matchAll(/\["([^"]+\.png)"/g)) writeFileSync(join(dir, "docs", "screenshots", name), PNG);
      const verdicts = () => ({ candidates: [{ content: { role: "model", parts: [{ text: "[]" }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
      const requests = await runJudgeScript(() => import("../scripts/eval/painJudge"), [], verdicts);
      expectJudgeRequest(requests);
      process.env.JUDGE_MODEL = "gemini-3.8-flash";
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/eval/painJudge"), [], verdicts), "gemini-3.8-flash");
    });
  });

  it("scripts/judge-state-captures.ts (raw fetch, generationConfig has no temperature); GEMINI_JUDGE_MODEL keeps its precedence", async () => {
    await inFixtureCwd(async (dir) => {
      mkdirSync(join(dir, "docs", "qa", "state-captures"), { recursive: true });
      writeFileSync(join(dir, "docs", "qa", "state-captures", "a.png"), PNG);
      writeFileSync(join(dir, "docs", "qa", "state-captures", "manifest.json"), JSON.stringify({ captures: [{ surface: "sheet", state: "default", theme: "dark", width: 1280, file: "a.png", mustBeTrue: "renders" }] }));
      const requests = await runJudgeScript(() => import("../scripts/judge-state-captures"), []);
      expectJudgeRequest(requests);
      expect(requests[0].body.generationConfig).toEqual({ responseMimeType: "application/json" });
      process.env.GEMINI_JUDGE_MODEL = "gemini-3.8-flash";
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/judge-state-captures"), []), "gemini-3.8-flash");
    });
  });

  it("scripts/judge-demo-gif.ts (raw fetch, generationConfig has no temperature); GEMINI_JUDGE_MODEL keeps its precedence", async () => {
    await inFixtureCwd(async (dir) => {
      mkdirSync(join(dir, "docs", "eval", "workflow-previews"), { recursive: true });
      writeFileSync(join(dir, "docs", "eval", "workflow-previews", "demo.gif"), Buffer.from("GIF89a"));
      // ImageMagick is not assumed on the test machine: answer `magick identify` / `magick -coalesce` the way it would for a one-frame GIF.
      vi.doMock("node:child_process", async (importOriginal) => ({
        ...(await importOriginal<typeof import("node:child_process")>()),
        spawnSync: (_cmd: string, args: string[]) => {
          if (args[0] === "identify") return { status: 0, stdout: "10\n", stderr: "" };
          writeFileSync(String(args.at(-1)).replace("%04d", "0000"), PNG);
          return { status: 0, stdout: "", stderr: "" };
        },
      }));
      const requests = await runJudgeScript(() => import("../scripts/judge-demo-gif"), []);
      expectJudgeRequest(requests);
      expect(requests[0].body.generationConfig).toEqual({ responseMimeType: "application/json" });
      process.env.GEMINI_JUDGE_MODEL = "gemini-3.8-flash";
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/judge-demo-gif"), []), "gemini-3.8-flash");
    });
  });

  it("scripts/spreadsheetbench-chart-visual-grade.ts (generateObject, three chart images); GEMINI_MEDIA_JUDGE_MODEL keeps its precedence", async () => {
    await inFixtureCwd(async (dir) => {
      const workbook = join(dir, "book.xlsx");
      writeFileSync(workbook, "x");
      // The renderer (Excel COM + pdftoppm) is replaced by files; the model call is the part under test.
      vi.doMock("node:child_process", async (importOriginal) => ({
        ...(await importOriginal<typeof import("node:child_process")>()),
        spawnSync: (cmd: string, args: string[]) => {
          if (cmd === "powershell") writeFileSync(args[args.indexOf("-Pdf") + 1], "%PDF");
          else if (cmd === "pdftoppm") writeFileSync(`${args.at(-1)}.png`, PNG);
          return { status: 0, stdout: "", stderr: "" };
        },
      }));
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { value: "win32" }); // the script only renders through Excel COM
      try {
        const args = [`--candidate=${workbook}`, `--gold=${workbook}`, `--negative-candidate=${workbook}`, `--out-dir=${join(dir, "out")}`, `--tmp-dir=${join(dir, "tmp")}`];
        expectJudgeRequest(await runJudgeScript(() => import("../scripts/spreadsheetbench-chart-visual-grade"), args));
        process.env.GEMINI_MEDIA_JUDGE_MODEL = "gemini-3.8-flash";
        expectJudgeRequest(await runJudgeScript(() => import("../scripts/spreadsheetbench-chart-visual-grade"), args), "gemini-3.8-flash");
      } finally {
        Object.defineProperty(process, "platform", platform);
      }
    });
  });

  it("scripts/gemini-demo-media-judge.ts (generateObject); GEMINI_MEDIA_JUDGE_MODEL keeps its precedence", async () => {
    await inFixtureCwd(async (dir) => {
      const mp4 = join(dir, "clip.mp4");
      writeFileSync(mp4, MP4);
      const args = [`--input=${mp4}`, `--out=${join(dir, "out")}`, "--run-id=t"];
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/gemini-demo-media-judge"), args));
      process.env.GEMINI_MEDIA_JUDGE_MODEL = "gemini-3.8-flash";
      expectJudgeRequest(await runJudgeScript(() => import("../scripts/gemini-demo-media-judge"), args), "gemini-3.8-flash");
    });
  });
});

describe("model defaults carried by library code and config", () => {
  it("runSpreadsheetBenchChartVisualProbe reports gemini-3.6-flash by default; the option and GEMINI_MEDIA_JUDGE_MODEL keep their precedence", async () => {
    const { runSpreadsheetBenchChartVisualProbe } = await import("../src/eval/spreadsheetBenchChartVisualProbe");
    const probe = (extra: Record<string, unknown> = {}, env: Record<string, string> = {}) =>
      runSpreadsheetBenchChartVisualProbe({ generatedAt: "2026-10-15T00:00:00.000Z", env: { GOOGLE_GENERATIVE_AI_API_KEY: "k", ...env }, rendererCommands: [], ...extra } as never).vlm.model;
    delete process.env.GEMINI_MEDIA_JUDGE_MODEL;
    expect(probe()).toBe(JUDGE_MODEL);
    process.env.GEMINI_MEDIA_JUDGE_MODEL = "gemini-3.8-flash";
    expect(probe()).toBe("gemini-3.8-flash");
    expect(probe({ model: "gemini-3.5-flash-lite" })).toBe("gemini-3.5-flash-lite");
  });

  it("walkthrough-review: the shipped config and the CLI's built-in default both name gemini-3.6-flash", async () => {
    const { runWalkthroughReview } = await import("../packages/walkthrough-review-cli/src/core");
    expect(JSON.parse(readFileSync("walkthrough-review.config.json", "utf8")).defaultModel).toBe(JUDGE_MODEL);
    await inFixtureCwd(async (dir) => {
      mkdirSync(join(dir, "docs", "walkthroughs"), { recursive: true });
      writeFileSync(join(dir, "docs", "walkthroughs", "clip.mp4"), MP4);
      const run = (config: Record<string, unknown>, input: Record<string, unknown> = {}) => {
        writeFileSync(join(dir, "wr.config.json"), JSON.stringify({ schemaVersion: 1, commands: {}, ...config }));
        return runWalkthroughReview({ cwd: dir, configPath: "wr.config.json", dryRun: true, skipCapture: true, skipRender: true, skipGemini: true, media: "docs/walkthroughs/clip.mp4", logger: () => {}, ...input });
      };
      expect((await run({})).model).toBe(JUDGE_MODEL); // no defaultModel in the config: the CLI's own default
      expect((await run({ defaultModel: "gemini-3.8-flash" })).model).toBe("gemini-3.8-flash");
      expect((await run({ defaultModel: "gemini-3.8-flash" }, { model: "gemini-3.5-flash-lite" })).model).toBe("gemini-3.5-flash-lite");
    });
  });
});

describe("benchmark / smoke / eval scripts send the refreshed ids with the explicit effort", () => {
  const anthropicMessage = (model: string) => ({ id: "msg_t", type: "message", role: "assistant", model, content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 5 } });
  const generateContent = (text: string) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 } });
  /** Answer by wire: Anthropic Messages, Google generateContent; anything else is an HTTP 404 the script reports and moves past. */
  const respondByWire = (text = "OK") => (req: Seen) =>
    req.url.includes("api.anthropic.com") ? anthropicMessage(String(req.body.model))
      : req.url.includes("generativelanguage.googleapis.com") ? generateContent(text)
        : new Response("{}", { status: 404 });

  it("scripts/benchmark/probe.ts: claude-haiku/sonnet/opus-5-5 go out with their SPEC §1.3 effort and no sampling keys; gpt-6.1-sol reaches OpenAI by its wire id with no temperature", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key"; // without a key the AI SDK throws before any request, so the OpenAI row was never exercised
    installFakeTransport(respondByWire());
    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../scripts/benchmark/probe");
    const claude55 = seen.filter((r) => r.url.includes("api.anthropic.com") && /-5-5$/.test(String(r.body.model)));
    expect(claude55.map((r) => r.body.model).sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
    const effort: Record<string, string> = { "claude-haiku-5-5": "medium", "claude-sonnet-5-5": "high", "claude-opus-5-5": "medium" };
    for (const req of claude55) {
      expect(req.body.output_config?.effort, String(req.body.model)).toBe(effort[String(req.body.model)]);
      expectNoSampling(req.body);
      expect(req.body).not.toHaveProperty("thinking");
    }
    expect(seen.some((r) => r.url.includes("/models/gemini-3.8-flash:generateContent"))).toBe(true);
    expect(seen.some((r) => r.url.includes("/models/gemini-3.5-flash-lite:generateContent"))).toBe(true);
    // SPEC §1.3 gpt-6.1-sol row: sampling removed (400), tools need the Responses API, so the plain probe goes to /v1/responses.
    const sol = seen.filter((r) => r.url.includes("api.openai.com") && r.body.model === "gpt-6.1-sol");
    expect(sol, "exactly one probe request names gpt-6.1-sol").toHaveLength(1);
    expect(sol[0].url).toBe("https://api.openai.com/v1/responses");
    expect(sol[0].headers.authorization).toBe("Bearer test-openai-key");
    expectNoSampling(sol[0].body);
    expect(sol[0].body).not.toHaveProperty("tools");
  });

  it("scripts/eval/providerParseSmoke.ts: the gemini default reaches Google (provider is \"gemini\", not \"google\"); claude-haiku-5-5 carries its effort", async () => {
    const table = JSON.stringify({ tables: [{ title: "t", columns: ["Company"], rows: [["Acme"]] }] });
    installFakeTransport((req) => req.url.includes("api.anthropic.com")
      ? { ...anthropicMessage(String(req.body.model)), content: [{ type: "tool_use", id: "tu_1", name: "json", input: JSON.parse(table) }], stop_reason: "tool_use" }
      : generateContent(table));
    vi.resetModules();
    const argvBefore = process.argv;
    process.argv = ["node", "providerParseSmoke"]; // no model argument: the script's own defaults (gemini-3.8-flash, gpt-5.4-mini, claude-haiku-5-5); the OpenAI one has no key here and is reported as an error
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await import("../scripts/eval/providerParseSmoke");
      for (let i = 0; i < 100 && !(seen.some((r) => r.url.includes("api.anthropic.com")) && seen.some((r) => r.url.includes("generativelanguage"))); i++) await new Promise((r) => setTimeout(r, 20));
    } finally { process.argv = argvBefore; }
    const google = seen.filter((r) => r.url.includes("generativelanguage.googleapis.com"));
    expect(google.length, "the Gemini smoke reaches Google").toBeGreaterThan(0);
    for (const req of google) { expect(req.url).toContain("/models/gemini-3.8-flash:generateContent"); expectNoSampling(req.body); }
    expect(seen.some((r) => r.url.includes("api.openai.com")), "no Gemini id falls through to OpenAI").toBe(false);
    const anthropic = seen.filter((r) => r.url.includes("api.anthropic.com"));
    expect(anthropic.length).toBeGreaterThan(0);
    for (const req of anthropic) { expect(req.body.model).toBe("claude-haiku-5-5"); expect(req.body.output_config?.effort).toBe("medium"); expectNoSampling(req.body); }
  });

  it("scripts/startup-diligence-provider-eval.ts: the Gemini candidate is gemini-3.8-flash, the Anthropic one claude-haiku-5-5", async () => {
    const { runStartupDiligenceProviderEval } = await import("../scripts/startup-diligence-provider-eval");
    installFakeTransport(respondByWire("not json")); // every candidate is attempted, then the aggregate error lists them in order
    await expect(runStartupDiligenceProviderEval({ noWrite: true })).rejects.toThrow(/gemini-3\.8-flash[\s\S]*claude-haiku-5-5/);
    expect(seen[0].url).toContain("/models/gemini-3.8-flash:");
    const claude = seen.find((r) => r.url.includes("api.anthropic.com"));
    expect(claude?.body.model).toBe("claude-haiku-5-5");
    expectNoSampling(claude!.body);
  });
});

// ───────────────────────────── .env.example (SPEC §1.4 class N, "example") ─────────────────────────────

describe(".env.example copies of changed defaults equal what the code defaults to", () => {
  const envExample = readFileSync(".env.example", "utf8");
  const value = (name: string): string => {
    const match = envExample.match(new RegExp(`^${name}=(.*)$`, "m"));
    expect(match, `${name} is present in .env.example`).not.toBeNull();
    return match![1].trim();
  };

  it("NODEAGENT_FREE_AUTO_GOOGLE_MODEL is the default agent model", () => {
    expect(value("NODEAGENT_FREE_AUTO_GOOGLE_MODEL")).toBe(DEFAULT_AGENT_MODEL);
  });

  it("VOICE_GEMINI_TTS_MODEL is the model synthesizeWithGemini sends when the variable is unset", async () => {
    process.env.VOICE_TTS_PROVIDER = "gemini";
    installFakeTransport(() => pcmAudio());
    await synthesizeThroughRoute();
    expect(value("VOICE_GEMINI_TTS_MODEL")).toBe(seen[0].body.model);
    expect(value("VOICE_GEMINI_TTS_MODEL")).toBe(TTS_MODEL);
  });

  it("PROVIDER_PARSER_*_MODEL lists are the code's default candidate lists", () => {
    for (const [provider, name] of [["gemini", "PROVIDER_PARSER_GEMINI_MODEL"], ["anthropic", "PROVIDER_PARSER_ANTHROPIC_MODEL"], ["openrouter", "PROVIDER_PARSER_OPENROUTER_MODEL"]] as const) {
      expect(value(name).split(",").map((s) => s.trim()), name).toEqual(providerParserModelCandidates(provider, undefined, {}));
    }
    expect(value("PROVIDER_PARSER_OPENROUTER_MODEL")).not.toContain("nex-agi/nex-n2-pro"); // absent from the OpenRouter catalog
  });

  it("GEMINI_SEO_VIDEO_JUDGE_MODEL is the model the SEO judge script sends by default", async () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_ROOT, "env-"));
    try {
      const mp4 = join(dir, "clip.mp4");
      writeFileSync(mp4, Buffer.from("00000018667479706d703432", "hex"));
      const requests = await runJudgeScript(() => import("../skills/seo-qa/scripts/judge-video-gemini"), ["--input", mp4, "--out-dir", join(dir, "out")]);
      expect(requests[0]?.url).toContain(`/models/${value("GEMINI_SEO_VIDEO_JUDGE_MODEL")}:generateContent`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no deprecated, shut-down or unlisted id survives in the example file", () => {
    for (const stale of ["gemini-3.5-flash", "gemini-3.1-flash-tts-preview", "claude-haiku-4-5", "nex-agi/nex-n2-pro", "gemini-2.5-flash"]) {
      const lines = envExample.split(/\r?\n/).filter((l) => !l.startsWith("#") && l.includes(stale));
      expect(lines, stale).toEqual([]);
    }
    expect(existsSync(".env.example")).toBe(true);
  });
});
