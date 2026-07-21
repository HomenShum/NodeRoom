import { NodeSlideStudioShell, type NodeSlideStudioShellActions } from "@nodeslide/react";
import type { NodeSlidePatchCommand, NodeSlideProposalDecision } from "@nodeslide/backend";
import type { DeckPatch, DeckSnapshot } from "@nodeslide/contracts";
import type { ReactNode } from "react";

export const NODEROOM_NODESLIDE_PACKAGE_VERSION = "0.2.2" as const;

export interface NodeRoomNodeSlideStudioMountProps {
  snapshot: DeckSnapshot;
  selection: { slideId: string | null; elementIds: readonly string[] };
  isHost: boolean;
  proposal?: DeckPatch | null;
  pendingDecision?: NodeSlideProposalDecision | null;
  busy?: boolean;
  error?: string | null;
  onSelectionChange(selection: { slideId: string | null; elementIds: readonly string[] }): void;
  onPatch(command: NodeSlidePatchCommand): void;
  onPropose(command: NodeSlidePatchCommand): void;
  onAccept(proposalId: string): void;
  onReject(proposalId: string): void;
  onExport(): void;
  children(actions: NodeSlideStudioShellActions): ReactNode;
}

/**
 * Literal package mount for NodeRoom's richer deck workbench. NodeSlide owns
 * controlled selection and command gating; NodeRoom keeps identity, storage,
 * authorization, CAS, and the rendered product surface.
 */
export function NodeRoomNodeSlideStudioMount({
  snapshot,
  selection,
  isHost,
  proposal = null,
  pendingDecision = null,
  busy = false,
  error = null,
  onSelectionChange,
  onPatch,
  onPropose,
  onAccept,
  onReject,
  onExport,
  children,
}: NodeRoomNodeSlideStudioMountProps) {
  return (
    <NodeSlideStudioShell
      snapshot={snapshot}
      selection={selection}
      proposal={proposal}
      permissions={{
        canRead: true,
        canPropose: true,
        canPatch: isHost,
        canApprove: isHost,
        canExport: true,
      }}
      onSelectionChange={onSelectionChange}
      onPatch={onPatch}
      onPropose={onPropose}
      onAccept={onAccept}
      onReject={onReject}
      onExport={onExport}
      pendingDecision={pendingDecision}
      disabled={busy}
      error={error}
      renderSurface={(actions) => (
        <section
          aria-busy={busy}
          aria-label="NodeSlide studio mounted in NodeRoom"
          data-nodeslide-authority="noderoom-artifact-cas"
          data-nodeslide-package-version={NODEROOM_NODESLIDE_PACKAGE_VERSION}
          data-nodeslide-surface="noderoom-deck-storyboard"
        >
          {error ? <div role="alert" data-testid="nodeslide-mounted-error">{error}</div> : null}
          {children(actions)}
        </section>
      )}
    />
  );
}
