import type { AgentAskInput } from "../app/store";
import type { RoomCommand, VoiceDispatchResult, VoiceRoomStore } from "./types";

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);

export async function dispatchRoomCommand(store: VoiceRoomStore, command: RoomCommand): Promise<VoiceDispatchResult> {
  if (command.requiresConfirmation && !command.confirmed) {
    return { ok: false, kind: "confirmation_required", reason: command.confirmationPrompt ?? "confirmation_required" };
  }

  switch (command.kind) {
    case "public_chat_message":
      return postVisibleMessage(store, command);
    case "public_agent_request":
      return dispatchPublicAgent(store, command);
    case "private_agent_request":
      return dispatchPrivateAgent(store, command);
    case "cancel_active_job":
      return cancelActiveJob(store);
    case "confirm_pending_command":
      return { ok: false, kind: "failed", reason: "confirm_without_pending_command" };
    case "reject_pending_command":
      return { ok: false, kind: "rejected", reason: "voice_command_rejected" };
  }
}

async function postVisibleMessage(store: VoiceRoomStore, command: RoomCommand): Promise<VoiceDispatchResult> {
  const posted = await store.postMessage({
    roomId: command.roomId,
    channel: command.channel,
    author: command.actor,
    text: command.commandText,
    clientMsgId: clientMsgId(command, "voice-msg"),
    kind: "chat",
  });
  return posted.ok
    ? { ok: true, kind: "message_posted" }
    : { ok: false, kind: "failed", reason: posted.reason ?? "message_post_failed" };
}

async function dispatchPublicAgent(store: VoiceRoomStore, command: RoomCommand): Promise<VoiceDispatchResult> {
  const messageText = command.transcript || `@nodeagent ${command.commandText}`;
  const posted = await store.postMessage({
    roomId: command.roomId,
    channel: "public",
    author: command.actor,
    text: messageText,
    clientMsgId: clientMsgId(command, "voice-public-agent"),
    kind: "chat",
  });
  if (!posted.ok) return { ok: false, kind: "failed", reason: posted.reason ?? "message_post_failed" };

  await store.askAgent(agentInputFor(command));
  return { ok: true, kind: "agent_started" };
}

async function dispatchPrivateAgent(store: VoiceRoomStore, command: RoomCommand): Promise<VoiceDispatchResult> {
  const posted = await store.postMessage({
    roomId: command.roomId,
    channel: command.channel,
    author: command.actor,
    text: command.transcript || command.commandText,
    clientMsgId: clientMsgId(command, "voice-private-agent"),
    kind: "chat",
  });
  if (!posted.ok) return { ok: false, kind: "failed", reason: posted.reason ?? "message_post_failed" };

  await store.askPrivateAgent(agentInputFor(command), { publish: command.metadata?.publishToRoom === true });
  return { ok: true, kind: "private_agent_started" };
}

async function cancelActiveJob(store: VoiceRoomStore): Promise<VoiceDispatchResult> {
  const activeJobs = store.activeLongFreeJobs?.() ?? activeJobFallback(store);
  const job = activeJobs.find((candidate) => !TERMINAL_JOB_STATUSES.has(candidate.status));
  if (!job) return { ok: false, kind: "no_active_job", reason: "no_active_job" };

  const cancelled = await store.cancelLongFreeJob(job.id);
  return cancelled.ok
    ? { ok: true, kind: "job_cancelled", jobId: job.id }
    : { ok: false, kind: "failed", reason: cancelled.reason ?? "cancel_failed" };
}

function agentInputFor(command: RoomCommand): AgentAskInput {
  return {
    goal: command.commandText,
    references: command.metadata?.references,
    contextArtifactId: command.metadata?.contextArtifactId,
    modelSelection: command.metadata?.forceFree ? { mode: "free" } : command.metadata?.modelSelection,
  };
}

function activeJobFallback(store: VoiceRoomStore) {
  const job = store.lastLongFreeJob();
  return job ? [job] : [];
}

function clientMsgId(command: RoomCommand, prefix: string): string {
  return `${prefix}-${command.id}`;
}
