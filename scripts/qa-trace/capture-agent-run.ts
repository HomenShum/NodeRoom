/**
 * Agent-run trace producer. Drives the REAL agent runtime (scripted, in-memory) through a task and
 * turns its per-tool-call trace (AgentResult.trace — every read/lock/CAS-write/release) into a Trace
 * bundle. This is the "agent record shows EVERY tool call" deliverable: the runtime already emits a
 * trace event per call (runtime.ts onTrace); this captures it without needing the live in-app wiring.
 *
 * Run:  npx tsx <worktree>/scripts/qa-trace/capture-agent-run.ts
 * Production path: in the live app, feed runAgent's onTrace into the room ledger (Convex insert) +
 * expose it the same bundle shape; this producer proves the format end-to-end with real trace data.
 */
import { RoomEngine } from "../../src/engine/roomEngine";
import { buildDemoRoom } from "../../src/engine/demoRoom";
import { InMemoryRoomTools, ROOM_TOOLS, runAgent, scriptedModel } from "../../src/nodeagent/index";
import { recomputeVariancePlan } from "../../src/nodeagent/core/plans";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const BUNDLE_DIR = join(ROOT, "src", "ui", "panels", "qaTraceBundles");
mkdirSync(BUNDLE_DIR, { recursive: true });
const STAMP = process.env.QA_TRACE_STAMP ?? "captured";

const engine = new RoomEngine();
const d = buildDemoRoom(engine);
const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };

const r = await runAgent({
  rt,
  goal: "recompute Q3 variance for revenue and COGS without clobbering concurrent edits",
  model: scriptedModel(recomputeVariancePlan(TARGETS)),
  tools: ROOM_TOOLS,
  maxSteps: 18,
});

const phaseOf = (tool: string): string =>
  /read|search|snapshot|aware/i.test(tool) ? "Read & context"
    : /lock/i.test(tool) ? "Claim locks"
      : /edit|draft|create|set_/i.test(tool) ? "Write (CAS)"
        : /say|release|handoff/i.test(tool) ? "Commit & report"
          : "Other";
const short = (v: unknown): string => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 130 ? `${s.slice(0, 130)}…` : s; };
const okResult = (res: unknown): boolean => { const o = res as { ok?: boolean; conflict?: boolean; error?: unknown; locked?: boolean } | null; return !(o && (o.ok === false || o.conflict || o.error || o.locked)); };

const steps = r.trace.map((t, i) => ({
  idx: i + 1,
  label: t.tool,
  detail: `${short(t.args)}  →  ${short(t.result)}`,
  status: okResult(t.result) ? ("ok" as const) : ("warn" as const),
  group: phaseOf(t.tool),
  attachments: [{ kind: "log" as const, text: JSON.stringify({ args: t.args, result: t.result, ms: t.ms }, null, 2) }],
}));

const bundle = {
  id: "agent-run-variance",
  kind: "agent" as const,
  title: "Agent run · recompute Q3 variance",
  subtitle: "Every tool call from a real harness run — read → claim locks → CAS write → release, no-clobber under concurrency",
  ts: STAMP,
  source: { tool: "NodeAgent", version: "runtime.ts · scripted plan", env: "in-memory room" },
  verdict: { label: `${r.steps} steps · ${r.trace.length} tool calls · ${r.stopReason}`, tone: r.stopReason === "done" ? ("ok" as const) : ("warn" as const) },
  steps,
  raw: { stopReason: r.stopReason, exhausted: r.exhausted, usage: r.usage, traceCount: r.trace.length },
};

writeFileSync(join(BUNDLE_DIR, "agent-run.json"), `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`agent run: ${r.trace.length} tool calls, stopReason=${r.stopReason}`);
console.log("tools:", r.trace.map((t) => t.tool).join(", "));
