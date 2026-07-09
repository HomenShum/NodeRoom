import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ProofloopCodexLoopRunMeta = {
  runId: string;
  suite: string;
  cmd: string;
  passed: boolean;
  exitCode: number;
  score?: number;
  minScore?: number;
  failedGates?: string[];
  receiptPaths: string[];
};

export type ProofloopCodexRepairAttemptReceipt = {
  schema: "proofloop-codex-repair-attempt-v1";
  generatedAt: string;
  suite: string;
  failedRunId: string;
  attempt: number;
  maxAttempts: number;
  codexCommand: string;
  repairPromptPath: string;
  launched: boolean;
  exitCode?: number;
  nextRunCommand: string;
};

export function buildCodexRepairPrompt(args: {
  meta: ProofloopCodexLoopRunMeta;
  repairPrompt: string;
  attempt: number;
  maxAttempts: number;
}): string {
  const failedGates = args.meta.failedGates?.length ? args.meta.failedGates.join("\n- ") : `Command exited ${args.meta.exitCode}`;
  return [
    "You are Codex continuing a Proofloop repair loop. Fix the product or harness code so the next Proofloop run passes.",
    "",
    "Non-negotiable rules:",
    "- Do not weaken verifiers, skip gates, lower minScore, delete required evidence, or edit protected .proofloop hook/tooluse state.",
    "- If setup is missing, install or configure the local setup path instead of claiming it is blocked.",
    "- Exercise the real live UI path when the failure is a browser/live benchmark failure.",
    "- After changes, run the exact next command below and rely on its receipt, not a chat summary.",
    "",
    `Loop attempt: ${args.attempt}/${args.maxAttempts}`,
    `Failed suite: ${args.meta.suite}`,
    `Failed run: ${args.meta.runId}`,
    `Failed command: ${args.meta.cmd}`,
    `Score: ${args.meta.score ?? "n/a"}/${args.meta.minScore ?? "n/a"}`,
    "Failed gates:",
    `- ${failedGates}`,
    "",
    "Receipt paths:",
    ...(args.meta.receiptPaths.length ? args.meta.receiptPaths.map((path) => `- ${path}`) : ["- none"]),
    "",
    "Repair context from Proofloop:",
    args.repairPrompt.trim(),
    "",
    "Next command after repair:",
    `npm run proofloop -- run ${args.meta.suite}`,
    "",
  ].join("\n");
}

export function writeCodexRepairAttemptReceipt(args: {
  root: string;
  runDir: string;
  generatedAt?: string;
  meta: ProofloopCodexLoopRunMeta;
  repairPromptPath: string;
  attempt: number;
  maxAttempts: number;
  codexCommand: string;
  launched: boolean;
  exitCode?: number;
}): string {
  const path = join(args.runDir, "codex-repair-attempt.json");
  const receipt: ProofloopCodexRepairAttemptReceipt = {
    schema: "proofloop-codex-repair-attempt-v1",
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    suite: args.meta.suite,
    failedRunId: args.meta.runId,
    attempt: args.attempt,
    maxAttempts: args.maxAttempts,
    codexCommand: args.codexCommand,
    repairPromptPath: relativePath(args.root, args.repairPromptPath),
    launched: args.launched,
    ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
    nextRunCommand: `npm run proofloop -- run ${args.meta.suite}`,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}

function relativePath(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path.replace(/\\/g, "/");
}
