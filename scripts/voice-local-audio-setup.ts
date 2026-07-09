import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type SetupStep = {
  id: string;
  status: "pass" | "fail";
  evidence: string[];
};

type SetupReceipt = {
  schema: "voice-local-audio-setup-v1";
  createdAt: string;
  runId: string;
  envDir: string;
  modelDir: string;
  packages: string[];
  steps: SetupStep[];
  summary: { pass: number; fail: number };
};

const ENV_DIR = resolve(process.env.VOICE_LOCAL_AUDIO_ENV ?? ".tmp/voice-local-env");
const MODEL_DIR = resolve(process.env.VOICE_LOCAL_MODEL_ROOT ?? ".tmp/voice-local-models");
const PYTHON = resolve(ENV_DIR, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const ROOT_PYTHON = process.env.PYTHON ?? "python";
const PACKAGES = ["faster-whisper==1.2.1", "piper-tts==1.4.2"];
const PIPER_VOICE_DIR = resolve(MODEL_DIR, "piper", "en_US-amy-low");
const PIPER_FILES = [
  {
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx",
    path: resolve(PIPER_VOICE_DIR, "en_US-amy-low.onnx"),
  },
  {
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx.json",
    path: resolve(PIPER_VOICE_DIR, "en_US-amy-low.onnx.json"),
  },
];
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const OUT_ROOT = resolve(".proofloop", "runs", "voice-local-audio-setup");
const OUT_DIR = resolve(OUT_ROOT, RUN_ID);
const LATEST_DIR = resolve(OUT_ROOT, "latest");

const steps: SetupStep[] = [];
steps.push(ensureVenv());
if (steps.at(-1)?.status === "pass") steps.push(installPackages());
if (steps.at(-1)?.status === "pass") steps.push(await downloadPiperVoice());
steps.push(verifyInstall());

const receipt: SetupReceipt = {
  schema: "voice-local-audio-setup-v1",
  createdAt: new Date().toISOString(),
  runId: RUN_ID,
  envDir: ENV_DIR,
  modelDir: MODEL_DIR,
  packages: PACKAGES,
  steps,
  summary: {
    pass: steps.filter((step) => step.status === "pass").length,
    fail: steps.filter((step) => step.status === "fail").length,
  },
};

writeReceipt(receipt);
console.log(renderConsole(receipt));
if (receipt.summary.fail > 0) process.exitCode = 1;

function ensureVenv(): SetupStep {
  if (existsSync(PYTHON)) return { id: "venv", status: "pass", evidence: [`python: ${PYTHON}`] };
  mkdirSync(ENV_DIR, { recursive: true });
  const result = spawnSync(ROOT_PYTHON, ["-m", "venv", ENV_DIR], { encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) return { id: "venv", status: "fail", evidence: [compact(result.stderr || result.stdout)] };
  return { id: "venv", status: "pass", evidence: [`created: ${ENV_DIR}`] };
}

function installPackages(): SetupStep {
  const upgrade = spawnSync(PYTHON, ["-m", "pip", "install", "--upgrade", "pip"], { encoding: "utf8", timeout: 180_000 });
  if (upgrade.status !== 0) return { id: "packages", status: "fail", evidence: [`pip upgrade failed: ${compact(upgrade.stderr || upgrade.stdout)}`] };
  const install = spawnSync(PYTHON, ["-m", "pip", "install", ...PACKAGES], { encoding: "utf8", timeout: 600_000 });
  if (install.status !== 0) return { id: "packages", status: "fail", evidence: [`pip install failed: ${compact(install.stderr || install.stdout)}`] };
  return { id: "packages", status: "pass", evidence: PACKAGES };
}

async function downloadPiperVoice(): Promise<SetupStep> {
  mkdirSync(PIPER_VOICE_DIR, { recursive: true });
  const evidence: string[] = [];
  for (const file of PIPER_FILES) {
    if (!existsSync(file.path)) {
      const response = await fetch(file.url);
      if (!response.ok) return { id: "piper-voice", status: "fail", evidence: [`${file.url} -> ${response.status} ${await response.text()}`] };
      writeFileSync(file.path, Buffer.from(await response.arrayBuffer()));
    }
    evidence.push(`${file.path} bytes=${statSync(file.path).size} sha256=${sha256File(file.path)}`);
  }
  return { id: "piper-voice", status: "pass", evidence };
}

function verifyInstall(): SetupStep {
  if (!existsSync(PYTHON)) return { id: "verify", status: "fail", evidence: [`missing python: ${PYTHON}`] };
  const result = spawnSync(PYTHON, ["-c", "import faster_whisper, piper; print('ok')"], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) return { id: "verify", status: "fail", evidence: [compact(result.stderr || result.stdout)] };
  return { id: "verify", status: "pass", evidence: ["imports: faster_whisper, piper"] };
}

function writeReceipt(value: SetupReceipt): void {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LATEST_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "receipt.json"), json);
  writeFileSync(resolve(LATEST_DIR, "receipt.json"), json);
}

function renderConsole(value: SetupReceipt): string {
  return [
    `voice-local-audio setup ${value.runId}`,
    `pass=${value.summary.pass} fail=${value.summary.fail}`,
    `receipt=${resolve(OUT_DIR, "receipt.json")}`,
    ...value.steps.map((step) => `${step.status.toUpperCase().padEnd(4)} ${step.id}`),
  ].join("\n");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
