import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

type LaneStatus = "pass" | "fail" | "blocked";
type Receipt = {
  schema: "voice-browser-mic-proof-v1";
  createdAt: string;
  runId: string;
  phrase: string;
  lanes: Array<{
    id: string;
    status: LaneStatus;
    evidence: string[];
    artifacts: string[];
  }>;
  summary: Record<LaneStatus, number>;
};

const PHRASE = "Local audio proof for the Node Room app. Please summarize the current room.";
const EXPECTED_TOKENS = ["local", "audio", "proof", "noderoom", "app", "summarize", "room"];
const LOCAL_AUDIO_ENV = resolve(process.env.VOICE_LOCAL_AUDIO_ENV ?? ".tmp/voice-local-env");
const LOCAL_MODEL_ROOT = resolve(process.env.VOICE_LOCAL_MODEL_ROOT ?? ".tmp/voice-local-models");
const LOCAL_PYTHON = resolve(process.env.VOICE_LOCAL_PYTHON ?? `${LOCAL_AUDIO_ENV}/${process.platform === "win32" ? "Scripts/python.exe" : "bin/python"}`);
const LOCAL_PIPER = resolve(process.env.VOICE_LOCAL_PIPER ?? `${LOCAL_AUDIO_ENV}/${process.platform === "win32" ? "Scripts/piper.exe" : "bin/piper"}`);
const LOCAL_PIPER_MODEL = resolve(process.env.VOICE_LOCAL_PIPER_MODEL ?? `${LOCAL_MODEL_ROOT}/piper/en_US-amy-low/en_US-amy-low.onnx`);
const LOCAL_PIPER_CONFIG = resolve(process.env.VOICE_LOCAL_PIPER_CONFIG ?? `${LOCAL_MODEL_ROOT}/piper/en_US-amy-low/en_US-amy-low.onnx.json`);
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const OUT_ROOT = resolve(".proofloop", "runs", "voice-browser-mic");
const OUT_DIR = resolve(OUT_ROOT, RUN_ID);
const LATEST_DIR = resolve(OUT_ROOT, "latest");
mkdirSync(OUT_DIR, { recursive: true });

const lanes: Receipt["lanes"] = [];
const fakeMic = ensureFakeMicWav();
if (!fakeMic.ok) {
  lanes.push({ id: "fake-mic-fixture", status: "blocked", evidence: [fakeMic.error], artifacts: [] });
} else {
  lanes.push({ id: "fake-mic-fixture", status: "pass", evidence: [`bytes: ${fakeMic.bytes}`, `sha256: ${fakeMic.sha256}`], artifacts: [fakeMic.path] });
  lanes.push(await runBrowserMicCapture(fakeMic.path));
}

const receipt: Receipt = {
  schema: "voice-browser-mic-proof-v1",
  createdAt: new Date().toISOString(),
  runId: RUN_ID,
  phrase: PHRASE,
  lanes,
  summary: {
    pass: lanes.filter((lane) => lane.status === "pass").length,
    fail: lanes.filter((lane) => lane.status === "fail").length,
    blocked: lanes.filter((lane) => lane.status === "blocked").length,
  },
};
writeReceipt(receipt);
console.log(renderConsole(receipt));
if (receipt.summary.fail > 0) process.exitCode = 1;

function ensureFakeMicWav(): { ok: true; path: string; bytes: number; sha256: string } | { ok: false; error: string } {
  const path = resolve(OUT_DIR, "fake-browser-mic.wav");
  if (existsSync(LOCAL_PIPER) && existsSync(LOCAL_PIPER_MODEL) && existsSync(LOCAL_PIPER_CONFIG)) {
    const inputPath = resolve(OUT_DIR, "fake-browser-mic.txt");
    writeFileSync(inputPath, PHRASE);
    const result = spawnSync(LOCAL_PIPER, ["-m", LOCAL_PIPER_MODEL, "-c", LOCAL_PIPER_CONFIG, "-i", inputPath, "-f", path], { encoding: "utf8", timeout: 300_000 });
    if (result.status !== 0) return { ok: false, error: `piper failed: ${compact(result.stderr || result.stdout)}` };
  } else {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop'",
        "Add-Type -AssemblyName System.Speech",
        "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
        `$synth.SetOutputToWaveFile(${psQuote(path)})`,
        `$synth.Speak(${psQuote(PHRASE)})`,
        "$synth.Dispose()",
      ].join("\n"),
    ], { encoding: "utf8", timeout: 60_000 });
    if (result.status !== 0) return { ok: false, error: `SAPI failed: ${compact(result.stderr || result.stdout)}` };
  }
  const bytes = statSync(path).size;
  if (bytes <= 44) return { ok: false, error: `fake mic WAV too small: ${bytes}` };
  return { ok: true, path, bytes, sha256: sha256File(path) };
}

async function runBrowserMicCapture(fakeMicPath: string): Promise<Receipt["lanes"][number]> {
  let server: Server | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    const served = await serveProofPage();
    server = served.server;
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${fakeMicPath}`,
      ],
    });
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    await page.goto(served.url);
    const capture = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm"];
      const mimeType = mimeCandidates.find((item) => MediaRecorder.isTypeSupported(item)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      const stopped = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error("media_recorder_error"));
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 6500));
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return {
        mimeType: blob.type,
        bytes: bytes.length,
        base64: btoa(binary),
      };
    });
    const capturedPath = resolve(OUT_DIR, "browser-mic-capture.webm");
    writeFileSync(capturedPath, Buffer.from(capture.base64, "base64"));
    const transcript = transcribe(capturedPath);
    const matched = transcript.ok ? matchedTokens(transcript.text) : [];
    const passed = capture.bytes > 1000 && transcript.ok && matched.includes("noderoom") && matched.includes("proof") && matched.length >= 4;
    return {
      id: "browser-getusermedia-mediarecorder-live",
      status: passed ? "pass" : "fail",
      evidence: [
        `page: ${served.url}`,
        `mimeType: ${capture.mimeType}`,
        `captured bytes: ${String(capture.bytes)}`,
        `captured sha256: ${sha256File(capturedPath)}`,
        transcript.ok ? `transcript: ${transcript.text}` : `transcription failed: ${transcript.error}`,
        `matched tokens: ${matched.join(", ") || "none"}`,
      ],
      artifacts: [fakeMicPath, capturedPath],
    };
  } catch (error) {
    return { id: "browser-getusermedia-mediarecorder-live", status: "fail", evidence: [errorText(error)], artifacts: [fakeMicPath] };
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  }
}

function transcribe(audioPath: string): { ok: true; text: string } | { ok: false; error: string } {
  if (!existsSync(LOCAL_PYTHON)) return { ok: false, error: `missing local python: ${LOCAL_PYTHON}` };
  const code = [
    "import json",
    "from faster_whisper import WhisperModel",
    `model = WhisperModel('tiny.en', device='cpu', compute_type='int8', download_root=${JSON.stringify(resolve(LOCAL_MODEL_ROOT, "faster-whisper"))})`,
    `segments, info = model.transcribe(${JSON.stringify(audioPath)}, beam_size=1, language='en')`,
    "print(json.dumps({'text': ' '.join(seg.text.strip() for seg in segments).strip()}))",
  ].join("\n");
  const result = spawnSync(LOCAL_PYTHON, ["-c", code], { encoding: "utf8", timeout: 300_000 });
  if (result.status !== 0) return { ok: false, error: compact(result.stderr || result.stdout || `python exited ${String(result.status)}`) };
  const jsonLine = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{")).at(-1);
  if (!jsonLine) return { ok: false, error: compact(result.stdout || result.stderr || "missing JSON") };
  const parsed = JSON.parse(jsonLine) as { text?: string };
  return { ok: true, text: parsed.text ?? "" };
}

async function serveProofPage(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>NodeRoom Browser Mic Proof</title><main>mic proof</main>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind proof server");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function matchedTokens(text: string): string[] {
  const normalized = text.toLowerCase().replace(/node\s+room/g, "noderoom").replace(/[^a-z0-9]+/g, " ");
  return EXPECTED_TOKENS.filter((token) => normalized.includes(token));
}

function writeReceipt(value: Receipt): void {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LATEST_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "receipt.json"), json);
  writeFileSync(resolve(LATEST_DIR, "receipt.json"), json);
}

function renderConsole(value: Receipt): string {
  return [
    `voice-browser-mic proof ${value.runId}`,
    `pass=${value.summary.pass} blocked=${value.summary.blocked} fail=${value.summary.fail}`,
    `receipt=${resolve(OUT_DIR, "receipt.json")}`,
    ...value.lanes.map((lane) => `${lane.status.toUpperCase().padEnd(7)} ${lane.id}`),
  ].join("\n");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
