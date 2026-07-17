import type { AlgorithmPatchBundle } from "../skills/spreadsheet/algorithmArtifacts";
import {
  resolveSemanticConflictPacket,
  type SemanticConflictPacket,
  type SemanticResolution,
} from "../skills/spreadsheet/semanticRebase";
import {
  canonicalNodeWorkflowJson,
  inspectNodeWorkflowCandidate,
  type CandidateAdmission,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
} from "./workflowExecutionPort";

export interface RoomAlgorithmWorkflowCandidate {
  kind: "algorithm_patch_bundle";
  bundle: AlgorithmPatchBundle;
}

export interface RoomSemanticWorkflowCandidate {
  kind: "semantic_conflict_resolution";
  packet: SemanticConflictPacket;
  resolution: SemanticResolution;
}

export type RoomWorkflowCandidate =
  RoomAlgorithmWorkflowCandidate | RoomSemanticWorkflowCandidate;

/**
 * Validates an executor-produced candidate only. Applying the returned bundle is
 * intentionally a separate RoomTools operation so lock, CAS, and review policy
 * cannot be bypassed by a native, RocketRide, or LangChain worker.
 */
export function inspectRoomWorkflowCandidate(args: {
  request: NodeWorkflowRequest;
  result: NodeWorkflowResult<RoomWorkflowCandidate>;
  expectedAppCommit: string;
  expectedRoomId?: string;
  digestCandidate: (
    candidate: RoomWorkflowCandidate,
  ) => string | Promise<string>;
  now?: () => Date;
}): Promise<CandidateAdmission<RoomWorkflowCandidate>> {
  return inspectNodeWorkflowCandidate({
    request: args.request,
    result: args.result,
    expectedAppCommit: args.expectedAppCommit,
    digestCandidate: args.digestCandidate,
    now: args.now,
    expectedApp: "noderoom",
    validateCandidate: (candidate) => {
      const issues = validateRoomWorkflowCandidate(candidate);
      if (
        args.expectedRoomId &&
        candidate.kind === "semantic_conflict_resolution" &&
        candidate.packet.roomId !== args.expectedRoomId
      ) {
        issues.push(
          "NodeRoom semantic candidate crossed the expected room boundary.",
        );
      }
      return [...new Set(issues)];
    },
  });
}

export function validateRoomWorkflowCandidate(
  candidate: RoomWorkflowCandidate,
): string[] {
  if (candidate?.kind === "semantic_conflict_resolution") {
    return validateSemanticConflictCandidate(candidate);
  }
  if (candidate?.kind !== "algorithm_patch_bundle") {
    return ["NodeRoom candidate kind is unsupported."];
  }
  const issues: string[] = [];

  const bundle = candidate.bundle;
  if (bundle?.schema !== 1)
    issues.push("NodeRoom patch bundle schema is invalid.");
  if (bundle?.status !== "passed")
    issues.push("NodeRoom patch bundle did not pass its runner.");
  if (bundle?.commitPolicy !== "patch_bundle_only_runtime_must_cas") {
    issues.push(
      "NodeRoom patch bundle must preserve runtime-managed CAS authority.",
    );
  }
  if (!bundle?.proof?.deterministic)
    issues.push("NodeRoom patch bundle must be deterministic.");
  if (!bounded(bundle?.proof?.runnerVersion, 1, 160)) {
    issues.push("NodeRoom patch bundle runner version is invalid.");
  }
  if (
    !Number.isSafeInteger(bundle?.proof?.testsPassed) ||
    bundle.proof.testsPassed < 1
  ) {
    issues.push(
      "NodeRoom patch bundle must include passing deterministic tests.",
    );
  }
  if (!bounded(bundle?.algorithmId, 1, 160))
    issues.push("NodeRoom algorithm ID is invalid.");
  if (!bounded(bundle?.artifactHash, 1, 160))
    issues.push("NodeRoom artifact hash is invalid.");
  if (
    !Array.isArray(bundle?.patches) ||
    bundle.patches.length < 1 ||
    bundle.patches.length > 128
  ) {
    issues.push("NodeRoom patch bundle must contain 1 to 128 patches.");
    return issues;
  }

  const targets = new Set<string>();
  for (const patch of bundle.patches) {
    if (!bounded(patch.elementId, 1, 256))
      issues.push("NodeRoom patch target is invalid.");
    if (targets.has(patch.elementId))
      issues.push(`Duplicate NodeRoom patch target: ${patch.elementId}.`);
    targets.add(patch.elementId);
    if (!Number.isSafeInteger(patch.baseVersion) || patch.baseVersion < 0) {
      issues.push(
        `NodeRoom patch ${patch.elementId} has an invalid base version.`,
      );
    }
    if (patch.kind !== "set")
      issues.push(`NodeRoom patch ${patch.elementId} has an invalid kind.`);
  }

  const writeOps = bundle.writeLockedCellResultsArgs?.ops;
  if (!Array.isArray(writeOps) || writeOps.length !== bundle.patches.length) {
    issues.push(
      "NodeRoom managed-write arguments do not match the patch count.",
    );
  } else {
    for (const patch of bundle.patches) {
      const write = writeOps.find(
        (operation) => operation.elementId === patch.elementId,
      );
      if (
        !write ||
        write.baseVersion !== patch.baseVersion ||
        write.kind !== patch.kind
      ) {
        issues.push(
          `NodeRoom managed-write arguments do not match patch ${patch.elementId}.`,
        );
      } else {
        const expectedWrite = {
          elementId: patch.elementId,
          baseVersion: patch.baseVersion,
          value: patch.value.value,
          status: patch.value.status,
          confidence: patch.value.confidence,
          normalizedValue: patch.value.normalizedValue,
          formula: patch.value.formula,
          evidence: patch.value.evidence,
          kind: patch.kind,
        };
        if (
          canonicalNodeWorkflowJson(write) !==
          canonicalNodeWorkflowJson(expectedWrite)
        ) {
          issues.push(
            `NodeRoom managed-write payload does not match patch ${patch.elementId}.`,
          );
        }
      }
    }
  }

  const outputRefs = bundle.proof?.outputRefs;
  if (
    !Array.isArray(outputRefs) ||
    outputRefs.length !== bundle.patches.length
  ) {
    issues.push(
      "NodeRoom proof output references do not match the patch count.",
    );
  } else {
    for (const patch of bundle.patches) {
      const output = outputRefs.find(
        (reference) => reference.elementId === patch.elementId,
      );
      if (
        !output ||
        output.baseVersion !== patch.baseVersion ||
        output.expression !== patch.value.formula ||
        output.normalizedValue !== patch.value.normalizedValue
      ) {
        issues.push(
          `NodeRoom proof output does not match patch ${patch.elementId}.`,
        );
      }
    }
  }
  return [...new Set(issues)];
}

function validateSemanticConflictCandidate(
  candidate: RoomSemanticWorkflowCandidate,
): string[] {
  const issues: string[] = [];
  const packet = candidate.packet;
  if (!bounded(packet?.conflictId, 1, 256))
    issues.push("NodeRoom conflict ID is invalid.");
  if (!bounded(packet?.roomId, 1, 256))
    issues.push("NodeRoom conflict room ID is invalid.");
  if (!bounded(packet?.artifactId, 1, 256))
    issues.push("NodeRoom conflict artifact ID is invalid.");
  if (
    !Array.isArray(packet?.targetRefs) ||
    packet.targetRefs.length < 1 ||
    packet.targetRefs.length > 128
  ) {
    issues.push("NodeRoom conflict must contain 1 to 128 target references.");
  }
  if (!Array.isArray(packet?.proposed?.ops) || packet.proposed.ops.length < 1) {
    issues.push("NodeRoom conflict must contain proposed operations.");
  }
  if (packet?.status !== "needs_review" && packet?.status !== "open") {
    issues.push(
      "NodeRoom conflict candidate must still be open for application review.",
    );
  }

  const expected = resolveSemanticConflictPacket(packet);
  if (
    canonicalNodeWorkflowJson(candidate.resolution) !==
    canonicalNodeWorkflowJson(expected)
  ) {
    issues.push(
      "NodeRoom semantic resolution does not match the application-owned policy resolver.",
    );
  }
  if (
    candidate.resolution.classification.action === "commit_after_final_cas" &&
    !candidate.resolution.classification.requiredValidators.includes(
      "fresh_final_cas",
    )
  ) {
    issues.push(
      "NodeRoom semantic resolution omitted the final CAS validator.",
    );
  }
  if (
    candidate.resolution.resolvedOps.some(
      (operation) => operation.kind === "create_proposal",
    )
  ) {
    if (!candidate.resolution.reviewerNote.includes("final CAS")) {
      issues.push(
        "NodeRoom semantic proposal must preserve final CAS authority.",
      );
    }
  }
  return [...new Set(issues)];
}

function bounded(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= min &&
    value.length <= max
  );
}
