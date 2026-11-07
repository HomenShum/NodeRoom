/**
 * Node's execution-time permission gate for native engine tools (Claude Read/
 * Write/Bash..., Codex shell/fileChange/apply_patch, generic names). Node tools
 * are validated by the gateway and their own workspace checks.
 *
 * Ceiling: this gates tool arguments, not processes. Code an engine runs via an
 * allowed command (node <script>, npm test) is not sandboxed.
 */
import path from "node:path";
import type { PolicyDecision, PolicyGate, TemplateConfig } from "./contract.js";
import { isRestricted, resolveInside, toRel } from "./tools/workspaceFs.js";

export interface PolicyOptions {
  workspaceDir: string;
  template: TemplateConfig;
  /** Node catalog tool names; allowed by name (bare or mcp__<server>__<name>). */
  nodeTools?: string[];
}

type Kind = "read" | "search" | "write" | "shell" | "network" | "meta";

const KINDS: Record<string, Kind> = {
  read: "read", notebookread: "read", readfile: "read", view: "read", ls: "read", listdir: "read", listfiles: "read",
  glob: "read",
  grep: "search",
  write: "write", edit: "write", multiedit: "write", notebookedit: "write", writefile: "write", editfile: "write",
  createfile: "write", filechange: "write", applypatch: "write",
  bash: "shell", powershell: "shell", shell: "shell", localshell: "shell", execcommand: "shell", unifiedexec: "shell",
  commandexecution: "shell", runcommand: "shell", exec: "shell", terminal: "shell",
  webfetch: "network", websearch: "network", fetch: "network", httprequest: "network", browser: "network", websearchcall: "network",
  todowrite: "meta", agent: "meta", task: "meta", skill: "meta", toolsearch: "meta", exitplanmode: "meta",
  bashoutput: "meta", taskoutput: "meta", killshell: "meta", killbash: "meta", taskstop: "meta",
};

/** First path segments only Node may write (skills, engine config). */
const NODE_OWNED_DIRS = new Set([".claude", ".codex", ".agents"]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "nc", "ncat", "ssh", "scp", "sftp", "ftp", "telnet"]);
const SIMPLE_COMMANDS = new Set(["ls", "cat", "head", "tail", "wc", "grep", "find", "pwd", "echo"]);
/** Codex runs shell commands through PowerShell on Windows; its read-only cmdlets map onto the POSIX allowlist. */
const POWERSHELL_READ = new Map([
  ["get-childitem", "ls"], ["gci", "ls"], ["dir", "ls"], ["resolve-path", "ls"], ["test-path", "ls"],
  ["get-content", "cat"], ["gc", "cat"], ["type", "cat"],
  ["select-string", "grep"], ["sls", "grep"],
  ["get-location", "pwd"],
]);
const CONTENT_COMMANDS = new Set(["cat", "head", "tail", "wc", "grep"]);
const GLOB_CHARS = /[*?[\]]/;
const FIND_DENIED = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);
/** cmd.exe is not a wrapper: its ^ and % rewriting is not modelled, so it falls through to the allowlist and is denied. */
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "pwsh", "powershell"]);
const CHAIN_CHARS = /[;&|<>`$\r\n]/;
/** Syntax the shell rewrites after Node reads the words: grouping, brace/% expansion, smart quotes, non-space blanks. */
const REWRITE_CHARS = /[(){}%\u2018-\u201F]|[^\S \t]/;
const WORD = /(?:"[^"]*"|'[^']*'|[^\s"'])+/g;
/** Two+ letters before ":" is a URL scheme (data:, file:, node:); one letter is a drive. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const PATTERN_FLAG = /^(?:-e|--regexp|-patt[a-z]*)(?:=|$)/i;

const allow = (reason: string): PolicyDecision => ({ allow: true, reason });
const deny = (reason: string): PolicyDecision => ({ allow: false, reason });

function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Git Bash spells D:\x as /d/x; map it back so containment is checked on the real path. */
function nativePath(p: string): string {
  if (process.platform === "win32") {
    const m = p.match(/^\/([a-zA-Z])(?:\/|$)(.*)$/);
    if (m) return `${m[1].toUpperCase()}:/${m[2]}`;
  }
  return p;
}

function staticGlobPrefix(glob: string): string {
  const parts = glob.replace(/\\/g, "/").split("/");
  const fixed: string[] = [];
  for (const part of parts) {
    if (/[*?[\]{}]/.test(part)) break;
    fixed.push(part);
  }
  return fixed.join("/");
}

/** Paths an input targets, by the argument names engines use. */
function collectPaths(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["file_path", "filePath", "path", "notebook_path", "notebookPath", "target", "grantRoot"]) {
    const v = str(input[k]);
    if (v) out.push(v);
  }
  if (Array.isArray(input.paths)) for (const p of input.paths) if (str(p)) out.push(p as string);
  const changes = input.changes;
  if (Array.isArray(changes)) {
    for (const c of changes) {
      const p = c && typeof c === "object" ? str((c as Record<string, unknown>).path) : undefined;
      if (p) out.push(p);
    }
  } else if (changes && typeof changes === "object") out.push(...Object.keys(changes));
  // apply_patch freeform body: "*** Update File: a.js", "*** Move to: b.js".
  for (const k of ["patch", "input"]) {
    const body = str(input[k]);
    if (body) for (const m of body.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) out.push(m[1].trim());
  }
  return out;
}

/** Shell words as the shell splits them. A word is quoted whole or not at all; quoted[i] marks a literal word. */
function shellWords(command: string): { tokens: string[]; quoted: boolean[]; bad?: string } {
  const tokens: string[] = [];
  const quoted: boolean[] = [];
  for (const [w] of command.matchAll(WORD)) {
    const q = /^"([^"]*)"$|^'([^']*)'$/.exec(w);
    if (!q && /["']/.test(w)) return { tokens, quoted, bad: `Quotes inside ${w} are not allowed; quote a whole argument or none of it.` };
    tokens.push(q ? (q[1] ?? q[2]) : w);
    quoted.push(!!q);
  }
  if (command.replace(WORD, "").trim()) return { tokens, quoted, bad: "Unbalanced quote; quote a whole argument or none of it." };
  return { tokens, quoted };
}

function looksLikePath(t: string): boolean {
  return /[\\/]/.test(t) || t.startsWith(".") || /^[a-zA-Z]:/.test(t) || path.isAbsolute(t);
}

export function createPolicy(opts: PolicyOptions): PolicyGate {
  const ws = path.resolve(opts.workspaceDir);
  const restricted = opts.template.restrictedGlobs ?? [];
  const nodeTools = new Set(opts.nodeTools ?? []);
  const restrictedPrefixes = restricted.map((g) => staticGlobPrefix(g).replace(/\/+$/, ""));

  /** Resolves `p` (relative to `base`) inside the workspace, or explains why not. */
  function checkPath(p: string, mode: "read" | "write", base = ws): PolicyDecision & { rel?: string } {
    if (p.startsWith("~")) return deny(`Path "${p}" uses home-directory expansion; use a workspace-relative path.`);
    const raw = nativePath(p);
    const abs = resolveInside(ws, path.isAbsolute(raw) ? raw : path.join(base, raw));
    if (!abs) return deny(`Path "${p}" is outside the project workspace.`);
    const rel = toRel(ws, abs);
    if (restricted.length && isRestricted(rel, restricted))
      return deny(`Path "${rel || "."}" is restricted by the ${opts.template.id} template and cannot be ${mode === "read" ? "read" : "written"}.`);
    const first = rel.split("/")[0]?.toLowerCase() ?? "";
    if (mode === "write" && NODE_OWNED_DIRS.has(first))
      return deny(`Writes under ${first}/ are reserved for Node (skills are created through the skill tools).`);
    return { ...allow(`"${rel || "."}" is inside the workspace`), rel };
  }

  /** A recursive content search rooted at an ancestor of restricted paths would read them. */
  function checkSearchRoot(rel: string): PolicyDecision {
    const root = rel === "." ? "" : rel.replace(/\/+$/, "");
    const hit = restrictedPrefixes.find((pre, i) => root === "" || pre === "" || pre === root || pre.startsWith(`${root}/`) || isRestricted(root, [restricted[i]]));
    if (hit !== undefined)
      return deny(`Searching "${root || "."}" would read restricted paths (${restricted.join(", ")}); search a directory that does not contain them.`);
    return allow(`search root "${root || "."}" contains no restricted paths`);
  }

  function checkFiles(input: Record<string, unknown>, mode: "read" | "write", name: string): PolicyDecision {
    const paths = collectPaths(input);
    const pattern = str(input.pattern);
    if (key(name) === "glob" && pattern) {
      if (pattern.replace(/\\/g, "/").split("/").includes("..")) return deny(`Glob pattern "${pattern}" climbs out of the workspace with "..".`);
      const prefix = staticGlobPrefix(pattern);
      if (prefix) paths.push(prefix);
    }
    const glob = str(input.glob);
    if (glob && (glob.includes("..") || path.isAbsolute(glob))) return deny(`Glob filter "${glob}" must stay workspace-relative.`);
    if (paths.length === 0) return mode === "write" ? deny(`${name} has no target path Node can check.`) : allow(`${name} defaults to the workspace root`);
    for (const p of paths) {
      const d = checkPath(p, mode);
      if (!d.allow) return d;
    }
    return allow(`${name} targets stay inside the workspace`);
  }

  function checkShell(input: Record<string, unknown>, toolKey: string): PolicyDecision {
    let cwd = ws;
    const cwdArg = str(input.cwd) ?? str(input.workdir);
    if (cwdArg) {
      const d = checkPath(cwdArg, "read");
      if (!d.allow) return deny(`Working directory: ${d.reason}`);
      cwd = path.join(ws, d.rel ?? "");
    }
    let raw: string;
    // Claude's PowerShell tool and "powershell -Command" run PowerShell; everything else is judged as a POSIX shell (Claude's Bash is Git Bash).
    let ps = toolKey === "powershell";
    const command = input.command ?? input.cmd;
    if (Array.isArray(command) && command.every((c) => typeof c === "string")) {
      const argv = command as string[];
      const exe = path.basename(argv[0] ?? "").toLowerCase().replace(/\.exe$/, "");
      if (SHELL_WRAPPERS.has(exe)) {
        const i = argv.findIndex((a, n) => n > 0 && /^(?:-[a-z]*c|-command)$/i.test(a));
        if (i < 0 || !argv[i + 1]) return deny(`Unrecognized ${exe} invocation; run one simple command.`);
        raw = argv.slice(i + 1).join(" ");
        ps = exe === "pwsh" || exe === "powershell";
      } else raw = argv.join(" ");
    } else if (typeof command === "string") raw = command;
    else return deny("Shell call has no command string Node can check.");

    const words = shellWords(raw);
    if (words.bad) return deny(words.bad);
    const { quoted } = words;
    // PowerShell: "\" separates paths and -Name:value binds a value; normalize so paths are checked as PowerShell reads them.
    const tokens = ps ? words.tokens.map((t) => t.replace(/\\/g, "/").replace(/^(-[a-z]+):/i, "$1=")) : words.tokens;
    const lowered = tokens.map((t) => path.basename(t).toLowerCase().replace(/\.(?:exe|cmd|ps1)$/, ""));
    const net = lowered.find((t) => NETWORK_COMMANDS.has(t));
    if (net) return deny(`Network command "${net}" is not allowed; the workspace runs offline.`);
    const meta = raw.match(CHAIN_CHARS);
    if (meta) return deny(`Shell metacharacter "${meta[0] === "\n" ? "\\n" : meta[0]}" is not allowed; run one simple command without chaining, pipes, redirects or substitution.`);
    if (tokens.length === 0) return deny("Empty shell command.");

    const cmd = POWERSHELL_READ.get(lowered[0]) ?? lowered[0];
    if (looksLikePath(tokens[0])) return deny(`Run commands by name, not by path ("${tokens[0]}").`);
    const args = tokens.slice(1);
    /** [path, quoted]: a quoted word is literal to a POSIX shell, but PowerShell cmdlets still expand its wildcards. */
    const pathArgs: Array<[string, boolean]> = [];
    const add = (p: string, i: number) => pathArgs.push([p, quoted[i + 1]]);
    const flagValue = (t: string) => (t.includes("=") ? t.slice(t.indexOf("=") + 1) : undefined);

    if (cmd === "node" || cmd === "npm") {
      const url = args.find((a) => URL_SCHEME.test(flagValue(a) ?? a));
      if (url) return deny(`${cmd} argument "${url}" is a URL; only workspace files may run.`);
    }
    if (cmd === "node") {
      if (args[0] === "--test") {
        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith("-")) {
            if (a === "--import") {
              if (args[i + 1] && looksLikePath(args[i + 1])) add(args[i + 1], i + 1);
              i++;
            } else if (!/^--(?:test|experimental-test)[a-z-]*(?:=|$)/.test(a) && !a.startsWith("--import=")) {
              return deny(`node flag "${a}" is not allowed with --test.`);
            }
            const v = flagValue(a);
            if (v && looksLikePath(v)) add(v, i);
          } else add(a, i);
        }
      } else {
        const script = args[0];
        if (!script || script.startsWith("-")) return deny(`Only "node --test ..." or "node <workspace script>.mjs|.js" are allowed (flags like "${script ?? ""}" are not).`);
        if (!/\.(?:mjs|cjs|js)$/i.test(script)) return deny(`node may only run a workspace .mjs/.js script, not "${script}".`);
        add(script, 0);
        args.forEach((a, i) => {
          if (i > 0 && (looksLikePath(a) || looksLikePath(flagValue(a) ?? ""))) add(flagValue(a) ?? a, i);
        });
      }
    } else if (cmd === "npm") {
      const ok = (args[0] === "test" || (args[0] === "run" && args[1] === "test"));
      const from = args[0] === "run" ? 2 : 1;
      const rest = args.slice(from);
      if (!ok || (rest.length > 0 && rest[0] !== "--")) return deny(`Only "npm test" is allowed, not "npm ${args.join(" ")}".`);
      rest.forEach((a, i) => {
        if (i > 0 && looksLikePath(a)) add(a, from + i);
      });
    } else if (SIMPLE_COMMANDS.has(cmd)) {
      if (cmd === "find") {
        const bad = args.find((a) => FIND_DENIED.has(a));
        if (bad) return deny(`find ${bad} runs or writes files; only listing is allowed.`);
      }
      // grep's pattern is the -e/-Pattern value or its first operand; every other content operand is a file.
      const pf = args.findIndex((a) => PATTERN_FLAG.test(a));
      const patternAt = cmd !== "grep" ? -1 : pf < 0 ? args.findIndex((a) => !a.startsWith("-")) : args[pf].includes("=") ? -1 : pf + 1;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith("-")) {
          const v = flagValue(a);
          if (v && (ps ? !PATTERN_FLAG.test(a) : looksLikePath(v))) add(v, i);
        } else if (i === patternAt ? looksLikePath(a) : ps || CONTENT_COMMANDS.has(cmd) || looksLikePath(a)) add(a, i);
      }
      if (cmd === "grep" && restricted.length) {
        const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive" || a === "--dereference-recursive");
        if (recursive) {
          const operands = args.filter((a) => !a.startsWith("-"));
          const roots = operands.length <= 1 ? ["."] : operands.slice(1);
          for (const r of roots) {
            const d = checkPath(r, "read", cwd);
            if (!d.allow) return d;
            const s = checkSearchRoot(d.rel ?? "");
            if (!s.allow) return s;
          }
        }
      }
    } else {
      return deny(`Command "${tokens[0]}" is not on Node's allowlist (node --test, node <script>.mjs, npm test, ls, cat, head, tail, wc, grep, find, pwd, echo, or their PowerShell equivalents Get-ChildItem, Get-Content, Select-String, Get-Location).`);
    }

    const rewrite = raw.match(REWRITE_CHARS);
    if (rewrite) return deny(`Shell syntax ${JSON.stringify(rewrite[0])} is not allowed: the shell would rewrite the command after Node checked it.`);
    if (!ps && raw.includes("\\")) return deny(`Backslash in "${raw}" is a shell escape here; use forward slashes in paths.`);
    const list = ps && tokens.find((t, i) => !quoted[i] && t.includes(","));
    if (list) return deny(`"${list}" is a PowerShell argument list; pass one path per argument.`);
    // A POSIX shell expands every unquoted wildcard word, whatever argument it is.
    if (!ps) tokens.forEach((t, i) => i > 0 && !quoted[i] && GLOB_CHARS.test(t) && pathArgs.push([t, false]));

    for (const [p, q] of pathArgs) {
      if (ps && /:/.test(p.replace(/^[a-z]:(?=\/|$)/i, ""))) return deny(`"${p}" is a PowerShell provider path (env:, variable:, HKLM:); only workspace files are allowed.`);
      if (GLOB_CHARS.test(p) && (ps || !q)) {
        // A wildcard can expand into restricted folders; content commands may only glob
        // under a directory that contains no restricted paths. Listing names is fine.
        const d = checkPath(staticGlobPrefix(p) || ".", "read", cwd);
        if (!d.allow) return d;
        if (CONTENT_COMMANDS.has(cmd) && restricted.length) {
          const s = checkSearchRoot(d.rel ?? "");
          if (!s.allow) return s;
        }
        continue;
      }
      const d = checkPath(p, "read", cwd);
      if (!d.allow) return d;
    }
    return allow(`"${tokens.join(" ")}" is an allowlisted command inside the workspace`);
  }

  return {
    checkNativeTool(name, input) {
      if (typeof name !== "string" || !name) return deny("Tool call has no name.");
      const mcp = name.match(/^mcp__[^_]+(?:_[^_]+)*__(.+)$/);
      if (nodeTools.has(name) || (mcp && nodeTools.has(mcp[1]))) return allow(`${name} is a Node catalog tool; the Node gateway validates it`);
      const kind = KINDS[key(name)];
      const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      switch (kind) {
        case "meta":
          return allow(`${name} is a planning/meta tool`);
        case "network":
          return deny(`${name} reaches the network; the workspace runs offline.`);
        case "read":
          return checkFiles(args, "read", name);
        case "search": {
          const d = checkFiles(args, "read", name);
          if (!d.allow || !restricted.length) return d;
          const root = str(args.path) ? checkPath(str(args.path)!, "read") : { ...allow(""), rel: "" };
          return root.allow ? checkSearchRoot(root.rel ?? "") : root;
        }
        case "write":
          return checkFiles(args, "write", name);
        case "shell":
          return checkShell(args, key(name));
        default:
          return deny(`Unknown tool "${name}": Node denies tools it cannot classify.`);
      }
    },
  };
}
