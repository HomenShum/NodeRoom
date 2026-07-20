import { runAgent } from "../../nodeagent/core/runtime";
import type {
  AgentResult,
  AgentTool,
  RoomTools,
} from "../../nodeagent/core/types";

/**
 * The deck-shaped runtime port agreed in NodeSlide's ecosystem contract.
 *
 * This is intentionally structural while `@nodeslide/agent` is unpublished:
 * NodeRoom can compile and exercise the adapter against its real NodeAgent
 * types without copying a model loop, auth implementation, or backend.
 */
export type NodeSlideDeckEditOutcome =
  | { ok: true; version: number }
  | { ok: false; conflict: true; expected: number; actual: number }
  | { ok: false; locked: true; holder: string }
  | { ok: false; pendingApproval: true; proposalId?: string }
  | { ok: false; invalid: true; findings: string[] };

export interface NodeSlideRoomTools {
  snapshot(): Promise<{ deckId: string; version: number; slides: unknown[] }>;
  readRange(args: { slideId: string; region?: string }): Promise<unknown>;
  proposeLock(args: { slideId: string }): Promise<{ ok: boolean; holder?: string }>;
  releaseLock(args: { slideId: string }): Promise<void>;
  applyDeckPatch(args: {
    patch: unknown;
    expectedVersion: number;
  }): Promise<NodeSlideDeckEditOutcome>;
  say(text: string): Promise<void>;
  renderSlidePreview?(args: { slideId: string }): Promise<{ pngDigest: string }>;
  runDeckCI?(): Promise<{ ok: boolean; findings: string[] }>;
  exportPptx?(): Promise<{ artifactId: string; sha256: string }>;
}

export interface NodeSlideAgentTool<RT extends NodeSlideRoomTools = NodeSlideRoomTools> {
  name: string;
  description: string;
  schema: AgentTool["schema"];
  execute(args: unknown, rt: RT): Promise<unknown>;
}

export type NodeSlideToolClass = "query" | "mutation";

/** Portable NodeSlide tool pack consumed by NodeRoom's existing NodeAgent loop. */
export interface NodeSlideAgentAdapter<RT extends NodeSlideRoomTools = NodeSlideRoomTools> {
  rt: RT;
  tools: readonly NodeSlideAgentTool<RT>[];
  systemPrompt: string;
  toolClasses: Readonly<Record<string, NodeSlideToolClass>>;
}

export interface BoundNodeSlideAgentAdapter {
  tools: AgentTool[];
  toolClasses: Readonly<Record<string, NodeSlideToolClass>>;
}

function validateAdapter<RT extends NodeSlideRoomTools>(
  adapter: NodeSlideAgentAdapter<RT>,
  hostTools: readonly AgentTool[],
): void {
  const hostNames = new Set(hostTools.map((tool) => tool.name));
  const adapterNames = new Set<string>();

  for (const tool of adapter.tools) {
    if (!tool.name.trim()) throw new Error("NodeSlide tools require a non-empty name.");
    if (adapterNames.has(tool.name)) {
      throw new Error(`NodeSlide tool name is duplicated: ${tool.name}.`);
    }
    if (hostNames.has(tool.name)) {
      throw new Error(`NodeSlide tool collides with a NodeRoom tool: ${tool.name}.`);
    }
    const toolClass = adapter.toolClasses[tool.name];
    if (!toolClass) {
      throw new Error(`NodeSlide tool classification is missing: ${tool.name}.`);
    }
    if (toolClass !== "query" && toolClass !== "mutation") {
      throw new Error(`NodeSlide tool classification is invalid: ${tool.name}.`);
    }
    adapterNames.add(tool.name);
  }

  for (const toolName of Object.keys(adapter.toolClasses)) {
    if (!adapterNames.has(toolName)) {
      throw new Error(`NodeSlide tool classification has no matching tool: ${toolName}.`);
    }
  }
}

/**
 * Bind deck tools to NodeAgent's concrete `AgentTool` shape.
 *
 * The wrapper only projects the NodeSlide runtime port. Execution, budgets,
 * provider routing, hooks, traces, and stop reasons remain owned by NodeAgent.
 */
export function bindNodeSlideAgentAdapter<RT extends NodeSlideRoomTools>(
  adapter: NodeSlideAgentAdapter<RT>,
  hostTools: readonly AgentTool[] = [],
): BoundNodeSlideAgentAdapter {
  validateAdapter(adapter, hostTools);
  const deckTools: AgentTool[] = adapter.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    execute: (args: unknown, _roomTools: RoomTools) => tool.execute(args, adapter.rt),
  }));

  return {
    tools: [...hostTools, ...deckTools],
    toolClasses: { ...adapter.toolClasses },
  };
}

export type RunNodeSlideWithNodeAgentInput<
  RT extends NodeSlideRoomTools = NodeSlideRoomTools,
> = Omit<
  Parameters<typeof runAgent>[0],
  "tools" | "systemPrompt"
> & {
  adapter: NodeSlideAgentAdapter<RT>;
  hostTools?: readonly AgentTool[];
};

/** Run a NodeSlide tool pack through NodeRoom's canonical NodeAgent runtime. */
export async function runNodeSlideWithNodeAgent<RT extends NodeSlideRoomTools>(
  input: RunNodeSlideWithNodeAgentInput<RT>,
): Promise<AgentResult> {
  const { adapter, hostTools = [], ...runtime } = input;
  const bound = bindNodeSlideAgentAdapter(adapter, hostTools);
  return runAgent({
    ...runtime,
    tools: bound.tools,
    systemPrompt: adapter.systemPrompt,
  });
}
