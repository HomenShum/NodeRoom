import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatProofloopCliManifest,
  formatProofloopDoctor,
  formatProofloopDocsTopic,
  proofloopCliManifest,
  proofloopDocsTopic,
  PROOFLOOP_AGENT_DOC_START,
  runProofloopDoctor,
  writeProofloopAgentDocs,
} from "../src/eval/proofloopAgentFriendlyCli";
import {
  buildProofloopProjectManifest,
  detectUiContracts,
  formatProofloopProjectManifestDense,
  listProofloopTemplates,
  resolveProofloopAgentTargets,
  syncProofloopPackageScripts,
  writeProofloopAgentDocsForTarget,
  writeProofloopLiveScaffold,
  writeProofloopProjectManifest,
  writeProofloopTemplate,
} from "../src/eval/proofloopAgentFriendlyProject";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-agent-cli-"));
  tempRoots.push(root);
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function markerCount(text: string): number {
  return text.split(PROOFLOOP_AGENT_DOC_START).length - 1;
}

describe("ProofLoop agent-friendly CLI manifest", () => {
  it("exposes read-only discovery plus long-running proof commands", () => {
    const manifest = proofloopCliManifest();
    const commandIds = manifest.commands.map((command) => command.id);

    expect(manifest.schema).toBe("proofloop-cli-manifest-v1");
    expect(manifest.recommendedInvocation).toBe("npm run proofloop -- <command>");
    expect(manifest.projectManifestPath).toBe(".proofloop/manifest.json");
    expect(commandIds).toEqual(
      expect.arrayContaining(["manifest", "doctor", "docs", "init", "template", "workflow", "ui", "this-repo", "agents", "mcp", "supervise", "gate", "hooks", "providers", "codex", "ci"]),
    );
    expect(manifest.commands.find((command) => command.id === "manifest")?.writes).toBe("none");
    expect(manifest.commands.find((command) => command.id === "doctor")?.json).toBe(true);
    expect(formatProofloopCliManifest(manifest, { dense: true })).toContain("manifest --json");
  });

  it("prints compact topic docs without loading the full manual", () => {
    const docs = proofloopDocsTopic("getting-started");
    const commands = docs.sections.flatMap((section) => section.commands ?? []);

    expect(docs.schema).toBe("proofloop-doc-topic-v1");
    expect(commands).toContain("npm run proofloop -- init --features agents,live --agent auto");
    expect(commands).toContain("npm run proofloop -- doctor --json");
    expect(formatProofloopDocsTopic(proofloopDocsTopic("agents"), { dense: true })).toContain("never claim completion");
    expect(proofloopDocsTopic("agents").sections.flatMap((section) => section.commands ?? [])).toContain("npm run proofloop -- mcp serve");
  });
});

describe("ProofLoop generated agent docs", () => {
  it("preserves existing AGENTS.md content, inserts one marker block, and is idempotent", () => {
    const root = tempRoot();
    const agentsPath = join(root, "AGENTS.md");
    write(agentsPath, "# Existing Agent Rules\n\nKeep local project rules.\n");

    const first = writeProofloopAgentDocs({ root, agent: "codex" });
    const withDocs = readFileSync(agentsPath, "utf8");

    expect(first.path).toBe(agentsPath);
    expect(first.created).toBe(false);
    expect(first.changed).toBe(true);
    expect(withDocs).toContain("Keep local project rules.");
    expect(withDocs).toContain("npm run proofloop -- manifest --json");
    expect(withDocs).toContain("Do not claim done from chat");
    expect(markerCount(withDocs)).toBe(1);

    const second = writeProofloopAgentDocs({ root, agent: "codex" });
    expect(second.changed).toBe(false);
    expect(markerCount(readFileSync(agentsPath, "utf8"))).toBe(1);
  });

  it("supports Claude, Cursor, Windsurf, and explicit doc paths", () => {
    const root = tempRoot();

    const claude = writeProofloopAgentDocs({ root, agent: "claude" });
    const cursor = writeProofloopAgentDocs({ root, agent: "cursor" });
    const windsurf = writeProofloopAgentDocs({ root, agent: "windsurf" });
    const explicit = writeProofloopAgentDocs({ root, agent: "codex", agentDocsPath: "docs/AGENT_SETUP.md" });

    expect(claude.path).toBe(join(root, "CLAUDE.md"));
    expect(cursor.path).toBe(join(root, ".cursor", "rules", "proofloop.mdc"));
    expect(windsurf.path).toBe(join(root, ".windsurf", "rules", "proofloop.md"));
    expect(explicit.path).toBe(join(root, "docs", "AGENT_SETUP.md"));
    expect(readFileSync(explicit.path, "utf8")).toContain("ProofLoop Agent-Friendly CLI");
  });

  it("resolves auto/all targets and writes all requested agent docs", () => {
    const root = tempRoot();
    write(join(root, "AGENTS.md"), "# Agents\n");
    write(join(root, "CLAUDE.md"), "# Claude\n");

    expect(resolveProofloopAgentTargets(root, "auto")).toEqual(["codex", "claude"]);
    const all = writeProofloopAgentDocsForTarget({ root, target: "all" });

    expect(all.map((result) => result.agent)).toEqual(["codex", "claude", "cursor", "windsurf"]);
    expect(readFileSync(join(root, ".cursor", "rules", "proofloop.mdc"), "utf8")).toContain("ProofLoop Agent-Friendly CLI");
    expect(readFileSync(join(root, ".windsurf", "rules", "proofloop.md"), "utf8")).toContain("ProofLoop Agent-Friendly CLI");
  });
});

describe("ProofLoop doctor", () => {
  it("fails before init and passes once config, manifest, aliases, Playwright, selectors, and agent docs are present", () => {
    const root = tempRoot();
    writeJson(join(root, "package.json"), {
      scripts: { proofloop: "node scripts/proofloop.mjs" },
      devDependencies: { "@playwright/test": "^1.0.0" },
    });
    write(join(root, "scripts", "proofloop.mjs"), "#!/usr/bin/env node\n");
    write(join(root, ".gitignore"), ".proofloop/runs/\n.proofloop/memory/\n.proofloop/memory.jsonl\n");
    write(join(root, "node_modules", "@playwright", "test", "package.json"), "{}\n");
    write(join(root, "src", "App.tsx"), '<button data-testid="chat-send">Send</button>\n');
    write(join(root, ".github", "workflows", "proofloop.yml"), "name: proofloop\n");

    const missingConfig = runProofloopDoctor(root);
    expect(missingConfig.status).toBe("fail");
    expect(missingConfig.checks.find((check) => check.id === "PROOFLOOP_CONFIG_MISSING")?.status).toBe("fail");
    expect(formatProofloopDoctor(missingConfig, { dense: true })).toContain("PROOFLOOP_CONFIG_MISSING");

    writeJson(join(root, ".proofloop", "config.json"), { defaultSuite: "test", suites: {} });
    syncProofloopPackageScripts(root);
    writeProofloopAgentDocs({ root, agent: "codex" });
    writeProofloopProjectManifest(root);

    const ready = runProofloopDoctor(root);
    expect(ready.status).toBe("pass");
    expect(ready.summary.fail).toBe(0);
    expect(ready.checks.every((check) => check.status === "pass")).toBe(true);
  });
});

describe("ProofLoop project manifest, package scripts, templates, and UI contracts", () => {
  it("syncs package scripts without overwriting the main proofloop script", () => {
    const root = tempRoot();
    writeJson(join(root, "package.json"), { name: "demo", scripts: { proofloop: "node scripts/proofloop.mjs" } });

    const first = syncProofloopPackageScripts(root);
    const second = syncProofloopPackageScripts(root);
    const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;

    expect(first.changed).toBe(true);
    expect(first.added).toContain("proofloop:live");
    expect(second.changed).toBe(false);
    expect(scripts.proofloop).toBe("node scripts/proofloop.mjs");
    expect(scripts["proofloop:init"]).toBe("npm run proofloop -- init --agent auto --live");
    expect(scripts["proofloop:gate"]).toBe("npm run proofloop -- gate --goal official-scores");
    expect(scripts["proofloop:resume"]).toBe("npm run proofloop -- resume --goal official-scores --dense");
    expect(scripts["proofloop:doctor"]).toBe("npm run proofloop -- doctor --json");
    expect(scripts["proofloop:dev-audience-ready"]).toContain("--template dev-audience-ready");
    expect(scripts["proofloop:official-preflight"]).toBe("npm run benchmark:proofloop:official-preflight -- --strict");
  });

  it("migrates old generated aliases but leaves custom aliases alone", () => {
    const root = tempRoot();
    writeJson(join(root, "package.json"), {
      name: "demo",
      scripts: {
        proofloop: "node scripts/proofloop.mjs",
        "proofloop:gate": "npm run proofloop -- gate --goal default",
        "proofloop:resume": "npm run proofloop -- resume --goal default",
        "proofloop:doctor": "custom-doctor",
      },
    });

    const result = syncProofloopPackageScripts(root);
    const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;

    expect(result.updated).toContain("proofloop:gate");
    expect(result.updated).toContain("proofloop:resume");
    expect(scripts["proofloop:gate"]).toBe("npm run proofloop -- gate --goal official-scores");
    expect(scripts["proofloop:resume"]).toBe("npm run proofloop -- resume --goal official-scores --dense");
    expect(scripts["proofloop:doctor"]).toBe("custom-doctor");
  });

  it("builds and writes a project manifest with stack, proof commands, suites, workflows, and UI contracts", () => {
    const root = tempRoot();
    writeJson(join(root, "package.json"), {
      name: "demo",
      scripts: { proofloop: "node scripts/proofloop.mjs", build: "vite build" },
      dependencies: { react: "^19.0.0", convex: "^1.0.0" },
      devDependencies: { vite: "^6.0.0", "@playwright/test": "^1.0.0" },
    });
    writeJson(join(root, ".proofloop", "config.json"), { suites: { "accounting-live": {}, finch: {} } });
    write(join(root, "vite.config.ts"), "export default {}\n");
    write(join(root, "proofloop", "workflows", "primary.workflow.yaml"), "id: primary\n");
    write(join(root, "src", "App.tsx"), '<textarea data-testid="chat-composer" />\n');
    writeProofloopAgentDocs({ root, agent: "codex" });

    const manifest = buildProofloopProjectManifest(root);
    const written = writeProofloopProjectManifest(root);

    expect(manifest.repo).toBe("demo");
    expect(manifest.stack).toEqual(expect.arrayContaining(["Vite", "React", "Convex", "Playwright"]));
    expect(manifest.benchmarkSuites).toEqual(expect.arrayContaining(["accounting-live", "finch"]));
    expect(manifest.workflows).toContain("proofloop/workflows/primary.workflow.yaml");
    expect(manifest.uiContracts[0].id).toBe("chat-composer");
    expect(formatProofloopProjectManifestDense(manifest)).toContain("live=npm run proofloop -- this-repo --live");
    expect(written.changed).toBe(true);
    expect(readFileSync(written.path, "utf8")).toContain('"schema": "proofloop-project-manifest-v1"');
  });

  it("lists and writes starter templates idempotently", () => {
    const root = tempRoot();
    expect(listProofloopTemplates().map((template) => template.id)).toContain("underwriting-agent");

    const first = writeProofloopTemplate(root, "underwriting-agent");
    const second = writeProofloopTemplate(root, "underwriting-agent");

    expect(first.written).toEqual([
      "proofloop/workflows/underwriting-agent.workflow.yaml",
      "proofloop/rubrics/underwriting-agent-rubric.yaml",
      "proofloop/behavioral/underwriting-agent-redteam.yaml",
    ]);
    expect(second.skipped.length).toBe(3);
  });

  it("writes the default live workflow and rubrics idempotently", () => {
    const root = tempRoot();

    const first = writeProofloopLiveScaffold(root);
    const second = writeProofloopLiveScaffold(root);

    expect(first.written).toEqual([
      "proofloop/workflows/primary.workflow.yaml",
      "proofloop/rubrics/live-user-contract.yaml",
      "proofloop/rubrics/behavioral.yaml",
    ]);
    expect(second.skipped.length).toBe(3);
    expect(readFileSync(join(root, "proofloop", "workflows", "primary.workflow.yaml"), "utf8")).toContain("entrypoint: this-repo --live");
  });

  it("detects UI contracts from stable selectors", () => {
    const root = tempRoot();
    write(join(root, "src", "Room.tsx"), '<button data-proofloop="chat-composer"></button><button data-testid="chat-send"></button>\n');

    const contracts = detectUiContracts(root);

    expect(contracts.map((contract) => contract.id)).toEqual(["chat-composer", "chat-send"]);
    expect(contracts[0].selector).toBe('[data-proofloop="chat-composer"]');
  });
});
