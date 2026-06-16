export type NodeAgentOmnigentProfile = "room-worker" | "reviewer";

export interface NodeAgentOmnigentCommandRequirement {
  command: string;
  reason: string;
}

export interface NodeAgentOmnigentSpecTarget {
  profile: NodeAgentOmnigentProfile;
  path: string;
  expectedName: string;
  requiredCommands: NodeAgentOmnigentCommandRequirement[];
}

export interface NodeAgentOmnigentSpecAnalysis {
  ok: boolean;
  path: string;
  profile: NodeAgentOmnigentProfile;
  name?: string;
  executorHarness?: string;
  executorType?: string;
  osEnvType?: string;
  cwd?: string;
  terminalNames: string[];
  hasPromptOrInstructions: boolean;
  hasNodeAgentBoundary: boolean;
  hasConvexBoundary: boolean;
  hasSecretLiteral: boolean;
  requiredCommands: Array<NodeAgentOmnigentCommandRequirement & { present: boolean }>;
  runCommand: string;
  legacyRunCommand: string;
  issues: string[];
}

export const NODEAGENT_OMNIGENT_SPEC_TARGETS: NodeAgentOmnigentSpecTarget[] = [
  {
    profile: "room-worker",
    path: "examples/omnigent/nodeagent-room.yaml",
    expectedName: "nodeagent_room_worker",
    requiredCommands: [
      {
        command: "npm run nodeagent:frame:smoke",
        reason: "proves the adoptable NodeAgent frame bridge without provider keys",
      },
      {
        command: "npm test -- --run tests/agentJobsSource.test.ts tests/agentJobsRuntime.test.ts tests/frameRunner.test.ts tests/nodeagentFrameSmoke.test.ts",
        reason: "proves durable job frames, frame runtime, and adoption smoke together",
      },
      {
        command: "npm run omnigent:nodeagent:smoke",
        reason: "proves Omnigent YAML and NodeAgent adapter compatibility",
      },
      {
        command: "npm run build",
        reason: "proves the application still builds after NodeAgent changes",
      },
      {
        command: "npx tsc --noEmit --project convex/tsconfig.json --pretty false",
        reason: "proves Convex functions still typecheck",
      },
    ],
  },
  {
    profile: "reviewer",
    path: "examples/omnigent/nodeagent-reviewer.yaml",
    expectedName: "nodeagent_review_harness",
    requiredCommands: [],
  },
];

const SECRET_LITERAL_PATTERN = /\b(?:OPENAI|OPENROUTER|ANTHROPIC|GEMINI|CONVEX|DATABRICKS|CURSOR)_[A-Z0-9_]*(?:API_)?KEY\s*[:=]\s*["']?[A-Za-z0-9_\-.]{12,}/;

function linesOf(text: string) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function indentOf(line: string) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function topLevelScalar(text: string, key: string) {
  const pattern = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m");
  const match = text.match(pattern);
  return match?.[1] ? stripQuotes(match[1]) : undefined;
}

function blockForKey(text: string, key: string) {
  const lines = linesOf(text);
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:$|#)`).test(line));
  if (start < 0) return "";
  const baseIndent = indentOf(lines[start]);
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() && indentOf(line) <= baseIndent) break;
    block.push(line);
  }
  return block.join("\n");
}

function scalarInBlock(block: string, key: string) {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m");
  const match = block.match(pattern);
  return match?.[1] ? stripQuotes(match[1]) : undefined;
}

function nestedBlock(block: string, key: string) {
  const lines = linesOf(block);
  const start = lines.findIndex((line) => new RegExp(`^\\s*${key}:\\s*(?:$|#)`).test(line));
  if (start < 0) return "";
  const baseIndent = indentOf(lines[start]);
  const nested: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() && indentOf(line) <= baseIndent) break;
    nested.push(line);
  }
  return nested.join("\n");
}

function terminalNames(text: string) {
  const block = blockForKey(text, "terminals");
  if (!block) return [];
  return linesOf(block)
    .map((line) => line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)?.[1])
    .filter((name): name is string => Boolean(name));
}

function hasPromptOrInstructions(text: string) {
  return /^prompt:\s*(?:\||>|\S)/m.test(text) || /^instructions:\s*(?:\||>|\S)/m.test(text);
}

function profileForPath(path: string): NodeAgentOmnigentProfile {
  return path.includes("reviewer") ? "reviewer" : "room-worker";
}

function targetFor(path: string, profile?: NodeAgentOmnigentProfile) {
  return NODEAGENT_OMNIGENT_SPEC_TARGETS.find((candidate) => (
    candidate.path === path || candidate.profile === profile
  ));
}

export function analyzeNodeAgentOmnigentSpec(args: {
  path: string;
  text: string;
  profile?: NodeAgentOmnigentProfile;
}): NodeAgentOmnigentSpecAnalysis {
  const profile = args.profile ?? profileForPath(args.path);
  const target = targetFor(args.path, profile);
  const executor = blockForKey(args.text, "executor");
  const executorConfig = nestedBlock(executor, "config");
  const osEnv = blockForKey(args.text, "os_env");
  const name = topLevelScalar(args.text, "name");
  const executorHarness = scalarInBlock(executor, "harness") ?? scalarInBlock(executorConfig, "harness");
  const executorType = scalarInBlock(executor, "type");
  const osEnvType = scalarInBlock(osEnv, "type");
  const cwd = scalarInBlock(osEnv, "cwd");
  const requiredCommands = (target?.requiredCommands ?? []).map((requirement) => ({
    ...requirement,
    present: args.text.includes(requirement.command),
  }));
  const hasNodeAgentBoundary = /NodeAgent owns/i.test(args.text)
    && /Omnigent (?:is only|stays|should remain|as the outer|outer)/i.test(args.text);
  const hasConvexBoundary = /Convex/i.test(args.text) && /source of truth|durable/i.test(args.text);
  const hasSecretLiteral = SECRET_LITERAL_PATTERN.test(args.text);
  const issues: string[] = [];

  if (!name) issues.push("missing top-level name");
  if (target && name !== target.expectedName) issues.push(`expected name ${target.expectedName}`);
  if (!hasPromptOrInstructions(args.text)) issues.push("missing prompt or instructions");
  if (!executorHarness && executorType !== "omnigent") issues.push("missing executor harness");
  if (osEnvType !== "caller_process") issues.push("os_env.type must be caller_process for repo-local NodeAgent work");
  if (cwd !== ".") issues.push("os_env.cwd must be . so relative repo commands work");
  if (!hasNodeAgentBoundary) issues.push("missing NodeAgent/Omnigent ownership boundary");
  if (!hasConvexBoundary) issues.push("missing Convex durable-state boundary");
  if (hasSecretLiteral) issues.push("contains an inline secret-looking value");
  for (const command of requiredCommands) {
    if (!command.present) issues.push(`missing required command: ${command.command}`);
  }

  return {
    ok: issues.length === 0,
    path: args.path,
    profile,
    name,
    executorHarness,
    executorType,
    osEnvType,
    cwd,
    terminalNames: terminalNames(args.text),
    hasPromptOrInstructions: hasPromptOrInstructions(args.text),
    hasNodeAgentBoundary,
    hasConvexBoundary,
    hasSecretLiteral,
    requiredCommands,
    runCommand: `omni run ${args.path}`,
    legacyRunCommand: `omnigent run ${args.path}`,
    issues,
  };
}

export function summarizeNodeAgentOmnigentAnalysis(analysis: NodeAgentOmnigentSpecAnalysis) {
  const harness = analysis.executorHarness ?? analysis.executorType ?? "unknown";
  const commandSummary = analysis.requiredCommands.length
    ? `${analysis.requiredCommands.filter((command) => command.present).length}/${analysis.requiredCommands.length} commands`
    : "no command requirements";
  return `${analysis.path}: ${analysis.ok ? "PASS" : "FAIL"} name=${analysis.name ?? "missing"} harness=${harness} ${commandSummary}`;
}
