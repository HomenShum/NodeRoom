import { Component, useMemo, useRef, type ReactNode } from "react";
import type { NodeBookArtifact, NodeBookFailure, NodeBookMutationResult } from "@nodebook/contracts";
import { MAX_SURFACE_NODES, type NodeBookSurfaceRepository, type NodeBookSurfaceSnapshot } from "@nodebook/model";
import { NodeBookProvider, NodeBookSurface } from "@nodebook/react";
import "@nodebook/react/styles.css";

import type { Artifact } from "../engine/types";
import { useStore } from "../app/store";
import { decodeNodeBookVisualEnvelope, NODEBOOK_VISUAL_ELEMENT_ID } from "./visualArtifactEnvelope";

function failure(errorCode: string, message: string): NodeBookFailure {
  return { status: "forbidden", errorCode, message, retryable: false };
}

export function projectRoomArtifactsToNodeBook(roomId: string, artifacts: readonly Artifact[]): NodeBookSurfaceSnapshot {
  if (artifacts.length + 1 > MAX_SURFACE_NODES) throw new Error("ROOM_NODEBOOK_NODE_LIMIT");
  const foreignArtifact = artifacts.find((artifact) => artifact.roomId !== roomId);
  if (foreignArtifact) throw new Error(`ROOM_SCOPE_MISMATCH:${foreignArtifact.id}`);
  const rootId = `room:${roomId}`;
  const visualArtifacts: NodeBookArtifact[] = [];
  const visualIds = new Set<string>();
  for (const artifact of artifacts) {
    const element = artifact.elements[NODEBOOK_VISUAL_ELEMENT_ID];
    const decoded = decodeNodeBookVisualEnvelope(element?.value, { artifactId: artifact.id, title: artifact.title, version: element?.version ?? 0 });
    if (decoded.status !== "valid") continue;
    visualIds.add(artifact.id);
    visualArtifacts.push({
      workspaceId: roomId,
      rootId,
      artifactId: artifact.id,
      kind: decoded.artifact.kind,
      format: decoded.artifact.format,
      title: decoded.artifact.title,
      canonicalVersion: Math.max(1, decoded.artifact.version),
      contentHash: decoded.artifact.contentHash!,
      payload: decoded.artifact.payload,
    });
  }
  const ordered = [...artifacts].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  return {
    workspaceId: roomId,
    rootId,
    canonicalVersion: ordered.reduce((version, artifact) => Math.max(version, artifact.version), 0),
    nodes: [
      { id: rootId, version: 1, content: [{ type: "text", value: "Room NodeBook" }], accessMode: "read", isPublic: false },
      ...ordered.map((artifact) => ({
        id: artifact.id,
        version: Math.max(1, artifact.version),
        authorId: artifact.createdBy?.id,
        content: [{ type: "text" as const, value: artifact.title }],
        accessMode: "read" as const,
        isPublic: artifact.visibility === "public",
        artifactId: visualIds.has(artifact.id) ? artifact.id : undefined,
      })),
    ],
    relations: ordered.map((artifact, index) => ({
      id: `room-artifact:${artifact.id}`,
      version: 1,
      fromId: rootId,
      toId: artifact.id,
      relationTypeId: "contains",
      isPublic: artifact.visibility === "public",
      orderKey: String(index).padStart(6, "0"),
    })),
    artifacts: visualArtifacts,
  };
}

class NodeBookHostErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) return <div role="alert" data-nodebook-host-error>{`NodeBook preview unavailable: ${this.state.error.message.slice(0, 300)}`}</div>;
    return this.props.children;
  }
}

export function roomArtifactProjectionRevision(roomId: string, artifacts: readonly Artifact[]) {
  if (artifacts.length + 1 > MAX_SURFACE_NODES) return `${roomId}:overflow:${artifacts.length}`;
  let clock = 0;
  for (const artifact of artifacts) {
    const visual = artifact.elements[NODEBOOK_VISUAL_ELEMENT_ID];
    const envelope = visual?.value && typeof visual.value === "object" ? visual.value as Record<string, unknown> : undefined;
    clock = (clock + artifact.version + artifact.updatedAt + (visual?.version ?? 0)) % Number.MAX_SAFE_INTEGER;
    for (const value of [artifact.id, artifact.roomId, envelope?.contentHash]) {
      for (const character of String(value ?? "")) clock = (Math.imul(clock, 31) + character.charCodeAt(0)) >>> 0;
    }
  }
  return `${roomId}:${artifacts.length}:${clock}`;
}

type RoomArtifactFingerprint = readonly [string, string, string, number, number, string, string, number, unknown, unknown, unknown, unknown, unknown];
type RoomArtifactProjectionCacheBase = { roomId: string; fingerprints: readonly RoomArtifactFingerprint[] };
export type RoomArtifactProjectionCache = RoomArtifactProjectionCacheBase & (
  | { status: "ready"; snapshot: NodeBookSurfaceSnapshot }
  | { status: "error"; error: Error }
);

function fingerprint(artifact: Artifact): RoomArtifactFingerprint {
  const visual = artifact.elements[NODEBOOK_VISUAL_ELEMENT_ID];
  const envelope = visual?.value && typeof visual.value === "object" ? visual.value as Record<string, unknown> : undefined;
  return [artifact.id, artifact.roomId, artifact.title, artifact.version, artifact.updatedAt, artifact.visibility ?? "", artifact.createdBy?.id ?? "", visual?.version ?? -1, envelope?.schemaVersion, envelope?.kind, envelope?.format, envelope?.contentHash, envelope?.payload];
}

function sameFingerprint(saved: RoomArtifactFingerprint, artifact: Artifact) {
  const current = fingerprint(artifact);
  return saved.every((value, index) => value === current[index]);
}

export function updateRoomArtifactProjectionCache(cache: RoomArtifactProjectionCache | undefined, roomId: string, artifacts: readonly Artifact[]) {
  if (cache?.roomId === roomId && cache.fingerprints.length === artifacts.length && artifacts.every((artifact, index) => sameFingerprint(cache.fingerprints[index]!, artifact))) return cache;
  const fingerprints = artifacts.map(fingerprint);
  try {
    return { status: "ready" as const, roomId, fingerprints, snapshot: projectRoomArtifactsToNodeBook(roomId, artifacts) };
  } catch (error) {
    return { status: "error" as const, roomId, fingerprints, error: error instanceof Error ? error : new Error("ROOM_NODEBOOK_PROJECTION_FAILED") };
  }
}

function NodeRoomNodeBookWorkspaceSurfaceInner({ roomId, onOpenArtifact, artifacts, snapshot }: { roomId: string; onOpenArtifact(id: string): void; artifacts: readonly Artifact[]; snapshot: NodeBookSurfaceSnapshot }) {
  const repository = useMemo<NodeBookSurfaceRepository>(() => ({
    async loadSurface(input) {
      if (input.workspaceId !== roomId || input.rootId !== snapshot.rootId) return failure("ROOM_SCOPE_MISMATCH", "The requested NodeBook surface does not belong to this room.");
      return snapshot;
    },
    subscribeSurface() { return () => {}; },
    async applySurfaceTransaction(): Promise<NodeBookMutationResult> {
      return failure("ROOM_NODEBOOK_READ_ONLY", "Open the artifact in NodeRoom to edit through its CAS and review workflow.");
    },
  }), [roomId, snapshot]);

  return (
    <div data-nodebook-host="noderoom-workspace" data-nodebook-workspace-id={roomId} onDoubleClick={(event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      const artifactId = button?.dataset.nodebookNodeId;
      if (artifactId && artifacts.some((artifact) => artifact.id === artifactId && artifact.roomId === roomId)) onOpenArtifact(artifactId);
    }}>
      <NodeBookProvider scope={{ workspaceId: roomId, rootId: snapshot.rootId }} repository={repository} initialSnapshot={snapshot}>
        <NodeBookSurface />
      </NodeBookProvider>
    </div>
  );
}

export function NodeRoomNodeBookWorkspaceSurface(props: { roomId: string; onOpenArtifact(id: string): void }) {
  const artifacts = useStore().listArtifacts(props.roomId);
  return <NodeRoomNodeBookWorkspaceSurfaceFromArtifacts {...props} artifacts={artifacts} />;
}

export function NodeRoomNodeBookWorkspaceSurfaceFromArtifacts(props: { roomId: string; onOpenArtifact(id: string): void; artifacts: readonly Artifact[] }) {
  const projection = useRef<RoomArtifactProjectionCache | undefined>(undefined);
  const revision = useRef(0);
  const next = updateRoomArtifactProjectionCache(projection.current, props.roomId, props.artifacts);
  if (next !== projection.current) revision.current += 1;
  projection.current = next;
  if (next.status === "error") return <div role="alert" data-nodebook-host-error>{`NodeBook preview unavailable: ${next.error.message.slice(0, 300)}`}</div>;
  return <NodeBookHostErrorBoundary resetKey={`${props.roomId}:${revision.current}`}><NodeRoomNodeBookWorkspaceSurfaceInner {...props} snapshot={next.snapshot} /></NodeBookHostErrorBoundary>;
}
