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
const STARTUP_RESEARCH_EVIDENCE_COLS = new Set(["summary", "funding", "headcount", "recent_signal"]);
const STARTUP_RESEARCH_AGENT_READONLY_COLS = new Set(["company", "website", "tier", "intent", "owner", "crm_status"]);

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
      rowCount: STARTUP_RESEARCH_ROWS.length,
      sourceFile: "starter-room",
      sheetName: "Company research",
      sheetNames: ["Company research"],
      parser: "starter_seed",
      truncated: false,
      warnings: [],
    },
  };
}

const STARTUP_RESEARCH_ROWS: StartupResearchRow[] = [
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

function startupResearchSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const row of STARTUP_RESEARCH_ROWS) {
    for (const col of STARTUP_RESEARCH_COLS) {
      seed.push({ id: `${row.rowId}__${col}`, value: row[col] });
    }
  }
  return seed;
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
    await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Company research", seed: startupResearchSeed(), actor, now, meta: startupResearchMeta() });
    await insertStarterArtifact(ctx, { roomId, kind: "note", title: "Diligence memo", seed: starterNoteSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "wall", title: "Risk / opportunity wall", seed: starterWallSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Runway / milestones", seed: starterRunwaySeed(), actor, now, meta: { dataframe: { columns: ["company", "cash", "burn", "runway", "status", "milestones"], rowCount: 2, sourceFile: "starter-room", parser: "starter_seed", truncated: false, warnings: [] } } });
    await insertStarterArtifact(ctx, { roomId, kind: "note", title: "Open questions / workplan", seed: starterWorkplanSeed(), actor, now });
    await insertStarterArtifact(ctx, { roomId, kind: "sheet", title: "Q3 variance", seed: starterSheetSeed(), actor, now });
    return { roomId, memberId };
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

// B1: the narrow companion to `full` — the room shell WITHOUT cell elements. Its read-set is the
// rooms/members/artifacts/locks/sessions/drafts rows, none of which change on a cell edit, so a
// keystroke does NOT re-run/re-ship this query. Clients pair it with `artifacts.elements(openArtifactId)`
// so one edit re-ships only the edited artifact's cells, not the whole room (O(E·U) -> O(edited-artifact)).
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
      version: a.version,
      order: a.order,
      updatedAt: a.updatedAt,
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
