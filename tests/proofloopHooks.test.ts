/**
 * Scenario tests for `proofloop hooks` -- the Claude Code Stop gate ("refuses
 * fake done") and the PreToolUse guard (immutable files, gitignored proof
 * state, verifier-weakening content).
 *
 * Persona: a solo founder wires Proof Loop into an EXISTING Claude Code setup
 * (their own Stop hook already present), lets an agent run long sessions, and
 * needs the gate to block dishonest stops without ever bricking the repo.
 *
 * Everything runs inside mkdtempSync temp dirs -- this repo's own .claude/,
 * .proofloop/, and .github/ are never touched. The generated .mjs hooks are
 * exercised for real with `node` + piped stdin (not just unit-called), so the
 * documented hook contracts (stdout {"decision":"block"} for Stop, exit 2 for
 * PreToolUse) are asserted against actual process behavior.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installProofloopHooks,
  proofloopHooksStatus,
  proofloopKickoffPrompt,
  uninstallProofloopHooks,
  PRETOOLUSE_GUARD_COMMAND,
  STOP_GATE_COMMAND,
} from "../src/eval/proofloopHooks";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-hooks-"));
  tempRoots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

type HookRun = { status: number; stdout: string; stderr: string };

function runHook(root: string, script: "stop-gate.mjs" | "pretooluse-guard.mjs", stdin: unknown): HookRun {
  const result = spawnSync(process.execPath, [join(root, ".proofloop", "hooks", script)], {
    cwd: root,
    input: typeof stdin === "string" ? stdin : JSON.stringify(stdin),
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function setGateConfig(root: string, patch: Record<string, unknown>): void {
  const configPath = join(root, ".proofloop", "hooks", "config.json");
  writeJson(configPath, { ...readJson(configPath), ...patch });
}

function ourEntryCount(settings: any): { stop: number; pre: number } {
  const count = (groups: any[] | undefined, command: string) =>
    (groups ?? []).flatMap((group: any) => group.hooks ?? []).filter((entry: any) => entry.command === command).length;
  return {
    stop: count(settings.hooks?.Stop, STOP_GATE_COMMAND),
    pre: count(settings.hooks?.PreToolUse, PRETOOLUSE_GUARD_COMMAND),
  };
}

describe("proofloop hooks install / uninstall", () => {
  it("merges into an existing settings.json without clobbering the user's own Stop hook, and is idempotent", () => {
    const root = tempRoot();
    const settingsPath = join(root, ".claude", "settings.json");
    writeJson(settingsPath, {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      permissions: { allow: ["Bash(npm run lint)"] },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "node scripts/my-own-stop-hook.js" }] }],
      },
    });

    installProofloopHooks({ root });

    const settings = readJson(settingsPath);
    // User content preserved byte-for-byte semantically.
    expect(settings.$schema).toBe("https://json.schemastore.org/claude-code-settings.json");
    expect(settings.permissions).toEqual({ allow: ["Bash(npm run lint)"] });
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("node scripts/my-own-stop-hook.js");
    // Our hooks appended.
    expect(ourEntryCount(settings)).toEqual({ stop: 1, pre: 1 });
    const preGroup = settings.hooks.PreToolUse.find((group: any) =>
      (group.hooks ?? []).some((entry: any) => entry.command === PRETOOLUSE_GUARD_COMMAND),
    );
    expect(preGroup.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
    // Scripts + config snapshot written.
    expect(existsSync(join(root, ".proofloop", "hooks", "stop-gate.mjs"))).toBe(true);
    expect(existsSync(join(root, ".proofloop", "hooks", "pretooluse-guard.mjs"))).toBe(true);
    const config = readJson(join(root, ".proofloop", "hooks", "config.json"));
    expect(config.immutableFiles).toContain("scripts/proofloop.mjs");
    expect(config.immutableFiles).toContain(".github/workflows/");
    expect(config.protectedExtraPaths).toContain(".proofloop/regressions.json");
    expect(config.maxStopBlocks).toBe(5);
    expect(config.gateMode).toBe("check-only");
    expect(config.verifierWeakeningPatterns.length).toBeGreaterThan(0);

    // Install twice: no duplicates.
    installProofloopHooks({ root });
    expect(ourEntryCount(readJson(settingsPath))).toEqual({ stop: 1, pre: 1 });
  });

  it("writes settings.local.json with --local and refuses to clobber an unparseable settings file", () => {
    const root = tempRoot();
    installProofloopHooks({ root, local: true });
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(true);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);

    const broken = tempRoot();
    mkdirSync(join(broken, ".claude"), { recursive: true });
    writeFileSync(join(broken, ".claude", "settings.json"), "{ not json", "utf8");
    expect(() => installProofloopHooks({ root: broken })).toThrow(/Refusing to overwrite/);
    expect(readFileSync(join(broken, ".claude", "settings.json"), "utf8")).toBe("{ not json");
  });

  it("rejects unsupported workers in v0", () => {
    expect(() => installProofloopHooks({ root: tempRoot(), worker: "codex" })).toThrow(/Unsupported worker/);
  });

  it("uninstall removes only our marked entries and status reports both states", () => {
    const root = tempRoot();
    const settingsPath = join(root, ".claude", "settings.json");
    writeJson(settingsPath, {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "node scripts/my-own-stop-hook.js" }] }],
        PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo done" }] }],
      },
    });
    installProofloopHooks({ root });

    const installed = proofloopHooksStatus({ root });
    expect(installed.settings.find((file) => file.path.endsWith("settings.json"))?.stopHookInstalled).toBe(true);
    expect(installed.settings.find((file) => file.path.endsWith("settings.json"))?.preToolUseHookInstalled).toBe(true);

    const result = uninstallProofloopHooks({ root, purge: true });
    expect(result.removedEntries).toBe(2);
    expect(result.purgedHooksDir).toBe(true);

    const settings = readJson(settingsPath);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("node scripts/my-own-stop-hook.js");
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe("echo done");
    expect(ourEntryCount(settings)).toEqual({ stop: 0, pre: 0 });
    expect(existsSync(join(root, ".proofloop", "hooks"))).toBe(false);

    const uninstalled = proofloopHooksStatus({ root });
    expect(uninstalled.settings.find((file) => file.path.endsWith("settings.json"))?.stopHookInstalled).toBe(false);
    expect(uninstalled.scripts.every((script) => !script.exists)).toBe(true);
  });
});

describe("stop-gate.mjs (refuses fake done)", () => {
  it("blocks the stop while a fake gate command fails, increments the counter, then allows at the block limit", () => {
    const root = tempRoot();
    installProofloopHooks({ root, maxStopBlocks: 2 });
    writeFileSync(join(root, "fail-gate.mjs"), "process.stdout.write('gate says: local-proof failed');\nprocess.exit(1);\n", "utf8");
    setGateConfig(root, { gateMode: "command", gateCommand: "node fail-gate.mjs" });

    const first = runHook(root, "stop-gate.mjs", { session_id: "s1", stop_hook_active: false });
    expect(first.status).toBe(0);
    const decision = JSON.parse(first.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("proofloop gate is failing");
    expect(decision.reason).toContain("local-proof failed");
    expect(decision.reason).toContain("(block 1/2)");
    expect(readJson(join(root, ".proofloop", "hooks", "state.json")).sessions.s1.blocks).toBe(1);

    const second = runHook(root, "stop-gate.mjs", { session_id: "s1", stop_hook_active: true });
    expect(JSON.parse(second.stdout).reason).toContain("(block 2/2)");

    // At the limit: allow honestly instead of looping forever.
    const third = runHook(root, "stop-gate.mjs", { session_id: "s1", stop_hook_active: true });
    expect(third.status).toBe(0);
    expect(third.stdout.trim()).toBe("");
    expect(third.stderr).toContain("block limit");
    expect(third.stderr).toContain("NOT proven done");

    // A different session gets its own counter.
    const other = runHook(root, "stop-gate.mjs", { session_id: "s2" });
    expect(JSON.parse(other.stdout).reason).toContain("(block 1/2)");
  });

  it("allows silently and resets the counter when the gate passes", () => {
    const root = tempRoot();
    installProofloopHooks({ root });
    writeFileSync(join(root, "pass-gate.mjs"), "process.exit(0);\n", "utf8");
    setGateConfig(root, { gateMode: "command", gateCommand: "node pass-gate.mjs" });
    writeJson(join(root, ".proofloop", "hooks", "state.json"), {
      sessions: { s1: { blocks: 3, updatedAt: "2026-07-03T00:00:00.000Z" } },
    });

    const run = runHook(root, "stop-gate.mjs", { session_id: "s1" });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("");
    expect(readJson(join(root, ".proofloop", "hooks", "state.json")).sessions.s1).toBeUndefined();
  });

  it("allows when no goal is configured (never bricks a fresh repo), including the real gate's 'Goal does not exist' output", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    // check-only mode, no .proofloop/goals at all
    const checkOnly = runHook(root, "stop-gate.mjs", { session_id: "s1" });
    expect(checkOnly.status).toBe(0);
    expect(checkOnly.stdout.trim()).toBe("");
    expect(checkOnly.stderr).toContain("no Proof Loop goal is configured");

    // command mode, gate replies exactly like cmdGoalGate for a missing goal
    writeFileSync(
      join(root, "missing-goal-gate.mjs"),
      "console.error('proofloop: Goal does not exist: official-scores');\nprocess.exit(1);\n",
      "utf8",
    );
    setGateConfig(root, { gateMode: "command", gateCommand: "node missing-goal-gate.mjs" });
    const commandMode = runHook(root, "stop-gate.mjs", { session_id: "s1" });
    expect(commandMode.status).toBe(0);
    expect(commandMode.stdout.trim()).toBe("");
  });

  it("check-only mode reads the persisted goal ledger: passed allows, failed blocks with reasons, blocked_external allows with a note", () => {
    const root = tempRoot();
    installProofloopHooks({ root, goalId: "official-scores" });
    const statePath = join(root, ".proofloop", "goals", "official-scores", "state.json");

    writeJson(statePath, { goalId: "official-scores", status: "passed", tasks: [] });
    const passed = runHook(root, "stop-gate.mjs", { session_id: "s1" });
    expect(passed.status).toBe(0);
    expect(passed.stdout.trim()).toBe("");

    writeJson(statePath, {
      goalId: "official-scores",
      status: "failed",
      terminalReason: "1 required task(s) failed.",
      tasks: [{ id: "spreadsheetbench-full", status: "failed", blockers: [] }],
    });
    const failed = runHook(root, "stop-gate.mjs", { session_id: "s1" });
    const decision = JSON.parse(failed.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("1 required task(s) failed.");
    expect(decision.reason).toContain("spreadsheetbench-full: failed");

    writeJson(statePath, {
      goalId: "official-scores",
      status: "blocked_external",
      tasks: [{ id: "finch-official-score", status: "blocked_external", blockers: ["official scorer receipt is blocked_external"] }],
    });
    const blocked = runHook(root, "stop-gate.mjs", { session_id: "s2" });
    expect(blocked.status).toBe(0);
    expect(blocked.stdout.trim()).toBe("");
    expect(blocked.stderr).toContain("true external blocker is recorded");
    expect(blocked.stderr).toContain("finch-official-score");
  });

  it("fails open on garbage stdin, and blocks HONESTLY (not forever) when the gate command itself is broken", () => {
    const root = tempRoot();
    installProofloopHooks({ root, maxStopBlocks: 1 });

    const garbage = runHook(root, "stop-gate.mjs", "this is not json{{{");
    expect(garbage.status).toBe(0);
    expect(garbage.stdout.trim()).toBe("");

    // A missing gate command must NOT earn a silent allow (that would let an
    // agent escape by breaking the gate); it blocks with the shell's own error
    // as the reason, and the block counter still guarantees an exit.
    setGateConfig(root, { gateMode: "command", gateCommand: "definitely-not-a-real-command-xyz --flag" });
    const broken = runHook(root, "stop-gate.mjs", { session_id: "s1" });
    expect(broken.status).toBe(0);
    const decision = JSON.parse(broken.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("definitely-not-a-real-command-xyz");

    const escape = runHook(root, "stop-gate.mjs", { session_id: "s1" });
    expect(escape.stdout.trim()).toBe("");
    expect(escape.stderr).toContain("block limit");
  });
});

describe("pretooluse-guard.mjs (immutable + proof-state + verifier-weakening guard)", () => {
  function guard(root: string, toolName: string, toolInput: Record<string, unknown>): HookRun {
    return runHook(root, "pretooluse-guard.mjs", { session_id: "s1", tool_name: toolName, tool_input: toolInput });
  }

  it("blocks edits to immutable files with exit code exactly 2 (absolute, relative, and traversal paths)", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    const absolute = guard(root, "Edit", {
      file_path: join(root, "scripts", "proofloop.mjs"),
      old_string: "a",
      new_string: "b",
    });
    expect(absolute.status).toBe(2);
    expect(absolute.stderr).toContain("immutable");
    expect(absolute.stderr).toContain("scripts/proofloop.mjs");

    const relative = guard(root, "Write", { file_path: ".github/workflows/ci.yml", content: "name: x" });
    expect(relative.status).toBe(2);

    const traversal = guard(root, "Edit", {
      file_path: join(root, "src", "..", "scripts", "proofloop.mjs"),
      old_string: "a",
      new_string: "b",
    });
    expect(traversal.status).toBe(2);
  });

  it("blocks the gitignored regression proof state (.proofloop/regressions.json and .proofloop/regressions/)", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    const legacy = guard(root, "Write", {
      file_path: join(root, ".proofloop", "regressions.json"),
      content: "[]",
    });
    expect(legacy.status).toBe(2);
    expect(legacy.stderr).toContain("protected proof state");

    const dir = guard(root, "Edit", {
      file_path: ".proofloop/regressions/in-flight.json",
      old_string: "a",
      new_string: "b",
    });
    expect(dir.status).toBe(2);

    // The guard also protects its own enforcement layer.
    const selfEdit = guard(root, "Write", { file_path: ".proofloop/hooks/config.json", content: "{}" });
    expect(selfEdit.status).toBe(2);
  });

  it("blocks a minScore-lowering edit under src/eval/ but allows the same content in unguarded areas", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    const weakening = guard(root, "Edit", {
      file_path: join(root, "src", "eval", "somePolicy.ts"),
      old_string: "minScore: 75",
      new_string: "minScore: 10",
    });
    expect(weakening.status).toBe(2);
    expect(weakening.stderr).toContain("verifier-weakening");
    expect(weakening.stderr).toContain("minScore");

    const multiEdit = guard(root, "MultiEdit", {
      file_path: join(root, "proofloop", "scenarios", "demo.yaml"),
      edits: [
        { old_string: "x", new_string: "y" },
        { old_string: "gate: on", new_string: "disable the gate here" },
      ],
    });
    expect(multiEdit.status).toBe(2);

    // Same string outside the guarded prefixes: docs may DISCUSS minScore.
    const docs = guard(root, "Write", { file_path: "docs/eval/notes.md", content: "we did not lower minScore: 10" });
    expect(docs.status).toBe(0);
  });

  it("allows normal edits, tool calls without paths, paths outside the repo, and fails open on garbage stdin", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    const normal = guard(root, "Edit", {
      file_path: join(root, "src", "ui", "App.tsx"),
      old_string: "a",
      new_string: "const hello = 1;",
    });
    expect(normal.status).toBe(0);
    expect(normal.stdout.trim()).toBe("");

    const notebook = guard(root, "NotebookEdit", {
      notebook_path: join(root, "notebooks", "analysis.ipynb"),
      new_source: "print('hi')",
    });
    expect(notebook.status).toBe(0);

    expect(guard(root, "Bash", { command: "echo hi" }).status).toBe(0);

    const outside = guard(root, "Edit", {
      file_path: join(tmpdir(), "elsewhere", "scripts", "proofloop.mjs"),
      old_string: "a",
      new_string: "b",
    });
    expect(outside.status).toBe(0);

    const garbage = runHook(root, "pretooluse-guard.mjs", "not json at all");
    expect(garbage.status).toBe(0);
    expect(garbage.stderr).toContain("allowing");
  });
});

describe("proofloop prompt honesty", () => {
  it("only references CLI commands that exist as cases in scripts/proofloop-cli.ts", () => {
    const prompt = proofloopKickoffPrompt();
    const cliSource = readFileSync(join(process.cwd(), "scripts", "proofloop-cli.ts"), "utf8");
    const knownCommands = new Set(
      [...cliSource.matchAll(/^\s{4}case "([a-z-]+)":/gm)].map((match) => match[1]),
    );
    expect(knownCommands.size).toBeGreaterThan(10);

    const mentioned = [...prompt.matchAll(/proofloop ([a-z-]+)/g)].map((match) => match[1]);
    expect(mentioned.length).toBeGreaterThan(0);
    for (const command of mentioned) {
      expect(knownCommands.has(command), `\`proofloop ${command}\` is mentioned in the kickoff prompt but is not a CLI case`).toBe(true);
    }
    // The core loop contract is spelled out.
    expect(prompt).toContain("proofloop gate --goal");
    expect(prompt).toContain("proofloop goal block");
    expect(prompt).toContain("proofloop hooks install");
    expect(prompt.split("\n").length).toBeLessThanOrEqual(25);
  });
});
