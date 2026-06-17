import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof } from "./lib";

const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));
const providerV = v.union(v.literal("convex_storage"), v.literal("convex_fs"), v.literal("transloadit"));
const purposeV = v.union(v.literal("upload"), v.literal("parse"), v.literal("transcode"), v.literal("thumbnail"), v.literal("ocr"), v.literal("normalize"));
const statusV = v.union(v.literal("queued"), v.literal("running"), v.literal("waiting"), v.literal("completed"), v.literal("failed"), v.literal("cancelled"));

export async function enqueueFileProcessingJob(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  uploadedFileId?: Id<"uploadedFiles">;
  storageId?: string;
  provider: "convex_storage" | "convex_fs" | "transloadit";
  externalId?: string;
  purpose: "upload" | "parse" | "transcode" | "thumbnail" | "ocr" | "normalize";
  status?: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  inputMeta?: unknown;
  outputMeta?: unknown;
  resultUrls?: string[];
  error?: string;
  createdBy: { kind: "user" | "agent"; id: string; name: string; scope?: "public" | "private"; ownerId?: string };
  visibility?: "private" | "room" | "public";
  ownerId?: string;
}) {
  const now = Date.now();
  const existing = args.provider !== "convex_storage" && args.externalId
    ? await ctx.db.query("fileProcessingJobs")
        .withIndex("by_provider_external", (q) => q.eq("provider", args.provider).eq("externalId", args.externalId))
        .first()
    : null;
  const doc = {
    roomId: args.roomId,
    uploadedFileId: args.uploadedFileId,
    storageId: args.storageId,
    provider: args.provider,
    externalId: args.externalId,
    purpose: args.purpose,
    status: args.status ?? "queued" as const,
    inputMeta: args.inputMeta,
    outputMeta: args.outputMeta,
    resultUrls: args.resultUrls,
    error: args.error,
    createdBy: args.createdBy,
    visibility: args.visibility ?? "room" as const,
    ownerId: args.ownerId,
    updatedAt: now,
    ...(args.status === "completed" ? { completedAt: now } : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, doc);
    return existing._id;
  }
  return ctx.db.insert("fileProcessingJobs", { ...doc, createdAt: now });
}

export const queueUploadedFileProcessing = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    uploadedFileId: v.id("uploadedFiles"),
    provider: providerV,
    purpose: purposeV,
    externalId: v.optional(v.string()),
    inputMeta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const file = await ctx.db.get(args.uploadedFileId);
    if (!file || String(file.roomId) !== String(args.roomId)) throw new Error("uploaded_file_not_found");
    if (file.visibility === "private" && file.createdBy.id !== actor.id) throw new Error("source_file_not_visible");
    const jobId = await enqueueFileProcessingJob(ctx, {
      roomId: args.roomId,
      uploadedFileId: args.uploadedFileId,
      storageId: file.storageId,
      provider: args.provider,
      externalId: args.externalId,
      purpose: args.purpose,
      status: args.provider === "transloadit" ? "waiting" : "queued",
      inputMeta: args.inputMeta,
      createdBy: actor,
      visibility: file.visibility,
      ownerId: file.visibility === "private" ? actor.id : undefined,
    });
    return { jobId };
  },
});

export const recordTransloaditAssembly = internalMutation({
  args: {
    roomId: v.id("rooms"),
    uploadedFileId: v.optional(v.id("uploadedFiles")),
    storageId: v.optional(v.string()),
    assemblyId: v.string(),
    status: statusV,
    purpose: v.optional(purposeV),
    inputMeta: v.optional(v.any()),
    outputMeta: v.optional(v.any()),
    resultUrls: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    actor: v.object({
      kind: v.union(v.literal("user"), v.literal("agent")),
      id: v.string(),
      name: v.string(),
      scope: v.optional(v.union(v.literal("public"), v.literal("private"))),
      ownerId: v.optional(v.string()),
    }),
    visibility: v.optional(visibilityV),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => enqueueFileProcessingJob(ctx, {
    roomId: args.roomId,
    uploadedFileId: args.uploadedFileId,
    storageId: args.storageId,
    provider: "transloadit",
    externalId: args.assemblyId,
    purpose: args.purpose ?? "normalize",
    status: args.status,
    inputMeta: args.inputMeta,
    outputMeta: args.outputMeta,
    resultUrls: args.resultUrls,
    error: args.error,
    createdBy: args.actor,
    visibility: args.visibility,
    ownerId: args.ownerId,
  }),
});

export const listForFile = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, uploadedFileId: v.id("uploadedFiles"), limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, uploadedFileId, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("fileProcessingJobs")
      .withIndex("by_uploaded", (q) => q.eq("uploadedFileId", uploadedFileId))
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 20, 50)));
  },
});
