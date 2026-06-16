import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeNodeAgentOmnigentSpec,
  NODEAGENT_OMNIGENT_SPEC_TARGETS,
  summarizeNodeAgentOmnigentAnalysis,
} from "@nodeagent/index";

describe("NodeAgent Omnigent adapter", () => {
  it("keeps the Omnigent YAML specs executable against the NodeAgent proof commands", () => {
    for (const target of NODEAGENT_OMNIGENT_SPEC_TARGETS) {
      const text = readFileSync(target.path, "utf8");
      const analysis = analyzeNodeAgentOmnigentSpec({ path: target.path, profile: target.profile, text });

      expect(analysis.ok, summarizeNodeAgentOmnigentAnalysis(analysis)).toBe(true);
      expect(analysis.name).toBe(target.expectedName);
      expect(analysis.executorHarness ?? analysis.executorType).toBeTruthy();
      expect(analysis.osEnvType).toBe("caller_process");
      expect(analysis.cwd).toBe(".");
      expect(analysis.hasSecretLiteral).toBe(false);
      expect(analysis.runCommand).toBe(`omni run ${target.path}`);
    }
  });

  it("requires the room worker to run the NodeAgent/Omnigent bridge smoke", () => {
    const target = NODEAGENT_OMNIGENT_SPEC_TARGETS.find((candidate) => candidate.profile === "room-worker");
    expect(target).toBeTruthy();
    const text = readFileSync(target!.path, "utf8");
    const analysis = analyzeNodeAgentOmnigentSpec({ path: target!.path, profile: "room-worker", text });

    expect(analysis.requiredCommands.map((command) => [command.command, command.present])).toEqual([
      ["npm run nodeagent:frame:smoke", true],
      ["npm test -- --run tests/agentJobsSource.test.ts tests/agentJobsRuntime.test.ts tests/frameRunner.test.ts tests/nodeagentFrameSmoke.test.ts", true],
      ["npm run omnigent:nodeagent:smoke", true],
      ["npm run build", true],
      ["npx tsc --noEmit --project convex/tsconfig.json --pretty false", true],
    ]);
  });
});
