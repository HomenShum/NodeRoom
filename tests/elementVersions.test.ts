// @vitest-environment edge-runtime
/**
 * Per-cell VERSION LOG — server scenarios against a REAL in-memory Convex
 * deployment (convex-test, prosemirror-sync component registered like the
 * notebook harness).
 *
 * Persona: Maya hosts a diligence room and works the starter "Q3 variance"
 * sheet. She edits the revenue-variance cell three times, then the room agent
 * overwrites it — the classic human/agent collision the Receipts layer must
 * make recoverable. Covered angles:
 *   (a) happy path: every APPLIED write appends exactly one before-image row
 *       (value the write superseded, keyed by the version that held it)
 *   (b) sad paths: conflict / locked / pending_approval append NOTHING
 *   (c) adversarial: history is proof-gated; private sheets hide history from
 *       non-owners (query mirrors listNotebookBlocks) and block restores
 *   (d) restore: the old value comes back as a NEW CAS version with its own
 *       log row — never a history rewrite — and honest locked/not-found DATA
 *   (e) honesty: a truncated big-value snapshot refuses restore instead of
 *       committing corrupt data; small objects round-trip exactly
 *   (f) sustained load: a 60-write loop grows the raw log but every read stays
 *       bounded by take() caps, and retention pruning drains the log while the
 *       live element (product data) survives
 */
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";

vi.setConfig({ testTimeout: 30_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const ROOM_CODE = "VERLOG1";
const HOST_TOKEN = "element-versions-host-token-0123456789";
const RILEY_TOKEN = "element-versions-riley-token-9876543210";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

// convex/_generated lags until the next codegen — which must NOT be run casually
// here: `npx convex codegen` against a configured cloud deployment DEPLOYS
// schema+functions (documented gotcha). Same reference pattern as
// tests/securityConvexSurfaces.test.ts; convex-test resolves by name at runtime.
type ActorProof = { actor: { kind: "user" | "agent"; id: string; name: string; scope?: "public" | "private"; ownerId?: string }; token?: string };
type VersionRow = {
  version: number;
  value: unknown;
  truncated: boolean;
  updatedBy: { kind: "user" | "agent"; id: string; name: string };
  kind: "set" | "create" | "delete";
  ts: number;
};
type EditOutcome =
  | { ok: true; version: number; mutationReceiptId?: string }
  | { ok: false; reason: string; expected?: number; actual?: number; by?: string; truncated?: boolean };
const listElementVersionsRef = makeFunctionReference<
  "query",
  { roomId: Id<"rooms">; artifactId: Id<"artifacts">; elementId: string; requester: ActorProof; limit?: number },
  VersionRow[]
>("elementHistory:listElementVersions");
const restoreElementVersionRef = makeFunctionReference<
  "mutation",
  { roomId: Id<"rooms">; artifactId: Id<"artifacts">; elementId: string; requester: ActorProof; version: number },
  EditOutcome
>("elementHistory:restoreElementVersion");

async function seedRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
  const created = await t.mutation(api.rooms.createStarterRoom, {
    code: ROOM_CODE,
    title: "Version log proof room",
    hostName: "Maya",
    authToken: HOST_TOKEN,
  });
  const actor = { kind: "user" as const, id: String(created.memberId), name: "Maya" };
  const proof = { actor, token: HOST_TOKEN };
  const meta = await t.query(api.rooms.meta, { roomId: created.roomId, requester: proof });
  if (!meta) throw new Error("starter room meta not found");
  const sheet = meta.artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance");
  if (!sheet) throw new Error("starter variance sheet not found");
  const artifactId = sheet.id as Id<"artifacts">;
  // Maya's working cell: the revenue variance column (seeded "" at version 1).
  const seedEl = await t.run(async (ctx) => {
    const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
    return els.find((e) => e.elementId === "r_rev__variance") ?? els.find((e) => e.elementId.endsWith("__variance")) ?? els[0];
  });
  if (!seedEl) throw new Error("starter sheet has no elements");
  return { t, roomId: created.roomId, artifactId, actor, proof, cellId: seedEl.elementId, seedVersion: seedEl.version, seedValue: seedEl.value };
}

type Harness = Awaited<ReturnType<typeof seedRoom>>;

async function readCell(h: Harness) {
  return h.t.run(async (ctx) =>
    ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", h.artifactId).eq("elementId", h.cellId)).unique());
}

async function logRows(h: Harness) {
  return h.t.run(async (ctx) =>
    ctx.db.query("elementVersions").withIndex("by_artifact_element", (q) => q.eq("artifactId", h.artifactId).eq("elementId", h.cellId)).collect());
}

async function mayaEdit(h: Harness, value: unknown, baseVersion: number) {
  return h.t.mutation(api.artifacts.applyCellEdit, {
    roomId: h.roomId,
    artifactId: h.artifactId,
    elementId: h.cellId,
    value,
    baseVersion,
    proof: h.proof,
  });
}

describe("elementVersions — per-cell version log (history / Restore / diff)", () => {
  it("(a) Maya edits 3x then the agent overwrites — one before-image row per applied write", async () => {
    const h = await seedRoom();
    const v0 = h.seedVersion;

    for (const [i, value] of (["+5%", "+7%", "+9%"] as const).entries()) {
      const r = await mayaEdit(h, value, v0 + i);
      expect(r.ok).toBe(true);
    }
    // The agent overwrite that makes recovery matter (auto-commit approved by the host).
    await h.t.run(async (ctx) => { await ctx.db.patch(h.roomId, { autoAllow: true }); });
    const agentEdit = await h.t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: h.roomId,
      artifactId: h.artifactId,
      elementId: h.cellId,
      value: "+19% (agent)",
      baseVersion: v0 + 3,
      actor: AGENT,
    });
    expect(agentEdit.ok).toBe(true);

    const rows = await logRows(h);
    expect(rows.length).toBe(4); // exactly one row per applied write
    const byVersion = new Map(rows.map((r) => [r.version, r]));
    // Before-images: row at version N holds the value the element had AT version N.
    expect(byVersion.get(v0)?.value).toBe(h.seedValue);
    expect(byVersion.get(v0 + 1)?.value).toBe("+5%");
    expect(byVersion.get(v0 + 2)?.value).toBe("+7%");
    expect(byVersion.get(v0 + 3)?.value).toBe("+9%");
    // Provenance: who changed each version AWAY (the agent superseded Maya's v4).
    expect(byVersion.get(v0)?.updatedBy).toMatchObject({ kind: "user", name: "Maya" });
    expect(byVersion.get(v0 + 3)?.updatedBy).toMatchObject({ kind: "agent", id: AGENT.id });
    expect(rows.every((r) => r.truncated === false && r.kind === "set" && typeof r.ts === "number")).toBe(true);

    // The proof-gated query serves the same rows newest-first.
    const listed = await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof });
    expect(listed.map((r) => r.version)).toEqual([v0 + 3, v0 + 2, v0 + 1, v0]);
  });

  it("(b) conflict, locked, and pending_approval paths never append log rows", async () => {
    const h = await seedRoom();
    const v0 = h.seedVersion;
    const applied = await mayaEdit(h, "+5%", v0);
    expect(applied.ok).toBe(true);
    expect((await logRows(h)).length).toBe(1);

    // CONFLICT: a stale baseline is rejected as data — no log row.
    const stale = await mayaEdit(h, "+clobber", v0);
    expect(stale).toMatchObject({ ok: false, reason: "conflict" });

    // LOCKED: another member's active lease covers the cell — no log row.
    const lockId = await h.t.run(async (ctx) =>
      ctx.db.insert("locks", {
        roomId: h.roomId,
        artifactId: h.artifactId,
        elementIds: [h.cellId],
        holder: { kind: "user" as const, id: "member_riley", name: "Riley" },
        sessionId: "sess_riley",
        reason: "reconciling Q3 numbers",
        status: "active" as const,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }));
    const locked = await mayaEdit(h, "+blocked", v0 + 1);
    expect(locked).toMatchObject({ ok: false, reason: "locked", by: "Riley" });
    await h.t.run(async (ctx) => { await ctx.db.patch(lockId, { status: "released" as const, releasedAt: Date.now() }); });

    // PENDING: review mode (starter default autoAllow:false) routes the agent's
    // correct-baseline write to a proposal — the value never applied, so no log row.
    const pending = await h.t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: h.roomId,
      artifactId: h.artifactId,
      elementId: h.cellId,
      value: "+agent draft",
      baseVersion: v0 + 1,
      actor: AGENT,
    });
    expect(pending).toMatchObject({ ok: false, reason: "pending_approval" });

    expect((await logRows(h)).length).toBe(1); // unchanged through all three sad paths
    expect((await readCell(h))?.value).toBe("+5%"); // and the cell itself never moved
  });

  it("(c) history is proof-gated and a private sheet hides history from non-owners", async () => {
    const h = await seedRoom();
    const applied = await mayaEdit(h, "+5%", h.seedVersion);
    expect(applied.ok).toBe(true);

    // Adversarial: a forged token is rejected outright.
    await expect(h.t.query(listElementVersionsRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId,
      requester: { actor: h.actor, token: "forged-token-that-is-long-enough-000000" },
    })).rejects.toThrow(/invalid_actor_token/);
    // Adversarial: an agent identity cannot present user proof at all.
    await expect(h.t.query(listElementVersionsRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId,
      requester: { actor: AGENT },
    })).rejects.toThrow(/user_proof_required/);

    // Riley joins with his own valid token — room-visible history is readable.
    const riley = await h.t.mutation(api.rooms.joinAnonymous, { code: ROOM_CODE, name: "Riley", authToken: RILEY_TOKEN });
    if (!riley || "error" in riley) throw new Error("riley failed to join");
    const rileyProof = { actor: { kind: "user" as const, id: String(riley.memberId), name: "Riley" }, token: RILEY_TOKEN };
    const visible = await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: rileyProof });
    expect(visible.length).toBe(1);

    // Maya flips the sheet private: Riley's history goes dark (mirrors
    // listNotebookBlocks — empty, not an error), the owner keeps access,
    // and restore hits the same wall.
    await h.t.run(async (ctx) => { await ctx.db.patch(h.artifactId, { visibility: "private" as const, createdBy: h.actor }); });
    expect(await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: rileyProof })).toEqual([]);
    const owner = await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof });
    expect(owner.length).toBe(1);
    await expect(h.t.mutation(restoreElementVersionRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: rileyProof, version: h.seedVersion,
    })).rejects.toThrow(/artifact_not_visible/);
  });

  it("(d) Restore returns the old value as a NEW version, appends its own log row, and stays honest", async () => {
    const h = await seedRoom();
    const v0 = h.seedVersion;
    for (const [i, value] of (["+5%", "+7%", "+9%"] as const).entries()) {
      expect((await mayaEdit(h, value, v0 + i)).ok).toBe(true);
    }
    await h.t.run(async (ctx) => { await ctx.db.patch(h.roomId, { autoAllow: true }); });
    const agentEdit = await h.t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId,
      value: "+19% (agent)", baseVersion: v0 + 3, actor: AGENT,
    });
    expect(agentEdit.ok).toBe(true); // agent clobber-by-consent landed at v0+4

    // Maya restores HER value (version v0+3, before-image "+9%") — human-conflict recovery.
    const restored = await h.t.mutation(restoreElementVersionRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, version: v0 + 3,
    });
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.version).toBe(v0 + 5); // a NEW version — history never rewritten
    const el = await readCell(h);
    expect(el?.value).toBe("+9%");
    expect(el?.version).toBe(v0 + 5);

    // The restore logged its OWN before-image: the agent's value at v0+4, superseded by Maya.
    const rows = await logRows(h);
    expect(rows.length).toBe(5);
    const restoreRow = rows.find((r) => r.version === v0 + 4);
    expect(restoreRow?.value).toBe("+19% (agent)");
    expect(restoreRow?.updatedBy).toMatchObject({ kind: "user", name: "Maya" });

    // Unknown version → honest DATA, nothing written.
    const missing = await h.t.mutation(restoreElementVersionRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, version: 999,
    });
    expect(missing).toMatchObject({ ok: false, reason: "version_not_found" });

    // Restore under someone else's active lock → the standard honest locked outcome.
    await h.t.run(async (ctx) => {
      await ctx.db.insert("locks", {
        roomId: h.roomId, artifactId: h.artifactId, elementIds: [h.cellId],
        holder: { kind: "user" as const, id: "member_riley", name: "Riley" },
        sessionId: "sess_riley", reason: "verifying variance", status: "active" as const,
        createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      });
    });
    const blocked = await h.t.mutation(restoreElementVersionRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, version: v0 + 3,
    });
    expect(blocked).toMatchObject({ ok: false, reason: "locked", by: "Riley" });
    expect((await logRows(h)).length).toBe(5); // refused restores never log
  });

  it("(e) a truncated big-value snapshot refuses restore honestly; small objects round-trip exactly", async () => {
    const h = await seedRoom();
    const v0 = h.seedVersion;
    // A big non-scalar value (JSON well over the 4,000-char snapshot cap).
    const bigObject = { rows: Array.from({ length: 400 }, (_, i) => ({ id: i, note: `runway sensitivity scenario ${i}` })) };
    expect((await mayaEdit(h, bigObject, v0)).ok).toBe(true);
    expect((await mayaEdit(h, "+summary", v0 + 1)).ok).toBe(true); // logs bigObject's before-image → truncated

    const bigRow = (await logRows(h)).find((r) => r.version === v0 + 1);
    expect(bigRow?.truncated).toBe(true);
    expect(typeof bigRow?.value).toBe("string"); // stringified, cut at the cap
    expect((bigRow?.value as string).length).toBeLessThanOrEqual(4_000);
    // The honest flag reaches the history feed the UI reads.
    const listed = await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof });
    expect(listed.find((r) => r.version === v0 + 1)?.truncated).toBe(true);

    // Restore of the truncated snapshot is REFUSED as data — never corrupt-data-behind-ok:true.
    const refused = await h.t.mutation(restoreElementVersionRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, version: v0 + 1,
    });
    expect(refused).toMatchObject({ ok: false, reason: "snapshot_truncated", truncated: true });
    const el = await readCell(h);
    expect(el?.value).toBe("+summary"); // element untouched
    expect(el?.version).toBe(v0 + 2);
    expect((await logRows(h)).length).toBe(2); // and no phantom log row

    // A small non-scalar stores the ORIGINAL value and restores it exactly.
    const smallObject = { note: "q3 flag", severity: "amber" };
    expect((await mayaEdit(h, smallObject, v0 + 2)).ok).toBe(true);
    expect((await mayaEdit(h, "+final", v0 + 3)).ok).toBe(true); // logs smallObject at v0+3
    const roundTrip = await h.t.mutation(restoreElementVersionRef, {
      roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, version: v0 + 3,
    });
    expect(roundTrip.ok).toBe(true);
    expect((await readCell(h))?.value).toEqual(smallObject);
  });

  it("(f) 60-write sustained loop: the raw log grows, reads stay bounded, retention drains it", async () => {
    const h = await seedRoom();
    let base = h.seedVersion;
    for (let i = 1; i <= 60; i++) {
      const r = await mayaEdit(h, `iteration ${i}`, base);
      expect(r.ok).toBe(true);
      if (r.ok) base = r.version;
    }
    expect((await logRows(h)).length).toBe(60); // append-only source of truth

    // Default read: 20 rows, newest first (before-image of the latest write leads).
    const def = await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof });
    expect(def.map((r) => r.version)).toEqual(Array.from({ length: 20 }, (_, i) => base - 1 - i));
    // Adversarial limits: the hard cap (50) and the floor (1) both hold.
    expect((await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, limit: 10_000 })).length).toBe(50);
    expect((await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, limit: 0 })).length).toBe(1);
    expect((await h.t.query(listElementVersionsRef, { roomId: h.roomId, artifactId: h.artifactId, elementId: h.cellId, requester: h.proof, limit: -5 })).length).toBe(1);

    // Retention (30d policy, exercised via cutoff direction like productionGates):
    // the log drains as telemetry; the live element is product data and survives.
    const purge = await h.t.mutation(internal.retention.pruneOldTelemetry, { retentionDays: -1, batchPerTable: 500 });
    expect(purge.deleted.elementVersions).toBe(60);
    const el = await readCell(h);
    expect(el?.value).toBe("iteration 60");
    expect(el?.version).toBe(base);
  });
});
