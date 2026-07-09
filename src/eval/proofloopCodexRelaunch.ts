import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ProofloopMetaForLoop } from "./proofloopLoopArtifacts";

export type ProofloopCodexRelaunchPacket = {
  schema: "proofloop-codex-relaunch-v1";
  generatedAt: string;
  runId: string;
  suite: string;
  passed: false;
  failure: {
    exitCode: number;
    failedGates: string[];
    score?: number;
    minScore?: number;
  };
  receipts: {
    meta: string;
    repairPrompt: string;
    nodeTrace?: string;
    nodeEval?: string;
    liveUserContract?: string;
    costLedger?: string;
    proofReceipts: string[];
  };
  commands: {
    show: string;
    repair: string;
    codexReprompt: string;
    replay: string;
    rerunSuite: string;
    installCodexHooks: string;
  };
  codexPrompt: string;
};

export type ProofloopCodexRelaunchResult = {
  wrote: boolean;
  packetPath: string;
  promptPath: string;
  packet?: ProofloopCodexRelaunchPacket;
};

export function writeCodexRelaunchPacket(args: {
  meta: ProofloopMetaForLoop;
  runDir: string;
  repairPromptPath: string;
  nodeTracePath?: string;
  nodeEvalPath?: string;
  liveUserContractPath?: string;
  costLedgerPath?: string;
  root?: string;
  force?: boolean;
}): ProofloopCodexRelaunchResult {
  const packetPath = join(args.runDir, "codex-relaunch.json");
  const promptPath = join(args.runDir, "codex-reprompt.md");
  if (args.meta.passed && !args.force) return { wrote: false, packetPath, promptPath };

  mkdirSync(args.runDir, { recursive: true });
  const packet: ProofloopCodexRelaunchPacket = {
    schema: "proofloop-codex-relaunch-v1",
    generatedAt: new Date().toISOString(),
    runId: args.meta.runId,
    suite: args.meta.suite,
    passed: false,
    failure: {
      exitCode: args.meta.exitCode,
      failedGates: args.meta.failedGates ?? [],
      ...(args.meta.score !== undefined ? { score: args.meta.score } : {}),
      ...(args.meta.minScore !== undefined ? { minScore: args.meta.minScore } : {}),
    },
    receipts: {
      meta: relPath(join(args.runDir, "meta.json"), args.root),
      repairPrompt: relPath(args.repairPromptPath, args.root),
      ...(args.nodeTracePath ? { nodeTrace: relPath(args.nodeTracePath, args.root) } : {}),
      ...(args.nodeEvalPath ? { nodeEval: relPath(args.nodeEvalPath, args.root) } : {}),
      ...(args.liveUserContractPath ? { liveUserContract: relPath(args.liveUserContractPath, args.root) } : {}),
      ...(args.costLedgerPath ? { costLedger: relPath(args.costLedgerPath, args.root) } : {}),
      proofReceipts: args.meta.receiptPaths,
    },
    commands: {
      show: `npm run proofloop -- show ${args.meta.runId}`,
      repair: `npm run proofloop -- repair ${args.meta.runId}`,
      codexReprompt: `npm run proofloop -- codex reprompt ${args.meta.runId}`,
      replay: `npm run proofloop -- replay ${args.meta.runId}`,
      rerunSuite: `npm run proofloop -- run ${args.meta.suite}`,
      installCodexHooks: "npm run proofloop -- hooks install --worker codex --local",
    },
    codexPrompt: renderCodexReprompt({
      meta: args.meta,
      repairPromptPath: relPath(args.repairPromptPath, args.root),
      nodeTracePath: args.nodeTracePath ? relPath(args.nodeTracePath, args.root) : undefined,
      nodeEvalPath: args.nodeEvalPath ? relPath(args.nodeEvalPath, args.root) : undefined,
    }),
  };

  writeJson(packetPath, packet);
  writeFileSync(promptPath, `${packet.codexPrompt}\n`, "utf8");
  return { wrote: true, packetPath, promptPath, packet };
}

export function readCodexReprompt(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function renderCodexReprompt(args: {
  meta: ProofloopMetaForLoop;
  repairPromptPath: string;
  nodeTracePath?: string;
  nodeEvalPath?: string;
}): string {
  const gates = args.meta.failedGates?.length ? args.meta.failedGates.join(", ") : `exit_${args.meta.exitCode}`;
  const receipts = args.meta.receiptPaths.length ? args.meta.receiptPaths.join("\n- ") : "none";
  return [
    "# Codex ProofLoop Repair Prompt",
    "",
    "You are Codex repairing a failed ProofLoop certification run. Do not claim the work is done until the deterministic gate or proof receipt passes.",
    "",
    `Run: ${args.meta.runId}`,
    `Suite: ${args.meta.suite}`,
    `Command: ${args.meta.cmd}`,
    `Failed gates: ${gates}`,
    `Repair prompt: ${args.repairPromptPath}`,
    args.nodeTracePath ? `Node trace: ${args.nodeTracePath}` : undefined,
    args.nodeEvalPath ? `Node eval: ${args.nodeEvalPath}` : undefined,
    "",
    "Proof receipts:",
    `- ${receipts}`,
    "",
    "Required loop:",
    "1. Read the repair prompt and receipts above.",
    "2. Make the smallest product or harness change that addresses the first failing gate.",
    "3. Add or update deterministic coverage for the failure.",
    `4. Rerun \`npm run proofloop -- replay ${args.meta.runId}\` or \`npm run proofloop -- run ${args.meta.suite}\`.`,
    "5. Stop only after the verifier passes and the new receipt is recorded.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function relPath(path: string, root = process.cwd()): string {
  const relativePath = relative(root, path).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : path.replace(/\\/g, "/");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
