/** Seed and repair the live demo room (mirrors src/engine/demoRoom.ts). */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { hashToken, timingSafeEqualSecret } from "./lib";

const DEMO_CODE = "Q3DEMO";
const CAPTURE_NOTEBOOK_DOC = "<h1>Capture Notebook</h1><p>Who did you talk to? What changed? What should we verify next? Drop messy notes here, then pause — NodeRoom will notice the signals worth returning to.</p>";
const WIKI_DOC = "Living wiki for room state, file inventory, agent sessions, workflows, backend map, and recent trace evidence. It updates from artifacts, sessions, runs, and traces.";

const SHEET_ROWS = [
  { id: "r_rev", label: "Revenue", q2: "$10,000", q3: "$12,400" },
  { id: "r_cogs", label: "COGS", q2: "$4,000", q3: "$5,100" },
  { id: "r_gp", label: "Gross profit", q2: "$6,000", q3: "$7,300" },
  { id: "r_opex", label: "OpEx", q2: "$2,200", q3: "$2,650" },
  { id: "r_ni", label: "Net income", q2: "$3,800", q3: "$4,650" },
];

const COLS: [string, (r: { label: string; q2: string; q3: string }) => string][] = [
  ["label", (r) => r.label],
  ["q2", (r) => r.q2],
  ["q3", (r) => r.q3],
  ["variance", () => ""],
  ["note", () => ""],
];

const DEMO_MEMBERS = [
  { name: "Homen", role: "host", anon: false, color: "#d97757" },
  { name: "Priya", role: "member", anon: false, color: "#5b9bf5" },
  { name: "anon · quokka", role: "member", anon: true, color: "#7bd089" },
] as const;

async function requireSeedAdmin(adminToken: string) {
  const expected = process.env.SEED_ADMIN_TOKEN;
  if (!expected) throw new Error("seed_admin_token_not_configured");
  if (!await timingSafeEqualSecret(adminToken, expected)) throw new Error("seed_admin_forbidden");
}

async function migrateLegacyMemberTokens(ctx: MutationCtx) {
  const members = await ctx.db.query("members").collect();
  let migrated = 0, clearedWeak = 0;
  for (const member of members) {
    if (!member.authToken) continue;
    try {
      await ctx.db.patch(member._id, { authToken: undefined, authTokenHash: await hashToken(member.authToken) });
      migrated++;
    } catch {
      await ctx.db.patch(member._id, { authToken: undefined, authTokenHash: undefined });
      clearedWeak++;
    }
  }
  return { migrated, clearedWeak };
}

async function authPatchForMember(member: { name: string; authToken?: string; authTokenHash?: string }, hostAuthToken?: string) {
  if (member.name === "Homen" && hostAuthToken) {
    return { authToken: undefined, authTokenHash: await hashToken(hostAuthToken) };
  }
  if (member.authToken || member.authTokenHash) {
    return { authToken: undefined, authTokenHash: undefined };
  }
  return {};
}

async function ensureDemoMembers(ctx: MutationCtx, roomId: Id<"rooms">, now: number, hostAuthToken?: string) {
  const existing = await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  const ids: Record<string, Id<"members">> = {};
  let patched = 0;

  for (const spec of DEMO_MEMBERS) {
    const member = existing.find((m) => m.name === spec.name);
    if (member) {
      const authPatch = await authPatchForMember(member, hostAuthToken);
      if (member.role !== spec.role || member.anon !== spec.anon || member.color !== spec.color || Object.keys(authPatch).length > 0) {
        await ctx.db.patch(member._id, { role: spec.role, anon: spec.anon, color: spec.color, ...authPatch });
        patched++;
      }
      ids[spec.name] = member._id;
    } else {
      const authPatch = spec.name === "Homen" && hostAuthToken ? { authTokenHash: await hashToken(hostAuthToken) } : {};
      ids[spec.name] = await ctx.db.insert("members", { roomId, ...spec, ...authPatch, lastSeenAt: now });
      patched++;
    }
  }

  return { homen: ids.Homen, patched };
}

async function ensureDemoSheet(ctx: MutationCtx, roomId: Id<"rooms">, homen: Id<"members">, now: number) {
  const existing = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
    .find((a) => a.kind === "sheet" && a.title === "Q3 variance");
  if (existing) return existing._id;

  const by = { kind: "user" as const, id: homen, name: "Homen" };
  const order: string[] = [];
  for (const r of SHEET_ROWS) for (const [c] of COLS) order.push(`${r.id}__${c}`);

  const sheetId = await ctx.db.insert("artifacts", { roomId, kind: "sheet", title: "Q3 variance", version: 1, order, updatedAt: now });
  for (const r of SHEET_ROWS) {
    for (const [c, get] of COLS) {
      await ctx.db.insert("elements", { artifactId: sheetId, elementId: `${r.id}__${c}`, value: get(r), version: 1, updatedAt: now, updatedBy: by });
    }
  }
  return sheetId;
}

async function ensureDemoWiki(ctx: MutationCtx, roomId: Id<"rooms">, homen: Id<"members">, now: number) {
  const existing = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
    .find((a) => a.kind === "note" && a.title === "Agent wiki");
  if (existing) return existing._id;

  const by = { kind: "user" as const, id: String(homen), name: "Homen" };
  const wikiId = await ctx.db.insert("artifacts", { roomId, kind: "note", title: "Agent wiki", version: 1, order: ["doc"], updatedAt: now });
  await ctx.db.insert("elements", { artifactId: wikiId, elementId: "doc", value: WIKI_DOC, version: 1, updatedAt: now, updatedBy: by });
  return wikiId;
}

async function ensureDemoCaptureNotebook(ctx: MutationCtx, roomId: Id<"rooms">, homen: Id<"members">, now: number) {
  const existing = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
    .find((a) => a.kind === "note" && a.title === "Capture Notebook");
  if (existing) return existing._id;

  const by = { kind: "user" as const, id: String(homen), name: "Homen" };
  const notebookId = await ctx.db.insert("artifacts", { roomId, kind: "note", title: "Capture Notebook", version: 1, order: ["doc"], updatedAt: now });
  await ctx.db.insert("elements", { artifactId: notebookId, elementId: "doc", value: CAPTURE_NOTEBOOK_DOC, version: 1, updatedAt: now, updatedBy: by });
  return notebookId;
}

async function ensureDemoSessions(ctx: MutationCtx, roomId: Id<"rooms">, homen: Id<"members">, now: number) {
  const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  const publicSession = sessions.find((s) => s.agentId === "agent_room" && s.scope === "public");
  const sessionId = publicSession?._id ?? await ctx.db.insert("agentSessions", { roomId, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public", status: "idle", lastAction: "started", updatedAt: now });

  const privateSession = sessions.find((s) => s.agentId === "agent_priv" && s.scope === "private");
  if (privateSession) await ctx.db.patch(privateSession._id, { ownerId: homen, updatedAt: now });
  else await ctx.db.insert("agentSessions", { roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "private", ownerId: homen, status: "idle", lastAction: "started", updatedAt: now });

  return sessionId;
}

async function ensureDemoRoom(ctx: MutationCtx, roomId: Id<"rooms">, now: number, options?: { hostAuthToken?: string; patchHost?: boolean }) {
  const { homen, patched } = await ensureDemoMembers(ctx, roomId, now, options?.hostAuthToken);
  const room = await ctx.db.get(roomId);
  if (options?.patchHost && room && String(room.hostId) !== String(homen)) await ctx.db.patch(roomId, { hostId: homen });

  await ensureDemoCaptureNotebook(ctx, roomId, homen, now);
  const wikiId = await ensureDemoWiki(ctx, roomId, homen, now);
  const sheetId = await ensureDemoSheet(ctx, roomId, homen, now);
  const sessionId = await ensureDemoSessions(ctx, roomId, homen, now);
  return { roomId, wikiId, sheetId, sessionId, homenId: homen, backfilledMembers: patched };
}

export const seedDemoRoom = mutation({
  args: { adminToken: v.string(), hostAuthToken: v.optional(v.string()) },
  handler: async (ctx, { adminToken, hostAuthToken }) => {
    await requireSeedAdmin(adminToken);
    const now = Date.now();
    const existing = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", DEMO_CODE)).first();
    const roomId = existing?._id ?? await ctx.db.insert("rooms", { code: DEMO_CODE, title: "Q3 diligence", hostId: "", autoAllow: true, status: "live", createdAt: now });
    const seeded = await ensureDemoRoom(ctx, roomId, now, { hostAuthToken, patchHost: true });
    return {
      ...seeded,
      backfilled: existing !== null,
      agentActor: { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" },
    };
  },
});

/** Repair pre-token demo rows after member-token auth hardening without assigning known source-code tokens. */
export const backfillDemoAuthTokens = mutation({
  args: { adminToken: v.string(), hostAuthToken: v.optional(v.string()) },
  handler: async (ctx, { adminToken, hostAuthToken }) => {
    await requireSeedAdmin(adminToken);
    const rooms = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", DEMO_CODE)).collect();
    const now = Date.now();
    const migrated = await migrateLegacyMemberTokens(ctx);
    let backfilledMembers = 0;
    for (const room of rooms) {
      const result = await ensureDemoRoom(ctx, room._id, now, { hostAuthToken, patchHost: false });
      backfilledMembers += result.backfilledMembers;
    }
    return { code: DEMO_CODE, rooms: rooms.length, backfilledMembers, ...migrated };
  },
});

export const migrateLegacyAuthTokens = mutation({
  args: { adminToken: v.string() },
  handler: async (ctx, { adminToken }) => {
    await requireSeedAdmin(adminToken);
    return migrateLegacyMemberTokens(ctx);
  },
});

/** Reset the demo room's variance + note cells to empty so the agent has real work to recompute. */
export const clearVariance = mutation({
  args: { adminToken: v.string(), code: v.optional(v.string()) },
  handler: async (ctx, { adminToken, code }) => {
    await requireSeedAdmin(adminToken);
    const roomCode = (code ?? DEMO_CODE).toUpperCase();
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", roomCode)).first();
    if (!room) return { cleared: 0 };
    const sheet = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect()).find((a) => a.kind === "sheet");
    if (!sheet) return { cleared: 0 };
    const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", sheet._id)).collect();
    const now = Date.now();
    let cleared = 0;
    for (const e of els) {
      if ((e.elementId.endsWith("__variance") || e.elementId.endsWith("__note")) && e.value !== "") {
        await ctx.db.patch(e._id, { value: "", version: e.version + 1, updatedAt: now });
        cleared++;
      }
    }
    await ctx.db.patch(sheet._id, { version: sheet.version + 1, updatedAt: now });
    return { cleared, sheetId: sheet._id, roomId: room._id };
  },
});

/** Add the company-research artifact (ParselyFi surface) to an existing room - idempotent. */
export const seedResearch = mutation({
  args: { adminToken: v.string(), code: v.optional(v.string()) },
  handler: async (ctx, { adminToken, code }) => {
    await requireSeedAdmin(adminToken);
    const roomCode = (code ?? DEMO_CODE).toUpperCase();
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", roomCode)).first();
    if (!room) return { added: false as const, reason: "no room" };
    const host = await ctx.db.get(room.hostId as Id<"members">);
    if (!host) return { added: false as const, reason: "no host" };
    const existing = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect()).find((a) => a.title === "Company research");
    if (existing) return { added: false as const, reason: "exists", artifactId: existing._id };
    const cols = ["company", "website", "status", "tier", "intent", "owner", "crm_status", "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched"] as const;
    const companies = [
      { id: "rc_anthropic", company: "Anthropic", website: "https://www.anthropic.com", tier: "A", intent: "AI safety + enterprise API", owner: "Homen", crm_status: "Target" },
      { id: "rc_ramp", company: "Ramp", website: "https://ramp.com", tier: "A", intent: "Finance automation", owner: "Priya", crm_status: "Working" },
      { id: "rc_mercury", company: "Mercury", website: "https://mercury.com", tier: "B", intent: "Startup banking", owner: "Homen", crm_status: "Research" },
      { id: "rc_brex", company: "Brex", website: "https://www.brex.com", tier: "A", intent: "Spend management", owner: "Priya", crm_status: "Target" },
    ];
    const now = Date.now();
    const by = { kind: "user" as const, id: room.hostId, name: host.name };
    const artifactId = await ctx.db.insert("artifacts", { roomId: room._id, kind: "sheet", title: "Company research", version: 1, order: [], updatedAt: now });
    const order: string[] = [];
    for (const c of companies) {
      const vals: Record<(typeof cols)[number], string> = {
        company: c.company, website: c.website, status: "pending", tier: c.tier, intent: c.intent, owner: c.owner, crm_status: c.crm_status,
        summary: "", funding: "", headcount: "", recent_signal: "", source: "", source2: "", last_researched: "",
      };
      for (const col of cols) {
        const eid = `${c.id}__${col}`;
        order.push(eid);
        await ctx.db.insert("elements", { artifactId, elementId: eid, value: vals[col], version: 1, updatedAt: now, updatedBy: by });
      }
    }
    await ctx.db.patch(artifactId, { order });
    return { added: true as const, artifactId, roomId: room._id };
  },
});
