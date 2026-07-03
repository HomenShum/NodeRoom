import { spawnSync } from "node:child_process";

export type ProofloopWorkerKind = "codex" | "claude" | "cursor" | "windsurf" | "node" | "npm" | "git";

export type ProofloopWorkerInventoryItem = {
  kind: ProofloopWorkerKind;
  available: boolean;
  command: string;
  resolvedPath?: string;
  launchMode: "shell" | "interactive_agent" | "ide" | "tooling";
};

export type ProofloopWorkerInventory = {
  schema: "proofloop-worker-inventory-v1";
  generatedAt: string;
  workers: ProofloopWorkerInventoryItem[];
};

const WORKERS: Array<Omit<ProofloopWorkerInventoryItem, "available" | "resolvedPath">> = [
  { kind: "codex", command: "codex", launchMode: "interactive_agent" },
  { kind: "claude", command: "claude", launchMode: "interactive_agent" },
  { kind: "cursor", command: "cursor", launchMode: "ide" },
  { kind: "windsurf", command: "windsurf", launchMode: "ide" },
  { kind: "node", command: "node", launchMode: "tooling" },
  { kind: "npm", command: "npm", launchMode: "tooling" },
  { kind: "git", command: "git", launchMode: "tooling" },
];

export function detectProofloopWorkers(generatedAt = new Date().toISOString()): ProofloopWorkerInventory {
  return {
    schema: "proofloop-worker-inventory-v1",
    generatedAt,
    workers: WORKERS.map((worker) => {
      const resolvedPath = resolveCommand(worker.command);
      return {
        ...worker,
        available: Boolean(resolvedPath),
        resolvedPath,
      };
    }),
  };
}

function resolveCommand(command: string): string | undefined {
  const result = process.platform === "win32"
    ? spawnSync("where.exe", [command], { encoding: "utf8" })
    : spawnSync("sh", ["-lc", `command -v ${shellEscape(command)}`], { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) return undefined;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
