import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  bindNodeSlideAgentAdapter,
  runNodeSlideWithNodeAgent,
  type NodeSlideAgentAdapter,
  type NodeSlideRoomTools,
} from "../src/integrations/nodeslide/nodeAgentAdapter";
import type { AgentModel, AgentTool } from "../src/nodeagent/core/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";

function createNodeRoomTools() {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  return new InMemoryRoomTools(
    engine,
    demo.roomId,
    demo.sheetId,
    demo.agents.room,
    demo.sessions.room,
  );
}

function createDeckRuntime() {
  let version = 1;
  let proposedText: string | undefined;
  const runtime: NodeSlideRoomTools = {
    async snapshot() {
      return { deckId: "deck:test", version, slides: [{ id: "slide:1" }] };
    },
    async readRange() {
      return { text: proposedText ?? "Before" };
    },
    async proposeLock() {
      return { ok: true };
    },
    async releaseLock() {},
    async applyDeckPatch({ patch, expectedVersion }) {
      if (expectedVersion !== version) {
        return { ok: false, conflict: true, expected: expectedVersion, actual: version };
      }
      proposedText = (patch as { text?: string }).text;
      return { ok: false, pendingApproval: true, proposalId: "proposal:test" };
    },
    async say() {},
  };
  return {
    runtime,
    proposedText: () => proposedText,
    accept: () => {
      version += 1;
    },
    version: () => version,
  };
}

describe("NodeSlide adapter for NodeRoom's NodeAgent runtime", () => {
  it("runs a deck proposal through the real NodeAgent loop without a second runtime", async () => {
    const deck = createDeckRuntime();
    const adapter = {
      rt: deck.runtime,
      tools: [
        {
          name: "nodeslide_propose_text",
          description: "Propose a reviewed NodeSlide text replacement.",
          schema: z.object({ text: z.string().min(1) }),
          async execute(args: unknown, rt: NodeSlideRoomTools) {
            const { text } = args as { text: string };
            const snapshot = await rt.snapshot();
            return rt.applyDeckPatch({ patch: { text }, expectedVersion: snapshot.version });
          },
        },
      ],
      systemPrompt: "Use NodeSlide tools. Leave mutations unapplied for host review.",
      toolClasses: { nodeslide_propose_text: "mutation" },
    } satisfies NodeSlideAgentAdapter;
    let turn = 0;
    const model: AgentModel = {
      name: "nodeslide-scripted-proof",
      async next() {
        turn += 1;
        if (turn === 1) {
          return {
            toolCalls: [
              {
                id: "call:nodeslide:1",
                tool: "nodeslide_propose_text",
                args: { text: "Proposed by NodeAgent" },
              },
            ],
            done: false,
          };
        }
        return { text: "Proposal is ready for review.", toolCalls: [], done: true };
      },
    };

    const result = await runNodeSlideWithNodeAgent({
      adapter,
      rt: createNodeRoomTools(),
      goal: "Propose a reviewed title change for this deck.",
      model,
      maxSteps: 2,
    });

    expect(result.stopReason).toBe("done");
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      tool: "nodeslide_propose_text",
      result: { ok: false, pendingApproval: true, proposalId: "proposal:test" },
    });
    expect(deck.proposedText()).toBe("Proposed by NodeAgent");
    expect(deck.version()).toBe(1);
    deck.accept();
    expect(deck.version()).toBe(2);
  });

  it("fails closed on unclassified tools and NodeRoom name collisions", () => {
    const deck = createDeckRuntime();
    const deckTool = {
      name: "shared_name",
      description: "Collision fixture.",
      schema: z.object({}),
      async execute(_args: unknown, _rt: NodeSlideRoomTools) {
        return { ok: true };
      },
    };
    const hostTool: AgentTool = {
      ...deckTool,
      async execute() {
        return { ok: true };
      },
    };
    const adapter: NodeSlideAgentAdapter = {
      rt: deck.runtime,
      tools: [deckTool],
      systemPrompt: "test",
      toolClasses: {},
    };

    expect(() => bindNodeSlideAgentAdapter(adapter)).toThrow("classification is missing");
    expect(() =>
      bindNodeSlideAgentAdapter(
        { ...adapter, toolClasses: { shared_name: "query" } },
        [hostTool],
      ),
    ).toThrow("collides with a NodeRoom tool");
  });
});
