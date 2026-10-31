/**
 * Allowlisted check runner (template.checks). No shell, minimal env, cwd inside
 * the workspace, wall-clock timeout, AbortSignal, bounded output.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { cleanChildEnv } from "./env.js";
import { resolveInside } from "./tools/workspaceFs.js";

export interface CheckSpec {
  cwd: string;
  command: string[];
  timeoutMs: number;
}

export interface CheckRun {
  checkId: string;
  suite: string;
  command: string;
  ok: boolean;
  /** false when refused before spawning (bad cwd, empty command, already aborted). */
  started: boolean;
  /** Counts parsed from the runner's own summary; 0/0 with countsReported=false when it printed none. */
  passed: number;
  failed: number;
  countsReported: boolean;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
  /** Last 4KB of combined stdout/stderr. */
  outputTail: string;
  error?: string;
}

const TAIL = 4096;
const PARSE_WINDOW = 64 * 1024;

/** Map a command to an executable spawnable without a shell (Windows cannot spawn npm.cmd with shell:false). */
export function resolveCommand(command: string[]): { file: string; args: string[] } {
  const [head, ...rest] = command;
  if (head === "node") return { file: process.execPath, args: rest };
  if ((head === "npm" || head === "npx") && process.platform === "win32") {
    const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", `${head}-cli.js`);
    if (existsSync(cli)) return { file: process.execPath, args: [cli, ...rest] };
  }
  return { file: head, args: rest };
}

/** Last "pass N"/"fail N" summary line from node:test TAP (`# pass 3`) or spec (`ℹ pass 3`) output. */
export function parseTestSummary(output: string): { passed: number; failed: number } | null {
  const text = output.replace(/\x1b\[[0-9;]*m/g, "");
  const last = (key: string) => {
    let v: number | undefined;
    for (const m of text.matchAll(new RegExp(`^\\s*(?:#|ℹ)\\s*${key}\\s+(\\d+)\\s*$`, "gm"))) v = Number(m[1]);
    return v;
  };
  const passed = last("pass");
  const failed = last("fail");
  return passed === undefined || failed === undefined ? null : { passed, failed };
}

function killTree(pid: number | undefined, child: { kill(sig?: NodeJS.Signals): boolean }): void {
  if (process.platform === "win32" && pid) {
    // node --test spawns one process per file; kill the whole tree.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
  } else {
    // ponytail: POSIX kills the direct child only; use detached + process.kill(-pid) if orphans show up.
    child.kill("SIGKILL");
  }
}

export function runCheck(opts: { suite: string; spec: CheckSpec; workspaceDir: string; signal: AbortSignal }): Promise<CheckRun> {
  const { suite, spec, workspaceDir, signal } = opts;
  const command = spec.command.join(" ");
  const base = { checkId: `chk_${randomUUID().slice(0, 8)}`, suite, command, passed: 0, failed: 0, countsReported: false, exitCode: null, timedOut: false, aborted: false, durationMs: 0, outputTail: "" };
  const refuse = (error: string, aborted = false): Promise<CheckRun> => Promise.resolve({ ...base, ok: false, started: false, aborted, error });
  if (spec.command.length === 0) return refuse("check has an empty command");
  const cwd = resolveInside(workspaceDir, spec.cwd || ".");
  if (!cwd) return refuse(`check cwd ${spec.cwd} is outside the workspace`);
  if (signal.aborted) return refuse("aborted before start", true);

  const { file, args } = resolveCommand(spec.command);
  const t0 = Date.now();
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    let aborted = false;
    let spawnError: string | undefined;
    const child = spawn(file, args, { cwd, env: cleanChildEnv({ NO_COLOR: "1" }), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const onData = (b: Buffer) => {
      out = (out + b.toString("utf8")).slice(-PARSE_WINDOW);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      if (aborted) return;
      timedOut = true;
      killTree(child.pid, child);
    }, Math.max(1, spec.timeoutMs));
    // First cause wins: taskkill can take ~1s on Windows, long enough for the timer to fire too.
    const onAbort = () => {
      if (timedOut) return;
      clearTimeout(timer);
      aborted = true;
      killTree(child.pid, child);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      spawnError = e.message;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const counts = parseTestSummary(out);
      const exitCode = typeof code === "number" ? code : null;
      const ok = !spawnError && !timedOut && !aborted && exitCode === 0 && (!counts || counts.failed === 0);
      resolve({
        ...base,
        ok,
        started: true,
        passed: counts?.passed ?? 0,
        failed: counts?.failed ?? 0,
        countsReported: counts !== null,
        exitCode,
        timedOut,
        aborted,
        durationMs: Date.now() - t0,
        outputTail: out.slice(-TAIL),
        error: spawnError ?? (timedOut ? `timed out after ${spec.timeoutMs}ms` : aborted ? "aborted" : undefined),
      });
    });
  });
}

/** Append one line to <nodeStateDir>/checks.jsonl (Node-private, outside the workspace). */
export function recordCheck(nodeStateDir: string, run: CheckRun, meta: { runId: string; agentId?: string; independent: boolean }): void {
  mkdirSync(nodeStateDir, { recursive: true });
  appendFileSync(path.join(nodeStateDir, "checks.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), ...meta, ...run })}\n`);
}

export function summarizeCheck(run: CheckRun): string {
  const counts = run.countsReported ? `${run.passed} passed, ${run.failed} failed` : "runner printed no pass/fail counts";
  return `${run.ok ? "PASS" : "FAIL"} ${run.suite} (${run.command}): ${counts}; exit ${run.exitCode ?? "none"}; ${run.durationMs}ms${run.error ? `; ${run.error}` : ""}`;
}
