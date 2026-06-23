// @vitest-environment edge-runtime
//
// Convex (persisted-lane) parity for agent-governed columns. These exercise the REAL Convex mutation
// (artifacts.setColumnsByAgent) and the REAL agent cell-write gate (applyAgentCellEdit →
// agentWritePolicyViolation) against a simulated Convex DB — the multi-user lane that the in-memory
// RoomEngine suite (governedColumns.test.ts) cannot reach. Persona: the Room NodeAgent running diligence
// declares a research sheet's COLUMN SCHEMA via define_columns, then fills it; a second agent racing the
// same schema edit must lose the CAS; and once a schema exists, undeclared-column writes are rejected.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

// Same exclusion list as the other convex-test suites: drop the action-only modules whose @convex-dev /
// capture deps are not needed (and may be absent) for the mutation paths under test.
const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "host-token-governed-columns-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

/** Seed a room with an EMPTY sheet (no governed schema yet) + an agent session, ready for define_columns. */
async function seedSheet(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `GC${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Governed columns",
      hostId: "pending",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    });
    const hostMemberId = await ctx.db.insert("members", {
      roomId,
      name: "Homen",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const artifactId = await ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Research",
      version: 1,
      order: [],
      updatedAt: now,
    });
    await ctx.db.insert("agentSessions", {
      roomId,
      agentId: AGENT.id,
      agentName: AGENT.name,
      scope: "public" as const,
      status: "working" as const,
      lastAction: "seeded",
      updatedAt: now,
    });
    return { roomId, artifactId };
  });
}

const readArtifact = (t: ReturnType<typeof convexTest>, artifactId: Awaited<ReturnType<typeof seedSheet>>["artifactId"]) =>
  t.run((ctx) => ctx.db.get(artifactId));

const columnIds = (art: Awaited<ReturnType<typeof readArtifact>>): string[] =>
  ((art?.meta as { dataframe?: { columns?: Array<{ id?: string }> } } | undefined)?.dataframe?.columns ?? [])
    .map((c) => c.id ?? "");

describe("Convex governed columns (persisted lane)", () => {
  it("declares a schema (merge), normalizing labels into slugged/ordered columns + a schema_changed trace", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSheet(t);

    const res = await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      baseVersion: 1,
      mode: "merge",
      columns: [{ label: "Company Name" }, { label: "Website" }, { label: "ARR ($)" }],
      actor: AGENT,
    });

    expect(res).toMatchObject({ ok: true, version: 2 });
    const art = await readArtifact(t, s.artifactId);
    expect(art?.version).toBe(2);
    const cols = (art?.meta as { dataframe?: { columns?: Array<{ id: string; order: number }> } }).dataframe?.columns ?? [];
    expect(cols.map((c) => c.id)).toEqual(["company_name", "website", "arr"]);
    expect(cols.map((c) => c.order)).toEqual([0, 1, 2]); // order assigned by position — never hand-numbered
    const traces = await t.run((ctx) => ctx.db.query("traces").collect());
    expect(traces.some((tr) => tr.type === "schema_changed" && (tr.detail ?? "").includes("company_name"))).toBe(true);
  });

  it("CAS-guards the schema: a second agent on a stale baseVersion loses as DATA, then retries on the fresh version", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSheet(t);

    // Both agents read the same baseline (v1) and race a schema edit.
    const first = await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId, artifactId: s.artifactId, baseVersion: 1, mode: "merge",
      columns: [{ label: "Company" }], actor: AGENT,
    });
    expect(first).toMatchObject({ ok: true, version: 2 });

    const stale = await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId, artifactId: s.artifactId, baseVersion: 1, mode: "merge",
      columns: [{ label: "Website" }], actor: AGENT,
    });
    // Anti-clobber: rejected as DATA (never thrown), carrying the version the loser must rebase onto.
    expect(stale).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    // The runtime re-reads the fresh version and retries — the merge then lands cleanly.
    const retry = await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId, artifactId: s.artifactId, baseVersion: 2, mode: "merge",
      columns: [{ label: "Website" }], actor: AGENT,
    });
    expect(retry).toMatchObject({ ok: true, version: 3 });
    expect(columnIds(await readArtifact(t, s.artifactId))).toEqual(["company", "website"]);
  });

  it("declare-then-fill: once a schema exists, an agent write to an UNDECLARED column is rejected (no_such_column)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSheet(t);
    await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId, artifactId: s.artifactId, baseVersion: 1, mode: "merge",
      columns: [{ label: "Company" }, { label: "Website" }], actor: AGENT,
    });

    // Write to the undeclared "revenue" column → blocked (would otherwise be an invisible orphan).
    const orphan = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId, artifactId: s.artifactId, elementId: "r1__revenue", kind: "create",
      value: "$2M", baseVersion: 0, actor: AGENT,
    });
    expect(orphan).toMatchObject({ ok: false, reason: "no_such_column" });

    // Write to the DECLARED "company" column → allowed.
    const declared = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId, artifactId: s.artifactId, elementId: "r1__company", kind: "create",
      value: "CardioNova", baseVersion: 0, actor: AGENT,
    });
    expect(declared).toMatchObject({ ok: true });
    // The real invariant: the gate stops the orphan from ever LANDING, while the declared write persists.
    // (Convex returns policy violations as data without a trace — consistent across all three reasons —
    //  so we assert the durable DB outcome, not an engine-only edit_blocked breadcrumb.)
    const elements = await t.run((ctx) =>
      ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", s.artifactId)).collect());
    const byId = new Map(elements.map((el) => [el.elementId, el.value]));
    expect(byId.has("r1__revenue")).toBe(false); // undeclared column never wrote an orphan cell
    expect(byId.get("r1__company")).toBe("CardioNova"); // declared column write persisted
  });

  it("a blank sheet (no declared schema) stays OPEN — the gate only activates once columns exist", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSheet(t);

    // No define_columns called → any element write is permitted (legacy/freeform sheets are not governed).
    const free = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId, artifactId: s.artifactId, elementId: "r1__anything", kind: "create",
      value: "freeform", baseVersion: 0, actor: AGENT,
    });
    expect(free).toMatchObject({ ok: true });
  });

  it("replace mode prunes orphan cells + trims order for columns that are no longer declared", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSheet(t);
    await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId, artifactId: s.artifactId, baseVersion: 1, mode: "merge",
      columns: [{ label: "A" }, { label: "B" }, { label: "C" }], actor: AGENT,
    });
    // Seed one cell per column directly (no version bump) so we can observe the prune.
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const col of ["a", "b", "c"]) {
        await ctx.db.insert("elements", { artifactId: s.artifactId, elementId: `r1__${col}`, value: col.toUpperCase(), version: 1, updatedAt: now, updatedBy: AGENT });
      }
      await ctx.db.patch(s.artifactId, { order: ["r1__a", "r1__b", "r1__c"] });
    });

    // Replace the schema with only A + B — C becomes an orphan and must be deleted.
    const res = await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId, artifactId: s.artifactId, baseVersion: 2, mode: "replace",
      columns: [{ label: "A" }, { label: "B" }], actor: AGENT,
    });
    expect(res).toMatchObject({ ok: true, version: 3 });

    const { art, elements } = await t.run(async (ctx) => ({
      art: await ctx.db.get(s.artifactId),
      elements: await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", s.artifactId)).collect(),
    }));
    expect(columnIds(art)).toEqual(["a", "b"]);
    expect(elements.map((el) => el.elementId).sort()).toEqual(["r1__a", "r1__b"]); // r1__c pruned
    expect(art?.order).toEqual(["r1__a", "r1__b"]); // order trimmed
  });

  it("BOUNDs the schema at MAX_COLUMNS (64) — an over-eager agent cannot blow up the sheet width", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSheet(t);
    const res = await t.mutation(internal.artifacts.setColumnsByAgent, {
      roomId: s.roomId, artifactId: s.artifactId, baseVersion: 1, mode: "merge",
      columns: Array.from({ length: 200 }, (_, i) => ({ label: `Col ${i}` })), actor: AGENT,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.columns.length).toBe(64);
    expect(columnIds(await readArtifact(t, s.artifactId)).length).toBe(64);
  });
});
