import {
  type ComponentApi,
  createNodeKitCaseflowClient,
} from "@homenshum/nodekit/convex-caseflow";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { applyCellEditCore, assertCreateArtifactLimits } from "./artifacts";
import {
  actorProofV,
  requireActorProof,
  sha256Hex,
  type ActorValue,
} from "./lib";

const componentApi = (
  components as unknown as {
    nodekitCaseflow: ComponentApi<"nodekitCaseflow">;
  }
).nodekitCaseflow;
const caseflow = createNodeKitCaseflowClient(componentApi);

const CANONICAL_ELEMENT_ID = "nodekit:caseflow:canonical";
type DbCtx = QueryCtx | MutationCtx;
type Requester = { actor: ActorValue; token?: string };
type CaseBinding = Doc<"nodekitCaseflowBindings">;
type RunBinding = Doc<"nodekitCaseflowRunBindings">;
type ArtifactBinding = Doc<"nodekitCaseflowArtifactBindings">;

type Scope = {
  actor: ActorValue;
  componentActor: { id: string; type: "human" };
  member: Doc<"members">;
  room: Doc<"rooms">;
  scopeKey: string;
};

const scopeArgs = {
  roomId: v.id("rooms"),
  requester: actorProofV,
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("caseflow_domain_value_not_json");
  return encoded;
}

async function requireScope(
  ctx: DbCtx,
  roomId: Id<"rooms">,
  requester: Requester,
): Promise<Scope> {
  const actor = await requireActorProof(ctx, roomId, requester);
  const [member, room] = await Promise.all([
    ctx.db.get(actor.id as Id<"members">),
    ctx.db.get(roomId),
  ]);
  if (!member || String(member.roomId) !== String(roomId)) {
    throw new Error("caseflow_member_scope_mismatch");
  }
  if (!room || room.status !== "live") throw new Error("caseflow_room_not_live");
  const digest = await sha256Hex(
    ["noderoom.nodekit-caseflow/v1", String(roomId), String(member._id)].join("\u001f"),
  );
  return {
    actor,
    componentActor: { id: String(member._id), type: "human" },
    member,
    room,
    scopeKey: `noderoom_${digest}`,
  };
}

function assertOwnedBinding(
  scope: Scope,
  binding: CaseBinding | RunBinding | ArtifactBinding | null,
) {
  if (
    binding === null ||
    String(binding.roomId) !== String(scope.room._id) ||
    String(binding.ownerMemberId) !== String(scope.member._id) ||
    binding.scopeKey !== scope.scopeKey
  ) {
    throw new Error("caseflow_owner_scope_mismatch");
  }
  return binding;
}

async function caseBindingByCase(ctx: DbCtx, scope: Scope, caseId: string) {
  return assertOwnedBinding(
    scope,
    await ctx.db
      .query("nodekitCaseflowBindings")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .unique(),
  ) as CaseBinding;
}

async function caseBindingByRun(ctx: DbCtx, scope: Scope, runId: string) {
  return assertOwnedBinding(
    scope,
    await ctx.db
      .query("nodekitCaseflowRunBindings")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique(),
  ) as RunBinding;
}

async function artifactBindingByComponent(
  ctx: DbCtx,
  scope: Scope,
  componentArtifactId: string,
) {
  return assertOwnedBinding(
    scope,
    await ctx.db
      .query("nodekitCaseflowArtifactBindings")
      .withIndex("by_component_artifact", (q) =>
        q.eq("componentArtifactId", componentArtifactId),
      )
      .unique(),
  ) as ArtifactBinding;
}

function withNodeRoomArtifact<T extends Record<string, unknown>>(
  artifact: T,
  binding: ArtifactBinding,
) {
  return {
    ...artifact,
    canonicalElementId: binding.canonicalElementId,
    nodeRoomArtifactId: String(binding.nodeRoomArtifactId),
  };
}

async function requireSynchronizedArtifact(
  ctx: DbCtx,
  scope: Scope,
  binding: ArtifactBinding,
) {
  const [componentArtifact, nodeRoomArtifact, element] = await Promise.all([
    caseflow.getArtifact(ctx, {
      artifactId: binding.componentArtifactId,
      scopeKey: scope.scopeKey,
    }),
    ctx.db.get(binding.nodeRoomArtifactId),
    ctx.db
      .query("elements")
      .withIndex("by_artifact", (q) =>
        q
          .eq("artifactId", binding.nodeRoomArtifactId)
          .eq("elementId", binding.canonicalElementId),
      )
      .unique(),
  ]);
  if (componentArtifact === null || nodeRoomArtifact === null || element === null) {
    throw new Error("caseflow_artifact_binding_incomplete");
  }
  if (
    String(nodeRoomArtifact.roomId) !== String(scope.room._id) ||
    nodeRoomArtifact.visibility !== "private" ||
    nodeRoomArtifact.createdBy?.id !== String(scope.member._id)
  ) {
    throw new Error("caseflow_domain_artifact_scope_mismatch");
  }
  const canonical = componentArtifact.versions.at(-1);
  if (
    canonical === undefined ||
    componentArtifact.canonicalVersion !== element.version ||
    nodeRoomArtifact.version !== element.version ||
    canonical.version !== element.version ||
    canonicalJson(canonical.content) !== canonicalJson(element.value)
  ) {
    throw new Error(
      `caseflow_domain_artifact_drift:${componentArtifact.canonicalVersion}:${element.version}`,
    );
  }
  return { componentArtifact, element, nodeRoomArtifact };
}

export const createCase = mutation({
  args: { ...scopeArgs, title: v.string(), primaryJob: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const created = await caseflow.createCase(ctx, {
      actor: scope.componentActor,
      primaryJob: args.primaryJob,
      scopeKey: scope.scopeKey,
      title: args.title,
    });
    const existing = await ctx.db
      .query("nodekitCaseflowBindings")
      .withIndex("by_case", (q) => q.eq("caseId", created.caseId))
      .unique();
    if (existing !== null) {
      assertOwnedBinding(scope, existing);
      return created;
    }
    const now = Date.now();
    await ctx.db.insert("nodekitCaseflowBindings", {
      caseId: created.caseId,
      createdAt: now,
      ownerMemberId: scope.member._id,
      roomId: scope.room._id,
      scopeKey: scope.scopeKey,
      updatedAt: now,
    });
    return created;
  },
});

export const updateCaseInput = mutation({
  args: {
    ...scopeArgs,
    caseId: v.string(),
    primaryJob: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    await caseBindingByCase(ctx, scope, args.caseId);
    return caseflow.updateCaseInput(ctx, {
      actor: scope.componentActor,
      caseId: args.caseId,
      scopeKey: scope.scopeKey,
      ...(args.primaryJob === undefined ? {} : { primaryJob: args.primaryJob }),
      ...(args.title === undefined ? {} : { title: args.title }),
    });
  },
});

export const startRun = mutation({
  args: {
    ...scopeArgs,
    caseId: v.string(),
    stages: v.array(
      v.object({ id: v.string(), label: v.string(), owner: v.string() }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const binding = await caseBindingByCase(ctx, scope, args.caseId);
    const run = await caseflow.startRun(ctx, {
      actor: scope.componentActor,
      caseId: args.caseId,
      scopeKey: scope.scopeKey,
      stages: args.stages,
    });
    const existingRunBinding = await ctx.db
      .query("nodekitCaseflowRunBindings")
      .withIndex("by_run", (q) => q.eq("runId", run.runId))
      .unique();
    if (existingRunBinding === null) {
      await ctx.db.insert("nodekitCaseflowRunBindings", {
        caseId: args.caseId,
        createdAt: Date.now(),
        ownerMemberId: scope.member._id,
        roomId: scope.room._id,
        runId: run.runId,
        scopeKey: scope.scopeKey,
      });
    } else {
      const ownedRun = assertOwnedBinding(scope, existingRunBinding) as RunBinding;
      if (ownedRun.caseId !== args.caseId) {
        throw new Error("run does not belong to case: caseflow_run_case_mismatch");
      }
    }
    if (binding.currentRunId !== run.runId) {
      await ctx.db.patch(binding._id, {
        currentRunId: run.runId,
        updatedAt: Date.now(),
      });
    }
    return run;
  },
});

export const enterStage = mutation({
  args: {
    ...scopeArgs,
    idempotencyKey: v.optional(v.string()),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    runId: v.string(),
    stageId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    await caseBindingByRun(ctx, scope, args.runId);
    return caseflow.enterStage(ctx, {
      actor: scope.componentActor,
      runId: args.runId,
      scopeKey: scope.scopeKey,
      stageId: args.stageId,
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      ...(args.nextAction === undefined ? {} : { nextAction: args.nextAction }),
      ...(args.nextActionOwner === undefined
        ? {}
        : { nextActionOwner: args.nextActionOwner }),
    });
  },
});

export const createArtifact = mutation({
  args: {
    ...scopeArgs,
    caseId: v.string(),
    content: v.any(),
    idempotencyKey: v.optional(v.string()),
    kind: v.optional(v.string()),
    runId: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const caseBinding = await caseBindingByCase(ctx, scope, args.caseId);
    if (caseBinding.currentRunId !== args.runId) {
      throw new Error("run does not belong to case: caseflow_run_case_mismatch");
    }
    const componentArtifact = await caseflow.createArtifact(ctx, {
      actor: scope.componentActor,
      caseId: args.caseId,
      content: args.content,
      runId: args.runId,
      scopeKey: scope.scopeKey,
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      ...(args.kind === undefined ? {} : { kind: args.kind }),
      ...(args.title === undefined ? {} : { title: args.title }),
    });
    const existing = await ctx.db
      .query("nodekitCaseflowArtifactBindings")
      .withIndex("by_component_artifact", (q) =>
        q.eq("componentArtifactId", componentArtifact.artifactId),
      )
      .unique();
    if (existing !== null) {
      const binding = assertOwnedBinding(scope, existing) as ArtifactBinding;
      return withNodeRoomArtifact(componentArtifact, binding);
    }

    const title = componentArtifact.title;
    const content = componentArtifact.versions[0]?.content;
    const now = Date.now();
    const meta = {
      caseflowArtifactId: componentArtifact.artifactId,
      caseflowKind: componentArtifact.kind,
      caseId: componentArtifact.caseId,
      integration: "@homenshum/nodekit/convex-caseflow",
      runId: componentArtifact.runId,
    };
    assertCreateArtifactLimits({
      meta,
      seed: [{ id: CANONICAL_ELEMENT_ID, value: content }],
      title,
    });
    const nodeRoomArtifactId = await ctx.db.insert("artifacts", {
      createdBy: scope.actor,
      kind: "sheet",
      meta,
      order: [CANONICAL_ELEMENT_ID],
      roomId: scope.room._id,
      title,
      updatedAt: now,
      version: 1,
      visibility: "private",
    });
    await ctx.db.insert("elements", {
      artifactId: nodeRoomArtifactId,
      elementId: CANONICAL_ELEMENT_ID,
      updatedAt: now,
      updatedBy: scope.actor,
      value: content,
      version: 1,
    });
    const bindingId = await ctx.db.insert("nodekitCaseflowArtifactBindings", {
      canonicalElementId: CANONICAL_ELEMENT_ID,
      caseId: args.caseId,
      componentArtifactId: componentArtifact.artifactId,
      createdAt: now,
      nodeRoomArtifactId,
      ownerMemberId: scope.member._id,
      roomId: scope.room._id,
      runId: args.runId,
      scopeKey: scope.scopeKey,
      updatedAt: now,
    });
    await ctx.db.insert("traces", {
      actor: scope.actor,
      detail: `component ${componentArtifact.artifactId} · ${String(nodeRoomArtifactId)}`,
      roomId: scope.room._id,
      summary: `${scope.actor.name} added ${title} through NodeKit Caseflow`,
      ts: now,
      type: "edit_applied",
    });
    const binding = await ctx.db.get(bindingId);
    if (binding === null) throw new Error("caseflow_artifact_binding_insert_failed");
    return withNodeRoomArtifact(componentArtifact, binding);
  },
});

export const createProposal = mutation({
  args: {
    ...scopeArgs,
    artifactId: v.string(),
    baseVersion: v.number(),
    idempotencyKey: v.optional(v.string()),
    patch: v.any(),
    rationale: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const binding = await artifactBindingByComponent(ctx, scope, args.artifactId);
    const { componentArtifact } = await requireSynchronizedArtifact(
      ctx,
      scope,
      binding,
    );
    if (args.baseVersion !== componentArtifact.canonicalVersion) {
      throw new Error(
        `caseflow_stale_proposal_base:${args.baseVersion}:${componentArtifact.canonicalVersion}`,
      );
    }
    return caseflow.createProposal(ctx, {
      actor: scope.componentActor,
      artifactId: args.artifactId,
      baseVersion: args.baseVersion,
      patch: args.patch,
      scopeKey: scope.scopeKey,
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      ...(args.rationale === undefined ? {} : { rationale: args.rationale }),
    });
  },
});

export const decideProposal = mutation({
  args: {
    ...scopeArgs,
    comment: v.optional(v.string()),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    proposalId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const pending = await caseflow.listPendingApprovals(ctx, {
      limit: 500,
      scopeKey: scope.scopeKey,
    });
    const pendingProposal = pending.find(
      (proposal) => proposal.proposalId === args.proposalId,
    );
    let binding: ArtifactBinding | null = null;
    let synchronized:
      | Awaited<ReturnType<typeof requireSynchronizedArtifact>>
      | undefined;
    if (pendingProposal !== undefined) {
      binding = await artifactBindingByComponent(
        ctx,
        scope,
        pendingProposal.artifactId,
      );
      const componentArtifact = await caseflow.getArtifact(ctx, {
        artifactId: pendingProposal.artifactId,
        scopeKey: scope.scopeKey,
      });
      if (componentArtifact === null) throw new Error("caseflow_artifact_not_found");
      // A stale component proposal must reach Caseflow so it becomes an explicit
      // conflict. A component-current proposal must also match NodeRoom's real
      // canonical artifact before either side is allowed to advance.
      if (
        args.decision === "accepted" &&
        pendingProposal.baseVersion === componentArtifact.canonicalVersion
      ) {
        synchronized = await requireSynchronizedArtifact(ctx, scope, binding);
      }
    }

    const decided = await caseflow.decideProposal(ctx, {
      actor: scope.componentActor,
      decision: args.decision,
      proposalId: args.proposalId,
      scopeKey: scope.scopeKey,
      ...(args.comment === undefined ? {} : { comment: args.comment }),
    });
    binding ??= await artifactBindingByComponent(
      ctx,
      scope,
      decided.artifact.artifactId,
    );
    if (
      args.decision === "accepted" &&
      decided.proposal.status === "accepted" &&
      !decided.reused
    ) {
      synchronized ??= await requireSynchronizedArtifact(ctx, scope, binding);
      const applied = await applyCellEditCore(ctx, {
        actor: scope.actor,
        artifactId: binding.nodeRoomArtifactId,
        baseVersion: decided.proposal.baseVersion,
        elementId: binding.canonicalElementId,
        kind: "set",
        roomId: scope.room._id,
        value: decided.proposal.patch,
      });
      if (!applied.ok) {
        throw new Error(`caseflow_domain_apply_failed:${applied.reason}`);
      }
      if (applied.version !== decided.artifact.canonicalVersion) {
        throw new Error(
          `caseflow_domain_version_diverged:${applied.version}:${decided.artifact.canonicalVersion}`,
        );
      }
      await ctx.db.patch(binding._id, { updatedAt: Date.now() });
    }
    return {
      ...decided,
      artifact: withNodeRoomArtifact(decided.artifact, binding),
    };
  },
});

export const raiseException = mutation({
  args: {
    ...scopeArgs,
    code: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    message: v.optional(v.string()),
    preservedState: v.optional(v.any()),
    runId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    await caseBindingByRun(ctx, scope, args.runId);
    return caseflow.raiseException(ctx, {
      actor: scope.componentActor,
      runId: args.runId,
      scopeKey: scope.scopeKey,
      ...(args.code === undefined ? {} : { code: args.code }),
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      ...(args.message === undefined ? {} : { message: args.message }),
      ...(args.preservedState === undefined
        ? {}
        : { preservedState: args.preservedState }),
    });
  },
});

export const resolveException = mutation({
  args: {
    ...scopeArgs,
    exceptionId: v.string(),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    resolution: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    return caseflow.resolveException(ctx, {
      actor: scope.componentActor,
      exceptionId: args.exceptionId,
      scopeKey: scope.scopeKey,
      ...(args.nextAction === undefined ? {} : { nextAction: args.nextAction }),
      ...(args.nextActionOwner === undefined
        ? {}
        : { nextActionOwner: args.nextActionOwner }),
      ...(args.resolution === undefined ? {} : { resolution: args.resolution }),
    });
  },
});

async function assertRunArtifactsSynchronized(
  ctx: DbCtx,
  scope: Scope,
  runId: string,
) {
  const bindings = await ctx.db
    .query("nodekitCaseflowArtifactBindings")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
  for (const binding of bindings) {
    assertOwnedBinding(scope, binding);
    await requireSynchronizedArtifact(ctx, scope, binding);
  }
}

async function terminateRun(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    requester: Requester;
    reason?: string;
    runId: string;
  },
  status: "cancelled" | "completed" | "failed_safely",
) {
  const scope = await requireScope(ctx, args.roomId, args.requester);
  await caseBindingByRun(ctx, scope, args.runId);
  await assertRunArtifactsSynchronized(ctx, scope, args.runId);
  const common = {
    actor: scope.componentActor,
    runId: args.runId,
    scopeKey: scope.scopeKey,
  };
  if (status === "completed") return caseflow.completeRun(ctx, common);
  if (status === "cancelled") {
    return caseflow.cancelRun(ctx, {
      ...common,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    });
  }
  return caseflow.failRunSafely(ctx, {
    ...common,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
  });
}

export const completeRun = mutation({
  args: { ...scopeArgs, runId: v.string() },
  returns: v.any(),
  handler: (ctx, args) => terminateRun(ctx, args, "completed"),
});

export const cancelRun = mutation({
  args: { ...scopeArgs, reason: v.optional(v.string()), runId: v.string() },
  returns: v.any(),
  handler: (ctx, args) => terminateRun(ctx, args, "cancelled"),
});

export const failRunSafely = mutation({
  args: { ...scopeArgs, reason: v.optional(v.string()), runId: v.string() },
  returns: v.any(),
  handler: (ctx, args) => terminateRun(ctx, args, "failed_safely"),
});

export const snapshot = query({
  args: scopeArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const [caseBindings, runBindings, artifactBindings, pending] = await Promise.all([
      ctx.db
        .query("nodekitCaseflowBindings")
        .withIndex("by_room_owner", (q) =>
          q
            .eq("roomId", scope.room._id)
            .eq("ownerMemberId", scope.member._id),
        )
        .collect(),
      ctx.db
        .query("nodekitCaseflowRunBindings")
        .withIndex("by_room_owner", (q) =>
          q
            .eq("roomId", scope.room._id)
            .eq("ownerMemberId", scope.member._id),
        )
        .collect(),
      ctx.db
        .query("nodekitCaseflowArtifactBindings")
        .withIndex("by_room_owner", (q) =>
          q
            .eq("roomId", scope.room._id)
            .eq("ownerMemberId", scope.member._id),
        )
        .collect(),
      caseflow.listPendingApprovals(ctx, {
        limit: 500,
        scopeKey: scope.scopeKey,
      }),
    ]);
    const cases = (
      await Promise.all(
        caseBindings.map((binding) =>
          caseflow.getCase(ctx, {
            caseId: binding.caseId,
            scopeKey: scope.scopeKey,
          }),
        ),
      )
    ).filter((record) => record !== null);
    const runIds = [...new Set(runBindings.map((binding) => binding.runId))];
    const runs = (
      await Promise.all(
        runIds.map((runId) =>
          caseflow.getRun(ctx, { runId, scopeKey: scope.scopeKey }),
        ),
      )
    ).filter((record) => record !== null);
    const artifacts = (
      await Promise.all(
        artifactBindings.map(async (binding) => {
          const artifact = await caseflow.getArtifact(ctx, {
            artifactId: binding.componentArtifactId,
            scopeKey: scope.scopeKey,
          });
          return artifact === null
            ? null
            : withNodeRoomArtifact(artifact, binding);
        }),
      )
    ).filter((record) => record !== null);
    const receipts = (
      await Promise.all(
        runIds.map((runId) =>
          caseflow.getReceiptForRun(ctx, {
            runId,
            scopeKey: scope.scopeKey,
          }),
        ),
      )
    ).filter((record) => record !== null);
    const events = (
      await Promise.all(
        runIds.map((runId) =>
          caseflow.getTimeline(ctx, {
            aggregateId: runId,
            aggregateType: "run",
            limit: 500,
            scopeKey: scope.scopeKey,
          }),
        ),
      )
    ).flat();
    return {
      approvals: [],
      artifacts,
      cases,
      events,
      exceptions: [],
      proposals: pending,
      receipts,
      runs,
    };
  },
});

export const getReceipt = query({
  args: { ...scopeArgs, runId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    await caseBindingByRun(ctx, scope, args.runId);
    return caseflow.getReceiptForRun(ctx, {
      runId: args.runId,
      scopeKey: scope.scopeKey,
    });
  },
});
