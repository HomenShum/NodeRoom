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
    expect(commandIds).toEqual(
      expect.arrayContaining(["manifest", "doctor", "docs", "init", "this-repo", "supervise", "gate", "hooks", "ci"]),
    );
    expect(manifest.commands.find((command) => command.id === "manifest")?.writes).toBe("none");
    expect(manifest.commands.find((command) => command.id === "doctor")?.json).toBe(true);
    expect(formatProofloopCliManifest(manifest, { dense: true })).toContain("manifest --json");
  });

  it("prints compact topic docs without loading the full manual", () => {
    const docs = proofloopDocsTopic("getting-started");
    const commands = docs.sections.flatMap((section) => section.commands ?? []);

    expect(docs.schema).toBe("proofloop-doc-topic-v1");
    expect(commands).toContain("npm run proofloop -- init --features agents --agent codex");
    expect(commands).toContain("npm run proofloop -- doctor --json");
    expect(formatProofloopDocsTopic(proofloopDocsTopic("agents"), { dense: true })).toContain("never claim completion");
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

  it("supports Claude, Cursor, and explicit doc paths", () => {
    const root = tempRoot();

    const claude = writeProofloopAgentDocs({ root, agent: "claude" });
    const cursor = writeProofloopAgentDocs({ root, agent: "cursor" });
    const explicit = writeProofloopAgentDocs({ root, agent: "codex", agentDocsPath: "docs/AGENT_SETUP.md" });

    expect(claude.path).toBe(join(root, "CLAUDE.md"));
    expect(cursor.path).toBe(join(root, ".cursorrules"));
    expect(explicit.path).toBe(join(root, "docs", "AGENT_SETUP.md"));
    expect(readFileSync(explicit.path, "utf8")).toContain("ProofLoop Agent-Friendly CLI");
  });
});

describe("ProofLoop doctor", () => {
  it("fails before init and passes once config, wrapper, gitignore, and agent docs are present", () => {
    const root = tempRoot();
    writeJson(join(root, "package.json"), { scripts: { proofloop: "node scripts/proofloop.mjs" } });
    write(join(root, "scripts", "proofloop.mjs"), "#!/usr/bin/env node\n");
    write(join(root, ".gitignore"), ".proofloop/runs/\n.proofloop/memory/\n.proofloop/memory.jsonl\n");

    const missingConfig = runProofloopDoctor(root);
    expect(missingConfig.status).toBe("fail");
    expect(missingConfig.checks.find((check) => check.id === "PROOFLOOP_CONFIG_MISSING")?.status).toBe("fail");
    expect(formatProofloopDoctor(missingConfig, { dense: true })).toContain("PROOFLOOP_CONFIG_MISSING");

    writeJson(join(root, ".proofloop", "config.json"), { defaultSuite: "test", suites: {} });
    writeProofloopAgentDocs({ root, agent: "codex" });

    const ready = runProofloopDoctor(root);
    expect(ready.status).toBe("pass");
    expect(ready.summary.fail).toBe(0);
    expect(ready.checks.every((check) => check.status === "pass")).toBe(true);
  });
});
