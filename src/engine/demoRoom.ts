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
import type { Actor, CellPayload, ChangeOp, ToolPart } from "./types";

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
  { id: "rc_cardionova", company: "CardioNova", url: "https://cardionova.com", source2Url: "https://cardionova.com/security", status: "complete", tier: "A", intent: "Cap table and hospital AI diligence", owner: "Maya", crmStatus: "New" },
  { id: "rc_neuronova", company: "NeuroNova", url: "https://neuronova.com", source2Url: "https://neuronova.com/security", status: "enriching", tier: "B", intent: "Middle-market clinical workflow", owner: "Sam", crmStatus: "Watch" },
  { id: "rc_fluxnova", company: "FluxNova", url: "https://fluxnova.com", source2Url: "https://fluxnova.com/security", status: "complete", tier: "A", intent: "Startup treasury automation", owner: "Priya", crmStatus: "Ready" },
  { id: "rc_atlasnova", company: "AtlasNova", url: "https://atlasnova.com", source2Url: "https://atlasnova.com/security", status: "pending", tier: "C", intent: "Warehouse ops underwriting", owner: "Homen", crmStatus: "Queued" },
  { id: "rc_vertexnova", company: "VertexNova", url: "https://vertexnova.com", source2Url: "https://vertexnova.com/security", status: "complete", tier: "A", intent: "Clinical data exchange", owner: "Maya", crmStatus: "Ready" },
  { id: "rc_lumennova", company: "LumenNova", url: "https://lumennova.com", source2Url: "https://lumennova.com/security", status: "pending", tier: "B", intent: "Cap table automation", owner: "Sam", crmStatus: "Queued" },
  { id: "rc_harbornova", company: "HarborNova", url: "https://harbornova.com", source2Url: "https://harbornova.com/security", status: "complete", tier: "A", intent: "AI triage and intake", owner: "Priya", crmStatus: "Ready" },
  { id: "rc_crestnova", company: "CrestNova", url: "https://crestnova.com", source2Url: "https://crestnova.com/security", status: "pending", tier: "A", intent: "Revenue operations", owner: "Homen", crmStatus: "Queued" },
  { id: "rc_nimbusnova", company: "NimbusNova", url: "https://nimbusnova.com", source2Url: "https://nimbusnova.com/security", status: "enriching", tier: "B", intent: "Freight risk workflow", owner: "Maya", crmStatus: "Researching" },
  { id: "rc_quantanova", company: "QuantaNova", url: "https://quantanova.com", source2Url: "https://quantanova.com/security", status: "failed", tier: "A", intent: "SMB payments evidence", owner: "Sam", crmStatus: "Blocked" },
  { id: "rc_helionova", company: "HelioNova", url: "https://helionova.com", source2Url: "https://helionova.com/security", status: "complete", tier: "B", intent: "Startup climate ops", owner: "Priya", crmStatus: "Ready" },
  { id: "rc_orbitnova", company: "OrbitNova", url: "https://orbitnova.com", source2Url: "https://orbitnova.com/security", status: "pending", tier: "C", intent: "Logistics diligence", owner: "Homen", crmStatus: "Queued" },
  { id: "rc_pulsenova", company: "PulseNova", url: "https://pulsenova.com", source2Url: "https://pulsenova.com/security", status: "needs_review", tier: "A", intent: "Pulse survey evidence", owner: "Maya", crmStatus: "Review" },
  { id: "rc_verdenova", company: "VerdeNova", url: "https://verdenova.com", source2Url: "https://verdenova.com/security", status: "complete", tier: "B", intent: "Carbon accounting workflow", owner: "Sam", crmStatus: "Ready" },
];
/** Scripted enrichment targets for the no-keys path (the live LLM researches for real instead). */
export const RESEARCH_PLAN = [
  { rowId: "rc_cardionova", summary: "AI triage workflow for hospital intake; verify buyer, deployment references, and HIPAA/security claims before IC use.", funding: "Series B profile is claimed in call notes; requires sourced confirmation.", headcount: "Unknown; agent should use provider research or leave a gap reason.", recentSignal: "Banker call flagged hospital intake automation as the key diligence angle.", sourceUrl: "https://cardionova.example", source2Url: "https://cardionova.example/security" },
  { rowId: "rc_mercury", summary: "Startup banking and treasury platform relevant to founder-led operating accounts.", funding: "Late-stage startup banking profile; refresh from primary sources before partner use.", headcount: "Scaled fintech team; update with provider/API data.", recentSignal: "Startup treasury and operating-account workflow remains the main bank adjacency.", sourceUrl: "https://mercury.com", source2Url: "https://www.linkedin.com/company/mercurybank/" },
  { rowId: "rc_ramp", summary: "Spend management, cards, procurement, and AP platform for finance teams.", funding: "Late-stage fintech profile; refresh current round and valuation from sources.", headcount: "Scaled finance automation team.", recentSignal: "Procurement and card controls are relevant to middle-market banking conversations.", sourceUrl: "https://ramp.com", source2Url: "https://www.linkedin.com/company/ramp/" },
  { rowId: "rc_brex", summary: "Corporate cards, banking-adjacent cash workflow, and expense automation for startups.", funding: "Late-stage fintech with major venture backing; verify latest financing.", headcount: "Scaled global fintech team.", recentSignal: "Startup banking and expense workflow overlaps the diligence reference workflow.", sourceUrl: "https://www.brex.com", source2Url: "https://www.linkedin.com/company/brexhq/" },
  { rowId: "rc_pulley", summary: "Cap table and equity operations platform for startup finance and legal teams.", funding: "Venture-backed SaaS profile; refresh latest funding and hiring signals.", headcount: "Mid-market startup ops team; verify current headcount.", recentSignal: "Equity ops connects to startup banking onboarding and founder services.", sourceUrl: "https://pulley.com", source2Url: "https://www.linkedin.com/company/pulley/" },
];
export const CAPTURE_NOTEBOOK_DOC = [
  "<h1>CardioNova — diligence brief</h1>",
  "<p><strong>Funding.</strong> CardioNova closed a <strong>$14M Series A</strong> led by Meridian Health Ventures in February. The round funds hospital-triage deployments in three systems; recognized Q3 revenue reconciles to <strong>$12,400</strong> against the NetSuite close.</p>",
  "<blockquote>We only sell where the triage model has run against the hospital's own historical admits.</blockquote>",
  "<h2>Claim</h2>",
  "<p data-status=\"needs_review\"><strong>Series A totals $14M, led by Meridian Health Ventures.</strong></p>",
  "<ul>",
  "<li data-author-kind=\"agent\">verified — Crunchbase confirms the lead investor and amount.</li>",
  "<li data-author-kind=\"agent\" data-status=\"needs_review\">conflict — PitchBook lists total raised at $12M.</li>",
  "</ul>",
  "<h2>Embedded sheet context</h2>",
  "<pre><code>ACCOUNT        Q3        VARIANCE\nRevenue        $12,400   +24%\nCOGS           $5,100    +27.5%\nGross profit   $7,300    +21.7%</code></pre>",
  "<h2>Risk</h2>",
  "<ul><li>Deck claims runway of ~14 months at current burn; hiring plan adds 6 heads in Q4.</li><li>Security source still needs a named hospital deployment reference.</li></ul>",
].join("");
const CAPTURE_NOTEBOOK_CLOUD_DOC = [
  "<h1 data-blockid=\"nb-title\">CardioNova &mdash; diligence brief</h1>",
  "<p data-blockid=\"nb-meta\" data-status=\"draft\"><code>notebook &middot; v12</code> <code>3 sources</code> <code>draft</code></p>",
  "<h2 data-blockid=\"nb-funding\">Funding</h2>",
  "<p data-blockid=\"nb-funding-p\" data-author-kind=\"agent\">CardioNova closed a <strong>$14M Series A</strong> led by Meridian Health Ventures in <a href=\"https://crunchbase.com/org/cardionova\">February</a>. The round funds hospital-triage deployments in three systems; recognized Q3 revenue reconciles to <strong>$12,400</strong> against the <a href=\"https://netsuite.example.com/close/q3\">NetSuite close</a>.</p>",
  "<h2 data-blockid=\"nb-claim-h\">Claim</h2>",
  "<p data-blockid=\"nb-claim\" data-status=\"needs_review\"><strong>Series A totals $14M, led by Meridian Health Ventures.</strong></p>",
  "<ul>",
  "<li data-blockid=\"nb-src-1\" data-author-kind=\"agent\"><code data-tone=\"verified\">verified</code> Crunchbase &mdash; <a href=\"https://crunchbase.com/org/cardionova\">&ldquo;$14M, led by Meridian Health Ventures&rdquo;</a></li>",
  "<li data-blockid=\"nb-src-2\" data-author-kind=\"agent\"><code data-tone=\"conflict\">conflict</code> PitchBook lists total raised at <a href=\"https://pitchbook.com/profiles/company/cardionova\">$12M</a>.</li>",
  "</ul>",
  "<blockquote data-blockid=\"nb-quote\">We only sell where the triage model has run against the hospital's own historical admits.</blockquote>",
  "<p data-blockid=\"nb-quote-source\" data-status=\"quote_source\">CEO, first partner call &middot; captured to room memory</p>",
  "<p data-blockid=\"nb-sheet-head\" data-status=\"synced\"><strong>Q3 variance &middot; Sheet</strong> synced &middot; v247</p>",
  "<pre data-blockid=\"nb-sheet\"><code>ACCOUNT        Q3        VARIANCE\nRevenue        $12,400   +24%\nCOGS           $5,100    +27.5%\nGross profit   $7,300    +21.7%</code></pre>",
  "<h2 data-blockid=\"nb-risk-h\">Risk</h2>",
  "<ul><li data-blockid=\"nb-risk-1\">Deck claims runway of ~14 months at current burn; hiring plan adds 6 heads in Q4.</li><li data-blockid=\"nb-risk-2\">Security source still needs a named hospital deployment reference.</li></ul>",
].join("");

export const WIKI_DOC = "Living wiki for room state, file inventory, agent sessions, workflows, backend map, and recent trace evidence. It updates from artifacts, sessions, runs, and traces.";
export const BRIEF_DOC = "Today's Brief — the room's ranked next actions, assembled from evidence, runway, and review state. Derived from the room and updated as it changes.";

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
      defaultHiddenColumnIds: ["crm_status", "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched"],
      sourceFile: "starter-room",
      sheetName: "Company research",
      sheetNames: ["Company research"],
      parser: "starter_seed",
      truncated: false,
      warnings: [],
    },
  };
}

function researchEvidence(row: (typeof RESEARCH_COMPANIES)[number]): NonNullable<CellPayload["evidence"]> {
  return [
    {
      id: `${row.id}-primary-source`,
      kind: "source",
      label: "Primary source",
      url: row.url,
      snippet: `${row.company}: product, buyer, and diligence context captured from the company site.`,
      confidence: 0.88,
    },
    {
      id: `${row.id}-security-source`,
      kind: "source",
      label: "Security source",
      url: row.source2Url,
      snippet: `${row.company}: security and operating-risk evidence attached to the company row.`,
      confidence: 0.84,
    },
  ];
}

function researchPayload(value: string, status: CellPayload["status"], evidence: NonNullable<CellPayload["evidence"]>): CellPayload {
  return { value, status, evidence, confidence: 0.87, updatedByRunId: "demo-research-seed" };
}

function researchSeedValue(row: (typeof RESEARCH_COMPANIES)[number], col: (typeof RESEARCH_COLS)[number]): unknown {
  const evidence = researchEvidence(row);
  const completed = row.status === "complete";
  switch (col) {
    case "company": return row.company;
    case "website": return row.url;
    case "status": return row.status;
    case "tier": return row.tier;
    case "intent": return row.intent;
    case "owner": return row.owner;
    case "crm_status": return row.crmStatus;
    case "summary": return completed ? researchPayload(`${row.company} has sourced product, buyer, and deployment notes ready for partner review.`, "complete", evidence) : "";
    case "funding": return completed ? researchPayload("Funding profile captured; refresh before final IC use.", "complete", evidence) : "";
    case "headcount": return completed ? researchPayload("Source-backed operating range attached.", "complete", evidence) : "";
    case "recent_signal": return completed ? researchPayload("Recent diligence signal is source-backed and ready to cite.", "complete", evidence) : "";
    case "source": return completed ? researchPayload(row.url, "complete", [evidence[0]]) : "";
    case "source2": return completed ? researchPayload(row.source2Url, "complete", [evidence[1]]) : "";
    case "last_researched": return completed ? researchPayload("2026-07-03", "complete", evidence) : "";
  }
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
  const { room, host } = engine.createRoom({ title: "Q3 diligence", hostName: "Homen", autoAllow: true });
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
  engine.createArtifact({ roomId: room.id, kind: "note", title: "Capture Notebook", by: me, seed: [{ id: "doc", value: CAPTURE_NOTEBOOK_CLOUD_DOC }] });
  const wikiId = engine.createArtifact({ roomId: room.id, kind: "note", title: "Agent wiki", by: me, seed: [{ id: "doc", value: WIKI_DOC }] }).id;
  engine.createArtifact({ roomId: room.id, kind: "note", title: "Today's Brief", by: me, seed: [{ id: "doc", value: BRIEF_DOC }] });
  const sheetId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Q3 variance", by: me, seed }).id;

  const researchSeed: Array<{ id: string; value: unknown }> = [];
  for (const c of RESEARCH_COMPANIES) {
    for (const col of RESEARCH_COLS) researchSeed.push({ id: `${c.id}__${col}`, value: researchSeedValue(c, col) });
  }
  // Research imports the CRM rows — company/website/tier/intent/owner/crm_status SEEDED (agentWritable:false,
  // so the agent must preserve them) with the diligence/ENRICH columns blank. The agent fills the blanks; it
  // does not invent CRM. (A fully-empty grid would leave the agentWritable:false CRM columns unfillable.)
  const researchId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Company research", by: me, seed: researchSeed, meta: researchMeta() }).id;
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
  const roomAgent: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
  const enrichingLock = engine.proposeLock({
    roomId: room.id,
    artifactId: researchId,
    elementIds: ["rc_neuronova__status", "rc_nimbusnova__status"],
    holder: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" },
    sessionId: room_.id,
    reason: "enriching companies with source-backed receipts",
  });
  if (enrichingLock.ok) engine.updateSession(room_.id, { status: "working", heldLockId: enrichingLock.lock.id, lastAction: "enriching company research rows" });

  engine.postMessage({ roomId: room.id, channel: "public", author: me, text: "Can the room reconcile Q3 variance against the NetSuite close before the board read?", clientMsgId: "seed-01-homen-question", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: "public", author: me, text: "@nodeagent reconcile Q3 revenue and COGS variance", clientMsgId: "seed-02-homen-command", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: "public", author: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" }, text: "Researched 2 companies with 2 sources and committed the first reconciliation batch.", clientMsgId: "seed-03-agent-reconciled", kind: "agent" });
  engine.postMessage({ roomId: room.id, channel: "public", author: priya, text: "The +27.5% on COGS is volume, not price - noting it on the row so it survives the sync.", clientMsgId: "seed-04-priya-cogs", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: "public", author: quokka, text: "anon - quokka joined as guest · view + chat", clientMsgId: "seed-05-quokka-joined", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: "public", author: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" }, text: "Researched 3 companies with 3 sources and prepared the next versioned handoff.", clientMsgId: "seed-06-agent-handoff", kind: "agent" });
  engine.postMessage({ roomId: room.id, channel: "public", author: me, text: "Good. Draft the reconciliation memo and clip the variance exhibit for the board read.", clientMsgId: "seed-07-homen-memo", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: { private: me.id }, author: me, text: "Private: flag any missing runway assumptions before we publish to the room.", clientMsgId: "seed-private-1", kind: "chat" });
  engine.postMessage({ roomId: room.id, channel: { private: me.id }, author: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: me.id }, text: "I will keep unknown cash, burn, pricing, hiring, and funding inputs as explicit gaps until a source supports them. This stays private until you promote it.", clientMsgId: "seed-private-2", kind: "agent" });
  engine.trace(room.id, roomAgent, "agent_status", "context.gather · Q3 revenue and COGS variance", { artifactId: sheetId }, "context.gather · sheet, chat request, NetSuite export → ok");
  engine.trace(room.id, roomAgent, "lock_acquired", "privacy.filter · scoped to room-visible evidence", { artifactId: sheetId }, "privacy.filter · public room scope → ok");
  engine.trace(room.id, roomAgent, "edit_applied", "retrieval.search · source-backed variance notes", { artifactId: sheetId }, "retrieval.search · NetSuite export + sheet cells → ok");
  engine.trace(room.id, roomAgent, "edit_applied", "synthesis.answer · reconciled Q3 variance · v42", { artifactId: sheetId }, "synthesis.answer · Revenue + COGS variance → committed");
  engine.trace(room.id, roomAgent, "notebook_read_model", "notebook.write · draft board memo evidence", { artifactId: noteId }, "notebook.write · memo outline + citations → queued");
  const chatBase = new Date();
  chatBase.setHours(9, 38, 0, 0);
  const chatOffsets = new Map([
    ["seed-01-homen-question", 0],
    ["seed-02-homen-command", 0],
    ["seed-03-agent-reconciled", 1],
    ["seed-04-priya-cogs", 3],
    ["seed-05-quokka-joined", 4],
    ["seed-06-agent-handoff", 6],
    ["seed-07-homen-memo", 8],
  ]);
  for (const msg of engine.listMessages(room.id, "public")) {
    const offset = chatOffsets.get(msg.clientMsgId);
    if (offset !== undefined) msg.createdAt = chatBase.getTime() + offset * 60_000;
  }

  const span = (id: string, parent: string, startMs: number, durationMs: number, kind: string, extra = "") =>
    `span.id=${id}; span.parent=${parent}; span.start_ms=${startMs}; span.duration_ms=${durationMs}; span.kind=${kind}${extra ? `; ${extra}` : ""}`;
  engine.trace(room.id, roomAgent, "agent_status", "context.gather - Q3 revenue and COGS variance", { artifactId: sheetId }, `${span("ctx", "run", 0, 900, "context", "span.name=context.gather")} - sheet, chat request, NetSuite export -> ok`);
  engine.trace(room.id, roomAgent, "lock_acquired", "privacy.filter - scoped to room-visible evidence", { artifactId: sheetId }, `${span("priv", "ctx", 520, 280, "privacy", "span.name=privacy.filter")} - public room scope -> ok`);
  engine.trace(room.id, roomAgent, "edit_applied", "retrieval.search - source-backed variance notes", { artifactId: sheetId }, `${span("ret", "run", 1200, 4300, "retrieval", "span.name=retrieval.search; span.status=retry")} - NetSuite export + sheet cells -> retry`);
  engine.trace(room.id, roomAgent, "edit_applied", "fetch cardionova.com", { artifactId: sheetId }, `${span("fetch-cardionova", "ret", 1500, 380, "retrieval", "span.name=fetch_cardionova.com")} - fetched source`);
  engine.trace(room.id, roomAgent, "edit_applied", "fetch crunchbase.com", { artifactId: sheetId }, `${span("fetch-crunchbase", "ret", 1900, 610, "retrieval", "span.name=fetch_crunchbase.com")} - fetched source`);
  engine.trace(room.id, roomAgent, "proposal_resolve_failed", "fetch pitchbook.com - error", { artifactId: sheetId }, `${span("fetch-pitchbook", "ret", 2600, 540, "retrieval", "span.name=fetch_pitchbook.com; span.status=error")} - provider profile unavailable`);
  engine.trace(room.id, roomAgent, "edit_applied", "retry pitchbook.com", { artifactId: sheetId }, `${span("retry-pitchbook", "ret", 3300, 470, "retrieval", "span.name=retry_pitchbook.com; span.status=retryok")} - alternate source ok`);
  engine.trace(room.id, roomAgent, "edit_applied", "36 more fetches", { artifactId: sheetId }, `${span("fetch-rollup", "ret", 3900, 3800, "retrieval", "span.name=36_more_fetches")} - batched source fetches`);
  engine.trace(room.id, roomAgent, "edit_applied", "synthesis.answer - reconciled Q3 variance - v42", { artifactId: sheetId }, `${span("syn", "run", 6200, 3100, "synthesis", "span.name=synthesis.answer; attr.tokens.in=48,200; attr.tokens.out=2,100; attr.cost=$0.14_-_spike_vs_run_avg_$0.05; attr.confidence=0.82_-_draft")} - Revenue + COGS variance -> committed`);
  engine.trace(room.id, roomAgent, "agent_status", "tokens.in 48,200", { artifactId: sheetId }, `${span("tok-in", "syn", 6420, 40, "synthesis", "span.name=tokens.in")} - 48,200`);
  engine.trace(room.id, roomAgent, "agent_status", "tokens.out 2,100", { artifactId: sheetId }, `${span("tok-out", "syn", 6480, 40, "synthesis", "span.name=tokens.out")} - 2,100`);
  engine.trace(room.id, roomAgent, "agent_status", "cost $0.14 - spike vs run avg $0.05", { artifactId: sheetId }, `${span("cost", "syn", 6540, 40, "synthesis", "span.name=cost")} - $0.14`);
  engine.trace(room.id, roomAgent, "agent_status", "confidence 0.82 - draft", { artifactId: sheetId }, `${span("conf", "syn", 6600, 40, "synthesis", "span.name=confidence")} - 0.82 draft`);
  engine.trace(room.id, roomAgent, "notebook_read_model", "notebook.write - draft board memo evidence", { artifactId: noteId }, `${span("nb-write", "run", 10300, 1100, "notebook", "span.name=notebook.write")} - memo outline + citations -> queued`);
  const privA = engine.startSession({ roomId: room.id, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: me.id });

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
