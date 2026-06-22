/**
 * Persistent text streaming for the private NodeAgent reply (@convex-dev/persistent-text-streaming).
 *
 * Before this, runPrivateAgent was one blocking model call + one insert: the user stared at a
 * typing indicator for the whole generation and a refresh lost nothing only because nothing was
 * ever shown. Now: createPrivateReplyStream posts a placeholder message with a streamId, the
 * driving tab POSTs the streaming httpAction (convex/http.ts) and renders token-by-token over
 * HTTP, while the component persists sentence-flushed chunks to the DB — so a refresh or a
 * second tab picks the body up mid-stream from the DB without re-driving generation. On
 * completion the message row's text is patched in, so history/export never depend on the
 * component.
 *
 * Auth model: the prompt + room context are captured HERE, inside the proof-checked mutation;
 * stream reads and the HTTP driver must present the same actor proof that can read the owner's
 * private channel. The component still 205s any second drive attempt.
 */
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { PersistentTextStreaming, StreamIdValidator, type StreamId } from "@convex-dev/persistent-text-streaming";
import { components } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { actorProofV, actorV, requireActorCanUseChannel, requireActorProof } from "./lib";
import { summarizeRoomForPrivate } from "./agent";
import { assertProviderEgressAllowed } from "../src/nodeagent/guardrails/egressPolicy";

const roomsFullRef = makeFunctionReference<"query">("rooms:full");
const PUBLIC_STREAM_OWNER_ID = "public";

export const streamingComponent = new PersistentTextStreaming(components.persistentTextStreaming);

function publicAgentJobStreamClientMsgId(jobId: string): string {
  return `pubstream-${jobId}`;
}

async function ensureStreamMetadata(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  ownerId: string;
  requesterName: string;
  goal: string;
  roomContext: string;
  clientMsgId: string;
  streamId: string;
}) {
  const existing = await ctx.db.query("privateReplyStreams").withIndex("by_stream", (q) => q.eq("streamId", args.streamId)).unique();
  if (existing) return;
  await ctx.db.insert("privateReplyStreams", {
    roomId: args.roomId,
    ownerId: args.ownerId,
    requesterName: args.requesterName,
    goal: args.goal,
    roomContext: args.roomContext,
    clientMsgId: args.clientMsgId,
    streamId: args.streamId,
    createdAt: Date.now(),
  });
}

export const createPrivateReplyStream = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV, goal: v.string() },
  handler: async (ctx, a): Promise<{ streamId: string }> => {
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const roomState = await ctx.runQuery(roomsFullRef, { roomId: a.roomId, requester: a.requester });
    if (!roomState) throw new Error("room_not_found");
    assertProviderEgressAllowed({
      model: process.env.AGENT_MODEL ?? "gemini-3.5-flash",
      entrypoint: "private_agent",
      artifacts: roomState.artifacts.map((art: { title: string; kind: string; meta?: unknown }) => ({
        title: art.title,
        kind: art.kind,
        meta: art.meta,
      })),
      env: process.env,
    });
    const ownerId = String(actor.id);
    const streamId = String(await streamingComponent.createStream(ctx));
    // Mirror messages.postPrivateAgentReply: joiners don't get a private session at join time.
    const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).collect();
    if (!sessions.some((s) => s.agentId === "agent_priv" && s.scope === "private" && s.ownerId === ownerId)) {
      await ctx.db.insert("agentSessions", { roomId: a.roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId, status: "idle", lastAction: "started", updatedAt: Date.now() });
    }
    const clientMsgId = `privstream-${streamId}`;
    await ctx.db.insert("messages", {
      roomId: a.roomId,
      channel: ownerId, // private channel = the owning member id
      author: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId },
      text: "",
      clientMsgId,
      kind: "agent",
      createdAt: Date.now(),
      streamId,
    });
    await ctx.db.insert("privateReplyStreams", {
      roomId: a.roomId,
      ownerId,
      requesterName: actor.name,
      goal: a.goal,
      roomContext: summarizeRoomForPrivate(roomState as Parameters<typeof summarizeRoomForPrivate>[0]),
      clientMsgId,
      streamId,
      createdAt: Date.now(),
    });
    return { streamId };
  },
});

export const ensurePublicAgentJobStream = internalMutation({
  args: { roomId: v.id("rooms"), jobId: v.id("agentJobs"), author: actorV, goal: v.string(), createdAt: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ streamId: string; clientMsgId: string }> => {
    const clientMsgId = publicAgentJobStreamClientMsgId(String(a.jobId));
    const existingMessage = await ctx.db.query("messages").withIndex("by_clientMsgId", (q) => q.eq("roomId", a.roomId).eq("clientMsgId", clientMsgId)).unique();
    if (existingMessage?.streamId && !existingMessage.text) {
      await ensureStreamMetadata(ctx, {
        roomId: a.roomId,
        ownerId: PUBLIC_STREAM_OWNER_ID,
        requesterName: a.author.name,
        goal: a.goal,
        roomContext: "",
        clientMsgId,
        streamId: existingMessage.streamId,
      });
      return { streamId: existingMessage.streamId, clientMsgId };
    }

    const streamId = String(await streamingComponent.createStream(ctx));
    if (existingMessage) {
      await ctx.db.patch(existingMessage._id, { streamId, text: "" });
    } else {
      await ctx.db.insert("messages", {
        roomId: a.roomId,
        channel: PUBLIC_STREAM_OWNER_ID,
        author: a.author,
        text: "",
        clientMsgId,
        kind: "agent",
        createdAt: a.createdAt ?? Date.now(),
        streamId,
      });
    }
    await ensureStreamMetadata(ctx, {
      roomId: a.roomId,
      ownerId: PUBLIC_STREAM_OWNER_ID,
      requesterName: a.author.name,
      goal: a.goal,
      roomContext: "",
      clientMsgId,
      streamId,
    });
    return { streamId, clientMsgId };
  },
});

async function requirePublicAgentJobStream(ctx: MutationCtx, args: { roomId: Id<"rooms">; jobId: Id<"agentJobs">; streamId: string }) {
  const row = await ctx.db.query("privateReplyStreams").withIndex("by_stream", (q) => q.eq("streamId", args.streamId)).unique();
  if (!row) throw new Error("stream_not_found");
  if (String(row.roomId) !== String(args.roomId)) throw new Error("stream_room_mismatch");
  if (row.ownerId !== PUBLIC_STREAM_OWNER_ID) throw new Error("stream_not_public_agent_job");
  if (row.clientMsgId !== publicAgentJobStreamClientMsgId(String(args.jobId))) throw new Error("stream_job_mismatch");
  return row;
}

export const appendPublicAgentJobStreamChunk = internalMutation({
  args: { roomId: v.id("rooms"), jobId: v.id("agentJobs"), streamId: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    if (!a.text) return;
    await requirePublicAgentJobStream(ctx, a);
    await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
      streamId: a.streamId as StreamId,
      text: a.text,
      final: false,
    });
  },
});

export const finalizePublicAgentJobStream = internalMutation({
  args: { roomId: v.id("rooms"), jobId: v.id("agentJobs"), streamId: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const row = await requirePublicAgentJobStream(ctx, a);
    try {
      await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
        streamId: a.streamId as StreamId,
        text: "",
        final: true,
      });
    } catch {
      // The component treats repeated finalization as an error; job retries can race terminal writes.
    }
    const m = await ctx.db.query("messages").withIndex("by_clientMsgId", (q) => q.eq("roomId", a.roomId).eq("clientMsgId", row.clientMsgId)).unique();
    if (m) await ctx.db.patch(m._id, { text: a.text });
  },
});

/** Body + status for a stream. Private reply chunks are guarded like messages.list: the requester
 * must be allowed to read the owning channel, so streamId is not treated as auth. Public job
 * streams reuse this metadata with ownerId="public". */
export const getStreamBody = query({
  args: { streamId: StreamIdValidator, requester: actorProofV },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("privateReplyStreams").withIndex("by_stream", (q) => q.eq("streamId", a.streamId)).unique();
    if (!row) throw new Error("stream_not_found");
    const actor = await requireActorProof(ctx, row.roomId, a.requester);
    await requireActorCanUseChannel(ctx, row.roomId, actor, row.ownerId);
    return streamingComponent.getStreamBody(ctx, a.streamId as StreamId);
  },
});

export const streamMeta = internalQuery({
  args: { streamId: v.string(), requester: actorProofV },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("privateReplyStreams").withIndex("by_stream", (q) => q.eq("streamId", a.streamId)).unique();
    if (!row) return null;
    const actor = await requireActorProof(ctx, row.roomId, a.requester);
    await requireActorCanUseChannel(ctx, row.roomId, actor, row.ownerId);
    return { roomId: row.roomId, ownerId: row.ownerId, requesterName: row.requesterName, goal: row.goal, roomContext: row.roomContext, clientMsgId: row.clientMsgId };
  },
});

/** Patch the placeholder message with the full body once the stream completes — history, refs,
 *  search, and export read message.text and must never depend on the component's chunk store. */
export const finalizeStreamMessage = internalMutation({
  args: { roomId: v.id("rooms"), clientMsgId: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const m = await ctx.db.query("messages").withIndex("by_clientMsgId", (q) => q.eq("roomId", a.roomId).eq("clientMsgId", a.clientMsgId)).unique();
    if (m && !m.text) await ctx.db.patch(m._id, { text: a.text });
  },
});
