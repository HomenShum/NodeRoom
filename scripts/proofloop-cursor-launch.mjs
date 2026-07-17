#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const promptPath = optionValue(args, "--prompt-file");
const exportPath = optionValue(args, "--export");
const runDir = optionValue(args, "--run-dir") ?? process.env.PROOFLOOP_AGENT_RUN_DIR;

if (!promptPath || !exportPath) {
  console.error("usage: proofloop-cursor-launch --prompt-file <file> --export <file> [--run-dir <dir>]");
  process.exit(2);
}
if (!existsSync(promptPath)) {
  console.error(`prompt file missing: ${promptPath}`);
  process.exit(2);
}

const prompt = readFileSync(promptPath, "utf8");
if (process.env.PROOFLOOP_CURSOR_DRY_RUN === "1") {
  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, `${JSON.stringify({
    schema: "proofloop-cursor-session-export-v1",
    host: "cursor",
    dryRun: true,
    startedAt,
    finishedAt,
    runDir,
    promptPath,
    command: "dry-run cursor-agent -p --trust --output-format text <prompt>",
    exitCode: 0,
    stdout: "dry-run cursor native launch ok\n",
    stderr: "",
  }, null, 2)}\n`, "utf8");
  process.stdout.write("dry-run cursor native launch ok\n");
  process.exit(0);
}
const binary = process.env.PROOFLOOP_CURSOR_BINARY || findBinary(["cursor-agent", "cursor"]);
if (!binary) {
  console.error("Cursor CLI not found. Install Cursor CLI or set PROOFLOOP_CURSOR_COMMAND/PROOFLOOP_CURSOR_BINARY.");
  process.exit(2);
}

const extraArgs = splitArgs(process.env.PROOFLOOP_CURSOR_EXTRA_ARGS);
const modelArgs = process.env.PROOFLOOP_CURSOR_MODEL ? ["--model", process.env.PROOFLOOP_CURSOR_MODEL] : [];
const commonArgs = ["-p", "--trust", "--output-format", "text", ...modelArgs, ...extraArgs, prompt];
const launch = binary === "cursor"
  ? { cmd: binary, args: ["agent", ...commonArgs] }
  : { cmd: binary, args: commonArgs };
const startedAt = new Date().toISOString();
const result = spawnSync(launch.cmd, launch.args, {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
  shell: process.platform === "win32",
});
const finishedAt = new Date().toISOString();
const spawnError = result.error instanceof Error ? result.error.message : undefined;
const stderr = [result.stderr ?? "", spawnError ? `spawn error: ${spawnError}\n` : ""].join("");
mkdirSync(dirname(exportPath), { recursive: true });
writeFileSync(exportPath, `${JSON.stringify({
  schema: "proofloop-cursor-session-export-v1",
  host: "cursor",
  startedAt,
  finishedAt,
  runDir,
  promptPath,
  command: `${launch.cmd} ${launch.args.slice(0, -1).join(" ")} <prompt>`,
  exitCode: result.status ?? 1,
  stdout: result.stdout ?? "",
  stderr,
  ...(spawnError ? { spawnError } : {}),
}, null, 2)}\n`, "utf8");
process.stdout.write(result.stdout ?? "");
process.stderr.write(stderr);
process.exit(result.status ?? 1);

function optionValue(values, name) {
  const inline = values.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = values.indexOf(name);
  const next = values[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
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
