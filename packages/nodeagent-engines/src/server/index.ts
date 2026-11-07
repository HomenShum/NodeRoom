/**
 * The Node agent worker: store + engine registry + templates + run manager
 * behind the loopback HTTP API.
 */
import type { AddressInfo } from "node:net";
import type { EngineAdapter } from "../contract.js";
import { loadProviderEnv } from "../env.js";
import { createEngineRegistry } from "../registry.js";
import { createHttpServer } from "./http.js";
import { RunManager } from "./runManager.js";
import { Store } from "./store.js";
import { loadTemplates, packageVersion } from "./templates.js";

export interface WorkerOptions {
  home: string;
  envFiles: string[];
  /** 0 picks a free port. */
  port: number;
  /** Replaces the built-in engine set (tests, embedders). */
  adapters?: EngineAdapter[];
  /** Defaults to the package's fixtures/ directory. */
  fixturesDir?: string;
  maxConcurrent?: number;
  artifactDebounceMs?: number;
  abortGraceMs?: number;
  heartbeatMs?: number;
  log?: (message: string) => void;
}

export interface Worker {
  url: string;
  manager: RunManager;
  close(reason?: string): Promise<void>;
}

export async function createWorker(opts: WorkerOptions): Promise<Worker> {
  const log = opts.log ?? ((m: string) => console.error(`[nodeagent-worker] ${m}`));
  const store = new Store(opts.home);
  const registry = createEngineRegistry(opts.adapters);
  const templates = loadTemplates(opts.fixturesDir, log);
  const env = loadProviderEnv(opts.envFiles);
  const manager = new RunManager({
    home: opts.home,
    store,
    registry,
    templates,
    env,
    log,
    maxConcurrent: opts.maxConcurrent,
    artifactDebounceMs: opts.artifactDebounceMs,
    abortGraceMs: opts.abortGraceMs,
  });
  const recovered = manager.recover();
  if (recovered) log(`marked ${recovered} run(s) from a previous worker as interrupted (worker_restart)`);

  const server = createHttpServer({
    manager,
    registry,
    templates,
    env,
    worker: { version: packageVersion(), startedAt: new Date().toISOString(), pid: process.pid, home: opts.home },
    allowedOrigins: (process.env.NODE_AGENT_ALLOWED_ORIGINS ?? "").split(","),
    heartbeatMs: opts.heartbeatMs,
    log,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}`,
    manager,
    close(reason = "worker_shutdown") {
      closing ??= (async () => {
        await manager.close(reason);
        await new Promise<void>((r) => {
          server.close(() => r());
          server.closeAllConnections();
        });
        store.close();
      })();
      return closing;
    },
  };
}
