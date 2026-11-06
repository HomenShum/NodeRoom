/**
 * Eval runner — scores the agent harness against the golden cases.
 *
 *   npx tsx evals/runEval.ts            # deterministic (scripted model, no keys)
 *   npx tsx evals/runEval.ts --real     # against the real Anthropic model
 *
 * Outcome metric (did the sheet end in the desired state) + process invariants
 * (did it follow the protocol: lock/release, draft when blocked, recover from a
 * CAS conflict). Each case is run in a fresh in-memory room.
 */

import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools, ROOM_TOOLS, runAgent, scriptedModel, anthropicModel, type AgentResult } from "../src/nodeagent/index";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";
import { GOLDEN, type GoldenCase } from "./cases";

const real = process.argv.includes("--real");

interface Scored { id: string; persona: string; kind: string; pass: boolean; taskOk: boolean; invariants: Record<string, boolean>; conflicts: number; steps: number; }

function scoreInvariants(c: GoldenCase, r: AgentResult): Record<string, boolean> {
  const has = (tool: string) => r.trace.some((t) => t.tool === tool);
  const conflicts = r.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;
  const out: Record<string, boolean> = {};
  for (const inv of c.expect.invariants) {
    if (inv === "locked") out[inv] = r.trace.some((t) => t.tool === "propose_lock" && (t.result as { ok?: boolean })?.ok);
    else if (inv === "released") out[inv] = has("release_lock");
    else if (inv === "drafted") out[inv] = r.trace.some((t) => t.tool === "create_draft" && (t.result as { draftId?: string })?.draftId);
    else if (inv === "conflict_recovered") out[inv] = conflicts >= 1;
    else if (inv === "no_conflict") out[inv] = conflicts === 0;
  }
  return out;
}

function pickModel(targets: Record<string, string>, lock?: boolean) {
  return real ? anthropicModel() : scriptedModel(recomputeVariancePlan(targets, { lock }));
}

/** M1 — multi-turn: run each turn on the SAME room; assert the shared cell's version strictly
 *  increases each turn (proving turn N re-read the post-turn-(N-1) version, never a stale baseline). */
async function runTurns(c: GoldenCase): Promise<Scored> {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const sharedCell = Object.keys(c.turns![0].targets)[0];
  const versions: number[] = [];
  let last: AgentResult | undefined;
  for (const turn of c.turns!) {
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    last = await runAgent({ rt, goal: turn.goal, model: pickModel(turn.targets, turn.lock), tools: ROOM_TOOLS, maxSteps: 16 });
    versions.push(engine.getArtifact(d.sheetId)!.elements[sharedCell]?.version ?? 0);
  }
  const art = engine.getArtifact(d.sheetId)!;
  const taskOk = Object.entries(c.expect.cells).every(([id, val]) => String(art.elements[id]?.value ?? "") === val);
  const fresh = versions.every((v, i) => i === 0 || v > versions[i - 1]) && !last?.exhausted;
  return { id: c.id, persona: c.persona, kind: c.kind, pass: taskOk && fresh, taskOk, invariants: { fresh_reads: fresh }, conflicts: 0, steps: last?.trace.length ?? 0 };
}

/** L1 — property test: run N times, injecting a concurrent human edit on a rotating cell each run;
 *  the no-silent-clobber invariant (conflict hit → recovered → agent's value wins) must hold EVERY ordering. */
async function runProperty(c: GoldenCase): Promise<Scored> {
  const p = c.property!;
  let allPass = true, totalConflicts = 0;
  for (let i = 0; i < p.iterations; i++) {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    const injectCell = p.injectCells[i % p.injectCells.length];
    let injected = false;
    const onTrace = (e: { tool: string; args: unknown }) => {
      const ids = (e.args as { elementIds?: string[] }).elementIds ?? [];
      if (!injected && e.tool === "read_range" && ids.includes(injectCell)) {
        injected = true;
        const v = engine.getArtifact(d.sheetId)!.elements[injectCell].version;
        engine.applyEdit({ roomId: d.roomId, op: { opId: "h" + i, artifactId: d.sheetId, elementId: injectCell, kind: "set", value: "+19%", baseVersion: v }, actor: d.members.priya });
      }
    };
    const r = await runAgent({ rt, goal: c.goal, model: pickModel(c.targets, p.lock), tools: ROOM_TOOLS, maxSteps: 20, onTrace });
    const art = engine.getArtifact(d.sheetId)!;
    const taskOk = Object.entries(c.expect.cells).every(([id, val]) => String(art.elements[id]?.value ?? "") === val);
    const conflicts = r.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;
    totalConflicts += conflicts;
    if (!(taskOk && injected && conflicts >= 1 && !r.exhausted)) allPass = false;
  }
  return { id: c.id, persona: c.persona, kind: c.kind, pass: allPass, taskOk: allPass, invariants: { [`no_clobber_×${p.iterations}`]: allPass }, conflicts: totalConflicts, steps: 0 };
}

async function runCase(c: GoldenCase): Promise<Scored> {
  if (c.turns) return runTurns(c);
  if (c.property) return runProperty(c);
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);

  // Another agent pre-holds the range (forces the run to draft).
  let preLockId = "";
  if (c.preLock) {
    const r = engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: c.preLock, holder: d.agents.priv, sessionId: d.sessions.priv, reason: "private agent working" });
    if (r.ok) preLockId = r.lock.id;
  }

  // Inject a concurrent human edit to force a CAS conflict (long-running cases).
  let injected = false;
  const onTrace = (e: { tool: string; args: unknown }) => {
    const ids = (e.args as { elementIds?: string[] }).elementIds ?? [];
    if (c.injectConflictOn && !injected && e.tool === "read_range" && ids.includes(c.injectConflictOn)) {
      injected = true;
      const v = engine.getArtifact(d.sheetId)!.elements[c.injectConflictOn].version;
      engine.applyEdit({ roomId: d.roomId, op: { opId: "human", artifactId: d.sheetId, elementId: c.injectConflictOn, kind: "set", value: "+19%", baseVersion: v }, actor: d.members.priya });
    }
  };

  const model = pickModel(c.targets, c.lock);
  const r = await runAgent({ rt, goal: c.goal, model, tools: ROOM_TOOLS, maxSteps: 18, onTrace });

  // Release the pre-held lock so the draft smart-merges, then score the result.
  if (preLockId && r.trace.some((t) => t.tool === "create_draft")) engine.releaseLock(preLockId, d.agents.priv);

  const art = engine.getArtifact(d.sheetId)!;
  const taskOk = Object.entries(c.expect.cells).every(([id, val]) => String(art.elements[id]?.value ?? "") === val);
  const invariants = scoreInvariants(c, r);
  const conflicts = r.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;
  const pass = taskOk && Object.values(invariants).every(Boolean) && !r.exhausted;
  return { id: c.id, persona: c.persona, kind: c.kind, pass, taskOk, invariants, conflicts, steps: r.trace.length };
}

async function main() {
  if (real && !process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("Real evaluation requires a non-blank ANTHROPIC_API_KEY. Set it to run npm run eval:real, or use npm run eval for scripted replay.");
  }
  const cases = GOLDEN.filter((c) => real || c.scriptable);
  console.log("─".repeat(78));
  console.log(`AGENT EVAL · ${real ? "anthropic (real)" : "scripted (deterministic)"} · ${cases.length} cases`);
  console.log("─".repeat(78));
  const results: Scored[] = [];
  for (const c of cases) {
    const s = await runCase(c);
    results.push(s);
    const inv = Object.entries(s.invariants).map(([k, v]) => `${v ? "✓" : "✗"}${k}`).join(" ");
    console.log(`${s.pass ? "✅ PASS" : "❌ FAIL"}  ${s.id.padEnd(30)} [${s.kind}]  task=${s.taskOk ? "ok" : "MISS"}  ${inv}  (${s.steps} calls, ${s.conflicts} conflict)`);
    console.log(`        persona: ${s.persona}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log("─".repeat(78));
  console.log(`SCORE: ${passed}/${results.length} passed`);
  console.log("─".repeat(78));
  if (passed < results.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
