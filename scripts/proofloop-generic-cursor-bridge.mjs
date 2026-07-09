#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const prompt = readFileSync(0, "utf8");
const promptPath = process.env.PROOFLOOP_REPAIR_PROMPT;
const runDir = process.env.PROOFLOOP_AGENT_RUN_DIR || (promptPath ? dirname(promptPath) : process.cwd());
const tracePath = process.env.PROOFLOOP_AGENT_SESSION_EXPORT || join(runDir, "generic-cli-trace.json");
const configuredCommand = process.env.PROOFLOOP_GENERIC_BRIDGE_COMMAND?.trim();
const startedAt = new Date().toISOString();

const launch = configuredCommand
  ? launchConfiguredCommand(configuredCommand, prompt, promptPath, tracePath)
  : launchCursorAgent(prompt);

const finishedAt = new Date().toISOString();
const spawnError = launch.result.error instanceof Error ? launch.result.error.message : undefined;
const exitCode = launch.result.status ?? (spawnError ? 1 : 0);
const stderr = [launch.result.stderr ?? "", spawnError ? `spawn error: ${spawnError}\n` : ""].join("");

mkdirSync(dirname(tracePath), { recursive: true });
writeFileSync(tracePath, `${JSON.stringify({
  schema: "proofloop-generic-cli-bridge-trace-v1",
  adapter: "generic-cli",
  delegate: launch.delegate,
  command: launch.commandForTrace,
  startedAt,
  finishedAt,
  promptPath,
  promptSha256: createHash("sha256").update(prompt).digest("hex"),
  promptBytes: Buffer.byteLength(prompt),
  exitCode,
  stdout: launch.result.stdout ?? "",
  stderr,
  ...(spawnError ? { spawnError } : {}),
}, null, 2)}\n`, "utf8");

process.stdout.write(launch.result.stdout ?? "");
process.stderr.write(stderr);
process.exit(exitCode);

function launchConfiguredCommand(command, promptText, repairPromptPath, exportPath) {
  const filled = command
    .replaceAll("{promptPath}", shellQuote(repairPromptPath ?? ""))
    .replaceAll("{tracePath}", shellQuote(exportPath))
    .replaceAll("{prompt}", shellQuote(promptText));
  return {
    delegate: "configured-command",
    commandForTrace: command.includes("{prompt}") ? command.replaceAll("{prompt}", "<prompt>") : command,
    result: spawnSync(filled, {
      cwd: process.cwd(),
      shell: true,
      input: promptText,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      env: process.env,
    }),
  };
}

function launchCursorAgent(promptText) {
  const binary = process.env.PROOFLOOP_GENERIC_BRIDGE_BINARY || findBinary(["cursor-agent", "cursor"]);
  if (!binary) {
    return {
      delegate: "cursor-agent",
      commandForTrace: "cursor-agent -p --trust --output-format text <prompt>",
      result: {
        status: 2,
        stdout: "",
        stderr: "Cursor CLI not found. Install Cursor CLI or set PROOFLOOP_GENERIC_BRIDGE_COMMAND/PROOFLOOP_GENERIC_BRIDGE_BINARY.\n",
      },
    };
  }
  const modelArgs = process.env.PROOFLOOP_CURSOR_MODEL ? ["--model", process.env.PROOFLOOP_CURSOR_MODEL] : [];
  const extraArgs = splitArgs(process.env.PROOFLOOP_CURSOR_EXTRA_ARGS);
  const commonArgs = ["-p", "--trust", "--output-format", "text", ...modelArgs, ...extraArgs, promptText];
  const launch = binary === "cursor"
    ? { cmd: binary, args: ["agent", ...commonArgs] }
    : { cmd: binary, args: commonArgs };
  return {
    delegate: "cursor-agent",
    commandForTrace: `${launch.cmd} ${launch.args.slice(0, -1).join(" ")} <prompt>`,
    result: spawnSync(launch.cmd, launch.args, {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: process.env,
    }),
  };
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

function splitArgs(value) {
  if (!value?.trim()) return [];
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}

function shellQuote(value) {
  if (process.platform === "win32") return `"${String(value).replaceAll('"', '\\"')}"`;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
