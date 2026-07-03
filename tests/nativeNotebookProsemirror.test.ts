// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";

vi.setConfig({ testTimeout: 30_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "native-notebook-host-token-0123456789";
const GUEST_TOKEN = "native-notebook-guest-token-0123456789";

async function seedNotebookRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
  const created = await t.mutation(api.rooms.createStarterRoom, {
    code: "NBPROOF",
    title: "Native notebook proof room",
    hostName: "Maya",
    authToken: HOST_TOKEN,
  });
  const proof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
  const meta = await t.query(api.rooms.meta, { roomId: created.roomId, requester: proof });
  if (!meta) throw new Error("starter room meta not found");
  const notebook = meta.artifacts.find((a) => a.kind === "note" && a.title !== "Agent wiki");
  if (!notebook) throw new Error("starter notebook not found");
  return { t, roomId: created.roomId, artifactId: notebook.id, proof };
}

describe("native notebook ProseMirror sync boundary", () => {
  it("does not expose the doc capability without active requester proof", async () => {
    const { t, roomId, artifactId, proof } = await seedNotebookRoom();

    await expect(t.query(api.prosemirror.getNotebookDoc as any, { roomId, artifactId }))
      .rejects.toThrow();

    const ensured = await t.mutation(api.prosemirror.ensureNotebookDoc, {
      roomId,
      artifactId,
      requester: proof,
    });
    expect(ensured.prosemirrorDocId).toMatch(/^nb:/);

    const doc = await t.query(api.prosemirror.getNotebookDoc, {
      roomId,
      artifactId,
      requester: proof,
    });
    expect(doc?.prosemirrorDocId).toBe(ensured.prosemirrorDocId);

    await t.mutation(api.rooms.leave, { roomId, requester: proof });
    await expect(t.query(api.prosemirror.getNotebookDoc, { roomId, artifactId, requester: proof }))
      .rejects.toThrow(/actor_revoked/);
  }, 30_000);

  it("keeps snapshots as registry updates, not passive activity events", async () => {
    const { t, roomId, artifactId, proof } = await seedNotebookRoom();
    const ensured = await t.mutation(api.prosemirror.ensureNotebookDoc, {
      roomId,
      artifactId,
      requester: proof,
    });

    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 2,
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "CardioNova diligence note" }] }],
      }),
    });

    const state = await t.run(async (ctx) => {
      const outbox = await ctx.db.query("roomActivityOutbox").collect();
      const row = await ctx.db
        .query("notebookDocuments")
        .withIndex("by_prosemirror_doc", (q) => q.eq("prosemirrorDocId", ensured.prosemirrorDocId))
        .unique();
      return { outbox, row };
    });

    expect(state.outbox).toHaveLength(0);
    expect(state.row?.latestIndexedVersion).toBe(2);
    expect(state.row?.latestSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("revokes retained ProseMirror sync access when an identity-backed artifact becomes private", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
    const hostT = t.withIdentity({ subject: "host-native-notebook" });
    const guestT = t.withIdentity({ subject: "guest-native-notebook" });
    const created = await hostT.mutation(api.rooms.createStarterRoom, {
      code: "NBPRIV",
      title: "Identity notebook proof room",
      hostName: "Maya",
      authToken: HOST_TOKEN,
    });
    const hostProof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
    const joined = await guestT.mutation(api.rooms.joinAnonymous, {
      code: "NBPRIV",
      name: "Guest",
      authToken: GUEST_TOKEN,
    });
    if (!joined || "error" in joined) throw new Error("guest join failed");
    const guestProof = { actor: { kind: "user" as const, id: String(joined.memberId), name: "Guest" }, token: GUEST_TOKEN };
    const meta = await hostT.query(api.rooms.meta, { roomId: created.roomId, requester: hostProof });
    if (!meta) throw new Error("starter room meta not found");
    const notebook = meta.artifacts.find((a) => a.kind === "note" && a.title !== "Agent wiki");
    if (!notebook) throw new Error("starter notebook not found");

    const ensured = await hostT.mutation(api.prosemirror.ensureNotebookDoc, {
      roomId: created.roomId,
      artifactId: notebook.id,
      requester: hostProof,
    });
    await expect(guestT.query(api.prosemirror.getSnapshot, { id: ensured.prosemirrorDocId }))
      .resolves.toBeTruthy();

    await hostT.mutation(api.artifacts.setArtifactVisibility, {
      roomId: created.roomId,
      artifactId: notebook.id,
      visibility: "private",
      requester: hostProof,
    });

    await expect(guestT.query(api.prosemirror.getNotebookDoc, {
      roomId: created.roomId,
      artifactId: notebook.id,
      requester: guestProof,
    })).rejects.toThrow(/artifact_not_visible/);
    await expect(guestT.query(api.prosemirror.getSnapshot, { id: ensured.prosemirrorDocId }))
      .rejects.toThrow(/notebook_doc_forbidden/);
    await expect(guestT.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 2,
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    })).rejects.toThrow(/notebook_doc_forbidden/);
    await expect(hostT.query(api.prosemirror.getSnapshot, { id: ensured.prosemirrorDocId }))
      .resolves.toBeTruthy();
  });
});
