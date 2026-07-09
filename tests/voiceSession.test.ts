import { describe, expect, it } from "vitest";
import type { Actor } from "../src/engine/types";
import {
  VoiceGateway,
  classifyVoiceTranscript,
  initialVoiceSessionState,
  reduceVoiceSession,
  RecordingTextToSpeechAdapter,
  MockSpeechToTextAdapter,
  type RoomCommand,
  type VoiceCommandRouter,
} from "../src/voice";

const actor: Actor = { kind: "user", id: "u_host", name: "Homen" };

describe("VoiceSessionState", () => {
  it("moves from listening to confirmation to dispatch without mutating room state itself", () => {
    let state = initialVoiceSessionState("s1", 1);
    state = reduceVoiceSession(state, { type: "START_LISTENING", now: 2 });
    expect(state.status).toBe("listening");

    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: "public",
      transcript: "nodeagent update the research sheet with the new values",
      now: 3,
    });
    expect(command.requiresConfirmation).toBe(true);

    state = reduceVoiceSession(state, { type: "AWAIT_CONFIRMATION", command, now: 4 });
    expect(state.status).toBe("awaiting_confirmation");
    expect(state.pendingCommand?.id).toBe(command.id);
  });
});

describe("voice transcript classification", () => {
  it("classifies public agent requests and keeps write-like requests behind confirmation", () => {
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: "public",
      transcript: "ask nodeagent to fill the missing funding cells",
      now: 10,
    });

    expect(command).toMatchObject({
      source: "voice",
      kind: "public_agent_request",
      commandText: "fill the missing funding cells",
      riskLevel: "write",
      requiresConfirmation: true,
      confirmed: false,
    });
    expect(command.confirmationPrompt).toContain("NodeRoom governance");
  });

  it("classifies private voice in the private lane without crossing into public room permissions", () => {
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: { private: actor.id },
      transcript: "summarize the room for me",
      privateMode: true,
      now: 11,
    });

    expect(command.kind).toBe("private_agent_request");
    expect(command.channel).toEqual({ private: actor.id });
    expect(command.requiresConfirmation).toBe(false);
  });

  it("treats explicit interruption as cancellation without an extra confirmation loop", () => {
    const command = classifyVoiceTranscript({
      roomId: "room1",
      actor,
      channel: "public",
      transcript: "stop the active job",
      now: 12,
    });

    expect(command.kind).toBe("cancel_active_job");
    expect(command.riskLevel).toBe("destructive");
    expect(command.requiresConfirmation).toBe(false);
  });
});

describe("VoiceGateway", () => {
  it("asks for confirmation before dispatching a risky transcript, then dispatches after yes", async () => {
    const dispatched: RoomCommand[] = [];
    const router: VoiceCommandRouter = {
      async dispatch(command) {
        dispatched.push(command);
        return { ok: true, kind: "agent_started" };
      },
    };
    const tts = new RecordingTextToSpeechAdapter();
    const gateway = new VoiceGateway(new MockSpeechToTextAdapter(), tts, router, {
      sessionId: "voice-test",
      makeId: () => "id1",
      now: () => 100,
    });

    const context = {
      roomId: "room1",
      actor,
      channel: "public" as const,
      references: [{ id: "artifact1", title: "Diligence memo", kind: "note" as const }],
    };
    const first = await gateway.submitTranscript(context, "nodeagent delete the stale diligence rows");
    expect(first).toMatchObject({ ok: false, kind: "confirmation_required" });
    expect(gateway.state.status).toBe("listening");
    expect(tts.utterances[0]?.text).toContain("destructive voice command");
    expect(dispatched).toHaveLength(0);

    const second = await gateway.submitTranscript(context, "yes");
    expect(second).toMatchObject({ ok: true, kind: "agent_started" });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ confirmed: true, requiresConfirmation: false });
    expect(dispatched[0]?.metadata?.references).toEqual(context.references);
  });

  it("interrupts speech and can route cancellation through the command router", async () => {
    const dispatched: RoomCommand[] = [];
    const router: VoiceCommandRouter = {
      async dispatch(command) {
        dispatched.push(command);
        return { ok: true, kind: "job_cancelled", jobId: "job1" };
      },
    };
    const tts = new RecordingTextToSpeechAdapter();
    const gateway = new VoiceGateway(new MockSpeechToTextAdapter(), tts, router, { sessionId: "voice-test", makeId: () => "id2" });

    const result = await gateway.interrupt(true, { roomId: "room1", actor, channel: "public" });

    expect(tts.stoppedCount).toBe(1);
    expect(result).toMatchObject({ ok: true, kind: "job_cancelled" });
    expect(dispatched[0]?.kind).toBe("cancel_active_job");
  });
});
