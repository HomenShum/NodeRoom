import { describe, expect, it } from "vitest";
import { ConvexRoomTools } from "../convex/convexRoomTools";
import type { Actor } from "../src/engine/types";

function fakeCtx() {
  const calls: unknown[] = [];
  return {
    calls,
    ctx: {
      runMutation: async (_ref: unknown, args: unknown) => {
        calls.push(args);
        const record = args as { mode?: string };
        if (record.mode === "agent_intent" || record.mode === "commit_lease") return { ok: true };
        return { ok: true, version: 2, mutationReceiptId: "receipt_1" };
      },
    },
  };
}

describe("ConvexRoomTools agent presence", () => {
  it("publishes agent intent and commit-lease presence before the normal CAS write, then releases both after", async () => {
    const { ctx, calls } = fakeCtx();
    const actor: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
    const rt = new ConvexRoomTools(ctx as never, "room_1" as never, "artifact_1" as never, actor, "session_1", "job_1" as never);

    const result = await rt.editCell("r_rev__variance", "+24%", 1);

    expect(result).toMatchObject({ ok: true, version: 2, mutationReceiptId: "receipt_1" });
    // Root-cause regression net: without the release call, a finished write
    // leaves both presence claims to sit for their full TTL (up to 45s) — the
    // exact bug that showed a wall of "Room NodeAgent" chips after a batch
    // write. This pins that the release fires unconditionally on resolution.
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({ mode: "agent_intent", targetKind: "cell", targetId: "r_rev__variance", actor });
    expect(calls[1]).toMatchObject({ mode: "commit_lease", targetKind: "cell", targetId: "r_rev__variance", actor });
    expect(calls[2]).toMatchObject({ elementId: "r_rev__variance", value: "+24%", baseVersion: 1, actor, jobId: "job_1" });
    const releaseCall = calls[3] as { mode?: string; targetKind?: string; targetId?: string; actor?: unknown; elementId?: unknown };
    expect(releaseCall).toMatchObject({ targetKind: "cell", targetId: "r_rev__variance", actor });
    expect(releaseCall.mode).toBeUndefined(); // omitted mode releases BOTH agent_intent + commit_lease in one call
    expect(releaseCall.elementId).toBeUndefined(); // proves this is the release call, not a second CAS write
  });

  it("does not let non-agent callers emit server-side agent presence", async () => {
    const { ctx, calls } = fakeCtx();
    const actor: Actor = { kind: "user", id: "member_1", name: "Maya" };
    const rt = new ConvexRoomTools(ctx as never, "room_1" as never, "artifact_1" as never, actor, "session_1");

    await rt.editCell("r_rev__variance", "+24%", 1);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ elementId: "r_rev__variance", actor });
  });

  it("releases the notebook-outline drafting-intent claim after the write resolves, even on a rejected outline", async () => {
    const { ctx, calls } = fakeCtx();
    const actor: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
    const rt = new ConvexRoomTools(ctx as never, "room_1" as never, "artifact_1" as never, actor, "session_1", "job_1" as never);

    await rt.applyNotebookOutline({ parentBlockId: "blk-agent", sections: [] as never });

    // heartbeat(agent_intent) -> write -> release. Same fix as editCell, on the
    // notebook-block target this time.
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ mode: "agent_intent", targetKind: "notebook_block", targetId: "blk-agent" });
    const releaseCall = calls[2] as { targetKind?: string; targetId?: string; mode?: string };
    expect(releaseCall).toMatchObject({ targetKind: "notebook_block", targetId: "blk-agent", mode: "agent_intent" });
  });

  it("releases the notebook-block editing-intent claim even when the write throws", async () => {
    const calls: unknown[] = [];
    const ctx = {
      runMutation: async (_ref: unknown, args: unknown) => {
        calls.push(args);
        const record = args as { mode?: string; blockId?: string };
        if (record.mode === "agent_intent") return { ok: true };
        if (record.blockId) throw new Error("simulated_transport_failure");
        return { ok: true };
      },
    };
    const actor: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
    const rt = new ConvexRoomTools(ctx as never, "room_1" as never, "artifact_1" as never, actor, "session_1", "job_1" as never);

    const result = await rt.applyNotebookBlockEdit({ blockId: "blk-1", action: "replace", content: "x" });

    // The write threw (caught -> honest {ok:false, error}) but the finally
    // must still release the pre-write intent claim — a thrown write is
    // exactly the case a plain try/catch (no finally) would have missed.
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(3);
    const releaseCall = calls[2] as { targetKind?: string; targetId?: string; mode?: string };
    expect(releaseCall).toMatchObject({ targetKind: "notebook_block", targetId: "blk-1", mode: "agent_intent" });
  });
});
