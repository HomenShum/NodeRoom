import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

type LaneKind = "stt" | "tts";
type LaneStatus = "pass" | "candidate" | "blocked" | "fail";

type ProofLane = {
  id: string;
  kind: LaneKind;
  provider: "browser" | "local" | "openrouter";
  status: LaneStatus;
  cost: "free" | "unknown";
  evidence: string[];
  risks: string[];
  next: string;
  models?: string[];
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
};

type Receipt = {
  schema: "voice-free-audio-proofloop-v1";
  createdAt: string;
  runId: string;
  gates: {
    noPaidProviderRequired: boolean;
    browserAudioSurfaceChecked: boolean;
    localBinarySurfaceChecked: boolean;
    openRouterCatalogChecked: boolean;
    productionRecommendation: string;
  };
  lanes: ProofLane[];
  summary: {
    pass: number;
    candidate: number;
    blocked: number;
    fail: number;
  };
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OUT_ROOT = resolve(".proofloop", "runs", "voice-free-audio");

const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const outDir = resolve(OUT_ROOT, runId);
const latestDir = resolve(OUT_ROOT, "latest");

loadDotEnvLocal();

const lanes: ProofLane[] = [];
lanes.push(...await browserLanes());
lanes.push(...localLanes());
lanes.push(...await openRouterLanes());

const receipt: Receipt = {
  schema: "voice-free-audio-proofloop-v1",
  createdAt: new Date().toISOString(),
  runId,
  gates: {
    noPaidProviderRequired: lanes.some((lane) => lane.status === "pass" && lane.cost === "free"),
    browserAudioSurfaceChecked: lanes.some((lane) => lane.provider === "browser"),
    localBinarySurfaceChecked: lanes.some((lane) => lane.provider === "local"),
    openRouterCatalogChecked: lanes.some((lane) => lane.provider === "openrouter"),
    productionRecommendation: "Use browser/local free audio as opportunistic lanes behind VoiceGateway; keep OpenAI audio as the reliable fallback until a local or hosted free lane has live transcript/audio receipts.",
  },
  lanes,
  summary: summarize(lanes),
};

writeReceipt(receipt);
console.log(renderConsole(receipt));

function loadDotEnvLocal(): void {
  const path = resolve(".env.local");
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key]) process.env[key] = unquoteEnv(value.trim());
    }
  } catch {
    // .env.local is optional; the proof loop must still report local/browser lanes.
  }
}

function unquoteEnv(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

async function browserLanes(): Promise<ProofLane[]> {
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>voice free audio proof</title>");
    const caps = await page.evaluate(() => {
      const speechGlobal = window as typeof window & {
        SpeechRecognition?: unknown;
        webkitSpeechRecognition?: unknown;
      };
      return {
        speechSynthesis: typeof window.speechSynthesis !== "undefined",
        speechSynthesisUtterance: typeof window.SpeechSynthesisUtterance !== "undefined",
        speechRecognition: typeof speechGlobal.SpeechRecognition !== "undefined" || typeof speechGlobal.webkitSpeechRecognition !== "undefined",
        mediaRecorder: typeof window.MediaRecorder !== "undefined",
        getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      };
    });
    await browser.close();

    return [
      {
        id: "browser-speech-recognition",
        kind: "stt",
        provider: "browser",
        status: caps.speechRecognition ? "candidate" : "blocked",
        cost: "free",
        evidence: [
          `SpeechRecognition/webkitSpeechRecognition available: ${String(caps.speechRecognition)}`,
          `MediaRecorder available: ${String(caps.mediaRecorder)}`,
          `getUserMedia available in automated Chromium: ${String(caps.getUserMedia)}`,
        ],
        risks: [
          "Browser speech recognition support differs across Chrome, Edge, Safari, and embedded browsers.",
          "Some browsers use vendor cloud speech services, so this is zero NodeRoom provider cost but not always offline.",
        ],
        next: caps.speechRecognition
          ? "Run a real composer command in Chrome/Edge and assert the resulting NodeRoom job route."
          : "Use Convex/OpenAI STT or add local whisper.cpp for browsers without SpeechRecognition.",
      },
      {
        id: "browser-speech-synthesis",
        kind: "tts",
        provider: "browser",
        status: caps.speechSynthesis && caps.speechSynthesisUtterance ? "pass" : "blocked",
        cost: "free",
        evidence: [
          `speechSynthesis available: ${String(caps.speechSynthesis)}`,
          `SpeechSynthesisUtterance available: ${String(caps.speechSynthesisUtterance)}`,
        ],
        risks: [
          "Voice inventory and audio quality are browser/OS dependent.",
          "This speaks locally in the browser and does not yield a durable audio blob for room replay.",
        ],
        next: "Use for opportunistic low-cost narration; keep provider TTS for deterministic audio receipts.",
      },
    ];
  } catch (error) {
    return [{
      id: "browser-audio-surface",
      kind: "tts",
      provider: "browser",
      status: "fail",
      cost: "free",
      evidence: [`Playwright browser capability probe failed: ${errorText(error)}`],
      risks: ["Browser free-audio claims are unproven on this machine."],
      next: "Repair Playwright/browser setup, then rerun this proof loop.",
    }];
  }
}

function localLanes(): ProofLane[] {
  const whisperHits = commandHits(["whisper-cli", "whisper-cpp", "whisper"]);
  const localWhisperPackages = pythonImportHits(["whisper", "faster_whisper"]);
  const ttsHits = commandHits(["kokoro", "kokoro-tts", "piper"]);
  const localTtsPackages = pythonImportHits(["kokoro", "TTS"]);

  return [
    {
      id: "local-whisper-stt",
      kind: "stt",
      provider: "local",
      status: whisperHits.length || localWhisperPackages.length ? "candidate" : "blocked",
      cost: "free",
      evidence: [
        `command hits: ${whisperHits.length ? whisperHits.join(", ") : "none"}`,
        `python package hits: ${localWhisperPackages.length ? localWhisperPackages.join(", ") : "none"}`,
      ],
      risks: [
        "Model weights and CPU/GPU performance are separate from binary availability.",
        "A production pass requires a golden WAV transcription smoke, not just installation discovery.",
      ],
      next: whisperHits.length || localWhisperPackages.length
        ? "Add a golden WAV fixture smoke and wire LocalWhisperSpeechToTextAdapter behind VoiceGateway."
        : "Install whisper.cpp or faster-whisper before claiming free local STT.",
    },
    {
      id: "local-kokoro-piper-tts",
      kind: "tts",
      provider: "local",
      status: ttsHits.length || localTtsPackages.length ? "candidate" : "blocked",
      cost: "free",
      evidence: [
        `command hits: ${ttsHits.length ? ttsHits.join(", ") : "none"}`,
        `python package hits: ${localTtsPackages.length ? localTtsPackages.join(", ") : "none"}`,
      ],
      risks: [
        "Voice model files must be pinned and licensed before production use.",
        "A production pass requires generating an audio file and validating nonzero duration/format.",
      ],
      next: ttsHits.length || localTtsPackages.length
        ? "Add a deterministic text-to-WAV smoke and wire LocalTextToSpeechAdapter behind VoiceGateway."
        : "Install Kokoro or Piper before claiming free local TTS.",
    },
  ];
}

async function openRouterLanes(): Promise<ProofLane[]> {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const payload = await response.json() as { data?: OpenRouterModel[] };
    const models = Array.isArray(payload.data) ? payload.data : [];
    const freeAudioInput = models.filter((model) => isZeroPriced(model) && hasModality(model, "input", "audio") && hasModality(model, "output", "text"));
    const freeAudioOutput = models.filter((model) => isZeroPriced(model) && hasModality(model, "output", "audio"));

    return [
      {
        id: "openrouter-free-audio-input",
        kind: "stt",
        provider: "openrouter",
        status: freeAudioInput.length ? "candidate" : "blocked",
        cost: "free",
        models: freeAudioInput.map((model) => model.id),
        evidence: [
          `queried ${OPENROUTER_MODELS_URL}`,
          `zero-priced audio-input/text-output models: ${freeAudioInput.length}`,
          ...freeAudioInput.slice(0, 5).map((model) => `${model.id} :: ${model.architecture?.modality ?? "unknown modality"}`),
        ],
        risks: [
          "Audio-input text models may summarize or analyze audio instead of producing verbatim command transcription.",
          "OpenRouter provider logging and data policy still need room-level disclosure before public/private audio egress.",
        ],
        next: freeAudioInput.length
          ? "Run an explicit synthetic WAV transcription smoke before routing live voice commands through this lane."
          : "No free hosted STT candidate found in the live OpenRouter catalog.",
      },
      {
        id: "openrouter-free-audio-output",
        kind: "tts",
        provider: "openrouter",
        status: freeAudioOutput.length ? "candidate" : "blocked",
        cost: "free",
        models: freeAudioOutput.map((model) => model.id),
        evidence: [
          `queried ${OPENROUTER_MODELS_URL}`,
          `zero-priced audio-output models: ${freeAudioOutput.length}`,
          ...freeAudioOutput.slice(0, 5).map((model) => `${model.id} :: ${model.architecture?.modality ?? "unknown modality"}`),
        ],
        risks: [
          "Audio-output models in the free catalog may be music/audio generation, not conversational room narration.",
          "OpenRouter audio output requires a streaming audio-chunk smoke before it can replace TTS.",
        ],
        next: freeAudioOutput.length
          ? "Run a streaming audio-output smoke and verify playable speech before routing narration through this lane."
          : "No free hosted TTS candidate found in the live OpenRouter catalog.",
      },
    ];
  } catch (error) {
    return [{
      id: "openrouter-free-audio-catalog",
      kind: "stt",
      provider: "openrouter",
      status: "fail",
      cost: "free",
      evidence: [`OpenRouter model catalog query failed: ${errorText(error)}`],
      risks: ["Hosted free audio candidates could not be verified against the live catalog."],
      next: "Restore network/OpenRouter access, then rerun this proof loop.",
    }];
  }
}

function isZeroPriced(model: OpenRouterModel): boolean {
  const pricing = model.pricing ?? {};
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
}

function hasModality(model: OpenRouterModel, side: "input" | "output", value: string): boolean {
  const modalities = side === "input"
    ? model.architecture?.input_modalities
    : model.architecture?.output_modalities;
  return Array.isArray(modalities) && modalities.includes(value);
}

function commandHits(names: string[]): string[] {
  return names.flatMap((name) => {
    const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [name], { encoding: "utf8" });
    if (result.status !== 0) return [];
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
  });
}

function pythonImportHits(names: string[]): string[] {
  const python = commandHits(["python", "python3", "py"])[0];
  if (!python) return [];
  return names.flatMap((name) => {
    const result = spawnSync(python, ["-c", `import ${name}`], { encoding: "utf8" });
    return result.status === 0 ? [name] : [];
  });
}

function summarize(items: ProofLane[]): Receipt["summary"] {
  return {
    pass: items.filter((item) => item.status === "pass").length,
    candidate: items.filter((item) => item.status === "candidate").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    fail: items.filter((item) => item.status === "fail").length,
  };
}

function writeReceipt(value: Receipt): void {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const md = renderMarkdown(value);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(latestDir, { recursive: true });
  writeFileSync(resolve(outDir, "receipt.json"), json);
  writeFileSync(resolve(outDir, "scorecard.md"), md);
  writeFileSync(resolve(latestDir, "receipt.json"), json);
  writeFileSync(resolve(latestDir, "scorecard.md"), md);
}

function renderConsole(value: Receipt): string {
  const receiptPath = resolve(outDir, "receipt.json");
  const lines = [
    `voice-free-audio proofloop ${value.runId}`,
    `pass=${value.summary.pass} candidate=${value.summary.candidate} blocked=${value.summary.blocked} fail=${value.summary.fail}`,
    `receipt=${receiptPath}`,
  ];
  for (const lane of value.lanes) {
    lines.push(`${lane.status.toUpperCase().padEnd(9)} ${lane.id} (${lane.kind}/${lane.provider})`);
  }
  return lines.join("\n");
}

function renderMarkdown(value: Receipt): string {
  const lines = [
    "# Voice Free Audio Proofloop",
    "",
    `Run: \`${value.runId}\``,
    "",
    "| Lane | Kind | Provider | Status | Evidence | Next |",
    "|---|---|---|---|---|---|",
  ];
  for (const lane of value.lanes) {
    lines.push(`| \`${lane.id}\` | ${lane.kind} | ${lane.provider} | ${lane.status} | ${lane.evidence.map(escapeTable).join("<br>")} | ${escapeTable(lane.next)} |`);
  }
  lines.push(
    "",
    "## Recommendation",
    "",
    value.gates.productionRecommendation,
    "",
  );
  return `${lines.join("\n")}\n`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
