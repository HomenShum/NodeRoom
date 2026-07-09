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
  POSTTOOLUSE_LOG_COMMAND,
  POSTTOOLUSE_LOG_MATCHER,
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

function runHook(root: string, script: "stop-gate.mjs" | "pretooluse-guard.mjs" | "posttooluse-log.mjs", stdin: unknown): HookRun {
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

function ourEntryCount(settings: any): { stop: number; pre: number; post: number } {
  if (Array.isArray(settings.hooks)) {
    const count = (event: string, command: string) =>
      settings.hooks.filter((entry: any) => entry.event === event && entry.command === command).length;
    return {
      stop: count("Stop", STOP_GATE_COMMAND),
      pre: count("PreToolUse", PRETOOLUSE_GUARD_COMMAND),
      post: count("PostToolUse", POSTTOOLUSE_LOG_COMMAND),
    };
  }
  const count = (groups: any[] | undefined, command: string) =>
    (groups ?? []).flatMap((group: any) => group.hooks ?? []).filter((entry: any) => entry.command === command).length;
  return {
    stop: count(settings.hooks?.Stop, STOP_GATE_COMMAND),
    pre: count(settings.hooks?.PreToolUse, PRETOOLUSE_GUARD_COMMAND),
    post: count(settings.hooks?.PostToolUse, POSTTOOLUSE_LOG_COMMAND),
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
    expect(ourEntryCount(settings)).toEqual({ stop: 1, pre: 1, post: 1 });
    const preGroup = settings.hooks.PreToolUse.find((group: any) =>
      (group.hooks ?? []).some((entry: any) => entry.command === PRETOOLUSE_GUARD_COMMAND),
    );
    expect(preGroup.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
    const postGroup = settings.hooks.PostToolUse.find((group: any) =>
      (group.hooks ?? []).some((entry: any) => entry.command === POSTTOOLUSE_LOG_COMMAND),
    );
    expect(postGroup.matcher).toBe(POSTTOOLUSE_LOG_MATCHER);
    // Scripts + config snapshot written.
    expect(existsSync(join(root, ".proofloop", "hooks", "stop-gate.mjs"))).toBe(true);
    expect(existsSync(join(root, ".proofloop", "hooks", "pretooluse-guard.mjs"))).toBe(true);
    expect(existsSync(join(root, ".proofloop", "hooks", "posttooluse-log.mjs"))).toBe(true);
    const config = readJson(join(root, ".proofloop", "hooks", "config.json"));
    expect(config.immutableFiles).toContain("scripts/proofloop.mjs");
    expect(config.immutableFiles).toContain(".github/workflows/");
    expect(config.protectedExtraPaths).toContain(".proofloop/regressions.json");
    expect(config.protectedExtraPaths).toContain(".proofloop/tooluse/");
    expect(config.maxStopBlocks).toBe(5);
    expect(config.gateMode).toBe("check-only");
    expect(config.toolUseLog).toBe(true);
    expect(config.toolUseLogPath).toBe(".proofloop/tooluse/log.jsonl");
    expect(config.verifierWeakeningPatterns.length).toBeGreaterThan(0);

    // Install twice: no duplicates.
    installProofloopHooks({ root });
    expect(ourEntryCount(readJson(settingsPath))).toEqual({ stop: 1, pre: 1, post: 1 });
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

  it("installs Codex hook entries without clobbering existing hooks", () => {
    const root = tempRoot();
    const hooksPath = join(root, ".codex", "hooks.json");
    writeJson(hooksPath, {
      hooks: [
        { event: "PostToolUse", command: "node scripts/my-own-codex-log.js" },
      ],
    });

    const result = installProofloopHooks({ root, worker: "codex" });

    expect(result.settingsPath).toBe(hooksPath);
    const settings = readJson(hooksPath);
    expect(settings.hooks[0].command).toBe("node scripts/my-own-codex-log.js");
    expect(ourEntryCount(settings)).toEqual({ stop: 1, pre: 1, post: 1 });
    expect(settings.hooks.find((entry: any) => entry.event === "PreToolUse" && entry.command === PRETOOLUSE_GUARD_COMMAND).matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
    expect(settings.hooks.find((entry: any) => entry.event === "PostToolUse" && entry.command === POSTTOOLUSE_LOG_COMMAND).matcher).toBe(POSTTOOLUSE_LOG_MATCHER);

    installProofloopHooks({ root, worker: "codex" });
    expect(ourEntryCount(readJson(hooksPath))).toEqual({ stop: 1, pre: 1, post: 1 });

    const status = proofloopHooksStatus({ root });
    expect(status.settings.find((file) => file.path.endsWith(".codex\\hooks.json") || file.path.endsWith(".codex/hooks.json"))?.stopHookInstalled).toBe(true);
  });

  it("installs Codex local hook enforcement with Stop, PreToolUse, and PostToolUse status", () => {
    const root = tempRoot();
    const hooksPath = join(root, ".codex", "hooks.local.json");

    const result = installProofloopHooks({ root, worker: "codex", local: true });

    expect(result.settingsPath).toBe(hooksPath);
    const settings = readJson(hooksPath);
    expect(ourEntryCount(settings)).toEqual({ stop: 1, pre: 1, post: 1 });
    const status = proofloopHooksStatus({ root });
    const localStatus = status.settings.find((file) => file.path.endsWith(".codex\\hooks.local.json") || file.path.endsWith(".codex/hooks.local.json"));
    expect(localStatus).toMatchObject({
      stopHookInstalled: true,
      preToolUseHookInstalled: true,
      postToolUseLogInstalled: true,
    });
    expect(existsSync(join(root, ".proofloop", "hooks", "stop-gate.mjs"))).toBe(true);
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
    expect(installed.settings.find((file) => file.path.endsWith("settings.json"))?.postToolUseLogInstalled).toBe(true);

    const result = uninstallProofloopHooks({ root, purge: true });
    expect(result.removedEntries).toBe(3);
    expect(result.purgedHooksDir).toBe(true);

    const settings = readJson(settingsPath);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("node scripts/my-own-stop-hook.js");
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe("echo done");
    expect(ourEntryCount(settings)).toEqual({ stop: 0, pre: 0, post: 0 });
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

describe("posttooluse-log.mjs (expected-tool-use capture)", () => {
  function logEvent(root: string, event: Record<string, unknown>): HookRun {
    return runHook(root, "posttooluse-log.mjs", event);
  }
  const logPath = (root: string) => join(root, ".proofloop", "tooluse", "log.jsonl");

  it("appends exactly one JSON line per event, redacts nested secrets, and resists newline record-forging", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    // Event 1: a Composio-style MCP tool name.
    const one = logEvent(root, {
      session_id: "sess-live",
      tool_name: "mcp__composio__GMAIL_SEND_EMAIL",
      tool_input: { to: "founder@example.com", subject: "Inbox triage summary" },
    });
    expect(one.status).toBe(0);
    expect(one.stdout.trim()).toBe("");

    // Event 2: param value carrying a newline + a fake JSONL record (forging attempt).
    const forged = 'line1\nline2\n{"ts":"2026-07-03T00:00:00.000Z","sessionId":"forged","tool":"FAKE_FORGED_TOOL","params":{}}';
    expect(logEvent(root, { session_id: "sess-live", tool_name: "Write", tool_input: { file_path: "notes.md", content: forged } }).status).toBe(0);

    // Event 3: nested secrets at several depths (and inside arrays).
    expect(
      logEvent(root, {
        session_id: "sess-live",
        tool_name: "mcp__composio__SLACK_SEND_MESSAGE",
        tool_input: {
          channel: "#ops",
          config: { apiKey: "sk-super-secret", nested: { AUTH_TOKEN: "abc123" } },
          recipients: [{ email: "a@b.co", password: "hunter2" }],
          note: "kept",
        },
      }).status,
    ).toBe(0);

    // Reparse the file: EXACTLY 3 records -- the forged line stayed INSIDE event 2's value.
    const lines = readFileSync(logPath(root), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const records = lines.map((line) => JSON.parse(line));
    expect(records.map((record) => record.tool)).toEqual([
      "mcp__composio__GMAIL_SEND_EMAIL",
      "Write",
      "mcp__composio__SLACK_SEND_MESSAGE",
    ]);
    expect(records.some((record) => record.tool === "FAKE_FORGED_TOOL")).toBe(false);
    expect(records[1].params.content).toContain("line1\nline2");
    expect(records[2].params.config.apiKey).toBe("[redacted]");
    expect(records[2].params.config.nested.AUTH_TOKEN).toBe("[redacted]");
    expect(records[2].params.recipients[0].password).toBe("[redacted]");
    expect(records[2].params.recipients[0].email).toBe("a@b.co");
    expect(records[2].params.note).toBe("kept");
    expect(records.every((record) => record.sessionId === "sess-live" && record.source === "posttooluse-hook")).toBe(true);
  });

  it("ALWAYS exits 0: unwritable log dir and garbage stdin only warn, never block the tool", () => {
    const root = tempRoot();
    installProofloopHooks({ root });
    // Occupy the tooluse path with a FILE so mkdir/append must fail (cross-platform unwritable).
    writeFileSync(join(root, ".proofloop", "tooluse"), "not a directory", "utf8");

    const blocked = logEvent(root, { session_id: "s", tool_name: "Read", tool_input: { file_path: "x" } });
    expect(blocked.status).toBe(0);
    expect(blocked.stderr).toContain("could not append");

    const garbage = runHook(root, "posttooluse-log.mjs", "not json{{{");
    expect(garbage.status).toBe(0);
  });

  it("--no-tooluse-log omits the script and the settings entry; default install adds them back", () => {
    const root = tempRoot();
    const result = installProofloopHooks({ root, toolUseLog: false });
    expect(result.postToolUseLogPath).toBeNull();
    expect(result.addedPostToolUseLogHook).toBe(false);
    expect(existsSync(join(root, ".proofloop", "hooks", "posttooluse-log.mjs"))).toBe(false);
    const settings = readJson(join(root, ".claude", "settings.json"));
    expect(ourEntryCount(settings)).toEqual({ stop: 1, pre: 1, post: 0 });
    expect(readJson(join(root, ".proofloop", "hooks", "config.json")).toolUseLog).toBe(false);

    const second = installProofloopHooks({ root });
    expect(second.addedPostToolUseLogHook).toBe(true);
    expect(ourEntryCount(readJson(join(root, ".claude", "settings.json")))).toEqual({ stop: 1, pre: 1, post: 1 });
    expect(existsSync(join(root, ".proofloop", "hooks", "posttooluse-log.mjs"))).toBe(true);
  });

  it("the PreToolUse guard blocks Edit/Write to the tool-use log (doctoring your own log = reward hacking)", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    const write = runHook(root, "pretooluse-guard.mjs", {
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: join(root, ".proofloop", "tooluse", "log.jsonl"), content: '{"tool":"GMAIL_FETCH_EMAILS"}' },
    });
    expect(write.status).toBe(2);
    expect(write.stderr).toContain("protected proof state");

    const edit = runHook(root, "pretooluse-guard.mjs", {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: ".proofloop/tooluse/log.jsonl", old_string: "a", new_string: "b" },
    });
    expect(edit.status).toBe(2);
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
