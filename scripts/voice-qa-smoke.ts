import assert from "node:assert/strict";
import type { Actor } from "../src/engine/types";
import {
  classifyVoiceTranscript,
  confirmCommand,
  dispatchRoomCommand,
  narrationForRoomEvent,
  type VoiceRoomStore,
} from "../src/voice";

const actor: Actor = { kind: "user", id: "u_host", name: "Homen" };
const agent: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
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
    return { id: "job-smoke", status: "running", attempts: 1, maxAttempts: 3, modelPolicy: "fast", updatedAt: Date.now() };
  },
};

const safe = classifyVoiceTranscript({
  roomId: "room-smoke",
  actor,
  channel: "public",
  transcript: "ask nodeagent to summarize current diligence gaps",
  now: 1,
});
const safeResult = await dispatchRoomCommand(store, safe);
assert.equal(safeResult.ok, true);
assert.deepEqual(calls.map((call) => call.name), ["postMessage", "askAgent"]);

const risky = classifyVoiceTranscript({
  roomId: "room-smoke",
  actor,
  channel: "public",
  transcript: "nodeagent overwrite the company research sheet",
  now: 2,
});
const blocked = await dispatchRoomCommand(store, risky);
assert.equal(blocked.ok, false);
assert.equal(blocked.kind, "confirmation_required");

const confirmed = await dispatchRoomCommand(store, confirmCommand(risky));
assert.equal(confirmed.ok, true);

const cancel = classifyVoiceTranscript({
  roomId: "room-smoke",
  actor,
  channel: "public",
  transcript: "cancel the active job",
  now: 3,
});
const cancelResult = await dispatchRoomCommand(store, cancel);
assert.deepEqual(cancelResult, { ok: true, kind: "job_cancelled", jobId: "job-smoke" });

const narration = narrationForRoomEvent({
  kind: "message",
  id: "agent-message-smoke",
  channel: "public",
  author: agent,
  text: "I found three diligence gaps.",
});
assert.equal(narration?.text, "I found three diligence gaps.");

console.log(JSON.stringify({
  ok: true,
  safeResult,
  blockedKind: blocked.kind,
  confirmed,
  cancelResult,
  calls: calls.map((call) => call.name),
  narration,
}, null, 2));
