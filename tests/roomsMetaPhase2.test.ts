// @vitest-environment edge-runtime
/**
 * RUNTIME proof for B1 PHASE 2 — the artifact-row bump (version/order/updatedAt patched by
 * applyCellEditCore on every cell write) no longer fans out through rooms.meta.
 *
 * Phase 1 (already in main, see roomsFullSplit.test.ts) split cell ELEMENTS off rooms.meta. But the
 * artifact ROW itself still got bumped on every cell edit, and rooms.meta projected version/order/
 * updatedAt — so meta's result hash changed per keystroke and it kept re-shipping the shell.
 *
 * Phase 2 (this file): the bump-carriers were lifted out of rooms.meta into a sibling query
 * `artifacts.versions(roomId)`. Server bumps are unchanged (the CAS spine + OKF source-version
 * invalidation depend on it); only the rooms.meta PROJECTION dropped those fields.
 *
 * Invariants under test, against a real Convex query engine (convex-test, no deploy):
 *  1. rooms.meta is BYTE-IDENTICAL across a cell edit (it no longer carries the bumped fields).
 *  2. artifacts.versions DOES change — that's the small targeted query that now carries the bump.
 *  3. The shed per-edit payload is at least a meaningful fraction of the meta shell.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"]; // "use node" action — not needed here

const TOK = "phase2-token-abcdefghij0123456789-XYZ";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
const SHAPES = [60, 40, 30, 15]; // 145 elements across 4 artifacts — mirrors live Q3DEMO scale

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: "PH2", title: "Phase 2 proof", hostId: "pending", autoAllow: true, status: "live" as const, createdAt: now });
    const memberId = await ctx.db.insert("members", { roomId, name: "Homen", role: "host" as const, anon: false, color: "#d97757", authTokenHash: await hashToken(TOK), lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: String(memberId) });
    const artIds: Id<"artifacts">[] = [];
    for (let ai = 0; ai < SHAPES.length; ai++) {
      const artId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: `sheet${ai}`, version: 1, order: [], updatedAt: now, meta: {} });
      for (let c = 0; c < SHAPES[ai]; c++) {
        await ctx.db.insert("elements", { artifactId: artId, elementId: `r${c}__v`, value: `cell ${ai}-${c} value`, version: 1, updatedAt: now, updatedBy: AGENT });
      }
      artIds.push(artId);
    }
    return { roomId, memberId, artIds };
  });
}

const proof = (memberId: string) => ({ actor: { kind: "user" as const, id: String(memberId), name: "Homen" }, token: TOK });

test("B1 Phase 2: rooms.meta projection no longer carries version/order/updatedAt per artifact", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId } = await seed(t);
  const meta = await t.query(api.rooms.meta, { roomId, requester: proof(memberId) });
  for (const a of meta!.artifacts as Array<Record<string, unknown>>) {
    expect(a.version, "meta projection must NOT include version (bump-carrier)").toBeUndefined();
    expect(a.order, "meta projection must NOT include order (bump-carrier)").toBeUndefined();
    expect(a.updatedAt, "meta projection must NOT include updatedAt (bump-carrier)").toBeUndefined();
    // Stable fields are still present.
    expect(a.id).toBeDefined();
    expect(a.kind).toBeDefined();
    expect(a.title).toBeDefined();
  }
});

test("B1 Phase 2: artifacts.versions exposes the bump-carriers and is scoped to the room", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId, artIds } = await seed(t);
  const versions = await t.query(api.artifacts.versions, { roomId, requester: proof(memberId) });
  expect(versions.length).toBe(SHAPES.length);
  // Order matters less than presence-of-shape: each row carries id/version/order/updatedAt.
  for (const v of versions) {
    expect(typeof v.version).toBe("number");
    expect(Array.isArray(v.order)).toBe(true);
    expect(typeof v.updatedAt).toBe("number");
  }
  expect(versions.some((v) => String(v.id) === String(artIds[0]))).toBe(true);
});

test("B1 Phase 2: a CELL EDIT (with artifact-row bump) leaves rooms.meta byte-identical", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId, artIds } = await seed(t);

  const metaBefore = JSON.stringify(await t.query(api.rooms.meta, { roomId, requester: proof(memberId) }));
  const versionsBefore = JSON.stringify(await t.query(api.artifacts.versions, { roomId, requester: proof(memberId) }));

  // Simulate what applyCellEditCore does on a real cell write: patch the element AND the artifact
  // row (version+1, updatedAt). The Phase 1 test only patched the element; THIS test bumps the
  // artifact row too — that's the bump that used to fan out through rooms.meta and re-ship the shell.
  await t.run(async (ctx) => {
    const el = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artIds[0]).eq("elementId", "r0__v")).unique();
    const art = await ctx.db.get(artIds[0]);
    const now = Date.now();
    await ctx.db.patch(el!._id, { value: "EDITED_P2", version: el!.version + 1, updatedAt: now });
    await ctx.db.patch(artIds[0], { version: art!.version + 1, updatedAt: now });
  });

  const metaAfter = JSON.stringify(await t.query(api.rooms.meta, { roomId, requester: proof(memberId) }));
  const versionsAfter = JSON.stringify(await t.query(api.artifacts.versions, { roomId, requester: proof(memberId) }));

  // PHASE 2 INVARIANT: even though the artifact row was bumped, rooms.meta's output is byte-identical
  // — projecting only stable fields means the bump no longer changes the result hash.
  expect(metaAfter, "rooms.meta must NOT re-ship on a cell-edit artifact-row bump").toBe(metaBefore);
  // The bump went to the targeted query instead.
  expect(versionsAfter, "artifacts.versions DOES re-ship — it now carries the bump").not.toBe(versionsBefore);
});

test("B1 Phase 2: measurement — meta+versions per-edit re-ship is meaningfully smaller than meta+versions in Phase-1 shape", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId, artIds } = await seed(t);

  // Measure both queries' payloads after a cell-edit bump. Under Phase 2, ONLY artifacts.versions
  // re-ships — meta stays cached. The "Phase 1 hypothetical" is the (meta + versions) sum, which is
  // what would re-ship if the bump-carriers were still on meta and the entire shell had to redeliver.
  await t.run(async (ctx) => {
    const el = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artIds[0]).eq("elementId", "r0__v")).unique();
    const art = await ctx.db.get(artIds[0]);
    const now = Date.now();
    await ctx.db.patch(el!._id, { value: "EDITED_MEAS", version: el!.version + 1, updatedAt: now });
    await ctx.db.patch(artIds[0], { version: art!.version + 1, updatedAt: now });
  });

  const metaBytes = JSON.stringify(await t.query(api.rooms.meta, { roomId, requester: proof(memberId) })).length;
  const versionsBytes = JSON.stringify(await t.query(api.artifacts.versions, { roomId, requester: proof(memberId) })).length;

  // versions is small — it carries only id/version/order/updatedAt for each artifact.
  expect(versionsBytes).toBeLessThan(metaBytes); // the targeted bump-carrier is smaller than the shell
  // The actual re-ship delta on an edit is JUST versionsBytes (meta hash unchanged → cached).
  // Before Phase 2, meta would have re-shipped too. The win is metaBytes worth of avoided traffic per edit.
  // Log it for visibility in CI; this is not a hard threshold (artifact count varies in production).
  // eslint-disable-next-line no-console
  console.log(`[B1 Phase 2] per-edit re-ship: ${versionsBytes}B (was meta+versions ≈ ${metaBytes + versionsBytes}B before Phase 2)`);
});
