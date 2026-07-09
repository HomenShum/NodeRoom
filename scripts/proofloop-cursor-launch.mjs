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
const binary = process.env.PROOFLOOP_CURSOR_BINARY || findBinary(["cursor-agent", "cursor"]);
if (!binary) {
  console.error("Cursor CLI not found. Install Cursor CLI or set PROOFLOOP_CURSOR_COMMAND/PROOFLOOP_CURSOR_BINARY.");
  process.exit(2);
}

const launch = binary === "cursor"
  ? { cmd: binary, args: ["agent", "-p", "--output-format", "text", prompt] }
  : { cmd: binary, args: ["-p", "--output-format", "text", prompt] };
const startedAt = new Date().toISOString();
const result = spawnSync(launch.cmd, launch.args, {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
const finishedAt = new Date().toISOString();
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
  stderr: result.stderr ?? "",
}, null, 2)}\n`, "utf8");
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
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
