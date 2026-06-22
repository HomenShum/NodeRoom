import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { hashToken, timingSafeEqualSecret, refutationVerdictV } from "./lib";

const startRunRef = makeFunctionReference<"mutation">("evalRuns:startRun") as any;
const recordTaskResultRef = makeFunctionReference<"mutation">("evalRuns:recordTaskResult") as any;
const finishRunRef = makeFunctionReference<"mutation">("evalRuns:finishRun") as any;
const ensureBtbLedgerRoomRef = makeFunctionReference<"mutation">("evalLedgerIngest:ensureBtbLedgerRoom") as any;
const recordRefutationVerdictInternalRef = makeFunctionReference<"mutation">("evalRuns:recordRefutationVerdictInternal") as any;

const taskPayloadV = v.object({
  taskId: v.string(),
  reward: v.number(),
  raw: v.optional(v.string()),
  exceptions: v.number(),
  firedWriter: v.string(),
  cleanGeneralProbe: v.boolean(),
  modelCalls: v.number(),
  tokensUsed: v.optional(v.number()),
  plannerTransport: v.optional(v.string()),
  trialId: v.optional(v.string()),
  verdict: v.optional(v.string()),
  refutations: v.optional(v.array(refutationVerdictV)),
});

const runPayloadV = v.object({
  iterationLabel: v.string(),
  benchmark: v.literal("bankertoolbench"),
  model: v.optional(v.string()),
  materializerMode: v.string(),
  taskCount: v.number(),
  notes: v.optional(v.string()),
  tasks: v.array(taskPayloadV),
});

async function requireBtbLedgerIngestToken(token: string) {
  const expected = process.env.BTB_LEDGER_INGEST_TOKEN;
  if (!expected) throw new Error("btb_ledger_ingest_token_not_configured");
  if (!await timingSafeEqualSecret(token, expected)) throw new Error("btb_ledger_ingest_forbidden");
}

export const ensureBtbLedgerRoom = internalMutation({
  args: {
    code: v.string(),
    title: v.string(),
    hostName: v.string(),
    hostAuthToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const code = args.code.toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new Error("weak_room_code");
    const existing = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (existing) return { roomId: existing._id, created: false as const };

    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code,
      title: args.title.slice(0, 80),
      hostId: "",
      autoAllow: false,
      status: "live",
      createdAt: now,
    });
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: args.hostName.slice(0, 40),
      role: "host",
      anon: false,
      color: "#d97757",
      authTokenHash: args.hostAuthToken ? await hashToken(args.hostAuthToken) : undefined,
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: memberId });
    await ctx.db.insert("agentSessions", {
      roomId,
      agentId: "agent_room",
      agentName: "Room NodeAgent",
      scope: "public",
      status: "idle",
      lastAction: "started",
      updatedAt: now,
    });
    await ctx.db.insert("agentSessions", {
      roomId,
      agentId: "agent_priv",
      agentName: "Your NodeAgent",
      scope: "private",
      ownerId: memberId,
      status: "idle",
      lastAction: "started",
      updatedAt: now,
    });
    await ctx.db.insert("traces", {
      roomId,
      ts: now,
      actor: { kind: "user", id: String(memberId), name: args.hostName.slice(0, 40) },
      type: "room_created",
      summary: `${args.hostName.slice(0, 40)} created the BTB ledger room`,
    });
    return { roomId, memberId, created: true as const };
  },
});

export const ingestBankerToolBenchSummary = action({
  args: {
    ingestToken: v.string(),
    roomId: v.optional(v.id("rooms")),
    roomCode: v.optional(v.string()),
    roomTitle: v.optional(v.string()),
    hostName: v.optional(v.string()),
    hostAuthToken: v.optional(v.string()),
    payload: runPayloadV,
  },
  handler: async (ctx, args) => {
    await requireBtbLedgerIngestToken(args.ingestToken);
    if (args.payload.tasks.length > 250) throw new Error("too_many_btb_task_rows");
    const roomId = args.roomId ?? (await ctx.runMutation(ensureBtbLedgerRoomRef, {
      code: args.roomCode ?? "BTBLEDGER",
      title: args.roomTitle ?? "BankerToolBench Eval Ledger",
      hostName: args.hostName ?? "BTB Ledger",
      hostAuthToken: args.hostAuthToken,
    })).roomId as Id<"rooms">;

    const evalRunId = await ctx.runMutation(startRunRef, {
      roomId,
      iterationLabel: args.payload.iterationLabel,
      benchmark: args.payload.benchmark,
      model: args.payload.model,
      materializerMode: args.payload.materializerMode,
      taskCount: args.payload.taskCount,
      notes: args.payload.notes,
    }) as Id<"evalRuns">;

    for (const task of args.payload.tasks) {
      // Refutations ride alongside the task result but live in their own table column;
      // strip them from the result write, then emit each verdict via the internal mutation.
      const { refutations, ...resultFields } = task;
      await ctx.runMutation(recordTaskResultRef, {
        roomId,
        evalRunId,
        ...resultFields,
      });
      if (refutations && refutations.length > 0) {
        for (const verdict of refutations) {
          await ctx.runMutation(recordRefutationVerdictInternalRef, {
            evalRunId,
            taskId: task.taskId,
            verdict,
          });
        }
      }
    }

    const headline = await ctx.runMutation(finishRunRef, {
      evalRunId,
      status: "completed",
    }) as { headlineCleanProbeMean?: number; headlineN: number };

    return {
      roomId,
      evalRunId,
      recordedTasks: args.payload.tasks.length,
      headlineCleanProbeMean: headline.headlineCleanProbeMean ?? null,
      headlineN: headline.headlineN,
    };
  },
});

