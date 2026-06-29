import { describe, it, expect, afterEach } from "vitest";
import { modelForFramePhase, ORCHESTRATOR_PHASES } from "../src/nodeagent/models/phaseModel";

describe("modelForFramePhase", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of ["AGENT_ORCHESTRATOR_MODEL", "AGENT_WORKER_MODEL"]) {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns AGENT_ORCHESTRATOR_MODEL for orchestrator phases", () => {
    process.env.AGENT_ORCHESTRATOR_MODEL = "z-ai/glm-5.2";
    process.env.AGENT_WORKER_MODEL = "minimax/minimax-m3";

    for (const phase of ["intake", "plan", "verify", "synthesize"]) {
      expect(modelForFramePhase(phase, "fallback-model")).toBe("z-ai/glm-5.2");
    }
  });

  it("returns AGENT_WORKER_MODEL for execute phase", () => {
    process.env.AGENT_ORCHESTRATOR_MODEL = "z-ai/glm-5.2";
    process.env.AGENT_WORKER_MODEL = "minimax/minimax-m3";

    expect(modelForFramePhase("execute", "fallback-model")).toBe("minimax/minimax-m3");
  });

  it("falls back when env vars are not set", () => {
    delete process.env.AGENT_ORCHESTRATOR_MODEL;
    delete process.env.AGENT_WORKER_MODEL;

    expect(modelForFramePhase("plan", "fallback-model")).toBe("fallback-model");
    expect(modelForFramePhase("execute", "fallback-model")).toBe("fallback-model");
  });

  it("falls back for unknown phases", () => {
    process.env.AGENT_ORCHESTRATOR_MODEL = "z-ai/glm-5.2";
    process.env.AGENT_WORKER_MODEL = "minimax/minimax-m3";

    expect(modelForFramePhase("unknown", "fallback-model")).toBe("fallback-model");
  });

  it("falls back when orchestrator env is set but phase is execute", () => {
    process.env.AGENT_ORCHESTRATOR_MODEL = "z-ai/glm-5.2";
    delete process.env.AGENT_WORKER_MODEL;

    expect(modelForFramePhase("execute", "fallback-model")).toBe("fallback-model");
  });

  it("falls back when worker env is set but phase is plan", () => {
    delete process.env.AGENT_ORCHESTRATOR_MODEL;
    process.env.AGENT_WORKER_MODEL = "minimax/minimax-m3";

    expect(modelForFramePhase("plan", "fallback-model")).toBe("fallback-model");
  });

  it("supports Nebius model IDs as orchestrator", () => {
    process.env.AGENT_ORCHESTRATOR_MODEL = "nebius/zai-org/GLM-5";
    process.env.AGENT_WORKER_MODEL = "nebius/MiniMaxAI/MiniMax-M2.5";

    expect(modelForFramePhase("plan", "fallback")).toBe("nebius/zai-org/GLM-5");
    expect(modelForFramePhase("execute", "fallback")).toBe("nebius/MiniMaxAI/MiniMax-M2.5");
  });

  it("ORCHESTRATOR_PHASES contains the expected set", () => {
    expect(ORCHESTRATOR_PHASES.has("intake")).toBe(true);
    expect(ORCHESTRATOR_PHASES.has("plan")).toBe(true);
    expect(ORCHESTRATOR_PHASES.has("verify")).toBe(true);
    expect(ORCHESTRATOR_PHASES.has("synthesize")).toBe(true);
    expect(ORCHESTRATOR_PHASES.has("execute")).toBe(false);
  });
});
