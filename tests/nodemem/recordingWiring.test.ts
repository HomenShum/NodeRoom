/**
 * NodeMem PRODUCTION recording wiring — the half that was missing.
 *
 * Before this, `recordEpisode` was called only by benchmark specs, so real rooms never populated the
 * episode store and recall could never fire in production (verified live 2026-06-29: the agent found
 * "no ARR figure" for a fact posted in chat). These scenarios prove the live chat path (messages.send
 * → sendCore) now records ROOM-VISIBLE chat as episodes, honoring the gate + privacy, and that a
 * recorded fact actually surfaces through assembleContextPackForJob — the end-to-end recall path.
 *
 * sendCore SCHEDULES recordEpisode (runAfter 0) so a recording failure can never roll back a send;
 * the tests drain that schedule with finishAllScheduledFunctions(vi.runAllTimers) (the documented
 * convex-test pattern for runAfter under fake timers).
 */
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { hashToken } from "../../convex/lib";
import workflowSchema from "../../node_modules/@convex-dev/workflow/dist/component/schema.js";
import workpoolSchema from "../../node_modules/@convex-dev/workpool/dist/component/schema.js";

const modules = import.meta.glob("../../convex/**/*.ts");
const workflowModules = import.meta.glob("../../node_modules/@convex-dev/workflow/dist/component/**/*.js");
const workpoolModules = import.meta.glob("../../node_modules/@convex-dev/workpool/dist/component/**/*.js");
// "use node" modules can't load under convex-test (mirrors tests/agentJobsRuntime.test.ts).
delete (modules as Record<string, unknown>)["../../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../../convex/embeddingRunner.ts"];

const token = "0123456789abcdefghijklmnopqrstuvwxyzTOKEN";

async function setupRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  const now = Date.now();
  const authTokenHash = await hashToken(token);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { code: `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`, title: "recording wiring test", hostId: "", autoAllow: true, status: "live" as const, createdAt: now }),
  );
  const memberId = await t.run((ctx) =>
    ctx.db.insert("members", { roomId, name: "Host", role: "host" as const, anon: false, color: "#111111", authTokenHash, lastSeenAt: now }),
  );
  const actor = { kind: "user" as const, id: String(memberId), name: "Host" };
  return { t, roomId, actor, proof: { actor, token } };
}

type T = Awaited<ReturnType<typeof setupRoom>>["t"];
const drain = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const episodesFor = (t: T, roomId: string) =>
  t.run((ctx) => ctx.db.query("nodeMemEpisodes").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).collect());

describe("NodeMem recording wiring (production chat path)", () => {
  const prev = process.env.NODEMEM_MODE;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); if (prev === undefined) delete process.env.NODEMEM_MODE; else process.env.NODEMEM_MODE = prev; });

  it("records a room-visible (public) chat message as a room episode when recording is on", async () => {
    process.env.NODEMEM_MODE = "shadow"; // record-only; the recording gate is on
    const { t, roomId, proof } = await setupRoom();
    await t.mutation(api.messages.send, { roomId, channel: "public", proof, text: "Pin: pilot ARR is exactly $317,400.", clientMsgId: "c1" });
    await drain(t);
    const eps = await episodesFor(t, roomId);
    expect(eps.length).toBe(1);
    expect(eps[0].rawText).toContain("317,400");
    expect(eps[0].sourceKind).toBe("chat");
    expect(eps[0].visibility).toBe("room");
  });

  it("records NOTHING when recording is off — the production default (no surprise cost/leak)", async () => {
    delete process.env.NODEMEM_MODE; // off
    const { t, roomId, proof } = await setupRoom();
    await t.mutation(api.messages.send, { roomId, channel: "public", proof, text: "should not be recorded", clientMsgId: "c1" });
    await drain(t);
    expect((await episodesFor(t, roomId)).length).toBe(0);
  });

  it("does NOT record PRIVATE-channel messages even with recording on (privacy boundary)", async () => {
    process.env.NODEMEM_MODE = "active_ab";
    const { t, roomId, proof, actor } = await setupRoom();
    // a member's own id is their private channel — the send is allowed, but it must NOT enter room memory.
    await t.mutation(api.messages.send, { roomId, channel: actor.id, proof, text: "private secret salary $999k", clientMsgId: "p1" });
    await drain(t);
    expect((await episodesFor(t, roomId)).length).toBe(0);
  });

  it("an idempotent resend (same clientMsgId) records at most one episode (no duplicate spam)", async () => {
    process.env.NODEMEM_MODE = "shadow";
    const { t, roomId, proof } = await setupRoom();
    const args = { roomId, channel: "public", proof, text: "same fact, sent twice", clientMsgId: "dup1" } as const;
    await t.mutation(api.messages.send, args);
    await t.mutation(api.messages.send, args); // idempotent → returns the same message, never schedules again
    await drain(t);
    expect((await episodesFor(t, roomId)).length).toBe(1);
  });

  it("recorded chat surfaces in assembleContextPackForJob — the end-to-end recall path", async () => {
    process.env.NODEMEM_MODE = "active_ab"; // inject mode → assemble returns a pack
    const { t, roomId, proof } = await setupRoom();
    await t.mutation(api.messages.send, { roomId, channel: "public", proof, text: "The fit dataset has exactly 310 records.", clientMsgId: "c1" });
    await drain(t);
    const pack = await t.query(api.nodemem.assembleContextPackForJob, { roomId, goal: "how many records are in the fit dataset?", userId: "tester", maxFacts: 60, maxTokens: 1200 });
    expect(pack).not.toBeNull();
    expect(JSON.stringify(pack)).toContain("310");
  });
});
