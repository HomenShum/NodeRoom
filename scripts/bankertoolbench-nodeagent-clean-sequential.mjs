import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const prefix = args.jobNamePrefix ?? "btb-clean-capability-full100-parallel-v3-gpt41mini";
const modelId = args.modelId ?? "gpt-4.1-mini";
const candidateModel = args.candidateModel ?? "noderoom/nodeagent-general";
const convexRepo = args.convexRepo ?? "D:\\VSCode Projects\\cafecorner_nodebench\\nodebench_ai4\\nodebench-ai";
const summaryOut = args.summaryOut ?? `docs/eval/${prefix}.json`;
const maxSteps = args.maxSteps ?? "6";
const plannerDeadlineMs = args.plannerDeadlineMs ?? "180000";
const runnerTimeoutSec = args.runnerTimeoutSec ?? "600";
const cooldownMs = Number(args.cooldownMs ?? "30000");
const btbRepoRoot = process.env.BTB_REPO_ROOT ?? join(repoRoot, ".tmp", "official-benchmarks", "bankertoolbench-repo");
const taskRoot = join(btbRepoRoot, "datasets", "btb");
const runRoot = process.env.BTB_RUN_ROOT ?? join(repoRoot, ".tmp", "btb-runs");
const taskSummaryDir = join(runRoot, "parallel-summaries", prefix);
const taskLogDir = join(runRoot, "parallel-logs", prefix);
const jobRoot = join(runRoot, "jobs");
const archiveRoot = join(runRoot, "repair-archive", `${prefix}-node-seq-${timestamp()}`);
const controllerLog = args.controllerLog ?? join(runRoot, "logs", `${prefix}.node-sequential.log`);

mkdirSync(taskSummaryDir, { recursive: true });
mkdirSync(taskLogDir, { recursive: true });
mkdirSync(join(runRoot, "logs"), { recursive: true });
mkdirSync(archiveRoot, { recursive: true });

const allTasks = readdirSync(taskRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("btb-"))
  .map((entry) => entry.name)
  .sort();
const selectedTasks = selectTasks(allTasks, args);

log(`NODE_SEQ_START tasks=${selectedTasks.length} prefix=${prefix} model=${modelId}`);
log(`NODE_SEQ_ARCHIVE_ROOT ${archiveRoot}`);

const secretEnv = args.secretPreflight
  ? await loadConvexSecrets(["OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "HF_TOKEN"])
  : {};
if (args.secretPreflight) {
  const requiredSecrets = requiredSecretNames(modelId);
  const unavailableRequiredSecrets = requiredSecrets.filter((name) => !secretEnv[name]?.trim());
  if (unavailableRequiredSecrets.length > 0) {
    log(`NODE_SEQ_SECRET_REQUIRED_MISSING names=${unavailableRequiredSecrets.join(",")}`);
    process.exit(3);
  }
} else {
  log("NODE_SEQ_SECRET_PREFLIGHT skipped=child_loader");
}

let attempted = 0;
let clean = 0;
let nonClean = 0;
let failed = 0;

for (const taskId of selectedTasks) {
  const existing = readTaskSummary(taskId);
  if (existing?.cleanCapabilityAccepted === true) {
    clean += 1;
    log(`NODE_SEQ_SKIP_CLEAN task=${taskId} reward=${existing.reward ?? ""}`);
    continue;
  }

  archiveTaskArtifacts(taskId);
  attempted += 1;
  const exitCode = await runTask(taskId);
  const updated = readTaskSummary(taskId);
  if (updated?.cleanCapabilityAccepted === true) {
    clean += 1;
  } else {
    nonClean += 1;
  }
  if (exitCode !== 0) failed += 1;
  log([
    `NODE_SEQ_TASK_DONE task=${taskId}`,
    `exit=${exitCode}`,
    `status=${updated?.status ?? "missing"}`,
    `clean=${updated?.cleanCapabilityAccepted ?? false}`,
    `reward=${updated?.reward ?? ""}`,
    `reasons=${(updated?.cleanCapabilityRejectionReasons ?? []).join("|")}`,
  ].join(" "));

  if (args.stopOnNonClean && updated?.cleanCapabilityAccepted !== true) {
    log(`NODE_SEQ_STOP_NON_CLEAN task=${taskId}`);
    process.exitCode = 2;
    break;
  }
  if (cooldownMs > 0) {
    log(`NODE_SEQ_COOLDOWN task=${taskId} ms=${cooldownMs}`);
    await sleep(cooldownMs);
  }
}

log("NODE_SEQ_CONSOLIDATE starting summary-only pass");
const consolidateExit = await runPowerShell([
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", "scripts\\bankertoolbench-nodeagent-full-sweep.ps1",
  "-ConvexRepo", convexRepo,
  "-JobNamePrefix", prefix,
  "-ModelId", modelId,
  "-CandidateModel", candidateModel,
  "-MaterializerMode", "generic-only",
  "-NoFallbackPlan",
  "-ForceModelPlanner",
  "-SummaryOnly",
  "-NoSecrets",
  "-SummaryOut", summaryOut,
  ...(args.taskIds?.length ? ["-TaskIds", args.taskIds.join(",")] : [
    ...(args.offset ? ["-Offset", String(args.offset)] : []),
    ...(args.limit ? ["-Limit", String(args.limit)] : []),
  ]),
], join(runRoot, "logs", `${prefix}.node-sequential-consolidate.log`));
log(`NODE_SEQ_DONE attempted=${attempted} cleanSeen=${clean} nonClean=${nonClean} failedChildren=${failed} consolidateExit=${consolidateExit} summary=${summaryOut}`);
if (consolidateExit !== 0 && process.exitCode === undefined) process.exitCode = consolidateExit;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    switch (key) {
      case "--job-name-prefix":
      case "-JobNamePrefix":
        parsed.jobNamePrefix = value;
        index += 1;
        break;
      case "--model-id":
      case "-ModelId":
        parsed.modelId = value;
        index += 1;
        break;
      case "--candidate-model":
      case "-CandidateModel":
        parsed.candidateModel = value;
        index += 1;
        break;
      case "--convex-repo":
      case "-ConvexRepo":
        parsed.convexRepo = value;
        index += 1;
        break;
      case "--summary-out":
      case "-SummaryOut":
        parsed.summaryOut = value;
        index += 1;
        break;
      case "--task-ids":
      case "-TaskIds":
        parsed.taskIds = value.split(",").map((item) => item.trim()).filter(Boolean);
        index += 1;
        break;
      case "--offset":
      case "-Offset":
        parsed.offset = Number(value);
        index += 1;
        break;
      case "--limit":
      case "-Limit":
        parsed.limit = Number(value);
        index += 1;
        break;
      case "--max-steps":
      case "-MaxSteps":
        parsed.maxSteps = value;
        index += 1;
        break;
      case "--planner-deadline-ms":
      case "-PlannerDeadlineMs":
        parsed.plannerDeadlineMs = value;
        index += 1;
        break;
      case "--runner-timeout-sec":
      case "-RunnerTimeoutSec":
        parsed.runnerTimeoutSec = value;
        index += 1;
        break;
      case "--cooldown-ms":
      case "-CooldownMs":
        parsed.cooldownMs = value;
        index += 1;
        break;
      case "--controller-log":
        parsed.controllerLog = value;
        index += 1;
        break;
      case "--stop-on-non-clean":
        parsed.stopOnNonClean = true;
        break;
      case "--secret-preflight":
        parsed.secretPreflight = true;
        break;
      case "--secret-retry-count":
        parsed.secretRetryCount = value;
        index += 1;
        break;
      case "--secret-retry-delay-ms":
        parsed.secretRetryDelayMs = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }
  return parsed;
}

function selectTasks(tasks, options) {
  if (options.taskIds?.length) {
    for (const taskId of options.taskIds) {
      if (!tasks.includes(taskId)) throw new Error(`Task id is not present under ${taskRoot}: ${taskId}`);
    }
    return options.taskIds;
  }
  const offset = Number.isFinite(options.offset) ? options.offset : 0;
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : undefined;
  return tasks.slice(offset, limit === undefined ? undefined : offset + limit);
}

function readTaskSummary(taskId) {
  const path = join(taskSummaryDir, `${taskId}.json`);
  if (!existsSync(path)) return undefined;
  try {
    const summary = JSON.parse(readJsonText(path));
    return summary.tasks?.[0];
  } catch (error) {
    log(`NODE_SEQ_SUMMARY_PARSE_FAILED task=${taskId} error=${String(error.message ?? error)}`);
    return undefined;
  }
}

function readJsonText(path) {
  const buffer = readFileSync(path);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    throw new Error("UTF-16BE JSON is not supported");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function archiveTaskArtifacts(taskId) {
  const targets = [
    { path: join(jobRoot, `${prefix}-${taskId}`), section: "jobs" },
    { path: join(taskSummaryDir, `${taskId}.json`), section: "parallel-summaries" },
    { path: join(taskLogDir, `${taskId}.log`), section: "parallel-logs" },
  ];
  for (const target of targets) {
    if (!existsSync(target.path)) continue;
    const destDir = join(archiveRoot, target.section);
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, target.path.split(/[\\/]/).pop());
    renameSync(target.path, dest);
    log(`NODE_SEQ_ARCHIVE task=${taskId} path=${target.path} dest=${dest}`);
  }
}

async function runTask(taskId) {
  const summaryPath = join(taskSummaryDir, `${taskId}.json`);
  const summaryRelative = relative(repoRoot, summaryPath);
  const logPath = join(taskLogDir, `${taskId}.log`);
  const psArgs = [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "scripts\\bankertoolbench-nodeagent-full-sweep.ps1",
    "-ConvexRepo", convexRepo,
    "-TaskIds", taskId,
    "-JobNamePrefix", prefix,
    "-ModelId", modelId,
    "-CandidateModel", candidateModel,
    "-MaterializerMode", "generic-only",
    "-NoFallbackPlan",
    "-ForceModelPlanner",
    "-SummaryOut", summaryRelative,
    "-RunnerTimeoutSec", runnerTimeoutSec,
    "-PlannerDeadlineMs", plannerDeadlineMs,
    "-MaxSteps", maxSteps,
  ];
  log(`NODE_SEQ_TASK_START task=${taskId} log=${logPath}`);
  return runPowerShell(psArgs, logPath);
}

function runPowerShell(psArgs, logPath) {
  return new Promise((resolve) => {
    mkdirSync(logPath.split(/[\\/]/).slice(0, -1).join("\\"), { recursive: true });
    const out = createWriteStream(logPath, { flags: "a" });
    let child;
    try {
      child = spawn("powershell.exe", psArgs, {
        cwd: repoRoot,
        windowsHide: true,
        env: { ...process.env, ...secretEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      out.write(`\nNODE_SEQ_CHILD_SPAWN_ERROR ${String(error.stack ?? error)}\n`);
      out.end();
      resolve(1);
      return;
    }
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on("error", (error) => {
      out.write(`\nNODE_SEQ_CHILD_ERROR ${String(error.stack ?? error)}\n`);
      out.end();
      resolve(1);
    });
    child.on("close", (code) => {
      out.end();
      resolve(code ?? 0);
    });
  });
}

async function loadConvexSecrets(names) {
  const env = {};
  const loaded = [];
  const missing = [];
  const failed = [];
  const retryCount = Number(args.secretRetryCount ?? "4");
  const retryDelayMs = Number(args.secretRetryDelayMs ?? "2000");

  for (const name of names) {
    if (process.env[name]?.trim()) {
      env[name] = process.env[name];
      loaded.push(name);
      continue;
    }

    let loadedThisName = false;
    let missingThisName = false;
    for (let attempt = 1; attempt <= Math.max(1, retryCount); attempt += 1) {
      const result = await runBuffered(npxCommand(), ["convex", "env", "get", name], { cwd: convexRepo });
      const stdout = result.stdout.trim();
      const combined = `${result.stdout}\n${result.stderr}`;
      const notFound = /Environment variable ".+" not found/i.test(combined);

      if (result.code === 0 && stdout && !notFound) {
        env[name] = stdout;
        loaded.push(name);
        loadedThisName = true;
        break;
      }
      if (notFound) {
        missing.push(name);
        missingThisName = true;
        break;
      }
      if (attempt < retryCount && retryDelayMs > 0) await sleep(retryDelayMs);
    }

    if (!loadedThisName && !missingThisName) failed.push(name);
  }

  log([
    `NODE_SEQ_SECRET_PREFLIGHT`,
    `loaded=${formatNames(loaded)}`,
    `missing=${formatNames(missing)}`,
    `failed=${formatNames(failed)}`,
  ].join(" "));
  return env;
}

function requiredSecretNames(currentModelId) {
  const required = ["GEMINI_API_KEY"];
  if (/^(gpt-|o[0-9]|chatgpt-)/i.test(currentModelId)) required.push("OPENAI_API_KEY");
  return required;
}

function formatNames(names) {
  return names.length ? names.join(",") : "none";
}

function runBuffered(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    let child;
    const spawnCommand = process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
      ? "cmd.exe"
      : command;
    const spawnArgs = spawnCommand === "cmd.exe"
      ? ["/d", "/s", "/c", command, ...commandArgs]
      : commandArgs;
    try {
      child = spawn(spawnCommand, spawnArgs, {
        cwd: options.cwd ?? repoRoot,
        windowsHide: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: 1, stdout: "", stderr: String(error.message ?? error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${String(error.message ?? error)}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(controllerLog, `${line}\n`, { flag: "a" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
