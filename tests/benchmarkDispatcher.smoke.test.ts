/**
 * Smoke test: the additive @bench:<task-id> dispatcher routes a chat into the
 * live nodeagent runtime, fills bench-namespaced cells, and grades them against
 * the rubric. Honest grade = actual ± tolerance from rubric.expected.
 */
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  dispatchBenchmarkTask,
  listBenchmarkTaskIds,
  parseBenchmarkInvocation,
  benchElementId,
} from "../src/app/benchmarkDispatcher";

describe("benchmark dispatcher", () => {
  it("parses @bench:<task-id>", () => {
    expect(parseBenchmarkInvocation("@bench:nb-01-company-profile")).toBe("nb-01-company-profile");
    expect(parseBenchmarkInvocation("recompute variance")).toBeNull();
    expect(parseBenchmarkInvocation("@bench:nb-02-vendor-pricing please")).toBe("nb-02-vendor-pricing");
  });

  it("bundles every nonbtb task", () => {
    const ids = listBenchmarkTaskIds();
    expect(ids).toContain("nb-01-company-profile");
    expect(ids).toContain("nb-02-vendor-pricing");
    expect(ids).toContain("nb-03-reconciliation");
  });

  it("runs nb-01-company-profile end-to-end against the engine and grades PASS", async () => {
    const engine = new RoomEngine();
    const { room } = engine.createRoom({ title: "bench", hostName: "tester" });
    const session = engine.startSession({ roomId: room.id, agentId: "bench-agent", agentName: "BenchAgent", scope: "public" });
    const messages: string[] = [];
    const result = await dispatchBenchmarkTask({
      engine,
      roomId: room.id,
      taskId: "nb-01-company-profile",
      actor: { kind: "agent", id: "bench-agent", name: "BenchAgent", scope: "public" },
      sessionId: session.id,
      postMessage: (text) => messages.push(text),
    });
    expect(result.error).toBeUndefined();
    expect(result.ok, JSON.stringify(result.grade)).toBe(true);
    expect(result.grade.length).toBe(5);
    expect(result.outputs.revenue_growth_pct).toBeCloseTo(25.0, 5);
    expect(result.outputs.gross_margin_2024).toBeCloseTo(40.0, 5);
    expect(result.outputs.eps_2025).toBeCloseTo(3.5, 5);
    // The cell namespace must NOT collide with isVarianceSheet's r_*__variance ids.
    expect(benchElementId("revenue_growth_pct")).toBe("bench__revenue_growth_pct");
    // The dispatcher must emit the live-DOM signal so prod verification can grep it.
    expect(messages.some((m) => m.startsWith("BENCHMARK_DISPATCHER_READY task=nb-01-company-profile"))).toBe(true);
    expect(messages.some((m) => m.startsWith("BENCHMARK_DISPATCHER_RESULT task=nb-01-company-profile"))).toBe(true);
  });

  it("nb-02-vendor-pricing also passes", async () => {
    const engine = new RoomEngine();
    const { room } = engine.createRoom({ title: "bench", hostName: "tester" });
    const session = engine.startSession({ roomId: room.id, agentId: "bench-agent", agentName: "BenchAgent", scope: "public" });
    const result = await dispatchBenchmarkTask({
      engine,
      roomId: room.id,
      taskId: "nb-02-vendor-pricing",
      actor: { kind: "agent", id: "bench-agent", name: "BenchAgent", scope: "public" },
      sessionId: session.id,
    });
    expect(result.error).toBeUndefined();
    expect(result.ok, JSON.stringify(result.grade)).toBe(true);
    expect(result.outputs.lowest_total).toBeCloseTo(11800, 0);
  });

  it("unknown task id reports an honest error (no fake pass)", async () => {
    const engine = new RoomEngine();
    const { room } = engine.createRoom({ title: "bench", hostName: "tester" });
    const session = engine.startSession({ roomId: room.id, agentId: "bench-agent", agentName: "BenchAgent", scope: "public" });
    const result = await dispatchBenchmarkTask({
      engine,
      roomId: room.id,
      taskId: "nb-99-does-not-exist",
      actor: { kind: "agent", id: "bench-agent", name: "BenchAgent", scope: "public" },
      sessionId: session.id,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No rubric bundled/);
  });
});
