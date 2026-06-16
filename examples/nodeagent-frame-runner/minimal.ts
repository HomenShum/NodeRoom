import { RoomEngine } from "../../src/engine/roomEngine";
import { buildDemoRoom } from "../../src/engine/demoRoom";
import { runReasoningFrame } from "../../src/nodeagent/core/frameRunner";
import type { ReasoningFrame } from "../../src/nodeagent/core/reasoningFrames";
import type { AgentMessage } from "../../src/nodeagent/core/types";
import { scriptedModel, lastVersions } from "../../src/nodeagent/models/scripted";
import { InMemoryRoomTools } from "../../src/nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../../src/nodeagent/skills/spreadsheet/cellMutator";

const TARGET_CELL = "r_gp__note";
const TARGET_VALUE = "Frame smoke proof: managed by NodeAgent.";

export interface MinimalFrameSmokeReport {
  ok: boolean;
  frameId: string;
  status: string;
  stopReason: string;
  steps: number;
  allowedToolNames: string[];
  missingToolNames: string[];
  traceTools: string[];
  changedArtifacts: string[];
  verificationReason: string;
  finalCellValue: unknown;
}

export async function runMinimalNodeAgentFrameSmoke(): Promise<MinimalFrameSmokeReport> {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
  const frame = minimalFrame();

  const receipt = await runReasoningFrame({
    rt,
    frame,
    model: scriptedModel(frameWritePlan, "minimal-nodeagent-frame"),
    tools: ROOM_TOOLS,
    maxSteps: 6,
    includeRoomContext: true,
  });

  const finalCellValue = engine.getArtifact(demo.sheetId)?.elements[TARGET_CELL]?.value;
  const report: MinimalFrameSmokeReport = {
    ok: receipt.status === "completed" && finalCellValue === TARGET_VALUE && receipt.missingToolNames.length === 0,
    frameId: receipt.frameId,
    status: receipt.status,
    stopReason: receipt.agentResult.stopReason,
    steps: receipt.agentResult.steps,
    allowedToolNames: receipt.allowedToolNames,
    missingToolNames: receipt.missingToolNames,
    traceTools: receipt.agentResult.trace.map((event) => event.tool),
    changedArtifacts: receipt.stateDelta.changedArtifacts,
    verificationReason: receipt.verification.reason,
    finalCellValue,
  };

  if (!report.ok) {
    throw new Error(`Minimal NodeAgent frame smoke failed: ${JSON.stringify(report)}`);
  }
  return report;
}

function minimalFrame(): ReasoningFrame {
  return {
    frameId: "rf_adopt_minimal_write_note",
    goal: `Write a short note to ${TARGET_CELL} using read, lock, CAS edit, release, then summarize.`,
    phase: "execute",
    status: "pending",
    contextPack: {
      globalGoal: "Prove the NodeAgent frame runner can be adopted outside the full app.",
      currentArtifactDigest: "in-memory demo room spreadsheet",
      relevantOkfConceptIds: [],
      relevantCacheKeys: ["adoption:nodeagent-frame-smoke"],
      openQuestions: [],
      constraints: [
        "Use the RoomTools port, not direct engine writes.",
        "Use optimistic concurrency via the version read from the room.",
        "Return a frame receipt that a caller can persist or inspect.",
      ],
      expectedOutputSchema: "minimal_frame_smoke_receipt_v1",
    },
    toolAllowlist: ["read_range", "propose_lock", "edit_cell", "release_lock", "say"],
    evidenceState: {
      required: ["read current version before write", "lock before edit", "release lock after edit"],
      availableRefs: [],
      missingRefs: [],
      staleRefs: [],
    },
  };
}

function frameWritePlan({ messages }: { step: number; messages: AgentMessage[] }) {
  const versions = lastVersions(messages);
  const lockId = latestToolJson<{ ok?: boolean; lockId?: string }>(messages, "propose_lock")?.lockId;
  const edited = Boolean(latestToolJson<{ ok?: boolean }>(messages, "edit_cell")?.ok);
  const released = Boolean(latestToolJson<{ merged?: unknown[] }>(messages, "release_lock"));

  if (versions[TARGET_CELL] === undefined) {
    return { toolCalls: [{ tool: "read_range", args: { elementIds: [TARGET_CELL] } }] };
  }
  if (!lockId) {
    return { toolCalls: [{ tool: "propose_lock", args: { elementIds: [TARGET_CELL], reason: "minimal frame smoke" } }] };
  }
  if (!edited) {
    return { toolCalls: [{ tool: "edit_cell", args: { elementId: TARGET_CELL, value: TARGET_VALUE, baseVersion: versions[TARGET_CELL] } }] };
  }
  if (!released) {
    return { toolCalls: [{ tool: "release_lock", args: { lockId } }] };
  }
  return { say: "Minimal NodeAgent frame smoke completed through the frame runner.", done: true };
}

function latestToolJson<T>(messages: AgentMessage[], toolName: string): T | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "tool" || message.toolName !== toolName) continue;
    try {
      return JSON.parse(message.content) as T;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("examples/nodeagent-frame-runner/minimal.ts")) {
  const report = await runMinimalNodeAgentFrameSmoke();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
