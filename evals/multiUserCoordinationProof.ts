import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryRoomTools, PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/index";
import { buildDemoRoom, type DemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import type { AgentTool } from "../src/nodeagent/core/types";

type Scenario = {
  id: string;
  passed: boolean;
  checks: Record<string, boolean>;
  evidence: Record<string, unknown>;
};

export type MultiUserCoordinationProof = {
  generatedAt: string;
  target: string;
  summary: {
    passed: boolean;
    scenarios: number;
    passedScenarios: number;
    failedScenarios: string[];
  };
  invariants: string[];
  scenarios: Scenario[];
};

function tool(name: string): AgentTool {
  const found = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing production tool: ${name}`);
  return found;
}

function setup() {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  for (const lock of engine.activeLocks(d.roomId)) engine.releaseLock(lock.id, lock.holder);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  return { engine, d, rt };
}

function version(engine: RoomEngine, d: DemoRoom, elementId: string): number {
  return engine.getArtifact(d.sheetId)!.elements[elementId]?.version ?? 0;
}

function value(engine: RoomEngine, d: DemoRoom, elementId: string): unknown {
  return engine.getArtifact(d.sheetId)!.elements[elementId]?.value;
}

function activeLockCount(engine: RoomEngine, d: DemoRoom): number {
  return engine.activeLocks(d.roomId).length;
}

function result(id: string, checks: Record<string, boolean>, evidence: Record<string, unknown> = {}): Scenario {
  return { id, checks, evidence, passed: Object.values(checks).every(Boolean) };
}

async function managedBatchBlocksOnlyTargetRange(): Promise<Scenario> {
  const { engine, d, rt } = setup();
  const writeLockedCells = tool("write_locked_cells");
  const targets = ["r_rev__variance", "r_cogs__variance"];
  const cells = await rt.readRange(targets);
  const versions = Object.fromEntries(cells.map((cell) => [cell.id, cell.version]));
  const originalEdit = rt.editCell.bind(rt);
  let injected = false;
  let peerTargetBlocked = false;
  let peerOutsideWriteOk = false;

  rt.editCell = async (...args) => {
    if (!injected) {
      injected = true;
      const targetAttempt = engine.applyEdit({
        roomId: d.roomId,
        actor: d.members.priya,
        op: {
          opId: "peer-target-during-managed-lock",
          artifactId: d.sheetId,
          elementId: "r_rev__variance",
          kind: "set",
          value: "+99%",
          baseVersion: version(engine, d, "r_rev__variance"),
        },
      });
      peerTargetBlocked = !targetAttempt.ok && targetAttempt.reason === "locked";

      const outsideAttempt = engine.applyEdit({
        roomId: d.roomId,
        actor: d.members.quokka,
        op: {
          opId: "peer-outside-during-managed-lock",
          artifactId: d.sheetId,
          elementId: "r_opex__note",
          kind: "set",
          value: "peer can still update a non-target cell",
          baseVersion: version(engine, d, "r_opex__note"),
        },
      });
      peerOutsideWriteOk = outsideAttempt.ok;
    }
    return originalEdit(...args);
  };

  const outcome = await writeLockedCells.execute({
    reason: "multi-user proof managed range write",
    ops: [
      { elementId: "r_rev__variance", value: "+24%", baseVersion: versions.r_rev__variance },
      { elementId: "r_cogs__variance", value: "+27.5%", baseVersion: versions.r_cogs__variance },
    ],
  }, rt) as { ok?: boolean; coordination?: { released?: boolean } };

  const traces = engine.listTraces(d.roomId);
  return result("managed_batch_blocks_target_not_room", {
    managedWriteSucceeded: outcome.ok === true,
    peerTargetBlocked,
    peerOutsideWriteOk,
    releaseRecorded: outcome.coordination?.released === true,
    noLockLeak: activeLockCount(engine, d) === 0,
    finalTargetPreserved: value(engine, d, "r_rev__variance") === "+24%" && value(engine, d, "r_cogs__variance") === "+27.5%",
    outsideWritePreserved: value(engine, d, "r_opex__note") === "peer can still update a non-target cell",
  }, {
    traceTypes: traces.map((trace) => trace.type),
    finalValues: {
      r_rev__variance: value(engine, d, "r_rev__variance"),
      r_cogs__variance: value(engine, d, "r_cogs__variance"),
      r_opex__note: value(engine, d, "r_opex__note"),
    },
  });
}

async function staleHumanWriteConflicts(): Promise<Scenario> {
  const { engine, d } = setup();
  const baseVersion = version(engine, d, "r_rev__variance");
  const first = engine.applyEdit({
    roomId: d.roomId,
    actor: d.members.priya,
    op: {
      opId: "human-first-write",
      artifactId: d.sheetId,
      elementId: "r_rev__variance",
      kind: "set",
      value: "+10%",
      baseVersion,
    },
  });
  const stale = engine.applyEdit({
    roomId: d.roomId,
    actor: d.members.homen,
    op: {
      opId: "human-stale-write",
      artifactId: d.sheetId,
      elementId: "r_rev__variance",
      kind: "set",
      value: "+20%",
      baseVersion,
    },
  });

  return result("stale_base_returns_conflict_data", {
    firstWriteSucceeded: first.ok === true,
    staleWriteRejected: !stale.ok && stale.reason === "conflict",
    canonicalValuePreserved: value(engine, d, "r_rev__variance") === "+10%",
    noLockLeak: activeLockCount(engine, d) === 0,
  }, {
    staleResult: stale,
    finalValue: value(engine, d, "r_rev__variance"),
  });
}

async function humanVsHumanSameCellConverges(): Promise<Scenario> {
  const runOrder = (firstActor: "homen" | "priya") => {
    const { engine, d } = setup();
    const first = firstActor === "homen" ? d.members.homen : d.members.priya;
    const second = firstActor === "homen" ? d.members.priya : d.members.homen;
    const firstValue = firstActor === "homen" ? "+24pct-Homen" : "+19pct-Priya";
    const secondValue = firstActor === "homen" ? "+19pct-Priya" : "+24pct-Homen";
    const baseVersion = version(engine, d, "r_rev__variance");
    const firstWrite = engine.applyEdit({
      roomId: d.roomId,
      actor: first,
      op: {
        opId: `human-vs-human-${firstActor}-first`,
        artifactId: d.sheetId,
        elementId: "r_rev__variance",
        kind: "set",
        value: firstValue,
        baseVersion,
      },
    });
    const secondWrite = engine.applyEdit({
      roomId: d.roomId,
      actor: second,
      op: {
        opId: `human-vs-human-${firstActor}-second`,
        artifactId: d.sheetId,
        elementId: "r_rev__variance",
        kind: "set",
        value: secondValue,
        baseVersion,
      },
    });
    return {
      firstActor,
      firstWrite,
      secondWrite,
      finalValue: value(engine, d, "r_rev__variance"),
      finalVersion: version(engine, d, "r_rev__variance"),
      noLockLeak: activeLockCount(engine, d) === 0,
    };
  };
  const homenFirst = runOrder("homen");
  const priyaFirst = runOrder("priya");
  const subcases = [homenFirst, priyaFirst];

  return result("human_vs_human_same_cell_no_clobber", {
    oneWinnerPerOrder: subcases.every((subcase) => subcase.firstWrite.ok === true && !subcase.secondWrite.ok),
    loserGetsConflictData: subcases.every((subcase) => !subcase.secondWrite.ok && subcase.secondWrite.reason === "conflict"),
    canonicalWinnerPreserved: homenFirst.finalValue === "+24pct-Homen" && priyaFirst.finalValue === "+19pct-Priya",
    versionBumpedOncePerOrder: subcases.every((subcase) => subcase.finalVersion === 2),
    noLockLeak: subcases.every((subcase) => subcase.noLockLeak),
  }, {
    orders: subcases,
  });
}

async function blockedSecondAgentDraftsThenMerges(): Promise<Scenario> {
  const { engine, d } = setup();
  const held = engine.proposeLock({
    roomId: d.roomId,
    artifactId: d.sheetId,
    elementIds: ["r_gp__variance"],
    holder: d.agents.room,
    sessionId: d.sessions.room,
    reason: "public agent owns the gross-profit variance",
  });
  if (!held.ok) throw new Error("failed to seed held lock");

  const rtPrivate = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.priv, d.sessions.priv);
  const [cell] = await rtPrivate.readRange(["r_gp__variance"]);
  const writeLockedCell = tool("write_locked_cell");
  const draftOutcome = await writeLockedCell.execute({
    elementId: "r_gp__variance",
    value: "+21.7%",
    baseVersion: cell.version,
    reason: "private agent blocked by public range lock",
  }, rtPrivate) as { drafted?: boolean; draftId?: string; coordination?: { blockingLockId?: string } };
  const beforeRelease = value(engine, d, "r_gp__variance");
  const released = engine.releaseLock(held.lock.id, d.agents.room);

  return result("blocked_agent_drafts_and_smart_merges", {
    privateAgentDrafted: draftOutcome.drafted === true,
    blockingLockRecorded: draftOutcome.coordination?.blockingLockId === held.lock.id,
    lockedValueUnchangedBeforeRelease: beforeRelease === "",
    releaseMergedDraft: released.merged.some((merge) => merge.resolution.verdict === "clean" && merge.conflicts.length === 0),
    finalDraftValueApplied: value(engine, d, "r_gp__variance") === "+21.7%",
    noLockLeak: activeLockCount(engine, d) === 0,
  }, {
    draftId: draftOutcome.draftId,
    release: released.merged.map((merge) => ({
      draftId: merge.draftId,
      applied: merge.applied,
      conflicts: merge.conflicts.length,
      verdict: merge.resolution.verdict,
    })),
    finalValue: value(engine, d, "r_gp__variance"),
  });
}

async function managedWriteReleasesAfterCasConflict(): Promise<Scenario> {
  const { engine, d, rt } = setup();
  const writeLockedCell = tool("write_locked_cell");
  const [cell] = await rt.readRange(["r_ni__variance"]);
  const human = engine.applyEdit({
    roomId: d.roomId,
    actor: d.members.priya,
    op: {
      opId: "human-before-stale-managed-write",
      artifactId: d.sheetId,
      elementId: "r_ni__variance",
      kind: "set",
      value: "+5%",
      baseVersion: cell.version,
    },
  });
  const staleManaged = await writeLockedCell.execute({
    elementId: "r_ni__variance",
    value: "+22.4%",
    baseVersion: cell.version,
    reason: "managed stale-base proof",
  }, rt) as { conflict?: boolean; coordination?: { released?: boolean } };

  return result("managed_write_releases_after_conflict", {
    humanWriteSucceeded: human.ok === true,
    staleManagedWriteConflicted: staleManaged.conflict === true,
    releaseStillRan: staleManaged.coordination?.released === true,
    canonicalValuePreserved: value(engine, d, "r_ni__variance") === "+5%",
    noLockLeak: activeLockCount(engine, d) === 0,
  }, {
    staleManaged,
    finalValue: value(engine, d, "r_ni__variance"),
  });
}

async function humanC2BeatsStaleAgentA1C5Range(): Promise<Scenario> {
  const { engine, d, rt } = setup();
  const writeLockedCells = tool("write_locked_cells");
  const a1c5Range = [
    "r_rev__variance",
    "r_cogs__variance",
    "r_gp__variance",
    "r_opex__variance",
    "r_ni__variance",
  ];
  const cells = await rt.readRange(a1c5Range);
  const versions = Object.fromEntries(cells.map((cell) => [cell.id, cell.version]));

  const human = engine.applyEdit({
    roomId: d.roomId,
    actor: d.members.homen,
    op: {
      opId: "human-c2-before-agent-a1c5-write",
      artifactId: d.sheetId,
      elementId: "r_rev__variance",
      kind: "set",
      value: "+11% human C2 adjustment",
      baseVersion: versions.r_rev__variance,
    },
  });

  const agent = await writeLockedCells.execute({
    reason: "agent stale A1:C5 range write after human C2 edit",
    ops: [
      { elementId: "r_rev__variance", value: "+24% agent stale overwrite attempt", baseVersion: versions.r_rev__variance },
      { elementId: "r_cogs__variance", value: "+27.5%", baseVersion: versions.r_cogs__variance },
      { elementId: "r_gp__variance", value: "+21.7%", baseVersion: versions.r_gp__variance },
      { elementId: "r_opex__variance", value: "+20.5%", baseVersion: versions.r_opex__variance },
      { elementId: "r_ni__variance", value: "+22.4%", baseVersion: versions.r_ni__variance },
    ],
  }, rt) as {
    ok?: boolean;
    results?: Array<{ ok?: boolean; reason?: string; conflict?: boolean; elementId?: string }>;
    coordination?: { released?: boolean; targetIds?: string[] };
  };

  return result("human_c2_vs_agent_a1_c5_stale_range_no_clobber", {
    humanC2WriteSucceeded: human.ok === true,
    agentRangeWriteRejected: agent.ok === false,
    conflictReturnedForC2: agent.results?.some((item) =>
      item.elementId === "r_rev__variance" && (item.reason === "conflict" || item.conflict === true)
    ) === true,
    canonicalHumanC2Preserved: value(engine, d, "r_rev__variance") === "+11% human C2 adjustment",
    staleRangeDidNotPartiallyApplyAfterC2Conflict: [
      "r_cogs__variance",
      "r_gp__variance",
      "r_opex__variance",
      "r_ni__variance",
    ].every((elementId) => value(engine, d, elementId) === ""),
    releaseRecorded: agent.coordination?.released === true,
    noLockLeak: activeLockCount(engine, d) === 0,
  }, {
    coordinateMap: {
      c2: "r_rev__variance",
      a1c5: a1c5Range,
      visibleGridContract: "C2 is the human-edited overlap cell inside the agent's A1:C5 work range.",
    },
    humanResult: human,
    agentResult: agent,
    finalValues: Object.fromEntries(a1c5Range.map((elementId) => [elementId, value(engine, d, elementId)])),
  });
}

export async function runMultiUserCoordinationProof(): Promise<MultiUserCoordinationProof> {
  const scenarios = [
    await managedBatchBlocksOnlyTargetRange(),
    await staleHumanWriteConflicts(),
    await humanVsHumanSameCellConverges(),
    await blockedSecondAgentDraftsThenMerges(),
    await managedWriteReleasesAfterCasConflict(),
    await humanC2BeatsStaleAgentA1C5Range(),
  ];
  const failedScenarios = scenarios.filter((scenario) => !scenario.passed).map((scenario) => scenario.id);
  return {
    generatedAt: new Date().toISOString(),
    target: "deterministic multi-user coordination contract used by production Convex mutations",
    summary: {
      passed: failedScenarios.length === 0,
      scenarios: scenarios.length,
      passedScenarios: scenarios.length - failedScenarios.length,
      failedScenarios,
    },
    invariants: [
      "A runtime-managed range lock blocks peer writes to target cells while allowing non-target writes.",
      "A stale base version returns conflict data and preserves the canonical value.",
      "A second agent blocked by an active lock drafts instead of forcing a write, then smart-merges on release.",
      "Managed writes release their lock in finally even when the CAS write conflicts.",
      "A stale agent range write over A1:C5 cannot clobber a human's newer C2 edit.",
      "Every scenario ends with zero active locks.",
    ],
    scenarios,
  };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const outIndex = process.argv.indexOf("--json-out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "docs/eval/multi-user-coordination-proof.json";
  const proof = await runMultiUserCoordinationProof();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof.summary, null, 2));
  if (strict && !proof.summary.passed) process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
