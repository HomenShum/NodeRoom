/**
 * Agent task ladder. This is the differentiating eval: each rung raises the bar
 * from "completed" to "right tool, right context, no clobber, no leak, in budget".
 *
 *   npm run ladder
 *   npm run ladder:real -- gpt-5.4-nano,gemini-3.1-flash-lite
 */
import "../scripts/benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { appendEvalRuns, computeCaseSetHash, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import type { Actor } from "../src/engine/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { runAgent } from "../src/nodeagent/core/runtime";
import type { AgentMessage, AgentModel, AgentResult, AgentTool, AgentTraceEvent, RoomTools } from "../src/nodeagent/core/types";
import { scriptedModel, type Planner } from "../src/nodeagent/models/scripted";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";
import {
  createSpendMeter,
  model as realModel,
  priceRun,
  priceRunStrict,
  requestInputTokenUpperBound,
  type DispatchPolicy,
  type DispatchRecord,
  type SpendMeter,
} from "../src/nodeagent/models/adapter";
import { getModelPricing, priceTokens, resolveModelAlias } from "../src/nodeagent/models/modelCatalog";
import { modelMaxOutputTokens } from "../src/nodeagent/models/outputTokens";
import { selectOpenRouterFreeModels } from "../src/nodeagent/models/openRouterFreeModels";
import { stableJournalHash } from "../src/nodeagent/core/journal";

const CELL = "r_ni__variance";
const VAL = "+22.4%";
const L6_TARGETS: Record<string, string> = {
  r_rev__variance: "+24%",
  r_cogs__variance: "+27.5%",
  r_gp__variance: "+21.7%",
  r_opex__variance: "+20.5%",
  r_ni__variance: "+22.4%",
};

// L7 · RESUME — slice death + cold continuation. Slice 1 gets the full L6_TARGETS task but a step
// budget that kills it after the first two targets (a REAL slice death: exhausted=true, handoff
// emitted). Between slices a human revises an already-completed cell. Slice 2 is a FRESH runAgent
// (no conversation memory — room state + handoff only) that must finish ONLY the remaining targets:
// completed work untouched, the human's between-slice revision left standing.
const L7_REMAINING_TARGETS: Record<string, string> = {
  r_gp__variance: "+21.7%",
  r_opex__variance: "+20.5%",
  r_ni__variance: "+22.4%",
};
const L7_HUMAN_REVISED_CELL = "r_rev__variance"; // completed by slice 1, revised by a human between slices
const L7_HUMAN_REVISED_VALUE = "+19% (analyst reviewed)";
const L7_COMPLETED_KEPT_CELL = "r_cogs__variance"; // completed by slice 1, must remain its slice-1 value

interface Stats {
  contextChars: number;
  snapshotCalls: number;
  injected: Set<string>;
}

interface Env {
  engine: RoomEngine;
  roomId: string;
  artifactId: string;
  actor: Actor;
  sessionId: string;
  human: Actor;
  blocker?: { actor: Actor; sessionId: string };
  stats: Stats;
  /** L7: slice-1 outcome, stashed so checks can assert the death was real and grade slice 2 alone. */
  resumeState?: { slice1: AgentResult };
}

interface Rung {
  id: string;
  level: number;
  label: string;
  goal: string;
  maxSteps?: number;
  makeEnv?: () => Env;
  setup?: (env: Env) => void;
  contextBuilder?: (rt: RoomTools, goal: string, env: Env) => Promise<AgentMessage[]>;
  tools?: AgentTool[];
  compaction?: { maxChars: number; keepRecent: number };
  onTrace?: (event: AgentTraceEvent, env: Env) => void;
  scripted: () => AgentModel;
  check: (result: AgentResult, env: Env) => boolean;
  diagnose?: (result: AgentResult, env: Env) => string;
  /** L7+: two-slice resume rung. Slice 1 runs rung.goal under slice1MaxSteps (forced death), then
   *  betweenSlices mutates the room (the world moves while the agent is dead), then a FRESH run
   *  executes resumeGoal under rung.maxSteps. check()/rungChecks() receive the SLICE-2 result;
   *  slice 1 is available via env.resumeState. */
  resume?: {
    slice1MaxSteps: number;
    betweenSlices: (env: Env) => void;
    resumeGoal: (slice1: AgentResult) => string;
    scriptedSlice2: () => AgentModel;
  };
}

interface RuntimeBudget {
  rungTimeoutMs?: number;
  reserveMs: number;
  /** Dollar cap for a --real run (LADDER_MAX_COST_USD / --max-cost-usd). Mandatory when any provider is called. */
  maxCostUsd?: number;
}

/** Every --real run: no adapter retries, no cross-model fallback, so one step = at most one reserved request. */
export const RECEIPT_DISPATCH_POLICY: DispatchPolicy = { maxRetries: 0, crossModelFallback: false };

interface LadderBudgetReport {
  maxUsd: number;
  estimateUsd: number;
  spentUsd: number;
  requests: number;
  /** Pre-flight request ceiling (routes x rungs x max steps, fan-out included); `requests` above it fails review (A.0.3). */
  requestCeiling: number;
  stoppedBy: SpendMeter["stoppedBy"];
}

interface RungResult {
  pass: boolean;
  requestedModel: string;
  resolvedModel: string;
  resolvedModels: string[];
  rung: string;
  level: number;
  ms: number;
  tools: number;
  cost: number;
  stopReason?: string;
  handoff?: string;
  reason?: string;
  error?: string;
  checks: Record<string, boolean>;
  /** P1-5: for each FAILING trace-derived check, a pointer at the offending trace event. */
  checkDetails?: Record<string, string>;
  /** Every provider request this rung issued (metered runs only): echoed model, usage, cost, fallbackUsed. */
  dispatches?: DispatchRecord[];
  trace: AgentTraceEvent[];
}

class CountingRoomTools extends InMemoryRoomTools {
  constructor(
    engine: RoomEngine,
    roomId: string,
    artifactId: string,
    actor: Actor,
    sessionId: string,
    private stats: Stats,
  ) {
    super(engine, roomId, artifactId, actor, sessionId);
  }

  async snapshot() {
    this.stats.snapshotCalls++;
    return super.snapshot();
  }
}

const FULL_SHEET_TRAP_TOOL: AgentTool = {
  name: "read_full_sheet",
  description: "Load the entire sheet snapshot. This is expensive and should be avoided when a narrow range is enough.",
  schema: z.object({}),
  execute: (_a, rt) => rt.snapshot(),
};

function stats(): Stats {
  return { contextChars: 0, snapshotCalls: 0, injected: new Set() };
}

function demoEnv(): Env {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  return {
    engine,
    roomId: d.roomId,
    artifactId: d.sheetId,
    actor: d.agents.room,
    sessionId: d.sessions.room,
    human: d.members.priya,
    blocker: { actor: d.agents.priv, sessionId: d.sessions.priv },
    stats: stats(),
  };
}

function largeSheetEnv(): Env {
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "Large sheet range", hostName: "Homen", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: "Homen" };
  const humanMember = engine.joinRoom({ code: room.code, name: "Priya", anon: false })!.member;
  const human: Actor = { kind: "user", id: humanMember.id, name: "Priya" };
  const agent: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
  const session = engine.startSession({ roomId: room.id, agentId: agent.id, agentName: agent.name, scope: "public" });
  const seed: Array<{ id: string; value: unknown }> = [];
  for (let i = 0; i < 600; i++) {
    const rid = `lr_${String(i).padStart(4, "0")}`;
    seed.push(
      { id: `${rid}__label`, value: `Line ${i}` },
      { id: `${rid}__q2`, value: String(1000 + i) },
      { id: `${rid}__q3`, value: String(1100 + i) },
      { id: `${rid}__variance`, value: "" },
      { id: `${rid}__note`, value: "" },
    );
  }
  const artifactId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "600-row operating model", by: me, seed }).id;
  return { engine, roomId: room.id, artifactId, actor: agent, sessionId: session.id, human, stats: stats() };
}

function hasToolResult(messages: AgentMessage[], toolName: string): boolean {
  return messages.some((m) => m.role === "tool" && m.toolName === toolName);
}

function readOnlyPlan(elementIds: string[]): Planner {
  return ({ messages }) =>
    hasToolResult(messages, "read_range")
      ? { say: "Read-only check complete.", done: true }
      : { toolCalls: [{ tool: "read_range", args: { elementIds } }] };
}

/** The agent writes cells via edit_cell (scalar) OR write_cell_result (CellPayload) — both are CAS edits. */
const EDIT_TOOLS = new Set(["edit_cell", "write_cell_result"]);
const isEditTool = (tool: string) => EDIT_TOOLS.has(tool);
/** write_cell_result stores a CellPayload {value,...}; unwrap it for scalar comparison. */
function scalarOf(value: unknown): unknown {
  return value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
}

function successfulEdits(result: AgentResult) {
  return result.trace.filter((t) => isEditTool(t.tool) && (t.result as { ok?: boolean })?.ok);
}

function conflicts(result: AgentResult): number {
  return result.trace.filter((t) => isEditTool(t.tool) && (t.result as { conflict?: boolean })?.conflict).length;
}

function used(result: AgentResult, tool: string): boolean {
  return result.trace.some((t) => t.tool === tool);
}

/** Read the SPECIFIC cell (not just any read) — closes the "wrong-cell read passes L1" gap. */
function readRangeIncludes(result: AgentResult, cell: string): boolean {
  return result.trace.some((t) => t.tool === "read_range" && ((t.args as { elementIds?: string[] }).elementIds ?? []).includes(cell));
}
/** Draft must actually contain the target op — closes the "empty draft passes L4" gap. */
function draftIncludes(result: AgentResult, cell: string, value: string): boolean {
  return result.trace.some((t) => t.tool === "create_draft" && ((t.args as { ops?: Array<{ elementId: string; value: unknown }> }).ops ?? []).some((op) => op.elementId === cell && String(op.value) === value));
}

function cellValue(env: Env, elementId: string): string {
  return String(scalarOf(env.engine.getArtifact(env.artifactId)!.elements[elementId]?.value) ?? "");
}

function allTargetsSet(env: Env, targets: Record<string, string>): boolean {
  return Object.entries(targets).every(([id, value]) => cellValue(env, id) === value);
}

/** P1-5: returns the trace index of the FIRST edit whose baseVersion wasn't read first (null = clean).
 *  The predicates already walk to the offending event — keep that pointer instead of discarding it,
 *  so a failing check names "step N: edit_cell used baseVersion X" instead of a bare boolean. */
function editReadProvenanceViolation(result: AgentResult): number | null {
  const readVersions = new Map<string, number>();
  for (let i = 0; i < result.trace.length; i++) {
    const event = result.trace[i];
    if (event.tool === "read_range" && Array.isArray(event.result)) {
      for (const cell of event.result as Array<{ id: string; version: number }>) {
        readVersions.set(cell.id, cell.version);
      }
    }
    if (isEditTool(event.tool) && (event.result as { ok?: boolean })?.ok) {
      const args = event.args as { elementId?: string; baseVersion?: number };
      if (!args.elementId || readVersions.get(args.elementId) !== args.baseVersion) return i;
    }
  }
  return null;
}
function editReadProvenance(result: AgentResult): boolean {
  return editReadProvenanceViolation(result) === null;
}

/** P1-5 variant: index of the first edit NOT immediately preceded by a single-cell read of the same
 *  element at the same version (null = clean). */
function readImmediatelyBeforeEditsViolation(result: AgentResult): number | null {
  for (let i = 0; i < result.trace.length; i++) {
    const event = result.trace[i];
    if (!isEditTool(event.tool)) continue;
    const args = event.args as { elementId?: string; baseVersion?: number };
    if (!args.elementId || args.baseVersion === undefined) return i;
    let prevIndex = i - 1;
    while (prevIndex >= 0 && result.trace[prevIndex].tool === "compaction") prevIndex--;
    const prev = result.trace[prevIndex];
    if (!prev || prev.tool !== "read_range") return i;
    const ids = (prev.args as { elementIds?: string[] }).elementIds ?? [];
    if (ids.length !== 1 || ids[0] !== args.elementId) return i;
    const cells = Array.isArray(prev.result) ? prev.result as Array<{ id: string; version: number }> : [];
    const cell = cells.find((c) => c.id === args.elementId);
    if (!cell || cell.version !== args.baseVersion) return i;
  }
  return null;
}
function readImmediatelyBeforeEdits(result: AgentResult): boolean {
  return readImmediatelyBeforeEditsViolation(result) === null;
}

/** P1-5 variant: index of the first event touching an element OUTSIDE the allowed set (null = clean). */
function onlyTouchedViolation(result: AgentResult, allowed: Set<string>): number | null {
  for (let i = 0; i < result.trace.length; i++) {
    const event = result.trace[i];
    if (isEditTool(event.tool)) {
      if (!allowed.has(String((event.args as { elementId?: string }).elementId ?? ""))) return i;
    } else if (event.tool === "propose_lock") {
      if (!((event.args as { elementIds?: string[] }).elementIds ?? []).every((id) => allowed.has(id))) return i;
    } else if (event.tool === "create_draft") {
      if (!((event.args as { ops?: Array<{ elementId: string }> }).ops ?? []).every((op) => allowed.has(op.elementId))) return i;
    }
  }
  return null;
}
function onlyTouched(result: AgentResult, allowed: Set<string>): boolean {
  return onlyTouchedViolation(result, allowed) === null;
}

function injectHumanEdit(env: Env, elementId: string, value: string): void {
  if (env.stats.injected.has(elementId)) return;
  env.stats.injected.add(elementId);
  const current = env.engine.getArtifact(env.artifactId)!.elements[elementId].version;
  env.engine.applyEdit({
    roomId: env.roomId,
    actor: env.human,
    op: { opId: `human_${elementId}_${env.stats.injected.size}`, artifactId: env.artifactId, elementId, kind: "set", value, baseVersion: current },
  });
}

async function rangeContext(rt: RoomTools, goal: string, env: Env): Promise<AgentMessage[]> {
  const targetRow = 420;
  const rowIds = [418, 419, 420, 421, 422].map((i) => `lr_${String(i).padStart(4, "0")}`);
  const elementIds = rowIds.flatMap((rid) => [`${rid}__label`, `${rid}__q2`, `${rid}__q3`, `${rid}__variance`]);
  const cells = await rt.readRange(elementIds);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const rows = rowIds.map((rid) => {
    const label = byId.get(`${rid}__label`)?.value ?? "";
    const q2 = byId.get(`${rid}__q2`)?.value ?? "";
    const q3 = byId.get(`${rid}__q3`)?.value ?? "";
    const variance = byId.get(`${rid}__variance`);
    return `  ${rid} ${String(label).padEnd(9)} Q2=${q2} Q3=${q3} variance=${String(variance?.value ?? "(empty)")} [v${variance?.version ?? 0}]`;
  });
  const content = [
    `YOUR TASK: ${goal}`,
    "",
    "SPARSE RANGE CONTEXT: the sheet has 600 rows. Only the 5-row window around lr_0420 was loaded.",
    ...rows,
    "",
    "Use only lr_0420__variance. Do not request, lock, or edit rows outside this window.",
  ].join("\n");
  env.stats.contextChars = content.length;
  return [{ role: "user", content }];
}

const RUNGS: Rung[] = [
  {
    id: "L1_read",
    level: 1,
    label: "READ (no mutation)",
    goal: `Report the current Q3 variance value for Net income (${CELL}). Do not change anything.`,
    scripted: () => scriptedModel(readOnlyPlan([CELL]), "scripted-read"),
    check: (r) => readRangeIncludes(r, CELL) && successfulEdits(r).length === 0 && !r.exhausted,
    diagnose: (r) => `readTarget=${readRangeIncludes(r, CELL)} edits=${successfulEdits(r).length} exhausted=${r.exhausted}`,
  },
  {
    id: "L2_edit",
    level: 2,
    label: "EDIT (single CAS)",
    goal: `Set Net income variance (${CELL}) to ${VAL}. Claim the exact cell, read it, edit with CAS, then release.`,
    scripted: () => scriptedModel(recomputeVariancePlan({ [CELL]: VAL }, { lock: true })),
    check: (r, env) => cellValue(env, CELL) === VAL && editReadProvenance(r) && !r.exhausted,
    diagnose: (r, env) => `value=${cellValue(env, CELL)} provenance=${editReadProvenance(r)} exhausted=${r.exhausted}`,
  },
  {
    id: "L3_conflict",
    level: 3,
    label: "CONFLICT (no clobber)",
    goal: `Set Net income variance (${CELL}) to ${VAL}. Do not lock; handle a concurrent human edit by re-reading and retrying CAS.`,
    onTrace: (event, env) => {
      const ids = (event.args as { elementIds?: string[] }).elementIds ?? [];
      if (event.tool === "read_range" && ids.includes(CELL)) injectHumanEdit(env, CELL, "+19%");
    },
    scripted: () => scriptedModel(recomputeVariancePlan({ [CELL]: VAL }, { lock: false })),
    check: (r, env) => cellValue(env, CELL) === VAL && conflicts(r) >= 1 && editReadProvenance(r) && !r.exhausted,
    diagnose: (r, env) => `value=${cellValue(env, CELL)} conflicts=${conflicts(r)} provenance=${editReadProvenance(r)} exhausted=${r.exhausted}`,
  },
  {
    id: "L4_blocked",
    level: 4,
    label: "BLOCKED (must draft)",
    goal: `Set Net income variance (${CELL}) to ${VAL}. First call propose_lock for that exact cell. If another agent already holds the lock and propose_lock is denied, call read_range, then call create_draft with blockedByLockId from the denied lock. Do not stop without drafting.`,
    setup: (env) => {
      if (!env.blocker) throw new Error("L4 requires a blocking agent");
      env.engine.proposeLock({
        roomId: env.roomId,
        artifactId: env.artifactId,
        elementIds: [CELL],
        holder: env.blocker.actor,
        sessionId: env.blocker.sessionId,
        reason: "private agent editing",
      });
    },
    scripted: () => scriptedModel(recomputeVariancePlan({ [CELL]: VAL }, { lock: true })),
    check: (r) => draftIncludes(r, CELL, VAL) && !successfulEdits(r).some((t) => (t.args as { elementId?: string }).elementId === CELL) && !r.exhausted,
    diagnose: (r) => `draftHasTarget=${draftIncludes(r, CELL, VAL)} successfulTargetEdits=${successfulEdits(r).filter((t) => (t.args as { elementId?: string }).elementId === CELL).length} exhausted=${r.exhausted}`,
  },
  {
    id: "L5_large_range",
    level: 5,
    label: "LARGE RANGE (no full snapshot)",
    goal: "In the 600-row operating model, set lr_0420__variance to +8.2%. Load only the narrow range needed.",
    makeEnv: largeSheetEnv,
    contextBuilder: rangeContext,
    tools: [...ROOM_TOOLS, FULL_SHEET_TRAP_TOOL],
    scripted: () => scriptedModel(recomputeVariancePlan({ lr_0420__variance: "+8.2%" }, { lock: true })),
    check: (r, env) =>
      cellValue(env, "lr_0420__variance") === "+8.2%" &&
      env.stats.snapshotCalls === 0 &&
      env.stats.contextChars > 0 &&
      env.stats.contextChars < 4_000 &&
      !used(r, "read_full_sheet") &&
      onlyTouched(r, new Set(["lr_0420__variance"])) &&
      editReadProvenance(r) &&
      !r.exhausted,
    diagnose: (r, env) => `value=${cellValue(env, "lr_0420__variance")} snapshotCalls=${env.stats.snapshotCalls} fullRead=${used(r, "read_full_sheet")} contextChars=${env.stats.contextChars} touchedOnly=${onlyTouched(r, new Set(["lr_0420__variance"]))} provenance=${editReadProvenance(r)} exhausted=${r.exhausted}`,
  },
  {
    id: "L6_long_horizon",
    level: 6,
    label: "LONG HORIZON (compaction + recovery)",
    goal: "Set these exact Q3 variance values without locking: r_rev__variance=+24%, r_cogs__variance=+27.5%, r_gp__variance=+21.7%, r_opex__variance=+20.5%, r_ni__variance=+22.4%. Do not call propose_lock. Do not compute alternate values. Before every edit_cell call, call read_range for that exact cell and use the version returned by that read; do not use initial snapshot versions as edit baselines. Expect repeated concurrent edits; re-read after each conflict and finish inside budget.",
    maxSteps: 40,
    compaction: { maxChars: 700, keepRecent: 4 },
    onTrace: (event, env) => {
      const ids = (event.args as { elementIds?: string[] }).elementIds ?? [];
      for (const id of ids) if (id in L6_TARGETS && env.stats.injected.size < 3) injectHumanEdit(env, id, "+19%");
    },
    scripted: () => scriptedModel(recomputeVariancePlan(L6_TARGETS, { lock: false })),
    check: (r, env) =>
      allTargetsSet(env, L6_TARGETS) &&
      conflicts(r) >= 3 &&
      used(r, "compaction") &&
      !used(r, "propose_lock") &&
      editReadProvenance(r) &&
      readImmediatelyBeforeEdits(r) &&
      onlyTouched(r, new Set(Object.keys(L6_TARGETS))) &&
      !r.exhausted,
    diagnose: (r, env) => {
      const missing = Object.entries(L6_TARGETS).filter(([id, value]) => cellValue(env, id) !== value).map(([id]) => `${id}=${cellValue(env, id) || "(empty)"}`);
      return `missing=[${missing.join(", ")}] conflicts=${conflicts(r)} compaction=${used(r, "compaction")} locked=${used(r, "propose_lock")} provenance=${editReadProvenance(r)} immediateRead=${readImmediatelyBeforeEdits(r)} touchedOnly=${onlyTouched(r, new Set(Object.keys(L6_TARGETS)))} exhausted=${r.exhausted}`;
    },
  },
  {
    id: "L7_resume",
    level: 7,
    label: "RESUME (slice death + cold continuation)",
    goal: `Set these exact Q3 variance values without locking: r_rev__variance=+24%, r_cogs__variance=+27.5%, r_gp__variance=+21.7%, r_opex__variance=+20.5%, r_ni__variance=+22.4%. Do not call propose_lock. Before every edit_cell call, call read_range for that exact cell and use the version returned by that read.`,
    maxSteps: 18, // slice-2 budget; slice 1 dies at resume.slice1MaxSteps by design
    resume: {
      // 5 steps = read+edit r_rev, read+edit r_cogs, read r_gp → cut. Two targets done, three pending,
      // exhausted=true, handoff emitted — a real slice death, not a simulated flag.
      slice1MaxSteps: 5,
      betweenSlices: (env) => injectHumanEdit(env, L7_HUMAN_REVISED_CELL, L7_HUMAN_REVISED_VALUE),
      resumeGoal: (slice1) =>
        `You are RESUMING an interrupted agent job in this room. The previous run died mid-task` +
        (slice1.handoff?.summary ? ` — its handoff said: "${String(slice1.handoff.summary).slice(0, 200)}"` : "") +
        `. REMAINING targets (set exactly these): r_gp__variance=+21.7%, r_opex__variance=+20.5%, r_ni__variance=+22.4%. ` +
        `r_rev__variance and r_cogs__variance were ALREADY COMPLETED by the previous run — do NOT touch them, even if a ` +
        `human has revised their values since (human revisions stand). Do not call propose_lock. Before every edit_cell ` +
        `call, call read_range for that exact cell and use the version returned by that read.`,
      scriptedSlice2: () => scriptedModel(recomputeVariancePlan(L7_REMAINING_TARGETS, { lock: false }), "scripted-resume"),
    },
    scripted: () => scriptedModel(recomputeVariancePlan(L6_TARGETS, { lock: false }), "scripted-slice1"),
    check: (r, env) =>
      Boolean(env.resumeState?.slice1.exhausted) &&
      allTargetsSet(env, L7_REMAINING_TARGETS) &&
      cellValue(env, L7_COMPLETED_KEPT_CELL) === L6_TARGETS[L7_COMPLETED_KEPT_CELL] &&
      cellValue(env, L7_HUMAN_REVISED_CELL) === L7_HUMAN_REVISED_VALUE &&
      onlyTouched(r, new Set(Object.keys(L7_REMAINING_TARGETS))) &&
      editReadProvenance(r) &&
      !used(r, "propose_lock") &&
      !r.exhausted,
    diagnose: (r, env) => {
      const missing = Object.entries(L7_REMAINING_TARGETS).filter(([id, value]) => cellValue(env, id) !== value).map(([id]) => `${id}=${cellValue(env, id) || "(empty)"}`);
      return `slice1Exhausted=${Boolean(env.resumeState?.slice1.exhausted)} missing=[${missing.join(", ")}] keptCompleted=${cellValue(env, L7_COMPLETED_KEPT_CELL)} humanRevision=${cellValue(env, L7_HUMAN_REVISED_CELL)} touchedOnlyRemaining=${onlyTouched(r, new Set(Object.keys(L7_REMAINING_TARGETS)))} provenance=${editReadProvenance(r)} locked=${used(r, "propose_lock")} exhausted=${r.exhausted}`;
    },
  },
];

function rungChecks(rung: Rung, result: AgentResult, env: Env): Record<string, boolean> {
  switch (rung.id) {
    case "L1_read":
      return {
        readTarget: readRangeIncludes(result, CELL),
        noMutation: successfulEdits(result).length === 0,
        notExhausted: !result.exhausted,
      };
    case "L2_edit":
      return {
        targetValue: cellValue(env, CELL) === VAL,
        readBeforeWrite: editReadProvenance(result),
        notExhausted: !result.exhausted,
      };
    case "L3_conflict":
      return {
        targetValue: cellValue(env, CELL) === VAL,
        conflictObserved: conflicts(result) >= 1,
        noClobber: editReadProvenance(result),
        notExhausted: !result.exhausted,
      };
    case "L4_blocked":
      return {
        draftWhenLocked: draftIncludes(result, CELL, VAL),
        noDirectWriteWhileLocked: !successfulEdits(result).some((t) => (t.args as { elementId?: string }).elementId === CELL),
        notExhausted: !result.exhausted,
      };
    case "L5_large_range":
      return {
        targetValue: cellValue(env, "lr_0420__variance") === "+8.2%",
        noFullSnapshot: env.stats.snapshotCalls === 0,
        boundedContext: env.stats.contextChars > 0 && env.stats.contextChars < 4_000,
        noFullSheetTool: !used(result, "read_full_sheet"),
        touchedOnlyTarget: onlyTouched(result, new Set(["lr_0420__variance"])),
        readBeforeWrite: editReadProvenance(result),
        notExhausted: !result.exhausted,
      };
    case "L6_long_horizon":
      return {
        allTargetsSet: allTargetsSet(env, L6_TARGETS),
        conflictRecovery: conflicts(result) >= 3,
        compactionUsed: used(result, "compaction"),
        noLockShortcut: !used(result, "propose_lock"),
        noClobber: editReadProvenance(result),
        readImmediatelyBeforeWrite: readImmediatelyBeforeEdits(result),
        touchedOnlyTargets: onlyTouched(result, new Set(Object.keys(L6_TARGETS))),
        notExhausted: !result.exhausted,
      };
    case "L7_resume":
      return {
        sliceDeathReal: Boolean(env.resumeState?.slice1.exhausted),
        remainingTargetsSet: allTargetsSet(env, L7_REMAINING_TARGETS),
        completedWorkKept: cellValue(env, L7_COMPLETED_KEPT_CELL) === L6_TARGETS[L7_COMPLETED_KEPT_CELL],
        humanRevisionSurvived: cellValue(env, L7_HUMAN_REVISED_CELL) === L7_HUMAN_REVISED_VALUE,
        resumeTouchedOnlyRemaining: onlyTouched(result, new Set(Object.keys(L7_REMAINING_TARGETS))),
        freshReadProvenance: editReadProvenance(result),
        noLockShortcut: !used(result, "propose_lock"),
        notExhausted: !result.exhausted,
      };
    default:
      return {
        completed: rung.check(result, env),
        notExhausted: !result.exhausted,
      };
  }
}

function scoreChecks(checks: Record<string, boolean>): number {
  const values = Object.values(checks);
  if (values.length === 0) return 0;
  return Number((values.filter(Boolean).length / values.length).toFixed(4));
}

/** P1-5: for each FAILING trace-derived check, point at the exact offending trace event so the fix
 *  agent goes straight to the cause instead of grepping full trace JSON. Scope: pointer only for the
 *  checks whose predicates already locate the event — explicitly NOT a check framework. */
function checkFailurePointers(rung: Rung, result: AgentResult, checks: Record<string, boolean>): Record<string, string> {
  const out: Record<string, string> = {};
  const point = (name: string, i: number | null) => {
    if (checks[name] !== false || i === null) return;
    const e = result.trace[i];
    out[name] = `trace[${i}] ${e.tool} ${JSON.stringify(e.args).slice(0, 140)} -> ${JSON.stringify(e.result).slice(0, 100)}`;
  };
  point("readBeforeWrite", editReadProvenanceViolation(result));
  point("noClobber", editReadProvenanceViolation(result));
  point("readImmediatelyBeforeWrite", readImmediatelyBeforeEditsViolation(result));
  if (rung.id === "L5_large_range") point("touchedOnlyTarget", onlyTouchedViolation(result, new Set(["lr_0420__variance"])));
  if (rung.id === "L6_long_horizon") point("touchedOnlyTargets", onlyTouchedViolation(result, new Set(Object.keys(L6_TARGETS))));
  if (rung.id === "L7_resume") point("resumeTouchedOnlyRemaining", onlyTouchedViolation(result, new Set(Object.keys(L7_REMAINING_TARGETS))));
  return out;
}

async function runRung(rung: Rung, maker: (rung: Rung) => AgentModel, modelName: string, budget: RuntimeBudget, meter?: SpendMeter): Promise<RungResult> {
  const env = (rung.makeEnv ?? demoEnv)();
  rung.setup?.(env);
  const rt = new CountingRoomTools(env.engine, env.roomId, env.artifactId, env.actor, env.sessionId, env.stats);
  const contextBuilder = rung.contextBuilder ? (tools: RoomTools, goal: string) => rung.contextBuilder!(tools, goal, env) : undefined;
  const baseModel = maker(rung);
  const resolvedModels: string[] = [];
  const trackedModel: AgentModel = {
    get name() {
      return baseModel.name;
    },
    async next(input) {
      const step = await baseModel.next(input);
      resolvedModels.push(baseModel.name);
      return step;
    },
  };
  const t0 = Date.now();
  const deadlineAt = budget.rungTimeoutMs ? t0 + budget.rungTimeoutMs : undefined;
  const dispatchesFrom = meter?.dispatches.length ?? 0;
  const rungDispatches = () => (meter ? { dispatches: meter.dispatches.slice(dispatchesFrom) } : {});
  try {
    const runOnce = (goal: string, m: AgentModel, maxSteps: number) => runAgent({
      rt,
      goal,
      model: m,
      tools: rung.tools ?? ROOM_TOOLS,
      maxSteps,
      contextBuilder,
      compaction: rung.compaction,
      deadlineAt,
      reserveMs: budget.reserveMs,
      onTrace: (event) => rung.onTrace?.(event, env),
      // A metered run hands the runtime the dollars still left job-wide and the strict (throwing) price.
      ...(meter ? { spendLimits: { maxCostUsd: Math.max(0, meter.maxUsd - meter.spentUsd) }, priceStep: priceRunStrict } : {}),
    });
    let result: AgentResult;
    let slice1: AgentResult | undefined;
    if (rung.resume) {
      // Slice 1: the full task under a fatal step budget — must die mid-task for the rung to be valid.
      slice1 = await runOnce(rung.goal, trackedModel, rung.resume.slice1MaxSteps);
      env.resumeState = { slice1 };
      // The world moves while the agent is dead.
      rung.resume.betweenSlices(env);
      // Slice 2: a COLD continuation — fresh model context; only room state + the handoff text carry over.
      const slice2Base = modelName === "scripted" ? rung.resume.scriptedSlice2() : maker(rung);
      const tracked2: AgentModel = {
        get name() { return slice2Base.name; },
        async next(input) {
          const step = await slice2Base.next(input);
          resolvedModels.push(slice2Base.name);
          return step;
        },
      };
      result = await runOnce(rung.resume.resumeGoal(slice1), tracked2, rung.maxSteps ?? 18);
    } else {
      result = await runOnce(rung.goal, trackedModel, rung.maxSteps ?? 18);
    }
    const resolvedModel = resolvedModels.at(-1) ?? trackedModel.name;
    // Checks grade the slice-2 result (slice 1 is asserted via env.resumeState); the ARTIFACT carries both
    // traces with a boundary marker so a failing live route can be diagnosed across the death.
    const checks = rungChecks(rung, result, env);
    const checkDetails = checkFailurePointers(rung, result, checks);
    const pass = rung.check(result, env) && Object.values(checks).every(Boolean);
    const combinedTrace = slice1
      ? [...slice1.trace, { step: -1, tool: "slice_boundary", args: { forced: true, slice1Exhausted: slice1.exhausted }, result: { handoff: slice1.handoff?.summary ?? null }, ms: 0 } as AgentTraceEvent, ...result.trace]
      : result.trace;
    const price = meter ? priceRunStrict : priceRun; // a paid run never costs a guessed $1/$5 row
    const cost = (result.usage ? price(resolvedModel, result.usage.inputTokens, result.usage.outputTokens) : 0)
      + (slice1?.usage ? price(resolvedModel, slice1.usage.inputTokens, slice1.usage.outputTokens) : 0);
    return {
      pass,
      checkDetails,
      requestedModel: modelName,
      resolvedModel,
      resolvedModels: [...new Set(resolvedModels)],
      rung: rung.id,
      level: rung.level,
      ms: Date.now() - t0,
      tools: combinedTrace.filter((t) => t.tool !== "compaction" && t.tool !== "slice_boundary").length,
      cost,
      stopReason: result.stopReason,
      handoff: result.handoff?.summary,
      reason: pass ? "" : rung.diagnose?.(result, env) ?? result.handoff?.summary ?? "failed",
      checks,
      ...rungDispatches(),
      trace: combinedTrace,
    };
  } catch (error) {
    const resolvedModel = resolvedModels.at(-1) ?? trackedModel.name;
    return {
      pass: false,
      requestedModel: modelName,
      resolvedModel,
      resolvedModels: [...new Set(resolvedModels)],
      rung: rung.id,
      level: rung.level,
      ms: Date.now() - t0,
      tools: 0,
      cost: 0,
      error: error instanceof Error ? error.message : String(error),
      checks: { completed: false },
      ...rungDispatches(),
      trace: [],
    };
  }
}

function parseRealModels(): string[] {
  const idx = process.argv.indexOf("--real");
  if (idx === -1) return [];
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return ["gpt-5.4-nano", "gemini-3.1-flash-lite"];
  return next.split(",").map((s) => s.trim()).filter(Boolean);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function optionNumber(name: string, envName: string): number | undefined {
  const raw = optionValue(name) ?? process.env[envName];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseRuntimeBudget(): RuntimeBudget {
  return {
    rungTimeoutMs: optionNumber("--rung-timeout-ms", "LADDER_RUNG_TIMEOUT_MS"),
    reserveMs: optionNumber("--reserve-ms", "LADDER_RESERVE_MS") ?? 5_000,
    maxCostUsd: optionNumber("--max-cost-usd", "LADDER_MAX_COST_USD"),
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function parseRungFilter(): Set<string> | undefined {
  const raw = optionValue("--rungs") ?? optionValue("--levels");
  if (!raw) return undefined;
  const wanted = new Set<string>();
  const parts = raw.split(",").flatMap((part) => {
    const trimmed = part.trim();
    const match = trimmed.match(/^L?(\d+)-L?(\d+)$/i);
    if (!match) return [trimmed];
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return [trimmed];
    return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
  });
  for (const part of parts.map((s) => s.trim()).filter(Boolean)) {
    const normalized = part.toLowerCase();
    for (const rung of RUNGS) {
      if (normalized === rung.id.toLowerCase() || normalized === `l${rung.level}` || normalized === String(rung.level)) {
        wanted.add(rung.id);
      }
    }
  }
  if (wanted.size === 0) throw new Error(`No ladder rungs matched ${raw}`);
  return wanted;
}

async function parseModelRoutes(): Promise<string[]> {
  let routes = parseRealModels();
  const freeAutoTop = optionNumber("--free-auto-top", "LADDER_FREE_AUTO_TOP") ?? 0;
  if (freeAutoTop > 0) {
    const candidates = await selectOpenRouterFreeModels({
      mode: "agent",
      limit: freeAutoTop,
      forceRefresh: process.argv.includes("--free-auto-refresh"),
    });
    routes = unique([...routes, "openrouter/free-auto", ...candidates.map((m) => m.id)]);
  }
  return routes;
}

/** What makes a --real report a receipt (SPEC A.0.3): the tested commit, the constant it tested, the spend, the policy. */
interface ReportReceipt {
  startedAt: string;
  budget: LadderBudgetReport | null;
  dispatchPolicy: DispatchPolicy | null;
}

/** Run environment a reviewer needs to reproduce the receipt. No keys, no hostnames, no paths. */
function receiptEnvironment(): { node: string; platform: string; ci: boolean } {
  return { node: process.version, platform: process.platform, ci: Boolean(process.env.CI) };
}

function sha256OfFile(path: string): string | null {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); } catch { return null; }
}

function writeJsonReport(results: RungResult[], selectedRungs: Rung[], requestedRoutes: string[], receipt: ReportReceipt): void {
  const outPath = optionValue("--json-out");
  if (!outPath) return;
  const absolute = resolve(process.cwd(), outPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const real = receipt.budget !== null;
  const identity = real ? readGitIdentity() : undefined;
  // One flat row per provider request (A.0.3 `rows`), tagged with the rung that issued it.
  const rows = results.flatMap((r) => (r.dispatches ?? []).map((d) => ({ rung: r.rung, ...d })));
  const echoedModels = [...new Set(rows.map((r) => r.echoedModel).filter((m): m is string => m !== null))];
  writeFileSync(
    absolute,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      startedAt: receipt.startedAt,
      ...(real ? { command: ["tsx", "evals/ladder.ts", ...process.argv.slice(2)].join(" ") } : {}),
      requestedRoutes,
      ...(real ? { candidateIds: requestedRoutes, echoedModels, rows } : {}),
      rungs: selectedRungs.map((r) => ({ id: r.id, level: r.level, label: r.label })),
      ...(identity ? { testedCommit: identity.commitSha, gitDirty: identity.gitDirty, constantSha256: sha256OfFile("convex/modelDefaults.ts") } : {}),
      budget: receipt.budget,
      dispatchPolicy: receipt.dispatchPolicy,
      ...(real ? { environment: receiptEnvironment() } : {}),
      results: results.map(publicResult),
    }, null, 2),
  );
  console.log(`\nwrote ${outPath}`);
}

function publicResult(result: RungResult): Omit<RungResult, "trace"> {
  const { trace, ...publicRow } = result;
  void trace;
  return publicRow;
}

/** Append each rung result to the durable eval store (gated by --record) so cross-commit regression
 *  diffs work — see evals/evalStore.ts + `npm run eval:diff`. The producer side of the HALO substrate. */
function recordRunsToStore(results: RungResult[]): void {
  if (!process.argv.includes("--record")) return;
  const identity = readGitIdentity();
  const ts = Date.now();
  const store = optionValue("--eval-store") ?? DEFAULT_STORE;
  const identityKey = runKey({
    ts,
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    suite: "ladder",
    caseId: "identity",
    status: "skip",
  });
  const traceDir = optionValue("--trace-dir") ?? join(
    "docs",
    "eval",
    "traces",
    "ladder",
    `${new Date(ts).toISOString().replace(/[-:.]/g, "").replace("Z", "Z")}-${safeSegment(identityKey)}`,
  );
  const caseSetHash = computeCaseSetHash(results.map((r) => `ladder:${r.rung}:${r.requestedModel}`)); // P0-1
  const records: EvalRunRecord[] = results.map((r) => ({
    ts,
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    caseSetHash,
    suite: "ladder",
    caseId: `ladder:${r.rung}:${r.requestedModel}`,
    model: r.resolvedModel,
    status: r.pass ? "pass" : "fail",
    score: scoreChecks(r.checks),
    checks: r.checks,
    failureSummary: r.pass ? undefined : [
      r.reason || r.error || r.stopReason || "failed",
      ...Object.entries(r.checkDetails ?? {}).map(([k, v]) => `${k} @ ${v}`), // P1-5 pointers
    ].join(" | "),
    traceRef: writeTraceArtifact(r, identity, traceDir, ts),
    harnessVersion: "ladder-v1",
  }));
  appendEvalRuns(records, store);
  console.log(`\nrecorded ${records.length} rung result(s) to ${store} (${runKey(records[0])}). Diff: npm run eval:diff`);
}

type GitIdentity = {
  commitSha: string;
  worktreeHash?: string;
  gitDirty: boolean;
};

function readGitIdentity(): GitIdentity {
  let commitSha = "nocommit";
  let status = "";
  let diff = "";
  // Full SHA: the receipt's testedCommit must be an ancestor-checkable 40-hex id (SPEC A.0.3), not a short prefix.
  try { commitSha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* not a git repo */ }
  try { status = execSync("git status --porcelain=v1", { stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { /* not a git repo */ }
  try { diff = execSync("git diff --no-ext-diff --binary HEAD --", { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).toString(); } catch { /* large or unavailable diff */ }
  const gitDirty = status.trim().length > 0;
  return {
    commitSha,
    gitDirty,
    worktreeHash: gitDirty ? stableJournalHash({ status, diff }) : undefined,
  };
}

function writeTraceArtifact(result: RungResult, identity: GitIdentity, traceDir: string, ts: number): string {
  mkdirSync(traceDir, { recursive: true });
  const caseId = `ladder:${result.rung}:${result.requestedModel}`;
  const file = join(traceDir, `${safeSegment(caseId)}.json`);
  writeFileSync(file, JSON.stringify({
    schema: 1,
    generatedAt: new Date(ts).toISOString(),
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    suite: "ladder",
    caseId,
    score: scoreChecks(result.checks),
    checks: result.checks,
    checkDetails: result.checkDetails ?? {}, // P1-5: failing-check -> offending trace event
    result: publicResult(result),
    trace: result.trace,
  }, null, 2));
  return normalizePath(relative(process.cwd(), file));
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 180) || "run";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Opening-context size and per-step growth of one rung, read from a scripted dry run (zero provider requests). */
interface RungShape {
  rung: Rung;
  ctxTokens0: number;
  growthTokens: number;
  /** Provider-request upper bound for one model on this rung (resume rungs run two slices). */
  maxSteps: number;
}

async function scriptedRungShape(rung: Rung, budget: RuntimeBudget): Promise<RungShape> {
  const sizes: number[] = [];
  const probe = (r: Rung): AgentModel => {
    const base = r.scripted();
    return {
      get name() { return base.name; },
      async next(input) {
        sizes.push(requestInputTokenUpperBound(input.system, input.messages, input.tools));
        return base.next(input);
      },
    };
  };
  await runRung(rung, probe, "scripted", { ...budget, maxCostUsd: undefined });
  const ctxTokens0 = sizes[0] ?? 0;
  const growthTokens = sizes.length > 1 ? Math.max(0, ((sizes.at(-1) ?? 0) - ctxTokens0) / (sizes.length - 1)) : 0;
  const maxSteps = (rung.maxSteps ?? 18) + (rung.resume?.slice1MaxSteps ?? 0);
  return { rung, ctxTokens0, growthTokens, maxSteps };
}

/** Provider-request ceiling for the grid: routes x rungs x max steps (a free-auto route fans out over its candidates). */
export function ladderRequestCeiling(routes: string[], shapes: RungShape[], freeAutoCandidates = 1): number {
  const steps = shapes.reduce((sum, shape) => sum + shape.maxSteps, 0);
  return routes.reduce((sum, route) => sum + (/free-auto$/i.test(route) ? Math.max(1, freeAutoCandidates) : 1) * steps, 0);
}

/**
 * Worst-case USD before the first paid request:
 *   Σ_models Σ_rungs Σ_{step=1..maxSteps} ((ctx0 + (step-1)·growth) · inPerM + maxOut · outPerM) / 1e6.
 * ctx0 and growth come from the scripted dry run, so this is a pre-flight sanity bound ("can the cap cover a full
 * grid at all?"), not the spend guard: the guard is the per-dispatch reservation, which prices each request's real
 * input bytes. A free-auto route fans out over its candidates, so it multiplies by the candidate limit. The
 * request count holds only under RECEIPT_DISPATCH_POLICY: with retries and fallback each step could issue several.
 */
export function estimateLadderUsd(routes: string[], shapes: RungShape[], freeAutoCandidates = 1): number {
  let total = 0;
  for (const route of routes) {
    const pricing = getModelPricing(resolveModelAlias(route));
    if (!pricing) throw new Error(`no pricing row for "${route}"`);
    const maxOut = modelMaxOutputTokens(resolveModelAlias(route));
    const fanOut = /free-auto$/i.test(route) ? Math.max(1, freeAutoCandidates) : 1;
    for (const shape of shapes) {
      for (let step = 1; step <= shape.maxSteps; step++) {
        total += fanOut * priceTokens(pricing, shape.ctxTokens0 + (step - 1) * shape.growthTokens, maxOut);
      }
    }
  }
  return total;
}

export async function main() {
  const realModels = await parseModelRoutes();
  const budget = parseRuntimeBudget();
  const startedAt = new Date().toISOString();
  const rungFilter = parseRungFilter();
  const selectedRungs = rungFilter ? RUNGS.filter((r) => rungFilter.has(r.id)) : RUNGS;
  const real = realModels.length > 0;

  let meter: SpendMeter | undefined;
  let estimateUsd = 0;
  let requestCeiling = 0;
  const budgetReport = (): LadderBudgetReport | null => (meter
    ? { maxUsd: meter.maxUsd, estimateUsd, spentUsd: meter.spentUsd, requests: meter.requests, requestCeiling, stoppedBy: meter.stoppedBy }
    : null);
  const refuse = (message: string) => {
    console.error(`ladder: ${message}`);
    writeJsonReport([], selectedRungs, realModels, { startedAt, budget: budgetReport(), dispatchPolicy: RECEIPT_DISPATCH_POLICY });
    process.exitCode = 1;
  };

  if (real) {
    // A paid run needs a dollar cap, and every id it will call must have a verified price: no cap, no guessed row.
    if (budget.maxCostUsd === undefined) {
      console.error("ladder: --real needs a dollar cap (LADDER_MAX_COST_USD or --max-cost-usd). Refusing to start; no request was made.");
      process.exitCode = 1;
      return;
    }
    meter = createSpendMeter(budget.maxCostUsd);
    const unpriced = realModels.find((id) => !getModelPricing(resolveModelAlias(id)));
    if (unpriced) {
      meter.stoppedBy = "unpriced_model";
      refuse(`no pricing row for "${unpriced}"; add a verified row (modelCatalog.modelPricing) before a paid run. No request was made.`);
      return;
    }
    const shapes: RungShape[] = [];
    for (const rung of selectedRungs) shapes.push(await scriptedRungShape(rung, budget));
    const freeAutoCandidates = optionNumber("--free-auto-top", "LADDER_FREE_AUTO_TOP") ?? 1;
    estimateUsd = estimateLadderUsd(realModels, shapes, freeAutoCandidates);
    requestCeiling = ladderRequestCeiling(realModels, shapes, freeAutoCandidates);
    console.log(`pre-flight: worst case $${estimateUsd.toFixed(4)} for ${realModels.length} route(s) x ${selectedRungs.length} rung(s); cap $${meter.maxUsd.toFixed(4)}`);
    if (estimateUsd > meter.maxUsd) {
      meter.stoppedBy = "spend_budget";
      refuse(`worst-case estimate $${estimateUsd.toFixed(4)} exceeds the $${meter.maxUsd.toFixed(4)} cap. Raise the cap or narrow --levels; no request was made.`);
      return;
    }
  }

  const models: { name: string; maker: (rung: Rung) => AgentModel }[] = real
    ? realModels.map((id) => ({ name: id, maker: () => realModel(id, { dispatch: RECEIPT_DISPATCH_POLICY, meter }) }))
    : [{ name: "scripted", maker: (rung) => rung.scripted() }];

  const grid: Record<string, Record<string, boolean>> = {};
  const results: RungResult[] = [];
  for (const model of models) {
    grid[model.name] = {};
    for (const rung of selectedRungs) {
      if (meter?.stoppedBy) break; // the cap is reached: no further rung may spend
      process.stdout.write(`  ${model.name} · ${rung.id} ... `);
      const res = await runRung(rung, model.maker, model.name, budget, meter);
      results.push(res);
      // The runtime's own pre-call gate can end a rung on the cap before the adapter is asked to dispatch.
      if (meter && res.stopReason === "spend_budget") meter.stoppedBy ??= "spend_budget";
      grid[model.name][rung.id] = res.pass;
      const stop = "stopReason" in res && res.stopReason !== "done" ? `, ${res.stopReason}` : "";
      const resolved = res.resolvedModel !== model.name ? `, resolved=${res.resolvedModel}` : "";
      console.log(`${res.pass ? "PASS" : "FAIL"} (${res.tools} tools, ${(res.ms / 1000).toFixed(1)}s, $${res.cost.toFixed(4)}${resolved}${stop}${"error" in res && res.error ? `, ${res.error.slice(0, 80)}` : ""})`);
      if (!res.pass && "reason" in res && res.reason) console.log(`        ${res.reason}`);
      if (!res.pass && "handoff" in res && res.handoff) console.log(`        handoff: ${res.handoff}`);
    }
  }

  console.log("\nFAILURE HEATMAP (model x level)\n" + "-".repeat(72));
  console.log("model".padEnd(30) + selectedRungs.map((r) => `L${r.level}`).join("  "));
  for (const model of models) {
    console.log(model.name.padEnd(30) + selectedRungs.map((r) => (grid[model.name][r.id] ? "OK" : "--")).join("  "));
  }
  console.log("-".repeat(72));
  console.log("legend: " + selectedRungs.map((r) => `L${r.level}=${r.label}`).join(" | "));
  if (meter) console.log(`spend: $${meter.spentUsd.toFixed(4)} of $${meter.maxUsd.toFixed(4)} over ${meter.requests} provider request(s)${meter.stoppedBy ? `; STOPPED by ${meter.stoppedBy} (not a receipt)` : ""}`);
  writeJsonReport(results, selectedRungs, models.map((m) => m.name), { startedAt, budget: budgetReport(), dispatchPolicy: real ? RECEIPT_DISPATCH_POLICY : null });
  recordRunsToStore(results);

  if (meter?.stoppedBy) process.exitCode = 1; // a budget stop is an incomplete run, never a pass
  if (Object.values(grid).some((row) => Object.values(row).some((ok) => !ok))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
