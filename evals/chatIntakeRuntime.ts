/**
 * Chat-first capture — the DETERMINISTIC rung (rank 1 in docs/eval/FEATURE_EVAL_BACKLOG.md).
 *
 * The user's literal behavior: "just spoke with Sarah at Meridian; they do X and raised $12M"
 * typed between meetings. This rung grades the capture contract through the REAL room runtime
 * (lock -> read -> CAS -> release, same tools users see), exactly the way financeModelRuntime.ts
 * grades the modeling test:
 *
 *   - capture FIRST: the provisional row lands before any clarifying question;
 *   - at most ONE clarifying question, and never an upload demand;
 *   - chat claims stay MANUAL evidence (kind "manual") — never upgraded to a source citation
 *     that was not fetched;
 *   - a known company UPDATES its existing row via CAS (no duplicate);
 *   - an ambiguous mention ("Caldera" — two candidates on the list) is captured as needs_review
 *     WITHOUT guessing which candidate;
 *   - the private agent stays on the private channel; the person's name never reaches a public
 *     surface.
 *
 * All companies and people are fictional. The live rung (real route + recorded-HTTP canary) is a
 * separate later step; per the backlog it is a scheduled canary, NOT the promotion gate.
 */
import { RoomEngine } from "../src/engine/roomEngine";
import type { CellEvidence, CellPayload } from "../src/engine/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { PRODUCTION_ROOM_TOOLS, ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { MANAGED_LOCK_SYSTEM_PROMPT } from "../src/nodeagent/models/prompts/systemPrompt";
import { AgentRunError, runAgent } from "../src/nodeagent/core/runtime";
import { scriptedModel, lastVersions, type Planner } from "../src/nodeagent/models/scripted";
import type { AgentMessage, AgentModel, AgentTraceEvent, RoomTools } from "../src/nodeagent/core/types";
import { appendEvalRuns, computeCaseSetHash, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
import { readGitIdentity } from "./gitIdentity";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const CHAT_INTAKE_GOAL =
  "Just spoke with Sarah Lin at Meridian Robotics — they do warehouse automation retrofits and " +
  "just raised $12M. Also caught up with Northwind Logistics; they're expanding into cold chain. " +
  "And someone mentioned Caldera as worth a look.";

/** Seeded watchlist: one row the note UPDATES, plus the deliberately ambiguous Caldera pair. */
export const CHAT_INTAKE_SEED_ROWS = [
  { rowId: "r_northwind", company: "Northwind Logistics", what: "Freight coordination platform" },
  { rowId: "r_caldera_thx", company: "Caldera Therapeutics", what: "Oncology biotech" },
  { rowId: "r_caldera_mat", company: "Caldera Materials", what: "Advanced ceramics" },
] as const;

const COLUMNS = ["company", "contact", "what", "funding", "status", "note"] as const;

export type ChatIntakeReport = {
  caseId: string;
  modelName: string;
  lockMode: ChatIntakeLockMode;
  status: "passed" | "failed";
  score: number;
  checks: Record<string, boolean>;
  ms: number;
  toolCalls: number;
  failureReason?: string;
};

export type ChatIntakeLockMode = "explicit_agent_lock" | "runtime_managed_lock";

function chatEvidence(snippet: string): CellEvidence[] {
  return [{ id: "ev_chat", kind: "manual", label: "user said in chat (unverified)", snippet }];
}

function payloadOf(value: unknown): CellPayload | undefined {
  if (value && typeof value === "object" && "value" in value) return value as CellPayload;
  return undefined;
}

function cellText(value: unknown): string {
  const payload = payloadOf(value);
  const raw = payload ? payload.value : value;
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

/** The protocol-following scripted plan — the satisfiability proof for the capture contract. */
export function chatIntakeCapturePlan(): Planner {
  const newIds = [
    "r_meridian__company", "r_meridian__contact", "r_meridian__what", "r_meridian__funding", "r_meridian__status",
    "r_capture_caldera__company", "r_capture_caldera__status",
  ];
  return ({ messages }) => {
    const lockId = latestLockId(messages);
    const versions = lastVersions(messages);
    const edited = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "edit_cell"));
    const asked = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "say" && String(c.args.text ?? "").includes("?")));
    const released = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "release_lock"));

    if (!lockId) {
      return {
        say: "Capturing the three companies from the chat note as provisional rows first; questions after.",
        toolCalls: [{ tool: "propose_lock", args: { elementIds: [...newIds, "r_northwind__note"], reason: "capture chat leads" } }],
      };
    }
    if (versions["r_northwind__note"] === undefined) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_northwind__note", "r_northwind__company"] } }] };
    }
    if (!edited) {
      const create = (elementId: string, value: unknown) =>
        ({ tool: "edit_cell", args: { elementId, value, baseVersion: 0, kind: "create" } });
      return {
        toolCalls: [
          create("r_meridian__company", { value: "Meridian Robotics", status: "needs_review", evidence: chatEvidence("their startup does warehouse automation retrofits") }),
          create("r_meridian__contact", { value: "Sarah Lin", status: "needs_review", evidence: chatEvidence("just spoke with Sarah Lin") }),
          create("r_meridian__what", { value: "Warehouse automation retrofits", status: "needs_review", evidence: chatEvidence("they do warehouse automation retrofits") }),
          create("r_meridian__funding", { value: "$12M (claimed in chat — unverified)", status: "needs_review", evidence: chatEvidence("just raised $12M") }),
          create("r_meridian__status", "needs_review"),
          { tool: "edit_cell", args: { elementId: "r_northwind__note", value: { value: "Expanding into cold chain (from chat)", status: "needs_review", evidence: chatEvidence("they're expanding into cold chain") }, baseVersion: versions["r_northwind__note"] } },
          create("r_capture_caldera__company", { value: "Caldera (unresolved mention)", status: "needs_review", evidence: chatEvidence("someone mentioned Caldera as worth a look") }),
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
    if (!released) {
      return { toolCalls: [{ tool: "release_lock", args: { lockId } }] };
    }
    return { done: true };
  };
}

/** Production-shaped plan: the model writes business intent and base versions; the runtime
 * acquires/releases the lock internally through write_locked_* tools. */
export function chatIntakeManagedCapturePlan(): Planner {
  return ({ messages }) => {
    const versions = lastVersions(messages);
    const wrote = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool.startsWith("write_locked_cell")));
    const asked = messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.tool === "say" && String(c.args.text ?? "").includes("?")));

    if (versions["r_northwind__note"] === undefined) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_northwind__note", "r_northwind__company"] } }] };
    }
    if (!wrote) {
      const result = (elementId: string, value: unknown, snippet: string, baseVersion = 0, kind: "set" | "create" = "create") => ({
        elementId,
        value,
        baseVersion,
        status: "needs_review",
        confidence: 0.75,
        evidence: chatEvidence(snippet),
        kind,
      });
      return {
        toolCalls: [
          {
            tool: "write_locked_cell_results",
            args: {
              reason: "capture chat leads with managed locks",
              ops: [
                result("r_meridian__company", "Meridian Robotics", "their startup company Meridian Robotics"),
                result("r_meridian__contact", "Sarah Lin", "just spoke with Sarah Lin"),
                result("r_meridian__what", "Warehouse automation retrofits", "they do warehouse automation retrofits"),
                result("r_meridian__funding", "$12M (claimed in chat - unverified)", "just raised $12M"),
                result("r_meridian__note", "Provisional chat capture; funding and description are unverified.", "just spoke with Sarah Lin at Meridian Robotics"),
                result("r_northwind__note", "Expanding into cold chain (from chat)", "they're expanding into cold chain", versions["r_northwind__note"], "set"),
                result("r_capture_caldera__company", "Caldera (unresolved mention)", "someone mentioned Caldera as worth a look"),
              ],
            },
          },
          {
            tool: "write_locked_cells",
            args: {
              reason: "mark chat captures needs_review",
              ops: [
                { elementId: "r_meridian__status", value: "needs_review", baseVersion: 0, kind: "create" },
                { elementId: "r_capture_caldera__status", value: "needs_review", baseVersion: 0, kind: "create" },
              ],
            },
          },
        ],
      };
    }
    if (!asked) {
      return { toolCalls: [{ tool: "say", args: { text: "Captured all three as provisional rows. One check: which Caldera did they mean - there are two on the watchlist?" } }] };
    }
    return { done: true };
  };
}

/** The NEGATIVE CONTROL — every intuitive-but-wrong behavior at once. The grader must fail this:
 *  interrogates before writing (two questions), demands an upload, duplicates the known row,
 *  confidently guesses the ambiguous entity, and fabricates a source citation for a chat claim. */
export function naiveChatIntakePlan(): Planner {
  return ({ step, messages }) => {
    switch (step) {
      case 0:
        return {
          toolCalls: [
            { tool: "say", args: { text: "Who is the contact exactly? And which Caldera do you mean? Also, can you upload their pitch deck file before I add anything?" } },
            { tool: "propose_lock", args: { elementIds: ["r_dup_northwind__company", "r_guess_caldera__company"], reason: "adding rows" } },
          ],
        };
      case 1:
        {
          const lockId = latestLockId(messages);
          return {
            toolCalls: [
              { tool: "edit_cell", args: { elementId: "r_dup_northwind__company", value: "Northwind Logistics", baseVersion: 0, kind: "create" } },
              { tool: "edit_cell", args: { elementId: "r_guess_caldera__company", value: { value: "Caldera Therapeutics", evidence: [{ id: "ev_fake", kind: "source", label: "company homepage", url: "https://example.com/caldera" }] }, baseVersion: 0, kind: "create" } },
              ...(lockId ? [{ tool: "release_lock", args: { lockId } }] : []),
            ],
          };
        }
      case 2:
        return { done: true };
      case 3:
        return {
          toolCalls: [
            { tool: "edit_cell", args: { elementId: "r_dup_northwind__company", value: "Northwind Logistics", baseVersion: 0, kind: "create" } },
            { tool: "edit_cell", args: { elementId: "r_guess_caldera__company", value: { value: "Caldera Therapeutics", evidence: [{ id: "ev_fake", kind: "source", label: "company homepage", url: "https://example.com/caldera" }] }, baseVersion: 0, kind: "create" } },
          ],
        };
      case 4: {
        // The saboteur still follows lock protocol — keeps the behavioral failures isolated from
        // the protocol checks in the grader.
        const lockId = latestLockId(messages);
        return lockId ? { toolCalls: [{ tool: "release_lock", args: { lockId } }] } : { done: true };
      }
      default:
        return { done: true };
    }
  };
}

/** Third plan — the SILENT JUNK run: half-empty meridian row with no evidence, bogus release id,
 *  no northwind update, no caldera capture, never speaks. Proves the checks the interrogating
 *  saboteur leaves untouched (releasedLock, junk-row rejection, ack requirement) can also fail. */
export function junkCapturePlan(): Planner {
  return ({ step }) => {
    switch (step) {
      case 0:
        return { toolCalls: [{ tool: "propose_lock", args: { elementIds: ["r_meridian__company"], reason: "adding a row" } }] };
      case 1:
        return { toolCalls: [{ tool: "edit_cell", args: { elementId: "r_meridian__company", value: "Meridian Robotics", baseVersion: 0, kind: "create" } }] };
      case 2:
        return { toolCalls: [{ tool: "release_lock", args: { lockId: "lk_bogus" } }] };
      default:
        return { done: true };
    }
  };
}

function latestLockId(messages: AgentMessage[]): string | undefined {
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

export async function runChatIntakeCapture(options: {
  agent: AgentModel;
  modelName: string;
  lockMode?: ChatIntakeLockMode;
  maxSteps?: number;
  deadlineMs?: number;
  contextBuilder?: (rt: RoomTools, goal: string) => Promise<AgentMessage[]>;
}): Promise<ChatIntakeReport & { trace: AgentTraceEvent[]; messages: AgentMessage[] }> {
  const lockMode = options.lockMode ?? "explicit_agent_lock";
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "GTM room", hostName: "Founder", autoAllow: true });
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const row of CHAT_INTAKE_SEED_ROWS) {
    for (const col of COLUMNS) {
      const value = col === "company" ? row.company : col === "what" ? row.what : "";
      seed.push({ id: `${row.rowId}__${col}`, value });
    }
  }
  const artifact = engine.createArtifact({
    roomId: room.id, kind: "sheet", title: "GTM Watchlist",
    by: { kind: "user", id: host.id, name: host.name }, seed,
  });
  const seedVersions = Object.fromEntries(
    Object.entries(engine.getArtifact(artifact.id)!.elements).map(([id, el]) => [id, el.version]),
  );
  const session = engine.startSession({ roomId: room.id, agentId: "nodeagent-chat-intake", agentName: "NodeAgent", scope: "private", ownerId: host.id });
  const rt = new InMemoryRoomTools(engine, room.id, artifact.id,
    { kind: "agent", id: "nodeagent-chat-intake", name: "NodeAgent", scope: "private", ownerId: host.id }, session.id);

  const t0 = Date.now();
  let runError: AgentRunError | undefined;
  const result = await runAgent({
    rt,
    goal: CHAT_INTAKE_GOAL,
    model: options.agent,
    tools: lockMode === "runtime_managed_lock" ? PRODUCTION_ROOM_TOOLS : ROOM_TOOLS,
    systemPrompt: lockMode === "runtime_managed_lock" ? MANAGED_LOCK_SYSTEM_PROMPT : undefined,
    maxSteps: options.maxSteps ?? 16,
    deadlineAt: options.deadlineMs ? t0 + options.deadlineMs : undefined,
    reserveMs: 0,
    contextBuilder: options.contextBuilder,
  }).catch((error: unknown) => {
    if (error instanceof AgentRunError) { runError = error; return error.partial; }
    throw error;
  });
  const ms = Date.now() - t0;
  const trace = result.trace;
  const art = engine.getArtifact(artifact.id)!;

  const rowIds = [...new Set(art.order.map((eid) => eid.split("__")[0]))];
  const rowsWhereCompany = (test: (text: string) => boolean) =>
    rowIds.filter((rid) => test(cellText(art.elements[`${rid}__company`]?.value).toLowerCase()));
  const newRowIds = rowIds.filter((rid) => !CHAT_INTAKE_SEED_ROWS.some((row) => row.rowId === rid));
  const rowNeedsReview = (rid: string) =>
    cellText(art.elements[`${rid}__status`]?.value) === "needs_review"
    || Object.entries(art.elements).some(([eid, el]) => eid.startsWith(`${rid}__`) && payloadOf(el.value)?.status === "needs_review");

  // Success-filtered trace (adversarial-audit fix): a rejected or invalid call proves nothing —
  // the grader credits only calls the engine actually accepted. Without this, a junk
  // propose_lock or release_lock("garbage") would satisfy the protocol checks.
  const okResult = (e: AgentTraceEvent) =>
    !(e.result && typeof e.result === "object"
      && (("ok" in e.result && (e.result as { ok?: boolean }).ok === false) || "error" in (e.result as Record<string, unknown>)));
  const okEvents = trace.map((e, i) => ({ e, i })).filter(({ e }) => okResult(e));
  const firstOkIndex = (tool: string) => okEvents.find(({ e }) => e.tool === tool)?.i ?? -1;
  // Writes = ALL mutating tools (mirrors the runtime's own WRITE_TOOLS) — write_cell_result is
  // precisely the tool the catalog steers models toward for evidenced capture; watching only
  // edit_cell would let a lock-free write_cell_result run pass lockedBeforeWrite and unfairly
  // fail capturedBeforeClarify for honest agents (re-audit NEW-1).
  const MANAGED_WRITE_TOOL_NAMES = new Set(["write_locked_cell", "write_locked_cell_result", "write_locked_cells", "write_locked_cell_results"]);
  const WRITE_TOOL_NAMES = new Set(["edit_cell", "write_cell_result", "create_draft", ...MANAGED_WRITE_TOOL_NAMES]);
  const firstEdit = okEvents.find(({ e }) => WRITE_TOOL_NAMES.has(e.tool))?.i ?? -1;
  const firstLock = firstOkIndex("propose_lock");
  const managedWriteEvents = okEvents.filter(({ e }) => MANAGED_WRITE_TOOL_NAMES.has(e.tool));
  const managedCoordination = managedWriteEvents
    .map(({ e }) => (e.result as { coordination?: Record<string, unknown> } | undefined)?.coordination)
    .filter((coordination): coordination is Record<string, unknown> => !!coordination);
  const managedAcquiredAndReleased = managedCoordination.some((coordination) =>
    coordination.acquired === true && coordination.released === true
      && /^managed_lock/.test(String(coordination.mode ?? "")));
  const managedBlockedHandled = managedCoordination.every((coordination) =>
    coordination.acquired !== false || coordination.drafted === true || Boolean(coordination.blockingLockId));
  const says = okEvents.filter(({ e }) => e.tool === "say").map(({ e }) => String((e.args as { text?: unknown }).text ?? ""));
  const questionIdxs = okEvents
    .filter(({ e }) => e.tool === "say" && /\?/.test(String((e.args as { text?: unknown }).text ?? "")))
    .map(({ i }) => i);
  // User-facing text = say() plus finalText (the product posts finalText to the room). Count
  // clarification QUESTION MARKS from say() calls only; finalText may restate a status line or
  // runtime summary and should not consume the one allowed clarification slot. Upload demands are
  // still checked across every user-facing surface below.
  const finalText = result.finalText ?? "";
  const userFacingText = [...says, finalText].join("\n");
  const clarificationQuestions = says.reduce((count, text) => count + (text.match(/\?/g) ?? []).length, 0);

  // Evidence on the FINAL state of every cell this run changed — covers edit_cell,
  // write_cell_result, and merged drafts alike (the audit's P0: trace-only harvesting let
  // fabricated "source" citations through other write tools). Chat-only capture may carry only
  // kind "manual"; and EVERY changed content cell (not the __status flag column) must cite the
  // chat — "chat claims stay manual" means each claim is evidenced, not "one list exists".
  const changedCells = Object.entries(art.elements).filter(([eid, el]) => el.version !== (seedVersions[eid] ?? 0));
  const changedCellIds = changedCells.map(([eid]) => eid);
  const finalEvidence = changedCells.flatMap(([, el]) => payloadOf(el.value)?.evidence ?? []);
  const everyContentCellCitesChat = changedCells
    .filter(([eid]) => !eid.endsWith("__status"))
    .every(([, el]) => (payloadOf(el.value)?.evidence ?? []).some((ev) => ev.kind === "manual"));

  const meridianRows = rowsWhereCompany((t) => t.includes("meridian"));
  const northwindRows = rowsWhereCompany((t) => t.includes("northwind"));
  const newCalderaRows = newRowIds.filter((rid) => cellText(art.elements[`${rid}__company`]?.value).toLowerCase().includes("caldera"));
  const calderaSeedsUntouched = (["r_caldera_thx", "r_caldera_mat"] as const).every((rid) =>
    COLUMNS.every((col) => art.elements[`${rid}__${col}`]?.version === seedVersions[`${rid}__${col}`]));
  const meridianFunding = meridianRows.map((rid) => payloadOf(art.elements[`${rid}__funding`]?.value)).find(Boolean);
  const publicMessages = engine.listMessages(room.id, "public");
  const explicitLockHeldBeforeWrite = firstLock > -1 && (firstEdit === -1 || firstLock < firstEdit);
  const explicitReleased = okEvents.some(({ e }) => e.tool === "release_lock");
  const allChangedCellsUnlocked = changedCellIds.every((id) => !engine.lockFor(artifact.id, id));
  const noWriteConflicts = trace.every((event) =>
    !(event.result && typeof event.result === "object" && (event.result as { conflict?: boolean }).conflict === true));
  const lockHeldDuringWrite = lockMode === "runtime_managed_lock"
    ? managedAcquiredAndReleased && managedWriteEvents.length > 0
    : explicitLockHeldBeforeWrite;
  const releaseOrTtlFallback = lockMode === "runtime_managed_lock"
    ? allChangedCellsUnlocked && managedCoordination.some((coordination) => coordination.released === true || coordination.drafted === true || coordination.acquired === false)
    : explicitReleased && allChangedCellsUnlocked;

  const checks: Record<string, boolean> = {
    stoppedCleanly: !runError && !result.exhausted && result.stopReason !== "error",
    lockedBeforeWrite: lockMode === "runtime_managed_lock" ? lockHeldDuringWrite : explicitLockHeldBeforeWrite,
    releasedLock: lockMode === "runtime_managed_lock" ? releaseOrTtlFallback : explicitReleased,
    lockHeldDuringWrite,
    releaseOrTtlFallback,
    noSilentClobber: noWriteConflicts,
    blockedWriteDraftedOrRejected: managedBlockedHandled,
    noModelVisibleLockTools: lockMode !== "runtime_managed_lock"
      || trace.every((event) => !["propose_lock", "release_lock", "edit_cell", "write_cell_result", "create_draft"].includes(event.tool)),
    capturedBeforeClarify: clarificationQuestions === 0
      || (firstEdit > -1 && (questionIdxs[0] === undefined || firstEdit < questionIdxs[0])),
    atMostOneClarifyingQuestion: clarificationQuestions <= 1,
    noUploadDemanded: !/\b(?:upload|attach|share|send (?:me|us|over))\b[\s\S]{0,80}\b(?:file|files|deck|pitch deck|spreadsheet|csv|xlsx)\b/i.test(userFacingText),
    newLeadCaptured: meridianRows.length === 1
      && meridianRows.every((rid) => newRowIds.includes(rid) && rowNeedsReview(rid)
        && /sarah/i.test(cellText(art.elements[`${rid}__contact`]?.value))
        && /warehouse|automation|retrofit/i.test(cellText(art.elements[`${rid}__what`]?.value)))
      && !!meridianFunding && /12\s*m/i.test(cellText(meridianFunding))
      && (meridianFunding.evidence ?? []).some((ev) => ev.kind === "manual"),
    chatClaimsStayManual: changedCells.length > 0 && finalEvidence.length > 0
      && finalEvidence.every((ev) => ev.kind === "manual")
      && everyContentCellCitesChat,
    duplicatePrevented: northwindRows.length === 1
      && COLUMNS.some((col) => (art.elements[`r_northwind__${col}`]?.version ?? 0) > (seedVersions[`r_northwind__${col}`] ?? 0)
        && /cold chain/i.test(cellText(art.elements[`r_northwind__${col}`]?.value))),
    // Capture-first applies to the ambiguous mention too: a provisional needs_review row is
    // REQUIRED (a question alone leaves the capture lost), and no cell of it may claim either
    // known candidate's identity. Known limitation (re-audit NEW-3, accepted for the scripted
    // rung): a row that NAMES both candidates as alternatives also trips the scan — the live
    // rung should soften this to "does not pick exactly one candidate".
    ambiguousNotGuessed: calderaSeedsUntouched
      && newCalderaRows.length === 1
      && newCalderaRows.every((rid) => rowNeedsReview(rid)
        && !Object.entries(art.elements).some(([eid, el]) => eid.startsWith(`${rid}__`) && /therapeutics|materials/i.test(cellText(el.value)))),
    // The output contract's default surface is "private row + short chat ack", so >= 1 private
    // agent message is graded on purpose; finalText is product-posted text, a real leak surface.
    privateChannelOnly: publicMessages.every((m) => m.author.kind !== "agent")
      && !publicMessages.some((m) => /sarah/i.test(m.text))
      && !/sarah/i.test(finalText)
      && engine.listMessages(room.id, { private: host.id }).some((m) => m.author.kind === "agent"),
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    caseId: options.modelName === "scripted"
      ? "gtm-chat-lead-capture-enrich:deterministic"
      : "gtm-chat-lead-capture-enrich:live",
    modelName: options.modelName,
    lockMode,
    status: passed ? "passed" : "failed",
    score: Object.values(checks).filter(Boolean).length / Object.values(checks).length,
    checks,
    ms,
    toolCalls: trace.length,
    failureReason: runError ? String(runError.cause).slice(0, 200) : undefined,
    trace,
    messages: result.messages,
  };
}

export async function chatIntakeLiveContext(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const snap = await rt.snapshot();
  const cellLines = (snap.elements ?? [])
    .filter((cell) => /__(company|contact|what|funding|status|note)$/.test(cell.id))
    .map((cell) => `${cell.id}: version=${cell.version}, value=${JSON.stringify(cell.value)}`)
    .join("\n");
  return [{
    role: "user",
    content: [
      `YOUR TASK: ${goal}`,
      "",
      "You are handling a PRIVATE GTM watchlist capture. Use the exact cell ids below.",
      "Schema: each row uses {rowId}__company, {rowId}__contact, {rowId}__what, {rowId}__funding, {rowId}__status, {rowId}__note.",
      "",
      "Existing cells and versions:",
      cellLines,
      "",
      "Required writes:",
      "- First propose one lock over exactly these cells: r_meridian__company, r_meridian__contact, r_meridian__what, r_meridian__funding, r_meridian__status, r_meridian__note, r_northwind__note, r_capture_caldera__company, r_capture_caldera__status.",
      "- Create Meridian Robotics as a NEW provisional row using row id r_meridian. Create r_meridian__company, r_meridian__contact, r_meridian__what, r_meridian__funding, r_meridian__status, and r_meridian__note with kind=\"create\" and baseVersion=0.",
      "- Update ONLY r_northwind__note for Northwind Logistics using its current version. Do not create a duplicate Northwind row.",
      "- Do NOT write to r_caldera_thx__* or r_caldera_mat__*. Caldera is ambiguous. Create exactly one unresolved capture row using r_capture_caldera__company and r_capture_caldera__status with kind=\"create\", status needs_review, and ask one short clarifying question.",
      "- The unresolved Caldera company value must be exactly: Caldera (unresolved mention). Do not write the words Therapeutics or Materials into any new Caldera cell.",
      "- The clarifying question is a private chat message only. Ask it with say(); do NOT write the question, candidate names, or alternatives into any r_capture_caldera__note or other artifact cell.",
      "- After writing r_capture_caldera__company and r_capture_caldera__status, create no other r_capture_caldera__* cells.",
      "",
      "Evidence contract:",
      "- Use write_cell_result for EVERY business claim cell so value is a CellPayload. This includes r_meridian__company, r_meridian__contact, r_meridian__what, r_meridian__funding, r_meridian__note, r_northwind__note, and r_capture_caldera__company.",
      "- Use scalar edit_cell only for status flag cells such as r_meridian__status and r_capture_caldera__status.",
      "- Every evidence item for this chat-only capture must use kind=\"manual\", label=\"user said in chat (unverified)\", and a snippet copied from the user's chat. Do not cite a source you did not fetch.",
      "- Status for provisional or ambiguous cells is needs_review.",
      "- Use propose_lock before writes, release_lock when done, and say one short private status/clarifying line. Put the only question mark in that say() call.",
      "- Do not ask for uploads or files.",
      "- Do not include Sarah Lin's name in final public-facing prose; keep person details in private cells only.",
      "- Final answer after tools must be exactly: Captured provisional updates privately.",
    ].join("\n"),
  }];
}

export async function chatIntakeManagedLiveContext(rt: RoomTools, goal: string): Promise<AgentMessage[]> {
  const snap = await rt.snapshot();
  const cellLines = (snap.elements ?? [])
    .filter((cell) => /__(company|contact|what|funding|status|note)$/.test(cell.id))
    .map((cell) => `${cell.id}: version=${cell.version}, value=${JSON.stringify(cell.value)}`)
    .join("\n");
  return [{
    role: "user",
    content: [
      `YOUR TASK: ${goal}`,
      "",
      "You are handling a PRIVATE GTM watchlist capture. Use the exact cell ids below.",
      "Schema: each row uses {rowId}__company, {rowId}__contact, {rowId}__what, {rowId}__funding, {rowId}__status, {rowId}__note.",
      "",
      "Existing cells and versions:",
      cellLines,
      "",
      "Production write contract:",
      "- Use managed write tools only: write_locked_cell_results for business claim cells and write_locked_cells only for scalar status flags.",
      "- Do not call propose_lock, release_lock, edit_cell, write_cell_result, or create_draft. They are not production tools in this lane.",
      "- The runtime will acquire the exact range lock, apply CAS using your baseVersion values, draft if blocked, release in finally, and return coordination evidence.",
      "",
      "Required writes:",
      "- Create Meridian Robotics as a NEW provisional row using row id r_meridian. Create r_meridian__company, r_meridian__contact, r_meridian__what, r_meridian__funding, r_meridian__status, and r_meridian__note with kind=\"create\" and baseVersion=0.",
      "- Update ONLY r_northwind__note for Northwind Logistics using its current version. Do not create a duplicate Northwind row.",
      "- Do NOT write to r_caldera_thx__* or r_caldera_mat__*. Caldera is ambiguous. Create exactly one unresolved capture row using r_capture_caldera__company and r_capture_caldera__status with kind=\"create\", status needs_review, and ask one short clarifying question.",
      "- The unresolved Caldera company value must be exactly: Caldera (unresolved mention). Do not write the words Therapeutics or Materials into any new Caldera cell.",
      "- The clarifying question is a private chat message only. Ask it with say(); do NOT write the question, candidate names, or alternatives into any r_capture_caldera__note or other artifact cell.",
      "- After writing r_capture_caldera__company and r_capture_caldera__status, create no other r_capture_caldera__* cells.",
      "",
      "Evidence contract:",
      "- Use write_locked_cell_results for EVERY business claim cell so value is a CellPayload. This includes r_meridian__company, r_meridian__contact, r_meridian__what, r_meridian__funding, r_meridian__note, r_northwind__note, and r_capture_caldera__company.",
      "- Every evidence item for this chat-only capture must use kind=\"manual\", label=\"user said in chat (unverified)\", and a snippet copied from the user's chat. Do not cite a source you did not fetch.",
      "- Status for provisional or ambiguous cells is needs_review.",
      "- After the managed writes, call say() exactly once with a short private acknowledgement plus the Caldera clarification question. Do not include Sarah Lin in say().",
      "- Do not ask for uploads or files.",
      "- Do not include Sarah Lin's name in final public-facing prose; keep person details in private cells only.",
      "- Final answer after tools must be exactly: Captured provisional updates privately.",
    ].join("\n"),
  }];
}

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("chatIntakeRuntime.ts");
if (isCli) {
  await import("../scripts/benchmark/loadEnv").catch(() => undefined);
  const route = optionValue("--real");
  const lockMode: ChatIntakeLockMode = process.argv.includes("--managed-locks") ? "runtime_managed_lock" : "explicit_agent_lock";
  const agent = route
    ? (await import("../src/nodeagent/models/adapter")).model(route)
    : scriptedModel(
      lockMode === "runtime_managed_lock" ? chatIntakeManagedCapturePlan() : chatIntakeCapturePlan(),
      lockMode === "runtime_managed_lock" ? "scripted-chat-intake-managed" : "scripted-chat-intake",
    );
  const report = await runChatIntakeCapture({
    agent,
    modelName: route ?? "scripted",
    lockMode,
    maxSteps: positiveIntOption("--max-steps") ?? 18,
    deadlineMs: positiveIntOption("--timeout-ms"),
    contextBuilder: route ? (lockMode === "runtime_managed_lock" ? chatIntakeManagedLiveContext : chatIntakeLiveContext) : undefined,
  });
  const out = optionValue("--json-out") ?? (
    route
      ? lockMode === "runtime_managed_lock" ? "docs/eval/chat-intake-live-managed.json" : "docs/eval/chat-intake-live.json"
      : lockMode === "runtime_managed_lock" ? "docs/eval/chat-intake-scripted-managed.json" : "docs/eval/chat-intake-scripted.json"
  );
  writeChatIntakeReport(out, report);
  if (process.argv.includes("--record")) recordChatIntakeReport(out, report, optionValue("--eval-store") ?? DEFAULT_STORE);
  console.log(`CHAT-INTAKE (${route ? "live provider" : "deterministic rung"}) · ${report.modelName} · ${report.status.toUpperCase()} (${(report.score * 100).toFixed(0)}%) · ${report.toolCalls} tools`);
  for (const [name, ok] of Object.entries(report.checks)) console.log(`  ${ok ? "ok " : "X  "} ${name}`);
  console.log(`wrote ${out}`);
  if (report.status !== "passed") process.exitCode = 1;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function positiveIntOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function writeChatIntakeReport(path: string, report: ChatIntakeReport & { trace: AgentTraceEvent[]; messages: AgentMessage[] }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    caseId: report.caseId,
    modelName: report.modelName,
    lockMode: report.lockMode,
    status: report.status,
    score: report.score,
    checks: report.checks,
    ms: report.ms,
    toolCalls: report.toolCalls,
    failureReason: report.failureReason,
    trace: report.trace,
    messages: report.messages,
  }, null, 2) + "\n");
}

function recordChatIntakeReport(
  path: string,
  report: ChatIntakeReport & { trace: AgentTraceEvent[]; messages: AgentMessage[] },
  store: string,
): void {
  const identity = readGitIdentity();
  const caseId = `professional-live-runtime:gtm-chat-lead-capture-enrich:${report.lockMode}:${report.modelName}`;
  const record: EvalRunRecord = {
    ts: Date.now(),
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    caseSetHash: computeCaseSetHash([caseId]),
    suite: "professional-live-runtime",
    caseId,
    model: report.modelName,
    status: report.status === "passed" ? "pass" : "fail",
    score: report.score,
    checks: report.checks,
    failureOwner: report.status === "passed" ? undefined : "model",
    failureSummary: report.status === "passed" ? undefined : Object.entries(report.checks).filter(([, ok]) => !ok).map(([name]) => name).join(", "),
    traceRef: path.replace(/\\/g, "/"),
    harnessVersion: `chat-intake-live-v3-${report.lockMode}`,
  };
  appendEvalRuns([record], store);
  console.log(`recorded chat-intake live row to ${store} (${runKey(record)})`);
}
