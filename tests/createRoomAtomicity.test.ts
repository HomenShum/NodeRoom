// @vitest-environment edge-runtime
/**
 * ATOMIC ROOM CREATE — no orphaned / half-built rooms.
 *
 * The original client create path (src/ui/App.tsx) was non-transactional: it committed the room with
 * `rooms.create`, then seeded four artifacts with four separate `artifacts.createArtifact` mutations.
 * If any seed rejected (createArtifact throws on an oversized / invalid seed — see MAX_ARTIFACT_SEED_*
 * and the duplicate-element-id guard in convex/artifacts.ts), the room was already committed → a
 * phantom room with partial/missing artifacts, and a retry hit the "Room … already exists" dead-end.
 *
 * The fix moves seeding server-side into ONE mutation, `rooms.createStarterRoom`, which inserts the
 * room + host member + all starter artifacts inside a single Convex transaction (atomic: it all
 * commits or none of it does). These scenarios run against the REAL Convex functions (convex-test,
 * in-memory deployment, no deploy) and assert that a create can never leave an orphan room behind.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
// Node-only agent modules aren't needed for room/artifact mutations and don't import in edge-runtime.
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "atomic-create-host-token-0123456789";
const STARTER_TITLES = ["Company research", "Diligence memo", "Open questions / workplan", "Q3 variance", "Risk / opportunity wall", "Runway / milestones"];

type T = ReturnType<typeof convexTest>;
const allRooms = (t: T) => t.run(async (ctx) => await ctx.db.query("rooms").collect());
const artifactsIn = (t: T, roomId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("artifacts").collect()).filter((a) => String(a.roomId) === String(roomId)));
const elementsOf = (t: T, artifactId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("elements").collect()).filter((e) => String(e.artifactId) === String(artifactId)));
const spreadsheetCellsOf = (t: T, artifactId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("spreadsheetCells").collect()).filter((e) => String(e.artifactId) === String(artifactId)));
const membersIn = (t: T, roomId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("members").collect()).filter((m) => String(m.roomId) === String(roomId)));
const messagesIn = (t: T, roomId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => String(m.roomId) === String(roomId)));
const tracesIn = (t: T, roomId: unknown) =>
  t.run(async (ctx) => (await ctx.db.query("traces").collect()).filter((m) => String(m.roomId) === String(roomId)));

describe("atomic room create — no orphaned rooms", () => {
  it("createStarterRoom seeds a complete room (room + host + starter artifacts) in one transaction", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.rooms.createStarterRoom, {
      code: "ATOMA1", title: "Startup Banking Diligence War Room", hostName: "Maya", authToken: HOST_TOKEN, autoAllow: true,
    });

    const arts = await artifactsIn(t, res.roomId);
    expect(arts.map((a) => a.title).sort()).toEqual([...STARTER_TITLES].sort());
    // Each artifact is actually seeded — not an empty shell (the partial-room failure mode).
    for (const a of arts) expect((await elementsOf(t, a._id)).length).toBeGreaterThan(0);
    const runway = arts.find((a) => a.title === "Runway / milestones");
    const runwayColumns = ((runway?.meta as { dataframe?: { columns?: unknown[] } } | undefined)?.dataframe?.columns ?? [])
      .map((column) => column as { id?: unknown; label?: unknown; order?: unknown });
    expect(runwayColumns.map((column) => column.id)).toEqual(["company", "cash", "burn", "runway", "status", "milestones"]);
    expect(runwayColumns.every((column) => typeof column.label === "string" && typeof column.order === "number")).toBe(true);
    expect(await spreadsheetCellsOf(t, runway?._id)).toHaveLength(12);
    const research = arts.find((a) => a.title === "Company research");
    expect(research).toBeTruthy();
    const dataframe = (research?.meta as { dataframe?: { rowCount?: number; defaultHiddenColumnIds?: string[]; semanticIndexDisabled?: boolean } } | undefined)?.dataframe;
    expect(dataframe?.rowCount).toBe(1000);
    expect(dataframe?.defaultHiddenColumnIds).toContain("summary");
    expect(dataframe?.semanticIndexDisabled).toBe(true);
    expect(research?.order.length).toBeGreaterThanOrEqual(7000);
    expect(await messagesIn(t, res.roomId)).toHaveLength(312);
    expect(await tracesIn(t, res.roomId)).toHaveLength(400);
    // Host member committed in the same transaction.
    const members = await membersIn(t, res.roomId);
    expect(members.some((m) => m.role === "host" && m.name === "Maya")).toBe(true);
  });

  it("REGRESSION: old create + createArtifact leaves a PARTIAL room; createStarterRoom does not", async () => {
    const t = convexTest(schema, modules);

    // --- reproduce the OLD non-atomic path: room commits, then a seed rejects mid-create ---
    const created = await t.mutation(api.rooms.create, {
      code: "ORPHAN", title: "War Room", hostName: "Maya", authToken: HOST_TOKEN, autoAllow: true,
    });
    const proof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
    await t.mutation(api.artifacts.createArtifact, {
      roomId: created.roomId, kind: "sheet", title: "Company research", seed: [{ id: "a1", value: "x" }], proof,
    });
    // The 2nd seed REJECTS — duplicate element id trips assertCreateArtifactLimits (same guard family as
    // the MAX_ARTIFACT_SEED_* limits). This is the exact mid-create failure the bug report describes.
    await expect(
      t.mutation(api.artifacts.createArtifact, {
        roomId: created.roomId, kind: "note", title: "Diligence memo",
        seed: [{ id: "dup", value: "a" }, { id: "dup", value: "b" }], proof,
      }),
    ).rejects.toThrow(/duplicate element id/);

    // BUG: the room is committed but holds only 1 of the intended artifacts — an orphan/phantom room.
    expect((await allRooms(t)).some((r) => String(r._id) === String(created.roomId))).toBe(true);
    expect(await artifactsIn(t, created.roomId)).toHaveLength(1);

    // --- the FIX: createStarterRoom is all-or-nothing → a complete room, never partial ---
    const fixed = await t.mutation(api.rooms.createStarterRoom, {
      code: "ATOMOK1", title: "War Room", hostName: "Sam", authToken: HOST_TOKEN, autoAllow: true,
    });
    expect(await artifactsIn(t, fixed.roomId)).toHaveLength(STARTER_TITLES.length);
  });

  it("createStarterRoom validates before any write — failed creates leave ZERO rooms", async () => {
    const t = convexTest(schema, modules);
    // Weak code (< 6 chars after upper-casing) rejects before any insert.
    await expect(
      t.mutation(api.rooms.createStarterRoom, { code: "weak", title: "x", hostName: "Maya", authToken: HOST_TOKEN }),
    ).rejects.toThrow(/weak_room_code/);
    // Over-long title rejects before any insert.
    await expect(
      t.mutation(api.rooms.createStarterRoom, { code: "ATOMB1", title: "T".repeat(200), hostName: "Maya", authToken: HOST_TOKEN }),
    ).rejects.toThrow(/field_too_long/);
    // Nothing was committed on either failure path — no half-built or empty rooms.
    expect(await allRooms(t)).toHaveLength(0);
  });

  it("a repeat create on an existing code is rejected without duplicating or partializing the room", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(api.rooms.createStarterRoom, {
      code: "DUP123", title: "War Room", hostName: "Maya", authToken: HOST_TOKEN, autoAllow: true,
    });
    // A second create on the same code (e.g. a reload of ?create=DUP123) is rejected server-side; the
    // client treats this code-taken case as recoverable and re-enters by joining the existing room.
    await expect(
      t.mutation(api.rooms.createStarterRoom, {
        code: "DUP123", title: "War Room", hostName: "Eve", authToken: "eve-token-0123456789", autoAllow: true,
      }),
    ).rejects.toThrow(/room_code_taken/);
    // Still exactly one, still-complete room — the rejected attempt added nothing.
    expect(await allRooms(t)).toHaveLength(1);
    expect(await artifactsIn(t, first.roomId)).toHaveLength(STARTER_TITLES.length);
  });

  it("create with seedArtifacts seeds a custom artifact (+ meta) atomically in one transaction", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.rooms.create, {
      code: "SEED01", title: "Smoke", hostName: "Maya", authToken: HOST_TOKEN, autoAllow: true,
      seedArtifacts: [{
        kind: "sheet", title: "Q3 variance smoke",
        seed: [{ id: "r_rev__q2", value: "$10,000" }, { id: "r_rev__variance", value: "" }],
        meta: { dataframe: { parser: "smoke" } },
      }],
    });
    expect(res.artifactIds).toHaveLength(1);
    const arts = await artifactsIn(t, res.roomId);
    expect(arts.map((a) => a.title)).toEqual(["Q3 variance smoke"]);
    expect((arts[0].meta as { dataframe?: { parser?: string } } | undefined)?.dataframe?.parser).toBe("smoke");
    expect((await elementsOf(t, arts[0]._id)).length).toBe(2);
  });

  it("create with an INVALID seed rolls the WHOLE room back — the true mid-seed-failure guarantee", async () => {
    const t = convexTest(schema, modules);
    // A duplicate element id trips assertCreateArtifactLimits, which runs before the first insert; even a
    // failure mid-seed would roll back because room + member + artifacts share one Convex transaction.
    await expect(
      t.mutation(api.rooms.create, {
        code: "BADSEED", title: "Smoke", hostName: "Maya", authToken: HOST_TOKEN, autoAllow: true,
        seedArtifacts: [{ kind: "sheet", title: "Bad", seed: [{ id: "dup", value: 1 }, { id: "dup", value: 2 }] }],
      }),
    ).rejects.toThrow(/duplicate element id/);
    // No orphan room AND no orphan host member — the entire create was rolled back.
    expect(await allRooms(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => await ctx.db.query("members").collect())).toHaveLength(0);
  });

  it("create rejects a seedArtifacts bundle over the per-room cap without writing a room", async () => {
    const t = convexTest(schema, modules);
    const tooMany = Array.from({ length: 9 }, (_, i) => ({ kind: "note" as const, title: `n${i}`, seed: [{ id: `e${i}`, value: i }] }));
    await expect(
      t.mutation(api.rooms.create, { code: "TOOMNY", title: "x", hostName: "Maya", authToken: HOST_TOKEN, seedArtifacts: tooMany }),
    ).rejects.toThrow(/too_many_seed_artifacts/);
    expect(await allRooms(t)).toHaveLength(0);
  });
});
