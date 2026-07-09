#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const promptPath = optionValue(args, "--prompt-file");
const exportPath = optionValue(args, "--export");
const runDir = optionValue(args, "--run-dir") ?? process.env.PROOFLOOP_AGENT_RUN_DIR;

if (!promptPath || !exportPath) {
  console.error("usage: proofloop-windsurf-launch --prompt-file <file> --export <file> [--run-dir <dir>]");
  process.exit(2);
}
if (!existsSync(promptPath)) {
  console.error(`prompt file missing: ${promptPath}`);
  process.exit(2);
}

const prompt = readFileSync(promptPath, "utf8");
const startedAt = new Date().toISOString();
const launch = process.env.PROOFLOOP_WINDSURF_DRY_RUN === "1"
  ? dryRunLaunch()
  : launchWindsurfChat(prompt);
const finishedAt = new Date().toISOString();
const spawnError = launch.result.error instanceof Error ? launch.result.error.message : undefined;
const exitCode = launch.result.status ?? (spawnError ? 1 : 0);
const stderr = [launch.result.stderr ?? "", spawnError ? `spawn error: ${spawnError}\n` : ""].join("");

mkdirSync(dirname(exportPath), { recursive: true });
writeFileSync(exportPath, `${JSON.stringify({
  schema: "proofloop-windsurf-chat-launch-export-v1",
  host: "windsurf",
  exportKind: "prompt_handoff",
  generatedAt: finishedAt,
  startedAt,
  finishedAt,
  runDir,
  promptPath,
  promptSha256: createHash("sha256").update(prompt).digest("hex"),
  promptBytes: Buffer.byteLength(prompt),
  mode: launch.mode,
  command: launch.commandForTrace,
  exitCode,
  stdout: launch.result.stdout ?? "",
  stderr,
  limitations: [
    "Windsurf chat CLI accepts a prompt and opens/runs Cascade in the editor UI.",
    "This CLI does not currently emit a completed Cascade transcript on stdout.",
    "For final certification evidence, collect an exported Cascade transcript with proofloop agents collect windsurf --session <transcript.jsonl>.",
  ],
  ...(spawnError ? { spawnError } : {}),
}, null, 2)}\n`, "utf8");

process.stdout.write(launch.result.stdout ?? "");
process.stderr.write(stderr);
process.exit(exitCode);

function launchWindsurfChat(promptText) {
  const binary = process.env.PROOFLOOP_WINDSURF_BINARY || findWindsurfBinary();
  if (!binary) {
    return {
      mode: process.env.PROOFLOOP_WINDSURF_MODE || "agent",
      commandForTrace: "windsurf-next chat --mode agent <prompt>",
      result: {
        status: 2,
        stdout: "",
        stderr: "Windsurf CLI not found. Install Windsurf/Windsurf Next or set PROOFLOOP_WINDSURF_BINARY.\n",
      },
    };
  }
  const mode = process.env.PROOFLOOP_WINDSURF_MODE || "agent";
  const extraArgs = splitArgs(process.env.PROOFLOOP_WINDSURF_EXTRA_ARGS || "--reuse-window");
  const launchArgs = ["chat", "--mode", mode, ...extraArgs, promptText];
  return {
    mode,
    commandForTrace: `${binary} ${launchArgs.slice(0, -1).join(" ")} <prompt>`,
    result: spawnSync(binary, launchArgs, {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: process.env,
    }),
  };
}

function dryRunLaunch() {
  return {
    mode: process.env.PROOFLOOP_WINDSURF_MODE || "agent",
    commandForTrace: "dry-run windsurf chat <prompt>",
    result: {
      status: 0,
      stdout: "dry-run windsurf chat launched\n",
      stderr: "",
    },
  };
}

function findWindsurfBinary() {
  const pathBinary = findBinary(["windsurf-next", "windsurf", "codeium"]);
  if (pathBinary) return pathBinary;
  if (process.platform !== "win32") return undefined;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const candidates = [
    join(localAppData, "Programs", "Windsurf Next", "bin", "windsurf-next.cmd"),
    join(localAppData, "Programs", "Windsurf", "bin", "windsurf.cmd"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function findBinary(candidates) {
  for (const candidate of candidates) {
    const check = spawnSync(process.platform === "win32" ? "where.exe" : "which", [candidate], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if ((check.status ?? 1) === 0) return candidate;
  }
  return undefined;
}

function optionValue(values, name) {
  const inline = values.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = values.indexOf(name);
  const next = values[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function splitArgs(value) {
  if (!value?.trim()) return [];
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}
