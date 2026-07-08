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
import { buildDemoRoom, playCollab, RESEARCH_COLS, type DemoRoom } from "../engine/demoRoom";
import type { Actor, CellEvidence, CellPayload, DataframeColumn } from "../engine/types";
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
import {
  HACKWITHBAY_BRIEF_NOTE,
  HACKWITHBAY_CHECKLIST_COLUMNS,
  HACKWITHBAY_CHECKLIST_ROWS,
  HACKWITHBAY_GRAPH_COLUMNS,
  HACKWITHBAY_GRAPH_ROWS,
  HACKWITHBAY_ROOM_TITLE,
  hackwithBaySeed,
} from "./hackwithBayRoomSeed";

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
  // Seed a starter variance sheet. engine.createRoom() creates a BARE room, so
  // without this the StoryLab playground (its only caller) has no sheet — the
  // grid seeds nothing and the L4/L7 lease drill silently no-ops on artId "".
  // The grid + drills address cells as `${rowId}__${col}` (A/B/C), so an empty
  // sheet is enough; LabGrid fills A/B and the drills write C.
  engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Variance", by: me, seed: [] });
  return { roomId: room.id, me };
}

export function enterDemoRoomAsHost(_hostName?: string): { roomId: string; me: Actor } {
  return { roomId: demo.roomId, me: demo.members.homen };
}

export const SCALE_DEMO_ROWS = 1_000;
export const SCALE_DEMO_ARTIFACTS = 183;
export const SCALE_DEMO_MEMBERS = 62;

let scaleRoom: { roomId: string; me: Actor; researchId: string } | null = null;

export function enterScaleDemoRoomAsHost(_hostName?: string): { roomId: string; me: Actor } {
  if (scaleRoom) return { roomId: scaleRoom.roomId, me: scaleRoom.me };

  // Design parity: the wordmark renders "NodeRoom · <title>", so the room title
  // must be the workspace name ("Startup diligence"), never the product name —
  // "NodeRoom · NodeRoom at scale" read as a duplication bug.
  const { room, host } = engine.createRoom({ title: "Startup diligence", hostName: "Homen", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: host.name };
  const agent: Actor = { kind: "agent", id: "agent_scale_room", name: "Room NodeAgent", scope: "public" };

  for (let i = 0; i < SCALE_DEMO_MEMBERS - 1; i += 1) {
    const name = SCALE_MEMBER_NAMES[i] ?? `Analyst ${String(i + 1).padStart(2, "0")}`;
    engine.joinRoom({ code: room.code, name, anon: name.startsWith("anon") });
  }

  const research = engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "Company research",
    by: me,
    seed: scaleResearchSeed(),
    meta: scaleResearchMeta(),
  });

  createScaleCompanionArtifacts(room.id, me);

  const session = engine.startSession({ roomId: room.id, agentId: agent.id, agentName: agent.name, scope: "public" });
  const lockRange = ["sr_0004", "sr_0005", "sr_0006"].flatMap((rowId) => (
    ["status", "summary", "funding", "recent_signal"].map((col) => `${rowId}__${col}`)
  ));
  const lock = engine.proposeLock({
    roomId: room.id,
    artifactId: research.id,
    elementIds: lockRange,
    holder: agent,
    sessionId: session.id,
    reason: "enriching the next scale batch with source-backed facts",
  });
  engine.updateSession(session.id, {
    status: "working",
    heldLockId: lock.ok ? lock.lock.id : undefined,
    lastAction: "rechecking rows 4-6 with source-backed receipts",
  });

  const firstStatusId = "sr_0001__status";
  const firstStatus = research.elements[firstStatusId];
  if (firstStatus) {
    engine.applyEdit({
      roomId: room.id,
      actor: agent,
      op: {
        opId: "scale-research-status-commit-1",
        artifactId: research.id,
        elementId: firstStatusId,
        kind: "set",
        value: firstStatus.value,
        baseVersion: firstStatus.version,
      },
    });
  }

  seedScaleMessages(room.id, me, agent);
  engine.trace(room.id, agent, "agent_status", "Committed 40 sourced company rows, queued 3 visible locked rows, and left receipts visible in the grid.", { artifactId: research.id }, "Scale parity seed: 1,000 rows, 183 artifacts, 62 members, 312 public messages.");

  scaleRoom = { roomId: room.id, me, researchId: research.id };
  return { roomId: scaleRoom.roomId, me: scaleRoom.me };
}

const SCALE_MEMBER_NAMES = [
  "Priya",
  "Maya",
  "Sam",
  "anon · quokka",
  "Jordan",
  "Rina",
  "Noah",
  "Leah",
  "Ari",
  "Dev",
  "Tara",
  "Ivy",
  "Niko",
  "Mina",
  "Owen",
  "Zara",
  "Ken",
  "Lena",
  "Sofia",
  "Max",
  "Anika",
  "Theo",
  "Uma",
  "Jules",
  "Ravi",
  "Elle",
  "Nia",
  "Luis",
  "Mei",
  "Cole",
  "Aya",
  "Ben",
  "June",
  "Kira",
  "Omar",
  "Pia",
  "Rey",
  "Sol",
  "Vale",
  "Wes",
  "Yara",
  "Zed",
  "Alex",
  "Blair",
  "Casey",
  "Drew",
  "Emery",
  "Finley",
  "Gray",
  "Harper",
  "Indigo",
  "Kai",
  "Logan",
  "Morgan",
  "Quinn",
  "Rowan",
  "Sage",
  "Taylor",
  "Vesper",
  "Winter",
  "Zen",
];

function scaleResearchMeta() {
  const evidenceCols = new Set(["summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched"]);
  const readonlyCols = new Set(["company", "website", "tier", "intent", "owner", "crm_status"]);
  return {
    dataframe: {
      columns: RESEARCH_COLS.map((col, order) => ({
        id: col,
        label: col.replace(/_/g, " "),
        order,
        mode: evidenceCols.has(col) ? "enrich" as const : "manual" as const,
        type: "text" as const,
        agentWritable: !readonlyCols.has(col),
      })),
      rowCount: SCALE_DEMO_ROWS,
      sourceFile: "node-room-states-scale",
      sheetName: "Company research",
      sheetNames: ["Company research"],
      parser: "scale_parity_seed",
      truncated: false,
      warnings: ["Only the first rendered window mounts in the DOM; the full 1,000-row sheet remains addressable."],
    },
    summary: "Scale parity room: 1,000 company rows with visible source, version, lock, and presence receipts.",
    tags: ["scale", "parity", "receipts"],
  };
}

function scaleResearchSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (let index = 0; index < SCALE_DEMO_ROWS; index += 1) {
    const rowId = scaleRowId(index);
    const row = scaleResearchRow(index);
    for (const col of RESEARCH_COLS) seed.push({ id: `${rowId}__${col}`, value: row[col] });
  }
  return seed;
}

/** First-viewport status mix (design: States & Scale shows every status within
 *  the opening rows, never a uniform wall of "complete"). Totals are preserved:
 *  6 complete + 4 enriching here, 34 + 14 in the remainder block below = the
 *  same 40/18 the filter chips recount from data. */
const VIEWPORT_STATUS_MIX = [
  "complete", "enriching", "enriching", "pending", "complete", "pending",
  "failed", "pending", "complete", "pending", "needs_review", "pending",
  "complete", "enriching", "pending", "pending", "complete", "pending",
  "needs_review", "pending", "complete", "pending", "enriching", "pending",
] as const;

function isScaleComplete(index: number): boolean {
  const mixed = index < VIEWPORT_STATUS_MIX.length ? VIEWPORT_STATUS_MIX[index] : null;
  return mixed ? mixed === "complete" : index < 58;
}

/** 0-based ordinal of a completed row among all completed rows (cached). */
let scaleCompleteOrdinals: Map<number, number> | null = null;
function scaleCompleteOrdinal(index: number): number {
  if (!scaleCompleteOrdinals) {
    scaleCompleteOrdinals = new Map();
    let ordinal = 0;
    for (let i = 0; i < 1_000; i += 1) {
      if (isScaleComplete(i)) scaleCompleteOrdinals.set(i, ordinal++);
    }
  }
  return scaleCompleteOrdinals.get(index) ?? Number.MAX_SAFE_INTEGER;
}

function scaleResearchRow(index: number): Record<(typeof RESEARCH_COLS)[number], unknown> {
  const mixed = index < VIEWPORT_STATUS_MIX.length ? VIEWPORT_STATUS_MIX[index] : null;
  const completed = mixed ? mixed === "complete" : index < 58;
  const enriching = mixed ? mixed === "enriching" : index >= 58 && index < 72;
  const needsReview = mixed ? mixed === "needs_review" : !completed && !enriching && index % 37 === 0;
  const failed = mixed ? mixed === "failed" : !completed && !enriching && !needsReview && index % 89 === 0;
  const company = scaleCompanyName(index);
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const primary = `https://research.noderoom.example/${slug}`;
  const secondary = `https://security.noderoom.example/${slug}`;
  const status = completed ? "complete" : enriching ? "enriching" : needsReview ? "needs_review" : failed ? "failed" : "pending";
  const evidence = completed ? [scaleEvidence(index, "Primary source", primary)] : [];
  // The first 7 COMPLETED rows carry a second (security) source — keyed on the
  // complete-row ordinal, not the raw index, so the 40 + 7 = 47 unique-source
  // receipt stays true regardless of how statuses are interleaved for display.
  const secondaryEvidence = completed && scaleCompleteOrdinal(index) < 7 ? [scaleEvidence(index, "Security source", secondary)] : [];
  const owner = SCALE_OWNERS[index % SCALE_OWNERS.length];
  const tier = index % 11 === 0 ? "B" : index % 19 === 0 ? "C" : "A";
  const intent = SCALE_INTENTS[index % SCALE_INTENTS.length];
  return {
    company,
    website: `https://${slug}.example`,
    status: completed ? scaleCell("complete", "complete", evidence.concat(secondaryEvidence), 0.91) : status,
    tier,
    intent,
    owner,
    crm_status: completed ? "Ready" : enriching ? "Researching" : needsReview ? "Review" : "Queued",
    summary: completed ? scaleCell(`${company} has sourced product, buyer, and deployment notes ready for partner review.`, "complete", evidence, 0.86) : "",
    funding: completed ? scaleCell(index % 3 === 0 ? "Venture-backed; current round needs partner confirmation." : "Funding profile sourced from primary/company materials.", "complete", evidence, 0.82) : "",
    headcount: completed ? scaleCell(`${70 + ((index * 17) % 420)} employees (source-backed range).`, "complete", evidence, 0.8) : "",
    recent_signal: completed ? scaleCell(SCALE_SIGNALS[index % SCALE_SIGNALS.length], "complete", evidence, 0.84) : "",
    source: completed ? scaleCell(primary, "complete", evidence, 0.9) : "",
    source2: secondaryEvidence.length ? scaleCell(secondary, "complete", secondaryEvidence, 0.88) : "",
    last_researched: completed ? scaleCell("2026-07-03", "complete", evidence, 0.9) : "",
  };
}

function scaleCell(value: string, status: CellPayload["status"], evidence: CellEvidence[], confidence: number): CellPayload {
  return { value, status, evidence, confidence, updatedByRunId: "scale-parity-run-01" };
}

function scaleEvidence(index: number, label: string, url: string): CellEvidence {
  const company = scaleCompanyName(index);
  return {
    id: `scale-src-${index + 1}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    kind: "source",
    label,
    url,
    snippet: `${company}: source-backed diligence receipt captured for the scale parity run.`,
    confidence: 0.86,
  };
}

function scaleRowId(index: number): string {
  return `sr_${String(index + 1).padStart(4, "0")}`;
}

const SCALE_COMPANIES = [
  "CardioNova", "Mercury", "Ramp", "Brex", "Pulley", "Northstar AI", "HarborGrid", "Aster Health",
  "RunwayOps", "LedgerLoop", "SignalForge", "Mosaic Bank", "Atlas Bio", "Keystone Robotics", "FoundryFlow",
];
const SCALE_SUFFIXES = ["Labs", "Systems", "Health", "Capital", "Works", "Cloud", "Grid", "Ops", "AI", "Data"];
const SCALE_OWNERS = ["Maya", "Sam", "Priya", "Homen", "Jordan", "Rina"];
const SCALE_INTENTS = [
  "AI triage for hospitals",
  "Startup banking diligence",
  "Middle market card + spend controls",
  "Cap table and equity ops",
  "Runway planning and milestone review",
  "Security posture refresh",
];
const SCALE_SIGNALS = [
  "New security page published; verify claims before IC.",
  "Hiring signal moved from engineering to GTM.",
  "Pricing page changed; check buyer segment fit.",
  "Partner note requested deployment references.",
  "Customer-story update is source-backed but needs quote review.",
];

function scaleCompanyName(index: number): string {
  if (index < SCALE_COMPANIES.length) return SCALE_COMPANIES[index];
  return `${SCALE_COMPANIES[index % SCALE_COMPANIES.length]} ${SCALE_SUFFIXES[index % SCALE_SUFFIXES.length]} ${Math.floor(index / SCALE_COMPANIES.length) + 1}`;
}

function createScaleCompanionArtifacts(roomId: string, me: Actor) {
  for (let i = 1; i <= 57; i += 1) {
    engine.createArtifact({
      roomId,
      kind: "sheet",
      title: `Scale workbook ${String(i).padStart(2, "0")}`,
      by: me,
      seed: [{ id: `r${i}__status`, value: i % 4 === 0 ? "complete" : "pending" }],
      meta: { dataframe: { columns: [{ id: "status", label: "status", order: 0, type: "text" }], rowCount: 1, sourceFile: "scale-companion", parser: "scale_parity_seed", truncated: false, warnings: [] }, tags: ["scale", "sheet"] },
    });
  }
  createScaleNotes(roomId, me, "Diligence doc", 71, "doc");
  createScaleNotes(roomId, me, "Capture Notebook", 28, "notebook");
  for (let i = 1; i <= 20; i += 1) {
    engine.createArtifact({
      roomId,
      kind: "note",
      title: `Source upload ${String(i).padStart(2, "0")}`,
      by: me,
      seed: [{ id: "doc", value: `<h1>Source upload ${i}</h1><p>Parsed source packet for the scale parity room.</p>` }],
      meta: {
        upload: { fileName: `source-packet-${String(i).padStart(2, "0")}.pdf`, mimeType: "application/pdf", size: 180_000 + i * 417, parsedAt: Date.now() },
        tags: ["scale", "upload"],
      },
    });
  }
  createScaleNotes(roomId, me, "Pinned proof", 6, "proof");
}

function createScaleNotes(roomId: string, me: Actor, prefix: string, count: number, tag: string) {
  for (let i = 1; i <= count; i += 1) {
    engine.createArtifact({
      roomId,
      kind: "note",
      title: `${prefix} ${String(i).padStart(2, "0")}`,
      by: me,
      seed: [{ id: "doc", value: `<h1>${prefix} ${i}</h1><p>Scale-room ${tag} artifact used to prove Binder grouping and search under load.</p>` }],
      meta: { tags: ["scale", tag] },
    });
  }
}

function seedScaleMessages(roomId: string, me: Actor, agent: Actor) {
  const priya = engine.listMembers(roomId).find((m) => m.name === "Priya");
  const priyaActor: Actor = priya ? { kind: "user", id: priya.id, name: priya.name } : me;
  engine.postMessage({ roomId, channel: "public", author: priyaActor, text: "Scale room is open: 1,000 companies, bulk receipts, and next-batch locks should stay readable.", clientMsgId: "scale-seed-priya", kind: "chat" });
  engine.postMessage({ roomId, channel: "public", author: me, text: "@nodeagent enrich the first batch, keep source receipts visible, and lock only the rows you are actively writing.", clientMsgId: "scale-seed-host", kind: "chat" });
  // Design parity: the chat exercises the message-type system (varied human
  // workflow lines), never a uniform filler wall of identical notes.
  const maya = engine.listMembers(roomId).find((m) => m.name === "Maya");
  const mayaActor: Actor = maya ? { kind: "user", id: maya.id, name: maya.name } : me;
  const guest = engine.listMembers(roomId).find((m) => m.name?.startsWith("anon"));
  const guestActor: Actor = guest ? { kind: "user", id: guest.id, name: guest.name } : priyaActor;
  const chatCast: Actor[] = [priyaActor, me, mayaActor, guestActor];
  const chatLines = (batch: number): string[] => [
    `Tier batch ${batch} A/B/C by wedge fit before we enrich — saves credits.`,
    `Funding column on batch ${batch} looks strong; flagging the two gap rows for review.`,
    `Pushing the memo draft after batch ${batch} finishes.`,
    `can we watch the artifacts and handoff drafts live?`,
    `Security posture rows in batch ${batch} need a second source before partner review.`,
    `Locking my edits to the CRM column while the agent writes batch ${batch}.`,
    `Recent-signal column is gold — partner notes updated for batch ${batch}.`,
    `@nodeagent recheck the needs_review rows in batch ${batch} when the lock clears.`,
  ];
  for (let i = 0; i < 309; i += 1) {
    const batch = Math.floor(i / 12) + 1;
    const lines = chatLines(batch);
    engine.postMessage({ roomId, channel: "public", author: chatCast[i % chatCast.length], text: lines[i % lines.length], clientMsgId: `scale-thread-${i + 1}`, kind: "chat" });
  }
  engine.postMessage({
    roomId,
    channel: "public",
    author: agent,
    text: "Researched 40 companies with 47 sources, committed the first sourced batch, and locked rows 4-6 for the next write window.",
    clientMsgId: "scale-agent-research-summary",
    kind: "agent",
    toolParts: [{ tool: "nodeagent.apply_outline_by_agent", status: "done", detail: "40 rows - 47 source receipts - active lock rows 4-6" }],
  });
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

let hackwithBayRoom: { roomId: string; me: Actor } | null = null;

/** #hackwithbay - a focused hackathon room that maps the BTB graph-agent demo. */
export function enterHackwithBayRoomAsHost(): { roomId: string; me: Actor } {
  if (hackwithBayRoom) return hackwithBayRoom;

  const { room, host } = engine.createRoom({ title: HACKWITHBAY_ROOM_TITLE, hostName: "HackwithBay Host", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: host.name };
  const agent: Actor = { kind: "agent", id: "agent_hackwithbay", name: "Nebius NodeAgent", scope: "public" };

  engine.createArtifact({
    roomId: room.id,
    kind: "note",
    title: "HackwithBay Demo Brief",
    by: me,
    seed: [{ id: "doc", value: HACKWITHBAY_BRIEF_NOTE }],
    meta: { summary: "Architecture and demo choreography for the HackwithBay 3.0 BankerToolBench graph-agent room.", tags: ["hackwithbay", "btb", "demo-brief"] },
  });

  engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "HackwithBay Integration Map",
    by: me,
    seed: hackwithBaySeed(HACKWITHBAY_GRAPH_ROWS, HACKWITHBAY_GRAPH_COLUMNS),
    meta: {
      dataframe: {
        columns: HACKWITHBAY_GRAPH_COLUMNS,
        rowCount: HACKWITHBAY_GRAPH_ROWS.length,
        sourceFile: "hackwithbay-3.0-node-room-map",
        parser: "hackwithbay_seed",
        truncated: false,
        warnings: [],
      },
      summary: "Load-bearing roles for Butterbase, Neo4j, RocketRide, Cognee, Nebius, Daytona, and Opsera in the BTB graph-agent demo.",
      tags: ["hackwithbay", "knowledge-graph", "btb"],
    },
  });

  engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "Provider Setup Checklist",
    by: me,
    seed: hackwithBaySeed(HACKWITHBAY_CHECKLIST_ROWS, HACKWITHBAY_CHECKLIST_COLUMNS),
    meta: {
      dataframe: {
        columns: HACKWITHBAY_CHECKLIST_COLUMNS,
        rowCount: HACKWITHBAY_CHECKLIST_ROWS.length,
        sourceFile: "hackwithbay-provider-setup",
        parser: "hackwithbay_seed",
        truncated: false,
        warnings: [],
      },
      summary: "Accounts, secrets, and demo receipts needed before the live hackathon run.",
      tags: ["hackwithbay", "setup", "providers"],
    },
  });

  engine.postMessage({
    roomId: room.id,
    channel: "public",
    author: me,
    text: "@nodeagent Run BankerToolBench task btb-067cb834 from uploaded sources, use the Nebius route, sync claims to Neo4j/Cognee, execute the validation script in Daytona, and return graph receipts.",
    clientMsgId: "hackwithbay-seed-user",
    kind: "chat",
  });
  engine.postMessage({
    roomId: room.id,
    channel: "public",
    author: agent,
    text: "Ready for the hackathon lane. Configure the provider keys, then I can run the BTB task through the room workflow and attach RocketRide, Neo4j, Cognee, Nebius, and Daytona receipts.",
    clientMsgId: "hackwithbay-seed-agent",
    kind: "agent",
    toolParts: [
      { tool: "rocketride.ingest_btb_task", status: "running", detail: "waiting for deployed workflow endpoint" },
      { tool: "neo4j.write_graph", status: "running", detail: "waiting for Aura credentials" },
      { tool: "daytona.run_code", status: "running", detail: "waiting for sandbox API key" },
    ],
  });
  engine.trace(
    room.id,
    agent,
    "agent_status",
    "HackwithBay 3.0 route seeded for BTB upload, graph memory, Nebius agent chat, Daytona code execution, and provider setup receipts.",
    { route: "#/hackwithbay", btbTask: BTB_UI_EVIDENCE.taskId },
    "This is a demo map until provider accounts and keys are configured.",
  );

  hackwithBayRoom = { roomId: room.id, me };
  return hackwithBayRoom;
}

export function joinRoomByCode(code: string, name: string): { roomId: string; me: Actor } | null {
  const res = engine.joinRoom({ code: code.trim(), name: name.trim() || "Guest" });
  if (!res) return null;
  return { roomId: res.room.id, me: { kind: "user", id: res.member.id, name: res.member.name } };
}

// ── UpScaleX demo room (#upscalex) — Mark Liu's portfolio + network, seeded for the knowledge graph.
//    The Graph tab derives company / founder / lead / investor nodes from this sheet's rows. Company,
//    founder, and sector are from the LinkedIn-verified deep dive; the `lead` column is intentionally
//    BLANK — the team fills who owns each deal, which is what connects each partner to the graph (and
//    avoids asserting deal-ownership the partners would catch). All cells are editable in the demo.
let upscalexRoom: { roomId: string; me: Actor } | null = null;
const UPSCALEX_PORTFOLIO_COLS: DataframeColumn[] = [
  { id: "company", label: "Company", order: 0, type: "text" },
  { id: "founder", label: "Founder", order: 1, type: "text" },
  { id: "lead", label: "UpScaleX lead", order: 2, type: "text" },
  { id: "lead_investor", label: "Lead investor", order: 3, type: "text" },
  { id: "sector", label: "Sector", order: 4, type: "text" },
  { id: "stage", label: "Stage", order: 5, type: "text" },
  { id: "notes", label: "Notes", order: 6, type: "text" },
];
const UPSCALEX_PORTFOLIO: Array<Record<string, string>> = [
  { company: "MAI Agents", founder: "Yuchen W.", lead: "", lead_investor: "UpScaleX", sector: "AI performance marketing", stage: "Seed", notes: "MAI Insights + Canvas; Prime Day launch" },
  { company: "Blueberry", founder: "Nima Mozhgani", lead: "", lead_investor: "Founders Inc", sector: "Agentic social commerce", stage: "Seed", notes: "1:1 social-DM marketing at scale" },
  { company: "Expertise AI", founder: "Hao Sheng", lead: "", lead_investor: "UpScaleX", sector: "AI B2B sales", stage: "Seed", notes: "#1 on HubSpot Marketplace" },
  { company: "BeFreed", founder: "Jisong L.", lead: "", lead_investor: "645 Ventures", sector: "AI audio learning", stage: "Seed", notes: "audio agent for learning" },
  { company: "Dex", founder: "Reni Cao", lead: "Alan Zong", lead_investor: "UpScaleX", sector: "AI EdTech / hardware", stage: "Pre-seed", notes: "AI learning camera; CES 2026 honoree" },
  { company: "Dimension Studios", founder: "Ali Mirzaei", lead: "Alan Zong", lead_investor: "Science Inc", sector: "Agentic social commerce", stage: "Seed", notes: "AI OS for TikTok Shop" },
  { company: "Make the Dot", founder: "Emilie H.", lead: "", lead_investor: "UpScaleX", sector: "AI fashion design", stage: "Seed", notes: "design-to-production" },
  { company: "Daxo", founder: "Tom Zhang", lead: "", lead_investor: "UpScaleX", sector: "AI robotics", stage: "Seed", notes: "dexterous robotic hands (verify founder)" },
  { company: "Sentrial", founder: "Neel Sharma", lead: "", lead_investor: "Y Combinator", sector: "Agent reliability", stage: "Pre-seed", notes: "YC W26; agent eval/testing" },
  { company: "Sourcy", founder: "Karl Chan", lead: "", lead_investor: "UpScaleX", sector: "Cross-border e-commerce", stage: "Seed", notes: "prompt-to-product sourcing" },
  { company: "Curator", founder: "Pavan Otthi", lead: "", lead_investor: "UpScaleX", sector: "Agentic brand ops", stage: "Seed", notes: "back-office automation" },
  { company: "Tioga", founder: "Jean-Nicolas Vollmer", lead: "", lead_investor: "UpScaleX", sector: "Agentic commerce", stage: "Seed", notes: "" },
  { company: "Midas Touch", founder: "Cordelia Xiao", lead: "", lead_investor: "UpScaleX", sector: "Consumer commerce", stage: "Seed", notes: "" },
  { company: "WorkDuo AI", founder: "Fiona Lau", lead: "", lead_investor: "UpScaleX", sector: "Agentic commerce", stage: "Seed", notes: "" },
];

/** #upscalex — a fresh room seeded with the UpScaleX portfolio so the Graph tab renders Mark's network. */
export function enterUpScaleXRoomAsHost(): { roomId: string; me: Actor } {
  if (upscalexRoom) return upscalexRoom;
  const { room, host } = engine.createRoom({ title: "UpScaleX — Portfolio & Network", hostName: "Mark Liu", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: host.name };
  engine.createArtifact({
    roomId: room.id,
    kind: "note",
    title: "Start here",
    by: me,
    seed: [{ id: "doc", value: "<h1>Start here</h1><p>Your UpScaleX portfolio as a living graph — companies, founders, and investors in one place.</p><ul><li><b>Open the “Graph” tab</b> (top of the work surface): click any node to trace its connections, click the canvas to reset.</li><li><b>Click “UpScaleX”</b> to light up the whole portfolio, or any founder to see their company.</li><li><b>Fill the “UpScaleX lead” column</b> in the Portfolio sheet (who owns each deal) — then clicking your own name shows your deals.</li></ul><p>Everything is editable — double-click any cell to correct it. Nothing here leaves your room.</p>" }],
    meta: { summary: "How to read this room: open the Graph tab, click nodes to trace connections, fill the lead column.", tags: ["upscalex", "readme"] },
  });
  const seed: Array<{ id: string; value: unknown }> = [];
  UPSCALEX_PORTFOLIO.forEach((row, i) => {
    const rid = `r${i + 1}`;
    for (const col of UPSCALEX_PORTFOLIO_COLS) seed.push({ id: `${rid}__${col.id}`, value: row[col.id] ?? "" });
  });
  engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "UpScaleX Portfolio",
    by: me,
    seed,
    meta: {
      dataframe: { columns: UPSCALEX_PORTFOLIO_COLS, rowCount: UPSCALEX_PORTFOLIO.length, sourceFile: "upscalex-deep-dive", parser: "upscalex_seed", truncated: false, warnings: [] },
      summary: "UpScaleX portfolio + network — companies, founders, and investors seeded for the knowledge graph. Fill the 'UpScaleX lead' column to connect each partner to their deals.",
      tags: ["upscalex", "portfolio", "vc", "network"],
    },
  });
  upscalexRoom = { roomId: room.id, me };
  return upscalexRoom;
}

export function runDemo(conflict: boolean): Promise<void> {
  const reduced = window.matchMedia?.("(prefers-reduced-motion:reduce)").matches ?? false;
  return playCollab(engine, demo, { reduced, conflict });
}
