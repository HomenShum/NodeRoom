/**
 * Demo room - startup banking diligence.
 *
 * The spreadsheet is a financial model: rows (Revenue, COGS, Gross profit, OpEx,
 * Net income) with read-only label/Q2/Q3 and editable Variance/Note cells, stored
 * as engine elements `${rowId}__${col}`. The collab: the Room Agent locks the
 * Revenue + COGS variance cells and commits them; the private agent drafts the
 * Gross-profit + Net-income variance around the lock; on release it smart-merges.
 */

import { RoomEngine } from "./roomEngine";
import type { Actor, ChangeOp, ToolPart } from "./types";

export const SHEET_COLS = ["label", "q2", "q3", "variance", "note"] as const;
export const SHEET_ROWS = [
  { id: "r_rev", label: "Revenue", q2: "$10,000", q3: "$12,400" },
  { id: "r_cogs", label: "COGS", q2: "$4,000", q3: "$5,100" },
  { id: "r_gp", label: "Gross profit", q2: "$6,000", q3: "$7,300" },
  { id: "r_opex", label: "OpEx", q2: "$2,200", q3: "$2,650" },
  { id: "r_ni", label: "Net income", q2: "$3,800", q3: "$4,650" },
];

/** ParselyFi / GTM tabular-research surface: account list, status-gated. */
export const RESEARCH_COLS = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;
const RESEARCH_EVIDENCE_COLS = new Set(["summary", "funding", "headcount", "recent_signal"]);
const RESEARCH_AGENT_READONLY_COLS = new Set(["company", "website", "tier", "intent", "owner", "crm_status"]);

export const RESEARCH_COMPANIES = [
  { id: "rc_cardionova", company: "CardioNova", url: "https://cardionova.example", source2Url: "https://cardionova.example/security", tier: "A", intent: "AI triage for hospitals", owner: "Maya", crmStatus: "New" },
  { id: "rc_mercury", company: "Mercury", url: "https://mercury.com", source2Url: "https://www.linkedin.com/company/mercurybank/", tier: "A", intent: "Startup banking diligence", owner: "Maya", crmStatus: "Watch" },
  { id: "rc_ramp", company: "Ramp", url: "https://ramp.com", source2Url: "https://www.linkedin.com/company/ramp/", tier: "A", intent: "Middle market card + spend controls", owner: "Sam", crmStatus: "Target" },
  { id: "rc_brex", company: "Brex", url: "https://www.brex.com", source2Url: "https://www.linkedin.com/company/brexhq/", tier: "A", intent: "Startup banking and expense workflow", owner: "Maya", crmStatus: "Warm" },
  { id: "rc_pulley", company: "Pulley", url: "https://pulley.com", source2Url: "https://www.linkedin.com/company/pulley/", tier: "B", intent: "Cap table and equity ops", owner: "Sam", crmStatus: "Research" },
];
/** Scripted enrichment targets for the no-keys path (the live LLM researches for real instead). */
export const RESEARCH_PLAN = [
  { rowId: "rc_cardionova", summary: "AI triage workflow for hospital intake; verify buyer, deployment references, and HIPAA/security claims before IC use.", funding: "Series B profile is claimed in call notes; requires sourced confirmation.", headcount: "Unknown; agent should use provider research or leave a gap reason.", recentSignal: "Banker call flagged hospital intake automation as the key diligence angle.", sourceUrl: "https://cardionova.example", source2Url: "https://cardionova.example/security" },
  { rowId: "rc_mercury", summary: "Startup banking and treasury platform relevant to founder-led operating accounts.", funding: "Late-stage startup banking profile; refresh from primary sources before partner use.", headcount: "Scaled fintech team; update with provider/API data.", recentSignal: "Startup treasury and operating-account workflow remains the main bank adjacency.", sourceUrl: "https://mercury.com", source2Url: "https://www.linkedin.com/company/mercurybank/" },
  { rowId: "rc_ramp", summary: "Spend management, cards, procurement, and AP platform for finance teams.", funding: "Late-stage fintech profile; refresh current round and valuation from sources.", headcount: "Scaled finance automation team.", recentSignal: "Procurement and card controls are relevant to middle-market banking conversations.", sourceUrl: "https://ramp.com", source2Url: "https://www.linkedin.com/company/ramp/" },
  { rowId: "rc_brex", summary: "Corporate cards, banking-adjacent cash workflow, and expense automation for startups.", funding: "Late-stage fintech with major venture backing; verify latest financing.", headcount: "Scaled global fintech team.", recentSignal: "Startup banking and expense workflow overlaps the diligence reference workflow.", sourceUrl: "https://www.brex.com", source2Url: "https://www.linkedin.com/company/brexhq/" },
  { rowId: "rc_pulley", summary: "Cap table and equity operations platform for startup finance and legal teams.", funding: "Venture-backed SaaS profile; refresh latest funding and hiring signals.", headcount: "Mid-market startup ops team; verify current headcount.", recentSignal: "Equity ops connects to startup banking onboarding and founder services.", sourceUrl: "https://pulley.com", source2Url: "https://www.linkedin.com/company/pulley/" },
];
export const CAPTURE_NOTEBOOK_DOC = "<h1>Capture Notebook</h1><p>Who did you talk to? What changed? What should we verify next? Drop messy notes here, then pause — NodeRoom will notice the signals worth returning to.</p>";
export const WIKI_DOC = "Living wiki for room state, file inventory, agent sessions, workflows, backend map, and recent trace evidence. It updates from artifacts, sessions, runs, and traces.";

function researchMeta() {
  return {
    dataframe: {
      columns: RESEARCH_COLS.map((col, order) => ({
        id: col,
        label: col.replace(/_/g, " "),
        order,
        mode: RESEARCH_EVIDENCE_COLS.has(col) ? "enrich" as const : "manual" as const,
        type: "text" as const,
        agentWritable: !RESEARCH_AGENT_READONLY_COLS.has(col),
      })),
      rowCount: RESEARCH_COMPANIES.length,
      sourceFile: "starter-room",
      sheetName: "Company research",
      sheetNames: ["Company research"],
      parser: "starter_seed",
      truncated: false,
      warnings: [],
    },
  };
}

function runwaySeed() {
  const rows = [
    { id: "rw_cardionova", company: "CardioNova", cash: "Unknown", burn: "Unknown", runway: "Gap: needs sourced cash and burn", status: "needs_evidence", milestones: "HIPAA/security review; hospital reference checks; pricing proof" },
    { id: "rw_pulley", company: "Pulley", cash: "Unknown", burn: "Unknown", runway: "Gap: refresh financing and hiring signals", status: "needs_evidence", milestones: "Cap-table workflow proof; founder-services fit; competitor map" },
  ];
  const cols = ["company", "cash", "burn", "runway", "status", "milestones"] as const;
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const row of rows) for (const col of cols) seed.push({ id: `${row.id}__${col}`, value: row[col] });
  return seed;
}

function runwayMeta() {
  const cols = ["company", "cash", "burn", "runway", "status", "milestones"] as const;
  return {
    dataframe: {
      columns: cols.map((col, order) => ({ id: col, label: col, order, mode: col === "runway" || col === "milestones" ? "compute" as const : "manual" as const, type: "text" as const, agentWritable: col !== "company" })),
      rowCount: 2,
      sourceFile: "starter-room",
      sheetName: "Runway / milestones",
      sheetNames: ["Runway / milestones"],
      parser: "starter_seed",
      truncated: false,
      warnings: [],
    },
  };
}

function workplanDoc() {
  return [
    "<h1>Open diligence questions / workplan</h1>",
    "<ul>",
    "<li>CardioNova: verify product claims, hospital buyer, funding history, deployment references, and HIPAA/security posture.</li>",
    "<li>Bulk batch: enrich Mercury, Ramp, Brex, and Pulley with product, hiring, pricing, competitors, and market headwinds.</li>",
    "<li>Runway: compute only from sourced cash and burn assumptions; leave blank with reason when inputs are missing.</li>",
    "<li>Handoff: prepare Gmail, Notion, Slack, Linear, LinkedIn, and CRM CSV drafts after human review.</li>",
    "</ul>",
  ].join("");
}

export interface DemoRoom {
  roomId: string;
  me: Actor;
  members: { homen: Actor; priya: Actor; quokka: Actor };
  agents: { room: Actor; priv: Actor };
  sessions: { room: string; priv: string };
  wikiId: string;
  sheetId: string;
  researchId: string;
  noteId: string;
  wallId: string;
}

export function buildDemoRoom(engine: RoomEngine): DemoRoom {
  const { room, host } = engine.createRoom({ title: "Startup diligence", hostName: "Homen", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: "Homen" };
  const priyaM = engine.joinRoom({ code: room.code, name: "Priya", anon: false })!.member;
  const quokkaM = engine.joinRoom({ code: room.code, name: "anon · quokka" })!.member;
  const priya: Actor = { kind: "user", id: priyaM.id, name: "Priya" };
  const quokka: Actor = { kind: "user", id: quokkaM.id, name: "anon · quokka" };

  const seed: Array<{ id: string; value: unknown }> = [];
  for (const r of SHEET_ROWS) {
    seed.push({ id: `${r.id}__label`, value: r.label });
    seed.push({ id: `${r.id}__q2`, value: r.q2 });
    seed.push({ id: `${r.id}__q3`, value: r.q3 });
    seed.push({ id: `${r.id}__variance`, value: "" });
    seed.push({ id: `${r.id}__note`, value: "" });
  }
  engine.createArtifact({ roomId: room.id, kind: "note", title: "Capture Notebook", by: me, seed: [{ id: "doc", value: CAPTURE_NOTEBOOK_DOC }] });
  const wikiId = engine.createArtifact({ roomId: room.id, kind: "note", title: "Agent wiki", by: me, seed: [{ id: "doc", value: WIKI_DOC }] }).id;
  const sheetId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Q3 variance", by: me, seed }).id;

  const researchSeed: Array<{ id: string; value: unknown }> = [];
  for (const c of RESEARCH_COMPANIES) {
    const vals: Record<(typeof RESEARCH_COLS)[number], string> = {
      company: c.company, website: c.url, status: "pending", tier: c.tier, intent: c.intent, owner: c.owner, crm_status: c.crmStatus,
      summary: "", funding: "", headcount: "", recent_signal: "", source: "", source2: "", last_researched: "",
    };
    for (const col of RESEARCH_COLS) researchSeed.push({ id: `${c.id}__${col}`, value: vals[col] });
  }
  // Research is a BLANK sheet the agent populates (Quadratic-style) — same ExcelGridSheet as any sheet,
  // so it inherits the Attention Overlay. The agent writes headers + rows into the empty A1 grid.
  const researchId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Company research", by: me, seed: [], meta: { excelGrid: { rows: 50, columns: 8, sheetName: "Company research" } } }).id;
  engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Runway / milestones", by: me, seed: runwaySeed(), meta: runwayMeta() });

  const noteId = engine.createArtifact({
    roomId: room.id, kind: "note", title: "Diligence memo", by: me,
    seed: [{ id: "doc", value: "<h1>Startup banking diligence memo</h1><p>Use the Company research sheet for sourced company-level findings, then convert runway and milestone gaps into banker-ready follow-ups. Null cells are real missing inputs, not delete instructions; the agent should leave a clear gap reason when cash, burn, pricing, hiring, or funding proof is unavailable.</p>" }],
  }).id;
  engine.createArtifact({ roomId: room.id, kind: "note", title: "Open questions / workplan", by: me, seed: [{ id: "doc", value: workplanDoc() }] });

  const wallId = engine.createArtifact({
    roomId: room.id, kind: "wall", title: "Risk / opportunity wall", by: me,
    seed: [
      { id: "s1", value: { text: "CardioNova: verify HIPAA/security and hospital references before IC.", x: 28, y: 26, color: "#E8C9B8" } },
      { id: "s2", value: { text: "Bulk batch: refresh product, pricing, hiring, competitors, and market headwinds.", x: 232, y: 70, color: "#CBD2F0" } },
      { id: "s3", value: { text: "Runway chart needs sourced cash and burn assumptions.", x: 116, y: 196, color: "#C5DBCB" } },
    ],
  }).id;

  const room_ = engine.startSession({ roomId: room.id, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public" });
  const privA = engine.startSession({ roomId: room.id, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: me.id });

  engine.postMessage({ roomId: room.id, channel: "public", author: priya, text: "Starting the startup-banking diligence room - CardioNova first, then the bulk batch.", clientMsgId: "seed1", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: "public", author: quokka, text: "joined as a guest. can watch the artifacts and handoff drafts live?", clientMsgId: "seed2", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: { private: me.id }, author: me, text: "Private: flag any missing runway assumptions before we publish to the room.", clientMsgId: "seed3", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: { private: me.id }, author: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: me.id }, text: "I will keep unknown cash, burn, pricing, hiring, and funding inputs as explicit gaps until a source supports them. This stays private until you promote it.", clientMsgId: "seed4", kind: "agent" });

  return {
    roomId: room.id, me, members: { homen: me, priya, quokka },
    agents: { room: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" }, priv: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: me.id } },
    sessions: { room: room_.id, priv: privA.id },
    wikiId, sheetId, researchId, noteId, wallId,
  };
}

const op = (opId: string, artifactId: string, elementId: string, value: unknown, baseVersion: number): ChangeOp =>
  ({ opId, artifactId, elementId, kind: "set", value, baseVersion });
const wait = (ms: number, reduced: boolean) => new Promise<void>((r) => setTimeout(r, reduced ? 0 : ms));

/** Lock → commit → release → draft-merge over the variance column. */
export async function playCollab(engine: RoomEngine, d: DemoRoom, opts: { reduced?: boolean; conflict?: boolean; log?: (s: string) => void } = {}): Promise<void> {
  const reduced = !!opts.reduced;
  const log = opts.log ?? (() => {});
  const ver = (id: string) => engine.getArtifact(d.sheetId)!.elements[id].version;
  const tp = (parts: ToolPart[]) => parts;

  if (opts.conflict) {
    const host: Actor = { kind: "user", id: d.members.homen.id, name: d.members.homen.name };
    const elementId = "r_rev__variance";
    const baseVersion = ver(elementId);
    const lock = engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: [elementId], holder: host, sessionId: "host-conflict-drill", reason: "host reviewing the revenue variance" });
    if (!lock.ok) return;
    engine.postMessage({ roomId: d.roomId, channel: "public", author: d.agents.room, text: "I'll draft a revenue variance change while the host is reviewing that cell. If the host changes it first, semantic rebase will route my stale patch to review.", clientMsgId: `crs1-${Date.now()}`, kind: "agent", toolParts: tp([{ tool: "nodeagent.create_draft", status: "running", detail: "Revenue variance - stale baseline" }]) });
    const draft = engine.createDraft({
      roomId: d.roomId,
      artifactId: d.sheetId,
      author: d.agents.room,
      blockedByLockId: lock.lock.id,
      note: "Revenue variance stale-patch drill",
      ops: [op(`crs_rev_${baseVersion}`, d.sheetId, elementId, "+19%", baseVersion)],
    });
    await wait(400, reduced);
    engine.applyEdit({ roomId: d.roomId, op: op(`host_rev_${baseVersion}`, d.sheetId, elementId, "+24%", baseVersion), actor: host });
    const released = engine.releaseLock(lock.lock.id, host);
    const merged = released.merged.find((item) => item.draftId === draft.id);
    engine.postMessage({ roomId: d.roomId, channel: "public", author: d.agents.room, text: merged?.semantic?.proposalIds.length ? "Semantic rebase opened a review proposal instead of overwriting the host's Revenue variance." : "Revenue variance was already reconciled; no review proposal was needed.", clientMsgId: `crs2-${Date.now()}`, kind: "agent", toolParts: tp([{ tool: "nodeagent.semantic_rebase", status: merged?.semantic?.proposalIds.length ? "error" : "done", detail: merged?.resolution.note ?? "merged" }]) });
    log(`Semantic rebase drill: ${merged?.resolution.verdict}`);
    return;
  }

  const m1 = engine.postMessage({ roomId: d.roomId, channel: "public", author: d.agents.room, text: "On it. Gathering room context, then I'll propose a versioned delta to the variance column. I'll lock just the rows I touch.", clientMsgId: "ra1", kind: "agent", toolParts: tp([{ tool: "propose_lock", status: "running", detail: "Variance · r_rev, r_cogs" }]) })!;
  const lr = engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: ["r_rev__variance", "r_cogs__variance"], holder: d.agents.room, sessionId: d.sessions.room, reason: "recompute Q3 variance from the NetSuite export" });
  const lockId = lr.ok ? lr.lock.id : "";
  engine.updateMessage(m1.id, { toolParts: [{ tool: "nodeagent.propose_lock", status: "done", detail: "locked Variance on Revenue, COGS" }] });
  log("Room Agent locked Variance on Revenue, COGS");
  await wait(750, reduced);

  const aware = engine.awareness(d.roomId, "agent_priv");
  engine.postMessage({ roomId: d.roomId, channel: { private: d.members.homen.id }, author: d.agents.priv, text: `Room Agent holds Variance on Revenue, COGS (read-only). I can still read it as context — I'll draft Variance for Gross profit and Net income around the lock.`, clientMsgId: "pa1", kind: "agent", toolParts: tp([{ tool: "context.read_locked", status: "done", detail: `${aware.activeLocks.length} lock · read-only, used for reasoning` }]) });
  await wait(750, reduced);

  engine.applyEdit({ roomId: d.roomId, op: op("ra_rev", d.sheetId, "r_rev__variance", "+24%", ver("r_rev__variance")), actor: d.agents.room });
  engine.applyEdit({ roomId: d.roomId, op: op("ra_cogs", d.sheetId, "r_cogs__variance", "+27.5%", ver("r_cogs__variance")), actor: d.agents.room });
  engine.postMessage({ roomId: d.roomId, channel: "public", author: d.agents.room, text: "Committed Variance for Revenue and COGS through the sync tool. Lock released.", clientMsgId: "ra2", kind: "agent", toolParts: tp([{ tool: "nodeagent.apply_spreadsheet_delta", status: "done", detail: "set_cell · +24%, +27.5%" }]) });
  log("Room Agent committed Variance +24%, +27.5%");
  await wait(700, reduced);

  const ops: ChangeOp[] = [op("pa_gp", d.sheetId, "r_gp__variance", "+21.7%", ver("r_gp__variance")), op("pa_ni", d.sheetId, "r_ni__variance", "+22.4%", ver("r_ni__variance"))];
  if (opts.conflict) ops.push(op("pa_rev", d.sheetId, "r_rev__variance", "+19%", 1));
  const draft = engine.createDraft({ roomId: d.roomId, artifactId: d.sheetId, author: d.agents.priv, blockedByLockId: lockId, note: "Variance for Gross profit, Net income", ops });
  log(`Private agent drafted ${ops.length} variance change(s)`);
  await wait(800, reduced);

  const released = engine.releaseLock(lockId, d.agents.room);
  const m = released.merged.find((x) => x.draftId === draft.id);
  engine.postMessage({ roomId: d.roomId, channel: { private: d.members.homen.id }, author: d.agents.priv, text: m && m.conflicts.length ? `Smart-merge needs review: ${m.resolution.note}.` : "Smart-merged my drafted Variance for Gross profit and Net income on top of canonical state.", clientMsgId: "pa2", kind: "agent", toolParts: tp([{ tool: "nodeagent.smart_merge", status: m && m.conflicts.length ? "error" : "done", detail: m?.resolution.note ?? "merged" }]) });
  log(`Smart-merge: ${m?.resolution.verdict}`);
}
