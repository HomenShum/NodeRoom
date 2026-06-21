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
  it("publishes agent intent and commit-lease presence before the normal CAS write", async () => {
    const { ctx, calls } = fakeCtx();
    const actor: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
    const rt = new ConvexRoomTools(ctx as never, "room_1" as never, "artifact_1" as never, actor, "session_1", "job_1" as never);

    const result = await rt.editCell("r_rev__variance", "+24%", 1);

    expect(result).toMatchObject({ ok: true, version: 2, mutationReceiptId: "receipt_1" });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ mode: "agent_intent", targetKind: "cell", targetId: "r_rev__variance", actor });
    expect(calls[1]).toMatchObject({ mode: "commit_lease", targetKind: "cell", targetId: "r_rev__variance", actor });
    expect(calls[2]).toMatchObject({ elementId: "r_rev__variance", value: "+24%", baseVersion: 1, actor, jobId: "job_1" });
  });

  it("does not let non-agent callers emit server-side agent presence", async () => {
    const { ctx, calls } = fakeCtx();
    const actor: Actor = { kind: "user", id: "member_1", name: "Maya" };
    const rt = new ConvexRoomTools(ctx as never, "room_1" as never, "artifact_1" as never, actor, "session_1");

    await rt.editCell("r_rev__variance", "+24%", 1);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ elementId: "r_rev__variance", actor });
  });
});
