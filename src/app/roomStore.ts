/**
 * roomStore — the singleton engine + demo room, exposed to React.
 *
 * `useEngineRev()` is a `useSyncExternalStore` subscription over the engine's
 * own change notifications — the local mirror of a Convex reactive query. UI
 * components call it to re-render, then read engine data directly. (In prod,
 * swap `engine.*` reads for Convex `useQuery` and `engine.*` writes for mutations.)
 */

import { useSyncExternalStore } from "react";
import { RoomEngine } from "../engine/roomEngine";
import { buildDemoRoom, playCollab, type DemoRoom } from "../engine/demoRoom";
import type { Actor, ArtifactMeta, DataframeColumn } from "../engine/types";
import {
  BTB_ARTIFACT_ROWS,
  BTB_BOUNDARY_ROWS,
  BTB_RUN_MATRIX_COLUMNS,
  BTB_RUN_MATRIX_ROWS,
  BTB_TASK_NOTE,
  BTB_UI_EVIDENCE,
  BTB_WORKFLOW_NOTE,
  sheetSeed,
  tupleSheetSeed,
} from "./bankerToolBenchRoomSeed";

export const engine = new RoomEngine({ now: () => Date.now() });
export const demo: DemoRoom = buildDemoRoom(engine);

let rev = 0;
engine.subscribe(() => { rev += 1; });

/** Re-render whenever the engine changes (the reactive-query mirror). */
export function useEngineRev(): number {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => rev,
    () => rev,
  );
}

export function createFreshRoom(title: string, hostName: string): { roomId: string; me: Actor } {
  const { room, host } = engine.createRoom({ title: title || "Untitled room", hostName: hostName || "Host", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: host.name };
  const seed = blankSheetSeed();
  const meta: ArtifactMeta = { dataframe: { columns: blankSheetColumns(), rowCount: 8, sourceFile: "blank-room", parser: "blank_seed", truncated: false, warnings: [] } };
  engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Blank sheet", by: me, seed, meta });
  engine.createArtifact({ roomId: room.id, kind: "note", title: "Note", by: me, seed: [{ id: "doc", value: "<h1>Notes</h1><p></p>" }] });
  engine.createArtifact({ roomId: room.id, kind: "wall", title: "Wall", by: me, seed: [] });
  return { roomId: room.id, me };
}

function blankSheetSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (let row = 1; row <= 8; row++) {
    for (const col of ["A", "B", "C"]) seed.push({ id: `r${row}__${col}`, value: "" });
  }
  return seed;
}

function blankSheetColumns(): DataframeColumn[] {
  return ["A", "B", "C"].map((label, order): DataframeColumn => ({ id: label, label, order, mode: "manual", type: "text", agentWritable: true }));
}

export function enterDemoRoomAsHost(_hostName?: string): { roomId: string; me: Actor } {
  return { roomId: demo.roomId, me: demo.members.homen };
}

let btbRoom: { roomId: string; me: Actor } | null = null;

export function enterBankerToolBenchRoomAsHost(): { roomId: string; me: Actor } {
  if (btbRoom) return btbRoom;

  const { room, host } = engine.createRoom({ title: BTB_UI_EVIDENCE.roomTitle, hostName: "BTB Host", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: host.name };
  const agent: Actor = { kind: "agent", id: "agent_btb", name: "Room NodeAgent", scope: "public" };

  engine.createArtifact({
    roomId: room.id,
    kind: "note",
    title: "BTB Task + Score",
    by: me,
    seed: [{ id: "doc", value: BTB_TASK_NOTE }],
    meta: { summary: "Actual BankerToolBench selected-task replay with score, run paths, and boundary receipt summary.", tags: ["bankertoolbench", "nodeagent", "official-eval"] },
  });

  engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "BTB Run Matrix",
    by: me,
    seed: sheetSeed(BTB_RUN_MATRIX_ROWS, BTB_RUN_MATRIX_COLUMNS),
    meta: {
      dataframe: {
        columns: BTB_RUN_MATRIX_COLUMNS,
        rowCount: BTB_RUN_MATRIX_ROWS.length,
        sourceFile: "btb-nodeagent-ui-seed",
        parser: "btb_replay_seed",
        truncated: false,
        warnings: [],
      },
      summary: "Operational status of the official BTB score lane and NodeRoom UI replay lane.",
      tags: ["run-matrix", "btb", "eval"],
    },
  });

  const artifactColumns: DataframeColumn[] = [
    { id: "file", label: "File", order: 0, type: "text" },
    { id: "type", label: "Type", order: 1, type: "text" },
    { id: "purpose", label: "Purpose", order: 2, type: "text" },
    { id: "status", label: "Status", order: 3, type: "text" },
  ];
  engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "BTB Artifact Manifest",
    by: me,
    seed: tupleSheetSeed(BTB_ARTIFACT_ROWS, artifactColumns, "file"),
    meta: {
      dataframe: {
        columns: artifactColumns,
        rowCount: BTB_ARTIFACT_ROWS.length,
        sourceFile: BTB_UI_EVIDENCE.jobPath,
        parser: "btb_replay_seed",
        truncated: false,
        warnings: [],
      },
      summary: "Deliverables emitted by NodeAgent inside the Harbor candidate workspace.",
      tags: ["artifacts", "office", "pdf"],
    },
  });

  const boundaryColumns: DataframeColumn[] = [
    { id: "id", label: "Receipt", order: 0, type: "text" },
    { id: "claim", label: "Claim", order: 1, type: "text" },
    { id: "source", label: "Source", order: 2, type: "text" },
    { id: "locator", label: "Locator", order: 3, type: "text" },
    { id: "status", label: "Boundary", order: 4, type: "text" },
    { id: "support", label: "Support", order: 5, type: "text" },
  ];
  engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "Boundary Box Receipts",
    by: me,
    seed: tupleSheetSeed(BTB_BOUNDARY_ROWS, boundaryColumns, "cite"),
    meta: {
      dataframe: {
        columns: boundaryColumns,
        rowCount: BTB_BOUNDARY_ROWS.length,
        sourceFile: "boundary_box_receipts.json",
        parser: "btb_replay_seed",
        truncated: false,
        warnings: [`Showing sample receipts; full count ${BTB_UI_EVIDENCE.supportedBoundaryReceipts}/${BTB_UI_EVIDENCE.boundaryReceiptCount}`],
      },
      summary: "Sample boundary-box/cell citation receipts from the selected actual task run.",
      tags: ["citations", "boundary-box", "evidence"],
    },
  });

  engine.createArtifact({
    roomId: room.id,
    kind: "note",
    title: "BTB Workflow Trace",
    by: me,
    seed: [{ id: "doc", value: BTB_WORKFLOW_NOTE }],
    meta: { summary: "Replay of the NodeAgent source, planning, artifact, citation, and grading workflow.", tags: ["trace", "workflow", "nodeagent"] },
  });

  const session = engine.startSession({ roomId: room.id, agentId: agent.id, agentName: agent.name, scope: "public" });
  engine.updateSession(session.id, { status: "done", lastAction: `BTB full-100 clean probe mean ${BTB_UI_EVIDENCE.capabilityProbeMean}; ${BTB_UI_EVIDENCE.capabilityProbeCleanAccepted}` });
  engine.postMessage({
    roomId: room.id,
    channel: "public",
    author: agent,
    text: `Imported actual BankerToolBench evidence. Clean capability probe ${BTB_UI_EVIDENCE.capabilityProbeJob} scored ${BTB_UI_EVIDENCE.capabilityProbeMean} mean across ${BTB_UI_EVIDENCE.capabilityProbeTasks} actual tasks with ${BTB_UI_EVIDENCE.capabilityProbeCleanAccepted}; current clean expansion shard ${BTB_UI_EVIDENCE.cleanExpansionJob} is ${BTB_UI_EVIDENCE.cleanExpansionStatus}; file-backed summary is ${BTB_UI_EVIDENCE.capabilityProbeSummaryPath}; Convex ledger room ${BTB_UI_EVIDENCE.convexLedgerRoomCode} now selects the full-100 run with ${BTB_UI_EVIDENCE.convexLedgerImportedTasks} visible task rows and ${BTB_UI_EVIDENCE.convexLedgerCleanAccepted} clean rows; replay run ${BTB_UI_EVIDENCE.selectedJob} scored ${BTB_UI_EVIDENCE.selectedReward}; source-skill family diagnostic ${BTB_UI_EVIDENCE.generalOnlyJob} scored ${BTB_UI_EVIDENCE.generalOnlyReward}.`,
    clientMsgId: "btb-seed-agent-summary",
    kind: "agent",
  });
  engine.postMessage({
    roomId: room.id,
    channel: "public",
    author: me,
    text: "Open the run matrix, artifact manifest, boundary receipts, and trace tab to review the same workflow inside NodeRoom.",
    clientMsgId: "btb-seed-host-navigation",
    kind: "chat",
  });

  engine.trace(room.id, agent, "agent_status", "Extracted candidate-visible source packet from workspace and VDR MCP tools.", { artifactId: "BTB Run Matrix" }, "No golden outputs, rubrics, canaries, or verifier logs were exposed to the candidate.");
  engine.trace(
    room.id,
    agent,
    "agent_status",
    `Clean probe planner selected ${BTB_UI_EVIDENCE.capabilityProbeModel}; plannerTransport=${BTB_UI_EVIDENCE.capabilityProbePlannerTransport}; modelCalls=${BTB_UI_EVIDENCE.capabilityProbeModelCalls}; ${BTB_UI_EVIDENCE.capabilityProbeCleanAccepted}; allow_fallback_plan=false; fallbackUsed=false.`,
    { model: BTB_UI_EVIDENCE.capabilityProbeModel, plannerTransport: BTB_UI_EVIDENCE.capabilityProbePlannerTransport },
    `Generic-only scoring disables replay writers, disables family writers, does not permit heuristic fallback, and requires supported boundary receipts. Gate: ${BTB_UI_EVIDENCE.capabilityProbeCleanGate}.`,
  );
  engine.trace(
    room.id,
    agent,
    "agent_status",
    `Current clean expansion ${BTB_UI_EVIDENCE.cleanExpansionJob}: ${BTB_UI_EVIDENCE.cleanExpansionEvidence}.`,
    { job: BTB_UI_EVIDENCE.cleanExpansionJob },
    `Completed under the provisional clean-probe gate; next proof step is S9-S16 substrate-derived receipts.`,
  );
  engine.trace(
    room.id,
    agent,
    "agent_status",
    `Live Convex eval ledger backfilled in room ${BTB_UI_EVIDENCE.convexLedgerRoomCode}: ${BTB_UI_EVIDENCE.convexLedgerImportedRuns} evalRuns, ${BTB_UI_EVIDENCE.convexLedgerImportedTasks} taskResults, ${BTB_UI_EVIDENCE.convexLedgerCleanAccepted} clean accepted rows, aggregate clean mean ${BTB_UI_EVIDENCE.convexLedgerCleanMean}.`,
    { roomId: BTB_UI_EVIDENCE.convexLedgerRoomId },
    BTB_UI_EVIDENCE.convexLedgerEvidence,
  );
  engine.trace(
    room.id,
    agent,
    "agent_status",
    `Latest clean preflight lift ${BTB_UI_EVIDENCE.capabilityProbeLatestTask} trial ${BTB_UI_EVIDENCE.capabilityProbeLatestTrial} scored ${BTB_UI_EVIDENCE.capabilityProbeLatestReward} (${BTB_UI_EVIDENCE.capabilityProbeLatestRaw}) after generic plan preflight and writer fixes.`,
    { job: BTB_UI_EVIDENCE.capabilityProbeLatestJob, reward: BTB_UI_EVIDENCE.capabilityProbeLatestReward },
    "This still uses force-model, no-fallback, generic-only gates; rerun on the three-task slice before changing the headline mean.",
  );
  engine.trace(
    room.id,
    agent,
    "agent_status",
    `Family-writer diagnostic ${BTB_UI_EVIDENCE.generalOnlyTaskId} trial ${BTB_UI_EVIDENCE.generalOnlyTrial} scored ${BTB_UI_EVIDENCE.generalOnlyReward} (${BTB_UI_EVIDENCE.generalOnlyRawScore}); plannerTransport=${BTB_UI_EVIDENCE.plannerTransport}; modelCalls=0.`,
    { job: BTB_UI_EVIDENCE.generalOnlyJob, reward: BTB_UI_EVIDENCE.generalOnlyReward },
    "This is quarantined diagnostic evidence; the current capability metric is the generic-only force-model probe.",
  );
  engine.trace(room.id, agent, "edit_applied", "Materialized XLSX, PPTX, DOCX, PDF, manifest, and boundary receipt artifacts.", { artifactId: "BTB Artifact Manifest" });
  engine.trace(room.id, agent, "edit_applied", `Enforced ${BTB_UI_EVIDENCE.supportedBoundaryReceipts}/${BTB_UI_EVIDENCE.boundaryReceiptCount} boundary receipts.`, { artifactId: "Boundary Box Receipts" });
  engine.trace(room.id, agent, "agent_status", `Imported Gandalf reward ${BTB_UI_EVIDENCE.selectedReward} for ${BTB_UI_EVIDENCE.selectedTrial}.`, { job: BTB_UI_EVIDENCE.selectedJob });

  btbRoom = { roomId: room.id, me };
  return btbRoom;
}

export function joinRoomByCode(code: string, name: string): { roomId: string; me: Actor } | null {
  const res = engine.joinRoom({ code: code.trim(), name: name.trim() || "Guest" });
  if (!res) return null;
  return { roomId: res.room.id, me: { kind: "user", id: res.member.id, name: res.member.name } };
}

export function runDemo(conflict: boolean): Promise<void> {
  const reduced = window.matchMedia?.("(prefers-reduced-motion:reduce)").matches ?? false;
  return playCollab(engine, demo, { reduced, conflict });
}
