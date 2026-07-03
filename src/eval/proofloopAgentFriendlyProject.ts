import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import {
  writeProofloopAgentDocs,
  type ProofloopAgentKind,
  type WriteProofloopAgentDocsResult,
} from "./proofloopAgentFriendlyCli";

export type ProofloopAgentTarget = ProofloopAgentKind | "auto" | "all";

export type ProofloopPackageScriptsResult = {
  path: string;
  changed: boolean;
  added: string[];
  updated: string[];
  skipped: string[];
};

export type ProofloopUiContract = {
  id: string;
  selector: string;
  source: string;
  actions: string[];
  assertions: string[];
};

export type ProofloopProjectManifest = {
  schema: "proofloop-project-manifest-v1";
  repo: string;
  stack: string[];
  scripts: Record<string, string>;
  proofCommands: Record<string, string>;
  agentInstructions: string[];
  workflows: string[];
  proofGates: string[];
  benchmarkSuites: string[];
  modelRoutes: string[];
  knownBlockers: string[];
  latestStatus: string;
  uiContracts: ProofloopUiContract[];
};

export type ProofloopTemplate = {
  id: string;
  title: string;
  workflowPath: string;
  rubricPath: string;
  redteamPath: string;
  description: string;
};

export type WriteProofloopTemplateResult = {
  template: ProofloopTemplate;
  written: string[];
  skipped: string[];
};

export type WriteProofloopLiveScaffoldResult = {
  written: string[];
  skipped: string[];
};

const PACKAGE_SCRIPT_DEFAULTS: Record<string, string> = {
  "proofloop:init": "npm run proofloop -- init --agent auto --live",
  "proofloop:live": "npm run proofloop -- this-repo --live",
  "proofloop:gate": "npm run proofloop -- gate --goal default",
  "proofloop:resume": "npm run proofloop -- resume --goal default --dense",
  "proofloop:doctor": "npm run proofloop -- doctor --json",
  "proofloop:report": "npm run proofloop -- report latest",
  "proofloop:charts": "npm run proofloop -- charts latest",
};

const LEGACY_PACKAGE_SCRIPT_DEFAULTS: Record<string, string[]> = {
  "proofloop:init": ["npm run proofloop -- init"],
  "proofloop:resume": ["npm run proofloop -- resume --goal default"],
  "proofloop:doctor": ["npm run proofloop -- doctor"],
};

const TEMPLATE_IDS = [
  "chat-agent",
  "resume-matcher",
  "underwriting-agent",
  "spreadsheet-agent",
  "research-dossier",
  "support-agent",
  "crm-agent",
  "mock-interview-agent",
  "dashboard-agent",
] as const;

export function resolveProofloopAgentTargets(root: string, target: ProofloopAgentTarget = "codex"): ProofloopAgentKind[] {
  if (target === "all") return ["codex", "claude", "cursor", "windsurf"];
  if (target !== "auto") return [target];

  const detected: ProofloopAgentKind[] = [];
  if (existsSync(join(root, "AGENTS.md"))) detected.push("codex");
  if (existsSync(join(root, "CLAUDE.md"))) detected.push("claude");
  if (existsSync(join(root, ".cursor", "rules")) || existsSync(join(root, ".cursorrules"))) detected.push("cursor");
  if (existsSync(join(root, ".windsurf", "rules"))) detected.push("windsurf");
  return detected.length ? Array.from(new Set(detected)) : ["codex"];
}

export function writeProofloopAgentDocsForTarget(options: {
  root: string;
  target?: ProofloopAgentTarget;
  agentDocsPath?: string;
}): WriteProofloopAgentDocsResult[] {
  const targets = resolveProofloopAgentTargets(options.root, options.target ?? "codex");
  if (options.agentDocsPath && targets.length > 1) {
    throw new Error("--agent-docs-path can only be used with one concrete --agent target.");
  }
  return targets.map((agent) => writeProofloopAgentDocs({
    root: options.root,
    agent,
    agentDocsPath: options.agentDocsPath,
  }));
}

export function syncProofloopPackageScripts(root = process.cwd()): ProofloopPackageScriptsResult {
  const path = join(root, "package.json");
  if (!existsSync(path)) {
    return { path, changed: false, added: [], updated: [], skipped: Object.keys(PACKAGE_SCRIPT_DEFAULTS) };
  }
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { scripts?: Record<string, string>; [key: string]: unknown };
  const scripts = { ...(pkg.scripts ?? {}) };
  const added: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  if (!scripts.proofloop) {
    scripts.proofloop = "npx proofloop";
    added.push("proofloop");
  }
  for (const [name, command] of Object.entries(PACKAGE_SCRIPT_DEFAULTS)) {
    if (scripts[name]) {
      if ((LEGACY_PACKAGE_SCRIPT_DEFAULTS[name] ?? []).includes(scripts[name])) {
        scripts[name] = command;
        updated.push(name);
        continue;
      }
      skipped.push(name);
      continue;
    }
    scripts[name] = command;
    added.push(name);
  }
  if (!added.length && !updated.length) return { path, changed: false, added, updated, skipped };
  writeFileSync(path, `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`, "utf8");
  return { path, changed: true, added, updated, skipped };
}

export function buildProofloopProjectManifest(root = process.cwd()): ProofloopProjectManifest {
  const pkg = readPackage(root);
  const scripts = pkg.scripts ?? {};
  const proof = scripts.proofloop ? "npm run proofloop --" : "npx proofloop";
  const suites = readConfigSuites(root);
  return {
    schema: "proofloop-project-manifest-v1",
    repo: String(pkg.name ?? basename(root)),
    stack: detectStack(root, pkg),
    scripts: relevantScripts(scripts),
    proofCommands: {
      init: `${proof} init --agent auto --live`,
      live: `${proof} this-repo --live`,
      gate: `${proof} gate --goal default`,
      resume: `${proof} resume --goal default --dense`,
      doctor: `${proof} doctor --json`,
      manifest: `${proof} manifest --dense`,
      report: `${proof} report latest`,
      charts: `${proof} charts latest`,
    },
    agentInstructions: existingAgentInstructionPaths(root),
    workflows: existingWorkflowPaths(root),
    proofGates: existingProofGatePaths(root),
    benchmarkSuites: suites,
    modelRoutes: existingModelRoutePaths(root),
    knownBlockers: existingKnownBlockers(root),
    latestStatus: latestProofStatus(root),
    uiContracts: detectUiContracts(root),
  };
}

function relevantScripts(scripts: Record<string, string>): Record<string, string> {
  const exact = new Set([
    "dev",
    "build",
    "preview",
    "test",
    "test:e2e",
    "typecheck",
    "prod:gate",
    "prod:gate:live",
    "qa:story:prod",
  ]);
  return Object.fromEntries(
    Object.entries(scripts).filter(([name]) =>
      exact.has(name) ||
      name.startsWith("proofloop") ||
      name.startsWith("benchmark:proofloop") ||
      name.startsWith("benchmark:official"),
    ),
  );
}

export function writeProofloopProjectManifest(root = process.cwd()): { path: string; manifest: ProofloopProjectManifest; changed: boolean } {
  const manifest = buildProofloopProjectManifest(root);
  const path = join(root, ".proofloop", "manifest.json");
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  const changed = !existsSync(path) || readFileSync(path, "utf8") !== next;
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, "utf8");
  }
  return { path, manifest, changed };
}

export function formatProofloopProjectManifestDense(manifest: ProofloopProjectManifest): string {
  return [
    `repo=${manifest.repo}`,
    `stack=${manifest.stack.join(",") || "unknown"}`,
    `status=${manifest.latestStatus}`,
    `agents=${manifest.agentInstructions.join(",") || "missing"}`,
    `suites=${manifest.benchmarkSuites.join(",") || "none"}`,
    `ui=${manifest.uiContracts.slice(0, 8).map((contract) => contract.id).join(",") || "none"}`,
    `doctor=${manifest.proofCommands.doctor}`,
    `live=${manifest.proofCommands.live}`,
    `gate=${manifest.proofCommands.gate}`,
    `resume=${manifest.proofCommands.resume}`,
  ].join("\n");
}

export function listProofloopTemplates(): ProofloopTemplate[] {
  return TEMPLATE_IDS.map((id) => ({
    id,
    title: titleize(id),
    workflowPath: `proofloop/workflows/${id}.workflow.yaml`,
    rubricPath: `proofloop/rubrics/${id}-rubric.yaml`,
    redteamPath: `proofloop/behavioral/${id}-redteam.yaml`,
    description: `Starter proof workflow for ${titleize(id).toLowerCase()} products.`,
  }));
}

export function formatProofloopTemplateList(options: { dense?: boolean } = {}): string {
  const templates = listProofloopTemplates();
  if (options.dense) return templates.map((template) => `${template.id}: ${template.workflowPath}`).join("\n");
  return [
    "ProofLoop templates",
    "",
    ...templates.map((template) => `- ${template.id}: ${template.description}`),
    "",
    "Write one with: npm run proofloop -- template <id> --write",
  ].join("\n");
}

export function writeProofloopTemplate(root: string, id: string, options: { force?: boolean } = {}): WriteProofloopTemplateResult {
  const template = listProofloopTemplates().find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown proofloop template: ${id}`);
  const files = [
    {
      path: template.workflowPath,
      body: [
        `id: ${id}`,
        `title: ${template.title}`,
        "entrypoint: live-browser",
        "goal: prove the primary user workflow through product UI",
        "steps:",
        "  - name: open-app",
        "    action: navigate",
        "  - name: perform-primary-task",
        "    action: execute-user-workflow",
        "  - name: verify-result",
        "    action: assert-live-user-contract",
        "",
      ].join("\n"),
    },
    {
      path: template.rubricPath,
      body: [
        `id: ${id}-rubric`,
        "must_pass:",
        "  - real product UI path exercised",
        "  - deterministic receipt written",
        "  - no verifier weakening",
        "warn:",
        "  - proxy judge used without official scorer label",
        "",
      ].join("\n"),
    },
    {
      path: template.redteamPath,
      body: [
        `id: ${id}-redteam`,
        "cases:",
        "  - missing input",
        "  - stale context",
        "  - shortcut answer without UI proof",
        "",
      ].join("\n"),
    },
  ];
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const fullPath = join(root, file.path);
    if (existsSync(fullPath) && !options.force) {
      skipped.push(file.path);
      continue;
    }
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.body, "utf8");
    written.push(file.path);
  }
  return { template, written, skipped };
}

export function writeProofloopLiveScaffold(root: string, options: { force?: boolean } = {}): WriteProofloopLiveScaffoldResult {
  const files = [
    {
      path: "proofloop/workflows/primary.workflow.yaml",
      body: [
        "id: primary",
        "title: Primary live product workflow",
        "entrypoint: this-repo --live",
        "goal: prove the primary user workflow through the real product UI",
        "commands:",
        "  live: npm run proofloop -- this-repo --live",
        "  gate: npm run proofloop -- gate --goal default",
        "  resume: npm run proofloop -- resume --goal default --dense",
        "evidence:",
        "  - .proofloop/manifest.json",
        "  - .proofloop/runs/latest/scorecard.md",
        "  - .proofloop/runs/latest/verifier-receipt.json",
        "",
      ].join("\n"),
    },
    {
      path: "proofloop/rubrics/live-user-contract.yaml",
      body: [
        "id: live-user-contract",
        "must_pass:",
        "  - app route loads in a real browser",
        "  - primary user action is executed through stable UI selectors",
        "  - visible product result matches the task contract",
        "  - proof receipt records commands, artifacts, model route, and harness version",
        "",
      ].join("\n"),
    },
    {
      path: "proofloop/rubrics/behavioral.yaml",
      body: [
        "id: behavioral-proof-rules",
        "rules:",
        "  - do not claim done from a transcript or worker assertion",
        "  - run doctor before marking local setup blocked",
        "  - keep proxy/product-path proof separate from official scorer claims",
        "  - do not weaken deterministic verifiers to pass",
        "",
      ].join("\n"),
    },
  ];
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const fullPath = join(root, file.path);
    if (existsSync(fullPath) && !options.force) {
      skipped.push(file.path);
      continue;
    }
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.body, "utf8");
    written.push(file.path);
  }
  return { written, skipped };
}

export function formatProofloopUiList(root = process.cwd(), options: { dense?: boolean } = {}): string {
  const contracts = detectUiContracts(root);
  if (options.dense) return contracts.map((contract) => `${contract.id}: ${contract.selector}`).join("\n") || "no-ui-contracts";
  return [
    "ProofLoop UI contracts",
    "",
    ...contracts.map((contract) => `- ${contract.id}: ${contract.selector} (${contract.source})`),
  ].join("\n");
}

export function formatProofloopUiContract(root = process.cwd(), options: { dense?: boolean; component?: string } = {}): string {
  const contracts = detectUiContracts(root);
  const filtered = options.component
    ? contracts.filter((contract) => contract.id.toLowerCase().includes(options.component!.toLowerCase()))
    : contracts;
  if (options.dense) {
    return filtered.map((contract) => [
      `id=${contract.id}`,
      `selector=${contract.selector}`,
      `actions=${contract.actions.join("|")}`,
      `assertions=${contract.assertions.join("|")}`,
    ].join(" ")).join("\n") || "no-ui-contract";
  }
  return filtered.map((contract) => [
    `Component: ${titleize(contract.id)}`,
    `Selector: ${contract.selector}`,
    `Source: ${contract.source}`,
    "Actions:",
    ...contract.actions.map((action) => `- ${action}`),
    "Assertions:",
    ...contract.assertions.map((assertion) => `- ${assertion}`),
  ].join("\n")).join("\n\n") || "No UI contract found.";
}

function readPackage(root: string): { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return {};
  return JSON.parse(readFileSync(packagePath, "utf8"));
}

function detectStack(root: string, pkg: ReturnType<typeof readPackage>): string[] {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const stack = new Set<string>();
  if (existsSync(join(root, "vite.config.ts")) || deps.vite) stack.add("Vite");
  if (existsSync(join(root, "next.config.js")) || existsSync(join(root, "next.config.mjs")) || deps.next) stack.add("Next.js");
  if (deps.react) stack.add("React");
  if (existsSync(join(root, "convex")) || deps.convex) stack.add("Convex");
  if (existsSync(join(root, "playwright.config.ts")) || deps["@playwright/test"]) stack.add("Playwright");
  if (existsSync(join(root, "vercel.json")) || existsSync(join(root, ".vercel"))) stack.add("Vercel");
  if (deps["@tiptap/core"]) stack.add("TipTap");
  return Array.from(stack);
}

function existingAgentInstructionPaths(root: string): string[] {
  return [
    "AGENTS.md",
    "CLAUDE.md",
    ".cursor/rules/proofloop.mdc",
    ".windsurf/rules/proofloop.md",
    ".codex/proofloop.md",
    ".cursorrules",
  ].filter((path) => existsSync(join(root, path)));
}

function existingWorkflowPaths(root: string): string[] {
  return listFiles(root, ["proofloop/workflows"], [".yaml", ".yml"]).slice(0, 40);
}

function existingProofGatePaths(root: string): string[] {
  return listFiles(root, [".github/workflows"], [".yaml", ".yml"])
    .filter((path) => /proofloop|proof-loop/i.test(path) || readFileSync(join(root, path), "utf8").match(/proofloop|proof-loop|gate --goal/i))
    .slice(0, 40);
}

function existingModelRoutePaths(root: string): string[] {
  return [
    "docs/eval/proofloop-harness-economics.json",
    "docs/eval/openrouter-top-paid-tools-snapshot.json",
  ].filter((path) => existsSync(join(root, path)));
}

function existingKnownBlockers(root: string): string[] {
  const blockerDir = join(root, "docs", "eval", "proofloop-adapter-blockers");
  if (!existsSync(blockerDir)) return [];
  return readdirSync(blockerDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => `docs/eval/proofloop-adapter-blockers/${name}`)
    .slice(0, 40);
}

function readConfigSuites(root: string): string[] {
  const suites = new Set<string>();
  const configPath = join(root, ".proofloop", "config.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as { suites?: Record<string, unknown> };
      for (const suite of Object.keys(config.suites ?? {})) suites.add(suite);
    } catch {
      // doctor reports malformed config; manifest stays best-effort.
    }
  }
  for (const path of listFiles(root, ["proofloop/suites"], [".json"])) suites.add(basename(path, ".json"));
  return Array.from(suites).sort();
}

function latestProofStatus(root: string): string {
  for (const goalId of ["default", "official-scores"]) {
    const statePath = join(root, ".proofloop", "goals", goalId, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { status?: string };
      return `${goalId}:${state.status ?? "unknown"}`;
    } catch {
      return `${goalId}:unreadable`;
    }
  }
  const latestMeta = join(root, ".proofloop", "runs", "latest", "meta.json");
  if (existsSync(latestMeta)) {
    try {
      const meta = JSON.parse(readFileSync(latestMeta, "utf8")) as { passed?: boolean; suite?: string };
      return `${meta.suite ?? "latest"}:${meta.passed ? "passed" : "failed"}`;
    } catch {
      return "latest:unreadable";
    }
  }
  return "not-run";
}

export function detectUiContracts(root: string): ProofloopUiContract[] {
  const files = listFiles(root, ["src", "e2e", "proofloop"], [".ts", ".tsx"], 1000);
  const seen = new Map<string, ProofloopUiContract>();
  const patterns = [
    { attr: "data-proofloop", regex: /data-proofloop=["']([^"']+)["']/g },
    { attr: "data-testid", regex: /data-testid=["']([^"']+)["']/g },
  ];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern.regex)) {
        const id = match[1];
        if (!id || seen.has(id)) continue;
        seen.set(id, {
          id,
          selector: `[${pattern.attr}="${id}"]`,
          source: file,
          actions: actionsForUiId(id),
          assertions: assertionsForUiId(id),
        });
        if (seen.size >= 80) return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id));
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function actionsForUiId(id: string): string[] {
  if (/send|submit|button|cta|create/i.test(id)) return ["click"];
  if (/composer|input|textarea|chat/i.test(id)) return ["fillText", "submit"];
  if (/tab|nav|rail/i.test(id)) return ["select"];
  if (/export|download/i.test(id)) return ["download"];
  return ["observe"];
}

function assertionsForUiId(id: string): string[] {
  if (/error/i.test(id)) return ["notVisible", "noUnhandledError"];
  if (/status|job|stream|trace/i.test(id)) return ["visible", "updates"];
  if (/message|result|artifact|panel/i.test(id)) return ["visible", "containsExpectedOutput"];
  return ["visible"];
}

function listFiles(root: string, dirs: string[], extensions: string[], cap = 500): string[] {
  const out: string[] = [];
  for (const dir of dirs) walk(join(root, dir), root, extensions, out, cap);
  return out;
}

function walk(dir: string, root: string, extensions: string[], out: string[], cap: number): void {
  if (out.length >= cap || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= cap) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", ".proofloop"].includes(entry.name)) continue;
      walk(full, root, extensions, out, cap);
      continue;
    }
    if (!entry.isFile() || !extensions.includes(extname(entry.name))) continue;
    if (statSync(full).size > 250_000) continue;
    out.push(relative(root, full).replace(/\\/g, "/"));
  }
}

function titleize(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
