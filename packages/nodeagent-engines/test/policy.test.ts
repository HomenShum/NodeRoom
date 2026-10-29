/**
 * Policy scenarios. Persona: a native engine (Claude Code or Codex) working on
 * Dana's cleaning task tries both legitimate and escaping tool calls; Node must
 * allow the work and deny every escape with a reason a human can read.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { TemplateConfig } from "../src/contract.js";
import { createPolicy } from "../src/policy.js";

const root = mkdtempSync(path.join(tmpdir(), "nodeagent-policy-"));
const ws = path.join(root, "workspace");
mkdirSync(path.join(ws, "data"), { recursive: true });
mkdirSync(path.join(ws, "secret"), { recursive: true });
mkdirSync(path.join(ws, "test"), { recursive: true });
writeFileSync(path.join(ws, "data", "raw.csv"), "a,b\n");
writeFileSync(path.join(ws, "secret", "key.txt"), "nope");
writeFileSync(path.join(root, "secret"), "outside");
after(() => rmSync(root, { recursive: true, force: true }));

const template: TemplateConfig = { id: "t1", title: "t", description: "", restrictedGlobs: ["secret/**", "**/*.env"], checks: {} };
const policy = createPolicy({ workspaceDir: ws, template, nodeTools: ["read_file", "run_checks"] });
const check = (name: string, input: unknown) => policy.checkNativeTool(name, input, {});

function denied(name: string, input: unknown, why: RegExp) {
  const d = check(name, input);
  assert.equal(d.allow, false, `${name} ${JSON.stringify(input)} should be denied`);
  assert.match(d.reason, why);
}

function allowed(name: string, input: unknown) {
  const d = check(name, input);
  assert.equal(d.allow, true, `${name} ${JSON.stringify(input)} should be allowed: ${d.reason}`);
}

test("legitimate work inside the workspace is allowed", () => {
  allowed("Read", { file_path: "data/raw.csv" });
  allowed("Read", { file_path: path.join(ws, "data", "raw.csv") });
  allowed("Write", { file_path: "analysis/out.md", content: "x" });
  allowed("Edit", { file_path: "data/raw.csv", old_string: "a", new_string: "b" });
  allowed("Glob", { pattern: "data/**/*.csv" });
  allowed("Bash", { command: "node --test" });
  allowed("Bash", { command: "node --test test/clean.test.mjs" });
  allowed("Bash", { command: "node scripts/clean.mjs data/raw.csv" });
  allowed("Bash", { command: "npm test" });
  allowed("Bash", { command: "ls data" });
  allowed("commandExecution", { command: ["node", "--test"], cwd: ws });
  allowed("fileChange", { changes: [{ path: "analysis/out.md", kind: "add" }] });
  allowed("apply_patch", { input: "*** Begin Patch\n*** Add File: analysis/out.md\n+hi\n*** End Patch" });
});

test("planning/meta tools and Node catalog tools are allowed", () => {
  for (const t of ["TodoWrite", "Agent", "Task", "Skill", "ToolSearch"]) allowed(t, {});
  allowed("mcp__node__read_file", { path: "data/raw.csv" });
  allowed("run_checks", {});
});

test("path escape with ..\\..\\secret is denied", () => {
  denied("Read", { file_path: "..\\..\\secret" }, /outside the project workspace/);
  denied("Read", { file_path: "../secret" }, /outside the project workspace/);
  denied("Glob", { pattern: "../**/*" }, /climbs out/);
  denied("Bash", { command: "cat ../secret" }, /outside the project workspace/);
});

test("absolute paths outside the workspace are denied (native and Git Bash spellings)", () => {
  denied("Read", { file_path: path.join(root, "secret") }, /outside the project workspace/);
  denied("Write", { file_path: process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd", content: "x" }, /outside/);
  denied("Bash", { command: `cat ${path.join(root, "secret").replace(/\\/g, "/")}` }, /outside/);
  if (process.platform === "win32") denied("Bash", { command: "ls /c/Windows" }, /outside/);
  denied("commandExecution", { command: "ls", cwd: root }, /Working directory.*outside/);
  denied("Read", { file_path: "~/.ssh/id_rsa" }, /home-directory/);
});

test("restricted template globs are denied for reads and writes", () => {
  denied("Read", { file_path: "secret/key.txt" }, /restricted by the t1 template/);
  denied("Write", { file_path: "secret/new.txt", content: "x" }, /restricted/);
  denied("Read", { file_path: "data/prod.env" }, /restricted/);
  denied("Bash", { command: "cat secret/key.txt" }, /restricted/);
  denied("Grep", { pattern: "key", path: "." }, /restricted/);
  // "**/*.env" can match under any directory, so any recursive content search could read one.
  denied("Grep", { pattern: "a", path: "data" }, /would read restricted paths/);
  const narrow = createPolicy({ workspaceDir: ws, template: { ...template, restrictedGlobs: ["secret/**"] } });
  assert.equal(narrow.checkNativeTool("Grep", { pattern: "a", path: "data" }, {}).allow, true);
  assert.equal(narrow.checkNativeTool("Grep", { pattern: "a", path: "." }, {}).allow, false);
});

test("native writes into Node-owned .claude/.codex/.agents are denied; reads are not", () => {
  denied("Write", { file_path: ".claude/skills/evil/SKILL.md", content: "---\nname: evil\n---" }, /reserved for Node/);
  denied("Edit", { file_path: ".codex/config.toml", old_string: "a", new_string: "b" }, /reserved for Node/);
  denied("fileChange", { changes: [{ path: ".agents/x.md" }] }, /reserved for Node/);
  denied("apply_patch", { input: "*** Begin Patch\n*** Add File: .claude/settings.json\n+{}\n*** End Patch" }, /reserved for Node/);
  allowed("Read", { file_path: ".claude/skills/clean/SKILL.md" });
});

test("shell chaining, substitution and network are denied", () => {
  denied("Bash", { command: "node --test && curl x" }, /Network command "curl"|metacharacter/);
  denied("Bash", { command: "node --test; rm -rf ." }, /metacharacter ";"/);
  denied("Bash", { command: "ls | head" }, /metacharacter "\|"/);
  denied("Bash", { command: "echo $(whoami)" }, /metacharacter/);
  denied("Bash", { command: "echo hi > out.txt" }, /metacharacter ">"/);
  denied("Bash", { command: "wget http://x" }, /Network command "wget"/);
  denied("PowerShell", { command: "Invoke-WebRequest http://x" }, /Network command/);
  denied("commandExecution", { command: ["bash", "-lc", "curl http://x"] }, /Network command/);
  denied("Bash", { command: "rm -rf data" }, /not on Node's allowlist/);
  denied("Bash", { command: "node -e \"require('fs')\"" }, /Only "node --test/);
  denied("Bash", { command: "npm install left-pad" }, /Only "npm test"/);
  denied("Bash", { command: "find . -delete" }, /only listing/);
});

test("network and unknown tools are denied with a reason", () => {
  denied("WebFetch", { url: "https://example.com" }, /network/);
  denied("WebSearch", { query: "x" }, /network/);
  denied("SomeNewTool", {}, /Unknown tool "SomeNewTool"/);
  denied("", {}, /no name/);
  denied("Write", {}, /no target path/);
  denied("Bash", {}, /no command/);
});
