import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { installProofloopHooks, type ProofloopHookWorker } from "./proofloopHooks";

export const PROOFLOOP_AGENT_ADAPTER_IDS = ["codex", "claude-code", "cursor", "windsurf", "devin", "generic-cli"] as const;

export type ProofloopAgentAdapterId = (typeof PROOFLOOP_AGENT_ADAPTER_IDS)[number];
export type ProofloopAgentAdapterStatus = "ready" | "needs_adapter" | "needs_command" | "failed";

export type HookInstallResult = {
  schema: "proofloop-agent-adapter-setup-v1";
  generatedAt: string;
  adapterId: ProofloopAgentAdapterId;
  status: ProofloopAgentAdapterStatus;
  hookHost?: ProofloopHookWorker;
  settingsPath?: string;
  message: string;
  launchCommand?: string;
  traceCapture: string[];
  gateEnforcement: string[];
  nextCommands: string[];
  setupPackPath: string;
  mcpConfigPath: string;
  instructionPaths: string[];
  providerSetupCommands: string[];
  proofCommands: string[];
  receiptPath: string;
};

type AgentSetupPack = Pick<
  HookInstallResult,
  "setupPackPath" | "mcpConfigPath" | "instructionPaths" | "providerSetupCommands" | "proofCommands"
>;

export type AgentRunResult = {
  adapterId: ProofloopAgentAdapterId;
  status: "launched" | "needs_adapter" | "needs_command" | "failed";
  launched: boolean;
  command?: string;
  promptPath: string;
  exitCode?: number;
  stdoutPath?: string;
  stderrPath?: string;
  message: string;
};

export type AgentTrace = {
  schema: "proofloop-agent-trace-v1";
  adapterId: ProofloopAgentAdapterId;
  runDir: string;
  evidenceFiles: string[];
};

export type ProofloopVerdict = {
  runId: string;
  suite: string;
  cmd: string;
  passed: boolean;
  exitCode: number;
  score?: number;
  minScore?: number;
  failedGates?: string[];
  receiptPaths: string[];
};

export type ProofloopAgentAdapter = {
  id: ProofloopAgentAdapterId;
  installHooks(targetDir: string, options?: { local?: boolean; command?: string }): Promise<HookInstallResult>;
  launch(promptPath: string, targetDir: string, options?: { command?: string; env?: NodeJS.ProcessEnv }): Promise<AgentRunResult>;
  collectTrace(runDir: string): Promise<AgentTrace>;
  buildRepairPrompt(verdict: ProofloopVerdict, options?: { repairPrompt?: string; attempt?: number; maxAttempts?: number }): Promise<string>;
};

export function parseProofloopAgentAdapterId(value: string): ProofloopAgentAdapterId {
  if ((PROOFLOOP_AGENT_ADAPTER_IDS as readonly string[]).includes(value)) return value as ProofloopAgentAdapterId;
  throw new Error(`Unknown agent adapter ${value}. Expected one of: ${PROOFLOOP_AGENT_ADAPTER_IDS.join(", ")}`);
}

export function getProofloopAgentAdapter(id: ProofloopAgentAdapterId): ProofloopAgentAdapter {
  return {
    id,
    installHooks: (targetDir, options) => setupProofloopAgentAdapter({ adapterId: id, root: targetDir, ...options }),
    launch: (promptPath, targetDir, options) => Promise.resolve(launchProofloopAgentAdapter({ adapterId: id, promptPath, targetDir, ...options })),
    collectTrace: (runDir) => Promise.resolve(collectProofloopAgentTrace({ adapterId: id, runDir })),
    buildRepairPrompt: (verdict, options) => Promise.resolve(buildAgentRepairPrompt({ adapterId: id, verdict, ...options })),
  };
}

export async function setupProofloopAgentAdapter(args: {
  adapterId: ProofloopAgentAdapterId;
  root?: string;
  local?: boolean;
  command?: string;
  generatedAt?: string;
}): Promise<HookInstallResult> {
  const root = args.root ?? process.cwd();
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const hookHost = hookWorkerForAgent(args.adapterId);
  const command = args.command ?? defaultLaunchCommand(args.adapterId, process.env);
  let status: ProofloopAgentAdapterStatus = hookHost || command ? "ready" : "needs_adapter";
  let settingsPath: string | undefined;
  let message = adapterSetupMessage(args.adapterId, status);

  if (hookHost) {
    const installed = installProofloopHooks({ root, worker: hookHost, local: args.local ?? true });
    settingsPath = rel(root, installed.settingsPath);
    message = `${args.adapterId} hooks installed via ${hookHost}.`;
  } else if (args.adapterId === "generic-cli" && !command) {
    status = "needs_command";
    message = "generic-cli requires --command or PROOFLOOP_GENERIC_AGENT_COMMAND.";
  }
  const setupPack = writeAgentSetupPack({
    root,
    adapterId: args.adapterId,
    generatedAt,
    status,
    hookHost,
    command,
  });

  const receipt: HookInstallResult = {
    schema: "proofloop-agent-adapter-setup-v1",
    generatedAt,
    adapterId: args.adapterId,
    status,
    ...(hookHost ? { hookHost } : {}),
    ...(settingsPath ? { settingsPath } : {}),
    message,
    ...(command ? { launchCommand: command } : {}),
    traceCapture: traceCaptureForAgent(args.adapterId),
    gateEnforcement: gateEnforcementForAgent(args.adapterId, hookHost, command),
    nextCommands: nextCommandsForAgent(args.adapterId, status),
    ...setupPack,
    receiptPath: rel(root, agentSetupReceiptPath(root, args.adapterId)),
  };
  writeJson(agentSetupReceiptPath(root, args.adapterId), receipt);
  return receipt;
}

export function launchProofloopAgentAdapter(args: {
  adapterId: ProofloopAgentAdapterId;
  promptPath: string;
  targetDir?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
}): AgentRunResult {
  const targetDir = args.targetDir ?? process.cwd();
  const env = args.env ?? process.env;
  const commandTemplate = args.command ?? defaultLaunchCommand(args.adapterId, env);
  if (!commandTemplate) {
    const needs = args.adapterId === "generic-cli" ? "needs_command" : "needs_adapter";
    return {
      adapterId: args.adapterId,
      status: needs,
      launched: false,
      promptPath: rel(targetDir, args.promptPath),
      message: `${args.adapterId} has no launch command configured.`,
    };
  }
  const command = fillAgentCommandTemplate(commandTemplate, { promptPath: args.promptPath });

  const prompt = readFileSync(args.promptPath, "utf8");
  const result = spawnSync(command, {
    cwd: targetDir,
    shell: true,
    input: prompt,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    env: {
      ...env,
      PROOFLOOP_AGENT_ADAPTER: args.adapterId,
      PROOFLOOP_REPAIR_PROMPT: args.promptPath,
    },
  });
  const stdoutPath = join(dirname(args.promptPath), `${safeAgentId(args.adapterId)}-stdout.log`);
  const stderrPath = join(dirname(args.promptPath), `${safeAgentId(args.adapterId)}-stderr.log`);
  writeFileSync(stdoutPath, result.stdout ?? "", "utf8");
  writeFileSync(stderrPath, result.stderr ?? "", "utf8");
  const exitCode = result.status ?? 1;
  return {
    adapterId: args.adapterId,
    status: exitCode === 0 ? "launched" : "failed",
    launched: true,
    command,
    promptPath: rel(targetDir, args.promptPath),
    exitCode,
    stdoutPath: rel(targetDir, stdoutPath),
    stderrPath: rel(targetDir, stderrPath),
    message: exitCode === 0 ? `${args.adapterId} completed; rerun the ProofLoop suite.` : `${args.adapterId} exited ${exitCode}.`,
  };
}

export function collectProofloopAgentTrace(args: {
  adapterId: ProofloopAgentAdapterId;
  runDir: string;
  root?: string;
}): AgentTrace {
  const root = args.root ?? process.cwd();
  const evidenceFiles = existsSync(args.runDir)
    ? readdirSync(args.runDir)
      .filter((name) => /trace|eval|receipt|prompt|stdout|stderr|tooluse|meta|ledger/i.test(name))
      .map((name) => rel(root, join(args.runDir, name)))
    : [];
  return {
    schema: "proofloop-agent-trace-v1",
    adapterId: args.adapterId,
    runDir: rel(root, args.runDir),
    evidenceFiles,
  };
}

export function buildAgentRepairPrompt(args: {
  adapterId: ProofloopAgentAdapterId;
  verdict: ProofloopVerdict;
  repairPrompt?: string;
  attempt?: number;
  maxAttempts?: number;
}): string {
  const failedGates = args.verdict.failedGates?.length ? args.verdict.failedGates.join("\n- ") : `Command exited ${args.verdict.exitCode}`;
  const attempt = args.attempt ?? 1;
  const maxAttempts = args.maxAttempts ?? 1;
  return [
    `You are ${agentDisplayName(args.adapterId)} continuing a ProofLoop repair loop. Fix the product or harness code so the next ProofLoop run passes.`,
    "",
    "Non-negotiable rules:",
    "- Do not weaken verifiers, skip gates, lower minScore, delete required evidence, or edit protected .proofloop hook/tooluse state.",
    "- If setup is missing, install or configure the local setup path instead of claiming it is blocked.",
    "- Exercise the real live UI path when the failure is a browser/live benchmark failure.",
    "- After changes, run the exact next command below and rely on its receipt, not a chat summary.",
    "",
    `Adapter: ${args.adapterId}`,
    `Loop attempt: ${attempt}/${maxAttempts}`,
    `Failed suite: ${args.verdict.suite}`,
    `Failed run: ${args.verdict.runId}`,
    `Failed command: ${args.verdict.cmd}`,
    `Score: ${args.verdict.score ?? "n/a"}/${args.verdict.minScore ?? "n/a"}`,
    "Failed gates:",
    `- ${failedGates}`,
    "",
    "Receipt paths:",
    ...(args.verdict.receiptPaths.length ? args.verdict.receiptPaths.map((path) => `- ${path}`) : ["- none"]),
    "",
    "Repair context from ProofLoop:",
    (args.repairPrompt ?? "").trim() || "(none)",
    "",
    "Next command after repair:",
    `npm run proofloop -- run ${args.verdict.suite}`,
    "",
  ].join("\n");
}

export function writeAgentRepairAttemptReceipt(args: {
  root: string;
  runDir: string;
  generatedAt?: string;
  adapterId: ProofloopAgentAdapterId;
  meta: ProofloopVerdict;
  repairPromptPath: string;
  attempt: number;
  maxAttempts: number;
  runResult: AgentRunResult;
}): string {
  const path = join(args.runDir, `${safeAgentId(args.adapterId)}-repair-attempt.json`);
  const receipt = {
    schema: "proofloop-agent-repair-attempt-v1",
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    adapterId: args.adapterId,
    suite: args.meta.suite,
    failedRunId: args.meta.runId,
    attempt: args.attempt,
    maxAttempts: args.maxAttempts,
    repairPromptPath: rel(args.root, args.repairPromptPath),
    runResult: args.runResult,
    nextRunCommand: `npm run proofloop -- run ${args.meta.suite}`,
  };
  writeJson(path, receipt);
  return path;
}

export function agentSetupReceiptPath(root: string, adapterId: ProofloopAgentAdapterId): string {
  return join(root, ".proofloop", "setup", "agents", `${safeAgentId(adapterId)}.json`);
}

function hookWorkerForAgent(adapterId: ProofloopAgentAdapterId): ProofloopHookWorker | undefined {
  if (adapterId === "codex") return "codex";
  if (adapterId === "claude-code") return "claude-code";
  return undefined;
}

function defaultLaunchCommand(adapterId: ProofloopAgentAdapterId, env: NodeJS.ProcessEnv): string | undefined {
  if (adapterId === "codex") return env.PROOFLOOP_CODEX_COMMAND?.trim() || "codex exec --json";
  if (adapterId === "claude-code") return env.PROOFLOOP_CLAUDE_CODE_COMMAND?.trim() || env.CLAUDE_CODE_COMMAND?.trim() || "claude --print --input-format text";
  if (adapterId === "cursor") return env.PROOFLOOP_CURSOR_COMMAND?.trim() || env.PROOFLOOP_CURSOR_CLI_COMMAND?.trim() || "npm run proofloop -- agents launch cursor --prompt {promptPath}";
  if (adapterId === "windsurf") return env.PROOFLOOP_WINDSURF_COMMAND?.trim() || env.PROOFLOOP_CASCADE_COMMAND?.trim();
  if (adapterId === "devin") return env.PROOFLOOP_DEVIN_API_COMMAND?.trim() || "npm run proofloop -- agents launch devin-api --prompt {promptPath}";
  if (adapterId === "generic-cli") return env.PROOFLOOP_GENERIC_AGENT_COMMAND?.trim();
  return undefined;
}

function adapterSetupMessage(adapterId: ProofloopAgentAdapterId, status: ProofloopAgentAdapterStatus): string {
  if (status === "ready" && adapterId === "cursor") return "Cursor native launcher is ready; runtime verification still requires Cursor CLI evidence and ProofLoop gate receipts.";
  if (status === "ready" && adapterId === "devin") return "Devin native launcher is ready; runtime verification still requires Devin API/CLI evidence and ProofLoop gate receipts.";
  if (status === "ready" && adapterId === "windsurf") return "Windsurf native launcher is configured; runtime verification still requires session export evidence and ProofLoop gate receipts.";
  if (status === "ready") return `${adapterId} adapter is ready.`;
  if (adapterId === "cursor") return "Cursor needs a wrapper or extension command that can accept a repair prompt and export session evidence.";
  if (adapterId === "windsurf") return "Windsurf needs a Cascade/session adapter that can accept a repair prompt and export session evidence.";
  if (adapterId === "devin") return "Devin needs API/session export and relaunch hooks before ProofLoop can automate it.";
  return `${adapterId} adapter needs a launch command.`;
}

function traceCaptureForAgent(adapterId: ProofloopAgentAdapterId): string[] {
  if (adapterId === "codex" || adapterId === "claude-code" || adapterId === "generic-cli") {
    return ["ProofLoop run receipts", ".proofloop/tooluse/log.jsonl", "agent stdout/stderr", "git diff"];
  }
  if (adapterId === "cursor") return ["Cursor native launch stdout/stderr", "Cursor ATIF/session export", "git diff", "ProofLoop verifier receipts"];
  if (adapterId === "devin") return ["Devin API/CLI session export", "ATIF trajectory", "agent stdout/stderr", "ProofLoop verifier receipts"];
  return ["adapter-required: command logs", "adapter-required: file diffs", "adapter-required: screenshots/tool calls"];
}

function gateEnforcementForAgent(adapterId: ProofloopAgentAdapterId, hookHost?: ProofloopHookWorker, command?: string): string[] {
  if (hookHost) return [`${hookHost} Stop hook`, `${hookHost} PreToolUse guard`, "ProofLoop verifier receipts"];
  if (adapterId === "generic-cli") return ["wrapper CLI exit code", "ProofLoop verifier receipts"];
  if (command) return ["ProofLoop native launch receipt", "ProofLoop session export receipt", "ProofLoop verifier receipts"];
  return ["adapter-required: hook, wrapper CLI, or policy layer"];
}

function nextCommandsForAgent(adapterId: ProofloopAgentAdapterId, status: ProofloopAgentAdapterStatus): string[] {
  if (status === "ready") {
    if (adapterId === "cursor" || adapterId === "windsurf" || adapterId === "devin" || adapterId === "generic-cli") {
      const nativeHost = adapterId === "devin" ? "devin-api" : adapterId;
      return [
        `npm run proofloop -- agents launch ${nativeHost} --prompt <repair-prompt.md>`,
        `npm run proofloop -- agents collect ${nativeHost} --run-dir <native-run-dir>`,
        `npm run proofloop -- agents verify ${nativeHost} --run-dir <native-run-dir> --strict`,
        "npm run proofloop -- providers setup all",
        "npm run proofloop -- gate --goal official-scores",
      ];
    }
    return [
      `npm run proofloop -- run bankertoolbench --agent ${adapterId} --closed-loop`,
      `npm run proofloop -- agents setup ${adapterId}`,
      "npm run proofloop -- providers setup all",
      "npm run proofloop -- gate --goal official-scores",
    ];
  }
  if (status === "needs_command") {
    return [
      `npm run proofloop -- agents setup ${adapterId} --command "<agent command>"`,
      "npm run proofloop -- codex reprompt latest",
    ];
  }
  return [
    "npm run proofloop -- agents setup codex --local",
    "npm run proofloop -- agents setup claude-code --local",
    `Implement a ${adapterId} launch/trace/gate adapter, then rerun agents setup.`,
  ];
}

function writeAgentSetupPack(args: {
  root: string;
  adapterId: ProofloopAgentAdapterId;
  generatedAt: string;
  status: ProofloopAgentAdapterStatus;
  hookHost?: ProofloopHookWorker;
  command?: string;
}): AgentSetupPack {
  const setupDir = join(args.root, ".proofloop", "setup", "agents");
  const setupPackPath = join(setupDir, `${safeAgentId(args.adapterId)}-setup-pack.md`);
  const mcpConfigPath = writeProofloopMcpBridgeConfig(args.root);
  const instructionPath = hostInstructionPath(args.root, args.adapterId);
  if (instructionPath) {
    writeTextIfAbsent(instructionPath, hostInstructionContent(args));
  }
  const providerSetupCommands = providerSetupCommandsForAgent();
  const proofCommands = proofCommandsForAgent(args.adapterId, args.status);
  const setupPack = {
    setupPackPath: rel(args.root, setupPackPath),
    mcpConfigPath: rel(args.root, mcpConfigPath),
    instructionPaths: instructionPath ? [rel(args.root, instructionPath)] : [],
    providerSetupCommands,
    proofCommands,
  };
  mkdirSync(dirname(setupPackPath), { recursive: true });
  writeFileSync(
    setupPackPath,
    agentSetupPackMarkdown({
      ...args,
      ...setupPack,
    }),
    "utf8",
  );
  return setupPack;
}

function writeProofloopMcpBridgeConfig(root: string): string {
  const path = join(root, ".proofloop", "mcp", "proofloop-mcp.json");
  writeJson(path, {
    schema: "proofloop-mcp-bridge-config-v1",
    status: "ready",
    note: "Local stdio MCP bridge for Codex, Claude Code, Cursor, Windsurf, Devin, or a wrapper agent. It exposes ProofLoop setup, repair, provider, memory, graph, dashboard, and gate commands as tools.",
    servers: {
      proofloop: {
        command: "node",
        args: ["scripts/proofloop.mjs", "mcp", "serve"],
        bridgeMode: "stdio",
        tools: [
          "proofloop_manifest",
          "proofloop_doctor",
          "proofloop_docs_agents",
          "proofloop_agents_setup",
          "proofloop_agents_launch",
          "proofloop_agents_collect",
          "proofloop_agents_verify",
          "proofloop_providers_setup",
          "proofloop_bench_setup",
          "proofloop_memory_seed_dogfood",
          "proofloop_graph_ingest",
          "proofloop_dashboard_export",
          "proofloop_repair_latest",
          "proofloop_codex_reprompt_latest",
          "proofloop_gate_official_scores",
        ],
      },
    },
  });
  return path;
}

function hostInstructionPath(root: string, adapterId: ProofloopAgentAdapterId): string | undefined {
  if (adapterId === "cursor") return join(root, ".cursor", "rules", "proofloop.mdc");
  if (adapterId === "windsurf") return join(root, ".windsurf", "rules", "proofloop.md");
  if (adapterId === "devin") return join(root, "docs", "agents", "devin-proofloop.md");
  if (adapterId === "generic-cli") return join(root, "docs", "agents", "generic-cli-proofloop.md");
  return join(root, ".proofloop", "setup", "agents", `${safeAgentId(adapterId)}-operator.md`);
}

function hostInstructionContent(args: {
  adapterId: ProofloopAgentAdapterId;
  generatedAt: string;
  status: ProofloopAgentAdapterStatus;
  hookHost?: ProofloopHookWorker;
  command?: string;
}): string {
  const displayName = agentDisplayName(args.adapterId);
  const setupCommand = args.status === "needs_command"
    ? `npm run proofloop -- agents setup ${args.adapterId} --command "<agent command>"`
    : `npm run proofloop -- agents setup ${args.adapterId}`;
  return [
    `# ProofLoop Setup for ${displayName}`,
    "",
    `Generated: ${args.generatedAt}`,
    `Adapter status: ${args.status}`,
    "",
    "Use ProofLoop as the source of truth for setup, repair prompts, evidence, and completion claims.",
    "Do not claim a run is complete from chat, screenshots, or an agent assertion. Claim completion only from a gate, official scorer, or proof receipt.",
    "",
    "Discovery:",
    "- `npm run proofloop -- manifest --json`",
    "- `npm run proofloop -- docs agents --dense`",
    "- `npm run proofloop -- doctor --json`",
    "",
    "Setup:",
    "- `npm run proofloop -- agents setup codex --local`",
    "- `npm run proofloop -- agents setup claude-code --local`",
    `- \`${setupCommand}\``,
    "- `npm run proofloop -- providers setup all`",
    "- `npm run proofloop -- memory seed-dogfood`",
    "- `npm run proofloop -- graph ingest --backend neo4j`",
    "- `npm run proofloop -- dashboard export latest`",
    "- `npm run proofloop -- agents launch <host> --prompt <repair-prompt.md>`",
    "- `npm run proofloop -- agents collect <host> --run-dir <native-run-dir>`",
    "- `npm run proofloop -- agents verify <host> --run-dir <native-run-dir> --strict`",
    "",
    "Repair loop:",
    "- `npm run proofloop -- repair latest`",
    "- `npm run proofloop -- codex reprompt latest`",
    "- `npm run proofloop -- gate --goal official-scores`",
    "",
    adapterSpecificInstruction(args.adapterId, args.status),
    "",
  ].join("\n");
}

function adapterSpecificInstruction(adapterId: ProofloopAgentAdapterId, status: ProofloopAgentAdapterStatus): string {
  if (adapterId === "cursor") {
    return [
      "Cursor handoff:",
      "- Use this rule file to keep Cursor on the ProofLoop CLI contract.",
      "- Native launch uses scripts/proofloop-cursor-launch.mjs with cursor-agent or cursor agent when installed.",
      "- Full ready still requires launch, session export, and the ProofLoop gate to pass.",
    ].join("\n");
  }
  if (adapterId === "windsurf") {
    return [
      "Windsurf handoff:",
      "- Use this rule file to keep Cascade on the ProofLoop CLI contract.",
      "- Until Windsurf has an enforceable launch/session-export/gate wrapper, let Codex or Claude Code run strict closed-loop certification.",
    ].join("\n");
  }
  if (adapterId === "devin") {
    return [
      "Devin handoff:",
      "- Local Devin CLI uses scripts/proofloop-devin-cli-launch.py to run devin --prompt-file --print --export with stdout/stderr, timeout, and session export receipts.",
      "- Hosted Devin API uses scripts/proofloop-devin-api-launch.mjs with PROOFLOOP_DEVIN_API_KEY and PROOFLOOP_DEVIN_ORG_ID.",
      "- Default ProofLoop launch uses the hosted Devin API path; use `agents launch devin-cli` when a local Devin CLI is available.",
      "- Store API credentials in the host secret manager. ProofLoop setup receipts should record missing credentials without blocking unrelated local proof lanes.",
    ].join("\n");
  }
  if (adapterId === "generic-cli" && status === "needs_command") {
    return "Generic CLI handoff:\n- Provide `--command` with a worker that reads the repair prompt from stdin and writes useful stdout/stderr evidence.";
  }
  if (adapterId === "generic-cli") {
    return "Generic CLI handoff:\n- The configured command must read stdin, modify the repo if needed, and leave proof evidence in stdout/stderr and receipts.";
  }
  return "Strict control plane:\n- This adapter can install ProofLoop hooks. Use it to orchestrate setup packs for other editors or hosted agents.";
}

function providerSetupCommandsForAgent(): string[] {
  return [
    "npm run proofloop -- providers setup all",
    "npm run proofloop -- providers setup butterbase",
    "npm run proofloop -- providers setup neo4j",
    "npm run proofloop -- providers setup rocketride",
    "npm run proofloop -- providers setup daytona",
    "npm run proofloop -- providers setup cognee",
    "npm run proofloop -- providers setup nebius",
    "npm run proofloop -- providers setup opsera",
  ];
}

function proofCommandsForAgent(adapterId: ProofloopAgentAdapterId, status: ProofloopAgentAdapterStatus): string[] {
  const setupCommand = status === "needs_command"
    ? `npm run proofloop -- agents setup ${adapterId} --command "<agent command>"`
    : `npm run proofloop -- agents setup ${adapterId}`;
  const nativeHost = adapterId === "devin" ? "devin-api" : adapterId;
  return [
    "npm run proofloop -- manifest --dense",
    "npm run proofloop -- doctor --json",
    setupCommand,
    `npm run proofloop -- agents launch ${nativeHost} --prompt <repair-prompt.md>`,
    `npm run proofloop -- agents collect ${nativeHost} --run-dir <native-run-dir>`,
    `npm run proofloop -- agents verify ${nativeHost} --run-dir <native-run-dir> --strict`,
    "npm run proofloop -- setup finch --doctor",
    "npm run proofloop -- setup finauditing --doctor",
    "npm run proofloop -- setup workstreambench --doctor",
    "npm run proofloop -- memory seed-dogfood",
    "npm run proofloop -- graph ingest --backend neo4j",
    "npm run proofloop -- dashboard export latest",
    "npm run proofloop -- codex reprompt latest",
    "npm run proofloop -- gate --goal official-scores",
  ];
}

function agentSetupPackMarkdown(args: {
  root: string;
  adapterId: ProofloopAgentAdapterId;
  generatedAt: string;
  status: ProofloopAgentAdapterStatus;
  hookHost?: ProofloopHookWorker;
  command?: string;
  setupPackPath: string;
  mcpConfigPath: string;
  instructionPaths: string[];
  providerSetupCommands: string[];
  proofCommands: string[];
}): string {
  const strictReady = args.status === "ready" ? "yes" : "no";
  const hostFiles = args.instructionPaths.length ? args.instructionPaths.map((path) => `- ${path}`) : ["- none"];
  return [
    `# ProofLoop ${agentDisplayName(args.adapterId)} Setup Pack`,
    "",
    `Generated: ${args.generatedAt}`,
    `Adapter: ${args.adapterId}`,
    `Status: ${args.status}`,
    `Strict-ready: ${strictReady}`,
    ...(args.hookHost ? [`Hook host: ${args.hookHost}`] : []),
    ...(args.command ? [`Launch command: ${args.command}`] : []),
    "",
    "## What This Enables",
    "",
    "Codex and Claude Code can act as the enforceable ProofLoop control plane. Cursor, Devin, and wrapper agents can consume the same native launch, session-export, provider-check, receipt, and repair-prompt commands; runtime readiness is still proven by launch/collect/verify receipts.",
    "",
    "## Generated Files",
    "",
    `- Setup pack: ${args.setupPackPath}`,
    `- MCP bridge config: ${args.mcpConfigPath}`,
    ...hostFiles,
    "",
    "## Provider Setup",
    "",
    ...args.providerSetupCommands.map((command) => `- \`${command}\``),
    "",
    "## Proof Commands",
    "",
    ...args.proofCommands.map((command) => `- \`${command}\``),
    "",
    "## Certification Boundary",
    "",
    "Receipt-backed ProofLoop gates are the source of truth. LangChain, LangSmith, Harbor, provider SDKs, and editor agents can feed evidence into the lane, but official-score claims require the relevant scorer or locked ProofLoop receipt.",
    "",
  ].join("\n");
}

function writeTextIfAbsent(path: string, value: string): void {
  if (existsSync(path)) {
    const current = readFileSync(path, "utf8");
    if (!current.startsWith("# ProofLoop Setup for ")) return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function fillAgentCommandTemplate(command: string, args: { promptPath: string }): string {
  return command.replaceAll("{promptPath}", shellQuote(args.promptPath));
}

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function agentDisplayName(adapterId: ProofloopAgentAdapterId): string {
  if (adapterId === "claude-code") return "Claude Code";
  if (adapterId === "generic-cli") return "a generic CLI agent";
  return adapterId[0].toUpperCase() + adapterId.slice(1);
}

function safeAgentId(adapterId: ProofloopAgentAdapterId): string {
  return adapterId.replace(/[^a-z0-9-]/gi, "-");
}

function rel(root: string, path: string): string {
  const relativePath = relative(root, path).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : path.replace(/\\/g, "/");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
