// @vitest-environment edge-runtime
/**
 * read_notebook on a non-note target — the 2026-10-31 live fresh-user proof run.
 *
 * Persona: a member on the Free route has the "Q3 variance" SHEET open and asks
 * "@nodeagent read the Open questions / workplan notebook and summarize its
 * existing human blocks without changing anything. Cite exact block IDs."
 * The small free model calls read_notebook first, either with no artifactId (the
 * schema allows it; the runtime then falls back to the run's primary artifact,
 * the sheet) or with the sheet id it saw in context.
 *
 * Before the fix the ensure mutation THREW `artifact_not_notebook`; the tool
 * handed the model a raw "Uncaught Error … at ensureNotebookDocCore" string with
 * no ids, so the model had to spend a list_artifacts call to find the notebook
 * (receipt: read_notebook ✗ → list_artifacts → read_notebook). The wrong-kind
 * target is a model mistake, not a server fault, so it now comes back as DATA
 * with the room's shared note ids: one retry, no extra discovery call.
 *
 * Real Convex functions + the real prosemirror-sync component (convex-test);
 * ConvexRoomTools is driven exactly as the agent action drives it.
 */
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";
import { ConvexRoomTools } from "../convex/convexRoomTools";
import { READ_NOTEBOOK_TOOL } from "../src/nodeagent/skills/notebook/notebookTools";
import type { Actor } from "../src/engine/types";

vi.setConfig({ testTimeout: 30_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "read-notebook-wrong-kind-host-token-0123";
const ROOM_AGENT: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };

type WrongKind = {
  ok: false;
  reason: string;
  artifactKind?: string;
  candidateArtifacts?: Array<{ id: string; title: string; kind: string }>;
  hint?: string;
};

async function seedSheetRun() {
  const t = convexTest(schema, modules);
  t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
  const created = await t.mutation(api.rooms.createStarterRoom, {
    code: "NBWRONG",
    title: "Startup diligence",
    hostName: "Maya",
    authToken: HOST_TOKEN,
  });
  const roomId = created.roomId;
  const proof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
  const meta = await t.query(api.rooms.meta, { roomId, requester: proof });
  if (!meta) throw new Error("starter room meta not found");
  const byTitle = (title: string) => {
    const a = meta.artifacts.find((x) => x.title === title);
    if (!a) throw new Error(`starter artifact ${title} missing`);
    return a;
  };
  await t.run((ctx) => ctx.db.insert("agentSessions", {
    roomId, agentId: ROOM_AGENT.id, agentName: ROOM_AGENT.name, scope: "public", status: "working", lastAction: "reading", updatedAt: Date.now(),
  }));
  const sheet = byTitle("Q3 variance");
  const workplan = byTitle("Open questions / workplan");
  const memo = byTitle("Diligence memo");
  // The run's primary artifact is the sheet the member had open.
  const ctx = {
    runQuery: (ref: never, args: never) => t.query(ref, args),
    runMutation: (ref: never, args: never) => t.mutation(ref, args),
  };
  const rt = new ConvexRoomTools(ctx as never, roomId, sheet.id as never, ROOM_AGENT, "session_1");
  const counts = () => t.run(async (db) => ({
    traces: (await db.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()).length,
    notebookDocs: (await db.db.query("notebookDocuments").collect()).length,
  }));
  return { t, roomId, rt, sheet, workplan, memo, counts };
}

describe("read_notebook aimed at a sheet (live proof run 2026-10-31)", () => {
  it("omitted artifactId on a sheet run returns the room's note ids as data, and one retry reads the workplan", async () => {
    const { rt, workplan, memo, counts } = await seedSheetRun();
    const before = await counts();

    const first = await READ_NOTEBOOK_TOOL.execute({}, rt) as WrongKind;

    expect(first.ok).toBe(false);
    expect(first.reason).toBe("not_a_note");
    expect(first.artifactKind).toBe("sheet");
    // No stack-trace dump handed to the model.
    expect(JSON.stringify(first)).not.toMatch(/Uncaught|ensureNotebookDocCore|\.ts:\d+/);
    // Only shared NOTES are offered — never the sheet, wall, or research tables.
    expect(first.candidateArtifacts?.map((c) => c.kind)).toEqual(expect.arrayContaining(["note"]));
    expect(first.candidateArtifacts?.every((c) => c.kind === "note")).toBe(true);
    expect(first.candidateArtifacts?.map((c) => c.title)).toEqual(expect.arrayContaining([workplan.title, memo.title]));
    expect(first.hint).toContain(workplan.id);

    // The model picks the candidate by the title the member named — no list_artifacts call.
    const target = first.candidateArtifacts!.find((c) => c.title === "Open questions / workplan")!;
    const retry = await READ_NOTEBOOK_TOOL.execute({ artifactId: target.id }, rt) as { ok: boolean; blocks?: Array<{ blockId: string; text: string }> };
    expect(retry.ok).toBe(true);
    expect(retry.blocks?.length).toBeGreaterThan(0);
    expect(retry.blocks?.every((b) => typeof b.blockId === "string" && b.blockId.length > 0)).toBe(true);

    // The failed call itself wrote nothing; only the successful read registered the workplan doc.
    const after = await counts();
    expect(after.notebookDocs).toBe(before.notebookDocs + 1);
  });

  it("an explicit sheet id pasted from context gets the same guidance, and the wrong-kind call writes nothing", async () => {
    const { rt, sheet, counts } = await seedSheetRun();
    const before = await counts();

    const res = await READ_NOTEBOOK_TOOL.execute({ artifactId: sheet.id }, rt) as WrongKind;

    expect(res).toMatchObject({ ok: false, reason: "not_a_note", artifactKind: "sheet" });
    expect(res.candidateArtifacts?.some((c) => c.id === sheet.id)).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it("plan_notebook_enrichment shares the ensure path and returns the same data-not-throw guidance", async () => {
    const { rt, workplan } = await seedSheetRun();

    const res = await rt.planNotebookEnrichment({}) as WrongKind;

    expect(res).toMatchObject({ ok: false, reason: "not_a_note", artifactKind: "sheet" });
    expect(res.candidateArtifacts?.map((c) => c.id)).toContain(workplan.id);
  });

  it("never offers a member's private note, and says so plainly when the room has no shared notes", async () => {
    const { t, rt, workplan, memo } = await seedSheetRun();
    await t.run(async (ctx) => {
      await ctx.db.patch(memo.id as never, { visibility: "private" });
      await ctx.db.patch(workplan.id as never, { visibility: "private" });
    });

    const res = await READ_NOTEBOOK_TOOL.execute({}, rt) as WrongKind;

    expect(res).toMatchObject({ ok: false, reason: "not_a_note", artifactKind: "sheet" });
    const offered = (res.candidateArtifacts ?? []).map((c) => c.id);
    expect(offered).not.toContain(memo.id);
    expect(offered).not.toContain(workplan.id);
    expect(res.hint).toMatch(/no shared note/i);
  });

  it("a burst of wrong-kind calls (a looping small model) stays bounded and leaves no rows behind", async () => {
    const { rt, counts } = await seedSheetRun();
    const before = await counts();

    const results = await Promise.all(Array.from({ length: 12 }, () => READ_NOTEBOOK_TOOL.execute({}, rt) as Promise<WrongKind>));

    for (const r of results) {
      expect(r.reason).toBe("not_a_note");
      expect((r.candidateArtifacts ?? []).length).toBeLessThanOrEqual(8);
    }
    expect(await counts()).toEqual(before);
  });
});
