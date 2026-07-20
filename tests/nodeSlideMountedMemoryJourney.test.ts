import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor, Artifact } from "../src/engine/types";
import {
  NodeRoomArtifactNodeSlideRepository,
  nodeRoomNodeSlidePrincipalForMember,
} from "../src/integrations/nodeslide/nodeRoomArtifactRepository";
import {
  runNodeSlideWithNodeAgent,
  type NodeSlideAgentAdapter,
  type NodeSlideRoomTools,
} from "../src/integrations/nodeslide/nodeAgentAdapter";
import type { AgentModel } from "../src/nodeagent/core/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import {
  nodeSlideClaimElementId,
  translateNodeRoomArtifactToNodeSlide,
  type NodeRoomNodeSlidePatchCommand,
} from "../src/integrations/nodeslide/storyboardTranslation";
import {
  buildDeckPptxExport,
  buildDeckStoryboardFromRoom,
  collaborativeDeckArtifactInput,
  readCollaborativeDeckArtifact,
} from "../src/ui/workArtifacts";

function sourceArtifact(roomId: string, actor: Actor): Artifact {
  return {
    id: "source:research",
    roomId,
    kind: "sheet",
    title: "Company research",
    version: 1,
    elements: {
      A1: { id: "A1", version: 1, value: "CardioNova", updatedAt: 1, updatedBy: actor },
    },
    order: ["A1"],
    updatedAt: 1,
  };
}

function replaceClaimCommand(args: {
  deckId: string;
  deckVersion: number;
  slideId: string;
  slideVersion: number;
  elementId: string;
  elementVersion: number;
  id: string;
  text: string;
  source?: "human" | "agent";
}): NodeRoomNodeSlidePatchCommand {
  return {
    id: args.id,
    deckId: args.deckId,
    baseDeckVersion: args.deckVersion,
    baseSlideVersions: { [args.slideId]: args.slideVersion },
    baseElementVersions: { [args.elementId]: args.elementVersion },
    scope: { kind: "elements", deckId: args.deckId, slideIds: [args.slideId], elementIds: [args.elementId], operationMode: "copy" },
    operations: [{ op: "replace_text", slideId: args.slideId, elementId: args.elementId, text: args.text }],
    source: args.source ?? "human",
    summary: args.text,
    traceId: `trace:${args.id}`,
  };
}

describe("mounted NodeSlide lifecycle on NodeRoom memory authority", () => {
  it("proves principal, manual CAS, proposal review/stale/reload, presenter export/reopen, and credential-free receipts", async () => {
    let now = 1_800_000_000_000;
    const engine = new RoomEngine({ now: () => ++now });
    const { room, host } = engine.createRoom({ title: "Mounted deck proof", hostName: "Maya", autoAllow: false });
    const joined = engine.joinRoom({ code: room.code, name: "Riley", anon: false });
    if (!joined) throw new Error("member join failed");
    const hostActor: Actor = { kind: "user", id: host.id, name: host.name };
    const source = sourceArtifact(room.id, hostActor);
    const storyboard = buildDeckStoryboardFromRoom({ roomId: room.id, roomTitle: room.title, artifacts: [source] });
    const input = collaborativeDeckArtifactInput(storyboard);
    const deck = engine.createArtifact({ roomId: room.id, kind: input.kind, title: input.title, seed: input.seed, meta: input.meta, by: hostActor, visibility: "room" });
    const principal = nodeRoomNodeSlidePrincipalForMember(host);
    const repository = new NodeRoomArtifactNodeSlideRepository({ engine, roomId: room.id, actor: hostActor, now: () => ++now });

    const initial = await repository.getDeck({ deckId: deck.id, principal });
    if (!initial) throw new Error("mounted deck missing");
    const slide = initial.slides[0];
    const claim = initial.elements.find((element) => element.id === nodeSlideClaimElementId(storyboard.slides[0].claims[0].claimId));
    if (!claim) throw new Error("mounted claim missing");
    const manual = replaceClaimCommand({ deckId: deck.id, deckVersion: initial.deck.version, slideId: slide.id, slideVersion: slide.version, elementId: claim.id, elementVersion: claim.version, id: "patch:manual", text: "Host manual edit" });
    const applied = await repository.applyPatch({ deckId: deck.id, principal, patch: manual });
    expect(applied.snapshot.elements.find((element) => element.id === claim.id)?.content).toBe("Host manual edit");
    expect(applied.receipt.authorization.evidence).toEqual({ issuer: "noderoom", policyId: "noderoom.nodeslide.artifact-authority", policyVersion: "1" });

    let nodeAgentProposalId: string | undefined;
    const mountedRuntime: NodeSlideRoomTools = {
      async snapshot() {
        const snapshot = await repository.getDeck({ deckId: deck.id, principal });
        if (!snapshot) throw new Error("mounted deck missing");
        return { deckId: snapshot.deck.id, version: snapshot.deck.version, slides: snapshot.slides };
      },
      async readRange() {
        const snapshot = await repository.getDeck({ deckId: deck.id, principal });
        return snapshot?.elements.find((element) => element.id === claim.id) ?? null;
      },
      async proposeLock() { return { ok: true }; },
      async releaseLock() {},
      async applyDeckPatch({ patch }) {
        const proposal = await repository.createProposal({
          deckId: deck.id,
          principal,
          patch: patch as NodeRoomNodeSlidePatchCommand,
        });
        nodeAgentProposalId = proposal.id;
        return { ok: false, pendingApproval: true, proposalId: proposal.id };
      },
      async say() {},
    };
    const nodeAgentPatch = replaceClaimCommand({
      deckId: deck.id,
      deckVersion: applied.snapshot.deck.version,
      slideId: applied.snapshot.slides[0].id,
      slideVersion: applied.snapshot.slides[0].version,
      elementId: claim.id,
      elementVersion: applied.snapshot.elements.find((element) => element.id === claim.id)!.version,
      id: "patch:nodeagent",
      text: "NodeAgent mounted proposal",
      source: "agent",
    });
    const adapter = {
      rt: mountedRuntime,
      tools: [{
        name: "nodeslide_propose_patch",
        description: "Propose one governed patch against the mounted NodeRoom deck.",
        schema: z.object({}),
        execute: async (_args: unknown, rt: NodeSlideRoomTools) =>
          rt.applyDeckPatch({ patch: nodeAgentPatch, expectedVersion: nodeAgentPatch.baseDeckVersion }),
      }],
      systemPrompt: "Use the mounted NodeSlide proposal tool and leave acceptance to the host.",
      toolClasses: { nodeslide_propose_patch: "mutation" },
    } satisfies NodeSlideAgentAdapter;
    let agentTurn = 0;
    const model: AgentModel = {
      name: "mounted-nodeslide-proof",
      async next() {
        agentTurn += 1;
        return agentTurn === 1
          ? { toolCalls: [{ id: "call:mounted:1", tool: "nodeslide_propose_patch", args: {} }], done: false }
          : { text: "The mounted proposal is ready for host review.", toolCalls: [], done: true };
      },
    };
    const agentResult = await runNodeSlideWithNodeAgent({
      adapter,
      rt: new InMemoryRoomTools(engine, room.id, deck.id, hostActor, "session:nodeslide"),
      goal: "Propose one reviewed claim change on the mounted deck.",
      model,
      maxSteps: 2,
    });
    expect(agentResult).toMatchObject({ stopReason: "done", steps: 2 });
    expect(agentResult.trace[0]).toMatchObject({
      tool: "nodeslide_propose_patch",
      result: { ok: false, pendingApproval: true },
    });
    if (!nodeAgentProposalId) throw new Error("NodeAgent proposal missing");
    expect((await repository.resolveProposal({
      deckId: deck.id,
      principal,
      proposalId: nodeAgentProposalId,
      decision: "accept",
    })).status).toBe("accepted");

    const afterNodeAgent = await repository.getDeck({ deckId: deck.id, principal });
    if (!afterNodeAgent) throw new Error("mounted deck missing after NodeAgent proposal");
    const currentClaim = afterNodeAgent.elements.find((element) => element.id === claim.id)!;
    const candidateA = replaceClaimCommand({ deckId: deck.id, deckVersion: afterNodeAgent.deck.version, slideId: slide.id, slideVersion: afterNodeAgent.slides[0].version, elementId: claim.id, elementVersion: currentClaim.version, id: "patch:agent-a", text: "NodeAgent reviewed proposal", source: "agent" });
    const candidateB = replaceClaimCommand({ deckId: deck.id, deckVersion: afterNodeAgent.deck.version, slideId: slide.id, slideVersion: afterNodeAgent.slides[0].version, elementId: claim.id, elementVersion: currentClaim.version, id: "patch:agent-b", text: "Competing stale proposal", source: "agent" });
    const proposalA = await repository.createProposal({ deckId: deck.id, principal, patch: candidateA });
    const proposalB = await repository.createProposal({ deckId: deck.id, principal, patch: candidateB });
    const accepted = await repository.resolveProposal({ deckId: deck.id, principal, proposalId: proposalA.id, decision: "accept" });
    expect(accepted.status).toBe("accepted");
    const stale = await repository.resolveProposal({ deckId: deck.id, principal, proposalId: proposalB.id, decision: "accept" });
    expect(stale.status).toBe("stale");
    expect(stale.snapshot.elements.find((element) => element.id === claim.id)?.content).toBe("NodeAgent reviewed proposal");

    const reloadedRepository = new NodeRoomArtifactNodeSlideRepository({ engine, roomId: room.id, actor: hostActor, now: () => ++now });
    const reloaded = await reloadedRepository.getDeck({ deckId: deck.id, principal });
    expect(reloaded?.elements.find((element) => element.id === claim.id)?.content).toBe("NodeAgent reviewed proposal");

    const stored = readCollaborativeDeckArtifact(engine.getArtifact(deck.id)!);
    if (!stored) throw new Error("stored storyboard missing");
    const pptx = await buildDeckPptxExport(stored.storyboard, 0);
    const reopened = await JSZip.loadAsync(pptx.bytes);
    expect(reopened.file("ppt/presentation.xml")).toBeTruthy();
    expect(pptx.slideCount).toBe(stored.storyboard.slides.length);
    expect(translateNodeRoomArtifactToNodeSlide(engine.getArtifact(deck.id)!).snapshot).toEqual(reloaded);

    const receipts = engine.listTraces(room.id).filter((trace) => trace.type === "nodeslide_receipt");
    expect(receipts.length).toBeGreaterThanOrEqual(5);
    expect(receipts.map((trace) => trace.detail).join("\n")).not.toMatch(/actorProof|requester|token/i);

    const memberRepository = new NodeRoomArtifactNodeSlideRepository({
      engine,
      roomId: room.id,
      actor: { kind: "user", id: joined.member.id, name: joined.member.name },
      now: () => ++now,
    });
    await expect(memberRepository.applyPatch({ deckId: deck.id, principal: nodeRoomNodeSlidePrincipalForMember(joined.member), patch: candidateA })).rejects.toThrow("nodeslide_host_required");
  });
});
