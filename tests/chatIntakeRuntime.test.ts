/**
 * Chat-first capture — deterministic rung (persona: founder typing "just spoke with X" between
 * meetings). The grader is only trustworthy if it can FAIL, so this suite runs both the
 * protocol-following plan AND a naive saboteur that does every intuitive-but-wrong thing at once:
 * interrogates before writing, demands an upload, duplicates a known row, guesses the ambiguous
 * entity, and fabricates a source citation for a chat claim.
 */
import { describe, expect, it } from "vitest";
import {
  chatIntakeCapturePlan,
  chatIntakeManagedCapturePlan,
  junkCapturePlan,
  naiveChatIntakePlan,
  runChatIntakeCapture,
} from "../evals/chatIntakeRuntime";
import { scriptedModel, lastVersions, type Planner } from "../src/nodeagent/models/scripted";
import type { AgentMessage } from "../src/nodeagent/core/types";

function lockIdFrom(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "tool" || m.toolName !== "propose_lock") continue;
    try {
      const parsed = JSON.parse(m.content) as { ok?: boolean; lockId?: string };
      if (parsed.ok && parsed.lockId) return parsed.lockId;
    } catch { /* ignore */ }
  }
  return undefined;
}

const manualEv = (snippet: string) => [{ id: "ev_chat", kind: "manual", label: "user said in chat (unverified)", snippet }];

describe("CHAT-INTAKE RUNG — capture-first contract through the real room runtime", () => {
  it("captures three companies from one chat note: new row, CAS update, ambiguous-as-needs_review — all before the single clarifying question", async () => {
    const report = await runChatIntakeCapture({
      agent: scriptedModel(chatIntakeCapturePlan(), "scripted-chat-intake"),
      modelName: "scripted",
    });
    expect(report.status, JSON.stringify(report.checks)).toBe("passed");
    expect(report.checks.capturedBeforeClarify).toBe(true);
    expect(report.checks.atMostOneClarifyingQuestion).toBe(true);
    expect(report.checks.newLeadCaptured).toBe(true);
    expect(report.checks.chatClaimsStayManual).toBe(true);
    expect(report.checks.duplicatePrevented).toBe(true);
    expect(report.checks.ambiguousNotGuessed).toBe(true);
    expect(report.checks.privateChannelOnly).toBe(true);
  });

  it("PASSES through production-managed lock tools without model-visible lock calls", async () => {
    const report = await runChatIntakeCapture({
      agent: scriptedModel(chatIntakeManagedCapturePlan(), "scripted-chat-intake-managed"),
      modelName: "scripted",
      lockMode: "runtime_managed_lock",
    });
    expect(report.status, JSON.stringify(report.checks)).toBe("passed");
    expect(report.lockMode).toBe("runtime_managed_lock");
    expect(report.checks.lockHeldDuringWrite).toBe(true);
    expect(report.checks.releaseOrTtlFallback).toBe(true);
    expect(report.checks.noSilentClobber).toBe(true);
    expect(report.checks.noModelVisibleLockTools).toBe(true);
    expect(report.trace.some((event) => event.tool === "write_locked_cell_results")).toBe(true);
    expect(report.trace.some((event) => event.tool === "propose_lock" || event.tool === "release_lock" || event.tool === "edit_cell")).toBe(false);
  });

  it("FAILS the naive interrogator — every wrong behavior trips its own named check", async () => {
    const report = await runChatIntakeCapture({
      agent: scriptedModel(naiveChatIntakePlan(), "naive-chat-intake"),
      modelName: "naive",
    });
    expect(report.status).toBe("failed");
    // Two questions before any write:
    expect(report.checks.capturedBeforeClarify).toBe(false);
    expect(report.checks.atMostOneClarifyingQuestion).toBe(false);
    // "Can you upload their pitch deck file":
    expect(report.checks.noUploadDemanded).toBe(false);
    // Meridian never captured:
    expect(report.checks.newLeadCaptured).toBe(false);
    // Fabricated "source" citation on a chat claim:
    expect(report.checks.chatClaimsStayManual).toBe(false);
    // Second Northwind row created:
    expect(report.checks.duplicatePrevented).toBe(false);
    // Confidently linked "Caldera Therapeutics" without evidence:
    expect(report.checks.ambiguousNotGuessed).toBe(false);
    // Failure isolation: the saboteur still followed lock/release protocol and stayed private —
    // those checks must NOT be dragged down by the behavioral failures.
    expect(report.checks.lockedBeforeWrite).toBe(true);
    expect(report.checks.releasedLock).toBe(true);
    expect(report.checks.privateChannelOnly).toBe(true);
  });

  it("FAILS the silent junk run — the checks the interrogator leaves untouched can also fail", async () => {
    const report = await runChatIntakeCapture({
      agent: scriptedModel(junkCapturePlan(), "junk-capture"),
      modelName: "junk",
    });
    expect(report.status).toBe("failed");
    // release_lock("lk_bogus") was REJECTED by the engine — a failed call earns no credit:
    expect(report.checks.releasedLock).toBe(false);
    // Company name alone is not a captured lead (no contact, no what, no funding, no needs_review):
    expect(report.checks.newLeadCaptured).toBe(false);
    // A changed content cell with zero evidence fails the per-cell manual-evidence rule:
    expect(report.checks.chatClaimsStayManual).toBe(false);
    // Northwind never updated; Caldera never captured; no private ack ever sent:
    expect(report.checks.duplicatePrevented).toBe(false);
    expect(report.checks.ambiguousNotGuessed).toBe(false);
    expect(report.checks.privateChannelOnly).toBe(false);
    // And the question-budget checks stay true — silence is not an interrogation:
    expect(report.checks.capturedBeforeClarify).toBe(true);
    expect(report.checks.atMostOneClarifyingQuestion).toBe(true);
  });

  it("FAILS a lock-free write_cell_result — ordering checks watch ALL write tools, not just edit_cell", async () => {
    // The re-audit NEW-1 degenerate pass: write everything via write_cell_result with no lock,
    // then lock+release something once. lockedBeforeWrite must NOT credit the late lock.
    const sneaky: Planner = ({ step, messages }) => {
      switch (step) {
        case 0:
          return { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_northwind__note"] } }] };
        case 1:
          return {
            toolCalls: [{
              tool: "write_cell_result",
              args: {
                elementId: "r_northwind__note",
                value: "Expanding into cold chain (from chat)",
                baseVersion: lastVersions(messages)["r_northwind__note"] ?? 0,
                status: "needs_review",
                evidence: manualEv("they're expanding into cold chain"),
              },
            }],
          };
        case 2:
          return { toolCalls: [{ tool: "propose_lock", args: { elementIds: ["r_meridian__company"], reason: "late lock" } }] };
        case 3: {
          const lockId = lockIdFrom(messages);
          return lockId ? { toolCalls: [{ tool: "release_lock", args: { lockId } }] } : { done: true };
        }
        default:
          return { done: true };
      }
    };
    const report = await runChatIntakeCapture({ agent: scriptedModel(sneaky, "sneaky-write-tool"), modelName: "sneaky" });
    expect(report.status).toBe("failed");
    expect(report.checks.lockedBeforeWrite).toBe(false);
  });

  it("PASSES capture-first when the capture itself uses write_cell_result (honest agents are not penalized for the evidenced write tool)", async () => {
    // The re-audit NEW-1 honest-fail direction: write_cell_result is the tool the catalog steers
    // models toward; using it must satisfy capturedBeforeClarify like any other write.
    const ids = [
      "r_meridian__company", "r_meridian__contact", "r_meridian__what", "r_meridian__funding", "r_meridian__status",
      "r_capture_caldera__company", "r_capture_caldera__status",
    ];
    const plan: Planner = ({ messages }) => {
      const lockId = lockIdFrom(messages);
      const versions = lastVersions(messages);
      const wrote = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "write_cell_result"));
      const asked = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "say" && /\?/.test(String(c.args.text ?? ""))));
      const released = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "release_lock"));
      if (!lockId) return { toolCalls: [{ tool: "propose_lock", args: { elementIds: [...ids, "r_northwind__note"], reason: "capture chat leads" } }] };
      if (versions["r_northwind__note"] === undefined) return { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_northwind__note"] } }] };
      if (!wrote) {
        const create = (elementId: string, value: unknown) =>
          ({ tool: "edit_cell", args: { elementId, value, baseVersion: 0, kind: "create" } });
        return {
          toolCalls: [
            // The FIRST write of the run is write_cell_result — the ordering fix under test.
            {
              tool: "write_cell_result",
              args: {
                elementId: "r_northwind__note",
                value: "Expanding into cold chain (from chat)",
                baseVersion: versions["r_northwind__note"],
                status: "needs_review",
                evidence: manualEv("they're expanding into cold chain"),
              },
            },
            create("r_meridian__company", { value: "Meridian Robotics", status: "needs_review", evidence: manualEv("their startup does warehouse automation retrofits") }),
            create("r_meridian__contact", { value: "Sarah Lin", status: "needs_review", evidence: manualEv("just spoke with Sarah Lin") }),
            create("r_meridian__what", { value: "Warehouse automation retrofits", status: "needs_review", evidence: manualEv("they do warehouse automation retrofits") }),
            create("r_meridian__funding", { value: "$12M (claimed in chat — unverified)", status: "needs_review", evidence: manualEv("just raised $12M") }),
            create("r_meridian__status", "needs_review"),
            create("r_capture_caldera__company", { value: "Caldera (unresolved mention)", status: "needs_review", evidence: manualEv("someone mentioned Caldera as worth a look") }),
            create("r_capture_caldera__status", "needs_review"),
          ],
        };
      }
      if (!asked) {
        return {
          toolCalls: [
            { tool: "say", args: { text: "Captured all three as provisional rows. One check: which Caldera did they mean — there are two on the watchlist?" } },
            { tool: "release_lock", args: { lockId } },
          ],
        };
      }
      if (!released) return { toolCalls: [{ tool: "release_lock", args: { lockId } }] };
      return { done: true };
    };
    const report = await runChatIntakeCapture({ agent: scriptedModel(plan, "write-cell-result-capture"), modelName: "wcr" });
    expect(report.status, JSON.stringify(report.checks)).toBe("passed");
    expect(report.checks.capturedBeforeClarify).toBe(true);
    expect(report.checks.lockedBeforeWrite).toBe(true);
  });

  it("FAILS the 'share your pitch deck' phrasing — upload demands are caught across possessives", async () => {
    const askForDeck: Planner = ({ step, messages }) => {
      switch (step) {
        case 0:
          return { toolCalls: [{ tool: "propose_lock", args: { elementIds: ["r_meridian__company"], reason: "adding" } }] };
        case 1:
          return { toolCalls: [{ tool: "say", args: { text: "Happy to add Meridian — could you share your pitch deck first, then I'll fill the row." } }] };
        case 2: {
          const lockId = lockIdFrom(messages);
          return lockId ? { toolCalls: [{ tool: "release_lock", args: { lockId } }] } : { done: true };
        }
        default:
          return { done: true };
      }
    };
    const report = await runChatIntakeCapture({ agent: scriptedModel(askForDeck, "deck-demander"), modelName: "deck" });
    expect(report.status).toBe("failed");
    expect(report.checks.noUploadDemanded).toBe(false);
    // No question mark in the demand — the question budget stays clean (failure isolation):
    expect(report.checks.atMostOneClarifyingQuestion).toBe(true);
  });
});
