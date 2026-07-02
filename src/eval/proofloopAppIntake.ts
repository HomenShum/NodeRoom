import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export type ProofloopAppAdapterId =
  | "noderoom"
  | "nextjs-app"
  | "vite-app"
  | "static-html-prototype"
  | "generic-web-app";

export type ProofloopDetectedAppAdapter = {
  id: ProofloopAppAdapterId;
  name: string;
  confidence: number;
  evidence: string[];
  setupCommands: string[];
  startCommand?: string;
  baseUrl: string;
  workflows: ProofloopWorkflowSummary[];
};

export type ProofloopWorkflowSummary = {
  id: string;
  name: string;
  goal: string;
  expectedOutcome: string;
};

export type ProofloopWorkflowSpec = {
  schema: "proofloop-workflow-v1";
  id: string;
  name: string;
  app: {
    kind: "web";
    adapterId: ProofloopAppAdapterId;
    baseUrl: string;
  };
  persona: {
    name: string;
    description: string;
  };
  workflow: {
    goal: string;
    expectedOutcome: string;
  };
  steps: Array<Record<string, string | Record<string, string>>>;
  proofGates: string[];
};

export type ProofloopThisRepoReport = {
  schema: "proofloop-this-repo-v1";
  generatedAt: string;
  rootName: string;
  goal: string;
  primaryAdapter: ProofloopAppAdapterId;
  adapters: ProofloopDetectedAppAdapter[];
  workflow: ProofloopWorkflowSpec;
  fastDeterministicGates: string[];
  liveBrowserProofCommand: string;
  nextCommands: string[];
  blockers: string[];
};

export type ProofloopThisRepoWritePaths = {
  intakeReportPath: string;
  workflowSpecPath: string;
};

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type BuildOptions = {
  root?: string;
  goal?: string;
  now?: () => Date;
};

const PRIMARY_WORKFLOW_ID = "primary-agent-workflow";
const DEFAULT_GOAL = "Make the primary agent workflow proof-ready.";

export function buildProofloopThisRepoPlan(options: BuildOptions = {}): ProofloopThisRepoReport {
  const root = resolve(options.root ?? process.cwd());
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const goal = options.goal?.trim() || DEFAULT_GOAL;
  const packageJson = readPackageJson(root);
  const adapters = detectAppAdapters(root, packageJson);
  const primary = adapters[0] ?? genericAdapter(root, packageJson, ["fallback: no stronger web-app adapter detected"]);
  const workflow = workflowSpecFor(primary, goal);
  const fastDeterministicGates = fastGatesFor(packageJson, primary);
  const blockers = blockersFor(packageJson, primary);
  const nextCommands = [
    ...primary.setupCommands,
    ...(primary.startCommand ? [primary.startCommand] : []),
    liveBrowserProofCommand(primary),
    "npm run proofloop -- storybook latest",
  ];

  return {
    schema: "proofloop-this-repo-v1",
    generatedAt,
    rootName: basename(root),
    goal,
    primaryAdapter: primary.id,
    adapters,
    workflow,
    fastDeterministicGates,
    liveBrowserProofCommand: liveBrowserProofCommand(primary),
    nextCommands: [...new Set(nextCommands)],
    blockers,
  };
}

export function writeProofloopThisRepoPlan(
  report: ProofloopThisRepoReport,
  options: { root?: string } = {},
): ProofloopThisRepoWritePaths {
  const root = resolve(options.root ?? process.cwd());
  const intakeReportPath = join(root, ".proofloop", "intake", "this-repo.json");
  const workflowSpecPath = join(root, ".proofloop", "workflows", `${report.workflow.id}.json`);
  writeJson(intakeReportPath, report);
  writeJson(workflowSpecPath, report.workflow);
  return { intakeReportPath, workflowSpecPath };
}

export function detectAppAdapters(root: string, packageJson: PackageJson | null = readPackageJson(root)): ProofloopDetectedAppAdapter[] {
  const candidates = [
    detectNodeRoom(root, packageJson),
    detectNextJs(root, packageJson),
    detectVite(root, packageJson),
    detectStaticHtml(root),
    genericAdapter(root, packageJson, ["fallback: generic browser app workflow"]),
  ].filter((adapter): adapter is ProofloopDetectedAppAdapter => Boolean(adapter));

  return candidates.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

function detectNodeRoom(root: string, packageJson: PackageJson | null): ProofloopDetectedAppAdapter | undefined {
  const evidence = [
    packageJson?.name === "noderoom" ? "package.json name is noderoom" : undefined,
    existsSync(join(root, "src", "nodeagent")) ? "src/nodeagent exists" : undefined,
    existsSync(join(root, "proofloop", "scenarios", "proximittyHarness.ts")) ? "Proof Loop NodeRoom reference scenarios exist" : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (!evidence.length) return undefined;
  const devCommand = scriptCommand(packageJson, "dev");
  return {
    id: "noderoom",
    name: "NodeRoom reference adapter",
    confidence: 0.96,
    evidence,
    setupCommands: setupCommandsFor(root, packageJson),
    startCommand: devCommand ? "npm run dev" : undefined,
    baseUrl: "http://localhost:5173",
    workflows: [
      {
        id: PRIMARY_WORKFLOW_ID,
        name: "Primary NodeRoom agent workflow",
        goal: "Run a user-visible agent task through the live room UI.",
        expectedOutcome: "The app shows agent progress, a visible output artifact, and Proof Loop receipts.",
      },
    ],
  };
}

function detectNextJs(root: string, packageJson: PackageJson | null): ProofloopDetectedAppAdapter | undefined {
  const deps = dependencyNames(packageJson);
  const evidence = [
    deps.has("next") ? "next dependency found" : undefined,
    existsSync(join(root, "next.config.js")) || existsSync(join(root, "next.config.mjs")) || existsSync(join(root, "next.config.ts"))
      ? "Next.js config found"
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (!evidence.length) return undefined;
  const devCommand = scriptCommand(packageJson, "dev");
  return {
    id: "nextjs-app",
    name: "Next.js browser app adapter",
    confidence: 0.82,
    evidence,
    setupCommands: setupCommandsFor(root, packageJson),
    startCommand: devCommand ? "npm run dev" : undefined,
    baseUrl: "http://localhost:3000",
    workflows: [genericWorkflowSummary()],
  };
}

function detectVite(root: string, packageJson: PackageJson | null): ProofloopDetectedAppAdapter | undefined {
  const deps = dependencyNames(packageJson);
  const evidence = [
    deps.has("vite") ? "vite dependency found" : undefined,
    existsSync(join(root, "vite.config.ts")) || existsSync(join(root, "vite.config.js")) || existsSync(join(root, "vite.config.mjs"))
      ? "Vite config found"
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (!evidence.length) return undefined;
  const devCommand = scriptCommand(packageJson, "dev");
  return {
    id: "vite-app",
    name: "Vite browser app adapter",
    confidence: 0.78,
    evidence,
    setupCommands: setupCommandsFor(root, packageJson),
    startCommand: devCommand ? "npm run dev" : undefined,
    baseUrl: "http://localhost:5173",
    workflows: [genericWorkflowSummary()],
  };
}

function detectStaticHtml(root: string): ProofloopDetectedAppAdapter | undefined {
  const evidence = [
    existsSync(join(root, "index.html")) ? "index.html found" : undefined,
    existsSync(join(root, "public", "index.html")) ? "public/index.html found" : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (!evidence.length) return undefined;
  return {
    id: "static-html-prototype",
    name: "Static HTML prototype adapter",
    confidence: 0.62,
    evidence,
    setupCommands: [],
    startCommand: "python -m http.server 4173",
    baseUrl: "http://localhost:4173",
    workflows: [genericWorkflowSummary()],
  };
}

function genericAdapter(root: string, packageJson: PackageJson | null, evidence: string[]): ProofloopDetectedAppAdapter {
  const devCommand = scriptCommand(packageJson, "dev") ?? scriptCommand(packageJson, "start") ?? scriptCommand(packageJson, "preview");
  const commandName = devCommand === scriptCommand(packageJson, "dev") ? "dev" : devCommand === scriptCommand(packageJson, "start") ? "start" : "preview";
  return {
    id: "generic-web-app",
    name: "Generic browser app adapter",
    confidence: existsSync(join(root, "package.json")) ? 0.3 : 0.15,
    evidence,
    setupCommands: setupCommandsFor(root, packageJson),
    startCommand: devCommand ? `npm run ${commandName}` : undefined,
    baseUrl: "http://localhost:3000",
    workflows: [genericWorkflowSummary()],
  };
}

function workflowSpecFor(adapter: ProofloopDetectedAppAdapter, goal: string): ProofloopWorkflowSpec {
  const summary = adapter.workflows[0] ?? genericWorkflowSummary(goal);
  return {
    schema: "proofloop-workflow-v1",
    id: summary.id,
    name: summary.name,
    app: {
      kind: "web",
      adapterId: adapter.id,
      baseUrl: adapter.baseUrl,
    },
    persona: {
      name: "target_user",
      description: "The user this browser-based agent workflow is designed to serve.",
    },
    workflow: {
      goal: goal || summary.goal,
      expectedOutcome: summary.expectedOutcome,
    },
    steps: [
      { goto: "/" },
      { assertVisible: "body" },
      { assertNoMockFallback: "true" },
      { captureScreenshot: "initial-ui" },
      { runUserVisibleAgentTask: summary.goal },
      { captureScreenshot: "final-ui" },
    ],
    proofGates: [
      "build_gate",
      "typecheck_gate",
      "health_gate",
      "route_gate",
      "fresh_browser_context",
      "real_ui_navigation",
      "user_visible_agent_invocation",
      "screenshot_captured",
      "node_trace_v2_written",
      "node_eval_written",
      "verifier_receipt_written",
    ],
  };
}

function genericWorkflowSummary(goal = DEFAULT_GOAL): ProofloopWorkflowSummary {
  return {
    id: PRIMARY_WORKFLOW_ID,
    name: "Primary agent workflow",
    goal,
    expectedOutcome: "The intended user workflow completes in the real browser UI with visible output and proof artifacts.",
  };
}

function setupCommandsFor(root: string, packageJson: PackageJson | null): string[] {
  if (!packageJson) return [];
  if (existsSync(join(root, "package-lock.json"))) return ["npm ci"];
  return ["npm install"];
}

function fastGatesFor(packageJson: PackageJson | null, adapter: ProofloopDetectedAppAdapter): string[] {
  const gates = ["setup_doctor", "health_gate", "route_gate", "mock_fallback_gate"];
  if (scriptCommand(packageJson, "typecheck")) gates.unshift("typecheck_gate");
  if (scriptCommand(packageJson, "build")) gates.unshift("build_gate");
  if (adapter.startCommand) gates.push("local_server_start_gate");
  return [...new Set(gates)];
}

function blockersFor(packageJson: PackageJson | null, adapter: ProofloopDetectedAppAdapter): string[] {
  const blockers: string[] = [];
  if (!packageJson) blockers.push("package.json missing; Proof Loop cannot infer Node-based setup commands.");
  if (!adapter.startCommand) blockers.push("No dev/start/preview command detected; add a local start command or pass a base URL.");
  return blockers;
}

function liveBrowserProofCommand(adapter: ProofloopDetectedAppAdapter): string {
  if (adapter.id === "noderoom") return "npm run proofloop -- run browser-live --cockpit --user-emulation strict";
  return "npm run proofloop -- run browser-live --cockpit --user-emulation strict";
}

function scriptCommand(packageJson: PackageJson | null, name: string): string | undefined {
  return packageJson?.scripts?.[name];
}

function dependencyNames(packageJson: PackageJson | null): Set<string> {
  return new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);
}

function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function relativeProofloopPath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}
