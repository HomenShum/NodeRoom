import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

export type ProofloopAgentKind = "codex" | "claude" | "cursor" | "windsurf";
export type ProofloopDoctorStatus = "pass" | "warn" | "fail";

export const PROOFLOOP_AGENT_DOC_START = "<!-- proofloop-agent-friendly:start -->";
export const PROOFLOOP_AGENT_DOC_END = "<!-- proofloop-agent-friendly:end -->";

export type ProofloopCliCommandManifest = {
  id: string;
  usage: string;
  purpose: string;
  writes: "none" | "local-proof-state" | "repo-config" | "repo-docs" | "proof-artifacts";
  json: boolean;
  options: string[];
  responseShape: string;
};

export type ProofloopCliManifest = {
  schema: "proofloop-cli-manifest-v1";
  recommendedInvocation: string;
  contextStrategy: string;
  principles: string[];
  commands: ProofloopCliCommandManifest[];
  stableErrorCodes: string[];
  projectManifestPath: string;
};

export type ProofloopDoctorCheck = {
  id: string;
  title: string;
  status: ProofloopDoctorStatus;
  detail: string;
  fix?: string;
};

export type ProofloopDoctorReport = {
  schema: "proofloop-doctor-v1";
  status: ProofloopDoctorStatus;
  root: string;
  checks: ProofloopDoctorCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
};

export type ProofloopDocsTopic = {
  schema: "proofloop-doc-topic-v1";
  topic: string;
  title: string;
  dense: string;
  sections: Array<{
    heading: string;
    body: string[];
    commands?: string[];
  }>;
};

export type WriteProofloopAgentDocsResult = {
  path: string;
  agent: ProofloopAgentKind;
  created: boolean;
  changed: boolean;
};

export function proofloopCliManifest(): ProofloopCliManifest {
  return {
    schema: "proofloop-cli-manifest-v1",
    recommendedInvocation: "npm run proofloop -- <command>",
    contextStrategy:
      "Use short CLI commands for discovery, docs, health, and proof gates so agents load only the slice they need.",
    principles: [
      "Goal is a measurable contract, not a transcript.",
      "Doctor and manifest are read-only discovery commands.",
      "Certification artifacts are locked; exploration artifacts can propose improvements.",
      "Completion claims must pass a verifier or gate.",
    ],
    stableErrorCodes: [
      "PROOFLOOP_CONFIG_MISSING",
      "PROOFLOOP_AGENT_DOCS_MISSING",
      "PROOFLOOP_PACKAGE_SCRIPT_MISSING",
      "PROOFLOOP_GITIGNORE_INCOMPLETE",
      "PROOFLOOP_MANIFEST_MISSING",
      "PROOFLOOP_UI_CONTRACTS_MISSING",
      "PROOFLOOP_PLAYWRIGHT_MISSING",
    ],
    projectManifestPath: ".proofloop/manifest.json",
    commands: [
      {
        id: "manifest",
        usage: "proofloop manifest --json",
        purpose: "Return the machine-readable command surface for agents.",
        writes: "none",
        json: true,
        options: ["--json", "--dense"],
        responseShape: "ProofloopCliManifest",
      },
      {
        id: "doctor",
        usage: "proofloop doctor --json",
        purpose: "Run read-only setup checks before an agent claims ProofLoop is installed.",
        writes: "none",
        json: true,
        options: ["--json", "--dense"],
        responseShape: "ProofloopDoctorReport",
      },
      {
        id: "docs",
        usage: "proofloop docs agents --dense",
        purpose: "Print compact task-oriented docs without loading a large manual.",
        writes: "none",
        json: true,
        options: ["--json", "--dense"],
        responseShape: "ProofloopDocsTopic",
      },
      {
        id: "init",
        usage: "proofloop init --features agents,live --agent auto",
        purpose: "Install .proofloop config and optional agent-facing instructions.",
        writes: "repo-docs",
        json: false,
        options: ["--features agents,live,github", "--agent auto|all|codex|claude|cursor|windsurf", "--agent-docs-path <path>", "--live"],
        responseShape: "console log",
      },
      {
        id: "template",
        usage: "proofloop template --list",
        purpose: "List or write workflow/rubric/red-team starter templates.",
        writes: "repo-config",
        json: true,
        options: ["--list", "--json", "--dense", "--write", "--force"],
        responseShape: "ProofloopTemplate[]",
      },
      {
        id: "workflow",
        usage: "proofloop workflow --list",
        purpose: "List generated proof workflows in this repo.",
        writes: "none",
        json: true,
        options: ["--list", "--json", "--dense"],
        responseShape: "workflow path list",
      },
      {
        id: "ui",
        usage: "proofloop ui contract --dense",
        purpose: "Expose agent-readable UI selectors and assertions so workers do not guess selectors.",
        writes: "none",
        json: true,
        options: ["list", "contract", "component <name>", "--json", "--dense"],
        responseShape: "ProofloopUiContract[]",
      },
      {
        id: "this-repo",
        usage: "proofloop this-repo --live",
        purpose: "Start the long-running repo-level orchestrator on a natural-language goal.",
        writes: "local-proof-state",
        json: false,
        options: ["--live", "--goal <text>", "--max-steps <n>"],
        responseShape: "orchestrator receipt paths",
      },
      {
        id: "supervise",
        usage: "proofloop supervise --goal <goal-id>",
        purpose: "Continue a persisted goal until it passes, fails, or reaches a terminal blocker.",
        writes: "local-proof-state",
        json: false,
        options: ["--goal <goal-id>", "--max-steps <n>"],
        responseShape: "goal status",
      },
      {
        id: "gate",
        usage: "proofloop gate --goal <goal-id>",
        purpose: "Pass only when the persisted goal ledger is complete and verified.",
        writes: "proof-artifacts",
        json: false,
        options: ["--goal <goal-id>"],
        responseShape: "goal status plus chart artifacts",
      },
      {
        id: "hooks",
        usage: "proofloop hooks install --worker claude-code",
        purpose: "Install stop/tool-use guards that refuse fake done and verifier weakening.",
        writes: "repo-config",
        json: false,
        options: ["install", "uninstall", "status", "--worker claude-code", "--local", "--dir <path>"],
        responseShape: "hook install/status log",
      },
      {
        id: "ci",
        usage: "proofloop ci install github --goal official-scores",
        purpose: "Install a GitHub proof gate that fails closed on unfinished goal ledgers.",
        writes: "repo-config",
        json: false,
        options: ["install github", "--dir <path>", "--goal <goal-id>"],
        responseShape: "workflow path",
      },
      {
        id: "repair",
        usage: "proofloop repair latest",
        purpose: "Turn a failed run into a focused repair prompt and evidence bundle.",
        writes: "proof-artifacts",
        json: false,
        options: ["<runId|latest>"],
        responseShape: "repair prompt path plus text",
      },
      {
        id: "report",
        usage: "proofloop report latest",
        purpose: "Alias for showing the latest proof receipt/scorecard.",
        writes: "none",
        json: false,
        options: ["<runId|latest>"],
        responseShape: "scorecard text",
      },
      {
        id: "memory",
        usage: "proofloop memory search \"<query>\"",
        purpose: "Search compact local proof memory instead of replaying stale transcripts.",
        writes: "local-proof-state",
        json: false,
        options: ["init", "compact latest", "search <query>", "show <id>", "doctor"],
        responseShape: "memory command output",
      },
    ],
  };
}

export function runProofloopDoctor(root = process.cwd()): ProofloopDoctorReport {
  const checks: ProofloopDoctorCheck[] = [];
  checks.push(checkPackageScript(root));
  checks.push(checkLocalCliWrapper(root));
  checks.push(checkConfig(root));
  checks.push(checkManifest(root));
  checks.push(checkAgentDocs(root));
  checks.push(checkPackageScriptAliases(root));
  checks.push(checkPlaywright(root));
  checks.push(checkUiContracts(root));
  checks.push(checkProofloopGithubWorkflow(root));
  checks.push(checkGitignore(root));
  checks.push(checkNodeVersion());
  const summary = countStatuses(checks);
  const status: ProofloopDoctorStatus = summary.fail > 0 ? "fail" : summary.warn > 0 ? "warn" : "pass";
  return {
    schema: "proofloop-doctor-v1",
    status,
    root,
    checks,
    summary,
  };
}

export function formatProofloopDoctor(report: ProofloopDoctorReport, options: { dense?: boolean } = {}): string {
  const heading = `proofloop doctor: ${report.status} (${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail)`;
  const checks = options.dense ? report.checks.filter((check) => check.status !== "pass") : report.checks;
  if (checks.length === 0) return heading;
  return [
    heading,
    ...checks.map((check) => {
      const fix = check.fix ? ` Fix: ${check.fix}` : "";
      return `- ${check.status.toUpperCase()} ${check.id}: ${check.detail}${fix}`;
    }),
  ].join("\n");
}

export function formatProofloopCliManifest(manifest: ProofloopCliManifest, options: { dense?: boolean } = {}): string {
  if (options.dense) {
    return [
      "proofloop manifest",
      `invoke: ${manifest.recommendedInvocation}`,
      ...manifest.commands.map((command) => `- ${command.id}: ${command.usage}`),
    ].join("\n");
  }
  return [
    "ProofLoop CLI manifest",
    "",
    manifest.contextStrategy,
    "",
    "Commands:",
    ...manifest.commands.map((command) => `  ${command.usage.padEnd(58)} ${command.purpose}`),
  ].join("\n");
}

export function renderProofloopAgentDocs(options: { agent?: ProofloopAgentKind } = {}): string {
  const agent = options.agent ?? "codex";
  const agentName = agent === "claude" ? "Claude Code" : agent === "cursor" ? "Cursor" : agent === "windsurf" ? "Windsurf" : "Codex";
  return [
    PROOFLOOP_AGENT_DOC_START,
    "## ProofLoop Agent-Friendly CLI",
    "",
    `These instructions are generated for ${agentName}. Keep ProofLoop usage on-demand: ask the CLI for the slice you need instead of loading broad MCP state or stale transcripts.`,
    "",
    "Discovery:",
    "- `npm run proofloop -- manifest --json` - machine-readable command surface.",
    "- `npm run proofloop -- manifest --dense` - compact repo status, commands, suites, and UI contracts.",
    "- `npm run proofloop -- docs agents --dense` - compact agent workflow.",
    "- `npm run proofloop -- doctor --json` - read-only setup proof before claiming installed.",
    "- `npm run proofloop -- ui contract --dense` - stable selectors/actions/assertions before browser work.",
    "",
    "Long-running loop:",
    "- `npm run proofloop -- this-repo --live` starts repo dogfooding with a persisted goal ledger.",
    "- `npm run proofloop -- supervise --goal <goal-id>` continues the loop until pass/fail/blocker.",
    "- `npm run proofloop -- gate --goal <goal-id>` is the completion gate; do not replace it with a transcript summary.",
    "- `npm run proofloop -- resume --goal <goal-id> --dense` prints the next action when the loop stops.",
    "- `npm run proofloop -- repair latest` converts a failed run into the next focused repair prompt.",
    "- `npm run proofloop -- memory search \"<failure or fixture>\"` recalls compacted prior failures without dragging full logs into context.",
    "",
    "Rules:",
    "- Treat the user goal as the contract. Keep referencing what is not done until the gate passes.",
    "- Do not claim done from chat, screenshots, or worker assertions. Claim done only from a deterministic gate, official scorer, or proof receipt.",
    "- Keep certification-loop assets locked. Exploration can propose scenarios and scaffold changes, but it cannot grade or promote itself.",
    "- Track harness versions, model routes, costs, blocked lanes, and official-score artifacts in receipts.",
    "- Cheaper model routing is allowed for exploration and shadow runs; official scores require the official scorer or an explicitly recorded equivalent judge contract.",
    "- If a local dependency is missing, run `npm run proofloop -- doctor --json` and fix local safe failures before blocking.",
    "- If official scoring is blocked, keep proxy/product-path proof moving and label it honestly in receipts.",
    "- Use the code graph and UI contracts before guessing files, selectors, or routes.",
    "",
    PROOFLOOP_AGENT_DOC_END,
  ].join("\n");
}

export function writeProofloopAgentDocs(options: {
  root?: string;
  agent?: ProofloopAgentKind;
  agentDocsPath?: string;
} = {}): WriteProofloopAgentDocsResult {
  const root = options.root ?? process.cwd();
  const agent = options.agent ?? "codex";
  const path = resolveAgentDocsPath(root, agent, options.agentDocsPath);
  const created = !existsSync(path);
  const existing = created ? "" : readFileSync(path, "utf8");
  const next = upsertMarkedSection(existing, renderProofloopAgentDocs({ agent }));
  if (next !== existing) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, "utf8");
  }
  return {
    path,
    agent,
    created,
    changed: next !== existing,
  };
}

export function resolveAgentDocsPath(root: string, agent: ProofloopAgentKind, explicitPath?: string): string {
  if (explicitPath) return isAbsolute(explicitPath) ? explicitPath : resolve(root, explicitPath);
  if (agent === "claude") return join(root, "CLAUDE.md");
  if (agent === "cursor") return join(root, ".cursor", "rules", "proofloop.mdc");
  if (agent === "windsurf") return join(root, ".windsurf", "rules", "proofloop.md");
  return join(root, "AGENTS.md");
}

export function proofloopDocsTopic(topicArg = "getting-started"): ProofloopDocsTopic {
  const topic = topicArg.toLowerCase();
  if (topic === "agents") {
    return {
      schema: "proofloop-doc-topic-v1",
      topic,
      title: "Agent Workflow",
      dense:
        "Use manifest -> doctor -> this-repo/supervise -> gate. Keep context small, keep the goal ledger live, and never claim completion without a verifier.",
      sections: [
        {
          heading: "Fast Path",
          body: ["Use the CLI as the agent control surface. Pull only the command, receipt, or repair prompt needed for the next step."],
          commands: [
            "npm run proofloop -- manifest --json",
            "npm run proofloop -- doctor --json",
            "npm run proofloop -- ui contract --dense",
            "npm run proofloop -- this-repo --live",
            "npm run proofloop -- gate --goal <goal-id>",
          ],
        },
        {
          heading: "Failure Handling",
          body: ["If a gate fails, run repair or memory search, change the product or harness, then rerun the verifier."],
          commands: ["npm run proofloop -- repair latest", "npm run proofloop -- memory search \"<failure>\""],
        },
      ],
    };
  }
  if (topic === "long-running") {
    return {
      schema: "proofloop-doc-topic-v1",
      topic,
      title: "Long-Running ProofLoop",
      dense:
        "Goal contract, separate judge, deterministic verifiers, outer loop, role/model orchestration, observability, and session-mined memory.",
      sections: [
        {
          heading: "Control Loop",
          body: [
            "A worker executes. ProofLoop supervises. Gates and receipts decide whether the work is done.",
            "Persist unfinished tasks, blockers, harness versions, model routes, and proof artifacts outside the prompt transcript.",
          ],
          commands: [
            "npm run proofloop -- goal init <goal-id> --template official-scores",
            "npm run proofloop -- supervise --goal <goal-id>",
          ],
        },
      ],
    };
  }
  if (topic === "cli") {
    return {
      schema: "proofloop-doc-topic-v1",
      topic,
      title: "CLI Surface",
      dense: "Read-only discovery commands first; write commands only when the goal calls for setup, execution, templates, hooks, or CI.",
      sections: [
        {
          heading: "Discovery",
          body: ["`manifest`, `docs`, and `doctor` are the low-context entrypoints for agents."],
          commands: [
            "npm run proofloop -- manifest --json",
            "npm run proofloop -- docs getting-started --dense",
            "npm run proofloop -- doctor --json",
            "npm run proofloop -- template --list",
            "npm run proofloop -- ui list --dense",
          ],
        },
      ],
    };
  }
  return {
    schema: "proofloop-doc-topic-v1",
    topic: "getting-started",
    title: "Getting Started",
    dense:
      "Install deps, initialize ProofLoop, generate agent docs/manifest/scripts, run doctor, then start the long-running goal through this-repo or supervise.",
    sections: [
      {
        heading: "Setup",
        body: [
          "Use the repo script as the stable invocation so agents do not guess binary paths.",
          "Generate agent docs once, then let agents discover the rest through manifest/docs/doctor.",
        ],
        commands: [
          "npm install",
          "npm run proofloop -- init --features agents,live --agent auto",
          "npm run proofloop -- doctor --json",
          "npm run proofloop -- manifest --dense",
        ],
      },
      {
        heading: "Run",
        body: ["Start with a measurable goal and let the gate decide completion."],
        commands: [
          "npm run proofloop -- this-repo --live",
          "npm run proofloop -- resume --goal default --dense",
          "npm run proofloop -- gate --goal default",
        ],
      },
    ],
  };
}

export function formatProofloopDocsTopic(topic: ProofloopDocsTopic, options: { dense?: boolean } = {}): string {
  if (options.dense) return `${topic.title}: ${topic.dense}`;
  return [
    `ProofLoop docs: ${topic.title}`,
    "",
    topic.dense,
    "",
    ...topic.sections.flatMap((section) => [
      section.heading,
      ...section.body.map((line) => `  ${line}`),
      ...(section.commands ?? []).map((command) => `  $ ${command}`),
      "",
    ]),
  ].join("\n").trimEnd();
}

function checkPackageScript(root: string): ProofloopDoctorCheck {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    return {
      id: "PROOFLOOP_PACKAGE_SCRIPT_MISSING",
      title: "package.json",
      status: "fail",
      detail: "package.json is missing, so the stable npm script cannot be verified.",
      fix: "Run from a project root or add a package.json with a proofloop script.",
    };
  }
  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> };
    const script = pkg.scripts?.proofloop;
    if (!script) {
      return {
        id: "PROOFLOOP_PACKAGE_SCRIPT_MISSING",
        title: "proofloop npm script",
        status: "fail",
        detail: "package.json does not define scripts.proofloop.",
        fix: "Add \"proofloop\": \"node scripts/proofloop.mjs\" or use the published package binary.",
      };
    }
    const expected = script.includes("proofloop.mjs") || script.includes("proofloop");
    return {
      id: "proofloop-package-script",
      title: "proofloop npm script",
      status: expected ? "pass" : "warn",
      detail: expected ? `scripts.proofloop is ${script}.` : `scripts.proofloop exists but is unusual: ${script}.`,
      fix: expected ? undefined : "Prefer \"proofloop\": \"node scripts/proofloop.mjs\" for this repo.",
    };
  } catch (error) {
    return {
      id: "PROOFLOOP_PACKAGE_SCRIPT_MISSING",
      title: "package.json parse",
      status: "fail",
      detail: `package.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Fix package.json, then rerun proofloop doctor.",
    };
  }
}

function checkLocalCliWrapper(root: string): ProofloopDoctorCheck {
  const wrapperPath = join(root, "scripts", "proofloop.mjs");
  if (!existsSync(wrapperPath)) {
    return {
      id: "proofloop-cli-wrapper",
      title: "CLI wrapper",
      status: "warn",
      detail: "scripts/proofloop.mjs is not present in this repo.",
      fix: "Use the published `npx proofloop` binary or add the local wrapper for source-repo development.",
    };
  }
  return {
    id: "proofloop-cli-wrapper",
    title: "CLI wrapper",
    status: "pass",
    detail: "scripts/proofloop.mjs is present.",
  };
}

function checkConfig(root: string): ProofloopDoctorCheck {
  const configPath = join(root, ".proofloop", "config.json");
  if (!existsSync(configPath)) {
    return {
      id: "PROOFLOOP_CONFIG_MISSING",
      title: "ProofLoop config",
      status: "fail",
      detail: ".proofloop/config.json is missing.",
      fix: "Run `npm run proofloop -- init`.",
    };
  }
  try {
    JSON.parse(readFileSync(configPath, "utf8"));
    return {
      id: "proofloop-config",
      title: "ProofLoop config",
      status: "pass",
      detail: ".proofloop/config.json exists and parses.",
    };
  } catch (error) {
    return {
      id: "PROOFLOOP_CONFIG_MISSING",
      title: "ProofLoop config",
      status: "fail",
      detail: `.proofloop/config.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Fix the JSON or rerun `npm run proofloop -- init` after backing up local changes.",
    };
  }
}

function checkManifest(root: string): ProofloopDoctorCheck {
  const manifestPath = join(root, ".proofloop", "manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      id: "PROOFLOOP_MANIFEST_MISSING",
      title: "ProofLoop manifest",
      status: "warn",
      detail: ".proofloop/manifest.json is missing.",
      fix: "Run `npm run proofloop -- init --features agents,live --agent auto`.",
    };
  }
  try {
    JSON.parse(readFileSync(manifestPath, "utf8"));
    return {
      id: "proofloop-manifest",
      title: "ProofLoop manifest",
      status: "pass",
      detail: ".proofloop/manifest.json exists and parses.",
    };
  } catch (error) {
    return {
      id: "PROOFLOOP_MANIFEST_MISSING",
      title: "ProofLoop manifest",
      status: "fail",
      detail: `.proofloop/manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Run `npm run proofloop -- init --features agents,live --agent auto` to regenerate it.",
    };
  }
}

function checkAgentDocs(root: string): ProofloopDoctorCheck {
  const docPaths = ["AGENTS.md", "CLAUDE.md", ".cursor/rules/proofloop.mdc", ".windsurf/rules/proofloop.md", ".cursorrules"].map((path) => join(root, path));
  const path = docPaths.find((candidate) => existsSync(candidate) && readFileSync(candidate, "utf8").includes(PROOFLOOP_AGENT_DOC_START));
  if (!path) {
    return {
      id: "PROOFLOOP_AGENT_DOCS_MISSING",
      title: "agent docs",
      status: "warn",
      detail: "No generated ProofLoop agent-friendly docs marker was found.",
      fix: "Run `npm run proofloop -- init --features agents --agent codex`.",
    };
  }
  return {
    id: "proofloop-agent-docs",
    title: "agent docs",
    status: "pass",
    detail: `${path} contains the ProofLoop agent-friendly marker.`,
  };
}

function checkPackageScriptAliases(root: string): ProofloopDoctorCheck {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    return {
      id: "proofloop-package-script-aliases",
      title: "proofloop script aliases",
      status: "warn",
      detail: "package.json is missing, so convenience script aliases cannot be checked.",
      fix: "Run from a package root or use `npx proofloop` directly.",
    };
  }
  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const required = ["proofloop:init", "proofloop:live", "proofloop:gate", "proofloop:resume", "proofloop:doctor", "proofloop:report", "proofloop:charts"];
    const missing = required.filter((name) => !scripts[name]);
    if (missing.length) {
      return {
        id: "proofloop-package-script-aliases",
        title: "proofloop script aliases",
        status: "warn",
        detail: `Missing script aliases: ${missing.join(", ")}.`,
        fix: "Run `npm run proofloop -- init --features agents,live --agent auto`.",
      };
    }
    return {
      id: "proofloop-package-script-aliases",
      title: "proofloop script aliases",
      status: "pass",
      detail: "package.json includes proofloop init/live/gate/resume/doctor/report/charts aliases.",
    };
  } catch (error) {
    return {
      id: "proofloop-package-script-aliases",
      title: "proofloop script aliases",
      status: "warn",
      detail: `package.json could not be parsed for aliases: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Fix package.json, then rerun proofloop doctor.",
    };
  }
}

function checkPlaywright(root: string): ProofloopDoctorCheck {
  const packagePath = join(root, "package.json");
  const nodeModulePath = join(root, "node_modules", "@playwright", "test");
  const packageHasPlaywright = existsSync(packagePath) && readFileSync(packagePath, "utf8").includes('"@playwright/test"');
  if (!packageHasPlaywright) {
    return {
      id: "PROOFLOOP_PLAYWRIGHT_MISSING",
      title: "Playwright",
      status: "warn",
      detail: "package.json does not list @playwright/test.",
      fix: "Install Playwright or use a non-browser proof adapter.",
    };
  }
  if (!existsSync(nodeModulePath)) {
    return {
      id: "PROOFLOOP_PLAYWRIGHT_MISSING",
      title: "Playwright",
      status: "warn",
      detail: "@playwright/test is declared but not installed locally.",
      fix: "Run `npm install` before live browser proof.",
    };
  }
  return {
    id: "proofloop-playwright",
    title: "Playwright",
    status: "pass",
    detail: "@playwright/test is declared and installed.",
  };
}

function checkUiContracts(root: string): ProofloopDoctorCheck {
  const count = countStableUiSelectors(root);
  if (count === 0) {
    return {
      id: "PROOFLOOP_UI_CONTRACTS_MISSING",
      title: "UI contracts",
      status: "warn",
      detail: "No data-proofloop or data-testid selectors were found in source/test surfaces.",
      fix: "Add stable data-proofloop or data-testid attributes, then run `npm run proofloop -- ui contract --dense`.",
    };
  }
  return {
    id: "proofloop-ui-contracts",
    title: "UI contracts",
    status: "pass",
    detail: `${count} stable UI selector(s) found.`,
  };
}

function checkProofloopGithubWorkflow(root: string): ProofloopDoctorCheck {
  const workflowDir = join(root, ".github", "workflows");
  if (!existsSync(workflowDir)) {
    return {
      id: "proofloop-github-workflow",
      title: "GitHub proof workflow",
      status: "warn",
      detail: ".github/workflows is missing.",
      fix: "Run `npm run proofloop -- ci install github --goal default` if GitHub Actions should gate this repo.",
    };
  }
  const workflows = readdirSync(workflowDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(workflowDir, name));
  const proofWorkflow = workflows.find((path) => /proofloop|proof-loop/i.test(path) || /proofloop|proof-loop|gate --goal/i.test(readFileSync(path, "utf8")));
  if (!proofWorkflow) {
    return {
      id: "proofloop-github-workflow",
      title: "GitHub proof workflow",
      status: "warn",
      detail: "No ProofLoop-related GitHub workflow was found.",
      fix: "Run `npm run proofloop -- ci install github --goal default`.",
    };
  }
  return {
    id: "proofloop-github-workflow",
    title: "GitHub proof workflow",
    status: "pass",
    detail: `${proofWorkflow} exists.`,
  };
}

function checkGitignore(root: string): ProofloopDoctorCheck {
  const gitignorePath = join(root, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return {
      id: "PROOFLOOP_GITIGNORE_INCOMPLETE",
      title: "gitignore",
      status: "warn",
      detail: ".gitignore is missing; local run outputs could be committed accidentally.",
      fix: "Ignore .proofloop/runs/, .proofloop/memory/, and .proofloop/memory.jsonl.",
    };
  }
  const gitignore = readFileSync(gitignorePath, "utf8");
  const missing = [".proofloop/runs/", ".proofloop/memory/", ".proofloop/memory.jsonl"].filter((entry) => !gitignore.includes(entry));
  if (missing.length) {
    return {
      id: "PROOFLOOP_GITIGNORE_INCOMPLETE",
      title: "gitignore",
      status: "warn",
      detail: `.gitignore is missing ${missing.join(", ")}.`,
      fix: "Add generated proof output paths to .gitignore.",
    };
  }
  return {
    id: "proofloop-gitignore",
    title: "gitignore",
    status: "pass",
    detail: ".gitignore excludes generated ProofLoop run and memory state.",
  };
}

function checkNodeVersion(): ProofloopDoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  const pass = Number.isFinite(major) && major >= 20;
  return {
    id: "proofloop-node-version",
    title: "Node.js",
    status: pass ? "pass" : "warn",
    detail: `Node.js ${process.versions.node} is active.`,
    fix: pass ? undefined : "Use Node.js 20+; CI for this repo uses Node.js 22.",
  };
}

function countStatuses(checks: ProofloopDoctorCheck[]): ProofloopDoctorReport["summary"] {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function countStableUiSelectors(root: string): number {
  let count = 0;
  for (const file of listSmallSourceFiles(root, ["src", "e2e", "proofloop"], [".ts", ".tsx"], 1000)) {
    const text = readFileSync(join(root, file), "utf8");
    count += (text.match(/data-(?:proofloop|testid)=["'][^"']+["']/g) ?? []).length;
    if (count > 0) return count;
  }
  return count;
}

function listSmallSourceFiles(root: string, dirs: string[], extensions: string[], cap: number): string[] {
  const out: string[] = [];
  for (const dir of dirs) walkSmallFiles(join(root, dir), root, extensions, out, cap);
  return out;
}

function walkSmallFiles(dir: string, root: string, extensions: string[], out: string[], cap: number): void {
  if (out.length >= cap || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= cap) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", ".proofloop"].includes(entry.name)) continue;
      walkSmallFiles(full, root, extensions, out, cap);
      continue;
    }
    if (!entry.isFile() || !extensions.includes(extname(entry.name))) continue;
    if (statSync(full).size > 250_000) continue;
    out.push(relative(root, full).replace(/\\/g, "/"));
  }
}

function upsertMarkedSection(existing: string, section: string): string {
  const start = existing.indexOf(PROOFLOOP_AGENT_DOC_START);
  const end = existing.indexOf(PROOFLOOP_AGENT_DOC_END);
  if ((start >= 0 && end < 0) || (start < 0 && end >= 0) || (start >= 0 && end < start)) {
    throw new Error("Refusing to update malformed ProofLoop agent docs marker block.");
  }
  const normalizedSection = `${section.trim()}\n`;
  if (start >= 0 && end >= 0) {
    const afterEnd = end + PROOFLOOP_AGENT_DOC_END.length;
    const before = existing.slice(0, start).trimEnd();
    const after = existing.slice(afterEnd).trimStart();
    return [before, normalizedSection.trimEnd(), after].filter(Boolean).join("\n\n") + "\n";
  }
  if (!existing.trim()) return normalizedSection;
  return `${existing.trimEnd()}\n\n${normalizedSection}`;
}
