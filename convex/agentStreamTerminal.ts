import type { StreamId } from "@convex-dev/persistent-text-streaming";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";

const PUBLIC_STREAM_OWNER_ID = "public";

/** Close a persisted public stream after the job lease has been revoked. */
export async function finalizePublicAgentJobStreamAfterTerminal(
  ctx: MutationCtx,
  args: { roomId: Id<"rooms">; jobId: Id<"agentJobs">; text: string },
) {
  const clientMsgId = `pubstream-${String(args.jobId)}`;
  const message = await ctx.db.query("messages")
    .withIndex("by_clientMsgId", (q) => q.eq("roomId", args.roomId).eq("clientMsgId", clientMsgId))
    .unique();
  if (!message) return;
  if (message.streamId) {
    const streamId = message.streamId;
    const row = await ctx.db.query("privateReplyStreams").withIndex("by_stream", (q) => q.eq("streamId", streamId)).unique();
    if (row?.ownerId === PUBLIC_STREAM_OWNER_ID && row.clientMsgId === clientMsgId) {
      try {
        await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
          streamId: streamId as StreamId,
          text: "",
          final: true,
        });
      } catch {
        // Repeated terminalization is an expected race.
      }
    }
  }
  await ctx.db.patch(message._id, { text: args.text });
}
