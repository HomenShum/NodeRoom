import "./benchmark/loadEnv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { randomUUID } from "node:crypto";

async function main() {
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("No CONVEX_URL");
  const client = new ConvexHttpClient(url);

  const authToken = randomUUID();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();

  const created = await client.mutation(api.rooms.createStarterRoom, {
    code: `D${suffix}`,
    title: "Debug job status",
    hostName: "Debug",
    authToken,
    autoAllow: true,
  }) as { roomId: string; memberId: string };

  const proof = {
    actor: { kind: "user" as const, id: String(created.memberId), name: "Debug" },
    token: authToken,
  };
  const roomId = String(created.roomId);
  console.log(`Room created: ${roomId}`);

  const started = await client.mutation(api.agentJobs.startPublicAsk, {
    roomId: roomId as never,
    requester: proof,
    goal: "Compute the Q3 variance for each row. Variance = Q3 minus Q2.",
  }) as { jobId: string };
  const jobId = String(started.jobId);
  console.log(`Job started: ${jobId}`);

  // Poll for 90s, then check detail
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const jobs = await client.query(api.agentJobs.list, {
      roomId: roomId as never,
      requester: proof,
    }) as Array<{ _id: string; status: string; error?: string; attempts?: number }>;
    const job = jobs.find(j => String(j._id) === jobId);
    if (job) {
      console.log(`  ${job.status} attempts=${job.attempts ?? 0} error=${job.error ?? "none"}`);
      if (["completed", "failed", "blocked", "cancelled"].includes(job.status)) break;
    }
  }

  // Get detail
  const detail = await client.query(api.agentJobs.detail, {
    jobId: jobId as never,
    requester: proof,
  }) as {
    job: { status: string; error?: string };
    attempts: Array<{ attempt: number; status: string; resolvedModel?: string; stopReason: string; ms: number; error?: string }>;
    streamEvents: Array<{ kind?: string; text?: string }>;
    reasoningFrames: Array<{ phase?: string; summary?: string; result?: string }>;
  } | null;

  if (detail) {
    console.log("\n=== JOB DETAIL ===");
    console.log("Status:", detail.job.status);
    console.log("Error:", detail.job.error ?? "none");
    console.log("\n=== ATTEMPTS ===");
    for (const a of detail.attempts) {
      console.log(`  Attempt ${a.attempt}: ${a.status} model=${a.resolvedModel} stopReason=${a.stopReason} ${a.ms}ms error=${a.error ?? "none"}`);
    }
    console.log("\n=== STREAM EVENTS (last 5) ===");
    for (const e of detail.streamEvents.slice(-5)) {
      console.log(`  kind=${e.kind} text=${String(e.text ?? "").slice(0, 200)}`);
    }
    console.log("\n=== REASONING FRAMES (last 3) ===");
    for (const f of detail.reasoningFrames.slice(-3)) {
      console.log(`  phase=${f.phase} summary=${String(f.summary ?? "").slice(0, 200)}`);
    }
  }
}

main().catch(console.error);
