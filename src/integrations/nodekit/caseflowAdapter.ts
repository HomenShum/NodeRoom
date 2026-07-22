import {
  runCaseflowConformance,
  runtimeProfiles,
  type CaseflowConformanceVerdict,
  type CaseflowRuntime,
} from "@homenshum/nodekit/caseflow";

export const NODEKIT_CASEFLOW_SOURCE_COMMIT = "5cc61578b3c1bd5b5c8195b83347b91f8b83242b" as const;

export type NodeRoomCaseflowMutation =
  | "createCase"
  | "startRun"
  | "enterStage"
  | "createArtifact"
  | "createProposal"
  | "decideProposal"
  | "raiseException"
  | "resolveException"
  | "completeRun";

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

/**
 * Transport-neutral client seam. Browser callers can bind this to a Convex
 * client; convex-test binds the same calls to its in-memory deployment.
 */
export type NodeRoomCaseflowTransport = {
  mutation<Result>(operation: NodeRoomCaseflowMutation, args: Record<string, unknown>): Promise<Result>;
  query<Result>(operation: "snapshot", args: Record<string, unknown>): Promise<Result>;
};

function scopedArgs(scope: NodeRoomCaseflowScope, args: Record<string, unknown>) {
  // Scope wins over caller data. A portable payload cannot choose another room
  // or smuggle a different proof/actor through the adapter.
  const portable = { ...args };
  delete portable.actor;
  return { ...portable, roomId: scope.roomId, requester: scope.requester };
}

/**
 * Thin NodeKit runtime over NodeRoom's authenticated Convex functions. It does
 * not replace RoomTools, artifact CAS, job journals, or domain receipts.
 */
export function createNodeRoomCaseflowRuntime(
  transport: NodeRoomCaseflowTransport,
  scope: NodeRoomCaseflowScope,
): CaseflowRuntime {
  const invoke = <Result>(operation: NodeRoomCaseflowMutation, args: Record<string, unknown>) =>
    transport.mutation<Result>(operation, scopedArgs(scope, args));
  return {
    capabilities: runtimeProfiles.convex,
    createCase: (args) => invoke("createCase", args),
    startRun: (args) => invoke("startRun", args),
    enterStage: (args) => invoke("enterStage", args),
    createArtifact: (args) => invoke("createArtifact", { ...args, title: args.title ?? "Artifact" }),
    createProposal: (args) => invoke("createProposal", args),
    decideProposal: (args) => invoke("decideProposal", args),
    raiseException: (args) => invoke("raiseException", {
      ...args,
      code: args.code ?? "unknown",
      message: args.message ?? "An exception occurred.",
    }),
    resolveException: (args) => invoke("resolveException", args),
    completeRun: (args) => invoke("completeRun", args),
    snapshot: () => transport.query("snapshot", scopedArgs(scope, {})),
  };
}

/** Runs the conformance shipped by the pinned package, never a copied suite. */
export function runNodeRoomCaseflowConformance(
  transport: NodeRoomCaseflowTransport,
  scope: NodeRoomCaseflowScope,
): Promise<CaseflowConformanceVerdict> {
  return runCaseflowConformance(() => createNodeRoomCaseflowRuntime(transport, scope));
}
