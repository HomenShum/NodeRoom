import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  ROOM_TOOLS,
  lastVersions,
  model as realModel,
  runAgent,
  scriptedModel,
  type AgentMessage,
  type AgentModel,
} from "../src/nodeagent/index";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";

const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };
const DEFAULT_JSON_OUT = "docs/eval/managed-lock-performance.json";

function parse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function committedByManagedBatch(messages: AgentMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.role !== "tool" || m.toolName !== "write_locked_cells") continue;
    const result = parse(m.content);
    if (!result?.ok && !result?.drafted) continue;
    const call = messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === m.toolCallId);
    const ops = call?.args.ops;
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      const elementId = (op as { elementId?: unknown }).elementId;
      if (elementId) out.add(String(elementId));
    }
  }
  return out;
}

function managedBatchVariancePlan(targets: Record<string, string>) {
  const ids = Object.keys(targets);
  return ({ messages }: { messages: AgentMessage[] }) => {
    const versions = lastVersions(messages);
    if (!ids.every((id) => versions[id] !== undefined)) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };
    }
    const committed = committedByManagedBatch(messages);
    const missing = ids.filter((id) => !committed.has(id));
    if (missing.length) {
      return {
        toolCalls: [{
          tool: "write_locked_cells",
          args: {
            reason: "managed variance write",
            ops: missing.map((id) => ({ elementId: id, value: targets[id], baseVersion: versions[id] })),
          },
        }],
      };
    }
    return { say: "Variance cells written through runtime-managed locking.", done: true };
  };
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function runCase(args: {
  lane: "explicit_agent_lock" | "runtime_managed_lock";
  agent: AgentModel;
  real: boolean;
}) {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  const t0 = Date.now();
  const result = await runAgent({
    rt,
    goal: args.real
      ? "Set r_rev__variance to +24% and r_cogs__variance to +27.5%. Use the available tools and stop when both cells are written."
      : "Set Revenue and COGS variance cells.",
    model: args.agent,
    tools: args.lane === "explicit_agent_lock" ? ROOM_TOOLS : PRODUCTION_ROOM_TOOLS,
    systemPrompt: args.lane === "runtime_managed_lock" ? MANAGED_LOCK_SYSTEM_PROMPT : undefined,
    maxSteps: args.real ? 12 : 10,
    deadlineAt: args.real ? Date.now() + 180_000 : undefined,
    reserveMs: 10_000,
  });
  const elapsedMs = Date.now() - t0;
  const artifact = engine.getArtifact(d.sheetId);
  const traceTools = result.trace.map((event) => event.tool);
  const coordinationToolCalls = traceTools.filter((tool) => tool === "propose_lock" || tool === "release_lock").length;
  const managedBatchCalls = traceTools.filter((tool) => tool === "write_locked_cells" || tool === "write_locked_cell_results").length;
  const valuesOk = Object.entries(TARGETS).every(([id, value]) => artifact?.elements[id]?.value === value);
  const released = Object.keys(TARGETS).every((id) => !engine.lockFor(d.sheetId, id));
  const coordinationEvidence = result.trace
    .filter((event) => event.tool.startsWith("write_locked_cell"))
    .map((event) => (event.result as { coordination?: unknown })?.coordination)
    .filter(Boolean);

  return {
    lane: args.lane,
    status: valuesOk && released && !result.exhausted ? "passed" : "failed",
    elapsedMs,
    modelName: args.agent.name,
    modelCalls: result.usage.modelCalls,
    agentToolCalls: result.trace.length,
    coordinationToolCalls,
    managedBatchCalls,
    traceTools,
    valuesOk,
    released,
    exhausted: result.exhausted,
    stopReason: result.stopReason,
    usage: result.usage,
    coordinationEvidence,
  };
}

async function main() {
  const realRoute = optionValue("--real");
  const jsonOut = optionValue("--json-out") ?? DEFAULT_JSON_OUT;
  const real = Boolean(realRoute);
  const explicitAgent = real
    ? realModel(realRoute!, { operatorSelected: true })
    : scriptedModel(recomputeVariancePlan(TARGETS, { lock: true }), "scripted-explicit-lock");
  const managedAgent = real
    ? realModel(realRoute!, { operatorSelected: true })
    : scriptedModel(managedBatchVariancePlan(TARGETS), "scripted-managed-lock");

  const explicit = await runCase({ lane: "explicit_agent_lock", agent: explicitAgent, real });
  const managed = await runCase({ lane: "runtime_managed_lock", agent: managedAgent, real });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: real ? "live_provider" : "deterministic_runtime",
    route: realRoute ?? "scripted",
    caseId: "managed-lock-production-target-v1",
    explicit,
    managed,
    delta: {
      modelCallsSaved: explicit.modelCalls - managed.modelCalls,
      agentToolCallsSaved: explicit.agentToolCalls - managed.agentToolCalls,
      coordinationToolCallsRemovedFromModelTrace: explicit.coordinationToolCalls - managed.coordinationToolCalls,
      agentToolCallReductionPct: explicit.agentToolCalls
        ? Number((((explicit.agentToolCalls - managed.agentToolCalls) / explicit.agentToolCalls) * 100).toFixed(1))
        : 0,
    },
    lesson: {
      giveAgent: ["business intent", "target cells", "values/formulas/evidence", "base versions from reads"],
      takeAwayFromAgent: ["lock acquisition", "unlock sequencing", "range coordination", "draft-on-blocked mechanics", "release-in-finally cleanup"],
      invariant: "The model-visible trace has fewer coordination calls, while the runtime result still carries lock coordination evidence and the room ends with no active locks.",
    },
  };

  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`managed-lock ${report.mode} ${explicit.status}/${managed.status}`);
  console.log(`explicit: modelCalls=${explicit.modelCalls} agentToolCalls=${explicit.agentToolCalls} coordinationCalls=${explicit.coordinationToolCalls} tools=${explicit.traceTools.join(" -> ")}`);
  console.log(`managed:  modelCalls=${managed.modelCalls} agentToolCalls=${managed.agentToolCalls} coordinationCalls=${managed.coordinationToolCalls} tools=${managed.traceTools.join(" -> ")}`);
  console.log(`delta: modelCallsSaved=${report.delta.modelCallsSaved} agentToolCallsSaved=${report.delta.agentToolCallsSaved} reduction=${report.delta.agentToolCallReductionPct}%`);
  console.log(`wrote ${jsonOut}`);
  if (hasFlag("--strict") && (explicit.status !== "passed" || managed.status !== "passed")) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
