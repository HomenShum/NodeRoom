import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  formatProofloopCliManifest,
  formatProofloopDoctor,
  formatProofloopDocsTopic,
  proofloopCliManifest,
  proofloopDocsTopic,
  runProofloopDoctor,
} from "./proofloopAgentFriendlyCli";

type JsonRpcId = string | number | null;

export type ProofloopMcpRequest = {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type ProofloopMcpResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
};

type ToolCallParams = {
  name?: string;
  arguments?: Record<string, unknown>;
};

type ToolContent = {
  type: "text";
  text: string;
};

type ToolResult = {
  content: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type ProofloopMcpCommandResult = {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ProofloopMcpCommandRunner = (args: string[], root: string) => ProofloopMcpCommandResult;

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const EMPTY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const PROOFLOOP_MCP_TOOLS: ToolDefinition[] = [
  {
    name: "proofloop_manifest",
    description: "Return the machine-readable ProofLoop command surface and dense summary.",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "proofloop_doctor",
    description: "Run the read-only ProofLoop setup doctor and return checks.",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "proofloop_docs_agents",
    description: "Return compact ProofLoop agent workflow docs.",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "proofloop_agents_setup",
    description: "Generate ProofLoop agent setup receipts, setup packs, hooks, and host handoff docs.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: ["all", "codex", "claude-code", "cursor", "windsurf", "devin", "generic-cli"], default: "all" },
        local: { type: "boolean", default: true },
        strict: { type: "boolean", default: false },
        command: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_agents_launch",
    description: "Launch a native agent host with a ProofLoop repair prompt and write a launch receipt.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", enum: ["codex", "claude-code", "cursor", "windsurf", "devin", "devin-cli", "devin-api", "generic-cli"] },
        prompt: { type: "string" },
        runDir: { type: "string" },
        command: { type: "string" },
      },
      required: ["host", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_agents_collect",
    description: "Collect a native agent host session export, transcript, logs, diffs, and tool-use evidence.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", enum: ["codex", "claude-code", "cursor", "windsurf", "devin", "devin-cli", "devin-api", "generic-cli"] },
        runDir: { type: "string" },
        session: { type: "string" },
        sessionId: { type: "string" },
        strict: { type: "boolean", default: false },
      },
      required: ["host"],
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_agents_verify",
    description: "Verify native launch, session export, and ProofLoop gate enforcement receipts for a host.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", enum: ["codex", "claude-code", "cursor", "windsurf", "devin", "devin-cli", "devin-api", "generic-cli"] },
        runDir: { type: "string" },
        goal: { type: "string", default: "official-scores" },
        strict: { type: "boolean", default: true },
      },
      required: ["host"],
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_providers_setup",
    description: "Verify provider credentials/endpoints and write provider setup receipts.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["all", "butterbase", "neo4j", "rocketride", "daytona", "cognee", "nebius", "opsera"], default: "all" },
        strict: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_bench_setup",
    description: "Prepare local benchmark setup recipes for BankerToolBench, Finch, FinAuditing, or WorkstreamBench.",
    inputSchema: {
      type: "object",
      properties: {
        bench: { type: "string", enum: ["bankertoolbench", "finch", "finauditing", "workstreambench"] },
        doctor: { type: "boolean", default: true },
        allowDownload: { type: "boolean", default: false },
      },
      required: ["bench"],
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_memory_seed_dogfood",
    description: "Seed local ProofLoop memory with dogfood failure examples.",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "proofloop_graph_ingest",
    description: "Ingest or export code graph data for repair blast-radius workflows.",
    inputSchema: {
      type: "object",
      properties: {
        backend: { type: "string", enum: ["local", "neo4j"], default: "neo4j" },
        include: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_dashboard_export",
    description: "Write dashboard.json/html proof export for latest or a selected run.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", default: "latest" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "proofloop_repair_latest",
    description: "Turn the latest failed run into a focused repair prompt.",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "proofloop_codex_reprompt_latest",
    description: "Regenerate the latest failed-run Codex relaunch prompt and packet.",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "proofloop_gate_official_scores",
    description: "Run the official-scores completion gate and return its receipt-backed verdict.",
    inputSchema: EMPTY_SCHEMA,
  },
];

export async function handleProofloopMcpRequest(
  request: ProofloopMcpRequest,
  options: { root?: string; runCommand?: ProofloopMcpCommandRunner } = {},
): Promise<ProofloopMcpResponse | undefined> {
  const root = options.root ?? process.cwd();
  const runCommand = options.runCommand ?? runProofloopCliCommand;
  try {
    if (request.method === "initialize") {
      return response(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "proofloop", version: "0.1.0" },
      });
    }
    if (request.method === "tools/list") {
      return response(request.id, { tools: PROOFLOOP_MCP_TOOLS });
    }
    if (request.method === "tools/call") {
      const params = request.params as ToolCallParams | undefined;
      if (!params?.name) return response(request.id, undefined, rpcError(-32602, "Missing tool name."));
      return response(request.id, callProofloopMcpTool(params.name, params.arguments ?? {}, root, runCommand));
    }
    if (request.method.startsWith("notifications/")) return undefined;
    return response(request.id, undefined, rpcError(-32601, `Method not found: ${request.method}`));
  } catch (error) {
    return response(request.id, undefined, rpcError(-32000, error instanceof Error ? error.message : String(error)));
  }
}

export function runProofloopMcpServer(options: { root?: string } = {}): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    void handleLine(line, options.root ?? process.cwd());
  });
}

function callProofloopMcpTool(
  name: string,
  args: Record<string, unknown>,
  root: string,
  runCommand: ProofloopMcpCommandRunner,
): ToolResult {
  if (name === "proofloop_manifest") {
    const manifest = proofloopCliManifest();
    return textResult(formatProofloopCliManifest(manifest, { dense: true }), manifest);
  }
  if (name === "proofloop_doctor") {
    const doctor = runProofloopDoctor(root);
    return textResult(formatProofloopDoctor(doctor, { dense: true }), doctor, doctor.status !== "pass");
  }
  if (name === "proofloop_docs_agents") {
    const docs = proofloopDocsTopic("agents");
    return textResult(formatProofloopDocsTopic(docs, { dense: true }), docs);
  }
  const commandArgs = proofloopCommandArgsForTool(name, args);
  if (!commandArgs) throw new Error(`Unknown tool: ${name}`);
  const result = runCommand(commandArgs, root);
  return commandToolResult(result);
}

function proofloopCommandArgsForTool(name: string, args: Record<string, unknown>): string[] | undefined {
  if (name === "proofloop_agents_setup") {
    const commandArgs = ["agents", "setup", enumArg(args.agent, ["all", "codex", "claude-code", "cursor", "windsurf", "devin", "generic-cli"], "all")];
    if (booleanArg(args.local, true)) commandArgs.push("--local");
    if (booleanArg(args.strict, false)) commandArgs.push("--strict");
    const command = stringArg(args.command);
    if (command) commandArgs.push("--command", command);
    return commandArgs;
  }
  if (name === "proofloop_agents_launch") {
    const commandArgs = ["agents", "launch", enumArg(args.host, ["codex", "claude-code", "cursor", "windsurf", "devin", "devin-cli", "devin-api", "generic-cli"])];
    const prompt = stringArg(args.prompt);
    if (!prompt) throw new Error("proofloop_agents_launch requires prompt.");
    commandArgs.push("--prompt", prompt);
    const runDir = stringArg(args.runDir);
    if (runDir) commandArgs.push("--run-dir", runDir);
    const command = stringArg(args.command);
    if (command) commandArgs.push("--command", command);
    return commandArgs;
  }
  if (name === "proofloop_agents_collect") {
    const commandArgs = ["agents", "collect", enumArg(args.host, ["codex", "claude-code", "cursor", "windsurf", "devin", "devin-cli", "devin-api", "generic-cli"])];
    const runDir = stringArg(args.runDir);
    if (runDir) commandArgs.push("--run-dir", runDir);
    const session = stringArg(args.session);
    if (session) commandArgs.push("--session", session);
    const sessionId = stringArg(args.sessionId);
    if (sessionId) commandArgs.push("--session-id", sessionId);
    if (booleanArg(args.strict, false)) commandArgs.push("--strict");
    return commandArgs;
  }
  if (name === "proofloop_agents_verify") {
    const commandArgs = ["agents", "verify", enumArg(args.host, ["codex", "claude-code", "cursor", "windsurf", "devin", "devin-cli", "devin-api", "generic-cli"])];
    const runDir = stringArg(args.runDir);
    if (runDir) commandArgs.push("--run-dir", runDir);
    const goal = stringArg(args.goal);
    if (goal) commandArgs.push("--goal", goal);
    if (booleanArg(args.strict, true)) commandArgs.push("--strict");
    return commandArgs;
  }
  if (name === "proofloop_providers_setup") {
    const commandArgs = ["providers", "setup", enumArg(args.provider, ["all", "butterbase", "neo4j", "rocketride", "daytona", "cognee", "nebius", "opsera"], "all")];
    if (booleanArg(args.strict, false)) commandArgs.push("--strict");
    return commandArgs;
  }
  if (name === "proofloop_bench_setup") {
    const bench = enumArg(args.bench, ["bankertoolbench", "finch", "finauditing", "workstreambench"]);
    const commandArgs = ["setup", bench];
    if (booleanArg(args.doctor, true)) commandArgs.push("--doctor");
    if (booleanArg(args.allowDownload, false)) commandArgs.push("--allow-download");
    return commandArgs;
  }
  if (name === "proofloop_memory_seed_dogfood") return ["memory", "seed-dogfood"];
  if (name === "proofloop_graph_ingest") {
    const commandArgs = ["graph", "ingest", "--backend", enumArg(args.backend, ["local", "neo4j"], "neo4j")];
    const include = stringArg(args.include);
    if (include) commandArgs.push("--include", include);
    return commandArgs;
  }
  if (name === "proofloop_dashboard_export") return ["dashboard", "export", stringArg(args.target) ?? "latest"];
  if (name === "proofloop_repair_latest") return ["repair", "latest"];
  if (name === "proofloop_codex_reprompt_latest") return ["codex", "reprompt", "latest"];
  if (name === "proofloop_gate_official_scores") return ["gate", "--goal", "official-scores"];
  return undefined;
}

function commandToolResult(result: ProofloopMcpCommandResult): ToolResult {
  const text = [
    `Command: ${result.command} ${result.args.join(" ")}`,
    `Exit code: ${result.exitCode}`,
    result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : undefined,
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : undefined,
  ].filter(Boolean).join("\n\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: result,
    ...(result.exitCode === 0 ? {} : { isError: true }),
  };
}

function runProofloopCliCommand(args: string[], root: string): ProofloopMcpCommandResult {
  const result = spawnSync("npm", ["run", "proofloop", "--", ...args], {
    cwd: root,
    shell: process.platform === "win32",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  return {
    command: "npm run proofloop --",
    args,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function handleLine(line: string, root: string): Promise<void> {
  const normalizedLine = line.trim().replace(/^\uFEFF/, "");
  if (!normalizedLine) return;
  let request: ProofloopMcpRequest;
  try {
    request = JSON.parse(normalizedLine) as ProofloopMcpRequest;
  } catch (error) {
    writeResponse(response(null, undefined, rpcError(-32700, error instanceof Error ? error.message : String(error))));
    return;
  }
  const result = await handleProofloopMcpRequest(request, { root });
  writeResponse(result);
}

function textResult(text: string, structuredContent: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
}

function booleanArg(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function enumArg<const T extends string>(value: unknown, allowed: readonly T[], defaultValue?: T): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Expected one of: ${allowed.join(", ")}`);
}

function response(id: JsonRpcId | undefined, result?: unknown, error?: { code: number; message: string }): ProofloopMcpResponse | undefined {
  if (id === undefined) return undefined;
  return error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
}

function writeResponse(value: ProofloopMcpResponse | undefined): void {
  if (!value) return;
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function rpcError(code: number, message: string): { code: number; message: string } {
  return { code, message };
}
