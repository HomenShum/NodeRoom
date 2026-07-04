import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  externalBenchmarkLocalTaskIds,
  loadExternalBenchmarkLocalTasks,
} from "../proofloop/benchmarks/common/local-tasks";
import { readBenchmarkAdapter } from "../src/eval/proofloopBenchmarkAdapters";

describe("Proof Loop external benchmark local adapters", () => {
  it("implements a local loader and browser scenario for every external adapter", () => {
    expect(externalBenchmarkLocalTaskIds()).toEqual(["finch", "finauditing", "workstreambench"]);

    for (const id of externalBenchmarkLocalTaskIds()) {
      const adapter = readBenchmarkAdapter(id);
      expect(existsSync(adapter.taskLoader), `${id} task loader exists`).toBe(true);
      expect(existsSync(adapter.browserScenario), `${id} browser scenario exists`).toBe(true);
      expect(adapter.liveUserCommand, `${id} live command uses fresh-room proxy proof`).toContain("benchmark:proofloop:external-adapter-live-room");

      const tasks = loadExternalBenchmarkLocalTasks(id);
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((task) => task.adapterId === id)).toBe(true);
      expect(tasks.every((task) => task.officialScoreClaim === false)).toBe(true);
      expect(tasks.flatMap((task) => task.expectedUiSignals)).toContain("Computed D2 = C2 - B2 = 3,250.");
    }
  });
});
