import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { gateProofloopGoal, type ProofloopGoalStatus } from "./proofloopGoalSupervisor";
import { type ProofloopAgentAdapterId } from "./proofloopAgentAdapters";

export const PROOFLOOP_NATIVE_AGENT_HOST_IDS = [
  "codex",
  "claude-code",
  "cursor",
  "windsurf",
  "devin",
  "devin-cli",
  "devin-api",
  "generic-cli",
] as const;

export type ProofloopNativeAgentHostId = (typeof PROOFLOOP_NATIVE_AGENT_HOST_IDS)[number];
export type ProofloopNativeAgentStatus =
  | "setup_ready"
  | "launch_ready"
  | "trace_ready"
  | "gate_ready"
  | "ready"
  | "needs_launch"
  | "needs_trace_export"
  | "needs_gate_enforcement"
  | "failed";

export type ProofloopNativeLaunchReceipt = {
  schema: "proofloop-agent-native-launch-v1";
  generatedAt: string;
  hostId: ProofloopNativeAgentHostId;
  status: "launch_ready" | "needs_launch" | "failed";
  promptPath: string;
  runDir: string;
  command?: string;
  exportPath?: string;
  sessionId?: string;
  exitCode?: number;
  stdoutPath?: string;
  stderrPath?: string;
  message: string;
  nextCommands: string[];
  receiptPath: string;
};

export type ProofloopNativeSessionReceipt = {
  schema: "proofloop-agent-native-session-export-v1";
  generatedAt: string;
  hostId: ProofloopNativeAgentHostId;
  status: "trace_ready" | "needs_trace_export" | "failed";
  runDir: string;
  sessionId?: string;
  sessionPath?: string;
  evidenceFiles: string[];
  message: string;
  nextCommands: string[];
  receiptPath: string;
};

export type ProofloopNativeVerifyReceipt = {
  schema: "proofloop-agent-native-verify-v1";
  generatedAt: string;
  hostId: ProofloopNativeAgentHostId;
  status: ProofloopNativeAgentStatus;
  runDir?: string;
  goalId: string;
  goalStatus?: ProofloopGoalStatus;
  checks: Array<{
    id: "launch" | "session_export" | "gate";
    status: "pass" | "fail";
    detail: string;
    evidence?: string;
  }>;
  receiptPath: string;
  nextCommands: string[];
};

export function parseProofloopNativeAgentHostId(value: string): ProofloopNativeAgentHostId {
  if ((PROOFLOOP_NATIVE_AGENT_HOST_IDS as readonly string[]).includes(value)) return value as ProofloopNativeAgentHostId;
  throw new Error(`Unknown native agent host ${value}. Expected one of: ${PROOFLOOP_NATIVE_AGENT_HOST_IDS.join(", ")}`);
}

export function nativeHostAsAdapterId(hostId: ProofloopNativeAgentHostId): ProofloopAgentAdapterId | undefined {
  if (hostId === "devin-cli" || hostId === "devin-api") return "devin";
  if (hostId === "codex" || hostId === "claude-code" || hostId === "cursor" || hostId === "windsurf" || hostId === "devin" || hostId === "generic-cli") return hostId;
  return undefined;
}

export function launchNativeAgentHost(args: {
  root?: string;
  hostId: ProofloopNativeAgentHostId;
  promptPath: string;
  runDir?: string;
  command?: string;
  generatedAt?: string;
  env?: NodeJS.ProcessEnv;
}): ProofloopNativeLaunchReceipt {
  const root = args.root ?? process.cwd();
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const runDir = args.runDir ? resolve(root, args.runDir) : nativeRunDir(root, args.hostId, generatedAt);
  mkdirSync(runDir, { recursive: true });
  const promptPath = resolve(root, args.promptPath);
  const exportPath = join(runDir, `${safeHostId(args.hostId)}-session.atif.json`);
  const command = nativeLaunchCommand({
    root,
    hostId: args.hostId,
    command: args.command,
    env: args.env ?? process.env,
    promptPath,
    exportPath,
    runDir,
  });
  const receiptPath = join(runDir, `${safeHostId(args.hostId)}-native-launch.json`);

  if (!existsSync(promptPath)) {
    const receipt: ProofloopNativeLaunchReceipt = {
      schema: "proofloop-agent-native-launch-v1",
      generatedAt,
      hostId: args.hostId,
      status: "failed",
      promptPath: rel(root, promptPath),
      runDir: rel(root, runDir),
      message: `Prompt file does not exist: ${rel(root, promptPath)}`,
      nextCommands: [`Create ${rel(root, promptPath)} or pass --prompt <file>.`],
      receiptPath: rel(root, receiptPath),
    };
    writeJson(receiptPath, receipt);
    return receipt;
  }

  if (!command) {
    const receipt: ProofloopNativeLaunchReceipt = {
      schema: "proofloop-agent-native-launch-v1",
      generatedAt,
      hostId: args.hostId,
      status: "needs_launch",
      promptPath: rel(root, promptPath),
      runDir: rel(root, runDir),
      message: launchMissingMessage(args.hostId),
      nextCommands: launchNextCommands(args.hostId),
      receiptPath: rel(root, receiptPath),
    };
    writeJson(receiptPath, receipt);
    return receipt;
  }

  const prompt = readFileSync(promptPath, "utf8");
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    input: prompt,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...(args.env ?? process.env),
      PROOFLOOP_AGENT_HOST: args.hostId,
      PROOFLOOP_REPAIR_PROMPT: promptPath,
      PROOFLOOP_AGENT_SESSION_EXPORT: exportPath,
      PROOFLOOP_AGENT_RUN_DIR: runDir,
    },
  });
  const stdoutPath = join(runDir, `${safeHostId(args.hostId)}-stdout.log`);
  const stderrPath = join(runDir, `${safeHostId(args.hostId)}-stderr.log`);
  writeFileSync(stdoutPath, result.stdout ?? "", "utf8");
  writeFileSync(stderrPath, result.stderr ?? "", "utf8");
  const exitCode = result.status ?? 1;
  const session = readSessionExportSummary(exportPath);
  const receipt: ProofloopNativeLaunchReceipt = {
    schema: "proofloop-agent-native-launch-v1",
    generatedAt,
    hostId: args.hostId,
    status: exitCode === 0 ? "launch_ready" : "failed",
    promptPath: rel(root, promptPath),
    runDir: rel(root, runDir),
    command,
    exportPath: rel(root, exportPath),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    exitCode,
    stdoutPath: rel(root, stdoutPath),
    stderrPath: rel(root, stderrPath),
    message: exitCode === 0
      ? `${args.hostId} launch completed${session.sessionUrl ? ` (${session.sessionUrl})` : ""}; collect session export next.`
      : `${args.hostId} launch exited ${exitCode}.`,
    nextCommands: [
      `npm run proofloop -- agents collect ${args.hostId} --run-dir ${rel(root, runDir)}`,
      `npm run proofloop -- agents verify ${args.hostId} --run-dir ${rel(root, runDir)} --strict`,
    ],
    receiptPath: rel(root, receiptPath),
  };
  writeJson(receiptPath, receipt);
  return receipt;
}

export function collectNativeAgentSession(args: {
  root?: string;
  hostId: ProofloopNativeAgentHostId;
  runDir?: string;
  sessionPath?: string;
  sessionId?: string;
  generatedAt?: string;
}): ProofloopNativeSessionReceipt {
  const root = args.root ?? process.cwd();
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const runDir = args.runDir ? resolve(root, args.runDir) : latestNativeRunDir(root, args.hostId) ?? nativeRunDir(root, args.hostId, generatedAt);
  mkdirSync(runDir, { recursive: true });
  const receiptPath = join(runDir, `${safeHostId(args.hostId)}-native-session-export.json`);
  const evidence = new Set<string>();

  for (const file of evidenceFilesInRunDir(runDir)) evidence.add(rel(root, file));
  const sessionPath = args.sessionPath ? resolve(root, args.sessionPath) : undefined;
  let copiedSessionPath: string | undefined;
  if (sessionPath && existsSync(sessionPath)) {
    copiedSessionPath = copySessionArtifact(root, runDir, sessionPath, args.hostId);
    evidence.add(rel(root, copiedSessionPath));
  }
  const toolUsePaths = [
    join(root, ".proofloop", "tooluse", "log.jsonl"),
    join(root, ".proofloop", "tooluse", `${safeHostId(args.hostId)}.jsonl`),
    join(root, ".proofloop", "tooluse", "windsurf.jsonl"),
  ];
  for (const path of toolUsePaths) {
    if (existsSync(path)) evidence.add(rel(root, path));
  }
  const diffPath = writeGitDiffIfAny(root, runDir);
  if (diffPath) evidence.add(rel(root, diffPath));

  const evidenceFiles = [...evidence].sort();
  const receipt: ProofloopNativeSessionReceipt = {
    schema: "proofloop-agent-native-session-export-v1",
    generatedAt,
    hostId: args.hostId,
    status: evidenceFiles.length ? "trace_ready" : "needs_trace_export",
    runDir: rel(root, runDir),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(copiedSessionPath ? { sessionPath: rel(root, copiedSessionPath) } : sessionPath ? { sessionPath: rel(root, sessionPath) } : {}),
    evidenceFiles,
    message: evidenceFiles.length ? `${args.hostId} session evidence collected.` : `${args.hostId} session export evidence is missing.`,
    nextCommands: evidenceFiles.length
      ? [`npm run proofloop -- agents verify ${args.hostId} --run-dir ${rel(root, runDir)} --strict`]
      : sessionExportNextCommands(args.hostId, rel(root, runDir)),
    receiptPath: rel(root, receiptPath),
  };
  writeJson(receiptPath, receipt);
  return receipt;
}

export function verifyNativeAgentEnforcement(args: {
  root?: string;
  hostId: ProofloopNativeAgentHostId;
  runDir?: string;
  goalId?: string;
  generatedAt?: string;
}): ProofloopNativeVerifyReceipt {
  const root = args.root ?? process.cwd();
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const goalId = args.goalId ?? "official-scores";
  const runDir = args.runDir ? resolve(root, args.runDir) : latestNativeRunDir(root, args.hostId);
  const receiptRoot = runDir ?? join(root, ".proofloop", "setup", "agents");
  mkdirSync(receiptRoot, { recursive: true });
  const receiptPath = join(receiptRoot, `${safeHostId(args.hostId)}-native-verify.json`);
  const launch = runDir ? latestJsonInDir<ProofloopNativeLaunchReceipt>(runDir, /-native-launch\.json$/) : undefined;
  const session = runDir ? latestJsonInDir<ProofloopNativeSessionReceipt>(runDir, /-native-session-export\.json$/) : undefined;
  let goalStatus: ProofloopGoalStatus | undefined;
  let gateDetail = "";
  try {
    const state = gateProofloopGoal(goalId, { root });
    goalStatus = state.status;
    gateDetail = `goal ${goalId} status is ${state.status}`;
  } catch (error) {
    gateDetail = error instanceof Error ? error.message : String(error);
  }

  const checks: ProofloopNativeVerifyReceipt["checks"] = [
    {
      id: "launch",
      status: launch?.status === "launch_ready" ? "pass" : "fail",
      detail: launch ? `launch receipt status is ${launch.status}` : "launch receipt is missing",
      evidence: launch?.receiptPath,
    },
    {
      id: "session_export",
      status: session?.status === "trace_ready" ? "pass" : "fail",
      detail: session ? `session export receipt status is ${session.status}` : "session export receipt is missing",
      evidence: session?.receiptPath,
    },
    {
      id: "gate",
      status: goalStatus === "passed" ? "pass" : "fail",
      detail: gateDetail,
    },
  ];
  const status = nativeVerifyStatus(checks);
  const receipt: ProofloopNativeVerifyReceipt = {
    schema: "proofloop-agent-native-verify-v1",
    generatedAt,
    hostId: args.hostId,
    status,
    ...(runDir ? { runDir: rel(root, runDir) } : {}),
    goalId,
    ...(goalStatus ? { goalStatus } : {}),
    checks,
    receiptPath: rel(root, receiptPath),
    nextCommands: verifyNextCommands(args.hostId, runDir ? rel(root, runDir) : undefined, status),
  };
  writeJson(receiptPath, receipt);
  return receipt;
}

function nativeLaunchCommand(args: {
  root: string;
  hostId: ProofloopNativeAgentHostId;
  command?: string;
  env: NodeJS.ProcessEnv;
  promptPath: string;
  exportPath: string;
  runDir: string;
}): string | undefined {
  const configured = args.command ?? configuredLaunchCommand(args.hostId, args.env);
  if (configured) return fillCommandTemplate(configured, args);
  if (args.hostId === "codex") return "codex exec --json";
  if (args.hostId === "claude-code") return "claude --print --input-format text";
  if (args.hostId === "cursor") {
    return fillCommandTemplate(`node ${shellQuote(launcherScriptPath(args.root, "scripts/proofloop-cursor-launch.mjs"))} --prompt-file {promptPath} --export {exportPath} --run-dir {runDir}`, args);
  }
  if (args.hostId === "devin-cli") {
    return fillCommandTemplate("devin --prompt-file {promptPath} --print --export {exportPath}", args);
  }
  if (args.hostId === "devin" || args.hostId === "devin-api") {
    return fillCommandTemplate(`node ${shellQuote(launcherScriptPath(args.root, "scripts/proofloop-devin-api-launch.mjs"))} --prompt-file {promptPath} --export {exportPath} --run-dir {runDir}`, args);
  }
  return undefined;
}

function configuredLaunchCommand(hostId: ProofloopNativeAgentHostId, env: NodeJS.ProcessEnv): string | undefined {
  if (hostId === "cursor") return env.PROOFLOOP_CURSOR_COMMAND?.trim() || env.PROOFLOOP_CURSOR_CLI_COMMAND?.trim();
  if (hostId === "windsurf") return env.PROOFLOOP_WINDSURF_COMMAND?.trim() || env.PROOFLOOP_CASCADE_COMMAND?.trim();
  if (hostId === "devin" || hostId === "devin-api") return env.PROOFLOOP_DEVIN_API_COMMAND?.trim();
  if (hostId === "devin-cli") return env.PROOFLOOP_DEVIN_CLI_COMMAND?.trim() || env.DEVIN_CLI_COMMAND?.trim();
  if (hostId === "generic-cli") return env.PROOFLOOP_GENERIC_AGENT_COMMAND?.trim();
  if (hostId === "codex") return env.PROOFLOOP_CODEX_COMMAND?.trim();
  if (hostId === "claude-code") return env.PROOFLOOP_CLAUDE_CODE_COMMAND?.trim() || env.CLAUDE_CODE_COMMAND?.trim();
  return undefined;
}

function fillCommandTemplate(command: string, args: { promptPath: string; exportPath: string; runDir: string }): string {
  return command
    .replaceAll("{promptPath}", shellQuote(args.promptPath))
    .replaceAll("{exportPath}", shellQuote(args.exportPath))
    .replaceAll("{runDir}", shellQuote(args.runDir));
}

function launcherScriptPath(root: string, relativePath: string): string {
  const targetRepoPath = join(root, relativePath);
  if (existsSync(targetRepoPath)) return targetRepoPath;
  return join(process.cwd(), relativePath);
}

function nativeVerifyStatus(checks: ProofloopNativeVerifyReceipt["checks"]): ProofloopNativeAgentStatus {
  if (checks.every((check) => check.status === "pass")) return "ready";
  if (checks.find((check) => check.id === "launch")?.status === "fail") return "needs_launch";
  if (checks.find((check) => check.id === "session_export")?.status === "fail") return "needs_trace_export";
  if (checks.find((check) => check.id === "gate")?.status === "fail") return "needs_gate_enforcement";
  return "failed";
}

function launchMissingMessage(hostId: ProofloopNativeAgentHostId): string {
  if (hostId === "cursor") return "Cursor native launch uses scripts/proofloop-cursor-launch.mjs. Install Cursor CLI or set PROOFLOOP_CURSOR_COMMAND/PROOFLOOP_CURSOR_BINARY.";
  if (hostId === "windsurf") return "Windsurf/Cascade native launch needs PROOFLOOP_WINDSURF_COMMAND or --command; MCP and hooks can still collect evidence.";
  if (hostId === "devin" || hostId === "devin-api") return "Hosted Devin native launch uses scripts/proofloop-devin-api-launch.mjs. Set PROOFLOOP_DEVIN_API_KEY/DEVIN_API_KEY and PROOFLOOP_DEVIN_ORG_ID/DEVIN_ORG_ID.";
  if (hostId === "generic-cli") return "generic-cli native launch needs PROOFLOOP_GENERIC_AGENT_COMMAND or --command.";
  return `${hostId} native launch command is unavailable.`;
}

function launchNextCommands(hostId: ProofloopNativeAgentHostId): string[] {
  if (hostId === "devin-cli") return ["Install Devin CLI or set PROOFLOOP_DEVIN_CLI_COMMAND.", "npm run proofloop -- agents launch devin-cli --prompt <file>"];
  if (hostId === "cursor") return ["Install Cursor CLI or set PROOFLOOP_CURSOR_BINARY/PROOFLOOP_CURSOR_COMMAND.", "npm run proofloop -- agents launch cursor --prompt <file>"];
  if (hostId === "windsurf") return ["Set PROOFLOOP_WINDSURF_COMMAND when a non-interactive Cascade launcher is available.", "npm run proofloop -- agents collect windsurf --session <transcript.jsonl>"];
  if (hostId === "devin" || hostId === "devin-api") return ["Set PROOFLOOP_DEVIN_API_KEY and PROOFLOOP_DEVIN_ORG_ID.", "npm run proofloop -- agents launch devin-api --prompt <file>"];
  return [`npm run proofloop -- agents launch ${hostId} --prompt <file> --command "<agent command>"`];
}

function sessionExportNextCommands(hostId: ProofloopNativeAgentHostId, runDir: string): string[] {
  if (hostId === "windsurf") return [`npm run proofloop -- agents collect windsurf --run-dir ${runDir} --session <cascade-transcript.jsonl>`];
  if (hostId === "devin-cli") return [`npm run proofloop -- agents launch devin-cli --run-dir ${runDir} --prompt <file>`, `npm run proofloop -- agents collect devin-cli --run-dir ${runDir}`];
  return [`npm run proofloop -- agents collect ${hostId} --run-dir ${runDir} --session <session-export>`];
}

function verifyNextCommands(hostId: ProofloopNativeAgentHostId, runDir: string | undefined, status: ProofloopNativeAgentStatus): string[] {
  if (status === "ready") return [`${hostId} native launch/session-export/gate enforcement is ready.`];
  if (status === "needs_launch") return [`npm run proofloop -- agents launch ${hostId} --prompt <file>${runDir ? ` --run-dir ${runDir}` : ""}`];
  if (status === "needs_trace_export") return [`npm run proofloop -- agents collect ${hostId}${runDir ? ` --run-dir ${runDir}` : ""}`];
  if (status === "needs_gate_enforcement") return ["npm run proofloop -- gate --goal official-scores"];
  return [`Inspect ${hostId} native enforcement receipts and rerun agents verify.`];
}

function evidenceFilesInRunDir(runDir: string): string[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .filter((name) => /atif|trace|transcript|session|stdout|stderr|tooluse|receipt|launch|diff/i.test(name))
    .map((name) => join(runDir, name));
}

function readSessionExportSummary(path: string): { sessionId?: string; sessionUrl?: string } {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      sessionId?: unknown;
      session_id?: unknown;
      sessionUrl?: unknown;
      url?: unknown;
      response?: { body?: { session_id?: unknown; url?: unknown } };
    };
    const sessionId = stringValue(parsed.sessionId)
      ?? stringValue(parsed.session_id)
      ?? stringValue(parsed.response?.body?.session_id);
    const sessionUrl = stringValue(parsed.sessionUrl)
      ?? stringValue(parsed.url)
      ?? stringValue(parsed.response?.body?.url);
    return {
      ...(sessionId ? { sessionId } : {}),
      ...(sessionUrl ? { sessionUrl } : {}),
    };
  } catch {
    return {};
  }
}

function copySessionArtifact(root: string, runDir: string, sourcePath: string, hostId: ProofloopNativeAgentHostId): string {
  const extension = extname(sourcePath) || ".jsonl";
  const target = join(runDir, `${safeHostId(hostId)}-session-export${extension}`);
  if (resolve(sourcePath) !== resolve(target)) copyFileSync(sourcePath, target);
  return target.startsWith(root) ? target : sourcePath;
}

function writeGitDiffIfAny(root: string, runDir: string): string | undefined {
  const result = spawnSync("git", ["diff", "--"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const diff = result.stdout ?? "";
  if (!diff.trim()) return undefined;
  const path = join(runDir, "git-diff.patch");
  writeFileSync(path, diff, "utf8");
  return path;
}

function latestJsonInDir<T>(dir: string, pattern: RegExp): T | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files[0]) return undefined;
  return JSON.parse(readFileSync(files[0].path, "utf8")) as T;
}

function latestNativeRunDir(root: string, hostId: ProofloopNativeAgentHostId): string | undefined {
  const runsRoot = join(root, ".proofloop", "agents", "native");
  if (!existsSync(runsRoot)) return undefined;
  const prefix = `${safeHostId(hostId)}-`;
  const dirs = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => ({ path: join(runsRoot, entry.name), mtime: statSync(join(runsRoot, entry.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.path;
}

function nativeRunDir(root: string, hostId: ProofloopNativeAgentHostId, generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "-");
  return join(root, ".proofloop", "agents", "native", `${safeHostId(hostId)}-${stamp}`);
}

function safeHostId(hostId: ProofloopNativeAgentHostId): string {
  return hostId.replace(/[^a-z0-9-]/gi, "-");
}

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function rel(root: string, path: string): string {
  const relativePath = relative(root, path).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : path.replace(/\\/g, "/");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
