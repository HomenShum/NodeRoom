/**
 * Policy scenarios. Persona: a native engine (Claude Code or Codex) working on
 * Dana's cleaning task tries both legitimate and escaping tool calls; Node must
 * allow the work and deny every escape with a reason a human can read.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

/**
 * Persona: an engine on a diligence pack whose template restricts sources/restricted/**.
 * It tries to read the restricted deal memo through wildcards, quoting, escapes and
 * PowerShell grouping. Node must check what the shell will actually run.
 */
const deal = path.join(root, "deal");
for (const [rel, text] of [
  ["sources/restricted/deal.md", "TOP-SECRET-LINE\n"],
  ["sources/restricted/a", "TOP-SECRET-LINE\n"],
  ["sources/public/deal.md", "public line\n"],
  ["analysis/a.md", "Total: 42\n"],
  ["report/x.mjs", "console.log('report ok');\n"],
  [".claude/skills/clean/SKILL.md", "---\nname: clean\n---\n"],
]) {
  mkdirSync(path.dirname(path.join(deal, rel)), { recursive: true });
  writeFileSync(path.join(deal, rel), text);
}
const dealPolicy = createPolicy({ workspaceDir: deal, template: { id: "diligence-pack", title: "", description: "", restrictedGlobs: ["sources/restricted/**"], checks: {} } });
const bashCheck = (command: string) => dealPolicy.checkNativeTool("Bash", { command }, {});
// Codex on Windows sends PowerShell commands wrapped like this; Claude's PowerShell tool sends the bare string.
const psCheck = (inner: string) => dealPolicy.checkNativeTool("commandExecution", { command: ["powershell.exe", "-Command", inner], cwd: deal }, {});
const psToolCheck = (command: string) => dealPolicy.checkNativeTool("PowerShell", { command }, {});
const run = (exe: string, args: string[]) => {
  const r = spawnSync(exe, args, { cwd: deal, encoding: "utf8", timeout: 20_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const hasBash = run("bash", ["-c", "echo ok"]).ok;
const hasPs = process.platform === "win32" && run("powershell.exe", ["-NoProfile", "-Command", "echo ok"]).ok;

const BASH_LEAKS = [
  "cat sources/*/deal.md",
  "head sources/r*/deal.md",
  "grep SECRET sources/*/*",
  "grep SECRET sources/*/deal.md",
  "cat sources/{restricted,x}/a",
  `cat sources/"restricted"/a`,
  String.raw`cat sources/re\stricted/a`,
];

test("POSIX wildcards, brace expansion, partial quotes and backslash escapes cannot reach a restricted folder", () => {
  for (const c of BASH_LEAKS) {
    const d = bashCheck(c);
    assert.equal(d.allow, false, `${c} should be denied: ${d.reason}`);
  }
  assert.match(bashCheck("cat sources/*/deal.md").reason, /would read restricted paths/);
  assert.match(bashCheck("cat sources/{restricted,x}/a").reason, /Shell syntax "\{"/);
  assert.match(bashCheck(`cat sources/"restricted"/a`).reason, /Quotes inside/);
  assert.match(bashCheck(String.raw`cat sources/re\stricted/a`).reason, /Backslash/);
});

test("observed in bash: every probe really prints the restricted line, and nothing Node allows ever does", { skip: !hasBash && "no bash on PATH" }, () => {
  for (const c of BASH_LEAKS) {
    const r = run("bash", ["-c", c]);
    assert.match(r.out, /TOP-SECRET-LINE/, `${c} is a real leak`);
    assert.equal(bashCheck(c).allow, false, `Node allowed ${c}, which printed the restricted line`);
  }
  for (const c of ["cat analysis/a.md", `cat "analysis/a.md"`, `grep -n "To.*al" analysis/a.md`, "ls sources", "cat sources/public/*"]) {
    assert.equal(bashCheck(c).allow, true, `${c} should be allowed: ${bashCheck(c).reason}`);
    const r = run("bash", ["-c", c]);
    assert.ok(r.ok && !r.out.includes("TOP-SECRET"), `${c} -> ${r.out}`);
  }
});

const PS_LEAKS = [
  "Get-Content sources/*/deal.md",
  "Get-Content sources/r*/deal.md",
  "Select-String -Pattern secret sources/*/*",
  "Get-Content 'sources/*/deal.md'",
  "Get-Content -Path:sources/*/deal.md",
  "Get-Content analysis/a.md,sources/restricted/deal.md",
];

test("PowerShell wildcards (quoted or not), argument lists, grouping and provider paths are denied", () => {
  // sources/* only lists folders under Windows PowerShell 5.1, but under other globs it can match a restricted file.
  for (const c of [...PS_LEAKS, "Select-String -Pattern secret sources/*", "(Get-Content analysis/a.md)"]) {
    for (const d of [psCheck(c), psToolCheck(c)]) assert.equal(d.allow, false, `${c} should be denied: ${d.reason}`);
  }
  // A parenthesised sub-command inside an allowlisted cmdlet's arguments is never checked by name.
  assert.match(psCheck("Get-Content (Resolve-Path analysis/a.md)").reason, /Shell syntax "\("/);
  assert.match(psCheck("Get-ChildItem env:").reason, /provider path/);
  assert.match(psCheck("Get-Content env:PATH").reason, /provider path/);
});

test("observed in PowerShell: every probe really prints the restricted line, and nothing Node allows ever does", { skip: !hasPs && "no Windows PowerShell" }, () => {
  for (const c of PS_LEAKS) {
    assert.match(run("powershell.exe", ["-NoProfile", "-Command", c]).out, /TOP-SECRET-LINE/i, `${c} is a real leak`);
    assert.equal(psCheck(c).allow, false, `Node allowed ${c}, which printed the restricted line`);
  }
  for (const c of [String.raw`Get-ChildItem .claude\skills`, String.raw`Get-Content analysis\a.md`, `Select-String -Pattern "Total:" analysis/a.md`]) {
    assert.equal(psCheck(c).allow, true, `${c} should be allowed: ${psCheck(c).reason}`);
    const r = run("powershell.exe", ["-NoProfile", "-Command", c]);
    assert.ok(r.ok && !r.out.includes("TOP-SECRET"), `${c} -> ${r.out}`);
  }
});

test("node runs workspace code only: URL imports and code-evaluating flags are denied, test and script runs still work", () => {
  for (const c of ["node --test --import data:text/javascript,0", "node --test --import=data:text/javascript,0", "node --test --import file:///etc/x.mjs", "node --test --test-reporter=data:text/javascript,0", "node --test -e 0", "node --test --require ./x.cjs", "node -e 0", "node --import tsx report/x.mjs"]) {
    const d = bashCheck(c);
    assert.equal(d.allow, false, `${c} should be denied: ${d.reason}`);
  }
  assert.match(bashCheck("node --test --import data:text/javascript,0").reason, /is a URL/);
  for (const c of ["node --test", "node --test --import tsx test/x.test.ts", "node report/x.mjs", "ls", "cat analysis/a.md", "npm test"]) {
    assert.equal(bashCheck(c).allow, true, `${c} should be allowed: ${bashCheck(c).reason}`);
  }
  assert.equal(psCheck(String.raw`Get-ChildItem .claude\skills`).allow, true);
  assert.equal(psToolCheck(String.raw`Get-ChildItem .claude\skills`).allow, true);
  assert.equal(dealPolicy.checkNativeTool("commandExecution", { command: ["cmd", "/c", "type analysis/a.md"] }, {}).allow, false, "cmd.exe rewriting is not modelled");
});
