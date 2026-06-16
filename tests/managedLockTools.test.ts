import { describe, expect, it } from "vitest";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  lastVersions,
  runAgent,
  scriptedModel,
  type AgentMessage,
} from "../src/nodeagent/index";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";

const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };

function setup() {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  return { engine, d, rt };
}

function parse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function managedCommitted(messages: AgentMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.role !== "tool" || (m.toolName !== "write_locked_cell" && m.toolName !== "write_locked_cells")) continue;
    const result = parse(m.content);
    if (!result?.ok && !result?.pendingApproval && !result?.drafted) continue;
    const call = messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === m.toolCallId);
    if (call?.args.elementId) out.add(String(call.args.elementId));
    const ops = call?.args.ops;
    if (Array.isArray(ops)) {
      for (const op of ops) {
        const elementId = (op as { elementId?: unknown }).elementId;
        if (elementId) out.add(String(elementId));
      }
    }
  }
  return out;
}

function managedVariancePlan(targets: Record<string, string>) {
  const ids = Object.keys(targets);
  return ({ messages }: { messages: AgentMessage[] }) => {
    const versions = lastVersions(messages);
    if (!ids.every((id) => versions[id] !== undefined)) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };
    }
    const committed = managedCommitted(messages);
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
    return { say: "Variance cells written through managed locks.", done: true };
  };
}

describe("managed lock production tools", () => {
  it("hides explicit lock/unlock tools from the production bundle", () => {
    const names = PRODUCTION_ROOM_TOOLS.map((tool) => tool.name);

    expect(names).toContain("write_locked_cell");
    expect(names).toContain("write_locked_cells");
    expect(names).toContain("write_locked_cell_result");
    expect(names).toContain("write_locked_cell_results");
    expect(names).not.toContain("propose_lock");
    expect(names).not.toContain("release_lock");
    expect(names).not.toContain("create_draft");
  });

  it("lets the runtime acquire and release locks around writes without model-visible lock calls", async () => {
    const { engine, d, rt } = setup();
    const originalEdit = rt.editCell.bind(rt);
    let humanBlocked = false;

    rt.editCell = async (...args) => {
      if (!humanBlocked) {
        const version = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.version;
        const attempted = engine.applyEdit({
          roomId: d.roomId,
          op: {
            opId: "human-during-managed-write",
            artifactId: d.sheetId,
            elementId: "r_rev__variance",
            kind: "set",
            value: "+19%",
            baseVersion: version,
          },
          actor: d.members.priya,
        });
        humanBlocked = !attempted.ok && attempted.reason === "locked";
      }
      return originalEdit(...args);
    };

    const result = await runAgent({
      rt,
      goal: "write two variance cells with runtime-managed locks",
      model: scriptedModel(managedVariancePlan(TARGETS), "managed-lock-scripted"),
      tools: PRODUCTION_ROOM_TOOLS,
      systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
      maxSteps: 5,
    });
    const art = engine.getArtifact(d.sheetId)!;

    expect(result.exhausted).toBe(false);
    expect(result.trace.map((event) => event.tool)).toEqual(["read_range", "write_locked_cells"]);
    expect(result.trace.some((event) => event.tool === "propose_lock" || event.tool === "release_lock")).toBe(false);
    expect(humanBlocked).toBe(true);
    expect(art.elements.r_rev__variance.value).toBe("+24%");
    expect(art.elements.r_cogs__variance.value).toBe("+27.5%");
    expect(engine.lockFor(d.sheetId, "r_rev__variance")).toBeUndefined();
  });

  it("drafts instead of writing when another actor already owns the target lock", async () => {
    const { engine, d } = setup();
    const held = engine.proposeLock({
      roomId: d.roomId,
      artifactId: d.sheetId,
      elementIds: ["r_rev__variance"],
      holder: d.agents.room,
      sessionId: d.sessions.room,
      reason: "public agent owns the cell",
    });
    expect(held.ok).toBe(true);
    const rtB = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.priv, d.sessions.priv);
    const [cell] = await rtB.readRange(["r_rev__variance"]);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell")!;

    const result = await writeLocked.execute({
      elementId: "r_rev__variance",
      value: "+24%",
      baseVersion: cell.version,
      reason: "private managed write",
    }, rtB) as { drafted?: boolean; draftId?: string };

    expect(result.drafted).toBe(true);
    expect(result.draftId).toMatch(/^draft_/);
    expect(engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value).toBe("");

    if (held.ok) engine.releaseLock(held.lock.id, d.agents.room);
    expect(engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value).toBe("+24%");
  });

  it("skips unchanged scalar writes before acquiring a managed lock", async () => {
    const { rt } = setup();
    const [cell] = await rt.readRange(["r_rev__variance"]);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell")!;
    const originalPropose = rt.proposeLock.bind(rt);
    let lockCalls = 0;
    rt.proposeLock = async (...args) => {
      lockCalls++;
      return originalPropose(...args);
    };

    const result = await writeLocked.execute({
      elementId: "r_rev__variance",
      value: cell.value,
      baseVersion: 999,
      reason: "repeat unchanged write",
    }, rt) as { ok?: boolean; skipped?: boolean; reason?: string; version?: number };

    expect(result).toMatchObject({ ok: true, skipped: true, reason: "unchanged", version: cell.version });
    expect(lockCalls).toBe(0);
  });

  it("skips unchanged evidence-bearing batch writes before acquiring a managed lock", async () => {
    const { engine, d, rt } = setup();
    const payload = {
      value: "11 months",
      status: "complete",
      confidence: 0.82,
      evidence: [{ id: "manual:r_rev__variance:1", kind: "manual", label: "Existing diligence note" }],
    };
    const art = engine.getArtifact(d.sheetId)!;
    const seeded = engine.applyEdit({
      roomId: d.roomId,
      op: {
        opId: "seed-evidence-payload",
        artifactId: d.sheetId,
        elementId: "r_rev__variance",
        kind: "set",
        value: payload,
        baseVersion: art.elements.r_rev__variance.version,
      },
      actor: d.members.homen,
    });
    expect(seeded.ok).toBe(true);
    const [cell] = await rt.readRange(["r_rev__variance"]);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_results")!;
    const originalPropose = rt.proposeLock.bind(rt);
    let lockCalls = 0;
    rt.proposeLock = async (...args) => {
      lockCalls++;
      return originalPropose(...args);
    };

    const result = await writeLocked.execute({
      reason: "repeat unchanged evidence write",
      ops: [{
        elementId: "r_rev__variance",
        value: "11 months",
        baseVersion: cell.version,
        status: "complete",
        confidence: 0.82,
        evidence: [{ kind: "manual", label: "Existing diligence note" }],
      }],
    }, rt) as { ok?: boolean; skipped?: boolean; reason?: string; results?: Array<{ skipped?: boolean; version?: number }> };

    expect(result).toMatchObject({ ok: true, skipped: true, reason: "unchanged" });
    expect(result.results?.[0]).toMatchObject({ skipped: true, version: cell.version });
    expect(lockCalls).toBe(0);
  });
});
