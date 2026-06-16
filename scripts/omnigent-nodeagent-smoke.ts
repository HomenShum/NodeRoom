import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  analyzeNodeAgentOmnigentSpec,
  NODEAGENT_OMNIGENT_SPEC_TARGETS,
  summarizeNodeAgentOmnigentAnalysis,
} from "../src/nodeagent/skills/integration/omnigentAdapter";
import { runMinimalNodeAgentFrameSmoke } from "../examples/nodeagent-frame-runner/minimal";

interface CliStatus {
  checked: boolean;
  command?: "omni" | "omnigent";
  installed: boolean;
}

function argValue(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function commandExists(command: string) {
  const check = process.platform === "win32"
    ? spawnSync("where.exe", [command], { encoding: "utf8" })
    : spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return check.status === 0;
}

function detectOmnigentCli(): CliStatus {
  if (commandExists("omni")) return { checked: true, command: "omni", installed: true };
  if (commandExists("omnigent")) return { checked: true, command: "omnigent", installed: true };
  return { checked: true, installed: false };
}

function ensureParent(path: string) {
  const parent = dirname(path);
  if (parent && parent !== "." && !existsSync(parent)) {
    throw new Error(`Parent directory does not exist: ${parent}`);
  }
}

async function main() {
  const jsonOut = argValue("--json-out");
  const requireCli = hasFlag("--require-omni-cli");
  const skipFrameSmoke = hasFlag("--skip-frame-smoke");
  const analyses = NODEAGENT_OMNIGENT_SPEC_TARGETS.map((target) => {
    const text = readFileSync(target.path, "utf8");
    return analyzeNodeAgentOmnigentSpec({ path: target.path, profile: target.profile, text });
  });
  const cli = detectOmnigentCli();
  const frameSmoke = skipFrameSmoke ? undefined : await runMinimalNodeAgentFrameSmoke();
  const ok = analyses.every((analysis) => analysis.ok)
    && (skipFrameSmoke || frameSmoke?.ok === true)
    && (!requireCli || cli.installed);
  const report = {
    ok,
    omnigent: {
      cli,
      runCommands: analyses.map((analysis) => ({
        path: analysis.path,
        preferred: analysis.runCommand,
        legacy: analysis.legacyRunCommand,
      })),
    },
    specs: analyses,
    nodeagentFrameSmoke: frameSmoke ? {
      ok: frameSmoke.ok,
      frameId: frameSmoke.frameId,
      status: frameSmoke.status,
      stopReason: frameSmoke.stopReason,
      traceTools: frameSmoke.traceTools,
      finalCellValue: frameSmoke.finalCellValue,
    } : undefined,
  };

  for (const analysis of analyses) {
    console.log(summarizeNodeAgentOmnigentAnalysis(analysis));
    for (const issue of analysis.issues) console.log(`  issue: ${issue}`);
  }
  if (frameSmoke) {
    console.log(`nodeagent frame smoke: ${frameSmoke.ok ? "PASS" : "FAIL"} frame=${frameSmoke.frameId} status=${frameSmoke.status}`);
  }
  console.log(cli.installed
    ? `omnigent cli: found ${cli.command}`
    : "omnigent cli: not installed locally; install Omnigent and run `omni run examples/omnigent/nodeagent-room.yaml` for the outer harness live check");

  if (jsonOut) {
    ensureParent(jsonOut);
    writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (!ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
