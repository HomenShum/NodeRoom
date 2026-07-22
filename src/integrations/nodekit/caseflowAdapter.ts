import {
  type CaseflowRuntime,
  type NodeKitActor,
  type NodeKitApproval,
  type NodeKitArtifact,
  type NodeKitCase,
  type NodeKitCaseflowSnapshot,
  type NodeKitException,
  type NodeKitProposal,
  type NodeKitReceipt,
  type NodeKitRun,
  normalizePortableValue,
  PORTABLE_VALUE_LIMITS,
  runtimeProfiles,
} from "@homenshum/nodekit/caseflow";

/** Replaced only after NodeKit's clean exact-revision package proof passes. */
export const NODEKIT_CASEFLOW_SOURCE_COMMIT = "pending-final-nodekit-source" as const;
export const NODEKIT_CASEFLOW_SOURCE_HASH = "pending-final-nodekit-source-hash" as const;
export const NODEKIT_CASEFLOW_TARBALL_SHA256 = "pending-final-nodekit-tarball" as const;

export type NodeRoomCaseflowMutation =
  | "createCase"
  | "updateCaseInput"
  | "startRun"
  | "enterStage"
  | "createArtifact"
  | "createProposal"
  | "decideProposal"
  | "raiseException"
  | "resolveException"
  | "completeRun"
  | "cancelRun"
  | "failRunSafely";

export type NodeRoomCaseflowActorProof = {
  actor: {
    kind: "user";
    id: string;
    name: string;
  };
  token?: string;
};

export type NodeRoomCaseflowScope = {
  roomId: string;
  requester: NodeRoomCaseflowActorProof;
};

export type NodeRoomCaseflowTransport = {
  mutation<Result>(
    operation: NodeRoomCaseflowMutation,
    args: Record<string, unknown>,
  ): Promise<Result>;
  query<Result>(
    operation: "snapshot",
    args: Record<string, unknown>,
  ): Promise<Result>;
};

function scopedArgs(scope: NodeRoomCaseflowScope, args: Record<string, unknown>) {
  const portable = { ...args };
  // The host wrapper derives component actor and scope from its authenticated
  // member. Portable callers cannot choose a different principal or room.
  delete portable.actor;
  delete portable.requester;
  delete portable.roomId;
  return { ...portable, requester: scope.requester, roomId: scope.roomId };
}

export function createNodeRoomCaseflowRuntime(
  transport: NodeRoomCaseflowTransport,
  scope: NodeRoomCaseflowScope,
): CaseflowRuntime {
  const mutate = async <Result>(
    operation: NodeRoomCaseflowMutation,
    args: Record<string, unknown>,
  ) => {
    try {
      return await transport.mutation<Result>(operation, scopedArgs(scope, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Convex implementations may add the operation name to this error. Keep
      // the portable runtime contract stable for callers and conformance.
      if (/idempotencyKey was already used with a different .* request/.test(message)) {
        throw new Error("idempotencyKey was already used for a different request", {
          cause: error,
        });
      }
      throw error;
    }
  };
  return {
    capabilities: runtimeProfiles.convex,
    createCase: ({ title, primaryJob }) =>
      mutate<NodeKitCase>("createCase", { primaryJob, title }),
    updateCaseInput: ({ caseId, primaryJob, title }) =>
      mutate<NodeKitCase>("updateCaseInput", {
        caseId,
        ...(primaryJob === undefined ? {} : { primaryJob }),
        ...(title === undefined ? {} : { title }),
      }),
    startRun: ({ caseId, stages }) =>
      mutate<NodeKitRun>("startRun", { caseId, stages }),
    enterStage: ({
      idempotencyKey,
      nextAction,
      nextActionOwner,
      runId,
      stageId,
    }) =>
      mutate<NodeKitRun>("enterStage", {
        runId,
        stageId,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        ...(nextAction === undefined ? {} : { nextAction }),
        ...(nextActionOwner === undefined ? {} : { nextActionOwner }),
      }),
    createArtifact: async <T = unknown>({
      caseId,
      content,
      idempotencyKey,
      kind,
      runId,
      title,
    }: {
      actor?: NodeKitActor;
      caseId: string;
      content: T;
      idempotencyKey?: string;
      kind?: string;
      runId: string;
      title?: string;
    }) =>
      mutate<NodeKitArtifact<T>>("createArtifact", {
        caseId,
        content: normalizePortableValue(content, "content", {
          maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        }),
        runId,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        ...(kind === undefined ? {} : { kind }),
        ...(title === undefined ? {} : { title }),
      }),
    createProposal: async <T = unknown>({
      artifactId,
      baseVersion,
      idempotencyKey,
      patch,
      rationale,
    }: {
      actor?: NodeKitActor;
      artifactId: string;
      baseVersion: number;
      idempotencyKey?: string;
      patch: T;
      rationale?: string;
    }) =>
      mutate<NodeKitProposal<T>>("createProposal", {
        artifactId,
        baseVersion,
        patch: normalizePortableValue(patch, "patch", {
          maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth,
        }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        ...(rationale === undefined ? {} : { rationale }),
      }),
    decideProposal: ({ comment, decision, proposalId }) =>
      mutate<{
        approval: NodeKitApproval;
        artifact: NodeKitArtifact;
        proposal: NodeKitProposal;
        reused: boolean;
      }>("decideProposal", {
        decision,
        proposalId,
        ...(comment === undefined ? {} : { comment }),
      }),
    raiseException: async <T = unknown>({
      code,
      idempotencyKey,
      message,
      preservedState,
      runId,
    }: {
      actor?: NodeKitActor;
      code?: string;
      idempotencyKey?: string;
      message?: string;
      preservedState?: T;
      runId: string;
    }) =>
      mutate<NodeKitException<T>>("raiseException", {
        runId,
        ...(code === undefined ? {} : { code }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        ...(message === undefined ? {} : { message }),
        preservedState: normalizePortableValue(
          preservedState ?? {},
          "preservedState",
          { maxNestingDepth: PORTABLE_VALUE_LIMITS.maxPayloadNestingDepth },
        ),
      }),
    resolveException: ({
      exceptionId,
      nextAction,
      nextActionOwner,
      resolution,
    }) =>
      mutate<{ exception: NodeKitException; run: NodeKitRun }>(
        "resolveException",
        {
          exceptionId,
          ...(nextAction === undefined ? {} : { nextAction }),
          ...(nextActionOwner === undefined ? {} : { nextActionOwner }),
          ...(resolution === undefined ? {} : { resolution }),
        },
      ),
    completeRun: ({ runId }) =>
      mutate<{ receipt: NodeKitReceipt; reused: boolean; run: NodeKitRun }>(
        "completeRun",
        { runId },
      ),
    cancelRun: ({ reason, runId }) =>
      mutate<{ receipt: NodeKitReceipt; reused: boolean; run: NodeKitRun }>(
        "cancelRun",
        { runId, ...(reason === undefined ? {} : { reason }) },
      ),
    failRunSafely: ({ reason, runId }) =>
      mutate<{ receipt: NodeKitReceipt; reused: boolean; run: NodeKitRun }>(
        "failRunSafely",
        { runId, ...(reason === undefined ? {} : { reason }) },
      ),
    snapshot: () =>
      transport.query<NodeKitCaseflowSnapshot>(
        "snapshot",
        scopedArgs(scope, {}),
      ),
  };
}
