import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildProofloopHarnessEconomicsLedger,
} from "../src/eval/proofloopHarnessEconomics";
import {
  discoverOpenRouterFreeModels,
  rankOpenRouterFreeModels,
  selectOpenRouterFreeModels,
  type OpenRouterModelInfo,
} from "../src/nodeagent/models/openRouterFreeModels";
import {
  isVoiceClientFreeOnly,
  resolveVoiceClientSttProviderOrder,
  resolveVoiceClientTtsProviderOrder,
} from "../src/voice/providerPolicy";

type CommandReceipt = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, "docs/eval/dev-audience-ready");
const NATIVE_DIR = resolve(ROOT, ".proofloop/agents/native");
const GENERATED_AT = new Date().toISOString();
const subcommand = process.argv[2] ?? "all";

const DEV_ENV = {
  ...process.env,
  PROOFLOOP_GENERIC_AGENT_COMMAND: process.env.PROOFLOOP_GENERIC_AGENT_COMMAND || "node scripts/proofloop-generic-cursor-bridge.mjs",
  PROOFLOOP_CURSOR_DRY_RUN: process.env.PROOFLOOP_CURSOR_DRY_RUN || "1",
  PROOFLOOP_WINDSURF_DRY_RUN: process.env.PROOFLOOP_WINDSURF_DRY_RUN || "1",
  PROOFLOOP_DEVIN_API_DRY_RUN: process.env.PROOFLOOP_DEVIN_API_DRY_RUN || "1",
};

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  if (subcommand === "doctor") return doctor();
  if (subcommand === "agents") return agents();
  if (subcommand === "native-smokes") return nativeSmokes();
  if (subcommand === "router-cost") return routerCost();
  if (subcommand === "docs") return docs();
  if (subcommand === "all") {
    await doctor();
    await agents();
    await nativeSmokes();
    await routerCost();
    await docs();
    return;
  }
  throw new Error(`unknown dev-audience-ready subcommand: ${subcommand}`);
}

async function doctor(): Promise<void> {
  const result = runProofloop(["doctor", "--json"]);
  const parsed = parseJson<Record<string, unknown>>(result.stdout);
  writeJson("doctor.json", parsed ?? { parseError: "doctor stdout was not JSON", stdout: result.stdout });
  const status = parsed?.status === "fail" || result.exitCode !== 0 ? "fail" : "pass";
  writeJson("doctor-receipt.json", {
    schema: "proofloop-dev-audience-doctor-receipt-v1",
    generatedAt: GENERATED_AT,
    status,
    command: result.command,
    exitCode: result.exitCode,
    doctorStatus: parsed?.status,
    evidence: ["docs/eval/dev-audience-ready/doctor.json"],
    stderrTail: tail(result.stderr),
  });
  assertPass(status, "doctor failed");
  console.log(`dev-audience doctor: ${status}`);
}

async function agents(): Promise<void> {
  const result = runProofloop(["agents", "setup", "all", "--local", "--strict"], DEV_ENV);
  const expected = ["codex", "claude-code", "cursor", "windsurf", "devin", "generic-cli"];
  const receipts = expected.map((id) => readJson<Record<string, unknown>>(`.proofloop/setup/agents/${id}.json`));
  const statuses = Object.fromEntries(expected.map((id, index) => [id, receipts[index]?.status ?? "missing"]));
  const status = result.exitCode === 0 && Object.values(statuses).every((value) => value === "ready") ? "pass" : "fail";
  writeJson("agents-setup-receipt.json", {
    schema: "proofloop-dev-audience-agent-setup-receipt-v1",
    generatedAt: GENERATED_AT,
    status,
    command: result.command,
    exitCode: result.exitCode,
    adapterStatuses: statuses,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    evidence: expected.map((id) => `.proofloop/setup/agents/${id}.json`),
  });
  assertPass(status, "agent setup did not produce all ready receipts");
  console.log(`dev-audience agents: ${status}`);
}

async function nativeSmokes(): Promise<void> {
  mkdirSync(NATIVE_DIR, { recursive: true });
  const promptPath = join(NATIVE_DIR, "dev-audience-ready-smoke-prompt.md");
  const promptSafeRel = ".proofloop/agents/native/dev-audience-ready-smoke-prompt-no-spaces.md";
  const promptSafePath = resolve(ROOT, promptSafeRel);
  writeFileSync(promptPath, "Reply exactly: proofloop dev audience native smoke ok\nDo not edit files.\n", "utf8");
  writeFileSync(promptSafePath, "Reply exactly: proofloop dev audience native smoke ok\nDo not edit files.\n", "utf8");
  const workerRel = ".proofloop/agents/native/dev-audience-ready-generic-worker.mjs";
  const workerPath = join(NATIVE_DIR, "dev-audience-ready-generic-worker.mjs");
  writeFileSync(workerPath, [
    "import { readFileSync } from 'node:fs';",
    "let prompt = readFileSync(0, 'utf8');",
    "if (!prompt && process.env.PROOFLOOP_REPAIR_PROMPT) prompt = readFileSync(process.env.PROOFLOOP_REPAIR_PROMPT, 'utf8');",
    "if (!prompt.includes('dev audience native smoke')) process.exit(3);",
    "console.log('proofloop dev audience native smoke ok');",
  ].join("\n"), "utf8");

  const hosts = [
    {
      id: "cursor",
      runDir: ".proofloop/agents/native/dev-audience-ready-cursor",
      env: { ...DEV_ENV, PROOFLOOP_CURSOR_DRY_RUN: "1" },
    },
    {
      id: "windsurf",
      runDir: ".proofloop/agents/native/dev-audience-ready-windsurf",
      env: { ...DEV_ENV, PROOFLOOP_WINDSURF_DRY_RUN: "1" },
    },
    {
      id: "devin-api",
      runDir: ".proofloop/agents/native/dev-audience-ready-devin-api",
      env: { ...DEV_ENV, PROOFLOOP_DEVIN_API_DRY_RUN: "1" },
    },
    {
      id: "generic-cli",
      runDir: ".proofloop/agents/native/dev-audience-ready-generic-cli",
      env: {
        ...DEV_ENV,
        PROOFLOOP_GENERIC_AGENT_COMMAND: "node scripts/proofloop-generic-cursor-bridge.mjs",
        PROOFLOOP_GENERIC_BRIDGE_COMMAND: `node ${workerRel}`,
      },
    },
  ];

  const hostReceipts = [];
  for (const host of hosts) {
    const launch = runProofloop(["agents", "launch", host.id, "--prompt", promptSafeRel, "--run-dir", host.runDir], host.env);
    const collect = runProofloop(["agents", "collect", host.id, "--run-dir", host.runDir, "--strict"], host.env);
    const launchReceipt = readJson<Record<string, unknown>>(join(host.runDir, `${host.id}-native-launch.json`));
    const sessionReceipt = readJson<Record<string, unknown>>(join(host.runDir, `${host.id}-native-session-export.json`));
    hostReceipts.push({
      hostId: host.id,
      status: launch.exitCode === 0 && collect.exitCode === 0 && launchReceipt?.status === "launch_ready" && sessionReceipt?.status === "trace_ready" ? "pass" : "fail",
      launch: commandSummary(launch),
      collect: commandSummary(collect),
      launchReceipt: join(host.runDir, `${host.id}-native-launch.json`).replaceAll("\\", "/"),
      sessionReceipt: join(host.runDir, `${host.id}-native-session-export.json`).replaceAll("\\", "/"),
    });
  }

  const status = hostReceipts.every((host) => host.status === "pass") ? "pass" : "fail";
  writeJson("native-smokes-receipt.json", {
    schema: "proofloop-dev-audience-native-smokes-receipt-v1",
    generatedAt: GENERATED_AT,
    status,
    promptSha256: sha256(readFileSync(promptPath)),
    paidModelCalls: false,
    hosts: hostReceipts,
  });
  assertPass(status, "native dry-run/session smokes failed");
  console.log(`dev-audience native-smokes: ${status}`);
}

async function routerCost(): Promise<void> {
  const liveModels = await fetchOpenRouterFreeModels();
  const rankedLive = rankOpenRouterFreeModels(liveModels.models, "agent").slice(0, 8);
  const selected = await selectOpenRouterFreeModels({ mode: "agent", limit: 8, forceRefresh: true, env: process.env });
  const gauge = readJson<{ summary?: { estimatedCostUsd?: number; passed?: number }; rows?: Array<{ modelId?: string; status?: string; estimatedCostUsd?: number }> }>(
    "docs/eval/proofloop-free-openrouter-nodeagent-gauge.json",
  );
  const discovery = readJson<{ models?: Array<{ id?: string; supportsTools?: boolean }> }>("docs/eval/openrouter-free-model-discovery.json");
  const economics = buildProofloopHarnessEconomicsLedger({ root: ROOT, generatedAt: GENERATED_AT });
  const spendingFlags = {
    FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION: envFlag(process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION),
    VOICE_ALLOW_PAID_FALLBACK: envFlag(process.env.VOICE_ALLOW_PAID_FALLBACK),
    VITE_VOICE_TTS_ALLOW_HOSTED_IN_FREE_ONLY: envFlag(process.env.VITE_VOICE_TTS_ALLOW_HOSTED_IN_FREE_ONLY),
  };
  const checks = [
    { id: "live-free-models-available", pass: selected.length > 0 },
    { id: "live-free-models-zero-priced", pass: selected.every(isZeroPriced) },
    { id: "free-gauge-zero-cost", pass: (gauge?.summary?.estimatedCostUsd ?? 1) === 0 },
    { id: "free-gauge-has-passing-route", pass: (gauge?.summary?.passed ?? 0) > 0 },
    { id: "discovery-has-tool-routes", pass: (discovery?.models ?? []).some((model) => model.supportsTools) },
    { id: "voice-stt-free-local-fallback-visible", pass: resolveVoiceClientSttProviderOrder({ VITE_VOICE_STT_PROVIDER_ORDER: "browser,provider" })[0] === "browser" },
    { id: "voice-tts-browser-first", pass: resolveVoiceClientTtsProviderOrder({})[0] === "browser" },
    { id: "voice-free-only-flag-parses", pass: isVoiceClientFreeOnly({ VITE_NODEROOM_FREE_ONLY: "1" }) },
    { id: "paid-file-egress-promotion-off", pass: !spendingFlags.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION },
    { id: "voice-paid-fallback-off", pass: !spendingFlags.VOICE_ALLOW_PAID_FALLBACK },
    { id: "official-score-boundaries-preserved", pass: economics.officialScoreBoundaries.every((item) => item.proxyJudgeCannotClaimOfficialScore) },
  ];
  const status = checks.every((check) => check.pass) ? "pass" : "fail";
  writeJson("free-first-router-cost-receipt.json", {
    schema: "proofloop-dev-audience-free-first-router-cost-receipt-v1",
    generatedAt: GENERATED_AT,
    status,
    liveOpenRouterFetch: liveModels.source,
    selectedFreeAutoRoutes: selected.map((model) => routeSummary(model)),
    rankedLiveFreeRoutes: rankedLive.map((model) => routeSummary(model)),
    spendingFlags,
    checks,
    policy: [
      "Default dev-audience proof must not run paid provider workloads.",
      "openrouter/free-auto and browser/local voice paths are checked before paid routes.",
      "Proxy/free routes can support product iteration but cannot become official benchmark score claims without accepted scorer receipts.",
    ],
  });
  assertPass(status, `free-first router guard failed: ${checks.filter((check) => !check.pass).map((check) => check.id).join(", ")}`);
  console.log(`dev-audience router-cost: ${status}`);
}

async function docs(): Promise<void> {
  const receipts = [
    "doctor-receipt.json",
    "agents-setup-receipt.json",
    "native-smokes-receipt.json",
    "free-first-router-cost-receipt.json",
  ].map((name) => readJson<{ status?: string }>(`docs/eval/dev-audience-ready/${name}`));
  const status = receipts.every((receipt) => receipt?.status === "pass") ? "pass" : "pending";
  const body = [
    "# Dev Audience Ready",
    "",
    `Generated: ${GENERATED_AT}`,
    `Status: ${status}`,
    "",
    "This proof is for intended developers and customer technical evaluators. It is separate from official benchmark score claims.",
    "",
    "## What This Proves",
    "",
    "- Local ProofLoop doctor can run.",
    "- Codex, Claude Code, Cursor, Windsurf, Devin, and generic CLI setup receipts can be generated.",
    "- Native launch/session-export plumbing works using dry-run or local fake workers, without paid model calls.",
    "- Free-first route policy is active and paid fallback flags are not enabled by default.",
    "",
    "## Customer Smoke",
    "",
    "```bash",
    "npm run proofloop -- goal init dev-audience-ready --template dev-audience-ready",
    "npm run proofloop -- supervise --goal dev-audience-ready",
    "npm run proofloop -- gate --goal dev-audience-ready",
    "```",
    "",
    "## Official Scores",
    "",
    "This goal does not prove SpreadsheetBench, Finch, FinAuditing, or WorkstreamBench official scores. Those still require full task/model/scorer receipts in the `official-scores` goal.",
    "",
  ].join("\n");
  writeText("README.md", body);
  writeText("../DEV_AUDIENCE_READY.md", body);
  console.log(`dev-audience docs: ${status}`);
}

async function fetchOpenRouterFreeModels(): Promise<{ source: "live" | "fallback"; models: OpenRouterModelInfo[] }> {
  try {
    const res = await fetch(`${process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"}/models?output_modalities=text`);
    if (!res.ok) throw new Error(`OpenRouter model fetch failed: ${res.status}`);
    const json = await res.json() as { data?: OpenRouterModelInfo[] };
    const free = (json.data ?? []).filter((model) => isZeroPriced(model));
    if (!free.length) throw new Error("OpenRouter live model fetch returned no zero-priced text models");
    return { source: "live", models: free };
  } catch {
    return { source: "fallback", models: await discoverOpenRouterFreeModels({ forceRefresh: true }) };
  }
}

function runProofloop(args: string[], env: NodeJS.ProcessEnv = process.env): CommandReceipt {
  const result = spawnSync(process.execPath, ["scripts/proofloop.mjs", ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    command: `node scripts/proofloop.mjs ${args.join(" ")}`,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error instanceof Error ? result.error.message : ""),
  };
}

function commandSummary(receipt: CommandReceipt): Omit<CommandReceipt, "stdout" | "stderr"> & { stdoutTail: string; stderrTail: string } {
  return {
    command: receipt.command,
    exitCode: receipt.exitCode,
    stdoutTail: tail(receipt.stdout),
    stderrTail: tail(receipt.stderr),
  };
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const target = resolve(OUT_DIR, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

function readJson<T>(path: string): T | undefined {
  const target = resolve(ROOT, path);
  if (!existsSync(target)) return undefined;
  try {
    return JSON.parse(readFileSync(target, "utf8")) as T;
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

function assertPass(status: string, message: string): void {
  if (status !== "pass") {
    throw new Error(message);
  }
}

function routeSummary(model: OpenRouterModelInfo & { score?: number; reasons?: string[] }) {
  return {
    id: model.id,
    name: model.name,
    contextLength: model.context_length ?? model.top_provider?.context_length,
    score: model.score,
    supportsTools: model.supported_parameters?.includes("tools") ?? false,
    supportsToolChoice: model.supported_parameters?.includes("tool_choice") ?? false,
    supportsStructuredOutputs: model.supported_parameters?.includes("structured_outputs") ?? false,
    promptPrice: model.pricing?.prompt,
    completionPrice: model.pricing?.completion,
    reasons: model.reasons,
  };
}

function isZeroPriced(model: OpenRouterModelInfo): boolean {
  return Number(model.pricing?.prompt ?? 0) === 0 && Number(model.pricing?.completion ?? 0) === 0;
}

function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function tail(value: string, max = 4_000): string {
  return value.length <= max ? value : value.slice(value.length - max);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
