#!/usr/bin/env node
import { homedir } from "node:os";
import path from "node:path";
import { createWorker } from "./index.js";

const envFiles = process.env.NODE_AGENT_ENV_FILES
  ? process.env.NODE_AGENT_ENV_FILES.split(",").map((f) => f.trim()).filter(Boolean)
  : [path.join(process.cwd(), ".env.local"), path.join(process.cwd(), ".env")];
const home = process.env.NODE_AGENT_HOME || path.join(homedir(), ".nodeagent-workspace");
const port = Number(process.env.NODE_AGENT_WORKER_PORT || 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`NODE_AGENT_WORKER_PORT must be a port number, got "${process.env.NODE_AGENT_WORKER_PORT}"`);
  process.exit(2);
}

const worker = await createWorker({ home, envFiles, port });
console.log(`nodeagent-worker listening on ${worker.url}`);

let stopping = false;
const stop = (signal: string) => {
  if (stopping) process.exit(1); // second signal: give up waiting
  stopping = true;
  console.error(`[nodeagent-worker] ${signal}: interrupting runs`);
  worker.close("worker_shutdown").then(
    () => process.exit(0),
    (err) => {
      console.error(`[nodeagent-worker] shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
