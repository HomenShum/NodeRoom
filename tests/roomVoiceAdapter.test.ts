import { describe, expect, it } from "vitest";
import type { Actor, Channel } from "../src/engine/types";
import {
  classifyVoiceTranscript,
  confirmCommand,
  dispatchRoomCommand,
  narrationForRoomEvent,
  type VoiceRoomStore,
} from "../src/voice";

const actor: Actor = { kind: "user", id: "u_host", name: "Homen" };
const agent: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };

function makeStore() {
  const calls: Array<{ name: string; payload: unknown }> = [];
  const store: VoiceRoomStore = {
    async postMessage(args) {
      calls.push({ name: "postMessage", payload: args });
      return { ok: true };
    },
    async askAgent(input) {
      calls.push({ name: "askAgent", payload: input });
    },
    async askPrivateAgent(input, opts) {
      calls.push({ name: "askPrivateAgent", payload: { input, opts } });
    },
    async cancelLongFreeJob(jobId) {
      calls.push({ name: "cancelLongFreeJob", payload: jobId });
      return { ok: true };
    },
    lastLongFreeJob() {
      return { id: "job1", status: "running", attempts: 1, maxAttempts: 3, modelPolicy: "fast", updatedAt: 1 };
    },
    activeLongFreeJobs() {
      return [{ id: "job1", status: "running", attempts: 1, maxAttempts: 3, modelPolicy: "fast", updatedAt: 1 }];
    },
  };
  return { store, calls };
}

describe("RoomVoiceAdapter", () => {
  it("routes safe public voice through the same visible message plus askAgent path as text chat", async () => {
    const { store, calls } = makeStore();
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: "public",
      transcript: "ask nodeagent to summarize current diligence gaps",
      references: [{ id: "artifact1", title: "Diligence memo", kind: "note" }],
      now: 1,
    });

    const result = await dispatchRoomCommand(store, command);

    expect(result).toMatchObject({ ok: true, kind: "agent_started" });
    expect(calls.map((call) => call.name)).toEqual(["postMessage", "askAgent"]);
    expect(calls[0].payload).toMatchObject({ channel: "public", author: actor });
    expect(calls[1].payload).toMatchObject({
      goal: "summarize current diligence gaps",
      references: [{ id: "artifact1", title: "Diligence memo", kind: "note" }],
    });
  });

  it("rejects risky voice commands until a separate confirmation turn confirms them", async () => {
    const { store, calls } = makeStore();
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: "public",
      transcript: "nodeagent overwrite the company research sheet",
      now: 1,
    });

    const blocked = await dispatchRoomCommand(store, command);
    expect(blocked).toMatchObject({ ok: false, kind: "confirmation_required" });
    expect(calls).toEqual([]);

    const confirmed = await dispatchRoomCommand(store, confirmCommand(command));
    expect(confirmed).toMatchObject({ ok: true, kind: "agent_started" });
    expect(calls.map((call) => call.name)).toEqual(["postMessage", "askAgent"]);
  });

  it("keeps private voice in the private agent lane unless explicitly published", async () => {
    const { store, calls } = makeStore();
    const privateChannel: Channel = { private: actor.id };
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: privateChannel,
      transcript: "summarize the room privately",
      privateMode: true,
      now: 1,
    });

    const result = await dispatchRoomCommand(store, command);

    expect(result).toMatchObject({ ok: true, kind: "private_agent_started" });
    expect(calls.map((call) => call.name)).toEqual(["postMessage", "askPrivateAgent"]);
    expect(calls[0].payload).toMatchObject({ channel: privateChannel });
    expect(calls[1].payload).toMatchObject({ opts: { publish: false } });
  });

  it("uses the private personal agent API for private Room-lane voice publishing", async () => {
    const { store, calls } = makeStore();
    const privateChannel: Channel = { private: actor.id };
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: privateChannel,
      transcript: "update the shared diligence memo",
      privateMode: true,
      publishPrivateToRoom: true,
      now: 1,
    });

    const result = await dispatchRoomCommand(store, confirmCommand(command));

    expect(command.kind).toBe("private_agent_request");
    expect(result).toMatchObject({ ok: true, kind: "private_agent_started" });
    expect(calls.map((call) => call.name)).toEqual(["postMessage", "askPrivateAgent"]);
    expect(calls[1].payload).toMatchObject({ opts: { publish: true } });
  });

  it("cancels through the existing job cancellation path and no direct mutation API", async () => {
    const { store, calls } = makeStore();
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: "public",
      transcript: "cancel the active job",
      now: 1,
    });

    const result = await dispatchRoomCommand(store, command);

    expect(result).toMatchObject({ ok: true, kind: "job_cancelled", jobId: "job1" });
    expect(calls).toEqual([{ name: "cancelLongFreeJob", payload: "job1" }]);
  });
});

describe("voice narration", () => {
  it("narrates committed agent/job/proposal events and skips echoing the user's own voice command", () => {
    expect(narrationForRoomEvent({
      kind: "message",
      id: "m1",
      channel: "public",
      author: actor,
      text: "ask nodeagent to summarize",
      ownVoiceCommand: true,
    })).toBeNull();

    expect(narrationForRoomEvent({
      kind: "message",
      id: "m2",
      channel: "public",
      author: agent,
      text: "I found three diligence gaps.",
    })).toMatchObject({ text: "I found three diligence gaps.", source: "room_event" });

    expect(narrationForRoomEvent({
      kind: "job",
      id: "job1",
      status: "completed",
      finalText: "Completed the research run.",
    })).toMatchObject({ text: "Completed the research run.", source: "job_event" });

    expect(narrationForRoomEvent({
      kind: "proposal",
      id: "p1",
      status: "pending",
      summary: "Change five cells in Company research",
    })).toMatchObject({ priority: "high", source: "proposal_event" });
  });
});
