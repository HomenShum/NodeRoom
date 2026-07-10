"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import { actorProofV } from "./lib";
import { executeNotebookKernel, type NotebookKernelRequest, type NotebookKernelResult } from "../src/notebook/notebookKernel";

const assertMemberRef = makeFunctionReference<"query">("captures:assertMember") as any;

export const execute = action({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    kind: v.union(v.literal("calculation"), v.literal("sql"), v.literal("chart")),
    input: v.string(),
    tables: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<NotebookKernelResult> => {
    await ctx.runQuery(assertMemberRef, { roomId: args.roomId, requester: args.requester });
    return executeNotebookKernel({
      kind: args.kind,
      input: args.input,
      tables: args.tables as NotebookKernelRequest["tables"],
    }, { backend: "convex", now: Date.now() });
  },
});
