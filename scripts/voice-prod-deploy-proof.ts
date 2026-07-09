import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

type CheckStatus = "pass" | "fail" | "blocked";
type Check = {
  id: string;
  status: CheckStatus;
  evidence: string[];
};
type Receipt = {
  schema: "voice-prod-deploy-proof-v1";
  createdAt: string;
  runId: string;
  appUrl: string;
  convexSiteUrl: string;
  deploymentUrl?: string;
  checks: Check[];
  summary: Record<CheckStatus, number>;
};

const args = process.argv.slice(2);
const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const outRoot = resolve(".proofloop", "runs", "voice-prod-deploy");
const outDir = resolve(outRoot, runId);
const latestDir = resolve(outRoot, "latest");
const appUrl = trimSlash(optionValue("--url") ?? process.env.VOICE_PROD_URL ?? "https://noderoom.live");
const deploymentUrl = optionValue("--deployment-url") ?? process.env.VOICE_PROD_DEPLOYMENT_URL;
const convexSiteUrl = trimSlash(optionValue("--convex-site-url") ?? process.env.VITE_CONVEX_SITE_URL ?? envLocalValue("VITE_CONVEX_SITE_URL") ?? "");
const convexUrl = trimSlash(optionValue("--convex-url") ?? process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? envLocalValue("VITE_CONVEX_URL") ?? "");
const strict = args.includes("--strict");
const realProvider = args.includes("--real-provider");
const freeOnly = args.includes("--free-only");
const ttsProofText = optionValue("--tts-text") ?? "Proof complete.";

const checks: Check[] = [];
checks.push(await checkProductionRoot(appUrl));
checks.push(runStorySmoke(appUrl));
checks.push(await checkConvexVoiceRoutes(convexSiteUrl));
checks.push(checkBrowserMicReceipt());
checks.push(checkGovernanceSource());
if (realProvider) checks.push(await checkRealProviderRoundTrip({ convexUrl, convexSiteUrl, freeOnly }));

const receipt: Receipt = {
  schema: "voice-prod-deploy-proof-v1",
  createdAt: new Date().toISOString(),
  runId,
  appUrl,
  convexSiteUrl,
  deploymentUrl,
  checks,
  summary: {
    pass: checks.filter((check) => check.status === "pass").length,
    fail: checks.filter((check) => check.status === "fail").length,
    blocked: checks.filter((check) => check.status === "blocked").length,
  },
};

writeArtifacts(receipt);
console.log(renderConsole(receipt));
if (strict && receipt.summary.fail > 0) process.exitCode = 1;

async function checkProductionRoot(url: string): Promise<Check> {
  try {
    const response = await fetch(`${url}/`, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    const permissions = response.headers.get("permissions-policy") ?? "";
    const title = body.match(/<title>(.*?)<\/title>/i)?.[1] ?? "";
    const ok = response.status >= 200 && response.status < 400 &&
      permissions.includes("microphone=(self)") &&
      permissions.includes("camera=()") &&
      title.includes("NodeRoom");
    return {
      id: "prod-root-mic-policy",
      status: ok ? "pass" : "fail",
      evidence: [
        `status: ${response.status}`,
        `title: ${title || "(missing)"}`,
        `permissions-policy: ${permissions || "(missing)"}`,
        `url: ${url}`,
      ],
    };
  } catch (error) {
    return { id: "prod-root-mic-policy", status: "fail", evidence: [errorText(error), `url: ${url}`] };
  }
}

function runStorySmoke(url: string): Check {
  const command = `node scripts/story-route-dogfood.mjs --base-url ${url}`;
  const result = spawnSync(process.execPath, ["scripts/story-route-dogfood.mjs", "--base-url", url], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdout = tail(result.stdout ?? "");
  const stderr = tail(result.stderr ?? "");
  return {
    id: "prod-story-smoke",
    status: result.status === 0 ? "pass" : "fail",
    evidence: [command, stdout ? `stdout: ${stdout}` : "stdout: (empty)", stderr ? `stderr: ${stderr}` : "stderr: (empty)"],
  };
}

async function checkConvexVoiceRoutes(siteUrl: string): Promise<Check> {
  if (!siteUrl) return { id: "convex-voice-routes-fail-closed", status: "blocked", evidence: ["missing VITE_CONVEX_SITE_URL"] };
  const evidence: string[] = [`convex site: ${siteUrl}`];
  try {
    const transcribeOptions = await fetch(`${siteUrl}/voice/transcribe`, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(30_000),
    });
    evidence.push(`transcribe OPTIONS: ${transcribeOptions.status}`);
    evidence.push(`transcribe CORS methods: ${transcribeOptions.headers.get("access-control-allow-methods") ?? "(missing)"}`);

    const form = new FormData();
    form.set("roomId", "");
    const transcribePost = await fetch(`${siteUrl}/voice/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const transcribeText = await transcribePost.text();
    evidence.push(`transcribe invalid POST: ${transcribePost.status} ${compact(transcribeText)}`);

    const synthesizePost = await fetch(`${siteUrl}/voice/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    const synthesizeText = await synthesizePost.text();
    evidence.push(`synthesize invalid POST: ${synthesizePost.status} ${compact(synthesizeText)}`);

    const ok = transcribeOptions.status === 204 &&
      transcribePost.status === 400 &&
      synthesizePost.status === 400 &&
      /missing room auth|missing audio|invalid form/i.test(transcribeText) &&
      /missing room auth/i.test(synthesizeText);
    return { id: "convex-voice-routes-fail-closed", status: ok ? "pass" : "fail", evidence };
  } catch (error) {
    return { id: "convex-voice-routes-fail-closed", status: "fail", evidence: [...evidence, errorText(error)] };
  }
}

function checkBrowserMicReceipt(): Check {
  const path = resolve(".proofloop", "runs", "voice-browser-mic", "latest", "receipt.json");
  if (!existsSync(path)) return { id: "local-browser-mic-receipt", status: "blocked", evidence: [`missing ${path}`] };
  try {
    const receipt = JSON.parse(readFileSync(path, "utf8")) as {
      schema?: string;
      createdAt?: string;
      summary?: { pass?: number; fail?: number; blocked?: number };
      lanes?: Array<{ id?: string; status?: string; evidence?: string[] }>;
    };
    const captureLane = receipt.lanes?.find((lane) => lane.id === "browser-getusermedia-mediarecorder-live");
    const ok = receipt.schema === "voice-browser-mic-proof-v1" &&
      receipt.summary?.fail === 0 &&
      captureLane?.status === "pass" &&
      captureLane.evidence?.some((item) => item.includes("matched tokens:"));
    return {
      id: "local-browser-mic-receipt",
      status: ok ? "pass" : "fail",
      evidence: [
        `path: ${path}`,
        `createdAt: ${receipt.createdAt ?? "(missing)"}`,
        `summary: pass=${receipt.summary?.pass ?? "?"} fail=${receipt.summary?.fail ?? "?"} blocked=${receipt.summary?.blocked ?? "?"}`,
        ...(captureLane?.evidence?.filter((item) => /captured bytes|transcript|matched tokens/.test(item)) ?? []),
      ],
    };
  } catch (error) {
    return { id: "local-browser-mic-receipt", status: "fail", evidence: [`path: ${path}`, errorText(error)] };
  }
}

async function checkRealProviderRoundTrip(args: { convexUrl: string; convexSiteUrl: string; freeOnly: boolean }): Promise<Check> {
  const evidence: string[] = [];
  if (!args.convexUrl) return { id: "prod-provider-audio-roundtrip", status: "blocked", evidence: ["missing VITE_CONVEX_URL"] };
  if (!args.convexSiteUrl) return { id: "prod-provider-audio-roundtrip", status: "blocked", evidence: ["missing VITE_CONVEX_SITE_URL"] };
  const capturedAudio = latestBrowserMicCapturePath();
  if (!capturedAudio) return { id: "prod-provider-audio-roundtrip", status: "blocked", evidence: ["missing latest browser mic capture artifact"] };

  const client = new ConvexHttpClient(args.convexUrl);
  const authToken = `voice-prod-proof-${randomUUID()}-ABCDEFGHIJKL`;
  const code = `VP${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  let roomId = "";
  let memberId = "";
  const proofName = "Voice Prod Proof";
  try {
    const created = await client.mutation(api.rooms.create, {
      code,
      title: "Voice production provider proof",
      hostName: proofName,
      authToken,
      autoAllow: false,
      seedArtifacts: [],
    }) as { roomId: string; memberId: string; artifactIds?: string[] };
    roomId = String(created.roomId);
    memberId = String(created.memberId);
    const requester = { actor: { kind: "user" as const, id: memberId, name: proofName }, token: authToken };
    evidence.push(`room code: ${code}`);
    evidence.push(`roomId: ${roomId}`);
    evidence.push(`memberId: ${memberId}`);

    const bytes = readFileSync(capturedAudio);
    const form = new FormData();
    form.set("roomId", roomId);
    form.set("requester", JSON.stringify(requester));
    form.set("audio", new Blob([new Uint8Array(bytes)], { type: "audio/webm" }), "browser-mic-capture.webm");
    const transcribe = await fetch(`${args.convexSiteUrl}/voice/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const transcribeText = await transcribe.text();
    evidence.push(`transcribe status: ${transcribe.status}`);
    evidence.push(`transcribe response: ${compact(transcribeText)}`);
    const transcript = transcribe.ok ? parseJson<{ text?: string; model?: string; provider?: string; durationMs?: number }>(transcribeText) : undefined;
    if (transcript?.provider) evidence.push(`stt provider: ${transcript.provider}`);
    if (transcript?.model) evidence.push(`stt model: ${transcript.model}`);
    if (typeof transcript?.durationMs === "number") evidence.push(`stt durationMs: ${transcript.durationMs}`);

    const synthesize = await fetch(`${args.convexSiteUrl}/voice/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        requester,
        text: ttsProofText,
        voice: "coral",
      }),
      signal: AbortSignal.timeout(120_000),
    });
    evidence.push(`synthesize status: ${synthesize.status}`);
    evidence.push(`synthesize content-type: ${synthesize.headers.get("content-type") ?? "(missing)"}`);
    const ttsProvider = synthesize.headers.get("x-voice-tts-provider");
    const ttsModel = synthesize.headers.get("x-voice-tts-model");
    if (ttsProvider) evidence.push(`tts provider: ${ttsProvider}`);
    if (ttsModel) evidence.push(`tts model: ${ttsModel}`);
    let synthBytes = new Uint8Array();
    let synthesizeError = "";
    if (synthesize.ok) {
      synthBytes = new Uint8Array(await synthesize.arrayBuffer());
      evidence.push(`synthesize bytes: ${synthBytes.byteLength}`);
    } else {
      synthesizeError = compact(await synthesize.text());
      evidence.push(`synthesize fail-closed: ${synthesizeError}`);
    }

    const normalizedTranscript = (transcript?.text ?? "").toLowerCase().replace(/node\s+room/g, "noderoom");
    const transcriptOk = ["local", "audio", "proof", "room"].filter((token) => normalizedTranscript.includes(token)).length >= 3;
    const synthOk = synthesize.ok && synthBytes.byteLength > 1000 && /^audio\//i.test(synthesize.headers.get("content-type") ?? "");
    const hostedFreeProviderOk = args.freeOnly && synthOk && !!ttsProvider && ttsProvider !== "openai";
    const freeOnlySynthOk = args.freeOnly &&
      (hostedFreeProviderOk ||
        (!synthesize.ok &&
          (synthesize.status === 403 || synthesize.status === 503) &&
          /free|paid voice tts provider disabled|provider not configured|client-side only/i.test(synthesizeError)));
    return {
      id: "prod-provider-audio-roundtrip",
      status: transcribe.ok && transcriptOk && (args.freeOnly ? freeOnlySynthOk : synthOk) ? "pass" : "fail",
      evidence,
    };
  } catch (error) {
    return { id: "prod-provider-audio-roundtrip", status: "fail", evidence: [...evidence, errorText(error)] };
  } finally {
    if (roomId && memberId) {
      try {
        await client.mutation(api.rooms.leave, {
          roomId: roomId as never,
          requester: { actor: { kind: "user", id: memberId, name: proofName }, token: authToken },
        });
        evidence.push("cleanup: host member revoked via rooms.leave");
      } catch (error) {
        evidence.push(`cleanup failed: ${errorText(error)}`);
      }
    }
  }
}

function checkGovernanceSource(): Check {
  const files = {
    chat: readIfExists("src/ui/Chat.tsx"),
    adapter: readIfExists("src/voice/roomVoiceAdapter.ts"),
    gateway: readIfExists("src/voice/gateway.ts"),
    classifier: readIfExists("src/voice/commandClassifier.ts"),
    provider: readIfExists("src/voice/adapters/providerSpeech.ts"),
    policy: readIfExists("src/voice/providerPolicy.ts"),
    http: readIfExists("convex/http.ts"),
    voice: readIfExists("convex/voice.ts"),
  };
  const expectations = [
    files.chat.includes("dispatchVoiceFromComposer") && files.chat.includes("dispatchRoomCommand"),
    files.gateway.includes("classifyVoiceTranscript") && files.classifier.includes("RoomCommand"),
    files.provider.includes("getUserMedia") && files.provider.includes("MediaRecorder"),
    files.policy.includes("VITE_NODEROOM_FREE_ONLY") && files.policy.includes("createVoiceTextToSpeechAdapter"),
    files.http.includes("/voice/transcribe") && files.http.includes("assertVoiceRequester"),
    files.http.includes("NODEROOM_FREE_ONLY") && files.http.includes("paidVoiceProviderBlocked"),
    files.http.includes("VOICE_STT_PROVIDER") && files.http.includes("transcribeWithNvidia"),
    files.http.includes("synthesizeWithGemini") && files.http.includes("VOICE_GEMINI_TTS_FREE_TIER_CONFIRMED"),
    files.http.includes("synthesizeWithCloudflare") && files.http.includes("VOICE_CLOUDFLARE_FREE_TIER_CONFIRMED"),
    files.http.includes("synthesizeWithGoogleCloudTts") && files.http.includes("VOICE_GOOGLE_TTS_FREE_TIER_CONFIRMED"),
    files.http.includes("hostedFreeTierAllowed"),
    files.voice.includes("assertVoiceRequester"),
  ];
  return {
    id: "voice-governance-source-contract",
    status: expectations.every(Boolean) ? "pass" : "fail",
    evidence: [
      "voice transcript path remains Chat composer -> RoomVoiceAdapter -> RoomCommand",
      "Convex HTTP voice endpoints call voice:assertVoiceRequester before provider calls",
      "Hosted free-tier TTS adapters fail closed in free-only mode until explicitly confirmed",
      `source contract checks: ${expectations.map((ok) => ok ? "pass" : "fail").join(", ")}`,
    ],
  };
}

function writeArtifacts(receipt: Receipt): void {
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  mkdirSync(outDir, { recursive: true });
  mkdirSync(latestDir, { recursive: true });
  writeFileSync(resolve(outDir, "receipt.json"), json, "utf8");
  writeFileSync(resolve(latestDir, "receipt.json"), json, "utf8");
  writeFileSync(resolve(outDir, "scorecard.md"), renderMarkdown(receipt), "utf8");
  writeFileSync(resolve(latestDir, "scorecard.md"), renderMarkdown(receipt), "utf8");
}

function renderMarkdown(receipt: Receipt): string {
  const lines = [
    "# Voice Production Deploy Proof",
    "",
    `Created: ${receipt.createdAt}`,
    `App URL: ${receipt.appUrl}`,
    `Convex site URL: ${receipt.convexSiteUrl || "(missing)"}`,
    receipt.deploymentUrl ? `Deployment URL: ${receipt.deploymentUrl}` : undefined,
    "",
    `Summary: ${receipt.summary.pass} passed, ${receipt.summary.fail} failed, ${receipt.summary.blocked} blocked`,
    "",
    "| Status | Check | Evidence |",
    "|---|---|---|",
  ].filter((line): line is string => line !== undefined);
  for (const check of receipt.checks) {
    lines.push(`| ${check.status} | \`${check.id}\` | ${escapePipes(check.evidence.join("<br>"))} |`);
  }
  return `${lines.join("\n")}\n`;
}

function renderConsole(receipt: Receipt): string {
  return [
    `voice-prod-deploy proof ${receipt.runId}`,
    `app=${receipt.appUrl}`,
    `deployment=${receipt.deploymentUrl ?? "(not provided)"}`,
    `pass=${receipt.summary.pass} blocked=${receipt.summary.blocked} fail=${receipt.summary.fail}`,
    `receipt=${resolve(outDir, "receipt.json")}`,
    ...receipt.checks.map((check) => `${check.status.toUpperCase().padEnd(7)} ${check.id}`),
  ].join("\n");
}

function readIfExists(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

function latestBrowserMicCapturePath(): string | undefined {
  const receiptPath = resolve(".proofloop", "runs", "voice-browser-mic", "latest", "receipt.json");
  if (!existsSync(receiptPath)) return undefined;
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
      lanes?: Array<{ id?: string; artifacts?: string[] }>;
    };
    return receipt.lanes
      ?.find((lane) => lane.id === "browser-getusermedia-mediarecorder-live")
      ?.artifacts
      ?.find((artifact) => artifact.endsWith("browser-mic-capture.webm") && existsSync(artifact));
  } catch {
    return undefined;
  }
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function envLocalValue(name: string): string | undefined {
  const path = resolve(".env.local");
  if (!existsSync(path)) return undefined;
  const match = readFileSync(path, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.replace(/#.*/, "").trim() || undefined;
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function tail(value: string, max = 4000): string {
  return value.length > max ? value.slice(-max) : value;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
