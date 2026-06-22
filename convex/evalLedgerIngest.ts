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

// BOUND: cap free-text string sizes BEFORE any runMutation call so a single payload
// (up to 250 tasks) can't deliver multi-MB raw strings that blow past Convex's 1 MB
// document limit mid-loop and corrupt a partial ingest. Validators can't express
// length caps, so the handler enforces them at the trust boundary.
const MAX_RAW_BYTES = 32_768;          // task.raw (largest free-text field per row)
const MAX_NOTES_BYTES = 4_096;         // run-level notes
const MAX_LABEL_BYTES = 256;           // iterationLabel
const MAX_IDENT_BYTES = 128;           // taskId, firedWriter, model, materializerMode, plannerTransport, trialId
const MAX_VERDICT_BYTES = 4_096;       // verdict free-text

function clampString(value: string, maxBytes: number): string {
  // JS string length is UTF-16 code units, which approximates byte count closely
  // enough for the document-size guard. Exact byte accounting is unnecessary —
  // the goal is to keep any single field well below the per-doc limit.
  return value.length > maxBytes ? value.slice(0, maxBytes) : value;
}

function clampOptionalString(value: string | undefined, maxBytes: number): string | undefined {
  return value === undefined ? undefined : clampString(value, maxBytes);
}

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
      iterationLabel: clampString(args.payload.iterationLabel, MAX_LABEL_BYTES),
      benchmark: args.payload.benchmark,
      model: clampOptionalString(args.payload.model, MAX_IDENT_BYTES),
      materializerMode: clampString(args.payload.materializerMode, MAX_IDENT_BYTES),
      taskCount: args.payload.taskCount,
      notes: clampOptionalString(args.payload.notes, MAX_NOTES_BYTES),
    }) as Id<"evalRuns">;

    for (const task of args.payload.tasks) {
      // Refutations ride alongside the task result but live in their own table column;
      // strip them from the result write, then emit each verdict via the internal mutation.
      const { refutations, ...resultFields } = task;
      const clampedTaskId = clampString(resultFields.taskId, MAX_IDENT_BYTES);
      await ctx.runMutation(recordTaskResultRef, {
        roomId,
        evalRunId,
        ...resultFields,
        taskId: clampedTaskId,
        firedWriter: clampString(resultFields.firedWriter, MAX_IDENT_BYTES),
        raw: clampOptionalString(resultFields.raw, MAX_RAW_BYTES),
        plannerTransport: clampOptionalString(resultFields.plannerTransport, MAX_IDENT_BYTES),
        trialId: clampOptionalString(resultFields.trialId, MAX_IDENT_BYTES),
        verdict: clampOptionalString(resultFields.verdict, MAX_VERDICT_BYTES),
      });
      if (refutations && refutations.length > 0) {
        for (const verdict of refutations) {
          await ctx.runMutation(recordRefutationVerdictInternalRef, {
            evalRunId,
            taskId: clampedTaskId,
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

