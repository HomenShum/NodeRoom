/**
 * JSON-RPC over stdio JSONL for `codex app-server` (pinned @openai/codex binary).
 * Client requests carry numeric ids; server requests (approvals, dynamic tool
 * calls) carry their own ids and must be answered with `respond`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type RpcId = number | string;
export interface RpcMessage {
  id?: RpcId;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

const PLATFORM: Record<string, [string, string]> = {
  "win32-x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc"],
  "win32-arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"],
  "linux-x64": ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl"],
  "linux-arm64": ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl"],
  "darwin-x64": ["@openai/codex-darwin-x64", "x86_64-apple-darwin"],
  "darwin-arm64": ["@openai/codex-darwin-arm64", "aarch64-apple-darwin"],
};

const require = createRequire(import.meta.url);

/** The pinned package's native binary, never a global `codex` on PATH. */
export function resolveCodexBinary(): { path: string; version: string } | { error: string } {
  const key = `${process.platform}-${process.arch}`;
  const entry = PLATFORM[key];
  if (!entry) return { error: `@openai/codex has no native binary for ${key}` };
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync(require.resolve("@openai/codex/package.json"), "utf8")).version;
  } catch {
    return { error: "@openai/codex is not installed" };
  }
  let root: string;
  try {
    root = dirname(require.resolve(`${entry[0]}/package.json`));
  } catch {
    return { error: `${entry[0]} (optional dependency of @openai/codex) is not installed` };
  }
  const bin = join(root, "vendor", entry[1], "bin", process.platform === "win32" ? "codex.exe" : "codex");
  return existsSync(bin) ? { path: bin, version } : { error: `codex binary missing at ${bin}` };
}

const MAX_LINE = 32 * 1024 * 1024;
const STDERR_TAIL = 8 * 1024;

export class CodexRpc {
  private proc: ChildProcess;
  private buf = "";
  private nextId = 1;
  private pending = new Map<RpcId, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  private stderr = "";
  private exitError: Error | undefined;
  onNotification: (msg: RpcMessage) => void = () => {};
  /** Answer a server-initiated request; a throw becomes a JSON-RPC error. */
  onRequest: (msg: RpcMessage) => Promise<unknown> = async (m) => {
    throw new Error(`unhandled server request ${m.method}`);
  };
  /** Every inbound message, for recording fixtures. */
  onMessage: ((msg: RpcMessage, dir: "in" | "out") => void) | undefined;
  readonly exited: Promise<{ code: number | null; signal: string | null }>;

  constructor(bin: string, args: string[], env: Record<string, string>, cwd: string) {
    this.proc = spawn(bin, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc.stdout!.setEncoding("utf8");
    this.proc.stdout!.on("data", (chunk: string) => this.feed(chunk));
    this.proc.stderr!.setEncoding("utf8");
    this.proc.stderr!.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL);
    });
    this.exited = new Promise((resolve) => {
      this.proc.on("error", (err) => {
        this.exitError = err;
        this.failAll(err);
        resolve({ code: null, signal: null });
      });
      this.proc.on("exit", (code, signal) => {
        this.exitError ??= new Error(`codex app-server exited (code ${code}, signal ${signal}). stderr: ${this.stderrTail()}`);
        this.failAll(this.exitError);
        resolve({ code, signal });
      });
    });
  }

  stderrTail(max = 1500): string {
    return this.stderr.slice(-max).trim();
  }

  request<T = any>(method: string, params: unknown): Promise<T> {
    if (this.exitError) return Promise.reject(this.exitError);
    const id = this.nextId++;
    const msg = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.write(msg);
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  close(): void {
    if (this.proc.exitCode === null && !this.proc.killed) this.proc.kill();
  }

  private write(msg: RpcMessage): void {
    this.onMessage?.(msg, "out");
    if (this.proc.stdin?.writable) this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private feed(chunk: string): void {
    this.buf += chunk;
    if (this.buf.length > MAX_LINE) {
      this.failAll(new Error(`codex app-server line exceeded ${MAX_LINE} bytes`));
      this.close();
      return;
    }
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // non-JSON log line on stdout
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: RpcMessage): void {
    this.onMessage?.(msg, "in");
    if (msg.method && msg.id !== undefined) {
      const id = msg.id;
      this.onRequest(msg).then(
        (result) => this.write({ id, result: result ?? {} }),
        (err) => this.write({ id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } }),
      );
      return;
    }
    if (msg.method) {
      this.onNotification(msg);
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
