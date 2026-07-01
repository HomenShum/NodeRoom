/**
 * Live proof-loop runner — calls production Convex with real LLM tasks.
 *
 * Unlike the smoke proof-loop runner, this one:
 *   - Creates a real room on the production Convex deployment
 *   - Sends real accounting/SDR tasks to the agent via agentJobs.startPublicAsk
 *   - Polls until the job reaches a terminal state (completed/failed/blocked)
 *   - Reads the agent's actual output (stream events, messages, reasoning frames)
 *   - Scores the output against rubric criteria
 *   - Writes a real scorecard with pass/fail based on actual LLM output
 *
 * Usage:
 *   npx tsx scripts/live-proofloop-runner.ts --config=proofloop/accounting/live.accounting.config.json
 *   npx tsx scripts/live-proofloop-runner.ts --config=proofloop/notion/live.notion.config.json
 *
 * Required env:
 *   VITE_CONVEX_URL or CONVEX_URL — production Convex deployment URL
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────

interface LiveTask {
  /** Unique task ID within the suite */
  id: string;
  /** Human-readable task name */
  name: string;
  /** The goal/prompt sent to the agent */
  goal: string;
  /** Expected output patterns — at least one must match for a pass */
  passPatterns: string[];
  /** Optional: expected artifact edits (checked via reasoning frames) */
  expectArtifactEdit?: boolean;
  /** Timeout in ms for this task */
  timeoutMs?: number;
  /** Model policy override (optional) */
  modelPolicy?: string;
}

interface LiveProofLoopConfig {
  suite: string;
  minScore: number;
  outputDir?: string;
  memoryFile?: string;
  /** Tasks to run */
  tasks: LiveTask[];
  /** Room seed artifacts (optional — uses createStarterRoom if not provided) */
  seedArtifacts?: Array<{
    kind: "sheet" | "note" | "wall";
    title: string;
    seed: Array<{ id: string; value: unknown }>;
    meta?: unknown;
  }>;
  /** Use starter room (pre-seeded with research data) instead of custom seed */
  useStarterRoom?: boolean;
}

interface TaskResult {
  taskId: string;
  taskName: string;
  status: "pass" | "fail" | "timeout" | "error";
  jobId?: string;
  jobStatus?: string;
  resolvedModel?: string;
  durationMs: number;
  agentOutput?: string;
  streamEventCount?: number;
  reasoningFrameCount?: number;
  messageCount?: number;
  matchedPatterns: string[];
  unmatchedPatterns: string[];
  error?: string;
  costUsd?: number;
  tokenCount?: number;
}

interface LiveProofLoopResult {
  schema: 1;
  suite: string;
  runId: string;
  generatedAt: string;
  configPath: string;
  minScore: number;
  passed: boolean;
  score: number;
  taskResults: TaskResult[];
  failReasons: string[];
  outputDir: string;
  totalCostUsd?: number;
  totalDurationMs?: number;
}

type ActorProof = {
  actor: { kind: "user"; id: string; name: string };
  token: string;
};

// ─── Utilities ────────────────────────────────────────────────────────────

function optionValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.split("=")[1] : undefined;
}

function timestampId(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

const terminalStatuses = new Set(["completed", "failed", "blocked", "cancelled"]);

// ─── Room creation ────────────────────────────────────────────────────────

async function createRoom(
  client: ConvexHttpClient,
  config: LiveProofLoopConfig,
): Promise<{ roomId: string; memberId: string; proof: ActorProof; artifactIds: string[] }> {
  const authToken = randomUUID();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
  const code = `P${suffix}`;

  if (config.useStarterRoom) {
    const created = await client.mutation(api.rooms.createStarterRoom, {
      code,
      title: `Live proof-loop: ${config.suite}`,
      hostName: "Proof Loop",
      authToken,
      autoAllow: true,
    }) as { roomId: string; memberId: string };
    return {
      roomId: String(created.roomId),
      memberId: String(created.memberId),
      proof: {
        actor: { kind: "user", id: String(created.memberId), name: "Proof Loop" },
        token: authToken,
      },
      artifactIds: [],
    };
  }

  const seedArtifacts = config.seedArtifacts ?? [];
  const created = await client.mutation(api.rooms.create, {
    code,
    title: `Live proof-loop: ${config.suite}`,
    hostName: "Proof Loop",
    authToken,
    autoAllow: true,
    seedArtifacts: seedArtifacts.map((a) => ({
      kind: a.kind,
      title: a.title,
      seed: a.seed,
      meta: a.meta,
    })),
  }) as { roomId: string; memberId: string; artifactIds: string[] };

  return {
    roomId: String(created.roomId),
    memberId: String(created.memberId),
    proof: {
      actor: { kind: "user", id: String(created.memberId), name: "Proof Loop" },
      token: authToken,
    },
    artifactIds: created.artifactIds.map(String),
  };
}

// ─── Task execution ───────────────────────────────────────────────────────

async function runTask(
  client: ConvexHttpClient,
  roomId: string,
  proof: ActorProof,
  task: LiveTask,
): Promise<TaskResult> {
  const start = Date.now();
  const timeoutMs = task.timeoutMs ?? 5 * 60_000;
  const pollMs = 5_000;

  console.log(`  → sending goal: "${task.goal.slice(0, 80)}..."`);

  let jobId: string;
  try {
    const started = await client.mutation(api.agentJobs.startPublicAsk, {
      roomId: roomId as never,
      requester: proof,
      goal: task.goal,
      ...(task.modelPolicy ? { modelPolicy: task.modelPolicy } : {}),
    }) as { jobId: string };
    jobId = String(started.jobId);
  } catch (err) {
    return {
      taskId: task.id,
      taskName: task.name,
      status: "error",
      durationMs: Date.now() - start,
      matchedPatterns: [],
      unmatchedPatterns: task.passPatterns,
      error: `Failed to start job: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  console.log(`  → job ${jobId} queued, polling...`);

  // Poll for job completion
  const deadline = Date.now() + timeoutMs;
  let jobStatus = "queued";
  let resolvedModel: string | undefined;
  let pollErrors = 0;

  while (Date.now() < deadline) {
    try {
      const jobs = await client.query(api.agentJobs.list, {
        roomId: roomId as never,
        requester: proof,
      }) as Array<{
        _id: string;
        status: string;
        resolvedModel?: string;
        error?: string;
        costUsd?: number;
        tokenCount?: number;
      }>;
      const job = jobs.find((j) => String(j._id) === jobId);
      if (job) {
        jobStatus = job.status;
        resolvedModel = job.resolvedModel;
        console.log(`  → ${jobStatus}${resolvedModel ? ` (${resolvedModel})` : ""}...`);
        if (terminalStatuses.has(jobStatus)) {
          // Get job detail for output
          const detail = await client.query(api.agentJobs.detail, {
            jobId: jobId as never,
            requester: proof,
          }) as {
            job: { status: string; error?: string; costUsd?: number; tokenCount?: number };
            streamEvents: Array<{ text?: string; kind?: string }>;
            reasoningFrames: Array<{ phase?: string; summary?: string; result?: string }>;
            attempts: Array<{ resolvedModel?: string; status: string; stopReason: string; ms: number; error?: string }>;
          } | null;

          const agentMessages = await client.query(api.messages.list, {
            roomId: roomId as never,
            channel: "public",
            requester: proof,
          }) as Array<{ text: string; author: { kind: string } }>;

          const agentTexts = agentMessages
            .filter((m) => m.author.kind === "agent")
            .map((m) => m.text)
            .join("\n");

          const streamText = (detail?.streamEvents ?? [])
            .map((e) => e.text ?? "")
            .join("\n");

          const reasoningText = (detail?.reasoningFrames ?? [])
            .map((f) => `${f.phase ?? ""}: ${f.summary ?? ""} ${f.result ?? ""}`)
            .join("\n");

          const fullOutput = `${agentTexts}\n${streamText}\n${reasoningText}`;
          const outputLower = fullOutput.toLowerCase();

          // Check pass patterns
          const matchedPatterns: string[] = [];
          const unmatchedPatterns: string[] = [];
          for (const pattern of task.passPatterns) {
            if (outputLower.includes(pattern.toLowerCase())) {
              matchedPatterns.push(pattern);
            } else {
              unmatchedPatterns.push(pattern);
            }
          }

          // Check for artifact edits — look at reasoning frames AND stream events for tool calls
          let hasArtifactEdit = true;
          if (task.expectArtifactEdit) {
            const frames = detail?.reasoningFrames ?? [];
            const events = detail?.streamEvents ?? [];
            hasArtifactEdit = frames.some(
              (f) => f.phase === "execute" || f.summary?.includes("edit") || f.summary?.includes("mutation"),
            ) || events.some(
              (e) => e.kind === "tool_call_start" || e.kind === "tool_call_result",
            ) || (streamText.length > 0 && /edit|write|update|insert|mutation|cell/i.test(streamText));
          }

          const passed = matchedPatterns.length > 0 && (task.expectArtifactEdit ? hasArtifactEdit : true) && jobStatus === "completed";
          const costUsd = detail?.job?.costUsd;
          const tokenCount = detail?.job?.tokenCount;

          console.log(`  → ${passed ? "✅ PASS" : "❌ FAIL"} — matched ${matchedPatterns.length}/${task.passPatterns.length} patterns`);

          return {
            taskId: task.id,
            taskName: task.name,
            status: passed ? "pass" : jobStatus === "completed" ? "fail" : jobStatus === "failed" ? "fail" : "error",
            jobId,
            jobStatus,
            resolvedModel,
            durationMs: Date.now() - start,
            agentOutput: fullOutput.slice(0, 5000),
            streamEventCount: detail?.streamEvents.length,
            reasoningFrameCount: detail?.reasoningFrames.length,
            messageCount: agentMessages.filter((m) => m.author.kind === "agent").length,
            matchedPatterns,
            unmatchedPatterns,
            costUsd,
            tokenCount,
            error: jobStatus !== "completed" ? detail?.job?.error : undefined,
          };
        }
      }
      pollErrors = 0;
    } catch (err) {
      pollErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  → poll error (${pollErrors}): ${msg}`);
      if (pollErrors > 10) {
        return {
          taskId: task.id,
          taskName: task.name,
          status: "error",
          jobId,
          jobStatus,
          durationMs: Date.now() - start,
          matchedPatterns: [],
          unmatchedPatterns: task.passPatterns,
          error: `Too many poll errors: ${msg}`,
        };
      }
    }
    await sleep(pollMs);
  }

  // Timeout
  console.log(`  → ⏱️ TIMEOUT after ${timeoutMs / 1000}s`);
  return {
    taskId: task.id,
    taskName: task.name,
    status: "timeout",
    jobId,
    jobStatus,
    resolvedModel,
    durationMs: Date.now() - start,
    matchedPatterns: [],
    unmatchedPatterns: task.passPatterns,
    error: `Job did not complete within ${timeoutMs}ms`,
  };
}

// ─── Scorecard ────────────────────────────────────────────────────────────

function renderScorecard(result: LiveProofLoopResult): string {
  const lines: string[] = [];
  lines.push(`# Live Proof-Loop Scorecard — ${result.suite}`);
  lines.push("");
  lines.push(`Run ID: ${result.runId}`);
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Config: ${result.configPath}`);
  lines.push(`Min Score: ${result.minScore}`);
  lines.push("");
  lines.push("## Verdict: " + (result.passed ? "✅ PASS" : "❌ FAIL"));
  lines.push(`Score: ${result.score}/${result.minScore}`);
  if (result.totalCostUsd) lines.push(`Total Cost: $${result.totalCostUsd.toFixed(4)}`);
  if (result.totalDurationMs) lines.push(`Total Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push("## Task Results");
  lines.push("");
  lines.push("| Task | Status | Model | Duration | Cost | Patterns Matched |");
  lines.push("|------|--------|-------|----------|------|-----------------|");
  for (const t of result.taskResults) {
    const icon = t.status === "pass" ? "✅" : t.status === "timeout" ? "⏱️" : "❌";
    const cost = t.costUsd ? `$${t.costUsd.toFixed(4)}` : "—";
    const dur = `${(t.durationMs / 1000).toFixed(1)}s`;
    const patterns = `${t.matchedPatterns.length}/${t.matchedPatterns.length + t.unmatchedPatterns.length}`;
    lines.push(`| ${icon} ${t.taskName} | ${t.status} | ${t.resolvedModel ?? "—"} | ${dur} | ${cost} | ${patterns} |`);
  }
  lines.push("");
  lines.push("## Detailed Results");
  lines.push("");
  for (const t of result.taskResults) {
    lines.push(`### ${t.taskName}`);
    lines.push(`- Status: ${t.status}`);
    lines.push(`- Job ID: ${t.jobId ?? "—"}`);
    lines.push(`- Job Status: ${t.jobStatus ?? "—"}`);
    lines.push(`- Model: ${t.resolvedModel ?? "—"}`);
    lines.push(`- Duration: ${(t.durationMs / 1000).toFixed(1)}s`);
    if (t.costUsd) lines.push(`- Cost: $${t.costUsd.toFixed(4)}`);
    if (t.tokenCount) lines.push(`- Tokens: ${t.tokenCount}`);
    lines.push(`- Stream Events: ${t.streamEventCount ?? 0}`);
    lines.push(`- Reasoning Frames: ${t.reasoningFrameCount ?? 0}`);
    lines.push(`- Agent Messages: ${t.messageCount ?? 0}`);
    lines.push(`- Matched Patterns: ${t.matchedPatterns.length > 0 ? t.matchedPatterns.join(", ") : "(none)"}`);
    lines.push(`- Unmatched Patterns: ${t.unmatchedPatterns.length > 0 ? t.unmatchedPatterns.join(", ") : "(none)"}`);
    if (t.error) lines.push(`- Error: ${t.error}`);
    if (t.agentOutput) {
      lines.push("");
      lines.push("#### Agent Output (first 2000 chars):");
      lines.push("```");
      lines.push(t.agentOutput.slice(0, 2000));
      lines.push("```");
    }
    lines.push("");
  }
  if (result.failReasons.length > 0) {
    lines.push("## Fail Reasons");
    lines.push("");
    for (const r of result.failReasons) lines.push(`- ${r}`);
    lines.push("");
  }
  lines.push("## Verdict");
  lines.push("");
  if (result.passed) {
    lines.push(`All tasks passed and score ${result.score} >= ${result.minScore}.`);
    lines.push("");
    lines.push("> Live LLM proof-loop passed. The agent completed real tasks on production Convex.");
  } else {
    lines.push("Live proof-loop FAILED. The agent did not meet the required standard on production.");
    lines.push("");
    lines.push("> Before claiming readiness, fix the failing tasks and re-run the live proof-loop.");
  }
  return `${lines.join("\n")}\n`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile();

  const configPath = optionValue("config");
  if (!configPath) {
    console.error("Usage: npx tsx scripts/live-proofloop-runner.ts --config=<path>");
    process.exit(1);
  }

  const configFullPath = join(process.cwd(), configPath);
  if (!existsSync(configFullPath)) {
    console.error(`Config not found: ${configFullPath}`);
    process.exit(1);
  }

  const config: LiveProofLoopConfig = JSON.parse(readFileSync(configFullPath, "utf8"));
  const runId = timestampId(new Date());
  const outputDir = config.outputDir
    ? join(process.cwd(), config.outputDir, runId)
    : join(process.cwd(), ".proofloop", "live", runId);
  const latestDir = join(dirname(outputDir), "latest");

  mkdirSync(outputDir, { recursive: true });

  const convexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("VITE_CONVEX_URL or CONVEX_URL is required");
    process.exit(1);
  }

  console.log(`live-proof-loop: suite=${config.suite} runId=${runId}`);
  console.log(`live-proof-loop: convex=${convexUrl}`);
  console.log(`live-proof-loop: ${config.tasks.length} tasks configured`);
  console.log(`live-proof-loop: output=${outputDir}`);
  console.log("");

  const client = new ConvexHttpClient(convexUrl);

  // Create room
  console.log("live-proof-loop: creating room on production Convex...");
  const room = await createRoom(client, config);
  console.log(`live-proof-loop: room created — roomId=${room.roomId}`);
  console.log("");

  // Run tasks
  const taskResults: TaskResult[] = [];
  for (const task of config.tasks) {
    console.log(`live-proof-loop: running task "${task.name}"...`);
    const result = await runTask(client, room.roomId, room.proof, task);
    taskResults.push(result);
    console.log("");
  }

  // Calculate score
  const passedTasks = taskResults.filter((t) => t.status === "pass");
  const score = Math.round((passedTasks.length / Math.max(taskResults.length, 1)) * 100);

  // Determine pass/fail
  const failReasons: string[] = [];
  for (const t of taskResults) {
    if (t.status !== "pass") {
      failReasons.push(`Task "${t.taskName}" ${t.status}: ${t.error ?? `matched ${t.matchedPatterns.length}/${t.matchedPatterns.length + t.unmatchedPatterns.length} patterns`}`);
    }
  }
  if (score < config.minScore) {
    failReasons.push(`Score ${score} < minScore ${config.minScore}`);
  }

  const passed = failReasons.length === 0;
  const totalCostUsd = taskResults.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
  const totalDurationMs = taskResults.reduce((sum, t) => sum + t.durationMs, 0);

  const runResult: LiveProofLoopResult = {
    schema: 1,
    suite: config.suite,
    runId,
    generatedAt: new Date().toISOString(),
    configPath: configPath,
    minScore: config.minScore,
    passed,
    score,
    taskResults,
    failReasons,
    outputDir,
    totalCostUsd,
    totalDurationMs,
  };

  // Write outputs
  writeFileSync(join(outputDir, "scorecard.md"), renderScorecard(runResult), "utf-8");
  writeFileSync(join(outputDir, "run-result.json"), JSON.stringify(runResult, null, 2), "utf-8");

  // Write trace
  const traceLines = taskResults.map((t, i) =>
    JSON.stringify({
      task: i + 1,
      taskId: t.taskId,
      name: t.taskName,
      status: t.status,
      durationMs: t.durationMs,
      jobId: t.jobId,
      jobStatus: t.jobStatus,
      resolvedModel: t.resolvedModel,
      costUsd: t.costUsd,
      matchedPatterns: t.matchedPatterns,
    }),
  );
  writeFileSync(join(outputDir, "trace.jsonl"), traceLines.join("\n") + "\n", "utf-8");

  // Copy to latest
  try {
    if (existsSync(latestDir)) {
      const { rmSync, cpSync } = await import("node:fs");
      rmSync(latestDir, { recursive: true, force: true });
      cpSync(outputDir, latestDir, { recursive: true });
    } else {
      const { cpSync } = await import("node:fs");
      cpSync(outputDir, latestDir, { recursive: true });
    }
  } catch { /* best effort */ }

  // Append memory
  const memoryFile = config.memoryFile ?? join(process.cwd(), ".proofloop", "live-memory.jsonl");
  const memDir = dirname(memoryFile);
  if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
  appendFileSync(memoryFile, JSON.stringify({
    runId,
    suite: config.suite,
    timestamp: runResult.generatedAt,
    passed,
    score,
    totalCostUsd,
    totalDurationMs,
    failReasons,
  }) + "\n", "utf-8");

  // Print summary
  console.log("");
  console.log(`live-proof-loop: ${passed ? "✅ PASS" : "❌ FAIL"} — score ${score}/${config.minScore}`);
  if (totalCostUsd > 0) console.log(`live-proof-loop: total cost $${totalCostUsd.toFixed(4)}`);
  console.log(`live-proof-loop: total duration ${(totalDurationMs / 1000).toFixed(1)}s`);
  if (failReasons.length > 0) {
    console.log("live-proof-loop: fail reasons:");
    for (const r of failReasons) console.log(`  - ${r}`);
  }
  console.log(`live-proof-loop: scorecard at ${join(outputDir, "scorecard.md")}`);
  console.log(`live-proof-loop: trace at ${join(outputDir, "trace.jsonl")}`);

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("live-proof-loop: fatal error", err);
  process.exit(1);
});
