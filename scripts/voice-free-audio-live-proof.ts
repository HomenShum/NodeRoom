import "./benchmark/loadEnv";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

type LiveLaneStatus = "pass" | "blocked" | "fail";
type LiveLaneKind = "stt" | "tts";
type LiveLaneProvider = "browser" | "local" | "openrouter" | "nvidia";
type LiveLaneCost = "free" | "prototype_free_trial" | "paid";

type LiveLane = {
  id: string;
  kind: LiveLaneKind;
  provider: LiveLaneProvider;
  status: LiveLaneStatus;
  cost: LiveLaneCost;
  evidence: string[];
  artifacts: string[];
  risks: string[];
  next: string;
  model?: string;
  endpoint?: string;
  verifier?: {
    expectedTokens: string[];
    matchedTokens: string[];
    text?: string;
  };
};

type OpenRouterModel = {
  id: string;
  name?: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: Record<string, string>;
  supported_parameters?: string[];
};

type OpenRouterCatalog = {
  ok: boolean;
  source: string;
  models: OpenRouterModel[];
  error?: string;
};

type OpenRouterCatalogs = {
  audioInputText: OpenRouterCatalog;
  transcription: OpenRouterCatalog;
  speech: OpenRouterCatalog;
  audioOutput: OpenRouterCatalog;
  text: OpenRouterCatalog;
};

type OpenRouterModelSummary = {
  id: string;
  name?: string;
  modality?: string;
  inputModalities: string[];
  outputModalities: string[];
  pricing: Record<string, string>;
};

type OpenRouterCatalogSnapshot = {
  fetchedAt: string;
  audioInputText: OpenRouterCatalogSummary;
  transcription: OpenRouterCatalogSummary;
  speech: OpenRouterCatalogSummary;
  audioOutput: OpenRouterCatalogSummary;
  text: OpenRouterCatalogSummary;
};

type OpenRouterCatalogSummary = {
  source: string;
  ok: boolean;
  total: number;
  freeCount: number;
  freeModels: OpenRouterModelSummary[];
  error?: string;
};

type Receipt = {
  schema: "voice-free-audio-live-proof-v1";
  createdAt: string;
  runId: string;
  phrase: string;
  officialScoreClaim: false;
  docs: string[];
  openRouterCatalogs?: OpenRouterCatalogSnapshot;
  gates: {
    liveRuntimeAttempted: boolean;
    noPaidAudioProviderUsed: boolean;
    anyLiveAudioPass: boolean;
    anyLiveSttPass: boolean;
    anyLiveTtsPass: boolean;
    productionRecommendation: string;
  };
  lanes: LiveLane[];
  summary: Record<LiveLaneStatus, number>;
};

const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models`;
const OPENROUTER_AUDIO_INPUT_TEXT_MODELS_URL = `${OPENROUTER_MODELS_URL}?input_modalities=audio&output_modalities=text`;
const OPENROUTER_TRANSCRIPTION_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=transcription`;
const OPENROUTER_SPEECH_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=speech`;
const OPENROUTER_AUDIO_OUTPUT_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=audio`;
const OPENROUTER_TEXT_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=text`;
const OPENROUTER_CHAT_URL = `${OPENROUTER_BASE_URL}/chat/completions`;
const OPENROUTER_STT_URL = `${OPENROUTER_BASE_URL}/audio/transcriptions`;
const OPENROUTER_TTS_URL = `${OPENROUTER_BASE_URL}/audio/speech`;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const NVIDIA_DIRECT_BASE_URL = (process.env.NVIDIA_DIRECT_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
const NVIDIA_DIRECT_CHAT_URL = `${NVIDIA_DIRECT_BASE_URL}/chat/completions`;
const NVIDIA_DIRECT_KEY = process.env.NVIDIA_API_KEY ?? process.env.NVIDIA_NIM_API_KEY ?? process.env.NGC_API_KEY ?? process.env.NVCF_API_KEY ?? "";
const NVIDIA_DIRECT_MODEL = process.env.VOICE_NVIDIA_NEMOTRON_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
const OUT_ROOT = resolve(".proofloop", "runs", "voice-free-audio-live");
const PHRASE = "Local audio proof for the Node Room app. Please summarize the current room.";
const NVIDIA_DIRECT_PHRASE = "Audio proof zebra.";
const EXPECTED_TRANSCRIPT_TOKENS = ["local", "audio", "proof", "noderoom", "app", "summarize", "room"];
const NVIDIA_DIRECT_EXPECTED_TOKENS = ["audio", "proof", "zebra"];
const OPENROUTER_AUDIO_TIMEOUT_MS = Number(process.env.OPENROUTER_AUDIO_PROOF_TIMEOUT_MS ?? 180_000);
const LOCAL_AUDIO_ENV = resolve(process.env.VOICE_LOCAL_AUDIO_ENV ?? ".tmp/voice-local-env");
const LOCAL_PYTHON = resolve(process.env.VOICE_LOCAL_PYTHON ?? `${LOCAL_AUDIO_ENV}/${process.platform === "win32" ? "Scripts/python.exe" : "bin/python"}`);
const LOCAL_PIPER = resolve(process.env.VOICE_LOCAL_PIPER ?? `${LOCAL_AUDIO_ENV}/${process.platform === "win32" ? "Scripts/piper.exe" : "bin/piper"}`);
const LOCAL_MODEL_ROOT = resolve(process.env.VOICE_LOCAL_MODEL_ROOT ?? ".tmp/voice-local-models");
const LOCAL_WHISPER_MODEL = process.env.VOICE_LOCAL_WHISPER_MODEL ?? "tiny.en";
const LOCAL_PIPER_MODEL = resolve(process.env.VOICE_LOCAL_PIPER_MODEL ?? `${LOCAL_MODEL_ROOT}/piper/en_US-amy-low/en_US-amy-low.onnx`);
const LOCAL_PIPER_CONFIG = resolve(process.env.VOICE_LOCAL_PIPER_CONFIG ?? `${LOCAL_MODEL_ROOT}/piper/en_US-amy-low/en_US-amy-low.onnx.json`);
const LOCAL_AUDIO_TIMEOUT_MS = Number(process.env.VOICE_LOCAL_AUDIO_TIMEOUT_MS ?? 300_000);
const OPENROUTER_AUDIO_PROOF_ENABLED = process.env.VOICE_OPENROUTER_AUDIO_PROOF !== "0";
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const OUT_DIR = resolve(OUT_ROOT, RUN_ID);
const LATEST_DIR = resolve(OUT_ROOT, "latest");

mkdirSync(OUT_DIR, { recursive: true });

const goldenAudio = ensureGoldenWav();
const openRouterCatalogs = OPENROUTER_AUDIO_PROOF_ENABLED
  ? await fetchOpenRouterCatalogs()
  : skippedOpenRouterCatalogs("skipped by VOICE_OPENROUTER_AUDIO_PROOF=0");
const lanes: LiveLane[] = [
  await runBrowserTtsLiveProof(),
  await runBrowserSttLiveGate(),
  ...runLocalAudioLiveProofs(goldenAudio),
  await runNvidiaDirectNemotronAudioProof(),
  ...(OPENROUTER_AUDIO_PROOF_ENABLED
    ? [
        await runOpenRouterAudioInputChatProof(openRouterCatalogs.audioInputText, goldenAudio),
        await runOpenRouterDedicatedSttProof(openRouterCatalogs.transcription, goldenAudio),
        await runOpenRouterTtsProof(openRouterCatalogs.speech, openRouterCatalogs.audioOutput),
      ]
    : [
        openRouterBlocked("openrouter-free-audio-input-chat-live", "stt", "skipped by VOICE_OPENROUTER_AUDIO_PROOF=0"),
        openRouterBlocked("openrouter-free-dedicated-stt-live", "stt", "skipped by VOICE_OPENROUTER_AUDIO_PROOF=0"),
        openRouterBlocked("openrouter-free-tts-live", "tts", "skipped by VOICE_OPENROUTER_AUDIO_PROOF=0"),
      ]),
];

const receipt: Receipt = {
  schema: "voice-free-audio-live-proof-v1",
  createdAt: new Date().toISOString(),
  runId: RUN_ID,
  phrase: PHRASE,
  officialScoreClaim: false,
  docs: [
    "https://openrouter.ai/docs/guides/overview/multimodal/audio",
    "https://openrouter.ai/docs/api/api-reference/stt/create-transcription",
    "https://openrouter.ai/docs/api/api-reference/tts/create-speech",
    "https://openrouter.ai/openapi.json",
    "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-omni-30b-a3b-reasoning-infer",
    "https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/nemotron-3-nano-omni-30b-a3b-reasoning/api.html",
  ],
  openRouterCatalogs: summarizeOpenRouterCatalogs(openRouterCatalogs),
  gates: {
    liveRuntimeAttempted: true,
    noPaidAudioProviderUsed: lanes.every((lane) => lane.cost !== "paid"),
    anyLiveAudioPass: lanes.some((lane) => lane.status === "pass"),
    anyLiveSttPass: lanes.some((lane) => lane.kind === "stt" && lane.status === "pass"),
    anyLiveTtsPass: lanes.some((lane) => lane.kind === "tts" && lane.status === "pass"),
    productionRecommendation: "Use passing browser/local audio lanes behind VoiceGateway as opportunistic free providers. Keep OpenAI STT/TTS as the reliable fallback for any lane without a transcript/audio receipt.",
  },
  lanes,
  summary: summarize(lanes),
};

writeReceipt(receipt);
console.log(renderConsole(receipt));

function ensureGoldenWav(): { ok: true; path: string; bytes: number; sha256: string } | { ok: false; error: string } {
  const path = resolve(OUT_DIR, "noderoom-free-audio-proof.wav");
  if (!existsSync(path)) {
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
    ], { encoding: "utf8", timeout: 30_000 });

    if (result.status !== 0) {
      return { ok: false, error: compactError(result.stderr || result.stdout || `powershell exited ${String(result.status)}`) };
    }
  }

  try {
    const bytes = statSync(path).size;
    if (bytes <= 44) return { ok: false, error: `generated WAV is too small: ${bytes} bytes` };
    return { ok: true, path, bytes, sha256: sha256File(path) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

async function runBrowserTtsLiveProof(): Promise<LiveLane> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>NodeRoom free browser TTS proof</title>");
    const result = await page.evaluate(async (text) => {
      if (typeof window.speechSynthesis === "undefined" || typeof window.SpeechSynthesisUtterance === "undefined") {
        return { ok: false, event: "unsupported", voices: 0, elapsedMs: 0 };
      }
      const startedAt = performance.now();
      return await new Promise<{ ok: boolean; event: string; voices: number; elapsedMs: number }>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const timer = window.setTimeout(() => {
          window.speechSynthesis.cancel();
          resolve({
            ok: false,
            event: "timeout",
            voices: window.speechSynthesis.getVoices().length,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        }, 12_000);
        utterance.onend = () => {
          window.clearTimeout(timer);
          resolve({
            ok: true,
            event: "end",
            voices: window.speechSynthesis.getVoices().length,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        };
        utterance.onerror = (event) => {
          window.clearTimeout(timer);
          resolve({
            ok: false,
            event: `error:${event.error}`,
            voices: window.speechSynthesis.getVoices().length,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      });
    }, PHRASE);

    return {
      id: "browser-speech-synthesis-live",
      kind: "tts",
      provider: "browser",
      status: result.ok ? "pass" : "fail",
      cost: "free",
      evidence: [
        `speechSynthesis event: ${result.event}`,
        `elapsedMs: ${String(result.elapsedMs)}`,
        `voices reported: ${String(result.voices)}`,
      ],
      artifacts: [],
      risks: [
        "The browser/OS chooses the actual voice and does not produce a durable replayable audio blob.",
        "This is free for NodeRoom but voice quality varies by client environment.",
      ],
      next: result.ok
        ? "Keep browser TTS behind VoiceGateway as an opportunistic free narration lane."
        : "Keep provider TTS fallback enabled; this browser runtime did not complete a speechSynthesis utterance.",
    };
  } catch (error) {
    return {
      id: "browser-speech-synthesis-live",
      kind: "tts",
      provider: "browser",
      status: "fail",
      cost: "free",
      evidence: [`browser TTS proof threw: ${errorText(error)}`],
      artifacts: [],
      risks: ["Browser-native TTS was not proven on this machine."],
      next: "Repair Playwright/browser audio runtime before treating browser TTS as a live free lane.",
    };
  } finally {
    await browser?.close();
  }
}

async function runBrowserSttLiveGate(): Promise<LiveLane> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>NodeRoom free browser STT gate</title>");
    const caps = await page.evaluate(() => {
      const speechWindow = window as typeof window & {
        SpeechRecognition?: unknown;
        webkitSpeechRecognition?: unknown;
      };
      return {
        speechRecognition: typeof speechWindow.SpeechRecognition !== "undefined" || typeof speechWindow.webkitSpeechRecognition !== "undefined",
        mediaRecorder: typeof window.MediaRecorder !== "undefined",
        getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      };
    });
    return {
      id: "browser-speech-recognition-live",
      kind: "stt",
      provider: "browser",
      status: "blocked",
      cost: "free",
      evidence: [
        `SpeechRecognition/webkitSpeechRecognition available: ${String(caps.speechRecognition)}`,
        `MediaRecorder available: ${String(caps.mediaRecorder)}`,
        `getUserMedia available in automated Chromium: ${String(caps.getUserMedia)}`,
        "No deterministic headless way to inject generated speech into browser SpeechRecognition without a real user/browser permission loop.",
      ],
      artifacts: [],
      risks: [
        "Browser STT support and cloud usage vary by browser vendor.",
        "A manual mic proof must still assert that the resulting transcript enters NodeRoom's normal text command path.",
      ],
      next: "Run a user-mediated Chrome/Edge composer proof and record the resulting room command/job receipt.",
    };
  } catch (error) {
    return {
      id: "browser-speech-recognition-live",
      kind: "stt",
      provider: "browser",
      status: "blocked",
      cost: "free",
      evidence: [`browser STT capability gate threw: ${errorText(error)}`],
      artifacts: [],
      risks: ["Browser STT was not proven on this machine."],
      next: "Use provider STT or local Whisper until a browser composer proof is recorded.",
    };
  } finally {
    await browser?.close();
  }
}

function runLocalAudioLiveGates(goldenAudio: ReturnType<typeof ensureGoldenWav>): LiveLane[] {
  const whisperCommands = commandHits(["whisper-cli", "whisper-cpp", "whisper"]);
  const whisperPackages = pythonImportHits(["whisper", "faster_whisper"]);
  const ttsCommands = commandHits(["kokoro", "kokoro-tts", "piper"]);
  const ttsPackages = pythonImportHits(["kokoro", "TTS"]);
  const audioEvidence = goldenAudio.ok
    ? [`golden WAV generated: ${goldenAudio.bytes} bytes`, `golden WAV sha256: ${goldenAudio.sha256}`]
    : [`golden WAV unavailable: ${goldenAudio.error}`];

  return [
    {
      id: "local-whisper-stt-live",
      kind: "stt",
      provider: "local",
      status: "blocked",
      cost: "free",
      evidence: [
        `command hits: ${whisperCommands.length ? whisperCommands.join(", ") : "none"}`,
        `python package hits: ${whisperPackages.length ? whisperPackages.join(", ") : "none"}`,
        ...audioEvidence,
      ],
      artifacts: goldenAudio.ok ? [goldenAudio.path] : [],
      risks: [
        "A real local STT pass needs pinned model weights and a golden WAV transcript assertion.",
        "Auto-downloading weights during a proof would make the certification surface mutable and slow.",
      ],
      next: whisperCommands.length || whisperPackages.length
        ? "Add an explicit pinned local Whisper adapter smoke with no network weight download."
        : "Install whisper.cpp or faster-whisper before claiming free local STT.",
    },
    {
      id: "local-kokoro-piper-tts-live",
      kind: "tts",
      provider: "local",
      status: "blocked",
      cost: "free",
      evidence: [
        `command hits: ${ttsCommands.length ? ttsCommands.join(", ") : "none"}`,
        `python package hits: ${ttsPackages.length ? ttsPackages.join(", ") : "none"}`,
      ],
      artifacts: [],
      risks: [
        "A real local TTS pass needs pinned voice files and a generated audio duration/format verifier.",
        "Voice model licensing must be recorded before production use.",
      ],
      next: ttsCommands.length || ttsPackages.length
        ? "Add a pinned Kokoro/Piper text-to-WAV smoke and wire it behind VoiceGateway."
        : "Install Kokoro or Piper before claiming free local TTS.",
    },
  ];
}

function runLocalAudioLiveProofs(goldenAudio: ReturnType<typeof ensureGoldenWav>): LiveLane[] {
  const whisperCommands = commandHits(["whisper-cli", "whisper-cpp", "whisper"]);
  const whisperPackages = localPythonImportHits(["whisper", "faster_whisper"]);
  const ttsCommands = [...commandHits(["kokoro", "kokoro-tts", "piper"]), ...(existsSync(LOCAL_PIPER) ? [LOCAL_PIPER] : [])];
  const ttsPackages = localPythonImportHits(["kokoro", "TTS", "piper"]);
  const audioEvidence = goldenAudio.ok
    ? [`golden WAV generated: ${goldenAudio.bytes} bytes`, `golden WAV sha256: ${goldenAudio.sha256}`]
    : [`golden WAV unavailable: ${goldenAudio.error}`];
  const localWhisper = goldenAudio.ok && existsSync(LOCAL_PYTHON) && whisperPackages.includes("faster_whisper")
    ? runLocalWhisperTranscription(goldenAudio.path)
    : null;
  const localWhisperText = localWhisper?.ok ? localWhisper.text : "";
  const localWhisperMatchedTokens = matchedExpectedTokens(localWhisperText);
  const localWhisperPassed = Boolean(localWhisper?.ok && localWhisperMatchedTokens.includes("noderoom") && localWhisperMatchedTokens.includes("proof") && localWhisperMatchedTokens.length >= 4);
  const localPiper = runLocalPiperSynthesis();
  const localPiperRoundtrip = localPiper.ok && existsSync(LOCAL_PYTHON) && whisperPackages.includes("faster_whisper")
    ? runLocalWhisperTranscription(localPiper.outputPath)
    : null;
  const localPiperRoundtripText = localPiperRoundtrip?.ok ? localPiperRoundtrip.text : "";
  const localPiperMatchedTokens = matchedExpectedTokens(localPiperRoundtripText);

  return [
    {
      id: "local-whisper-stt-live",
      kind: "stt",
      provider: "local",
      status: localWhisperPassed ? "pass" : whisperPackages.includes("faster_whisper") ? "fail" : "blocked",
      cost: "free",
      model: LOCAL_WHISPER_MODEL,
      evidence: [
        `python: ${existsSync(LOCAL_PYTHON) ? LOCAL_PYTHON : "not found"}`,
        `command hits: ${whisperCommands.length ? whisperCommands.join(", ") : "none"}`,
        `python package hits: ${whisperPackages.length ? whisperPackages.join(", ") : "none"}`,
        ...audioEvidence,
        ...(localWhisper
          ? localWhisper.ok
            ? [`transcript: ${truncate(localWhisper.text, 240)}`, `language: ${localWhisper.language}`, `elapsedMs: ${String(localWhisper.elapsedMs)}`]
            : [`transcription failed: ${localWhisper.error}`, `elapsedMs: ${String(localWhisper.elapsedMs)}`]
          : []),
      ],
      artifacts: goldenAudio.ok ? [goldenAudio.path] : [],
      risks: [
        "First-run model download is networked; subsequent proof runs use the local model cache.",
        "CPU transcription latency depends on the machine.",
      ],
      next: localWhisperPassed
        ? "Keep faster-whisper as a local STT candidate behind VoiceGateway and add more golden fixtures before production defaulting."
        : whisperPackages.includes("faster_whisper")
          ? "Keep local STT disabled until the golden transcript verifier passes."
          : "Install whisper.cpp or faster-whisper before claiming free local STT.",
      verifier: localWhisper
        ? { expectedTokens: EXPECTED_TRANSCRIPT_TOKENS, matchedTokens: localWhisperMatchedTokens, text: localWhisperText }
        : undefined,
    },
    {
      id: "local-piper-tts-live",
      kind: "tts",
      provider: "local",
      status: localPiper.ok ? "pass" : ttsCommands.length || ttsPackages.length ? "fail" : "blocked",
      cost: "free",
      model: LOCAL_PIPER_MODEL,
      evidence: [
        `piper: ${existsSync(LOCAL_PIPER) ? LOCAL_PIPER : "not found"}`,
        `model: ${existsSync(LOCAL_PIPER_MODEL) ? LOCAL_PIPER_MODEL : "not found"}`,
        `config: ${existsSync(LOCAL_PIPER_CONFIG) ? LOCAL_PIPER_CONFIG : "not found"}`,
        `command hits: ${ttsCommands.length ? ttsCommands.join(", ") : "none"}`,
        `python package hits: ${ttsPackages.length ? ttsPackages.join(", ") : "none"}`,
        ...(localPiper.ok
          ? [
              `audio bytes: ${String(localPiper.bytes)}`,
              `durationSec: ${localPiper.durationSec.toFixed(2)}`,
              `sampleRate: ${String(localPiper.sampleRate)}`,
              `sha256: ${localPiper.sha256}`,
            ]
          : [`synthesis failed: ${localPiper.error}`]),
        ...(localPiperRoundtrip
          ? localPiperRoundtrip.ok
            ? [`roundtrip transcript: ${truncate(localPiperRoundtrip.text, 240)}`, `roundtrip elapsedMs: ${String(localPiperRoundtrip.elapsedMs)}`]
            : [`roundtrip failed: ${localPiperRoundtrip.error}`]
          : []),
      ],
      artifacts: localPiper.ok ? [localPiper.outputPath] : [],
      risks: [
        "Voice model licensing and voice choice must be recorded before production use.",
        "This proves local WAV generation; browser playback integration remains a separate adapter step.",
      ],
      next: localPiper.ok
        ? "Keep Piper as a local TTS candidate behind VoiceGateway and add playback/duration checks in the browser adapter."
        : ttsCommands.length || ttsPackages.length
          ? "Keep local TTS disabled until Piper generates a valid WAV."
          : "Install Kokoro or Piper before claiming free local TTS.",
      verifier: localPiperRoundtrip
        ? { expectedTokens: EXPECTED_TRANSCRIPT_TOKENS, matchedTokens: localPiperMatchedTokens, text: localPiperRoundtripText }
        : undefined,
    },
  ];
}

type LocalTranscriptionResult =
  | { ok: true; text: string; language: string; languageProbability: number; elapsedMs: number }
  | { ok: false; error: string; elapsedMs: number };

function runLocalWhisperTranscription(audioPath: string): LocalTranscriptionResult {
  const started = Date.now();
  const code = [
    "import json",
    "from faster_whisper import WhisperModel",
    `model = WhisperModel(${JSON.stringify(LOCAL_WHISPER_MODEL)}, device='cpu', compute_type='int8', download_root=${JSON.stringify(resolve(LOCAL_MODEL_ROOT, "faster-whisper"))})`,
    `segments, info = model.transcribe(${JSON.stringify(audioPath)}, beam_size=1, language='en')`,
    "text = ' '.join(seg.text.strip() for seg in segments).strip()",
    "print(json.dumps({'text': text, 'language': info.language, 'languageProbability': info.language_probability}))",
  ].join("\n");
  const result = spawnSync(LOCAL_PYTHON, ["-c", code], {
    encoding: "utf8",
    timeout: LOCAL_AUDIO_TIMEOUT_MS,
    env: { ...process.env, HF_HOME: resolve(LOCAL_MODEL_ROOT, "hf"), HF_HUB_DISABLE_TELEMETRY: "1" },
  });
  const elapsedMs = Date.now() - started;
  if (result.status !== 0) return { ok: false, error: compactError(result.stderr || result.stdout || `python exited ${String(result.status)}`), elapsedMs };
  const jsonLine = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{")).at(-1);
  if (!jsonLine) return { ok: false, error: `missing transcription JSON: ${compactError(result.stdout || result.stderr)}`, elapsedMs };
  try {
    const parsed = JSON.parse(jsonLine) as { text?: string; language?: string; languageProbability?: number };
    return {
      ok: true,
      text: parsed.text ?? "",
      language: parsed.language ?? "unknown",
      languageProbability: Number(parsed.languageProbability ?? 0),
      elapsedMs,
    };
  } catch (error) {
    return { ok: false, error: errorText(error), elapsedMs };
  }
}

type LocalPiperResult =
  | { ok: true; outputPath: string; bytes: number; sha256: string; sampleRate: number; durationSec: number }
  | { ok: false; error: string };

function runLocalPiperSynthesis(): LocalPiperResult {
  if (!existsSync(LOCAL_PIPER)) return { ok: false, error: `missing piper executable: ${LOCAL_PIPER}` };
  if (!existsSync(LOCAL_PIPER_MODEL)) return { ok: false, error: `missing piper model: ${LOCAL_PIPER_MODEL}` };
  if (!existsSync(LOCAL_PIPER_CONFIG)) return { ok: false, error: `missing piper config: ${LOCAL_PIPER_CONFIG}` };

  const inputPath = resolve(OUT_DIR, "local-piper-input.txt");
  const outputPath = resolve(OUT_DIR, "local-piper-output.wav");
  writeFileSync(inputPath, PHRASE);
  const result = spawnSync(LOCAL_PIPER, [
    "-m",
    LOCAL_PIPER_MODEL,
    "-c",
    LOCAL_PIPER_CONFIG,
    "-i",
    inputPath,
    "-f",
    outputPath,
  ], { encoding: "utf8", timeout: LOCAL_AUDIO_TIMEOUT_MS });
  if (result.status !== 0) return { ok: false, error: compactError(result.stderr || result.stdout || `piper exited ${String(result.status)}`) };
  const wav = inspectWav(outputPath);
  if (!wav.ok) return { ok: false, error: wav.error };
  return {
    ok: true,
    outputPath,
    bytes: wav.bytes,
    sha256: sha256File(outputPath),
    sampleRate: wav.sampleRate,
    durationSec: wav.durationSec,
  };
}

function localPythonImportHits(names: string[]): string[] {
  if (!existsSync(LOCAL_PYTHON)) return [];
  return names.flatMap((name) => {
    const result = spawnSync(LOCAL_PYTHON, ["-c", `import ${name}`], { encoding: "utf8", timeout: 10_000 });
    return result.status === 0 ? [name] : [];
  });
}

async function runNvidiaDirectNemotronAudioProof(): Promise<LiveLane> {
  if (!NVIDIA_DIRECT_KEY) {
    return {
      id: "nvidia-direct-nemotron-audio-live",
      kind: "stt",
      provider: "nvidia",
      status: "blocked",
      cost: "prototype_free_trial",
      model: NVIDIA_DIRECT_MODEL,
      endpoint: NVIDIA_DIRECT_CHAT_URL,
      evidence: [
        "NVIDIA_API_KEY/NVIDIA_NIM_API_KEY/NGC_API_KEY/NVCF_API_KEY is not set",
        "direct endpoint checked without auth: 401 Header of type authorization was missing",
        "Nvidia docs use audio_url data URLs or NVCF assets for audio, plus /no_think for audio/video requests.",
      ],
      artifacts: [],
      risks: ["The direct Nvidia lane cannot be promoted until a real authenticated transcript receipt exists."],
      next: "Set a Nvidia API key and rerun voice:free-audio:live-proof to verify whether direct Nvidia fixes the OpenRouter missing-audio behavior.",
    };
  }

  const audio = ensureNvidiaDirectWav();
  if (!audio.ok) {
    return {
      id: "nvidia-direct-nemotron-audio-live",
      kind: "stt",
      provider: "nvidia",
      status: "blocked",
      cost: "prototype_free_trial",
      model: NVIDIA_DIRECT_MODEL,
      endpoint: NVIDIA_DIRECT_CHAT_URL,
      evidence: [`direct Nvidia WAV unavailable: ${audio.error}`],
      artifacts: [],
      risks: ["The direct Nvidia lane cannot be proven without a local audio fixture."],
      next: "Repair the local WAV generation fixture and rerun the direct Nvidia proof.",
    };
  }

  const audioBase64 = readFileSync(audio.path).toString("base64");
  const attempts: OpenRouterAudioInputAttempt[] = [];
  const proofStarted = Date.now();
  for (const variant of nvidiaDirectAudioVariants(audioBase64)) {
    const started = Date.now();
    const result = await postNvidiaJson(NVIDIA_DIRECT_CHAT_URL, variant.body, OPENROUTER_AUDIO_TIMEOUT_MS);
    if (!result.ok) {
      attempts.push({
        model: NVIDIA_DIRECT_MODEL,
        variant: variant.id,
        status: "fail",
        httpStatus: result.status,
        error: result.error,
        elapsedMs: Date.now() - started,
        matchedTokens: [],
      });
      continue;
    }

    const text = extractChatText(result.json);
    const matchedTokens = matchedTokensFor(text, NVIDIA_DIRECT_EXPECTED_TOKENS);
    const passed = NVIDIA_DIRECT_EXPECTED_TOKENS.every((token) => matchedTokens.includes(token));
    attempts.push({
      model: NVIDIA_DIRECT_MODEL,
      variant: variant.id,
      status: passed ? "pass" : "fail",
      httpStatus: result.status,
      text,
      elapsedMs: Date.now() - started,
      matchedTokens,
    });
    if (passed) {
      return {
        id: "nvidia-direct-nemotron-audio-live",
        kind: "stt",
        provider: "nvidia",
        status: "pass",
        cost: "prototype_free_trial",
        model: NVIDIA_DIRECT_MODEL,
        endpoint: NVIDIA_DIRECT_CHAT_URL,
        evidence: [
          "Nvidia direct request shape: audio_url data URL with /no_think and chat_template_kwargs.enable_thinking=false.",
          `fixture bytes: ${String(audio.bytes)}`,
          `fixture sha256: ${audio.sha256}`,
          ...audioInputAttemptEvidence(attempts),
          `elapsedMs: ${String(Date.now() - proofStarted)}`,
        ],
        artifacts: [audio.path],
        risks: ["Direct Nvidia audio still sends room audio to an external provider and must stay behind VoiceGateway governance."],
        next: "Promote direct Nvidia as an experimental hosted Nemotron audio lane only after repeated fixtures pass.",
        verifier: { expectedTokens: NVIDIA_DIRECT_EXPECTED_TOKENS, matchedTokens, text },
      };
    }
  }

  const bestAttempt = attempts.find((attempt) => attempt.text) ?? attempts[0];
  return {
    id: "nvidia-direct-nemotron-audio-live",
    kind: "stt",
    provider: "nvidia",
    status: "fail",
    cost: "prototype_free_trial",
    model: NVIDIA_DIRECT_MODEL,
    endpoint: NVIDIA_DIRECT_CHAT_URL,
    evidence: [
      "Nvidia direct request shape: audio_url data URL with /no_think and chat_template_kwargs.enable_thinking=false.",
      `fixture bytes: ${String(audio.bytes)}`,
      `fixture sha256: ${audio.sha256}`,
      ...audioInputAttemptEvidence(attempts),
      `elapsedMs: ${String(Date.now() - proofStarted)}`,
    ],
    artifacts: [audio.path],
    risks: ["Direct Nvidia accepted/authenticated the request but did not return a verified transcript."],
    next: "Keep direct Nvidia disabled until the proof receipt contains the expected transcript tokens.",
    verifier: {
      expectedTokens: NVIDIA_DIRECT_EXPECTED_TOKENS,
      matchedTokens: bestAttempt?.matchedTokens ?? [],
      text: bestAttempt?.text ?? "",
    },
  };
}

function ensureNvidiaDirectWav(): { ok: true; path: string; bytes: number; sha256: string } | { ok: false; error: string } {
  const path = resolve(OUT_DIR, "nvidia-direct-nemotron-proof.wav");
  if (!existsSync(path)) {
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
        `$synth.Speak(${psQuote(NVIDIA_DIRECT_PHRASE)})`,
        "$synth.Dispose()",
      ].join("\n"),
    ], { encoding: "utf8", timeout: 30_000 });

    if (result.status !== 0) {
      return { ok: false, error: compactError(result.stderr || result.stdout || `powershell exited ${String(result.status)}`) };
    }
  }

  try {
    const bytes = statSync(path).size;
    if (bytes <= 44) return { ok: false, error: `generated WAV is too small: ${bytes} bytes` };
    return { ok: true, path, bytes, sha256: sha256File(path) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

function nvidiaDirectAudioVariants(audioBase64: string): Array<{ id: string; body: Record<string, unknown> }> {
  const audioUrlPart = { type: "audio_url", audio_url: { url: `data:audio/wav;base64,${audioBase64}` } };
  const inputAudioPart = { type: "input_audio", input_audio: { data: audioBase64, format: "wav" } };
  const textPart = { type: "text", text: "Transcribe this audio exactly. Return only the spoken words." };
  const base = {
    model: NVIDIA_DIRECT_MODEL,
    max_tokens: 120,
    temperature: 0,
    top_k: 1,
    chat_template_kwargs: { enable_thinking: false },
  };
  return [
    {
      id: "nvidia-audio-url-data-audio-then-text",
      body: {
        ...base,
        messages: [
          { role: "system", content: "/no_think" },
          { role: "user", content: [audioUrlPart, textPart] },
        ],
      },
    },
    {
      id: "nvidia-audio-url-data-text-then-audio",
      body: {
        ...base,
        messages: [
          { role: "system", content: "/no_think" },
          { role: "user", content: [textPart, audioUrlPart] },
        ],
      },
    },
    {
      id: "nvidia-input-audio-control",
      body: {
        ...base,
        messages: [
          { role: "system", content: "/no_think" },
          { role: "user", content: [inputAudioPart, textPart] },
        ],
      },
    },
  ];
}

async function fetchOpenRouterCatalogs(): Promise<OpenRouterCatalogs> {
  const [
    audioInputText,
    transcription,
    speech,
    audioOutput,
    text,
  ] = await Promise.all([
    fetchOpenRouterCatalog(OPENROUTER_AUDIO_INPUT_TEXT_MODELS_URL),
    fetchOpenRouterCatalog(OPENROUTER_TRANSCRIPTION_MODELS_URL),
    fetchOpenRouterCatalog(OPENROUTER_SPEECH_MODELS_URL),
    fetchOpenRouterCatalog(OPENROUTER_AUDIO_OUTPUT_MODELS_URL),
    fetchOpenRouterCatalog(OPENROUTER_TEXT_MODELS_URL),
  ]);
  return { audioInputText, transcription, speech, audioOutput, text };
}

function skippedOpenRouterCatalogs(reason: string): OpenRouterCatalogs {
  return {
    audioInputText: skippedOpenRouterCatalog(OPENROUTER_AUDIO_INPUT_TEXT_MODELS_URL, reason),
    transcription: skippedOpenRouterCatalog(OPENROUTER_TRANSCRIPTION_MODELS_URL, reason),
    speech: skippedOpenRouterCatalog(OPENROUTER_SPEECH_MODELS_URL, reason),
    audioOutput: skippedOpenRouterCatalog(OPENROUTER_AUDIO_OUTPUT_MODELS_URL, reason),
    text: skippedOpenRouterCatalog(OPENROUTER_TEXT_MODELS_URL, reason),
  };
}

function skippedOpenRouterCatalog(source: string, reason: string): OpenRouterCatalog {
  return { ok: false, source, models: [], error: reason };
}

async function fetchOpenRouterCatalog(source: string): Promise<OpenRouterCatalog> {
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return { ok: false, source, models: [], error: `${response.status} ${await response.text()}` };
    const payload = await response.json() as { data?: OpenRouterModel[] };
    return { ok: true, source, models: Array.isArray(payload.data) ? payload.data : [] };
  } catch (error) {
    return { ok: false, source, models: [], error: errorText(error) };
  }
}

async function runOpenRouterAudioInputChatProof(catalog: OpenRouterCatalog, goldenAudio: ReturnType<typeof ensureGoldenWav>): Promise<LiveLane> {
  const candidates = catalog.models.filter((model) => isZeroPriced(model) && hasModality(model, "input", "audio") && hasModality(model, "output", "text"));
  if (!catalog.ok) return openRouterBlocked("openrouter-free-audio-input-chat-live", "stt", `model catalog unavailable: ${catalog.error ?? "unknown error"}`);
  if (!candidates.length) return openRouterBlocked("openrouter-free-audio-input-chat-live", "stt", "no zero-priced audio-input/text-output model in the live OpenRouter catalog");
  if (!OPENROUTER_KEY) return openRouterBlocked("openrouter-free-audio-input-chat-live", "stt", "OPENROUTER_API_KEY is not set");
  if (!goldenAudio.ok) return openRouterBlocked("openrouter-free-audio-input-chat-live", "stt", `golden WAV unavailable: ${goldenAudio.error}`);

  const audioBase64 = readFileSync(goldenAudio.path).toString("base64");
  const proofStarted = Date.now();
  const attempts: OpenRouterAudioInputAttempt[] = [];

  for (const candidate of candidates) {
    for (const variant of audioInputVariants(candidate.id, audioBase64)) {
      const started = Date.now();
      const result = await postJson(OPENROUTER_CHAT_URL, variant.body, OPENROUTER_AUDIO_TIMEOUT_MS);
      if (!result.ok) {
        attempts.push({
          model: candidate.id,
          variant: variant.id,
          status: "fail",
          httpStatus: result.status,
          error: result.error,
          elapsedMs: Date.now() - started,
          matchedTokens: [],
        });
        continue;
      }

      const text = extractChatText(result.json);
      const matchedTokens = matchedExpectedTokens(text);
      const passed = matchedTokens.includes("noderoom") && matchedTokens.includes("proof") && matchedTokens.length >= 3;
      attempts.push({
        model: candidate.id,
        variant: variant.id,
        status: passed ? "pass" : "fail",
        httpStatus: result.status,
        text,
        elapsedMs: Date.now() - started,
        matchedTokens,
      });
      if (passed) {
        return {
          id: "openrouter-free-audio-input-chat-live",
          kind: "stt",
          provider: "openrouter",
          status: "pass",
          cost: "free",
          model: candidate.id,
          endpoint: OPENROUTER_CHAT_URL,
          evidence: [
            `catalog source: ${catalog.source}`,
            `catalog candidates: ${candidates.length}`,
            "OpenRouter SDK outbound schema: inputAudio serializes to input_audio; raw HTTP proof uses serialized input_audio.",
            ...audioInputAttemptEvidence(attempts),
            `elapsedMs: ${String(Date.now() - proofStarted)}`,
          ],
          artifacts: [goldenAudio.path],
          risks: [
            "This is audio understanding through Chat Completions, not a dedicated STT contract.",
            "OpenRouter provider data policy must be treated as external audio egress.",
          ],
          next: "Keep as an experimental VoiceGateway STT lane until repeated fixtures prove command-grade transcription.",
          verifier: { expectedTokens: EXPECTED_TRANSCRIPT_TOKENS, matchedTokens, text },
        };
      }
    }
  }

  const bestAttempt = attempts.find((attempt) => attempt.text) ?? attempts[0];
  const bestText = bestAttempt?.text ?? "";
  const bestMatchedTokens = bestAttempt?.matchedTokens ?? [];
  const allRequestsFailed = attempts.length > 0 && attempts.every((attempt) => attempt.error);
  return {
    id: "openrouter-free-audio-input-chat-live",
    kind: "stt",
    provider: "openrouter",
    status: "fail",
    cost: "free",
    model: candidates.map((candidate) => candidate.id).join(", "),
    endpoint: OPENROUTER_CHAT_URL,
    evidence: [
      `catalog source: ${catalog.source}`,
      `catalog candidates: ${candidates.length}`,
      "OpenRouter SDK outbound schema: inputAudio serializes to input_audio; raw HTTP proof uses serialized input_audio.",
      ...audioInputAttemptEvidence(attempts),
      `elapsedMs: ${String(Date.now() - proofStarted)}`,
    ],
    artifacts: [goldenAudio.path],
    risks: [
      allRequestsFailed
        ? "Every free audio-input chat attempt failed at HTTP/request level."
        : "The free audio-input chat model accepted the request but did not produce a verified transcript.",
      "Do not use this as a voice command STT lane while responses report missing or ignored audio.",
    ],
    next: "Keep this lane disabled until an SDK-compatible chat-audio request returns a verified transcript receipt.",
    verifier: { expectedTokens: EXPECTED_TRANSCRIPT_TOKENS, matchedTokens: bestMatchedTokens, text: bestText },
  };
}

type OpenRouterAudioInputAttempt = {
  model: string;
  variant: string;
  status: LiveLaneStatus;
  httpStatus?: number;
  text?: string;
  error?: string;
  elapsedMs: number;
  matchedTokens: string[];
};

function audioInputVariants(model: string, audioBase64: string): Array<{ id: string; body: Record<string, unknown> }> {
  const prompt = "Transcribe the attached audio exactly. Return only the spoken words.";
  const audioPart = { type: "input_audio", input_audio: { data: audioBase64, format: "wav" } };
  const textPart = { type: "text", text: prompt };
  const base = {
    model,
    temperature: 0,
    max_tokens: 120,
  };
  return [
    {
      id: "sdk-outbound-text-then-audio",
      body: {
        ...base,
        messages: [{ role: "user", content: [textPart, audioPart] }],
      },
    },
    {
      id: "sdk-outbound-audio-then-text",
      body: {
        ...base,
        messages: [{ role: "user", content: [audioPart, textPart] }],
      },
    },
    {
      id: "sdk-outbound-audio-only",
      body: {
        ...base,
        messages: [{ role: "user", content: [audioPart] }],
      },
    },
  ];
}

function audioInputAttemptEvidence(attempts: OpenRouterAudioInputAttempt[]): string[] {
  if (!attempts.length) return ["audioInputVariants attempted: 0"];
  return [
    `audioInputVariants attempted: ${attempts.length}`,
    ...attempts.map((attempt) => {
      const status = attempt.httpStatus ? `http ${attempt.httpStatus}` : "no http status";
      const result = attempt.error
        ? `error=${truncate(attempt.error, 180)}`
        : `matched=${attempt.matchedTokens.join(",") || "none"} text=${truncate(attempt.text ?? "", 180) || "(empty)"}`;
      return `${attempt.variant} ${attempt.model} ${status} ${result} elapsedMs=${String(attempt.elapsedMs)}`;
    }),
  ];
}

async function runOpenRouterDedicatedSttProof(catalog: OpenRouterCatalog, goldenAudio: ReturnType<typeof ensureGoldenWav>): Promise<LiveLane> {
  const candidates = catalog.models.filter((model) => isZeroPriced(model) && hasModality(model, "output", "transcription"));
  const model = candidates[0]?.id;
  if (!catalog.ok) return openRouterBlocked("openrouter-free-dedicated-stt-live", "stt", `model catalog unavailable: ${catalog.error ?? "unknown error"}`);
  if (!model) {
    return openRouterBlockedWithEvidence("openrouter-free-dedicated-stt-live", "stt", [
      `catalog source: ${catalog.source}`,
      `catalog total: ${String(catalog.models.length)}`,
      "zero-priced transcription candidates: 0",
      `paid transcription candidates: ${catalog.models.slice(0, 8).map((item) => item.id).join(", ") || "none"}`,
    ], "No free OpenRouter dedicated STT lane is available today; use local Whisper or a paid provider fallback behind VoiceGateway.");
  }
  if (!OPENROUTER_KEY) return openRouterBlocked("openrouter-free-dedicated-stt-live", "stt", "OPENROUTER_API_KEY is not set");
  if (!goldenAudio.ok) return openRouterBlocked("openrouter-free-dedicated-stt-live", "stt", `golden WAV unavailable: ${goldenAudio.error}`);

  const body = {
    model,
    input_audio: { data: readFileSync(goldenAudio.path).toString("base64"), format: "wav" },
    language: "en",
    temperature: 0,
  };
  const started = Date.now();
  const result = await postJson(OPENROUTER_STT_URL, body, OPENROUTER_AUDIO_TIMEOUT_MS);
  if (!result.ok) {
    return {
      id: "openrouter-free-dedicated-stt-live",
      kind: "stt",
      provider: "openrouter",
      status: "fail",
      cost: "free",
      model,
      endpoint: OPENROUTER_STT_URL,
      evidence: [
        `catalog source: ${catalog.source}`,
        `catalog candidates: ${candidates.length}`,
        `request failed: ${result.status ? `${String(result.status)} ` : ""}${result.error}`,
        `elapsedMs: ${String(Date.now() - started)}`,
      ],
      artifacts: [goldenAudio.path],
      risks: ["The catalog advertised a free transcription model, but the STT endpoint did not return a transcript."],
      next: "Keep this lane disabled until the STT endpoint produces a verified transcript receipt.",
    };
  }

  const text = typeof result.json?.text === "string" ? result.json.text : "";
  const matchedTokens = matchedExpectedTokens(text);
  const passed = matchedTokens.includes("noderoom") && matchedTokens.includes("proof") && matchedTokens.length >= 4;
  return {
    id: "openrouter-free-dedicated-stt-live",
    kind: "stt",
    provider: "openrouter",
    status: passed ? "pass" : "fail",
    cost: "free",
    model,
    endpoint: OPENROUTER_STT_URL,
    evidence: [
      `catalog source: ${catalog.source}`,
      `catalog candidates: ${candidates.length}`,
      `response text: ${truncate(text, 240) || "(empty)"}`,
      `elapsedMs: ${String(Date.now() - started)}`,
    ],
    artifacts: [goldenAudio.path],
    risks: ["This still sends room audio to an external provider and must respect public/private room permissions."],
    next: passed
      ? "Consider an experimental hosted-free STT adapter behind VoiceGateway."
      : "Do not route voice commands through this lane; it did not reproduce the golden transcript.",
    verifier: { expectedTokens: EXPECTED_TRANSCRIPT_TOKENS, matchedTokens, text },
  };
}

async function runOpenRouterTtsProof(catalog: OpenRouterCatalog, audioOutputCatalog: OpenRouterCatalog): Promise<LiveLane> {
  const candidates = catalog.models.filter((model) => isZeroPriced(model) && hasModality(model, "output", "speech"));
  const model = candidates[0]?.id;
  if (!catalog.ok) return openRouterBlocked("openrouter-free-tts-live", "tts", `model catalog unavailable: ${catalog.error ?? "unknown error"}`);
  if (!model) {
    const freeAudioOutputModels = audioOutputCatalog.models.filter(isZeroPriced).map((item) => item.id);
    return openRouterBlockedWithEvidence("openrouter-free-tts-live", "tts", [
      `catalog source: ${catalog.source}`,
      `catalog total: ${String(catalog.models.length)}`,
      "zero-priced speech/TTS candidates: 0",
      `paid speech/TTS candidates: ${catalog.models.slice(0, 8).map((item) => item.id).join(", ") || "none"}`,
      `free audio-output non-speech models not used for /audio/speech: ${freeAudioOutputModels.join(", ") || "none"}`,
    ], "No free OpenRouter /audio/speech lane is available today; use browser speechSynthesis, local Piper, or a paid provider fallback behind VoiceGateway.");
  }
  if (!OPENROUTER_KEY) return openRouterBlocked("openrouter-free-tts-live", "tts", "OPENROUTER_API_KEY is not set");

  const started = Date.now();
  try {
    const response = await fetch(OPENROUTER_TTS_URL, {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model,
        input: PHRASE,
        voice: "alloy",
        response_format: "mp3",
        speed: 1,
      }),
      signal: AbortSignal.timeout(OPENROUTER_AUDIO_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      return {
        id: "openrouter-free-tts-live",
        kind: "tts",
        provider: "openrouter",
        status: "fail",
        cost: "free",
        model,
        endpoint: OPENROUTER_TTS_URL,
        evidence: [
          `catalog source: ${catalog.source}`,
          `catalog candidates: ${candidates.length}`,
          `request failed: ${response.status} ${truncate(await response.text(), 300)}`,
          `elapsedMs: ${String(Date.now() - started)}`,
        ],
        artifacts: [],
        risks: [
          "The live speech/TTS catalog advertised a free model, but /audio/speech did not return playable bytes.",
        ],
        next: "Do not route narration through this lane until /audio/speech returns playable speech bytes.",
      };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const out = resolve(OUT_DIR, "openrouter-free-tts.mp3");
    writeFileSync(out, bytes);
    const passed = bytes.length > 1024 && /^audio\//i.test(contentType);
    return {
      id: "openrouter-free-tts-live",
      kind: "tts",
      provider: "openrouter",
      status: passed ? "pass" : "fail",
      cost: "free",
      model,
      endpoint: OPENROUTER_TTS_URL,
      evidence: [
        `catalog source: ${catalog.source}`,
        `catalog candidates: ${candidates.length}`,
        `content-type: ${contentType || "(missing)"}`,
        `audio bytes: ${String(bytes.length)}`,
        `sha256: ${sha256Buffer(bytes)}`,
        `elapsedMs: ${String(Date.now() - started)}`,
      ],
      artifacts: [out],
      risks: ["This only proves byte generation; a follow-up verifier should roundtrip through STT or inspect duration."],
      next: passed
        ? "Add duration and speech-content verification before using this as a production narration provider."
        : "Keep browser/OpenAI narration fallback enabled; this response was not a valid audio bytestream.",
    };
  } catch (error) {
    return {
      id: "openrouter-free-tts-live",
      kind: "tts",
      provider: "openrouter",
      status: "fail",
      cost: "free",
      model,
      endpoint: OPENROUTER_TTS_URL,
      evidence: [
        `catalog source: ${catalog.source}`,
        `catalog candidates: ${candidates.length}`,
        `request threw: ${errorText(error)}`,
        `elapsedMs: ${String(Date.now() - started)}`,
      ],
      artifacts: [],
      risks: ["The hosted free TTS lane was not proven live."],
      next: "Keep this lane disabled until /audio/speech returns playable speech bytes.",
    };
  }
}

function openRouterBlocked(id: string, kind: LiveLaneKind, reason: string): LiveLane {
  return openRouterBlockedWithEvidence(id, kind, [reason]);
}

function openRouterBlockedWithEvidence(id: string, kind: LiveLaneKind, evidence: string[], next?: string): LiveLane {
  return {
    id,
    kind,
    provider: "openrouter",
    status: "blocked",
    cost: "free",
    evidence,
    artifacts: [],
    risks: ["No hosted free audio live pass was produced for this lane."],
    next: next ?? "Use browser/local free lanes when they pass, otherwise keep the existing OpenAI VoiceGateway fallback.",
  };
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ ok: true; status: number; json: Record<string, unknown> } | { ok: false; status?: number; error: string }> {
  return postJsonWithHeaders(url, body, timeoutMs, openRouterHeaders());
}

async function postNvidiaJson(url: string, body: unknown, timeoutMs: number): Promise<{ ok: true; status: number; json: Record<string, unknown> } | { ok: false; status?: number; error: string }> {
  return postJsonWithHeaders(url, body, timeoutMs, {
    Authorization: `Bearer ${NVIDIA_DIRECT_KEY}`,
    "Content-Type": "application/json",
  });
}

async function postJsonWithHeaders(
  url: string,
  body: unknown,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<{ ok: true; status: number; json: Record<string, unknown> } | { ok: false; status?: number; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, error: truncate(text, 500) };
    try {
      return { ok: true, status: response.status, json: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { ok: false, status: response.status, error: `non-json response: ${truncate(text, 200)}` };
    }
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

function openRouterHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${OPENROUTER_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://noderoom.local",
    "X-Title": "NodeRoom free audio live proof",
  };
}

function isZeroPriced(model: OpenRouterModel): boolean {
  const prices = Object.values(model.pricing ?? {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return prices.length > 0 && prices.every((value) => value === 0);
}

function hasModality(model: OpenRouterModel, side: "input" | "output", value: string): boolean {
  const modalities = side === "input" ? model.architecture?.input_modalities : model.architecture?.output_modalities;
  return Array.isArray(modalities) && modalities.map((item) => item.toLowerCase()).includes(value);
}

function commandHits(names: string[]): string[] {
  return names.flatMap((name) => {
    const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [name], { encoding: "utf8", timeout: 5000 });
    if (result.status !== 0) return [];
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
  });
}

function pythonImportHits(names: string[]): string[] {
  const python = commandHits(["python", "python3", "py"])[0];
  if (!python) return [];
  return names.flatMap((name) => {
    const result = spawnSync(python, ["-c", `import ${name}`], { encoding: "utf8", timeout: 10_000 });
    return result.status === 0 ? [name] : [];
  });
}

function extractChatText(json: Record<string, unknown>): string {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text);
      return "";
    }).join(" ").trim();
  }
  return "";
}

function matchedExpectedTokens(text: string): string[] {
  return matchedTokensFor(text, EXPECTED_TRANSCRIPT_TOKENS);
}

function matchedTokensFor(text: string, tokens: string[]): string[] {
  const normalized = normalize(text);
  return tokens.filter((token) => normalized.includes(token));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/node\s+room/g, "noderoom").replace(/[^a-z0-9]+/g, " ").trim();
}

function summarize(items: LiveLane[]): Record<LiveLaneStatus, number> {
  return {
    pass: items.filter((item) => item.status === "pass").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    fail: items.filter((item) => item.status === "fail").length,
  };
}

function summarizeOpenRouterCatalogs(catalogs: OpenRouterCatalogs): OpenRouterCatalogSnapshot {
  return {
    fetchedAt: new Date().toISOString(),
    audioInputText: summarizeOpenRouterCatalog(catalogs.audioInputText),
    transcription: summarizeOpenRouterCatalog(catalogs.transcription),
    speech: summarizeOpenRouterCatalog(catalogs.speech),
    audioOutput: summarizeOpenRouterCatalog(catalogs.audioOutput),
    text: summarizeOpenRouterCatalog(catalogs.text, 30),
  };
}

function summarizeOpenRouterCatalog(catalog: OpenRouterCatalog, limit = 12): OpenRouterCatalogSummary {
  const freeModels = catalog.models.filter(isZeroPriced);
  return {
    source: catalog.source,
    ok: catalog.ok,
    total: catalog.models.length,
    freeCount: freeModels.length,
    freeModels: freeModels.slice(0, limit).map(summarizeOpenRouterModel),
    error: catalog.error,
  };
}

function summarizeOpenRouterModel(model: OpenRouterModel): OpenRouterModelSummary {
  return {
    id: model.id,
    name: model.name,
    modality: model.architecture?.modality,
    inputModalities: model.architecture?.input_modalities ?? [],
    outputModalities: model.architecture?.output_modalities ?? [],
    pricing: model.pricing ?? {},
  };
}

function writeReceipt(value: Receipt): void {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const markdown = renderMarkdown(value);
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LATEST_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "receipt.json"), json);
  writeFileSync(resolve(OUT_DIR, "scorecard.md"), markdown);
  writeFileSync(resolve(LATEST_DIR, "receipt.json"), json);
  writeFileSync(resolve(LATEST_DIR, "scorecard.md"), markdown);
}

function renderConsole(value: Receipt): string {
  const lines = [
    `voice-free-audio live proof ${value.runId}`,
    `pass=${value.summary.pass} blocked=${value.summary.blocked} fail=${value.summary.fail}`,
    `receipt=${resolve(OUT_DIR, "receipt.json")}`,
  ];
  for (const lane of value.lanes) {
    lines.push(`${lane.status.toUpperCase().padEnd(8)} ${lane.id} (${lane.kind}/${lane.provider})`);
  }
  return lines.join("\n");
}

function renderMarkdown(value: Receipt): string {
  const lines = [
    "# Voice Free Audio Live Proof",
    "",
    `Run: \`${value.runId}\``,
    "",
    "| Lane | Kind | Provider | Status | Model | Evidence | Next |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const lane of value.lanes) {
    lines.push(`| \`${lane.id}\` | ${lane.kind} | ${lane.provider} | ${lane.status} | ${escapeTable(lane.model ?? "")} | ${lane.evidence.map(escapeTable).join("<br>")} | ${escapeTable(lane.next)} |`);
  }
  lines.push(
    "",
    "## Gates",
    "",
    `- liveRuntimeAttempted: ${String(value.gates.liveRuntimeAttempted)}`,
    `- noPaidAudioProviderUsed: ${String(value.gates.noPaidAudioProviderUsed)}`,
    `- anyLiveSttPass: ${String(value.gates.anyLiveSttPass)}`,
    `- anyLiveTtsPass: ${String(value.gates.anyLiveTtsPass)}`,
    "",
  );
  if (value.openRouterCatalogs) {
    lines.push(
      "## OpenRouter Free Catalog Snapshot",
      "",
      `Fetched: \`${value.openRouterCatalogs.fetchedAt}\``,
      "",
      "| Catalog | Total | Free | Free Models |",
      "|---|---:|---:|---|",
      `| audio input -> text | ${String(value.openRouterCatalogs.audioInputText.total)} | ${String(value.openRouterCatalogs.audioInputText.freeCount)} | ${escapeTable(formatFreeModelList(value.openRouterCatalogs.audioInputText.freeModels))} |`,
      `| transcription/STT | ${String(value.openRouterCatalogs.transcription.total)} | ${String(value.openRouterCatalogs.transcription.freeCount)} | ${escapeTable(formatFreeModelList(value.openRouterCatalogs.transcription.freeModels))} |`,
      `| speech/TTS | ${String(value.openRouterCatalogs.speech.total)} | ${String(value.openRouterCatalogs.speech.freeCount)} | ${escapeTable(formatFreeModelList(value.openRouterCatalogs.speech.freeModels))} |`,
      `| generic audio output | ${String(value.openRouterCatalogs.audioOutput.total)} | ${String(value.openRouterCatalogs.audioOutput.freeCount)} | ${escapeTable(formatFreeModelList(value.openRouterCatalogs.audioOutput.freeModels))} |`,
      `| text output | ${String(value.openRouterCatalogs.text.total)} | ${String(value.openRouterCatalogs.text.freeCount)} | ${escapeTable(formatFreeModelList(value.openRouterCatalogs.text.freeModels))} |`,
      "",
    );
  }
  lines.push(
    "## Recommendation",
    "",
    value.gates.productionRecommendation,
    "",
  );
  return `${lines.join("\n")}\n`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatFreeModelList(models: OpenRouterModelSummary[]): string {
  return models.map((model) => `\`${model.id}\``).join(", ") || "none";
}

function sha256File(path: string): string {
  return sha256Buffer(readFileSync(path));
}

function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inspectWav(path: string): { ok: true; bytes: number; sampleRate: number; durationSec: number } | { ok: false; error: string } {
  try {
    const bytes = readFileSync(path);
    if (bytes.length < 44) return { ok: false, error: `WAV too small: ${bytes.length} bytes` };
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
      return { ok: false, error: "not a RIFF/WAVE file" };
    }
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    const bitsPerSample = bytes.readUInt16LE(34);
    let offset = 12;
    let dataBytes = 0;
    while (offset + 8 <= bytes.length) {
      const chunkId = bytes.toString("ascii", offset, offset + 4);
      const chunkSize = bytes.readUInt32LE(offset + 4);
      if (chunkId === "data") {
        dataBytes = chunkSize;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (!channels || !sampleRate || !bitsPerSample || !dataBytes) {
      return { ok: false, error: `invalid WAV metadata channels=${channels} sampleRate=${sampleRate} bits=${bitsPerSample} data=${dataBytes}` };
    }
    const durationSec = dataBytes / (sampleRate * channels * (bitsPerSample / 8));
    if (durationSec <= 0) return { ok: false, error: "WAV has no duration" };
    return { ok: true, bytes: bytes.length, sampleRate, durationSec };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function truncate(value: string, max: number): string {
  const compact = compactError(value);
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}...`;
}

function compactError(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
