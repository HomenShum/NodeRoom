/**
 * Cross-engine handoff packet: only what Node can prove (hashes, checks it
 * ran) plus the prior engine's claims, labelled as claims.
 */
import type { RunRecord } from "./api.js";
import type { HandoffPacket, NodeAgentEvent } from "./contract.js";
import type { Snapshot } from "./artifacts.js";

const MAX_ARTIFACTS = 500;
const MAX_CHECKS = 50;
const MAX_UNRESOLVED = 50;
const MAX_SUMMARY = 4000;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

/** `originalPrompt` is the root run's prompt: a resume or handoff run's own prompt is boilerplate. */
export function buildHandoffPacket(run: RunRecord, events: NodeAgentEvent[], snap: Snapshot, originalPrompt: string): HandoffPacket {
  const artifacts = [...snap.files]
    .filter(([, f]) => f.sha256)
    .slice(0, MAX_ARTIFACTS)
    .map(([p, f]) => ({ path: p, sha256: f.sha256, bytes: f.bytes }));

  const checks: HandoffPacket["checks"] = [];
  const openCalls = new Map<string, string>();
  const openHelpers = new Map<string, string>();
  let lastAssistant = "";
  for (const e of events) {
    switch (e.type) {
      case "check.result":
        checks.push({
          checkId: e.checkId,
          command: e.command,
          ok: e.ok,
          summary: `${e.passed} passed, ${e.failed} failed${e.independent ? " (independent)" : ""}: ${e.outputTail.slice(-300)}`,
        });
        break;
      case "tool.call":
        if (openCalls.size < 1000) openCalls.set(e.callId, e.name);
        break;
      case "tool.result":
        openCalls.delete(e.callId);
        break;
      case "helper.started":
        if (openHelpers.size < 1000) openHelpers.set(e.helperId, e.description);
        break;
      case "helper.completed":
        openHelpers.delete(e.helperId);
        break;
      case "message":
        if (e.role === "assistant" && !e.agentId) lastAssistant = e.text;
        break;
    }
  }

  const unresolved: string[] = [];
  if (run.status !== "completed") unresolved.push(`Run ended ${run.status}${run.error ? `: ${cut(run.error, 300)}` : ""}`);
  for (const g of run.goals) {
    if (g.status !== "done") unresolved.push(`Goal "${g.title}" is ${g.status}`);
    else if (g.claimedBy === "engine") unresolved.push(`Goal "${g.title}" was claimed done by the engine; Node has not verified it`);
  }
  for (const c of checks) if (!c.ok) unresolved.push(`Check ${c.checkId} failed (${c.command})`);
  for (const [id, name] of openCalls) unresolved.push(`Tool call ${name} (${id}) has no recorded result`);
  for (const [id, d] of openHelpers) unresolved.push(`Helper ${id} ("${cut(d, 120)}") never reported completion`);
  if (snap.truncated) unresolved.push(`Workspace has more files than Node hashed (${snap.files.size}); unlisted files are unverified`);

  return {
    schema: "nodeagent.handoff/v1",
    fromRunId: run.id,
    fromEngine: run.engine,
    originalPrompt,
    goals: run.goals,
    artifacts,
    checks: checks.slice(-MAX_CHECKS),
    lastSummary: cut(run.finalText || lastAssistant, MAX_SUMMARY),
    unresolved: unresolved.slice(0, MAX_UNRESOLVED),
    createdAt: new Date().toISOString(),
  };
}
