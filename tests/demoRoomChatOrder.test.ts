/**
 * The seeded sample-room conversation is HISTORY, so it must sort before anything the
 * visitor sends. The chat feed is pinned to its newest line, so a seeded message stamped
 * later than a live one does not merely look odd — it pushes the visitor's own message and
 * the assistant's reply off the top of the panel, and the receipt they asked for is
 * invisible (defect D-1).
 *
 * The regression this guards: the transcript used to be stamped at a fixed wall-clock hour
 * (09:38 today), which is in the future for anyone opening the room in the early morning.
 * Both tests pin the clock deliberately — one to 04:00 local, one to the engine's own
 * injected clock — so they fail on the old code at ANY hour of the day rather than only
 * before breakfast.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";

const SEED_IDS = [
  "seed-01-homen-question",
  "seed-02-homen-command",
  "seed-03-agent-reconciled",
  "seed-04-priya-cogs",
  "seed-05-quokka-joined",
  "seed-06-agent-handoff",
  "seed-07-homen-memo",
];

afterEach(() => { vi.useRealTimers(); });

describe("sample room seeded transcript sorts before anything the visitor sends", () => {
  it("a message sent at 04:00 local — before the hour the transcript used to hard-code — lands last", () => {
    // Only Date is faked; real timers keep running so nothing in the engine stalls.
    vi.useFakeTimers({ toFake: ["Date"] });
    const earlyMorning = new Date();
    earlyMorning.setHours(4, 0, 0, 0);
    vi.setSystemTime(earlyMorning);

    const engine = new RoomEngine({ now: () => Date.now() });
    const demo = buildDemoRoom(engine);

    const seeded = engine.listMessages(demo.roomId, "public").filter((m) => SEED_IDS.includes(m.clientMsgId));
    expect(seeded).toHaveLength(SEED_IDS.length);
    // Every seeded line is in the past. A seed stamped in the future is the defect.
    for (const msg of seeded) expect(msg.createdAt).toBeLessThan(Date.now());

    engine.postMessage({
      roomId: demo.roomId, channel: "public", author: demo.me,
      text: "@nodeagent recompute the Q3 variance column", clientMsgId: "live-01", kind: "chat",
    });
    const feed = engine.listMessages(demo.roomId, "public").slice().sort((a, b) => a.createdAt - b.createdAt);
    expect(feed[feed.length - 1]?.clientMsgId).toBe("live-01");
  });

  it("holds on the engine's own injected clock, not just on Date.now", () => {
    let t = 1_700_000_000_000;
    const engine = new RoomEngine({ now: () => (t += 1000) });
    const demo = buildDemoRoom(engine);

    engine.postMessage({
      roomId: demo.roomId, channel: "public", author: demo.me,
      text: "later", clientMsgId: "live-02", kind: "chat",
    });
    const feed = engine.listMessages(demo.roomId, "public").slice().sort((a, b) => a.createdAt - b.createdAt);
    expect(feed[feed.length - 1]?.clientMsgId).toBe("live-02");
    // And the transcript still reads as a spaced conversation, not one collapsed instant.
    const seeded = engine.listMessages(demo.roomId, "public").filter((m) => SEED_IDS.includes(m.clientMsgId));
    const spread = Math.max(...seeded.map((m) => m.createdAt)) - Math.min(...seeded.map((m) => m.createdAt));
    expect(spread).toBe(8 * 60_000);
  });
});
