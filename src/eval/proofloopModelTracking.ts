import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type ProofloopModelRole = "planner" | "worker" | "judge" | "verifier";

export type ProofloopModelRoute = {
  provider: string;
  id: string;
  routePolicy: "specific" | "default" | "proxy" | "deterministic";
  role: ProofloopModelRole;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  selectionReason: string;
  source: "env" | "suite-default" | "deterministic-default";
};

export type ProofloopHarnessVersion = {
  suite: string;
  harnessVersion: string;
  files: Array<{
    path: string;
    exists: boolean;
    sha256?: string;
  }>;
};

export function proofloopModelRouteForRun(args: {
  suite: string;
  cmd: string;
  env?: NodeJS.ProcessEnv;
}): ProofloopModelRoute {
  const env = args.env ?? process.env;
  const explicit =
    env.PROOFLOOP_MODEL_ID ??
    env.NODEAGENT_MODEL_ID ??
    env.NODEAGENT_MODEL ??
    env.BTB_MODEL_ID ??
    env.OPENROUTER_MODEL;
  const inferred = explicit ?? defaultModelForSuite(args.suite, args.cmd);
  const id = inferred.trim();
  const source: ProofloopModelRoute["source"] = explicit ? "env" : id === "local/deterministic" ? "deterministic-default" : "suite-default";
  const routePolicy = explicit ? "specific" : id === "local/deterministic" ? "deterministic" : "default";
  const role = roleForSuite(args.suite);
  return {
    provider: providerForModel(id),
    id,
    routePolicy,
    role,
    costUsd: numberFromEnv(env.PROOFLOOP_MODEL_COST_USD) ?? 0,
    tokensIn: numberFromEnv(env.PROOFLOOP_TOKENS_IN) ?? 0,
    tokensOut: numberFromEnv(env.PROOFLOOP_TOKENS_OUT) ?? 0,
    latencyMs: numberFromEnv(env.PROOFLOOP_MODEL_LATENCY_MS ?? env.PROOFLOOP_LATENCY_MS ?? env.PROOFLOOP_DURATION_MS) ?? 0,
    selectionReason: env.PROOFLOOP_MODEL_SELECTION_REASON ?? defaultSelectionReason({
      suite: args.suite,
      cmd: args.cmd,
      id,
      source,
      role,
      routePolicy,
    }),
    source,
  };
}

export function proofloopHarnessVersionForSuite(root: string, suite: string, extraFiles: string[] = []): ProofloopHarnessVersion {
  const files = [
    "scripts/proofloop-cli.ts",
    "scripts/proofloop.mjs",
    "src/eval/proofloopGoalSupervisor.ts",
    "src/eval/proofloopLoopArtifacts.ts",
    "src/eval/proofloopModelTracking.ts",
    "src/eval/proofloopBlockerSolver.ts",
    `proofloop/benchmarks/${suite}/adapter.json`,
    ...extraFiles,
  ];
  const hashed = files.map((path) => hashFile(root, path));
  const digest = createHash("sha256")
    .update(JSON.stringify(hashed))
    .digest("hex")
    .slice(0, 12);
  return {
    suite,
    harnessVersion: `${safeId(suite)}-harness-${digest}`,
    files: hashed,
  };
}

export function assertProofloopModelTracked(model: ProofloopModelRoute): string[] {
  const failures: string[] = [];
  if (!model.id.trim()) failures.push("missing_model_id");
  if (!model.provider.trim()) failures.push("missing_model_provider");
  if (!model.role.trim()) failures.push("missing_model_role");
  if (!model.routePolicy.trim()) failures.push("missing_model_route_policy");
  if (!Number.isFinite(model.costUsd)) failures.push("missing_model_cost_usd");
  if (!Number.isFinite(model.tokensIn)) failures.push("missing_model_tokens_in");
  if (!Number.isFinite(model.tokensOut)) failures.push("missing_model_tokens_out");
  if (!Number.isFinite(model.latencyMs)) failures.push("missing_model_latency_ms");
  if (!model.selectionReason.trim()) failures.push("missing_model_selection_reason");
  return failures;
}

function defaultModelForSuite(suite: string, cmd: string): string {
  const haystack = `${suite} ${cmd}`;
  if (/banker|btb|nodeagent|live/i.test(haystack)) return "z-ai/glm-5.2";
  if (/finch|finauditing|workstream|spreadsheet/i.test(haystack)) return "deepseek/deepseek-v4-pro";
  return "local/deterministic";
}

function providerForModel(modelId: string): string {
  if (modelId === "local/deterministic" || modelId.startsWith("local/")) return "local";
  if (modelId.includes("/")) return "openrouter";
  if (/^(?:gpt-|o\d|chatgpt-)/i.test(modelId)) return "openai";
  if (/^claude/i.test(modelId)) return "anthropic";
  if (/^gemini/i.test(modelId)) return "google";
  return "unknown";
}

function roleForSuite(suite: string): ProofloopModelRole {
  if (/judge|scorer|verifier/i.test(suite)) return "judge";
  if (/browser|live|banker|spreadsheet|finch|finauditing|workstream/i.test(suite)) return "planner";
  return "worker";
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function defaultSelectionReason(args: {
  suite: string;
  cmd: string;
  id: string;
  source: ProofloopModelRoute["source"];
  role: ProofloopModelRole;
  routePolicy: ProofloopModelRoute["routePolicy"];
}): string {
  if (args.source === "env") {
    return `Explicit ${args.role} model selected by proofloop environment for ${args.suite}.`;
  }
  if (args.routePolicy === "deterministic") {
    return `Deterministic local route selected because ${args.suite} does not require a live model.`;
  }
  if (/finch|finauditing|workstream|spreadsheet/i.test(`${args.suite} ${args.cmd}`)) {
    return `Default finance benchmark ${args.role} route selected for ${args.suite} blocker solving and proxy comparison.`;
  }
  if (/banker|btb|nodeagent|live/i.test(`${args.suite} ${args.cmd}`)) {
    return `Default live proof ${args.role} route selected for ${args.suite}.`;
  }
  return `Default ${args.role} route selected for ${args.suite}.`;
}

function hashFile(root: string, path: string): ProofloopHarnessVersion["files"][number] {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return { path, exists: false };
  return {
    path,
    exists: true,
    sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
  };
}

function safeId(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}
