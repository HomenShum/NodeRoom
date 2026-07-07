/** Rooms + anonymous join. The short code is generated client-side and passed in
 * (mutations are deterministic — no Math.random/uuid inside). Anonymous join is a
 * stand-in for `@convex-dev/auth`'s Anonymous provider (see docs/STACK.md). */
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, getRequiredProductionIdentity, hashToken, requireActorProof, type ActorValue } from "./lib";
import { syncSpreadsheetIndexFromSeed } from "./spreadsheetIndexLib";
import { assertCreateArtifactLimits } from "./artifacts";

const palette = ["#d97757", "#5b9bf5", "#7bd089", "#a78bfa", "#e4c567", "#e8845f"];

// ── Production abuse gates (anon-join surface) ──────────────────────────────────────────────────
// VITE_CONVEX_URL ships in the public bundle, so every mutation is directly callable by a scripted
// client. These deterministic caps bound the blast radius: code entropy stops enumeration, the
// member cap stops room flooding, the join-rate window stops scripted mass-joins.
const ROOM_CODE_RE = /^[A-Z0-9]{6,12}$/; // ≥6 of [A-Z0-9] → 36^6 ≈ 2.2B codes; enumeration is impractical
const MAX_MEMBERS_PER_ROOM = 32;
const MAX_JOINS_PER_MINUTE = 10;
const MAX_NAME_LEN = 40;
const MAX_TITLE_LEN = 80;
const MAX_SEED_ARTIFACTS_PER_ROOM = 8; // bound the atomic create payload (per-artifact size is capped by assertCreateArtifactLimits)
type Visibility = "private" | "room" | "public";
type ArtifactAcl = { visibility?: Visibility; createdBy?: ActorValue };

function canReadArtifact(a: ArtifactAcl, actor: ActorValue): boolean {
  return (a.visibility ?? "room") !== "private" || (a.createdBy?.kind === actor.kind && a.createdBy.id === actor.id);
}

const STARTER_VARIANCE_ROWS = [
  { id: "r_rev", label: "Revenue", q2: "$10,000", q3: "$12,400" },
  { id: "r_cogs", label: "COGS", q2: "$4,000", q3: "$5,100" },
  { id: "r_gp", label: "Gross profit", q2: "$6,000", q3: "$7,300" },
  { id: "r_opex", label: "OpEx", q2: "$2,200", q3: "$2,650" },
  { id: "r_ni", label: "Net income", q2: "$3,800", q3: "$4,650" },
];

const STARTUP_RESEARCH_COLS = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status", "summary",
  "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;
const STARTUP_RESEARCH_ROW_COUNT = 1000;
const STARTUP_RESEARCH_SEEDED_BASE_COLS = new Set<(typeof STARTUP_RESEARCH_COLS)[number]>([
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
]);
const STARTUP_RESEARCH_DETAIL_SEED_LIMIT = 40;
const STARTUP_RESEARCH_DEFAULT_HIDDEN_COLS = [
  "crm_status", "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
];
const STARTUP_RESEARCH_EVIDENCE_COLS = new Set(["summary", "funding", "headcount", "recent_signal"]);
const STARTUP_RESEARCH_AGENT_READONLY_COLS = new Set(["company", "website", "tier", "intent", "owner", "crm_status"]);
const STARTER_RUNWAY_COLS = ["company", "cash", "burn", "runway", "status", "milestones"] as const;
const STARTER_RUNWAY_COMPUTE_COLS = new Set(["runway", "milestones"]);
const STARTER_RUNWAY_AGENT_READONLY_COLS = new Set(["company"]);

type StartupResearchRow = { rowId: string } & Record<(typeof STARTUP_RESEARCH_COLS)[number], string>;

function startupResearchMeta() {
  return {
    dataframe: {
      columns: STARTUP_RESEARCH_COLS.map((col, order) => ({
        id: col,
        label: col.replace(/_/g, " "),
        order,
        mode: STARTUP_RESEARCH_EVIDENCE_COLS.has(col) ? "enrich" : "manual",
        type: "text",
        agentWritable: !STARTUP_RESEARCH_AGENT_READONLY_COLS.has(col),
      })),
      rowCount: STARTUP_RESEARCH_ROW_COUNT,
      sourceFile: "starter-room",
      sheetName: "Company research",
      sheetNames: ["Company research"],
      parser: "starter_seed",
      truncated: false,
      warnings: ["Semantic index skipped for live starter scale grid; NodeAgent reads cells directly and enriches sparse columns on demand."],
      defaultHiddenColumnIds: STARTUP_RESEARCH_DEFAULT_HIDDEN_COLS,
      semanticIndexDisabled: true,
    },
    summary: "Live starter scale state: 1,000 company-research rows with visible diligence fields and sparse hidden enrichment fields for NodeAgent work.",
    tags: ["states-scale-default", "startup-diligence", "live-starter"],
  };
}

const STARTUP_RESEARCH_ANCHORS: StartupResearchRow[] = [
  {
    rowId: "rc_cardionova",
    company: "CardioNova",
    website: "https://cardionova.example",
    status: "pending",
    tier: "A",
    intent: "AI triage for hospitals",
    owner: "Maya",
    crm_status: "New",
    summary: "Intake from banker call: AI triage workflow for hospital patient intake. Agent should verify product, buyer, competitors, funding, and evidence before partner use.",
    funding: "Unknown - verify from source",
    headcount: "Unknown - verify from source",
    recent_signal: "Call note says Series B profile; verify before memo",
    source: "banker call note",
    source2: "pending provider research",
    last_researched: "never",
  },
  {
    rowId: "rc_mercury",
    company: "Mercury",
    website: "https://mercury.com",
    status: "complete",
    tier: "A",
    intent: "Startup banking diligence",
    owner: "Maya",
    crm_status: "Watch",
    summary: "Banking platform for startups. Strong account relevance for founder-led operating accounts, treasury workflow, and startup banking due diligence.",
    funding: "Series C+ profile; verify latest primary source before IC use",
    headcount: "Mid-market fintech scale; refresh with provider/API data",
    recent_signal: "Position as startup banking and treasury workflow lead",
    source: "https://mercury.com",
    source2: "https://www.linkedin.com/company/mercurybank/",
    last_researched: "2026-06-14",
  },
  {
    rowId: "rc_ramp",
    company: "Ramp",
    website: "https://ramp.com",
    status: "pending",
    tier: "A",
    intent: "Middle market card + spend controls",
    owner: "Sam",
    crm_status: "Target",
    summary: "Expense, card, and procurement platform. Agent should gather updated product, pricing, customer, and hiring signals.",
    funding: "Refresh from provider data",
    headcount: "Refresh from provider data",
    recent_signal: "Spend-management competitor and partner adjacency",
    source: "https://ramp.com",
    source2: "https://www.linkedin.com/company/ramp/",
    last_researched: "never",
  },
  {
    rowId: "rc_brex",
    company: "Brex",
    website: "https://brex.com",
    status: "pending",
    tier: "B",
    intent: "Startup finance workflow",
    owner: "Priya",
    crm_status: "Research",
    summary: "Corporate card, banking-adjacent, and expense workflow vendor. Compare positioning, customer segment, and runway assumptions.",
    funding: "Refresh from provider data",
    headcount: "Refresh from provider data",
    recent_signal: "Benchmark against Mercury/Ramp account motion",
    source: "https://brex.com",
    source2: "https://www.linkedin.com/company/brexhq/",
    last_researched: "never",
  },
  {
    rowId: "rc_pulley",
    company: "Pulley",
    website: "https://pulley.com",
    status: "pending",
    tier: "B",
    intent: "Cap table and equity workflow diligence",
    owner: "Maya",
    crm_status: "Research",
    summary: "Cap table management platform. Agent should gather product, pricing, hiring, competitor, and customer signals.",
    funding: "Refresh from provider data",
    headcount: "Refresh from provider data",
    recent_signal: "Evaluate as startup finance workflow adjacency",
    source: "https://pulley.com",
    source2: "pending provider research",
    last_researched: "never",
  },
];
const STARTUP_RESEARCH_ROWS: StartupResearchRow[] = buildStartupResearchRows();

function startupResearchSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  STARTUP_RESEARCH_ROWS.forEach((row, index) => {
    for (const col of STARTUP_RESEARCH_COLS) {
      if (!shouldSeedStartupResearchCell(row, index, col)) continue;
      seed.push({ id: `${row.rowId}__${col}`, value: row[col] });
    }
  });
  return seed;
}

function shouldSeedStartupResearchCell(row: StartupResearchRow, index: number, col: (typeof STARTUP_RESEARCH_COLS)[number]): boolean {
  if (STARTUP_RESEARCH_SEEDED_BASE_COLS.has(col)) return true;
  if (STARTUP_RESEARCH_ANCHORS.some((anchor) => anchor.rowId === row.rowId)) return true;
  return index < STARTUP_RESEARCH_DETAIL_SEED_LIMIT && row.status === "complete" && !!row[col];
}

function buildStartupResearchRows(): StartupResearchRow[] {
  const prefixes = ["Cardio", "Neuro", "Flux", "Atlas", "Vertex", "Lumen", "Harbor", "Crest", "Nimbus", "Quanta", "Helio", "Aegis", "Orbit", "Pryce", "Sable", "Tandem", "Vellum", "Zephyr", "Mistral", "Kite", "Ferro", "Cinder", "Alto", "Briar", "Corvid"];
  const suffixes = ["Nova", "Labs", "Health", "Pay", "Works", "Metrics", "Systems", "AI", "Bio", "Grid", "Flow", "Base", "Sense", "Loop", "Stack", "Line", "Port", "Scale", "Note", "Chart"];
  const intents = [
    "AI triage for hospitals",
    "Startup banking diligence",
    "Middle-market card and spend controls",
    "Cap table and equity ops",
    "Clinical documentation copilot",
    "Freight pricing intelligence",
    "SMB payroll and benefits",
    "Warehouse robotics retrofits",
    "Compliance evidence automation",
    "Revenue reconciliation tooling",
  ];
  const owners = ["Maya", "Sam", "Priya", "Homen"];
  const rand = seededRandom(42);
  const rows = [...STARTUP_RESEARCH_ANCHORS];
  const used = new Set(rows.map((row) => row.rowId));
  let i = 0;
  while (rows.length < STARTUP_RESEARCH_ROW_COUNT) {
    const name = `${prefixes[i % prefixes.length]}${suffixes[Math.floor(i / prefixes.length) % suffixes.length]}${i >= 500 ? ` ${Math.floor(i / 500) + 1}` : ""}`;
    const rowId = uniqueResearchRowId(name, used);
    const x = rand();
    const status = x < 0.28 ? "complete" : x < 0.36 ? "needs_review" : x < 0.42 ? "failed" : "pending";
    const tier = rand() < 0.4 ? "A" : rand() < 0.75 ? "B" : "C";
    const intent = intents[Math.floor(rand() * intents.length)] ?? intents[0];
    const owner = owners[i % owners.length] ?? "Maya";
    const funding = status === "complete" ? `$${2 + Math.floor(rand() * 80)}M` : status === "needs_review" ? "verify funding source" : "";
    const headcount = status === "complete" ? `${10 + Math.floor(rand() * 900)}` : status === "needs_review" ? "refresh hiring/headcount" : "";
    rows.push({
      rowId,
      company: name,
      website: `https://${name.toLowerCase().replace(/\s/g, "")}.com`,
      status,
      tier,
      intent,
      owner,
      crm_status: status === "complete" ? "Enriched" : status === "needs_review" ? "Review" : status === "failed" ? "Blocked" : "Research",
      summary: status === "complete" ? `${name} mapped for ${intent.toLowerCase()}; buyer, HIPAA/security, and wedge-fit notes captured for review.` : "",
      funding,
      headcount,
      recent_signal: status === "complete" ? `${Math.floor(rand() * 40)} open roles; HIPAA/security ${rand() < 0.5 ? "clear" : "gap found"}.` : "",
      source: status === "complete" ? `https://${name.toLowerCase().replace(/\s/g, "")}.com` : "",
      source2: status === "complete" ? `https://news.example.com/${rowId}` : "",
      last_researched: status === "complete" ? "2026-07-06" : "never",
    });
    i += 1;
  }
  return rows;
}

function uniqueResearchRowId(company: string, used: Set<string>): string {
  const base = "rc_" + company.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  let candidate = base || `rc_company_${used.size + 1}`;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function starterSheetSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const r of STARTER_VARIANCE_ROWS) {
    seed.push({ id: `${r.id}__label`, value: r.label });
    seed.push({ id: `${r.id}__q2`, value: r.q2 });
    seed.push({ id: `${r.id}__q3`, value: r.q3 });
    seed.push({ id: `${r.id}__variance`, value: "" });
    seed.push({ id: `${r.id}__note`, value: "" });
  }
  return seed;
}

const starterNoteSeed = () => [
  {
    id: "doc",
    value: [
      "<h1>Startup banking diligence memo</h1>",
      "<p>Use this room to coordinate startup-banking diligence: company profile, product, pricing, hiring signals, market headwinds, competitors, runway, milestones, and downstream stakeholder drafts.</p>",
      "<p>Ask the room agent to enrich pending accounts, build sourced findings, and prepare approval-gated handoffs.</p>",
    ].join(""),
  },
];

const starterWallSeed = () => [
  { id: "s_workflow", value: { text: "Traditional diligence: analyst gathers company facts, enriches CRM/spreadsheet rows, drafts memo, then manually posts updates.", x: 54, y: 56, color: "#FDE68A" } },
  { id: "s_agent", value: { text: "NodeAgent can enrich accounts, cite sources, draft runway/milestone findings, and keep every edit traced in the room.", x: 324, y: 136, color: "#BBF7D0" } },
  { id: "s_handoff", value: { text: "Export drafts: Gmail, Notion, Slack, Linear, LinkedIn, and CRM CSV after human approval.", x: 170, y: 292, color: "#BFDBFE" } },
];

const starterRunwaySeed = () => [
  { id: "cardionova__company", value: "CardioNova" },
  { id: "cardionova__cash", value: "$1.5M" },
  { id: "cardionova__burn", value: "$125k/mo" },
  { id: "cardionova__runway", value: "12.0 months" },
  { id: "cardionova__status", value: "watch" },
  { id: "cardionova__milestones", value: "Verify hospital deployments; fundraise window; treasury IC pack" },
  { id: "mercury__company", value: "Mercury" },
  { id: "mercury__cash", value: "" },
  { id: "mercury__burn", value: "" },
  { id: "mercury__runway", value: "" },
  { id: "mercury__status", value: "needs source" },
  { id: "mercury__milestones", value: "Confirm current treasury/account products and growth signals" },
];

function starterRunwayMeta() {
  return {
    dataframe: {
      columns: STARTER_RUNWAY_COLS.map((col, order) => ({
        id: col,
        label: col.replace(/_/g, " "),
        order,
        mode: STARTER_RUNWAY_COMPUTE_COLS.has(col) ? "compute" : "manual",
        type: "text",
        agentWritable: !STARTER_RUNWAY_AGENT_READONLY_COLS.has(col),
      })),
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

const starterWorkplanSeed = () => [
  {
    id: "doc",
    value: [
      "<h1>Open diligence questions / workplan</h1>",
      "<ul>",
      "<li>CardioNova: verify product claims, hospital buyer, funding history, deployment references, and HIPAA/security posture.</li>",
      "<li>Bulk batch: enrich Mercury, Ramp, Brex, and Pulley with product, hiring, pricing, competitors, and market headwinds.</li>",
      "<li>Runway: compute only from sourced cash and burn assumptions; leave blank with reason when inputs are missing.</li>",
      "<li>Handoff: prepare Gmail, Notion, Slack, Linear, LinkedIn, and CRM CSV drafts after human review.</li>",
      "</ul>",
    ].join(""),
  },
];

async function insertStarterArtifact(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    kind: "sheet" | "note" | "wall";
    title: string;
    seed: Array<{ id: string; value: unknown }>;
    meta?: unknown;
    actor: ActorValue;
    now: number;
  },
) {
  const artifactId = await ctx.db.insert("artifacts", {
    roomId: args.roomId,
    kind: args.kind,
    title: args.title,
    version: 1,
    order: args.seed.map((s) => s.id),
    updatedAt: args.now,
    createdBy: args.actor,
    visibility: "room",
    meta: args.meta,
  });
  for (const s of args.seed) {
    await ctx.db.insert("elements", { artifactId, elementId: s.id, value: s.value, version: 1, updatedAt: args.now, updatedBy: args.actor });
  }
  await syncSpreadsheetIndexFromSeed(ctx, { artifactId, title: args.title, kind: args.kind, meta: args.meta, seed: args.seed, now: args.now });
  await ctx.db.insert("traces", {
    roomId: args.roomId,
    ts: args.now,
    actor: args.actor,
    type: "edit_applied",
    summary: `${args.actor.name} added ${args.title}`,
    detail: `create_artifact - ${args.kind} - ${String(artifactId)}`,
  });
  return artifactId;
}

async function seedStarterMessages(ctx: MutationCtx, args: { roomId: Id<"rooms">; host: ActorValue; now: number }) {
  const agent: ActorValue = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
  const guests = ["Priya", "anon - quokka", "Maya", "Sam"];
  for (let i = 0; i < 312; i += 1) {
    const batchStart = ((i * 17) % 960) + 1;
    const batchEnd = Math.min(1000, batchStart + 39);
    const agentTurn = i % 5 === 1 || i % 5 === 4;
    const author = agentTurn
      ? agent
      : i % 7 === 0
        ? args.host
        : { kind: "user" as const, id: `starter_person_${i % guests.length}`, name: guests[i % guests.length] ?? "Priya" };
    const text =
      i % 9 === 0 ? `@nodeagent enrich rows ${batchStart}-${batchEnd} with funding, buyer, HIPAA/security gaps`
        : i % 9 === 1 ? `Enriched 40 rows - ${47 + (i % 60)} sources. Locked rows ${batchStart}-${batchEnd}, committed reviewed cells, and released the lock.`
          : i % 9 === 2 ? "Tier the batch A/B/C by wedge fit before enrichment so review stays focused."
            : i % 9 === 3 ? "HIPAA/security notes look strong; flagging gap-found rows for banker review."
              : i % 9 === 4 ? `Trace receipt ready: committed v${220 + i} -> v${221 + i} with source links and row-level status.`
                : i % 9 === 5 ? "Can watch the artifacts and handoff drafts live?"
                  : i % 9 === 6 ? "Funding looks current on A-tier companies; stale hiring evidence still needs review."
                    : i % 9 === 7 ? "Pushing the memo draft after this run finishes."
                      : "Opened Company research and checked the rendered rows against the trace drawer.";
    await ctx.db.insert("messages", {
      roomId: args.roomId,
      channel: "public",
      author,
      text,
      clientMsgId: `starter-scale-${i + 1}`,
      kind: agentTurn ? "agent" : "chat",
      createdAt: args.now + i,
    });
  }
}

async function padStarterTraces(ctx: MutationCtx, args: { roomId: Id<"rooms">; artifactId: Id<"artifacts">; now: number }) {
  const existing = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect();
  const agent: ActorValue = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
  const target = 400;
  for (let i = existing.length; i < target; i += 1) {
    const batchStart = ((i * 25) % 975) + 1;
    const batchEnd = Math.min(1000, batchStart + 24);
    const type = i % 5;
    await ctx.db.insert("traces", {
      roomId: args.roomId,
      ts: args.now + i,
      actor: agent,
      type: type === 0 ? "edit_applied" : type === 1 ? "lock_acquired" : type === 2 ? "lock_released" : "agent_status",
      summary: type === 0 ? `Committed scale enrichment rows ${batchStart}-${batchEnd}`
        : type === 1 ? `Locked rows ${batchStart}-${batchEnd}`
          : type === 2 ? "Released lock - smart-merged one held draft"
            : type === 3 ? `Fetched source packet for rows ${batchStart}-${batchEnd}`
              : "Cited funding and buyer source for scale fixture row",
      detail: `starter_scale_trace(${i + 1}) artifact=${String(args.artifactId)} rows=${batchStart}-${batchEnd}`,
    });
  }
}

export const create = mutation({
  args: {
    code: v.string(), title: v.string(), hostName: v.string(), authToken: v.string(), autoAllow: v.optional(v.boolean()),
    // Optional starter artifacts seeded IN THE SAME TRANSACTION as the room. Any caller that needs a
    // room pre-populated with custom artifacts must pass them here rather than following create with
    // separate createArtifact calls — that older composition committed the room first, so a failed seed
    // left a phantom room with partial artifacts. Bundling makes it all-or-nothing.
    seedArtifacts: v.optional(v.array(v.object({
      kind: v.union(v.literal("sheet"), v.literal("note"), v.literal("wall")),
      title: v.string(),
      seed: v.array(v.object({ id: v.string(), value: v.any() })),
      meta: v.optional(v.any()),
    }))),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    const identity = await getRequiredProductionIdentity(ctx);
    const code = a.code.toUpperCase();
    if (!ROOM_CODE_RE.test(code)) throw new Error("weak_room_code"); // server-enforced entropy floor
    if (a.title.length > MAX_TITLE_LEN || a.hostName.length > MAX_NAME_LEN) throw new Error("field_too_long");
    // Validate the whole seed bundle BEFORE the first insert, so an invalid seed rejects the create
    // without writing anything (per-artifact size caps + a bound on how many artifacts one call may seed).
    const seedArtifacts = a.seedArtifacts ?? [];
    if (seedArtifacts.length > MAX_SEED_ARTIFACTS_PER_ROOM) throw new Error("too_many_seed_artifacts");
    for (const art of seedArtifacts) assertCreateArtifactLimits(art);
    const existing = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (existing) throw new Error("room_code_taken");
    const roomId = await ctx.db.insert("rooms", { code, title: a.title, hostId: "", autoAllow: a.autoAllow ?? false, status: "live", createdAt: now });
    const memberId = await ctx.db.insert("members", { roomId, name: a.hostName, role: "host", anon: false, color: palette[0], authTokenHash: await hashToken(a.authToken), authSubject: identity?.subject, lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: memberId });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public", status: "idle", lastAction: "started", updatedAt: now });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: memberId, status: "idle", lastAction: "started", updatedAt: now });
    await ctx.db.insert("traces", { roomId, ts: now, actor: { kind: "user", id: memberId, name: a.hostName }, type: "room_created", summary: `${a.hostName} created the room` });
    const actor: ActorValue = { kind: "user", id: String(memberId), name: a.hostName };
    const artifactIds: Id<"artifacts">[] = [];
    for (const art of seedArtifacts) {
      artifactIds.push(await insertStarterArtifact(ctx, { roomId, kind: art.kind, title: art.title, seed: art.seed, meta: art.meta, actor, now }));
    }
    return { roomId, memberId, artifactIds };
  },
});

export const createStarterRoom = mutation({
  args: { code: v.string(), title: v.string(), hostName: v.string(), authToken: v.string(), autoAllow: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const identity = await getRequiredProductionIdentity(ctx);
    const code = a.code.toUpperCase();
    if (!ROOM_CODE_RE.test(code)) throw new Error("weak_room_code");
    if (a.title.length > MAX_TITLE_LEN || a.hostName.length > MAX_NAME_LEN) throw new Error("field_too_long");
    const existing = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (existing) throw new Error("room_code_taken");
    const roomId = await ctx.db.insert("rooms", { code, title: a.title, hostId: "", autoAllow: a.autoAllow ?? false, status: "live", createdAt: now });
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: a.hostName,
      role: "host",
      anon: false,
      color: palette[0],
      authTokenHash: await hashToken(a.authToken),
      authSubject: identity?.subject,
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: memberId });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public", status: "idle", lastAction: "started", updatedAt: now });
    await ctx.db.insert("agentSessions", { roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: memberId, status: "idle", lastAction: "started", updatedAt: now });
    const actor = { kind: "user" as const, id: String(memberId), name: a.hostName };
    await ctx.db.insert("traces", { roomId, ts: now, actor, type: "room_created", summary: `${a.hostName} created the room` });
    const companyResearchId = await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Company research", seed: startupResearchSeed(), actor, now, meta: startupResearchMeta() });
    await insertStarterArtifact(ctx, { roomId, kind: "note", title: "Diligence memo", seed: starterNoteSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "wall", title: "Risk / opportunity wall", seed: starterWallSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Runway / milestones", seed: starterRunwaySeed(), actor, now, meta: starterRunwayMeta() });
    await insertStarterArtifact(ctx, { roomId, kind: "note", title: "Open questions / workplan", seed: starterWorkplanSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Q3 variance", seed: starterSheetSeed(), actor, now });
    await seedStarterMessages(ctx, { roomId, host: actor, now });
    await padStarterTraces(ctx, { roomId, artifactId: companyResearchId, now });
    return { roomId, memberId };
  },
});

export const ensureStarterRoomState = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error("room_not_found");
    const actor = await requireActorProof(ctx, roomId, requester);
    if (String(room.hostId) !== actor.id) throw new Error("host_required");
    const now = Date.now();
    const artifacts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    let addedArtifacts = 0;
    let patchedCells = 0;

    const byTitle = (title: string) => artifacts.find((artifact) => artifact.title === title);
    let companyResearch: (typeof artifacts)[number] | null = byTitle("Company research") ?? null;
    if (!companyResearch) {
      const insertedId = await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Company research", seed: startupResearchSeed(), actor, now, meta: startupResearchMeta() });
      companyResearch = await ctx.db.get(insertedId);
      if (!companyResearch) throw new Error("starter_artifact_insert_failed");
      addedArtifacts += 1;
    } else {
      const research = companyResearch;
      const seed = startupResearchSeed();
      const existing = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", research._id)).collect();
      const existingIds = new Set(existing.map((element) => element.elementId));
      const missing = seed.filter((cell) => !existingIds.has(cell.id));
      for (const cell of missing) {
        await ctx.db.insert("elements", { artifactId: research._id, elementId: cell.id, value: cell.value, version: 1, updatedAt: now, updatedBy: actor });
        patchedCells += 1;
      }
      const nextOrder = Array.from(new Set([...research.order, ...missing.map((cell) => cell.id)]));
      await ctx.db.patch(research._id, { order: nextOrder, version: research.version + (missing.length ? 1 : 0), updatedAt: now, meta: startupResearchMeta() });
    }

    if (!byTitle("Diligence memo")) {
      await insertStarterArtifact(ctx, { roomId, kind: "note", title: "Diligence memo", seed: starterNoteSeed(), actor, now });
      addedArtifacts += 1;
    }
    if (!byTitle("Risk / opportunity wall")) {
      await insertStarterArtifact(ctx, { roomId, kind: "wall", title: "Risk / opportunity wall", seed: starterWallSeed(), actor, now });
      addedArtifacts += 1;
    }
    if (!byTitle("Runway / milestones")) {
      await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Runway / milestones", seed: starterRunwaySeed(), actor, now, meta: { dataframe: { columns: ["company", "cash", "burn", "runway", "status", "milestones"], rowCount: 2, sourceFile: "starter-room", parser: "starter_seed", truncated: false, warnings: [] } } });
      addedArtifacts += 1;
    }
    if (!byTitle("Open questions / workplan")) {
      await insertStarterArtifact(ctx, { roomId, kind: "note", title: "Open questions / workplan", seed: starterWorkplanSeed(), actor, now });
      addedArtifacts += 1;
    }
    if (!byTitle("Q3 variance")) {
      await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Q3 variance", seed: starterSheetSeed(), actor, now });
      addedArtifacts += 1;
    }

    const publicMessages = await ctx.db.query("messages").withIndex("by_room_channel", (q) => q.eq("roomId", roomId).eq("channel", "public")).take(20);
    if (publicMessages.length < 20) await seedStarterMessages(ctx, { roomId, host: actor, now });
    if (companyResearch) await padStarterTraces(ctx, { roomId, artifactId: companyResearch._id, now });
    if (room.title === "Blank NodeRoom") await ctx.db.patch(roomId, { title: "Startup diligence" });

    return { ok: true as const, addedArtifacts, patchedCells };
  },
});

export const joinAnonymous = mutation({
  args: { code: v.string(), name: v.string(), authToken: v.string(), anon: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", a.code.toUpperCase())).first();
    if (!room) return null;
    const identity = await getRequiredProductionIdentity(ctx);
    const now = Date.now();
    const anon = a.anon ?? true;
    if (a.name.length > MAX_NAME_LEN) throw new Error("field_too_long");
    const existing = await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect();
    const activeMembers = existing.filter((m) => m.revokedAt == null);
    // Abuse gates: room capacity + join-rate window (joins are members created in the last 60s).
    if (activeMembers.length >= MAX_MEMBERS_PER_ROOM) return { error: "room_full" as const };
    const recentJoins = existing.filter((m) => m._creationTime > now - 60_000).length;
    if (recentJoins >= MAX_JOINS_PER_MINUTE) return { error: "join_rate_limited" as const };
    const count = activeMembers.length;
    const memberId = await ctx.db.insert("members", { roomId: room._id, name: a.name, role: "member", anon, color: palette[count % palette.length], authTokenHash: await hashToken(a.authToken), authSubject: identity?.subject, lastSeenAt: now });
    await ctx.db.insert("traces", { roomId: room._id, ts: now, actor: { kind: "user", id: memberId, name: a.name }, type: "member_joined", summary: `${a.name} joined${anon ? " (anon)" : ""}` });
    return { roomId: room._id, memberId };
  },
});

export const leave = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const member = await ctx.db.get(actor.id as Id<"members">);
    if (!member || String(member.roomId) !== String(roomId)) throw new Error("actor_not_in_room");
    const now = Date.now();
    await ctx.db.patch(member._id, { lastSeenAt: now, revokedAt: now });
    await ctx.db.insert("traces", {
      roomId,
      ts: now,
      actor,
      type: "member_left",
      summary: `${actor.name} left the room`,
    });
    return { ok: true as const };
  },
});

export const get = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.get(roomId);
  },
});
export const members = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return (await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .filter((m) => m.revokedAt == null)
      .map((m) => ({ id: m._id, roomId: m.roomId, name: m.name, role: m.role, anon: m.anon, color: m.color, lastSeenAt: m.lastSeenAt }));
  },
});

export const byCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code.toUpperCase())).first();
    return r ? { roomId: r._id } : null;
  },
});

/** One reactive query that returns the whole room reshaped into the engine's
 * types, so the existing presentational components render Convex data unchanged. */
export const full = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    const actor = await requireActorProof(ctx, roomId, requester);
    const members = (await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .filter((m) => m.revokedAt == null)
      .map((m) => ({ id: m._id, roomId: m.roomId, name: m.name, role: m.role, anon: m.anon, color: m.color, lastSeenAt: m.lastSeenAt }));
    const arts = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .filter((a) => canReadArtifact(a, actor));
    const artifacts = [];
    for (const a of arts) {
      const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", a._id)).collect();
      const elements: Record<string, unknown> = {};
      for (const e of els) elements[e.elementId] = { id: e.elementId, version: e.version, value: e.value, updatedAt: e.updatedAt, updatedBy: e.updatedBy };
      artifacts.push({
        id: a._id,
        roomId: a.roomId,
        kind: a.kind,
        title: a.title,
        version: a.version,
        order: a.order,
        elements,
        updatedAt: a.updatedAt,
        createdBy: a.createdBy,
        visibility: a.visibility ?? "room",
        meta: a.meta,
      });
    }
    const locks = (await ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect())
      .map((l) => ({ id: l._id, roomId: l.roomId, artifactId: l.artifactId, elementIds: l.elementIds, holder: l.holder, sessionId: l.sessionId, reason: l.reason, status: l.status, createdAt: l._creationTime }));
    const sessions = (await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((s) => ({ id: s._id, roomId: s.roomId, agentId: s.agentId, agentName: s.agentName, scope: s.scope, ownerId: s.ownerId, status: s.status, heldLockId: s.heldLockId, lastAction: s.lastAction, updatedAt: s.updatedAt }));
    // P1-1: a private-scoped draft must redact its OPS too, not just the note — `ops` carries the
    // actual cell edits (elementId + value), which previously leaked verbatim to every member.
    // The draft's owner still sees their own ops; everyone else gets [] + an opsRedacted count.
    const drafts = (await ctx.db.query("drafts").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect())
      .map((d) => {
        const redact = d.author.scope === "private" && !(d.author.ownerId !== undefined && d.author.ownerId === actor.id);
        return {
          id: d._id, roomId: d.roomId, artifactId: d.artifactId, author: d.author,
          ops: redact ? [] : d.ops,
          opsRedacted: redact ? d.ops.length : undefined,
          note: redact ? "[private draft]" : d.note,
          blockedByLockId: d.blockedByLockId, status: d.status, createdAt: d.createdAt, resolvedAt: d.resolvedAt,
        };
      });
    return {
      room: { id: room._id, code: room.code, title: room.title, hostId: room.hostId, autoAllow: room.autoAllow, status: room.status, createdAt: room.createdAt },
      members, artifacts, locks, sessions, drafts,
    };
  },
});

// B1 Phase 2: the narrow companion to `full` — the room shell WITHOUT cell elements and WITHOUT the
// per-edit bump-carrier fields (version/order/updatedAt). Convex re-runs a query whenever any row in
// its read-set changes, but it only re-ships the RESULT when its hash changes; by projecting only the
// stable artifact fields (id/roomId/kind/title/createdBy/visibility/meta) the result is identical
// after a cell-edit bump → meta stops re-shipping per keystroke. Bump-carriers live in the sibling
// `artifacts.versions(roomId)` query, which clients merge in. Reverting the win is a 3-line projection
// edit (add `version`, `order`, `updatedAt` back) — fields are still patched server-side.
// `full` is kept for back-compat until the client migrates.
export const meta = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    const actor = await requireActorProof(ctx, roomId, requester);
    const members = (await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .filter((m) => m.revokedAt == null)
      .map((m) => ({ id: m._id, roomId: m.roomId, name: m.name, role: m.role, anon: m.anon, color: m.color, lastSeenAt: m.lastSeenAt }));
    const arts = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .filter((a) => canReadArtifact(a, actor));
    const artifacts = arts.map((a) => ({
      id: a._id,
      roomId: a.roomId,
      kind: a.kind,
      title: a.title,
      createdBy: a.createdBy,
      visibility: a.visibility ?? "room",
      meta: a.meta,
    }));
    const locks = (await ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect())
      .map((l) => ({ id: l._id, roomId: l.roomId, artifactId: l.artifactId, elementIds: l.elementIds, holder: l.holder, sessionId: l.sessionId, reason: l.reason, status: l.status, createdAt: l._creationTime }));
    const sessions = (await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((s) => ({ id: s._id, roomId: s.roomId, agentId: s.agentId, agentName: s.agentName, scope: s.scope, ownerId: s.ownerId, status: s.status, heldLockId: s.heldLockId, lastAction: s.lastAction, updatedAt: s.updatedAt }));
    const drafts = (await ctx.db.query("drafts").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect())
      .map((d) => {
        const redact = d.author.scope === "private" && !(d.author.ownerId !== undefined && d.author.ownerId === actor.id);
        return {
          id: d._id, roomId: d.roomId, artifactId: d.artifactId, author: d.author,
          ops: redact ? [] : d.ops,
          opsRedacted: redact ? d.ops.length : undefined,
          note: redact ? "[private draft]" : d.note,
          blockedByLockId: d.blockedByLockId, status: d.status, createdAt: d.createdAt, resolvedAt: d.resolvedAt,
        };
      });
    return {
      room: { id: room._id, code: room.code, title: room.title, hostId: room.hostId, autoAllow: room.autoAllow, status: room.status, createdAt: room.createdAt },
      members, artifacts, locks, sessions, drafts,
    };
  },
});

export const toggleAutoAllow = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const r = await ctx.db.get(roomId);
    if (!r) return;
    const actor = await requireActorProof(ctx, roomId, requester);
    if (String(r.hostId) !== actor.id) throw new Error("host_required");
    await ctx.db.patch(roomId, { autoAllow: !r.autoAllow });
    await ctx.db.insert("traces", { roomId, ts: Date.now(), actor, type: "auto_allow_toggled", summary: `${actor.name} turned auto-allow ${!r.autoAllow ? "on" : "off"}` });
  },
});
