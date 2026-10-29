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
const FIND_DENIED = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "pwsh", "powershell", "cmd"]);
const META_CHARS = /[;&|<>`$\r\n]/;

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

function tokenize(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
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

  function checkShell(input: Record<string, unknown>): PolicyDecision {
    let cwd = ws;
    const cwdArg = str(input.cwd) ?? str(input.workdir);
    if (cwdArg) {
      const d = checkPath(cwdArg, "read");
      if (!d.allow) return deny(`Working directory: ${d.reason}`);
      cwd = path.join(ws, d.rel ?? "");
    }
    let tokens: string[];
    let raw: string;
    const command = input.command ?? input.cmd;
    if (Array.isArray(command) && command.every((c) => typeof c === "string")) {
      const argv = command as string[];
      const exe = path.basename(argv[0] ?? "").toLowerCase().replace(/\.exe$/, "");
      if (SHELL_WRAPPERS.has(exe)) {
        const i = argv.findIndex((a, n) => n > 0 && /^(?:-[a-z]*c|-command|\/c|\/k)$/i.test(a));
        if (i < 0 || !argv[i + 1]) return deny(`Unrecognized ${exe} invocation; run one simple command.`);
        raw = argv.slice(i + 1).join(" ");
        tokens = tokenize(raw);
      } else {
        raw = argv.join(" ");
        tokens = argv;
      }
    } else if (typeof command === "string") {
      raw = command;
      tokens = tokenize(command);
    } else return deny("Shell call has no command string Node can check.");

    const lowered = tokens.map((t) => path.basename(t).toLowerCase().replace(/\.(?:exe|cmd|ps1)$/, ""));
    const net = lowered.find((t) => NETWORK_COMMANDS.has(t));
    if (net) return deny(`Network command "${net}" is not allowed; the workspace runs offline.`);
    const meta = raw.match(META_CHARS);
    if (meta) return deny(`Shell metacharacter "${meta[0] === "\n" ? "\\n" : meta[0]}" is not allowed; run one simple command without chaining, pipes, redirects or substitution.`);
    if (tokens.length === 0) return deny("Empty shell command.");

    const cmd = lowered[0];
    if (looksLikePath(tokens[0])) return deny(`Run commands by name, not by path ("${tokens[0]}").`);
    const args = tokens.slice(1);
    const pathArgs: string[] = [];
    const flagValue = (t: string) => (t.includes("=") ? t.slice(t.indexOf("=") + 1) : undefined);

    if (cmd === "node") {
      if (args[0] === "--test") {
        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith("-")) {
            if (a === "--import") {
              if (args[i + 1] && looksLikePath(args[i + 1])) pathArgs.push(args[i + 1]);
              i++;
            } else if (!/^--(?:test|experimental-test)[a-z-]*(?:=|$)/.test(a) && !a.startsWith("--import=")) {
              return deny(`node flag "${a}" is not allowed with --test.`);
            }
            const v = flagValue(a);
            if (v && looksLikePath(v)) pathArgs.push(v);
          } else pathArgs.push(a);
        }
      } else {
        const script = args[0];
        if (!script || script.startsWith("-")) return deny(`Only "node --test ..." or "node <workspace script>.mjs|.js" are allowed (flags like "${script ?? ""}" are not).`);
        if (!/\.(?:mjs|cjs|js)$/i.test(script)) return deny(`node may only run a workspace .mjs/.js script, not "${script}".`);
        pathArgs.push(script, ...args.slice(1).filter((a) => looksLikePath(a) || looksLikePath(flagValue(a) ?? "")).map((a) => flagValue(a) ?? a));
      }
    } else if (cmd === "npm") {
      const ok = (args[0] === "test" || (args[0] === "run" && args[1] === "test"));
      const rest = args.slice(args[0] === "run" ? 2 : 1);
      if (!ok || (rest.length > 0 && rest[0] !== "--")) return deny(`Only "npm test" is allowed, not "npm ${args.join(" ")}".`);
      pathArgs.push(...rest.slice(1).filter(looksLikePath));
    } else if (SIMPLE_COMMANDS.has(cmd)) {
      if (cmd === "find") {
        const bad = args.find((a) => FIND_DENIED.has(a));
        if (bad) return deny(`find ${bad} runs or writes files; only listing is allowed.`);
      }
      for (const a of args) {
        if (a.startsWith("-")) {
          const v = flagValue(a);
          if (v && looksLikePath(v)) pathArgs.push(v);
        } else if (looksLikePath(a) || cmd === "cat" || cmd === "head" || cmd === "tail" || cmd === "wc") pathArgs.push(a);
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
      return deny(`Command "${tokens[0]}" is not on Node's allowlist (node --test, node <script>.mjs, npm test, ls, cat, head, tail, wc, grep, find, pwd, echo).`);
    }

    for (const p of pathArgs) {
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
          return checkShell(args);
        default:
          return deny(`Unknown tool "${name}": Node denies tools it cannot classify.`);
      }
    },
  };
}
