// @vitest-environment edge-runtime
/**
 * Agent notebook lane — server scenarios against the REAL prosemirror-sync
 * component (registered, not mocked).
 *
 * Persona: Maya hosts a diligence room and has typed legacy note HTML; the
 * nodeagent appends a parsed report. Covered angles:
 *   - seeding fix: legacy elements["doc"] HTML is visible in the synced doc
 *     (the flag-flip/first-agent-write no longer orphans content)
 *   - happy path: attributed agent blocks land under the "Agent notes" section,
 *     artifact version bumps, a trace + mirror + dirty event are written
 *   - merge idempotency: an identical re-run dedupes sections (no duplicates)
 *   - no_such_block: a missing anchor returns DATA with recovery candidates
 *   - honesty gate: claim-without-evidence lands flagged needs_review
 *   - review mode: !autoAllow routes to a proposal (pending_approval), and the
 *     synced doc is NOT touched
 *   - passive invariant: the apply itself never writes roomActivityOutbox;
 *     exactly ONE outbox item exists after the scheduled processor runs
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";

// convex/_generated lags until the next codegen — which must NOT be run
// casually here: `npx convex codegen` against a configured cloud deployment
// DEPLOYS schema+functions (documented gotcha). Same cast precedent as
// Artifact.tsx's createAgentWorkPlanFromNotebook; convex-test resolves the
// functions by name at runtime.
type ApplyOutlineResult =
  | { ok: true; lane: string; blockIds: string[]; dedupedSections: number; needsReviewCount: number; noop?: boolean }
  | { ok: false; reason: string; proposalId?: string; parentBlockId?: string; currentBlocks?: Array<{ blockId: string; text: string }> };
type ReadNotebookResult =
  | { ok: true; docSource: string; docVersion: number; agentSection: { exists: boolean; blockId?: string }; blocks: Array<{ blockId: string; hasStableId: boolean; blockType: string; text: string; textHash: string; authorKind?: string; status?: string }> }
  | { ok: false; reason: string };
const notebookAgentInternal = (internal as unknown as {
  notebookAgent: {
    applyOutlineByAgent: import("convex/server").FunctionReference<"mutation", "internal", Record<string, unknown>, ApplyOutlineResult>;
    readNotebookForAgent: import("convex/server").FunctionReference<"query", "internal", Record<string, unknown>, ReadNotebookResult>;
  };
}).notebookAgent;

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "notebook-agent-host-token-0123456789";

async function seedRoom(opts: { legacyHtml?: string } = {}) {
  const t = convexTest(schema, modules);
  t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
  const created = await t.mutation(api.rooms.createStarterRoom, {
    code: "NBAGENT",
    title: "Agent notebook proof room",
    hostName: "Maya",
    authToken: HOST_TOKEN,
  });
  const actor = { kind: "user" as const, id: String(created.memberId), name: "Maya" };
  const proof = { actor, token: HOST_TOKEN };
  const meta = await t.query(api.rooms.meta, { roomId: created.roomId, requester: proof });
  if (!meta) throw new Error("starter room meta not found");
  const notebook = meta.artifacts.find((a) => a.kind === "note" && a.title !== "Agent wiki");
  if (!notebook) throw new Error("starter notebook not found");
  if (opts.legacyHtml !== undefined) {
    await t.run(async (ctx) => {
      const el = await ctx.db
        .query("elements")
        .withIndex("by_artifact", (q) => q.eq("artifactId", notebook.id as never).eq("elementId", "doc"))
        .unique();
      if (el) await ctx.db.patch(el._id, { value: opts.legacyHtml });
      else await ctx.db.insert("elements", { artifactId: notebook.id as never, elementId: "doc", value: opts.legacyHtml, version: 1, updatedAt: Date.now(), updatedBy: actor });
    });
  }
  return { t, roomId: created.roomId, artifactId: notebook.id, actor, proof };
}

const SECTIONS = [
  { title: "Funding", bullets: [{ text: "Raised $32M Series B", claim: true, evidence: [{ kind: "source", label: "TechCrunch", url: "https://techcrunch.com/x" }] }] },
  { title: "Risks", bullets: [{ text: "Runway is 14 months", claim: true }, "Follow up with CFO"] },
];

async function syncedDocText(t: Awaited<ReturnType<typeof seedRoom>>["t"], docId: string): Promise<{ json: string; content: string }> {
  const snapshot = await t.query(api.prosemirror.getSnapshot, { id: docId });
  if (!snapshot.content) throw new Error("no snapshot");
  return { json: snapshot.content, content: snapshot.content };
}

describe("notebookAgent.applyOutlineByAgent — synced lane", () => {
  it("seeds from legacy HTML, appends attributed sections, bumps versions, mirrors, and stays passive-silent", async () => {
    const { t, roomId, artifactId, actor } = await seedRoom({
      legacyHtml: "<p>Met CardioNova founder — verify runway before the partner meeting.</p>",
    });
    const artBefore = await t.run(async (ctx) => (await ctx.db.get(artifactId as never)) as { version: number });

    const result = await t.mutation(notebookAgentInternal.applyOutlineByAgent, {
      roomId,
      artifactId: artifactId as never,
      actor,
      title: "Report: CardioNova call",
      sections: SECTIONS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("apply failed");
    expect(result.lane).toBe("synced_doc");
    expect(result.blockIds.length).toBeGreaterThan(0);
    expect(result.needsReviewCount).toBe(1);

    const row = await t.run(async (ctx) =>
      await ctx.db
        .query("notebookDocuments")
        .withIndex("by_room_artifact_element", (q) => q.eq("roomId", roomId).eq("artifactId", artifactId as never).eq("elementId", "doc"))
        .unique());
    expect(row).toBeTruthy();
    const { json } = await syncedDocText(t, row!.prosemirrorDocId);
    // Seeding fix: pre-existing legacy note content is IN the synced doc.
    expect(json).toContain("verify runway before the partner meeting");
    // Agent content landed under the attr-matched agent section with attribution in data.
    expect(json).toContain("Agent notes");
    expect(json).toContain('"agentRoot":"true"');
    expect(json).toContain('"authorKind":"agent"');
    expect(json).toContain("Raised $32M Series B");
    // Honesty gate: the unevidenced claim carries needs_review IN the doc.
    expect(json).toContain('"needs_review"');

    const state = await t.run(async (ctx) => ({
      art: (await ctx.db.get(artifactId as never)) as { version: number },
      docEl: await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId as never).eq("elementId", "doc")).unique(),
      traces: (await ctx.db.query("traces").collect()).filter((tr) => (tr as { type: string }).type === "notebook_outline_appended"),
      dirty: await ctx.db.query("notebookDirtyEvents").collect(),
      outbox: await ctx.db.query("roomActivityOutbox").collect(),
    }));
    // One artifact-version bump per call (the governance clock).
    expect(state.art.version).toBe(artBefore.version + 1);
    // Checkpoint mirror keeps legacy viewers coherent (attribution round-trips).
    expect(String(state.docEl?.value)).toContain("data-author-kind=\"agent\"");
    expect(String(state.docEl?.value)).toContain("Raised $32M Series B");
    expect(state.traces.length).toBe(1);
    // Read-model refresh goes through the dirty-event pipeline...
    expect(state.dirty.length).toBe(1);
    expect((state.dirty[0] as { processingLane: string }).processingLane).toBe("index");
    // ...and the apply itself NEVER writes passive activity (single source).
    expect(state.outbox.length).toBe(0);

    // After the processor runs (invoked directly — the repo's established test
    // pattern for scheduled notebook processing), the read model exists and
    // exactly ONE passive item was created — the dedupe invariant holds.
    await t.action(internal.notebookProcessing.processNotebookDirtyEvent, {
      dirtyEventId: (state.dirty[0] as { _id: unknown })._id as never,
    });
    await t.finishInProgressScheduledFunctions();
    const after = await t.run(async (ctx) => ({
      blocks: await ctx.db.query("notebookBlocks").collect(),
      outbox: await ctx.db.query("roomActivityOutbox").collect(),
    }));
    expect(after.blocks.length).toBeGreaterThan(0);
    expect(after.outbox.length).toBe(1);
    // Read-model v2: agent blocks keep their STABLE minted ids (edit-proof anchors).
    const blockIds = new Set(after.blocks.map((b) => (b as { blockId: string }).blockId));
    expect(result.blockIds.some((id) => blockIds.has(id))).toBe(true);
  }, 30_000);

  it("an identical re-run merges (dedupes sections) instead of duplicating", async () => {
    const { t, roomId, artifactId, actor } = await seedRoom();
    const args = { roomId, artifactId: artifactId as never, actor, title: "Report: CardioNova call", sections: SECTIONS };
    const first = await t.mutation(notebookAgentInternal.applyOutlineByAgent, args);
    expect(first.ok).toBe(true);
    const second = await t.mutation(notebookAgentInternal.applyOutlineByAgent, args);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("re-run failed");
    expect(second.dedupedSections).toBe(2);

    const row = await t.run(async (ctx) =>
      await ctx.db.query("notebookDocuments").withIndex("by_room_artifact_element", (q) => q.eq("roomId", roomId).eq("artifactId", artifactId as never).eq("elementId", "doc")).unique());
    const { json } = await syncedDocText(t, row!.prosemirrorDocId);
    // "Funding" heading appears exactly once despite two runs.
    expect(json.split("Funding").length - 1).toBe(1);
    await t.finishInProgressScheduledFunctions();
  });

  it("returns no_such_block as DATA (with recovery candidates) for a vanished anchor", async () => {
    const { t, roomId, artifactId, actor } = await seedRoom({ legacyHtml: "<p>anchor target text</p>" });
    const result = await t.mutation(notebookAgentInternal.applyOutlineByAgent, {
      roomId,
      artifactId: artifactId as never,
      actor,
      parentBlockId: "blk-not-there",
      sections: [{ title: "Anchored", bullets: ["x"] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect((result as { reason: string }).reason).toBe("no_such_block");
    expect((result as { currentBlocks?: unknown[] }).currentBlocks?.length).toBeGreaterThan(0);
    await t.finishInProgressScheduledFunctions();
  });

  it("review mode routes an AGENT's write to a proposal (pending_approval) and leaves the synced doc untouched", async () => {
    const { t, roomId, artifactId } = await seedRoom();
    // Starter rooms default autoAllow:false (review mode). Register the agent's
    // session so requireActorInRoom admits it — the production runtime does the
    // same before any agent tool call.
    const agentActor = { kind: "agent" as const, id: "nodeagent", name: "NodeAgent", scope: "public" as const };
    await t.run(async (ctx) => {
      await ctx.db.patch(roomId, { autoAllow: false });
      await ctx.db.insert("agentSessions", {
        roomId,
        agentId: agentActor.id,
        agentName: agentActor.name,
        scope: "public",
        status: "working",
        lastAction: "notebook outline",
        updatedAt: Date.now(),
      });
    });
    const result = await t.mutation(notebookAgentInternal.applyOutlineByAgent, {
      roomId,
      artifactId: artifactId as never,
      actor: agentActor,
      sections: SECTIONS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected pending");
    expect((result as { reason: string }).reason).toBe("pending_approval");
    const state = await t.run(async (ctx) => ({
      proposals: await ctx.db.query("proposals").collect(),
      row: await ctx.db.query("notebookDocuments").withIndex("by_room_artifact_element", (q) => q.eq("roomId", roomId).eq("artifactId", artifactId as never).eq("elementId", "doc")).unique(),
    }));
    expect(state.proposals.length).toBeGreaterThan(0);
    // Review mode never creates/writes the synced doc.
    expect(state.row).toBeNull();
  });

  it("readNotebookForAgent serves stable ids + CAS hashes after an agent write", async () => {
    const { t, roomId, artifactId, actor } = await seedRoom({ legacyHtml: "<p>human context line</p>" });
    await t.mutation(notebookAgentInternal.applyOutlineByAgent, {
      roomId, artifactId: artifactId as never, actor, sections: [{ title: "Funding", bullets: ["Raised $32M"] }],
    });
    const read = await t.query(notebookAgentInternal.readNotebookForAgent, { roomId, artifactId: artifactId as never, actor });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("read failed");
    expect(read.docSource).toBe("synced");
    expect(read.agentSection.exists).toBe(true);
    const human = read.blocks.find((b) => b.text.includes("human context line"));
    expect(human).toBeTruthy();
    const agentBlock = read.blocks.find((b) => b.authorKind === "agent" && b.text.includes("Raised $32M"));
    expect(agentBlock?.hasStableId).toBe(true);
    expect(agentBlock?.textHash).toMatch(/^[0-9a-f]{64}$/);
    await t.finishInProgressScheduledFunctions();
  });
});
