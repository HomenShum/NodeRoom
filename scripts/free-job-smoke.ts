import "./benchmark/loadEnv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

type ActorProof = {
  actor: { kind: "user"; id: string; name: string };
  token: string;
};

type JobRow = {
  _id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  updatedAt: number;
  error?: string;
};

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const terminal = new Set(["completed", "failed", "blocked", "cancelled"]);

async function main() {
  const convexUrl = requiredEnv("CONVEX_URL", process.env.VITE_CONVEX_URL);
  const client = new ConvexHttpClient(convexUrl);
  const seeded = await resolveSmokeTarget(client);
  const roomId = seeded.roomId;
  const artifactId = seeded.artifactId;
  const proof = seeded.proof;
  const goal = process.env.FREE_JOB_GOAL ?? seeded.defaultGoal;
  const timeoutMs = Number(process.env.FREE_JOB_TIMEOUT_MS ?? 15 * 60_000);
  const pollMs = Number(process.env.FREE_JOB_POLL_MS ?? 5_000);

  const started = await client.mutation(api.agentJobs.start, {
    roomId,
    artifactId,
    requester: proof,
    goal,
    entrypoint: "free",
    routePolicy: "free_auto",
    runtimePolicy: "workflow_sliced",
    approvalPolicy: "draft_first",
    evidencePolicy: "public_only",
    autoAllow: false,
    traceLevel: "full_operation_ledger",
    maxAttempts: Number(process.env.FREE_JOB_MAX_ATTEMPTS ?? 8),
  });
  const jobId = typeof started === "object" && started && "jobId" in started ? started.jobId : started;
  console.log(`queued ${String(jobId)}`);

  const deadline = Date.now() + timeoutMs;
  let latest: JobRow | undefined;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    let jobs: JobRow[];
    try {
      jobs = await client.query(api.agentJobs.list, { roomId, requester: proof }) as JobRow[];
    } catch (error) {
      pollErrors++;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`poll_error ${pollErrors}: ${message}`);
      await sleep(pollMs);
      continue;
    }
    latest = jobs.find((j) => String(j._id) === String(jobId));
    if (latest) {
      console.log(`${latest.status} attempts=${latest.attempts}/${latest.maxAttempts}${latest.error ? ` error=${latest.error}` : ""}`);
      if (terminal.has(latest.status)) break;
    }
    await sleep(pollMs);
  }

  if (!latest) throw new Error("job was not visible in agentJobs.list");
  let attempts: Array<{
    attempt: number;
    status: string;
    resolvedModel: string;
    stopReason: string;
    ms: number;
    error?: string;
  }> = [];
  let lastAttemptError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      attempts = await client.query(api.agentJobs.attempts, { jobId, requester: proof }) as typeof attempts;
      lastAttemptError = undefined;
      break;
    } catch (error) {
      lastAttemptError = error;
      await sleep(Math.min(pollMs, 2_000));
    }
  }
  if (lastAttemptError) throw lastAttemptError;
  for (const attempt of attempts) {
    console.log(`attempt ${attempt.attempt}: ${attempt.status} ${attempt.resolvedModel} ${attempt.stopReason} ${attempt.ms}ms${attempt.error ? ` error=${attempt.error}` : ""}`);
  }
  if (attempts.length === 0) throw new Error(`job finished or stalled without attempt telemetry${latest.error ? `: ${latest.error}` : ""}`);
  if (!terminal.has(latest.status)) throw new Error(`job did not reach a terminal state within ${timeoutMs}ms`);
  if (latest.status !== "completed") throw new Error(`job ended ${latest.status}: ${latest.error ?? "unknown"}`);
}

async function resolveSmokeTarget(client: ConvexHttpClient): Promise<{
  roomId: string;
  artifactId: string;
  proof: ActorProof;
  defaultGoal: string;
}> {
  const explicitRoomId = optionalEnv("FREE_JOB_ROOM_ID");
  const explicitArtifactId = optionalEnv("FREE_JOB_ARTIFACT_ID");
  const explicitActorId = optionalEnv("FREE_JOB_ACTOR_ID");
  const explicitToken = optionalEnv("FREE_JOB_ACTOR_TOKEN");
  if (explicitRoomId && explicitArtifactId && explicitActorId && explicitToken) {
    return {
      roomId: explicitRoomId,
      artifactId: explicitArtifactId,
      proof: {
        actor: { kind: "user", id: explicitActorId, name: process.env.FREE_JOB_ACTOR_NAME ?? "Free job smoke" },
        token: explicitToken,
      },
      defaultGoal: "Recompute the remaining Q3 variance cells using lock, read, CAS edit, release.",
    };
  }

  const adminToken = optionalEnv("SEED_ADMIN_TOKEN");
  if (!adminToken) return createTemporarySmokeTarget(client, explicitToken);
  const hostAuthToken = explicitToken ?? crypto.randomUUID();
  const seeded = await client.mutation(api.seed.seedDemoRoom, { adminToken, hostAuthToken }) as {
    roomId: string;
    sheetId: string;
    homenId: string;
  };
  return {
    roomId: String(seeded.roomId),
    artifactId: String(seeded.sheetId),
    proof: {
      actor: { kind: "user", id: String(seeded.homenId), name: process.env.FREE_JOB_ACTOR_NAME ?? "Free job smoke" },
      token: hostAuthToken,
    },
    defaultGoal: "Say free job smoke complete in the room chat, then stop.",
  };
}

async function createTemporarySmokeTarget(client: ConvexHttpClient, token?: string) {
  const authToken = token ?? crypto.randomUUID();
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
  const columns = [
    { id: "label", label: "Account", order: 0, mode: "manual", type: "text", agentWritable: false },
    { id: "q2", label: "Q2", order: 1, mode: "manual", type: "currency", agentWritable: false },
    { id: "q3", label: "Q3", order: 2, mode: "manual", type: "currency", agentWritable: false },
    { id: "variance", label: "Variance", order: 3, mode: "compute", type: "text", agentWritable: true },
    { id: "note", label: "Note", order: 4, mode: "manual", type: "text", agentWritable: true },
  ];
  const rows = [
    { id: "r_rev", label: "Revenue", q2: "$10,000", q3: "$12,400" },
    { id: "r_cogs", label: "COGS", q2: "$4,000", q3: "$5,100" },
  ];
  const seed = rows.flatMap((row) => [
    { id: `${row.id}__label`, value: row.label },
    { id: `${row.id}__q2`, value: row.q2 },
    { id: `${row.id}__q3`, value: row.q3 },
    { id: `${row.id}__variance`, value: "" },
    { id: `${row.id}__note`, value: "" },
  ]);
  // Room + smoke sheet seeded in ONE atomic mutation — a failed seed can't leave an orphan room behind
  // (the old create-then-createArtifact pair committed the room first, so a mid-seed failure orphaned it).
  const created = await client.mutation(api.rooms.create, {
    code: `F${suffix}`,
    title: "Free job smoke",
    hostName: "Free job smoke",
    authToken,
    autoAllow: true,
    seedArtifacts: [{
      kind: "sheet",
      title: "Q3 variance smoke",
      seed,
      meta: {
        dataframe: {
          columns,
          rowCount: rows.length,
          sourceFile: "free-job-smoke",
          sheetName: "Q3 variance smoke",
          sheetNames: ["Q3 variance smoke"],
          parser: "smoke",
          truncated: false,
          warnings: [],
        },
      },
    }],
  }) as { roomId: string; memberId: string; artifactIds: string[] };
  const proof: ActorProof = {
    actor: { kind: "user", id: String(created.memberId), name: "Free job smoke" },
    token: authToken,
  };
  return {
    roomId: String(created.roomId),
    artifactId: String(created.artifactIds[0]),
    proof,
    defaultGoal: "Say free job smoke complete in the room chat, then stop.",
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
